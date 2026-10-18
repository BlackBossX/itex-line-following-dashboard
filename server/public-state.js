// Audience clients receive timing only, including on subsequent broadcasts.
function publicState(state, serverTime = Date.now()) {
  return {
    currentTeamId: state.currentTeamId,
    view: state.view,
    winnerIds: state.winnerIds,
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
