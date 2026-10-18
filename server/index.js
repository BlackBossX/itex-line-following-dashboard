const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { publicState } = require('./public-state');
const { openStore } = require('./store');
const { apply, settle, leaderboard, bestAttempt } = require('./competition');
const store = openStore(process.env.DB_PATH || path.join(__dirname, '../data/competition.sqlite'));
let state = store.load();
if (settle(state.teams, Date.now())) store.save(state);
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 16384 });
app.use(express.static(path.join(__dirname, '../public')));
function snapshot(readonly = false) {
  if (readonly) return publicState(state);
  return { ...state, teams: state.teams.map(t => ({ ...t, best: bestAttempt(t) })), leaderboard: leaderboard(state.teams), serverTime: Date.now() };
}
function publish() {
  const admin = JSON.stringify({ type: 'FULL_STATE', state: snapshot() });
  const audience = JSON.stringify({ type: 'FULL_STATE', state: snapshot(true) });
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(client.readonly ? audience : admin);
}
app.get('/rules', (req, res) => res.sendFile(path.join(__dirname, '../public/rules.html')));
app.get('/api/state', (req, res) => res.json(snapshot()));
app.get('/api/export', (req, res) => res.attachment('itex-results.json').json(snapshot()));
wss.on('connection', (ws, req) => {
  const role = new URL(req.url, 'http://localhost').searchParams.get('role');
  const readonly = role === 'display';
  ws.readonly = readonly;
  ws.send(JSON.stringify({ type: 'FULL_STATE', state: snapshot(readonly) }));
  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw);
      if (!msg || typeof msg !== 'object') throw new Error('Invalid action.');
      if (readonly && (msg.type !== 'SHUFFLE_TEAMS' || state.view !== 'teams')) throw new Error('The display can only shuffle the team list before competition starts.');
      const next = structuredClone(state);
      settle(next.teams, Date.now()); apply(next, msg, Date.now(), role === 'coordinator');
      store.save(next); state = next;
      publish(); ws.send(JSON.stringify({ type: 'SUCCESS', requestId: msg.requestId, action: msg.type }));
    } catch (error) {
      const known = error.code ? 'Could not save to the database. Check disk space and retry.' : error.message;
      if (error.code) console.error(error);
      ws.send(JSON.stringify({ type: 'ERROR', requestId: msg?.requestId, message: known }));
    }
  });
});
const timer = setInterval(() => {
  try {
    const next = structuredClone(state);
    if (settle(next.teams, Date.now())) { store.save(next); state = next; publish(); }
    const raw = JSON.stringify({ type: 'CLOCK', serverTime: Date.now() });
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(raw);
  } catch (e) { console.error('Timer persistence failed:', e.message); }
}, 100);
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`ITEX dashboard: http://localhost:${PORT}/admin`));
function shutdown() { clearInterval(timer); wss.clients.forEach(c => c.close()); wss.close(); server.close(() => { store.db.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
