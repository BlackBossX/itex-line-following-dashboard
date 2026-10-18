const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

// --- State ---
let state = {
  teams: [],
  currentTeam: null,
  stopwatch: {
    running: false,
    startTime: null,
    elapsed: 0,
    laps: []
  },
  countdown: {
    active: false,
    seconds: 5
  },
  winner: null,
  phase: 'idle' // idle | countdown | running | finished
};

// Generate default 32 teams
for (let i = 1; i <= 32; i++) {
  state.teams.push({
    id: i,
    name: `Team ${i}`,
    robotName: `Robot ${i}`,
    attempts: [],
    bestTime: null,
    penalty: 0
  });
}

// --- Broadcast helper ---
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Stopwatch tick
let tickInterval = null;
function startTick() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    if (state.stopwatch.running) {
      const now = Date.now();
      state.stopwatch.elapsed = now - state.stopwatch.startTime;
      broadcast({ type: 'TICK', elapsed: state.stopwatch.elapsed });
    }
  }, 50);
}

// --- WebSocket messages ---
wss.on('connection', (ws) => {
  // Send full state on connect
  ws.send(JSON.stringify({ type: 'FULL_STATE', state }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'UPDATE_TEAM': {
        const t = state.teams.find(t => t.id === msg.team.id);
        if (t) { Object.assign(t, msg.team); }
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'ADD_TEAM': {
        const newId = state.teams.length ? Math.max(...state.teams.map(t => t.id)) + 1 : 1;
        state.teams.push({
          id: newId,
          name: msg.name || `Team ${newId}`,
          robotName: msg.robotName || `Robot ${newId}`,
          attempts: [],
          bestTime: null,
          penalty: 0
        });
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'REMOVE_TEAM': {
        state.teams = state.teams.filter(t => t.id !== msg.id);
        if (state.currentTeam && state.currentTeam.id === msg.id) {
          state.currentTeam = null;
          state.phase = 'idle';
        }
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'SET_CURRENT_TEAM': {
        const team = state.teams.find(t => t.id === msg.id);
        if (team) { state.currentTeam = team; }
        state.phase = 'idle';
        state.stopwatch = { running: false, startTime: null, elapsed: 0, laps: [] };
        state.countdown = { active: false, seconds: 5 };
        state.winner = null;
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'START_COUNTDOWN': {
        if (!state.currentTeam) return;
        state.phase = 'countdown';
        state.countdown = { active: true, seconds: msg.seconds || 5 };
        state.stopwatch = { running: false, startTime: null, elapsed: 0, laps: [] };
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'COUNTDOWN_TICK': {
        state.countdown.seconds = msg.seconds;
        broadcast({ type: 'COUNTDOWN_TICK', seconds: msg.seconds });
        break;
      }
      case 'COUNTDOWN_DONE': {
        state.phase = 'running';
        state.countdown = { active: false, seconds: 0 };
        state.stopwatch.running = true;
        state.stopwatch.startTime = Date.now();
        state.stopwatch.elapsed = 0;
        broadcast({ type: 'FULL_STATE', state });
        startTick();
        break;
      }
      case 'STOPWATCH_START': {
        if (!state.stopwatch.running) {
          state.stopwatch.running = true;
          state.stopwatch.startTime = Date.now() - state.stopwatch.elapsed;
          state.phase = 'running';
          broadcast({ type: 'FULL_STATE', state });
          startTick();
        }
        break;
      }
      case 'STOPWATCH_STOP': {
        if (state.stopwatch.running) {
          state.stopwatch.elapsed = Date.now() - state.stopwatch.startTime;
          state.stopwatch.running = false;
          state.phase = 'finished';
          if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
          broadcast({ type: 'FULL_STATE', state });
        }
        break;
      }
      case 'STOPWATCH_RESET': {
        state.stopwatch = { running: false, startTime: null, elapsed: 0, laps: [] };
        state.phase = state.currentTeam ? 'idle' : 'idle';
        if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'STOPWATCH_LAP': {
        if (state.stopwatch.running) {
          const lapTime = Date.now() - state.stopwatch.startTime;
          state.stopwatch.laps.push(lapTime);
          broadcast({ type: 'LAP', laps: state.stopwatch.laps });
        }
        break;
      }
      case 'SAVE_ATTEMPT': {
        if (!state.currentTeam) return;
        const team = state.teams.find(t => t.id === state.currentTeam.id);
        if (!team) return;
        const attempt = {
          time: state.stopwatch.elapsed,
          penalty: msg.penalty || 0,
          adjustedTime: state.stopwatch.elapsed + (msg.penalty || 0) * 1000,
          timestamp: Date.now()
        };
        team.attempts.push(attempt);
        team.penalty = msg.penalty || 0;
        // Best time
        const validAttempts = team.attempts.filter(a => a.adjustedTime > 0);
        if (validAttempts.length) {
          team.bestTime = Math.min(...validAttempts.map(a => a.adjustedTime));
        }
        state.currentTeam = team;
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'ANNOUNCE_WINNER': {
        const sorted = [...state.teams]
          .filter(t => t.bestTime !== null)
          .sort((a, b) => a.bestTime - b.bestTime);
        state.winner = sorted.length ? sorted[0] : msg.team || state.currentTeam;
        state.phase = 'winner';
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'CLEAR_WINNER': {
        state.winner = null;
        state.phase = 'idle';
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'SET_PENALTY': {
        if (!state.currentTeam) return;
        const team = state.teams.find(t => t.id === state.currentTeam.id);
        if (team) { team.penalty = msg.penalty; state.currentTeam = team; }
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
      case 'RESET_ALL': {
        state.teams.forEach(t => { t.attempts = []; t.bestTime = null; t.penalty = 0; });
        state.currentTeam = null;
        state.stopwatch = { running: false, startTime: null, elapsed: 0, laps: [] };
        state.countdown = { active: false, seconds: 5 };
        state.winner = null;
        state.phase = 'idle';
        if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
        broadcast({ type: 'FULL_STATE', state });
        break;
      }
    }
  });
});

// REST fallback routes
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '../public/admin/index.html')));
app.get('/display', (req, res) => res.sendFile(path.join(__dirname, '../public/display/index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../public/index.html')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ITEX Dashboard running on port ${PORT}`);
  console.log(`   Admin Panel : http://localhost:${PORT}/admin`);
  console.log(`   Display Panel: http://localhost:${PORT}/display\n`);
});
