const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const page = fs.readFileSync(path.join(__dirname, '../static/live_lesson.html'), 'utf8');
const recorderSource = page.slice(page.indexOf('function addRecordingAudioTrack('), page.indexOf('async function sendRecordingNotice('));
const leavingSource = page.slice(page.indexOf('async function readyToLeaveRecording('), page.indexOf('const savedMeeting='));

test('live session scripts remain valid JavaScript', () => {
  for (const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});

test('screen recording captures microphone and class audio as MP4, then downloads before stop completes', async () => {
  const mic = { id: 'recorder-mic', stop() {} };
  const remoteAudio = { id: 'learner-audio', stop() {} };
  const screen = { id: 'screen', stop() {}, getSettings: () => ({ width: 1920, height: 1080, displaySurface: 'monitor' }), addEventListener() {} };
  const mixed = [];
  const downloads = [];
  const classList = { add() {}, remove() {} };
  const elements = {
    recordingQuality: { value: 'balanced', disabled: false },
    microphoneSelect: { value: 'preferred-microphone' },
    recordSession: { classList, querySelector: () => ({ textContent: '' }), setAttribute() {} },
    recordingDownload: { classList, href: '', download: '' },
    deviceFeedback: { classList, textContent: '' },
  };
  class MediaStream {
    constructor(tracks) { this.tracks = tracks; }
  }
  class AudioContext {
    async resume() {}
    createMediaStreamDestination() { return { stream: { getAudioTracks: () => [{ id: 'mixed-audio' }] } }; }
    createMediaStreamSource(stream) { mixed.push(stream.tracks[0]); return { connect() {}, disconnect() {} }; }
    close() {}
  }
  class MediaRecorder {
    static isTypeSupported(type) { return type.startsWith('video/mp4'); }
    constructor(stream, options) { this.stream = stream; this.mimeType = options.mimeType; this.state = 'inactive'; MediaRecorder.last = this; }
    start() { this.state = 'recording'; }
    requestData() {}
    stop() { this.state = 'inactive'; setImmediate(() => { this.ondataavailable({ data: new Blob(['mp4-payload']) }); this.onstop(); }); }
  }
  const context = vm.createContext({
    MediaRecorder, MediaStream, AudioContext, Blob, Map, Date, setImmediate,
    navigator: { mediaDevices: { getDisplayMedia: async () => ({ getVideoTracks: () => [screen], getTracks: () => [screen] }), getUserMedia: async options => { assert.equal(options.audio.deviceId.ideal, 'preferred-microphone'); return { getAudioTracks: () => [mic], getTracks: () => [mic] }; } } },
    window: { MediaRecorder, addEventListener() {} },
    room: { remoteParticipants: new Map([['learner', { trackPublications: new Map([['audio', { track: { kind: 'audio', mediaStreamTrack: remoteAudio } }]]) }]]) },
    Track: { Kind: { Audio: 'audio' } },
    $: id => elements[id],
    confirm: () => true,
    document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) },
    URL: { createObjectURL: () => 'blob:test-mp4', revokeObjectURL() {} },
    roomCode: 'BIO101', recordingAudioTracks: new Map(),
    sessionRecorder: null, recordingCapture: null, recordingMicCapture: null, recordingChunks: [], recordingAudioContext: null, recordingDestination: null,
    recordingStopPromise: null, resolveRecordingStop: null, recordingDownloadUrl: null, recordingNeedsConfirmation: false,
  });
  vm.runInContext(recorderSource, context);
  await context.startSessionRecording();
  assert.equal(MediaRecorder.last.mimeType.startsWith('video/mp4'), true);
  assert.deepEqual(mixed, [mic, remoteAudio]);
  const laterAudio = { id: 'late-learner', stop() {} };
  context.addRecordingAudioTrack(laterAudio);
  assert.deepEqual(mixed, [mic, remoteAudio, laterAudio]);
  const stopped = await context.stopSessionRecording();
  assert.equal(stopped, true);
  assert.equal(downloads.length, 1);
  assert.match(downloads[0], /live-lesson-BIO101-.*\.mp4$/);
  assert.equal(context.recordingNeedsConfirmation, true);
  MediaRecorder.isTypeSupported = type => type.startsWith('video/webm');
  assert.equal(context.recordingMimeType(), '');
});

test('leaving stays in the meeting until the download starts and is confirmed', async () => {
  const status = { textContent: '' };
  const leaveLabel = { textContent: '' };
  let confirmed = false;
  let stops = 0;
  const context = vm.createContext({
    sessionRecorder: { state: 'recording' }, recordingStopPromise: null, recordingNeedsConfirmation: false,
    stopSessionRecording: async () => { stops++; context.sessionRecorder = null; context.recordingNeedsConfirmation = true; return true; },
    confirm: () => confirmed,
    $: id => id === 'deviceFeedback' ? status : ({ onclick: null, querySelector: () => leaveLabel }),
    document: { addEventListener() {} },
    copyRoomInvite() {}, roomCode: 'BIO101',
    location: { href: '' }, sessionStorage: { removeItem() {} }, clearTimeout() {}, reactionSocketRetry: null, reactionSocket: null,
    room: { disconnect: async () => {} }, role: 'lecturer',
  });
  vm.runInContext(leavingSource, context);
  assert.equal(await context.readyToLeaveRecording(), false);
  assert.equal(stops, 1);
  assert.match(status.textContent, /check your downloads/i);
  assert.equal(leaveLabel.textContent, 'Leave after download');
  assert.equal(await context.readyToLeaveRecording(), false);
  confirmed = true;
  assert.equal(await context.readyToLeaveRecording(), true);
});
