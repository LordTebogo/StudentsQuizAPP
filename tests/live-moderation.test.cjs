const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync(require('node:path').join(__dirname, '../static/live_lesson.html'), 'utf8');
const moderation = page.slice(page.indexOf('function microphonePublication('), page.indexOf('function addRecordingAudioTrack('));

test('presenter mute becomes available again when an attendee turns their mic on', async () => {
  const button = { dataset: {}, disabled: false, textContent: 'Mute mic' };
  const publication = { source: 'microphone', trackSid: 'mic-1', isMuted: false };
  const participant = {
    identity: 'student-1', name: 'Student', trackPublications: new Map([['mic-1', publication]]),
    getTrackPublication: () => publication,
  };
  const status = { textContent: '' };
  const context = vm.createContext({
    Track: { Source: { Microphone: 'microphone' } },
    safeId: value => value,
    $: id => id === 'callStatus' ? status : { querySelector: () => button },
    roomCode: 'TEST', lecturerToken: 'test-token', FormData,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
  });
  vm.runInContext(moderation, context);

  await context.muteParticipant(participant, button);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Muted');

  publication.isMuted = true;
  context.syncModerationMute(participant);
  assert.equal(button.disabled, true);

  publication.isMuted = false;
  context.syncModerationMute(participant);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Mute mic');

  await context.muteParticipant(participant, button);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, 'Muted');
});
