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
  await new Promise((resolve, reject) => { ws.once('message', resolve); ws.once('error', reject); });
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
    assert.equal((await state()).teams.length, 32);
    assert.equal((await send(ws, 'SET_CURRENT_TEAM', { id: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'START_SESSION', { teamId: 2 })).type, 'ERROR');
    assert.equal((await send(ws, 'START_SESSION', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'START_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'STOP_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await send(ws, 'SAVE_ATTEMPT', { teamId: 1, revision: 0, scores: [40, 50, 60], completed: true })).type, 'SUCCESS');
    const recorded = await state(); assert.equal(recorded.leaderboard[0].best.total, 150);
    assert.equal((await send(ws, 'SAVE_ATTEMPT', { teamId: 1, revision: 0, scores: [99, 99, 99], completed: true })).type, 'ERROR');
    assert.equal((await send(ws, 'SET_VIEW', { view: 'rules' })).type, 'SUCCESS');
    const readonly = await client('display'); assert.equal((await send(readonly, 'ADD_TEAM', { name: 'Forbidden', robotName: '' })).type, 'ERROR'); readonly.close();
    for (const route of ['/admin', '/display', '/rules', '/assets/competition-map.jpg', '/api/export']) {
      const response = await fetch(`http://localhost:3003${route}`); assert.equal(response.status, 200, route);
    }
    ws.close(); await stop(); await start();
    const recovered = await state(); assert.equal(recovered.view, 'rules'); assert.equal(recovered.currentTeamId, 1);
    assert.deepEqual(recovered.teams, recorded.teams); assert.equal(recovered.leaderboard[0].best.total, 150);
    ws = await client(); assert.equal((await send(ws, 'EDIT_ATTEMPT', { teamId: 1, number: 1, revision: 1, scores: [1, 2, 3], time: 1, completed: false })).type, 'SUCCESS');
    assert.equal((await state()).leaderboard[0].best.total, 6);
    assert.equal((await send(ws, 'START_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    const inProgress = (await state()).teams[0];
    ws.close(); await stop(); await start();
    assert.deepEqual((await state()).teams[0], inProgress);
    ws = await client();
    assert.equal((await send(ws, 'STOP_ATTEMPT', { teamId: 1 })).type, 'SUCCESS');
    assert.equal((await state()).teams[0].attempts[1].status, 'pending'); ws.close();
    console.log('Integration passed: real WebSocket judging, stale-team rejection, display read-only, routes, export, SQLite restart and corrections.');
  } finally { await stop(); fs.rmSync(temp, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
