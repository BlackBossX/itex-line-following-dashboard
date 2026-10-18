const WINDOW_MS = 10 * 60 * 1000;
const CALIBRATION_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 4;
function bestAttempt(team) {
  return team.attempts.filter(a => a.scores !== null).sort((a, b) => b.total - a.total || (a.completed ? a.time : Infinity) - (b.completed ? b.time : Infinity))[0] || null;
}
function leaderboard(teams) {
  const rows = teams.map(team => ({ ...team, best: bestAttempt(team) })).filter(t => t.best);
  const time = t => t.best.completed ? t.best.time : Infinity;
  rows.sort((a, b) => b.best.total - a.best.total || time(a) - time(b) || a.id - b.id);
  rows.forEach((t, i) => { t.rank = i && t.best.total === rows[i - 1].best.total && time(t) === time(rows[i - 1]) ? rows[i - 1].rank : i + 1; });
  return rows;
}
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function settle(teams, now) {
  let changed = false;
  for (const t of teams) {
    const running = t.attempts.find(a => a.status === 'running');
    if (running && now >= t.session.runEndsAt) {
      running.time = Math.max(1, t.session.runEndsAt - running.startedAt);
      running.status = 'pending'; running.completed = false;
      changed = true;
    }
  }
  return changed;
}
function apply(state, msg, now = Date.now()) {
  const teams = state.teams;
  const t = teams.find(t => t.id === state.currentTeamId);
  const selected = () => { requireCondition(t, 'Select a team first.'); requireCondition(msg.teamId === t.id, 'The selected team changed. Review the current team before trying again.'); return t; };
  const pending = () => selected().attempts.find(a => a.status === 'pending');
  switch (msg.type) {
    case 'ADD_TEAM': {
      requireCondition(typeof msg.name === 'string' && msg.name.trim() && msg.name.length <= 100, 'Enter a team name (100 characters or fewer).');
      requireCondition(typeof msg.robotName === 'string' && msg.robotName.length <= 100, 'Enter a valid robot name.');
      teams.push({ id: state.nextTeamId++, name: msg.name.trim(), robotName: msg.robotName.trim() || 'Robot', session: {}, attempts: [] }); break;
    }
    case 'UPDATE_TEAM': {
      selected();
      requireCondition(typeof msg.name === 'string' && msg.name.trim() && msg.name.length <= 100 && typeof msg.robotName === 'string' && msg.robotName.length <= 100, 'Enter valid team and robot names.');
      t.name = msg.name.trim(); t.robotName = msg.robotName.trim(); break;
    }
    case 'REMOVE_TEAM':
      selected(); requireCondition(!t.session.runEndsAt || now >= t.session.runEndsAt, 'Wait until this team’s run window ends.');
      requireCondition(!t.session.calibrationEndsAt || t.session.runEndsAt || now >= t.session.calibrationEndsAt, 'Finish calibration first.');
      state.teams = teams.filter(team => team.id !== t.id); state.currentTeamId = null; break;
    case 'SET_CURRENT_TEAM':
      requireCondition(teams.some(team => team.id === msg.id), 'Team not found.');
      if (msg.id !== state.currentTeamId) requireCondition(!teams.some(team => team.session.runEndsAt > now || (!team.session.runEndsAt && team.session.calibrationEndsAt > now)), 'Finish the active team’s time window before switching teams.');
      state.currentTeamId = msg.id; break;
    case 'START_CALIBRATION':
      selected(); requireCondition(!t.session.calibrationEndsAt && !t.session.runEndsAt, 'Calibration is available once, before the run window.');
      t.session.calibrationEndsAt = now + CALIBRATION_MS; break;
    case 'START_SESSION':
      selected(); requireCondition(!t.session.runEndsAt, 'This team’s 10-minute window has already been started.');
      t.session.runStartedAt = now; t.session.runEndsAt = now + WINDOW_MS; break;
    case 'START_ATTEMPT':
      selected(); requireCondition(t.session.runEndsAt > now, 'Start the team’s run window first, or select the next team if time is up.');
      requireCondition(t.attempts.length < MAX_ATTEMPTS, 'All four attempts have been used.');
      requireCondition(!t.attempts.some(a => a.status !== 'scored'), 'Stop and score the current attempt first.');
      t.attempts.push({ number: t.attempts.length + 1, startedAt: now, time: 0, status: 'running', scores: null, total: null, completed: false, revision: 0 }); break;
    case 'STOP_ATTEMPT': {
      selected(); const a = t.attempts.find(a => a.status === 'running');
      requireCondition(a, 'There is no running attempt to stop.');
      a.time = Math.max(1, Math.min(now, t.session.runEndsAt) - a.startedAt); a.status = 'pending'; a.completed = true; break;
    }
    case 'SAVE_ATTEMPT':
    case 'EDIT_ATTEMPT': {
      selected(); const a = msg.type === 'SAVE_ATTEMPT' ? pending() : t.attempts.find(a => a.number === msg.number && a.status === 'scored');
      requireCondition(a, 'This attempt is no longer available. Reload and try again.');
      requireCondition(msg.revision === a.revision, 'Another operator updated this attempt. Reload its scores before saving.');
      requireCondition(Array.isArray(msg.scores) && msg.scores.length === 3 && msg.scores.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000), 'Enter a non-negative total for each of the three judges.');
      requireCondition(typeof msg.completed === 'boolean', 'Choose whether the robot completed the course.');
      if (msg.type === 'EDIT_ATTEMPT') {
        requireCondition(Number.isSafeInteger(msg.time) && msg.time > 0 && msg.time <= Math.min(WINDOW_MS, t.session.runEndsAt - a.startedAt), 'Completion time must fit within the team’s run window.');
        a.time = msg.time;
      }
      a.scores = msg.scores; a.total = Math.round(msg.scores.reduce((s, n) => s + n, 0) * 100) / 100;
      a.completed = msg.completed; a.status = 'scored'; a.revision++; a.updatedAt = now; break;
    }
    case 'SET_VIEW':
      requireCondition(['live', 'rules'].includes(msg.view), 'Unknown display view.'); state.view = msg.view; state.winnerIds = []; break;
    case 'ANNOUNCE_WINNER': {
      requireCondition(!teams.some(team => team.session.runEndsAt > now || team.attempts.some(a => a.status !== 'scored')), 'Finish active windows and score all pending attempts before announcing results.');
      const rows = leaderboard(teams); requireCondition(rows.length, 'Save at least one scored attempt first.');
      state.winnerIds = rows.filter(t => t.rank === 1).map(t => t.id); state.view = 'winner'; break;
    }
    default: throw new Error('Unknown action. Reload the dashboard and try again.');
  }
  // A changed score or roster invalidates a previously announced result.
  if (['SAVE_ATTEMPT', 'EDIT_ATTEMPT', 'UPDATE_TEAM', 'REMOVE_TEAM', 'ADD_TEAM', 'START_SESSION'].includes(msg.type)) {
    state.winnerIds = []; if (state.view === 'winner') state.view = 'live';
  }
}
module.exports = { apply, settle, leaderboard, bestAttempt, WINDOW_MS, CALIBRATION_MS, MAX_ATTEMPTS };
