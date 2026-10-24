const test = require('node:test');
const assert = require('node:assert/strict');
const { timerInfo, transition } = require('../public/audio-cues');
const { apply } = require('../server/competition');
function fresh() { return { teams: [{ id: 1, name: 'Team', session: {}, attempts: [] }], currentTeamId: 1, serverTime: 1000, view: 'live', winnerIds: [] }; }
function change(state, type, at, extra = {}) { const next = structuredClone(state); apply(next, { type, teamId: 1, ...extra }, at); next.serverTime = at; return next; }
test('start, pause, resume and stop produce the corresponding short cue', () => {
  const initial = fresh(); const calibration = change(initial, 'START_CALIBRATION', 1000);
  assert.equal(transition(initial, calibration), 'start');
  const paused = change(calibration, 'PAUSE_CALIBRATION', 2000); assert.equal(transition(calibration, paused), 'pause');
  const resumed = change(paused, 'RESUME_CALIBRATION', 4000); assert.equal(transition(paused, resumed), 'start');
  const stopped = change(resumed, 'STOP_CALIBRATION', 5000); assert.equal(transition(resumed, stopped), 'stop');
  const window = change(stopped, 'START_SESSION', 6000); assert.equal(transition(stopped, window), 'start');
  const run = change(window, 'START_ATTEMPT', 7000); assert.equal(transition(window, run), 'start');
  const runPaused = change(run, 'PAUSE_SESSION', 8000); assert.equal(transition(run, runPaused), 'pause');
  const runResumed = change(runPaused, 'RESUME_SESSION', 9000); assert.equal(transition(runPaused, runResumed), 'start');
  const attemptStopped = change(runResumed, 'STOP_ATTEMPT', 10000); assert.equal(transition(runResumed, attemptStopped), 'stop');
  const ended = change(attemptStopped, 'END_SESSION', 11000); assert.equal(transition(attemptStopped, ended), 'stop');
});
test('countdown tracks the final ten seconds, freezes when paused, and retains its identity after resume', () => {
  const state = change(fresh(), 'START_SESSION', 1000);
  assert.equal(timerInfo(state, 591000).remaining, 10000);
  assert.equal(timerInfo(state, 601000).remaining, 0);
  const paused = change(state, 'PAUSE_SESSION', 593000);
  assert.equal(timerInfo(paused, 900000).remaining, 8000); assert.equal(timerInfo(paused, 900000).paused, true);
  const resumed = change(paused, 'RESUME_SESSION', 900000);
  assert.equal(timerInfo(resumed, 900000).remaining, 8000);
  assert.equal(timerInfo(paused, 900000).key, timerInfo(resumed, 900000).key);
});
test('team/reset changes and ordinary judging updates do not play action sounds', () => {
  const state = change(fresh(), 'START_SESSION', 1000);
  assert.equal(transition(state, structuredClone(state)), null);
  const reset = change(state, 'RESET_TEAM', 2000, { confirmed: true }); assert.equal(transition(state, reset), null);
  assert.notEqual(timerInfo(state, 2000)?.key, timerInfo(reset, 2000)?.key);
});

test('winner announcement plays once per announcement, including when no team is selected', () => {
  const before = fresh(); before.currentTeamId = null;
  const winner = { ...structuredClone(before), view: 'winner', winnerIds: [1], announcementVersion: 1 };
  assert.equal(transition(before, winner), 'winner');
  assert.equal(transition(winner, structuredClone(winner)), null);
  assert.equal(transition(winner, { ...winner, announcementVersion: 2 }), 'winner');
  assert.equal(transition(winner, { ...winner, view: 'live' }), null);
});
