const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'itex-integration-'));
let child;
async function start() {
  child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: '3003', DB_PATH: path.join(temp, 'event.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`Server exited ${code}`))); });
}
async function stop() { if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }); }
async function client(role = 'admin') {
  const ws = new WebSocket(`ws://localhost:3003/?role=${role}`);
  await new Promise((resolve, reject) => { ws.once('message', data => { ws.initialState = JSON.parse(data).state; resolve(); }); ws.once('error', reject); });
  return ws;
}
function send(ws, type, payload = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No action response')), 3000);
    const listener = data => { const m = JSON.parse(data); if (m.type === 'ERROR' || m.type === 'SUCCESS') { clearTimeout(timer); ws.off('message', listener); resolve(m); } };
    ws.on('message', listener); ws.send(JSON.stringify({ type, ...payload }));
  });
}
async function state() { return (await fetch('http://localhost:3003/api/state')).json(); }
(async () => {
  try {
    await start(); let ws = await client();
    assert.equal((await state()).teams.length, 5);
    const coordinator = await client('coordinator');
    const coordinatorUpdate = new Promise(resolve => coordinator.on('message', raw => { const msg = JSON.parse(raw); if (msg.type === 'FULL_STATE' && msg.state.shuffledAt) resolve(msg.state); }));
    assert.equal((await send(ws, 'SHUFFLE_TEAMS', { rosterVersion: 0 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'SET_VIEW', { view: 'teams' })).type, 'SUCCESS');
    assert.deepEqual((await coordinatorUpdate).teams.map(t => t.id), (await state()).teams.map(t => t.id));
    const drawDisplay = await client('display');
    assert.equal(drawDisplay.initialState.view, 'teams');
    assert.doesNotMatch(JSON.stringify(drawDisplay.initialState), /"(scores|judgeTotal|bonus|total|best|leaderboard|rank)"/);
    assert.equal((await send(drawDisplay, 'SET_VIEW', { view: 'live' })).type, 'ERROR');
    assert.equal((await send(drawDisplay, 'SHUFFLE_TEAMS', { rosterVersion: 1 })).type, 'SUCCESS');
    const ordered = await state();
    drawDisplay.close();
    assert.equal((await send(coordinator, 'SET_CURRENT_TEAM', { id: 1 })).type, 'ERROR');
    coordinator.close();
    ws.close(); await stop(); await start(); ws = await client();
    assert.deepEqual((await state()).teams.map(t => t.id), ordered.teams.map(t => t.id));
    assert.equal((await send(ws, 'SET_CURRENT_TEAM', { id: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'START_SESSION', { teamId: 2 })).type, 'ERROR');
    assert.equal((await send(ws, 'START_SESSION', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'START_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'STOP_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'SAVE_ATTEMPT', { teamId: 1, number: 1, revision: 0, scores: [40, 50, 60], completed: true })).type, 'SUCCESS');
    assert.equal((await send(ws, 'SET_VIEW', { view: 'teams' })).type, 'SUCCESS');
    const lockedDisplay = await client('display');
    assert.equal((await send(lockedDisplay, 'SHUFFLE_TEAMS', { rosterVersion: 2 })).type, 'ERROR');
    lockedDisplay.close();
    const recorded = await state(); assert.equal(recorded.leaderboard[0].best.total, 250);
    const rankingsDisplay = await client('display');
    const rankingsUpdate = new Promise(resolve => {
      const listener = raw => { const msg = JSON.parse(raw); if (msg.type === 'FULL_STATE' && msg.state.view === 'rankings') { rankingsDisplay.off('message', listener); resolve(msg.state); } };
      rankingsDisplay.on('message', listener);
    });
    assert.equal((await send(ws, 'SET_VIEW', { view: 'rankings' })).type, 'SUCCESS');
    const publishedRankings = await rankingsUpdate;
    assert.equal(publishedRankings.leaderboard[0].best.total, 250);
    assert.equal(publishedRankings.leaderboard[0].rank, 1);
    assert.doesNotMatch(JSON.stringify(publishedRankings), /"(scores|judgeTotal|bonus)"/);
    assert.equal((await send(rankingsDisplay, 'SET_VIEW', { view: 'live' })).type, 'ERROR');
    rankingsDisplay.close();

    assert.equal((await send(ws, 'SAVE_ATTEMPT', { teamId: 1, number: 1, revision: 0, scores: [99, 99, 99], completed: true })).type, 'ERROR');
    assert.equal((await send(ws, 'ANNOUNCE_WINNER')).type, 'SUCCESS');
    assert.deepEqual((await state()).winnerIds, [1]);
    assert.ok((await state()).teams.find(t => t.id === 1).session.runEndsAt > Date.now());
    assert.equal((await send(ws, 'SET_VIEW', { view: 'rules' })).type, 'SUCCESS');
    const readonly = await client('display'); assert.doesNotMatch(JSON.stringify(readonly.initialState), /"(scores|judgeTotal|bonus|total|best|leaderboard|rank)"/); assert.equal((await send(readonly, 'ADD_TEAM', { name: 'Forbidden', robotName: '' })).type, 'ERROR'); readonly.close();
    for (const route of ['/admin', '/coordinator', '/display', '/rules', '/assets/competition-map.jpg', '/api/export']) {
      const response = await fetch(`http://localhost:3003${route}`); assert.equal(response.status, 200, route);
    }
    ws.close(); await stop(); await start();
    const recovered = await state(); assert.equal(recovered.view, 'rules'); assert.equal(recovered.currentTeamId, 1);
    assert.deepEqual(recovered.teams, recorded.teams); assert.equal(recovered.leaderboard[0].best.total, 250);
    ws = await client(); assert.equal((await send(ws, 'EDIT_ATTEMPT', { teamId: 1, number: 1, revision: 1, scores: [1, 2, 3], time: 1, completed: false })).type, 'SUCCESS');
    assert.equal((await state()).leaderboard[0].best.total, 6);
    const reviewer = await client('coordinator');
    assert.equal((await send(reviewer, 'EDIT_ATTEMPT', { teamId: 1, number: 1, revision: 2, scores: [2, 2, 2], time: 1, completed: false })).type, 'ERROR');
    assert.equal((await state()).teams.find(t => t.id === 1).attempts[0].total, 6);
    reviewer.close();
    assert.equal((await send(ws, 'START_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'PAUSE_SESSION', { teamId: 1 })).type, 'SUCCESS');
    const inProgress = (await state()).teams.find(t => t.id === 1);
    ws.close(); await stop(); await start();
    assert.deepEqual((await state()).teams.find(t => t.id === 1), inProgress);
    ws = await client();
    assert.equal((await send(ws, 'RESUME_SESSION', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'STOP_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await state()).teams.find(t => t.id === 1).attempts[1].status, 'pending');
    const finalReviewer = await client('coordinator');
    assert.equal((await send(ws, 'END_SESSION', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(finalReviewer, 'EDIT_ATTEMPT', { teamId: 1, number: 1, revision: 2, scores: [90,90,90], time: 1, completed: false })).type, 'ERROR');
    assert.equal((await send(finalReviewer, 'SAVE_ATTEMPT', { teamId: 1, number: 2, revision: 0, scores: [1,2,3], completed: false })).type, 'ERROR');
    assert.equal((await send(ws, 'SAVE_ATTEMPT', { teamId: 1, number: 2, revision: 0, scores: [1,2,3], completed: false })).type, 'SUCCESS');
    assert.equal((await send(finalReviewer, 'EDIT_ATTEMPT', { teamId: 1, number: 1, revision: 2, scores: [90,90,90], time: 1, completed: false })).type, 'SUCCESS');
    assert.equal((await send(finalReviewer, 'EDIT_ATTEMPT', { teamId: 1, number: 1, revision: 2, scores: [0,0,0], time: 1, completed: false })).type, 'ERROR');
    finalReviewer.close();
    assert.equal((await send(ws, 'RESET_TEAM', { teamId: 1, confirmed: true })).type, 'SUCCESS');
    assert.equal((await state()).teams.find(t => t.id === 1).attempts.length, 0);
    assert.equal((await send(ws, 'START_CALIBRATION', { teamId: 1 })).type, 'ERROR');
    assert.equal((await send(ws, 'START_CALIBRATION', { teamId: 1, generation: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'RESET_ALL', { confirmation: 'RESET ALL', resetRoster: true })).type, 'SUCCESS');
    ws.close(); await stop(); await start();
    const reset = await state(); assert.equal(reset.currentTeamId, null); assert.equal(reset.resetVersion, 1);
    assert.equal(reset.teams.length, 5); assert.equal(reset.leaderboard.length, 0);
    assert.ok(reset.teams.every(t => !t.attempts.length && !t.session.runEndsAt && !t.session.calibrationEndsAt));
    console.log('Integration passed: real WebSocket judging, stale-team rejection, display read-only, routes, export, SQLite restart and corrections.');
  } finally { await stop(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
