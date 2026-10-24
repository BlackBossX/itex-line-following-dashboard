/* Shared, browser-independent rules for sound events and countdown warnings. */
(function (root) {
  function selected(state) { return state?.teams.find(team => team.id === state.currentTeamId); }
  function timerInfo(state, now) {
    const team = selected(state); if (!team) return null;
    const s = team.session;
    const run = !!s.runEndsAt;
    const deadline = run ? s.runEndsAt : s.calibrationEndsAt;
    if (!deadline) return null;
    const pausedAt = run ? s.runPausedAt : s.calibrationPausedAt;
    return {
      key: `${state.resetVersion || 0}:${team.id}:${s.generation || 0}:${run ? 'run' : 'calibration'}`,
      remaining: Math.max(0, deadline - (pausedAt || now)),
      paused: !!pausedAt,
      ended: run ? !!s.runEndedAt : false
    };
  }
  function transition(previous, next) {
    if (next.view === 'winner' && next.winnerIds?.length && (previous.view !== 'winner' || previous.announcementVersion !== next.announcementVersion || JSON.stringify(previous.winnerIds) !== JSON.stringify(next.winnerIds))) return 'winner';
    const before = selected(previous), after = selected(next);
    if (!before || !after || before.id !== after.id || (previous.resetVersion || 0) !== (next.resetVersion || 0) || (before.session.generation || 0) !== (after.session.generation || 0)) return null;
    const a = before.session, b = after.session;
    if ((!a.runEndsAt && b.runEndsAt) || (!a.calibrationEndsAt && b.calibrationEndsAt)) return 'start';
    if ((!a.runPausedAt && b.runPausedAt) || (!a.calibrationPausedAt && b.calibrationPausedAt)) return 'pause';
    if (a.runPausedAt && !b.runPausedAt && !b.runEndedAt) return 'start';
    if (a.calibrationPausedAt && !b.calibrationPausedAt && b.calibrationEndsAt > next.serverTime) return 'start';
    if (!a.runEndedAt && b.runEndedAt) return 'stop';
    if (!b.runEndsAt && a.calibrationEndsAt > previous.serverTime && b.calibrationEndsAt <= next.serverTime && a.calibrationEndsAt !== b.calibrationEndsAt) return 'stop';
    const oldRun = before.attempts.find(attempt => attempt.status === 'running');
    const newRun = after.attempts.find(attempt => attempt.status === 'running');
    if (!oldRun && newRun) return 'start';
    // Deadline expiry has one finish cue from the countdown clock, not a second stop cue.
    if (oldRun && !newRun && b.runEndsAt > next.serverTime) return 'stop';
    return null;
  }
  const api = { timerInfo, transition };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ITEXAudioCues = api;
})(typeof window !== 'undefined' ? window : globalThis);
