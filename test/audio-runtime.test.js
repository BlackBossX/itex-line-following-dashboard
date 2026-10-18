const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const cues = require('../public/audio-cues');
function setup() {
  const notes = [], handlers = {}, attributes = {}, classes = {};
  const button = { addEventListener: (name, handler) => { handlers[name] = handler; }, setAttribute: (name, value) => { attributes[name] = value; } };
  class Context {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; }
    async resume() { this.state = 'running'; }
    createOscillator() { let frequency; return { frequency: { setValueAtTime: value => { frequency = value; } }, connect() {}, disconnect() {}, start: () => notes.push(frequency), stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const window = { ITEXAudioCues: cues, AudioContext: Context };
  const document = { getElementById: () => button, visibilityState: 'visible', body: { classList: { toggle: (name, value) => { classes[name] = value; } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/sound.js'), 'utf8'), { window, document });
  return { sound: window.CompetitionSound, click: handlers.click, notes, button, attributes, classes, document };
}
function state() { return { currentTeamId: 1, teams: [{ id: 1, session: { runStartedAt: 1000, runEndsAt: 11000 }, attempts: [] }], serverTime: 1000 }; }
test('sound requires an explicit enable and countdown clicks play only once per second', async () => {
  const env = setup(); env.sound.onState(state()); env.sound.onClock(1000, true);
  assert.equal(env.notes.length, 0); assert.equal(env.classes['timer-warning'], true);
  await env.click(); assert.equal(env.attributes['aria-pressed'], 'true'); env.notes.length = 0;
  env.sound.onClock(2000, true); env.sound.onClock(2100, true); env.sound.onClock(2200, true);
  assert.deepEqual(env.notes, [1400]); env.sound.onClock(3000, true); assert.deepEqual(env.notes, [1400, 1400]);
});
test('pausing suppresses warning clicks; muted screens keep the visual warning', async () => {
  const env = setup(); await env.click(); const s = state(); env.sound.onState(s); env.sound.onClock(1000, true);
  const paused = structuredClone(s); paused.teams[0].session.runPausedAt = 2000; paused.serverTime = 2000;
  env.sound.onState(paused); env.notes.length = 0; env.sound.onClock(5000, true);
  assert.equal(env.notes.length, 0); assert.equal(env.classes['timer-warning'], false);
  await env.click(); env.sound.onState(s); env.notes.length = 0; env.sound.onClock(6000, true);
  assert.equal(env.notes.length, 0); assert.equal(env.classes['timer-warning'], true);
});
test('expiry plays one finish cue; hidden screens and disconnected screens stay quiet', async () => {
  const env = setup(); await env.click(); env.sound.onState(state()); env.sound.onClock(10000, true); env.notes.length = 0;
  env.sound.onClock(11000, true); env.sound.onClock(11100, true); assert.deepEqual(env.notes, [659.25, 523.25, 392]);
  env.notes.length = 0; env.document.visibilityState = 'hidden'; env.sound.onClock(6000, true); assert.equal(env.notes.length, 0);
  env.sound.onClock(6000, false); assert.equal(env.classes['timer-warning'], false);
});
