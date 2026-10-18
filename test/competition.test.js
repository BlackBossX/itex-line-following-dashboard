const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { apply: applyAction, settle, leaderboard, bestAttempt, WINDOW_MS } = require('../server/competition');
const { openStore } = require('../server/store');
const start = 1000000;
const apply = (s, msg, now) => applyAction(s, { resetVersion: s.resetVersion || 0, generation: s.teams.find(t => t.id === s.currentTeamId)?.session.generation || 0, teamId: s.currentTeamId, ...msg }, now);
function fresh() { return { teams: [1, 2].map(id => ({ id, name: `Team ${id}`, robotName: `Robot ${id}`, session: {}, attempts: [] })), currentTeamId: 1, nextTeamId: 3, view: 'live', winnerIds: [] }; }
function attempt(s, scores, duration = 10000, startedAt = start + 1000, completed = true) {
  apply(s, { type: 'START_ATTEMPT' }, startedAt);
  apply(s, { type: 'STOP_ATTEMPT' }, startedAt + duration);
  apply(s, { type: 'SAVE_ATTEMPT', number: s.teams.find(t => t.id === s.currentTeamId).attempts.length, scores, completed, revision: 0 }, startedAt + duration + 1);
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
test('four attempts counted on start; concurrent runs and invalid scores rejected', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  apply(s, { type: 'START_ATTEMPT' }, start + 1);
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start + 2), /Stop/);
  assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', number: 1, scores: [1, 2, 3], completed: true, revision: 0 }, start + 2), /available/);
  apply(s, { type: 'STOP_ATTEMPT' }, start + 1000);
  for (const scores of [[1, 2], [1, 2, -1], [1, 2, NaN], ['1', 2, 3], [null, 2, 3]]) {
    assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', number: 1, scores, completed: true, revision: 0 }, start + 1100), /three judges/);
  }
  apply(s, { type: 'SAVE_ATTEMPT', number: 1, scores: [0, 0, 0], completed: false, revision: 0 }, start + 1100);
  assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', number: 1, scores: [1, 2, 3], completed: true, revision: 0 }, start + 1200), /available/);
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
  apply(s, { type: 'SAVE_ATTEMPT', number: 1, scores: [10, 20, 30], completed: false, revision: 0 }, start + WINDOW_MS + 6000);
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

test('all four times can be recorded before any scores, then scored in any order', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  for (let i = 1; i <= 4; i++) {
    apply(s, { type: 'START_ATTEMPT' }, start + i * 10000);
    apply(s, { type: 'STOP_ATTEMPT' }, start + i * 10000 + i * 1000);
  }
  assert.deepEqual(s.teams[0].attempts.map(a => a.status), Array(4).fill('pending'));
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start + 50000), /four/);
  for (const number of [3, 1, 4, 2]) apply(s, { type: 'SAVE_ATTEMPT', number, revision: 0, scores: [number, number, number], completed: true }, start + 60000);
  assert.deepEqual(s.teams[0].attempts.map(a => a.total), [103, 106, 109, 112]);
  assert.equal(bestAttempt(s.teams[0]).number, 4);
});
test('calibration pauses past its original deadline, resumes with remaining time, and can finish early', () => {
  const s = fresh(); apply(s, { type: 'START_CALIBRATION' }, start);
  apply(s, { type: 'PAUSE_CALIBRATION' }, start + 30000);
  assert.throws(() => apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + 300000), /active/);
  apply(s, { type: 'RESUME_CALIBRATION' }, start + 300000);
  assert.equal(s.teams[0].session.calibrationEndsAt, start + 390000);
  apply(s, { type: 'STOP_CALIBRATION' }, start + 310000);
  assert.equal(s.teams[0].session.calibrationEndsAt, start + 310000);
  apply(s, { type: 'START_SESSION' }, start + 320000);
  assert.equal(s.teams[0].session.runEndsAt, start + 920000);
});
test('pausing the window also freezes an active attempt; resume excludes paused time', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  apply(s, { type: 'START_ATTEMPT' }, start + 1000);
  apply(s, { type: 'PAUSE_SESSION' }, start + 6000);
  assert.equal(settle(s.teams, start + 900000), false);
  assert.throws(() => apply(s, { type: 'START_ATTEMPT' }, start + 900000), /Resume/);
  assert.throws(() => apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + 900000), /active/);
  apply(s, { type: 'RESUME_SESSION' }, start + 906000);
  assert.equal(s.teams[0].session.runEndsAt, start + 1500000);
  apply(s, { type: 'STOP_ATTEMPT' }, start + 911000);
  assert.equal(s.teams[0].attempts[0].time, 10000);
});
test('ending a paused window freezes at the pause, retains scores and permits selecting another team', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  apply(s, { type: 'START_ATTEMPT' }, start + 1000);
  apply(s, { type: 'PAUSE_SESSION' }, start + 6000);
  apply(s, { type: 'END_SESSION' }, start + 900000);
  assert.equal(s.teams[0].attempts[0].time, 5000);
  assert.equal(s.teams[0].attempts[0].completed, false);
  apply(s, { type: 'SAVE_ATTEMPT', number: 1, revision: 0, scores: [5, 6, 7], completed: false }, start + 900001);
  apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + 900002);
  assert.equal(s.currentTeamId, 2); assert.equal(s.teams[0].attempts[0].total, 18);
});
test('audience payload contains times and winner identities with no judge marks, totals or rankings', () => {
  const { publicState } = require('../server/public-state');
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start); attempt(s, [91, 92, 93]);
  const audience = publicState(s, start + 50000);
  assert.equal(audience.teams[0].attempts[0].time, 10000);
  assert.equal(audience.teams[0].attempts[0].status, 'stopped');
  assert.doesNotMatch(JSON.stringify(audience), /"(scores|judgeTotal|bonus|total|best|leaderboard|rank)"/);
});

test('team reset clears active and scored data, retains identity and other teams, and reopens calibration', () => {
  const s = fresh(); s.teams[0].name = 'Custom team';
  const other = structuredClone(s.teams[1]);
  apply(s, { type: 'START_SESSION' }, start); attempt(s, [10, 20, 30]);
  apply(s, { type: 'START_ATTEMPT' }, start + 50000);
  apply(s, { type: 'PAUSE_SESSION' }, start + 51000);
  s.winnerIds = [1]; s.view = 'winner';
  assert.throws(() => apply(s, { type: 'RESET_TEAM' }, start + 52000), /Confirm/);
  apply(s, { type: 'RESET_TEAM', confirmed: true }, start + 52000);
  assert.equal(s.currentTeamId, 1); assert.equal(s.teams[0].name, 'Custom team');
  assert.deepEqual(s.teams[0].attempts, []); assert.deepEqual(s.teams[0].session, { generation: 1 });
  assert.deepEqual(s.teams[1], other); assert.deepEqual(s.winnerIds, []); assert.equal(s.view, 'live');
  assert.deepEqual(leaderboard(s.teams), []);
  apply(s, { type: 'START_CALIBRATION' }, start + 53000);
  apply(s, { type: 'START_SESSION' }, start + 54000);
  apply(s, { type: 'START_ATTEMPT' }, start + 55000);
  apply(s, { type: 'STOP_ATTEMPT' }, start + 56000);
  assert.throws(() => apply(s, { type: 'SAVE_ATTEMPT', generation: 0, number: 1, revision: 0, scores: [100, 100, 100], completed: true }, start + 57000), /team was reset/);
});
test('competition reset requires explicit phrase; retains roster by default and invalidates stale actions', () => {
  const s = fresh(); s.teams[0].name = 'Custom team';
  apply(s, { type: 'START_SESSION' }, start); attempt(s, [10, 20, 30]); s.winnerIds = [1]; s.view = 'winner';
  assert.throws(() => apply(s, { type: 'RESET_ALL', confirmation: 'reset all', resetRoster: false }), /Type RESET ALL/);
  apply(s, { type: 'RESET_ALL', confirmation: 'RESET ALL', resetRoster: false }, start + 50000);
  assert.equal(s.teams.length, 2); assert.equal(s.teams[0].name, 'Custom team'); assert.equal(s.nextTeamId, 3);
  assert.ok(s.teams.every(t => t.attempts.length === 0 && !t.session.runEndsAt));
  assert.equal(s.currentTeamId, null); assert.equal(s.view, 'live'); assert.deepEqual(s.winnerIds, []);
  assert.throws(() => apply(s, { type: 'SET_CURRENT_TEAM', id: 1, resetVersion: 0 }), /Competition data was reset/);
  apply(s, { type: 'SET_CURRENT_TEAM', id: 1 });
  apply(s, { type: 'START_CALIBRATION' }, start + 51000);
});
test('full reset restores default teams and IDs and survives SQLite reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itex-reset-'));
  try {
    const filename = path.join(dir, 'event.sqlite'); let store = openStore(filename); const s = store.load();
    s.teams[0].name = 'Renamed'; apply(s, { type: 'ADD_TEAM', name: 'Extra team', robotName: 'Custom robot' });
    apply(s, { type: 'RESET_ALL', confirmation: 'RESET ALL', resetRoster: true });
    assert.equal(s.teams.length, 5); assert.equal(s.teams[0].name, 'Team 1'); assert.equal(s.nextTeamId, 6);
    store.save(s); store.db.close(); store = openStore(filename); assert.deepEqual(store.load(), s); store.db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('winner can be announced after any number of scored teams without waiting for the roster', () => {
  const { initialState } = require('../server/competition');
  for (const count of [1, 5, 10]) {
    const s = initialState();
    while (s.teams.length <= count) apply(s, { type: 'ADD_TEAM', name: `Extra ${s.nextTeamId}` });
    const rosterSize = s.teams.length;
    for (let i = 0; i < count; i++) {
      s.teams[i].attempts = [{ number: 1, status: 'scored', scores: [i + 1, i + 1, i + 1], total: (i + 1) * 3, time: 10000, completed: true }];
    }
    s.currentTeamId = count + 1;
    apply(s, { type: 'START_SESSION' }, start);
    apply(s, { type: 'START_ATTEMPT' }, start + 1000);
    apply(s, { type: 'ANNOUNCE_WINNER' }, start + 2000);
    assert.deepEqual(s.winnerIds, [count]);
    assert.equal(s.view, 'winner');
    assert.equal(s.teams[count].attempts[0].status, 'running');
    assert.equal(s.teams.length, rosterSize);
  }
});
test('announcing ignores pending attempts but keeps the best saved score and rejects an empty result', () => {
  const s = fresh();
  assert.throws(() => apply(s, { type: 'ANNOUNCE_WINNER' }, start), /at least one/);
  apply(s, { type: 'START_SESSION' }, start);
  attempt(s, [10, 20, 30]);
  apply(s, { type: 'START_ATTEMPT' }, start + 50000);
  apply(s, { type: 'STOP_ATTEMPT' }, start + 51000);
  apply(s, { type: 'ANNOUNCE_WINNER' }, start + 52000);
  assert.deepEqual(s.winnerIds, [1]);
  assert.equal(s.teams[0].attempts[1].scores, null);
});

test('full completion adds exactly one 100-mark bonus and corrections can remove or reapply it', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  apply(s, { type: 'START_ATTEMPT' }, start + 1000); apply(s, { type: 'STOP_ATTEMPT' }, start + 11000);
  assert.equal(s.teams[0].attempts[0].completed, false, 'Stopping alone must not award completion');
  apply(s, { type: 'SAVE_ATTEMPT', number: 1, revision: 0, scores: [20, 30, 40], completed: true }, start + 12000);
  const a = s.teams[0].attempts[0];
  assert.equal(a.judgeTotal, 90); assert.equal(a.bonus, 100); assert.equal(a.total, 190);
  apply(s, { type: 'EDIT_ATTEMPT', number: 1, revision: 1, scores: [20, 30, 40], completed: true, time: 10000 }, start + 13000);
  assert.equal(a.total, 190, 'Saving again must not stack the bonus');
  apply(s, { type: 'EDIT_ATTEMPT', number: 1, revision: 2, scores: [20, 30, 40], completed: false, time: 10000 }, start + 14000);
  assert.equal(a.bonus, 0); assert.equal(a.total, 90);
  apply(s, { type: 'EDIT_ATTEMPT', number: 1, revision: 3, scores: [20, 30, 40], completed: true, time: 10000 }, start + 15000);
  assert.equal(a.total, 190);
});
test('ranking includes completion bonus, while incomplete runs retain only judge totals', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start); attempt(s, [10, 10, 10]);
  apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + WINDOW_MS + 1);
  apply(s, { type: 'START_SESSION' }, start + WINDOW_MS + 2);
  attempt(s, [40, 40, 40], 10000, start + WINDOW_MS + 1000, false);
  assert.equal(s.teams[1].attempts[0].bonus, 0);
  assert.equal(leaderboard(s.teams)[0].id, 1);
  assert.equal(leaderboard(s.teams)[0].best.total, 130);
});
test('older saved completed attempts gain bonus once on reload and stale winners are cleared', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itex-bonus-'));
  try {
    const file = path.join(dir, 'event.sqlite'); let store = openStore(file); const s = store.load();
    s.teams[0].attempts = [{ number: 1, status: 'scored', scores: [10, 20, 30], completed: true, total: 60, revision: 1, time: 10000 }];
    s.teams[1].attempts = [{ number: 1, status: 'scored', scores: [20, 30, 40], completed: false, total: 90, revision: 1, time: 5000 }];
    s.winnerIds = [2]; s.view = 'winner'; store.save(s); store.db.close();
    store = openStore(file); const migrated = store.load();
    assert.equal(migrated.teams[0].attempts[0].bonus, 100); assert.equal(migrated.teams[0].attempts[0].total, 160);
    assert.equal(migrated.teams[1].attempts[0].bonus, 0); assert.equal(migrated.teams[1].attempts[0].total, 90);
    assert.deepEqual(migrated.winnerIds, []); assert.equal(migrated.view, 'live');
    assert.equal(leaderboard(migrated.teams)[0].id, 1); store.db.close();
    store = openStore(file); assert.deepEqual(store.load(), migrated); store.db.close();
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('five default teams; names can be added and edited without a robot name', () => {
  const { initialState } = require('../server/competition');
  const s = initialState(); assert.equal(s.teams.length, 5);
  apply(s, { type: 'ADD_TEAM', name: 'Track crew' });
  s.currentTeamId = 6; apply(s, { type: 'UPDATE_TEAM', name: 'Track crew revised' });
  assert.equal(s.teams[5].name, 'Track crew revised');
});
test('shuffle keeps identities and selection, persists order, rejects stale draws and locks after calibration', () => {
  const { initialState } = require('../server/competition');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itex-order-'));
  let store;
  try {
    store = openStore(path.join(dir, 'event.sqlite'));
    const s = initialState(); s.currentTeamId = 3;
    const original = new Map(s.teams.map(t => [t.id, structuredClone(t)]));
    apply(s, { type: 'SHUFFLE_TEAMS', rosterVersion: 0 }, start);
    assert.deepEqual(s.teams.map(t => t.id).sort(), [1,2,3,4,5]);
    s.teams.forEach(t => assert.deepEqual(t, original.get(t.id)));
    assert.equal(s.currentTeamId, 3); assert.equal(s.shuffledAt, start);
    assert.throws(() => apply(s, { type: 'SHUFFLE_TEAMS', rosterVersion: 0 }, start + 1), /roster changed/);
    // Persist a deliberately non-ID order, regardless of the random draw.
    s.teams = [s.teams.find(t => t.id === 5), ...s.teams.filter(t => t.id !== 5)];
    store.save(s); store.db.close(); store = openStore(path.join(dir, 'event.sqlite'));
    assert.deepEqual(store.load(), s);
    apply(s, { type: 'START_CALIBRATION' }, start + 100);
    assert.throws(() => apply(s, { type: 'SHUFFLE_TEAMS', rosterVersion: 1 }, start + 101), /before calibration/);
  } finally { store?.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('coordinator corrects a different team without switching or interrupting the active run; stale corrections rejected', () => {
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start); attempt(s, [10,20,30]);
  apply(s, { type: 'END_SESSION' }, start + 20000);
  apply(s, { type: 'SET_CURRENT_TEAM', id: 2 }, start + 21000);
  apply(s, { type: 'START_SESSION' }, start + 22000); apply(s, { type: 'START_ATTEMPT' }, start + 23000);
  const active = structuredClone(s.teams[1]);
  const correction = { type: 'EDIT_ATTEMPT', teamId: 1, revision: 1, number: 1, scores: [90,80,70], completed: false, time: 5000 };
  applyAction(s, correction, start + 24000, true);
  assert.equal(s.currentTeamId, 2); assert.deepEqual(s.teams[1], active);
  assert.equal(s.teams[0].attempts[0].total, 240);
  assert.throws(() => applyAction(s, correction, start + 25000, true), /Another operator/);
  assert.throws(() => applyAction(s, { type: 'START_ATTEMPT', teamId: 1 }, start + 25000, true), /competition control/);
  assert.throws(() => applyAction(s, { ...correction, revision: 2, generation: 8 }, start + 25000, true), /reset/);
});
test('legacy roster migration reduces only untouched defaults and retains entered event data', () => {
  const { initialState } = require('../server/competition');
  for (const edited of [false, true]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'itex-legacy-')); let store;
    try {
      store = openStore(path.join(dir, 'event.sqlite'));
      const s = initialState(); s.teams = Array.from({ length: 32 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, robotName: `Robot ${i + 1}`, session: {}, attempts: [] })); s.nextTeamId = 33;
      if (edited) s.teams[0].name = 'Entered team';
      store.save(s); store.db.close(); store = openStore(path.join(dir, 'event.sqlite'));
      assert.equal(store.load().teams.length, edited ? 32 : 5);
      if (edited) assert.equal(store.load().teams[0].name, 'Entered team');
    } finally { store?.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('coordinator edits unlock only after all rounds finish and all judges marks are saved', () => {
  const { reviewReady } = require('../server/competition');
  const s = fresh();
  const correction = { type: 'EDIT_ATTEMPT', teamId: 1, number: 1, revision: 1, scores: [7,8,9], completed: false, time: 1000 };
  assert.equal(reviewReady(s.teams[0], start), false);
  apply(s, { type: 'START_SESSION' }, start); attempt(s, [1,2,3]);
  assert.throws(() => applyAction(s, correction, start + 20000, true), /unlocks/);
  apply(s, { type: 'PAUSE_SESSION' }, start + 21000);
  assert.throws(() => applyAction(s, correction, start + WINDOW_MS + 1, true), /unlocks/);
  apply(s, { type: 'RESUME_SESSION' }, start + 22000);
  apply(s, { type: 'START_ATTEMPT' }, start + 23000);
  assert.throws(() => applyAction(s, correction, start + 24000, true), /unlocks/);
  apply(s, { type: 'STOP_ATTEMPT' }, start + 25000); apply(s, { type: 'END_SESSION' }, start + 26000);
  assert.throws(() => applyAction(s, correction, start + 27000, true), /unlocks/);
  assert.throws(() => applyAction(s, { ...correction, type: 'SAVE_ATTEMPT', number: 2, revision: 0 }, start + 27000, true), /competition control/);
  apply(s, { type: 'SAVE_ATTEMPT', number: 2, revision: 0, scores: [4,5,6], completed: false }, start + 28000);
  applyAction(s, correction, start + 29000, true);
  assert.equal(s.teams[0].attempts[0].total, 24);
});
test('coordinator review unlocks after four marked attempts or expiry, and reset locks it again', () => {
  const { reviewReady } = require('../server/competition');
  const s = fresh(); apply(s, { type: 'START_SESSION' }, start);
  for (let i = 0; i < 4; i++) attempt(s, [i,i,i], 1000, start + 1000 + i * 4000);
  assert.equal(reviewReady(s.teams[0], start + 20000), true);
  apply(s, { type: 'RESET_TEAM', confirmed: true }, start + 21000);
  assert.equal(reviewReady(s.teams[0], start + 22000), false);
  apply(s, { type: 'START_SESSION' }, start + 23000); attempt(s, [1,2,3], 1000, start + 24000);
  assert.equal(reviewReady(s.teams[0], start + 23000 + WINDOW_MS), true);
});
