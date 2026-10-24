// Publish aggregate results only when staff select the rankings view.
const { leaderboard } = require('./competition');
function publicState(state, serverTime = Date.now()) {
  return {
    ...(state.view === 'rankings' ? { leaderboard: leaderboard(state.teams).map(t => ({
      id: t.id, name: t.name, rank: t.rank,
      best: { number: t.best.number, total: t.best.total, completed: t.best.completed, time: t.best.time }
    })) } : {}),
    currentTeamId: state.currentTeamId,
    view: state.view,
    winnerIds: state.winnerIds,
    announcementVersion: state.announcementVersion || 0,
    serverTime,
    rosterVersion: state.rosterVersion || 0,
    resetVersion: state.resetVersion || 0,
    shuffledAt: state.shuffledAt || null,
    teams: state.teams.map(t => ({
      id: t.id, name: t.name, session: t.session,
      attempts: t.attempts.map(a => ({ number: a.number, startedAt: a.startedAt, time: a.time, status: a.status === 'running' ? 'running' : 'stopped', completed: a.completed }))
    }))
  };
}
module.exports = { publicState };
