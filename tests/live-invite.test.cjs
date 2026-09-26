const test = require('node:test');
const assert = require('node:assert/strict');
const invite = require('../static/live-invite.js');

const origin = 'https://bioscientistapp.com';

test('a classroom invitation survives sign in', () => {
  const live = new URL(invite.shareUrl(origin, 'bio101-live'));
  assert.equal(live.pathname + live.search, '/live?room=BIO101-LIVE');
  const signIn = new URL(invite.loginUrl(live), origin);
  assert.equal(signIn.searchParams.get('role'), 'learner');
  assert.equal(signIn.searchParams.get('next'), '/live?room=BIO101-LIVE');
  assert.equal(invite.postLoginUrl(signIn), '/live?room=BIO101-LIVE');
});

test('sign in ignores unrelated or external destinations', () => {
  for (const next of ['https://example.com/live?room=BIO101', '//example.com/live?room=BIO101', '/admin', '/live?room=bad code']) {
    const signIn = new URL(`${origin}/static/index.html?next=${encodeURIComponent(next)}`);
    assert.equal(invite.postLoginUrl(signIn), '/static/student.html');
  }
  assert.equal(invite.shareUrl(origin, 'a b'), '');
});
