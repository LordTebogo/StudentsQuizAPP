"""Message delivery, push opt-in, identity boundaries and private unread counts."""
import json
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

_database = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
_database.close()
os.environ["DATABASE_URL"] = "sqlite:///" + _database.name.replace("\\", "/")
os.environ["SMTP_HOST"] = ""
from fastapi.testclient import TestClient
import main
from models import DirectMessage, DirectMessageBlock, Landlord, Lecturer, MarketPushSubscription, PushSubscription, Student


class PushError(Exception):
    def __init__(self, status):
        self.response = SimpleNamespace(status_code=status)


class MarketNotificationsTest(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)
        self.enabled = self.enterContext(patch.object(main, "_push_enabled", return_value=True))
        self.push = self.enterContext(patch.object(main, "webpush"))
        self.enterContext(patch.object(main, "WebPushException", PushError))
        self.enterContext(patch.object(main, "VAPID_PRIVATE_KEY", "test-private"))
        with main.SessionLocal() as db:
            common = dict(password_hash="unused",active=True,created_at="2026-11-03")
            student = Student(student_number=str(id(self)),full_name="Learner",email=f"{id(self)}-student@example.test",approved=True,**common)
            lecturer = Lecturer(full_name="Tutor",email=f"{id(self)}-tutor@example.test",approved=True,**common)
            owner = Landlord(full_name="Advertiser",email=f"{id(self)}-owner@example.test",phone="0791112233",**common)
            other = Landlord(full_name="Other advertiser",email=f"{id(self)}-other@example.test",phone="0791112233",**common)
            db.add_all([student,lecturer,owner,other]);db.commit()
            self.student,self.lecturer,self.owner,self.other=student.id,lecturer.id,owner.id,other.id
        self.owner_headers={"X-Landlord-Token":main._issue_landlord_token(self.owner)}
        self.other_headers={"X-Landlord-Token":main._issue_landlord_token(self.other)}
        self.endpoint=f"https://fcm.googleapis.com/fcm/send/{id(self)}"
        self.payload={"endpoint":self.endpoint,"keys":{"p256dh":"test-public","auth":"test-auth"}}

    def subscribe(self,headers=None,payload=None):
        return self.client.post('/marketing/notifications/subscribe',headers=headers or self.owner_headers,json=payload or self.payload)

    def send(self,headers=None,target=None,recipient_type='landlord'):
        return self.client.post('/marketing/provider/messages',headers=headers or self.other_headers,json={"recipient_type":recipient_type,"recipient_id":target or self.owner,"content":"Private message text must not appear on the lock screen"})

    def test_advertiser_gets_push_when_another_account_sends_a_message(self):
        self.assertEqual(self.subscribe().status_code,200)
        response=self.send();self.assertEqual(response.status_code,200,response.text)
        self.push.assert_called_once()
        data=json.loads(self.push.call_args.kwargs['data'])
        self.assertEqual(data['url'],'/?messages=1')
        self.assertEqual(data['title'],'New Arounus message')
        self.assertNotIn('Private message text',data['body'])
        self.assertEqual(self.push.call_args.kwargs['subscription_info']['endpoint'],self.endpoint)

    def test_student_to_advertiser_message_sends_push_and_unread_stays_until_read(self):
        self.subscribe()
        response=self.client.post('/student/messages',headers={"X-Student-Token":main._issue_student_token(self.student)},json={"recipient_type":"landlord","recipient_id":self.owner,"content":"Is it available?"})
        self.assertEqual(response.status_code,200,response.text);self.push.assert_called_once()
        unread=self.client.get('/marketing/provider/messages/unread',headers=self.owner_headers)
        self.assertEqual(unread.json()['count'],1);self.assertIn('no-store',unread.headers['cache-control'])
        self.client.get('/marketing/provider/messages',headers=self.owner_headers)
        self.assertEqual(self.client.get('/marketing/provider/messages/unread',headers=self.owner_headers).json()['count'],1)
        self.client.post('/marketing/provider/messages/read',headers=self.owner_headers,json={"target_type":"student","target_id":self.student})
        self.assertEqual(self.client.get('/marketing/provider/messages/unread',headers=self.owner_headers).json()['count'],0)
        self.assertEqual(self.client.get('/marketing/provider/messages/unread',headers=self.other_headers).json()['count'],0)

    def test_linked_learner_and_tutor_accounts_get_market_alerts_without_duplicate_devices(self):
        for role,person in [('student',self.student),('lecturer',self.lecturer)]:
            native={f'X-{role.title()}-Token':getattr(main,f'_issue_{role}_token')(person)}
            connected=self.client.post('/marketing/session',headers=native,json={}).json()
            headers={'X-Landlord-Token':connected['market_token']}
            endpoint=self.endpoint+'-'+role
            payload={**self.payload,'endpoint':endpoint}
            self.assertEqual(self.subscribe(headers,payload).status_code,200)
            if role=='student':
                with main.SessionLocal() as db:
                    db.add(PushSubscription(student_id=person,endpoint=endpoint,subscription_json=json.dumps(payload),created_at='2026-11-03'));db.commit()
            self.push.reset_mock()
            self.assertEqual(self.send(target=person,recipient_type=role).status_code,200)
            self.push.assert_called_once()
            self.assertEqual(self.client.get('/marketing/provider/messages/unread',headers=headers).json()['count'],1)

    def test_sign_out_detaches_only_the_authenticated_accounts_device(self):
        self.subscribe()
        self.client.request('DELETE','/marketing/notifications/subscribe',headers=self.other_headers,json={'endpoint':self.endpoint})
        with main.SessionLocal() as db:self.assertIsNotNone(db.query(MarketPushSubscription).filter_by(endpoint=self.endpoint).first())
        self.client.request('DELETE','/marketing/notifications/subscribe',headers=self.owner_headers,json={'endpoint':self.endpoint})
        self.send();self.push.assert_not_called()

    def test_device_follows_the_new_account_and_cannot_keep_another_learners_binding(self):
        with main.SessionLocal() as db:
            db.add(PushSubscription(student_id=self.student,endpoint=self.endpoint,subscription_json=json.dumps(self.payload),created_at='2026-11-03'));db.commit()
        self.subscribe();self.subscribe(self.other_headers)
        with main.SessionLocal() as db:
            self.assertEqual(db.query(MarketPushSubscription).filter_by(endpoint=self.endpoint).one().landlord_id,self.other)
            self.assertIsNone(db.query(PushSubscription).filter_by(endpoint=self.endpoint).first())

    def test_expired_push_is_removed_and_temporary_failure_does_not_fail_message(self):
        self.subscribe();self.push.side_effect=PushError(410)
        self.assertEqual(self.send().status_code,200)
        with main.SessionLocal() as db:self.assertIsNone(db.query(MarketPushSubscription).filter_by(endpoint=self.endpoint).first())
        self.subscribe();self.push.side_effect=PushError(503)
        self.assertEqual(self.send().status_code,200)
        with main.SessionLocal() as db:self.assertIsNotNone(db.query(MarketPushSubscription).filter_by(endpoint=self.endpoint).first())
        self.push.side_effect=RuntimeError('Network down')
        self.assertEqual(self.send().status_code,200)

    def test_subscriptions_require_auth_and_real_push_service_endpoints(self):
        self.assertEqual(self.client.post('/marketing/notifications/subscribe',json=self.payload).status_code,401)
        for endpoint in ['https://127.0.0.1/','https://example.test/','http://fcm.googleapis.com/send/test','https://fcm.googleapis.com:8080/send/test']:
            self.assertEqual(self.subscribe(payload={**self.payload,'endpoint':endpoint}).status_code,422)
        self.enabled.return_value=False
        self.assertEqual(self.subscribe().status_code,503)

    def test_blocked_contacts_do_not_trigger_notifications(self):
        self.subscribe()
        with main.SessionLocal() as db:
            db.add(DirectMessageBlock(blocker_type='landlord',blocker_id=self.owner,blocked_type='landlord',blocked_id=self.other,created_at='2026-11-03'));db.commit()
        self.assertEqual(self.send().status_code,403);self.push.assert_not_called()


if __name__ == '__main__':
    unittest.main()
