const WINDOW_MS = 10 * 60 * 1000;
const CALIBRATION_MS = 2 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const COMPLETION_BONUS = 100;
function attemptScore(scores, completed) {
  const judgeTotal = Math.round(scores.reduce((sum, score) => sum + score, 0) * 100) / 100;
  const bonus = completed ? COMPLETION_BONUS : 0;
  return { judgeTotal, bonus, total: Math.round((judgeTotal + bonus) * 100) / 100 };
}
function normalizeScores(state) {
  let changed = false, resultsChanged = false;
  for (const team of state.teams) for (const attempt of team.attempts) {
    if (attempt.status !== 'scored' || !Array.isArray(attempt.scores)) continue;
    const calculated = attemptScore(attempt.scores, attempt.completed);
    if (Object.entries(calculated).some(([key, value]) => attempt[key] !== value)) {
      if (attempt.total !== calculated.total) { resultsChanged = true; attempt.revision = (attempt.revision || 0) + 1; }
      Object.assign(attempt, calculated); changed = true;
    }
  }
  if (resultsChanged) { state.winnerIds = []; if (state.view === 'winner') state.view = 'live'; }
  if (state.view === 'winner') {
    const winners = leaderboard(state.teams).filter(t => t.rank === 1).map(t => t.id);
    if (JSON.stringify(winners) !== JSON.stringify(state.winnerIds)) {
      state.winnerIds = []; state.view = 'live'; changed = true;
    }
  }
  return changed;
}
function initialState() {
  return { teams: Array.from({ length: 5 }, (_, i) => ({ id: i + 1, name: `Team ${i + 1}`, robotName: '', session: {}, attempts: [] })), nextTeamId: 6, currentTeamId: null, view: 'live', winnerIds: [] };
}
function resetTeam(team) {
  team.session = { generation: (team.session.generation || 0) + 1 };
  team.attempts = [];
}
function bestAttempt(team) {
  return team.attempts.filter(a => a.scores !== null).sort((a, b) => b.total - a.total || a.time - b.time)[0] || null;
}
function leaderboard(teams) {
  const rows = teams.map(team => ({ ...team, best: bestAttempt(team) })).filter(t => t.best);
  const time = t => t.best.time;
  rows.sort((a, b) => b.best.total - a.best.total || time(a) - time(b) || a.id - b.id);
  rows.forEach((t, i) => { t.rank = i && t.best.total === rows[i - 1].best.total && time(t) === time(rows[i - 1]) ? rows[i - 1].rank : i + 1; });
  return rows;
}
function requireCondition(condition, message) { if (!condition) throw new Error(message); }
function windowActive(team, now) { return !team.session.runEndedAt && (!!team.session.runPausedAt || team.session.runEndsAt > now); }
function calibrationActive(team, now) { return !team.session.runEndsAt && (!!team.session.calibrationPausedAt || team.session.calibrationEndsAt > now); }
function reviewReady(team, now = Date.now()) {
  return !!team.session.runEndsAt && !team.attempts.some(a => a.status === 'running') &&
    (!windowActive(team, now) || team.attempts.length === MAX_ATTEMPTS) &&
    team.attempts.length > 0 && team.attempts.every(a => a.status === 'scored');
}
function settle(teams, now) {
  let changed = false;
  for (const t of teams) {
    const running = t.attempts.find(a => a.status === 'running');
    if (running && !t.session.runPausedAt && now >= t.session.runEndsAt) {
      running.time = Math.max(1, t.session.runEndsAt - running.startedAt);
      running.status = 'pending'; running.completed = false;
      changed = true;
    }
  }
  return changed;
}
function apply(state, msg, now = Date.now(), coordinator = false) {
  if (coordinator) requireCondition(msg.type === 'EDIT_ATTEMPT', 'Use competition control for roster and timer changes.');
  requireCondition((msg.resetVersion || 0) === (state.resetVersion || 0), 'Competition data was reset. Review the latest state before retrying.');
  const teams = state.teams;
  const t = teams.find(t => t.id === (coordinator ? msg.teamId : state.currentTeamId));
  const selected = () => { requireCondition(t, 'Select a team first.'); requireCondition(msg.teamId === t.id, 'The selected team changed. Review the current team before trying again.'); requireCondition((msg.generation || 0) === (t.session.generation || 0), 'This team was reset. Review its latest data before retrying.'); return t; };
  switch (msg.type) {
    case 'RESET_TEAM':
      selected(); requireCondition(msg.confirmed === true, 'Confirm the team reset first.');
      resetTeam(t); break;
    case 'RESET_ALL': {
      requireCondition(msg.confirmation === 'RESET ALL' && typeof msg.resetRoster === 'boolean', 'Type RESET ALL to confirm and choose whether to reset the roster.');
      if (msg.resetRoster) {
        const defaults = initialState(); state.teams = defaults.teams; state.nextTeamId = defaults.nextTeamId;
      } else teams.forEach(resetTeam);
      state.resetVersion = (state.resetVersion || 0) + 1;
      state.currentTeamId = null; state.winnerIds = []; state.view = 'live'; delete state.shuffledAt; break;
    }
    case 'SHUFFLE_TEAMS': {
      requireCondition(teams.length > 1, 'Add at least two teams before shuffling.');
      requireCondition(!teams.some(t => t.attempts.length || t.session.runEndsAt || t.session.calibrationEndsAt), 'Shuffle before calibration or competition starts. Reset competition data first to create a new order.');
      requireCondition(msg.rosterVersion === (state.rosterVersion || 0), 'The roster changed. Review the latest teams before shuffling again.');
      const { randomInt } = require('node:crypto');
      for (let i = teams.length - 1; i > 0; i--) {
        const j = randomInt(i + 1); [teams[i], teams[j]] = [teams[j], teams[i]];
      }
      state.rosterVersion = (state.rosterVersion || 0) + 1;
      state.shuffledAt = now; break;
    }
    case 'ADD_TEAM': {
      requireCondition(typeof msg.name === 'string' && msg.name.trim() && msg.name.length <= 100, 'Enter a team name (100 characters or fewer).');
      teams.push({ id: state.nextTeamId++, name: msg.name.trim(), robotName: '', session: {}, attempts: [] }); break;
    }
    case 'UPDATE_TEAM': {
      selected();
      requireCondition(typeof msg.name === 'string' && msg.name.trim() && msg.name.length <= 100, 'Enter a valid team name (100 characters or fewer).');
      t.name = msg.name.trim(); break;
    }
    case 'REMOVE_TEAM':
      selected(); requireCondition(!windowActive(t, now), 'Wait until this team’s run window ends.');
      requireCondition(!calibrationActive(t, now), 'Finish calibration first.');
      state.teams = teams.filter(team => team.id !== t.id); state.currentTeamId = null; break;
    case 'SET_CURRENT_TEAM':
      requireCondition(teams.some(team => team.id === msg.id), 'Team not found.');
      if (msg.id !== state.currentTeamId) requireCondition(!teams.some(team => windowActive(team, now) || calibrationActive(team, now)), 'Finish the active team’s time window before switching teams.');
      state.currentTeamId = msg.id; break;
    case 'START_CALIBRATION':
      selected(); requireCondition(!t.session.calibrationEndsAt && !t.session.runEndsAt, 'Calibration is available once, before the run window.');
      t.session.calibrationEndsAt = now + CALIBRATION_MS; break;
    case 'PAUSE_CALIBRATION':
      selected(); requireCondition(calibrationActive(t, now) && !t.session.calibrationPausedAt, 'Calibration is not running.');
      t.session.calibrationPausedAt = now; break;
    case 'RESUME_CALIBRATION':
      selected(); requireCondition(t.session.calibrationPausedAt && !t.session.runEndsAt, 'Calibration is not paused.');
      t.session.calibrationEndsAt += now - t.session.calibrationPausedAt; delete t.session.calibrationPausedAt; break;
    case 'STOP_CALIBRATION':
      selected(); requireCondition(calibrationActive(t, now), 'Calibration has already ended.');
      t.session.calibrationEndsAt = t.session.calibrationPausedAt || now; delete t.session.calibrationPausedAt; break;
    case 'PAUSE_SESSION':
      selected(); requireCondition(windowActive(t, now) && !t.session.runPausedAt, 'The run window is not running.');
      t.session.runPausedAt = now; break;
    case 'RESUME_SESSION': {
      selected(); requireCondition(t.session.runPausedAt && !t.session.runEndedAt, 'The run window is not paused.');
      const pauseDuration = now - t.session.runPausedAt;
      t.session.runEndsAt += pauseDuration;
      const running = t.attempts.find(a => a.status === 'running');
      if (running) running.startedAt += pauseDuration;
      delete t.session.runPausedAt; break;
    }
    case 'END_SESSION': {
      selected(); requireCondition(windowActive(t, now), 'The run window has already ended.');
      const end = t.session.runPausedAt || now;
      const running = t.attempts.find(a => a.status === 'running');
      if (running) { running.time = Math.max(1, end - running.startedAt); running.status = 'pending'; running.completed = false; }
      t.session.runEndsAt = end; t.session.runEndedAt = now; delete t.session.runPausedAt; break;
    }
    case 'START_SESSION':
      selected(); requireCondition(!t.session.runEndsAt, 'This team’s 10-minute window has already been started.');
      delete t.session.calibrationPausedAt; t.session.runStartedAt = now; t.session.runEndsAt = now + WINDOW_MS; break;
    case 'START_ATTEMPT':
      selected(); requireCondition(windowActive(t, now) && !t.session.runPausedAt, 'Resume or start the team’s run window first, or select the next team if time is up.');
      requireCondition(t.attempts.length < MAX_ATTEMPTS, 'All four attempts have been used.');
      requireCondition(!t.attempts.some(a => a.status === 'running'), 'Stop the current attempt first.');
      t.attempts.push({ number: t.attempts.length + 1, startedAt: now, time: 0, status: 'running', scores: null, total: null, completed: false, revision: 0 }); break;
    case 'STOP_ATTEMPT': {
      selected(); const a = t.attempts.find(a => a.status === 'running');
      requireCondition(a, 'There is no running attempt to stop.');
      a.time = Math.max(1, Math.min(t.session.runPausedAt || now, t.session.runEndsAt) - a.startedAt); a.status = 'pending'; a.completed = false; break;
    }
    case 'SAVE_ATTEMPT':
    case 'EDIT_ATTEMPT': {
      selected();
      if (coordinator) requireCondition(reviewReady(t, now), 'Coordinator editing unlocks after the team finishes its rounds and judges save marks for every attempt.');
      const a = t.attempts.find(a => a.number === msg.number && a.status === (msg.type === 'SAVE_ATTEMPT' ? 'pending' : 'scored'));
      requireCondition(a, 'This attempt is no longer available. Reload and try again.');
      requireCondition(msg.revision === a.revision, 'Another operator updated this attempt. Reload its scores before saving.');
      requireCondition(Array.isArray(msg.scores) && msg.scores.length === 3 && msg.scores.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000000), 'Enter a non-negative total for each of the three judges.');
      requireCondition(typeof msg.completed === 'boolean', 'Choose whether the robot completed the course.');
      if (msg.type === 'EDIT_ATTEMPT') {
        requireCondition(Number.isSafeInteger(msg.time) && msg.time > 0 && msg.time <= Math.min(WINDOW_MS, t.session.runEndsAt - a.startedAt), 'Completion time must fit within the team’s run window.');
        a.time = msg.time;
      }
      a.scores = msg.scores; Object.assign(a, attemptScore(msg.scores, msg.completed));
      a.completed = msg.completed; a.status = 'scored'; a.revision++; a.updatedAt = now; break;
    }
    case 'SET_VIEW':
      requireCondition(['live', 'rules', 'teams', 'rankings'].includes(msg.view), 'Unknown display view.'); state.view = msg.view; state.winnerIds = []; break;
    case 'ANNOUNCE_WINNER': {
      const rows = leaderboard(teams); requireCondition(rows.length, 'Save at least one scored attempt first.');
      state.winnerIds = rows.filter(t => t.rank === 1).map(t => t.id); state.view = 'winner'; state.announcementVersion = (state.announcementVersion || 0) + 1; break;
    }
    default: throw new Error('Unknown action. Reload the dashboard and try again.');
  }
  if (['ADD_TEAM', 'REMOVE_TEAM', 'UPDATE_TEAM', 'RESET_ALL'].includes(msg.type)) state.rosterVersion = (state.rosterVersion || 0) + 1;
  // A changed score or roster invalidates a previously announced result.
  if (['RESET_TEAM', 'RESET_ALL', 'SAVE_ATTEMPT', 'EDIT_ATTEMPT', 'UPDATE_TEAM', 'REMOVE_TEAM', 'ADD_TEAM', 'START_SESSION'].includes(msg.type)) {
    state.winnerIds = []; if (state.view === 'winner') state.view = 'live';
  }
}
module.exports = { attemptScore, normalizeScores, COMPLETION_BONUS, initialState, apply, settle, leaderboard, bestAttempt, WINDOW_MS, CALIBRATION_MS, MAX_ATTEMPTS, windowActive, calibrationActive, reviewReady };
