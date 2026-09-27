const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const page = fs.readFileSync(require('node:path').join(__dirname, '../static/live_lesson.html'), 'utf8');
const moderation = page.slice(page.indexOf('function microphonePublication('), page.indexOf('function addRecordingAudioTrack('));

test('presenter mute becomes available again when an attendee turns their mic on', async () => {
  const button = { dataset: {}, disabled: false, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } };
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
  assert.equal(button.title, 'Muted by presenter');
  assert.match(button.innerHTML, /M3 3l18 18/);

  publication.isMuted = true;
  context.syncModerationMute(participant);
  assert.equal(button.disabled, true);

  publication.isMuted = false;
  context.syncModerationMute(participant);
  assert.equal(button.disabled, false);
  assert.match(button.title, /Mute Student/);
  assert.doesNotMatch(button.innerHTML, /M3 3l18 18/);

  await context.muteParticipant(participant, button);
  assert.equal(button.disabled, true);
  assert.equal(button.title, 'Muted by presenter');
});

test('attendee mic icon reflects a presenter mute and their own unmute', () => {
  const icon = { innerHTML: '' };
  const button = { attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, querySelector: () => icon };
  const publication = { source: 'microphone', isMuted: false };
  const participant = {
    identity: 'student-1', isMicrophoneEnabled: true,
    trackPublications: new Map([['mic-1', publication]]), getTrackPublication: () => publication,
  };
  const context = vm.createContext({
    Track: { Source: { Microphone: 'microphone' } },
    room: { localParticipant: participant },
    $: () => button,
    setControlState: (id, label, off) => { button.off = off; },
  });
  vm.runInContext(moderation, context);

  context.syncLocalMicControl();
  assert.equal(button.off, false);
  publication.isMuted = true;
  context.syncLocalMicControl();
  assert.equal(button.off, true);
  assert.match(icon.innerHTML, /M3 3l18 18/);
  publication.isMuted = false;
  context.syncLocalMicControl();
  assert.equal(button.off, false);
  assert.doesNotMatch(icon.innerHTML, /M3 3l18 18/);
});
