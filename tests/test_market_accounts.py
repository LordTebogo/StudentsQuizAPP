"""Shared market authentication, ownership and private conversation boundaries."""
import os
import tempfile
import unittest
from fastapi.testclient import TestClient

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""
import main
from models import Accommodation, DirectMessage, DirectMessageBlock, Landlord, Lecturer, MarketAdvert, Student


class MarketAccountsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.prefix = self._testMethodName
        with main.SessionLocal() as db:
            common = dict(password_hash=main._password_hash("Test-password-123"), active=True, created_at="2026-11-01T00:00:00Z")
            student = Student(student_number=self.prefix.upper(), full_name="Market Learner", email=self.prefix+"-learner@example.test", approved=True, **common)
            tutor = Lecturer(full_name="Market Tutor", email=self.prefix+"-tutor@example.test", approved=True, **common)
            provider = Landlord(full_name="Market Provider", email=self.prefix+"-provider@example.test", phone="0791112233", **common)
            other = Landlord(full_name="Other Provider", email=self.prefix+"-other@example.test", phone="0791112233", **common)
            db.add_all([student,tutor,provider,other]); db.flush()
            self.ids = dict(student=student.id,lecturer=tutor.id,landlord=provider.id,other=other.id)
            self.emails = dict(student=student.email,lecturer=tutor.email,landlord=provider.email)
            room = Accommodation(landlord_id=provider.id,title="Market test room",campus="Main",area="Center",description="Room",is_available=True,is_approved=True,created_at=common['created_at'])
            db.add(room); db.commit(); self.room_id=room.id
        self.tokens = {role:getattr(main,"_issue_"+role+"_token")(self.ids[role]) for role in self.emails}

    def connect(self,role):
        header={"student":"X-Student-Token","lecturer":"X-Lecturer-Token","landlord":"X-Landlord-Token"}[role]
        response=self.client.post('/marketing/session',json={},headers={header:self.tokens[role]})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def market_headers(self,role):
        return {'X-Landlord-Token':self.connect(role)['market_token']}

    def send(self,headers,target,content="Hello"):
        return self.client.post('/marketing/provider/messages',headers=headers,json={'recipient_type':'landlord','recipient_id':target,'content':content})

    def test_universal_login_detects_each_role_and_preserves_native_token(self):
        for role in self.emails:
            with self.subTest(role=role):
                response=self.client.post('/marketing/login',json={'identifier':self.emails[role].upper(),'password':'Test-password-123'})
                self.assertEqual(response.status_code,200,response.text)
                result=response.json();self.assertEqual(result['role'],role)
                self.assertEqual(result['profile']['email'],self.emails[role])
                self.assertEqual(getattr(main,'_'+role+'_id_from_token')(result['token']),self.ids[role])
                self.assertIn('no-store',response.headers['cache-control'])
        username=self.client.post('/marketing/login',json={'identifier':self.prefix.lower(),'password':'Test-password-123'})
        self.assertEqual(username.json()['role'],'student')
        bad=self.client.post('/marketing/login',json={'identifier':self.emails['student'],'password':'wrong'})
        self.assertEqual(bad.status_code,401)

    def test_existing_sessions_connect_once_and_reject_missing_or_ambiguous_auth(self):
        for role in self.emails:
            first=self.connect(role);second=self.connect(role)
            self.assertEqual(first['profile']['id'],second['profile']['id'])
            self.assertEqual(first['token'],self.tokens[role])
        self.assertEqual(self.client.post('/marketing/session',json={}).status_code,401)
        self.assertEqual(self.client.post('/marketing/session',headers={'X-Student-Token':self.tokens['student'],'X-Lecturer-Token':self.tokens['lecturer']}).status_code,400)
        with main.SessionLocal() as db:
            self.assertEqual(db.query(Landlord).filter_by(linked_student_id=self.ids['student']).count(),1)

    def test_same_email_cannot_take_over_an_existing_advertiser(self):
        with main.SessionLocal() as db:
            provider=db.get(Landlord,self.ids['landlord']);provider.email=self.emails['student'];db.commit()
        linked=self.connect('student')
        self.assertNotEqual(linked['profile']['id'],self.ids['landlord'])
        self.assertEqual(self.client.get('/marketing/provider/messages',headers={'X-Landlord-Token':linked['market_token']}).json(),[])

    def test_disabled_source_revokes_issued_market_token(self):
        headers=self.market_headers('lecturer')
        with main.SessionLocal() as db:
            db.get(Lecturer,self.ids['lecturer']).active=False;db.commit()
        self.assertEqual(self.client.get('/marketing/provider/messages',headers=headers).status_code,403)
        response=self.client.post('/marketing/login',json={'identifier':self.emails['lecturer'],'password':'Test-password-123'})
        self.assertEqual(response.status_code,403)

    def test_all_roles_send_receive_and_read_only_their_market_conversations(self):
        provider_headers=self.market_headers('landlord')
        for role in ['student','lecturer']:
            headers=self.market_headers(role);profile=self.connect(role)['profile']
            sent=self.send(headers,self.ids['landlord'],role+' question')
            self.assertEqual(sent.status_code,200,sent.text)
            self.assertEqual(self.send(provider_headers,profile['id'],'Reply to '+role).status_code,200)
            inbox=self.client.get('/marketing/provider/messages',headers=headers).json()
            self.assertEqual(len(inbox),2)
            self.assertEqual({row['peer_id'] for row in inbox},{self.ids['landlord']})
            self.assertEqual(sum(row['is_outgoing'] for row in inbox),1)
            self.assertEqual(sum(row['unread'] for row in inbox),1)
            self.assertEqual(self.send(headers,profile['id']).status_code,400)
            read=self.client.post('/marketing/provider/messages/read',headers=headers,json={'target_type':'landlord','target_id':self.ids['landlord']})
            self.assertEqual(read.json()['read_count'],1)
        outsider={'X-Landlord-Token':main._issue_landlord_token(self.ids['other'])}
        self.assertEqual(self.client.get('/marketing/provider/messages',headers=outsider).json(),[])

    def test_legacy_market_history_remains_but_academic_messages_stay_out(self):
        with main.SessionLocal() as db:
            for sender_type,sender_id,recipient_type,recipient_id,content in [
                ('student',self.ids['student'],'landlord',self.ids['landlord'],'Legacy question'),
                ('lecturer',self.ids['lecturer'],'student',self.ids['student'],'Private lesson'),
                ('student',self.ids['student'],'landlord',self.ids['landlord'],'Anonymous question'),
            ]:
                db.add(DirectMessage(sender_type=sender_type,sender_id=sender_id,recipient_type=recipient_type,recipient_id=recipient_id,content=content,is_anonymous=content.startswith('Anonymous'),created_at='2026-11-01T00:00:00Z'))
            db.commit()
        headers=self.market_headers('student')
        rows=self.client.get('/marketing/provider/messages',headers=headers).json()
        self.assertEqual({row['content'] for row in rows},{'Legacy question','Anonymous question'})
        self.assertTrue(all(row['is_outgoing'] for row in rows))
        provider_rows=self.client.get('/marketing/provider/messages',headers=self.market_headers('landlord')).json()
        anon=next(row for row in provider_rows if row['is_anonymous'])
        self.assertIsNone(anon['peer_id']);self.assertIsNone(anon['sender_id'])
        self.assertNotIn('Learner',anon['peer_name'])
        legacy=next(row for row in provider_rows if not row['is_anonymous'])
        self.assertEqual(legacy['peer_id'],self.connect('student')['profile']['id'])

    def test_legacy_blocks_cannot_be_bypassed_using_market_identity(self):
        headers=self.market_headers('student')
        with main.SessionLocal() as db:
            db.add(DirectMessageBlock(blocker_type='landlord',blocker_id=self.ids['landlord'],blocked_type='student',blocked_id=self.ids['student'],created_at='2026-11-01T00:00:00Z'));db.commit()
        self.assertEqual(self.send(headers,self.ids['landlord']).status_code,403)

    def test_ratings_work_for_all_roles_and_keep_learner_rating_unique(self):
        path=f'/marketing/rooms/{self.room_id}/rating'
        original={'X-Student-Token':self.tokens['student']}
        self.assertEqual(self.client.put(path,headers=original,json={'stars':5}).json()['rating_count'],1)
        self.assertEqual(self.client.put(path,headers=self.market_headers('student'),json={'stars':3}).json()['rating_count'],1)
        self.assertEqual(self.client.put(path,headers=self.market_headers('lecturer'),json={'stars':4}).json()['rating_count'],2)
        other={'X-Landlord-Token':main._issue_landlord_token(self.ids['other'])}
        result=self.client.put(path,headers=other,json={'stars':5}).json()
        self.assertEqual((result['rating_count'],result['rating']),(3,4))
        self.assertEqual(self.client.put(path,headers=self.market_headers('landlord'),json={'stars':5}).status_code,403)
        self.assertEqual(self.client.put(path,json={'stars':5}).status_code,401)

    def test_linked_accounts_create_listings_and_manage_legacy_ads_without_other_owners(self):
        headers=self.market_headers('student')
        with main.SessionLocal() as db:
            advert=MarketAdvert(owner_student_id=self.ids['student'],business_name='Shop',headline='Legacy item',description='Item',category='Sales',status='approved',placement='feed',created_at='2026-11-01',updated_at='2026-11-01')
            db.add(advert);db.commit();item_id=advert.id
        rows=self.client.get('/marketing/my-adverts',headers=headers).json()
        self.assertIn(item_id,[row['id'] for row in rows])
        self.assertEqual(self.client.put(f'/marketing/adverts/{item_id}/pause',headers=headers).status_code,200)
        self.assertEqual(self.client.delete(f'/marketing/adverts/{item_id}',headers=self.market_headers('lecturer')).status_code,404)
        self.assertEqual(self.client.delete(f'/marketing/adverts/{item_id}',headers=headers).status_code,200)
        for role in ['student','lecturer']:
            response=self.client.post('/marketing/listings',headers=self.market_headers(role),data={'title':'New room','campus':'Main','area':'Center','description':'Room','contact':'0791112233'})
            self.assertEqual(response.status_code,200,response.text)

    def test_customer_can_message_agent_but_cannot_publish_and_agent_can_upload_photo(self):
        from unittest.mock import patch
        customer_email = self.prefix + "-customer@example.test"
        registered = self.client.post('/marketing/landlords/register', data={
            'full_name':'Market Customer', 'email':customer_email, 'provider_type':'customer',
            'password':'Test-password-123', 'confirm_password':'Test-password-123'})
        self.assertEqual(registered.status_code, 200, registered.text)
        customer = registered.json()['profile']
        self.assertEqual(customer['provider_type'], 'customer')
        customer_headers = {'X-Landlord-Token':registered.json()['token']}
        self.assertEqual(self.client.post('/marketing/listings', headers=customer_headers, data={
            'title':'Not allowed', 'campus':'Main', 'area':'Center', 'description':'Room', 'contact':'0791112233'}).status_code, 403)
        self.assertEqual(self.client.post('/marketing/adverts', headers=customer_headers, data={
            'business_name':'Shop', 'headline':'Item', 'description':'Item', 'category':'Sales', 'contact':'0791112233'}).status_code, 403)
        with patch.object(main, 'upload_image_bytes', return_value='https://example.test/agent.png'):
            updated = self.client.put('/marketing/landlords/me', headers={'X-Landlord-Token':self.tokens['landlord']},
                data={'full_name':'Market Agent', 'business_name':'Agent Office', 'phone':'0791112233'},
                files={'profile_image':('avatar.png', b'photo', 'image/png')})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()['profile']['profile_image_url'], 'https://example.test/agent.png')
        with main.SessionLocal() as db:
            agent = db.get(Landlord, self.ids['landlord'])
            agent.provider_type = 'agent'
            db.commit()
        sent = self.send(customer_headers, self.ids['landlord'], 'Is the room available?')
        self.assertEqual(sent.status_code, 200, sent.text)
        agent_headers = {'X-Landlord-Token':self.tokens['landlord']}
        inbox = self.client.get('/marketing/provider/messages', headers=agent_headers).json()
        self.assertTrue(any(row['peer_name'] == 'Market Customer' and row['content'] == 'Is the room available?' for row in inbox))
        reply = self.send(agent_headers, customer['id'], 'Yes, please arrange a viewing.')
        self.assertEqual(reply.status_code, 200, reply.text)
        self.assertTrue(any(row['content'] == 'Yes, please arrange a viewing.' for row in self.client.get('/marketing/provider/messages', headers=customer_headers).json()))
        login = self.client.post('/marketing/login', json={'identifier':customer_email, 'password':'Test-password-123'})
        self.assertEqual(login.status_code, 200, login.text)
        self.assertEqual(login.json()['profile']['provider_type'], 'customer')

    def test_signup_routes_existing_academic_accounts_back_to_universal_signin(self):
        response=self.client.post('/marketing/landlords/register',data={'full_name':'Same learner','email':self.emails['student'],'phone':'0791112233','password':'Test-password-123','confirm_password':'Test-password-123'})
        self.assertEqual(response.status_code,409,response.text)
        self.assertIn('Sign in',response.json()['detail'])


if __name__=='__main__':
    unittest.main()
