const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { apply: applyAction, settle, leaderboard, bestAttempt, WINDOW_MS } = require('../server/competition');
const { openStore } = require('../server/store');
const start = 1000000;
const apply = (s, msg, now) => applyAction(s, { teamId: s.currentTeamId, ...msg }, now);
function fresh() { return { teams: [1, 2].map(id => ({ id, name: `Team ${id}`, robotName: `Robot ${id}`, session: {}, attempts: [] })), currentTeamId: 1, nextTeamId: 3, view: 'live', winnerIds: [] }; }
function attempt(s, scores, duration = 10000, startedAt = start + 1000, completed = true) {
  apply(s, { type: 'START_ATTEMPT' }, startedAt);
  apply(s, { type: 'STOP_ATTEMPT' }, startedAt + duration);
  apply(s, { type: 'SAVE_ATTEMPT', scores, completed, revision: 0 }, startedAt + duration + 1);
}
test('optional calibration is separate, once only; run window never restarts', () => {
  const s = fresh();
  apply(s, { type: 'START_CALIBRATION' }, start);
  assert.equal(s.teams[0].session.calibrationEndsAt, start + 120000);
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start), /window/);
  assert.throws(() => apply(s, { type: 'START_CALIBRATION' }, start), /once/);
  apply(s, { type: 'START_SESSION' }, start + 30000);
  assert.equal(s.teams[0].session.runEndsAt, start + 30000 + WINDOW_MS);
  assert.throws(() => apply(s, { type: 'START_SESSION' }, start + 40000), /already/);
  assert.throws(() => apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + 40000), /active/);
});
test('four attempts counted on start; scores required before next run; invalid scores rejected', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  apply(s, { type: 'START_ATTEMPT' }, start + 1);
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start + 2), /score/);
  assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', scores: [1, 2, 3], completed: true, revision: 0 }, start + 2), /available/);
  apply(s, { type: 'STOP_ATTEMPT' }, start + 1000);
  for (const scores of [[1, 2], [1, 2, -1], [1, 2, NaN], ['1', 2, 3], [null, 2, 3]]) {
    assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', scores, completed: true, revision: 0 }, start + 1100), /three judges/);
  }
  apply(s, { type: 'SAVE_ATTEMPT', scores: [0, 0, 0], completed: false, revision: 0 }, start + 1100);
  assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', scores: [1, 2, 3], completed: true, revision: 0 }, start + 1200), /available/);
  for (let i = 1; i < 4; i++) attempt(s, [i, i, i], 1000, start + i * 5000);
  assert.equal(s.teams[0].attempts.length, 4);
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start + 25000), /four/);
});
test('expiry stops at deadline and preserves a pending score entry', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  apply(s, { type: 'START_ATTEMPT' }, start + WINDOW_MS - 2000);
  assert.equal(settle(s.teams, start + WINDOW_MS + 5000), true);
  const a = s.teams[0].attempts[0];
  assert.equal(a.time, 2000); assert.equal(a.completed, false); assert.equal(a.status, 'pending');
  apply(s, { type: 'SAVE_ATTEMPT', scores: [10, 20, 30], completed: false, revision: 0 }, start + WINDOW_MS + 6000);
  assert.equal(a.total, 60);
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start + WINDOW_MS + 6001), /time is up/);
});
test('highest combined score wins; faster lower-scoring attempts do not affect tie break', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  attempt(s, [10, 10, 10], 1000);
  attempt(s, [20, 20, 20], 20000, start + 40000);
  apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + WINDOW_MS + 1);
  apply(s, { type: 'START_SESSION' }, start + WINDOW_MS + 1);
  attempt(s, [20, 20, 20], 15000, start + WINDOW_MS + 1000);
  assert.equal(bestAttempt(s.teams[0]).time, 20000);
  assert.equal(leaderboard(s.teams)[0].id, 2);
  apply(s, { type: 'EDIT_ATTEMPT', number: 1, revision: 1, scores: [19, 20, 20], completed: true, time: 15000 }, start + WINDOW_MS + 20000);
  assert.equal(leaderboard(s.teams)[0].id, 1);
});
test('fastest at maximum score is selected; exact ties share first; incomplete time cannot win a tie', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  attempt(s, [1, 2, 3], 20000); attempt(s, [1, 2, 3], 10000, start + 40000);
  apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + WINDOW_MS + 1);
  apply(s, { type: 'START_SESSION' }, start + WINDOW_MS + 1);
  attempt(s, [1, 2, 3], 10000, start + WINDOW_MS + 1000);
  apply(s, { type: 'ANNOUNCE_WINNER' }, start + 2 * WINDOW_MS + 2);
  assert.deepEqual(s.winnerIds, [1, 2]);
  assert.equal(leaderboard(s.teams)[1].rank, 1);
  apply(s, { type: 'EDIT_ATTEMPT', number: 1, revision: 1, scores: [1, 2, 3], completed: false, time: 1000 }, start + 2 * WINDOW_MS + 3);
  assert.deepEqual(s.winnerIds, []); assert.equal(s.view, 'live');
  assert.equal(leaderboard(s.teams)[0].id, 1);
  assert.throws(() => apply(s, { type: 'EDIT_ATTEMPT', number: 1, revision: 1, scores: [1, 2, 3], completed: false, time: 1000 }), /another operator/i);
});
test('SQLite persists teams, all judge totals, session deadlines and selected display through reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itex-test-'));
  try {
    const file = path.join(dir, 'competition.sqlite'); let store = openStore(file); const s = store.load();
    s.currentTeamId = 1; apply(s, { type: 'START_SESSION' }, start); attempt(s, [3.5, 4.5, 5.5]);
    apply(s, { type: 'SET_VIEW', view: 'rules' }); store.save(s); store.db.close();
    assert.equal(fs.readFileSync(file).subarray(0, 15).toString(), 'SQLite format 3');
    store = openStore(file); assert.deepEqual(store.load(), s); store.db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
