import os,tempfile,unittest
os.environ['DATABASE_URL']='sqlite:///'+tempfile.mktemp(suffix='.db').replace('\\','/')
os.environ['SMTP_HOST']=''
from fastapi.testclient import TestClient
import main
from models import Student,Lecturer,Landlord,DirectMessage
class ChatConversationsTest(unittest.TestCase):
 def setUp(self):
  self.client=TestClient(main.app)
  with main.SessionLocal() as db:
   common=dict(active=True,password_hash='unused',created_at='2026-11-03')
   a=Student(student_number=self._testMethodName,full_name='Learner',email=self._testMethodName+'@example.test',approved=True,profile_image_url='https://example.test/learner.png',**common)
   b=Lecturer(full_name='Tutor',email=self._testMethodName+'-tutor@example.test',approved=True,profile_image_url='https://example.test/tutor.png',**common)
   c=Landlord(full_name='Provider',email=self._testMethodName+'-provider@example.test',phone='0',profile_image_url='https://example.test/provider.png',**common)
   db.add_all([a,b,c]);db.commit();self.a,self.b,self.c=a.id,b.id,c.id
   rows=[DirectMessage(sender_type='lecturer',sender_id=b.id,recipient_type='student',recipient_id=a.id,content='One',created_at='2026-11-03T10:00:00Z'),DirectMessage(sender_type='admin',sender_id=None,recipient_type='student',recipient_id=a.id,content='Two',created_at='2026-11-03T11:00:00Z'),DirectMessage(sender_type='student',sender_id=a.id,recipient_type='lecturer',recipient_id=b.id,content='Anonymous',is_anonymous=True,created_at='2026-11-03T12:00:00Z')]
   db.add_all(rows);db.commit();self.messages=[r.id for r in rows]
  self.sh={'X-Student-Token':main._issue_student_token(self.a)};self.lh={'X-Lecturer-Token':main._issue_lecturer_token(self.b)}
 def test_list_is_unread_until_only_the_open_conversation_is_marked(self):
  rows=self.client.get('/student/messages',headers=self.sh).json()
  tutor=next(r for r in rows if r['id']==self.messages[0]);self.assertEqual(tutor['peer_name'],'Tutor');self.assertEqual(tutor['peer_image_url'],'https://example.test/tutor.png');self.assertFalse(tutor['is_outgoing']);self.assertTrue(tutor['unread'])
  self.assertEqual(self.client.get('/student/messages/unread',headers=self.sh).json()['count'],2)
  read=self.client.post('/student/messages/read',headers=self.sh,json={'message_ids':[self.messages[0],self.messages[2]]})
  self.assertEqual(read.json()['read_count'],1);self.assertEqual(self.client.get('/student/messages/unread',headers=self.sh).json()['count'],1)
 def test_anonymous_incoming_has_no_profile_or_contact_identity(self):
  row=next(r for r in self.client.get('/lecturer/messages',headers=self.lh).json() if r['id']==self.messages[2])
  self.assertIsNone(row['sender_id']);self.assertIsNone(row['peer_id']);self.assertIsNone(row['sender_image_url']);self.assertIsNone(row['peer_image_url']);self.assertEqual(row['peer_name'],'Anonymous student')
  read=self.client.post('/lecturer/messages/read',headers=self.lh,json={'message_ids':self.messages});self.assertEqual(read.json()['read_count'],1)
 def test_read_endpoint_auth_and_ownership_boundaries(self):
  self.assertEqual(self.client.post('/student/messages/read',json={'message_ids':self.messages}).status_code,401)
  with main.SessionLocal() as db:
   other=Student(student_number=self._testMethodName+'-other',full_name='Other',email=self._testMethodName+'-other@example.test',password_hash='unused',active=True,approved=True,created_at='2026-11-03');db.add(other);db.commit();headers={'X-Student-Token':main._issue_student_token(other.id)}
  self.assertEqual(self.client.post('/student/messages/read',headers=headers,json={'message_ids':self.messages}).json()['read_count'],0)
 def test_market_profile_and_direction_are_consistent(self):
  with main.SessionLocal() as db:
   row=DirectMessage(sender_type='student',sender_id=self.a,recipient_type='landlord',recipient_id=self.c,content='Hello provider',created_at='2026-11-03');db.add(row);db.commit();mid=row.id
  row=next(r for r in self.client.get('/marketing/provider/messages',headers={'X-Landlord-Token':main._issue_landlord_token(self.c)}).json() if r['id']==mid)
  self.assertEqual(row['peer_image_url'],'https://example.test/learner.png');self.assertEqual(row['peer_name'],'Learner');self.assertFalse(row['is_outgoing'])
 def test_admin_review_does_not_offer_a_false_personal_thread(self):
  with main.SessionLocal() as db:
   row=db.get(DirectMessage,self.messages[0]);data=main._message_dict(db,row,'admin',None);self.assertTrue(data['review_only']);self.assertFalse(data['unread']);self.assertIn('Tutor',data['peer_name']);self.assertIn('Learner',data['peer_name'])

 def test_market_read_items_supports_anonymous_and_respects_account_ownership(self):
  with main.SessionLocal() as db:
   row=DirectMessage(sender_type='student',sender_id=self.a,recipient_type='landlord',recipient_id=self.c,content='Anonymous market enquiry',is_anonymous=True,created_at='2026-11-03');db.add(row);db.commit();mid=row.id
  headers={'X-Landlord-Token':main._issue_landlord_token(self.c)}
  self.assertEqual(self.client.post('/marketing/provider/messages/read-items',json={'message_ids':[mid]}).status_code,401)
  response=self.client.post('/marketing/provider/messages/read-items',headers=headers,json={'message_ids':[mid]+self.messages})
  self.assertEqual(response.json()['read_count'],1)
  with main.SessionLocal() as db:
   self.assertIsNone(db.get(DirectMessage,self.messages[0]).read_at)

 def test_tutor_can_reply_to_admin_and_market_but_cannot_bypass_learner_module_access(self):
  for kind,person in [('admin',0),('landlord',self.c)]:
   response=self.client.post('/lecturer/messages',headers=self.lh,json={'recipient_type':kind,'recipient_id':person,'content':'Reply from tutor'})
   self.assertEqual(response.status_code,200,response.text)
  response=self.client.post('/lecturer/messages',headers=self.lh,json={'recipient_type':'student','recipient_id':self.a,'content':'Not assigned'})
  self.assertEqual(response.status_code,403)
