'use strict';
const $ = id => document.getElementById(id);
const page = document.body.dataset.page;
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const marks = value => value === null || value === undefined ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
function time(ms, fraction = true) {
  if (ms === null || ms === undefined) return '—';
  ms = Math.max(0, Math.floor(ms));
  return `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${fraction ? '.' + String(ms % 1000).padStart(3, '0') : ''}`;
}
function largeTime(ms) { const [main, fraction] = time(ms).split('.'); return `${main}<span>.${fraction}</span>`; }
function briefing() {
  return `<div class="page-title"><div><h1>Course map & competition rules</h1><p>ITEX 2.0 · Line following robot competition</p></div><a class="button" href="/assets/competition-map.jpg" target="_blank" rel="noopener">Open full map</a></div><div class="brief-grid"><figure style="margin:0"><img class="map-image" src="/assets/competition-map.jpg" width="2000" height="1414" alt="ITEX line following course map: five numbered sections with straights, curves, right-angle turns and an angled path, between two square pads."><figcaption class="map-caption"><span>Competition course · Five path sections</span><span>Reference map</span></figcaption></figure><div><section class="rule"><h2>Calibration · 2 minutes</h2><p>Teams may take <strong>up to 2 minutes of calibration</strong> if needed, before their run window begins. Calibration is optional and separate from run time.</p></section><section class="rule"><h2>Run window · 10 minutes</h2><p>Each team receives <strong>one 10-minute run window</strong> with a maximum of <strong>4 attempts</strong>. The window continues between attempts unless paused by the judge.</p></section><section class="rule"><h2>Three judges, one attempt score</h2><p>Each judge gives a total for the attempt. The three judges’ totals are added together. Completing the <strong>entire challenge earns a 100-mark bonus</strong>, added once per attempt. The combined score is <strong>Judge 1 + Judge 2 + Judge 3 + completion bonus</strong>. Time and each judge’s total are recorded for every attempt.</p></section><section class="rule"><h2>How the winner is decided</h2><p>A team’s <strong>highest combined attempt score</strong> determines its position. If teams tie, the <strong>fastest completion time at that score</strong> ranks first. An exact score-and-time tie remains shared.</p></section></div></div><p class="brief-footer">The course’s five sections are shown for briefing. Record each judge’s total and confirm full-course completion in competition control to award the 100-mark bonus.</p>`;
}
if (page === 'rules') $('brief').innerHTML = briefing();
let state = null, ws, offset = 0, connected = false, toastTimer;
let formKey = null, lastTeamId = null, displayKey = null;
const scoreDrafts = new Map();
const requests = new Map();
function notify(message, error = false) {
  if (!$('toast')) return;
  $('toast').textContent = message; $('toast').classList.toggle('error', error);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').textContent = ''; }, error ? 7000 : 3500);
}
function confirmAction(message, action) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'confirm-dialog';
    dialog.innerHTML = `<form method="dialog"><h2>Confirm ${escapeHtml(action.toLowerCase())}</h2><p>${escapeHtml(message)}</p><div class="toolbar"><button value="cancel">Cancel</button><button class="primary" value="confirm">${escapeHtml(action)}</button></div></form>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => { resolve(dialog.returnValue === 'confirm'); dialog.remove(); }, { once: true });
    dialog.showModal();
  });
}
function confirmCompetitionReset() {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'confirm-dialog';
    dialog.setAttribute('aria-labelledby', 'resetTitle');
    dialog.innerHTML = `<form method="dialog"><h2 id="resetTitle">Reset all competition data</h2><p>Stops every timer and clears all attempts, judge marks, standings, and the announced winner. Team and robot names are kept unless you choose to restore the roster below. This cannot be undone.</p><label class="check"><input id="resetRosterChoice" type="checkbox">Also restore the default 32-team roster</label><p class="note">Restoring the roster removes custom teams and restores default team and robot names.</p><label>Type RESET ALL to confirm<input id="resetPhrase" autocomplete="off" spellcheck="false"></label><div class="toolbar" style="margin-top:24px"><button type="button" data-cancel>Cancel</button><button type="submit" class="danger" value="confirm" disabled>Reset all data</button></div></form>`;
    document.body.append(dialog);
    const input = dialog.querySelector('#resetPhrase'), confirm = dialog.querySelector('[type="submit"]');
    input.oninput = () => { confirm.disabled = input.value !== 'RESET ALL'; };
    dialog.querySelector('[data-cancel]').onclick = () => dialog.close('cancel');
    dialog.querySelector('form').onsubmit = event => { if (input.value !== 'RESET ALL') event.preventDefault(); };
    dialog.addEventListener('close', () => { const choice = dialog.querySelector('#resetRosterChoice').checked; resolve(dialog.returnValue === 'confirm' ? { resetRoster: choice, confirmation: input.value } : null); dialog.remove(); }, { once: true });
    dialog.showModal();
  });
}
function send(type, payload = {}, success = 'Changes saved.') {
  if (!connected || ws.readyState !== WebSocket.OPEN) { notify('Connection lost. Wait for the server to reconnect before making changes.', true); return; }
  if (requests.size) { notify('A change is still being saved. Please wait.'); return; }
  const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const timeout = setTimeout(() => { requests.delete(requestId); notify('Save confirmation was not received. Check the current record before retrying.', true); }, 8000);
  requests.set(requestId, { success, timeout });
  ws.send(JSON.stringify({ type, resetVersion: state?.resetVersion || 0, generation: current()?.session.generation || 0, teamId: state?.currentTeamId, ...payload, requestId }));
}
function current() { return state?.teams.find(t => t.id === state.currentTeamId); }
function runAttempt(t = current()) { return t?.attempts.find(a => a.status === 'running'); }
function runActive(t) { return t && !t.session.runEndedAt && (!!t.session.runPausedAt || t.session.runEndsAt > now()); }
function calibrationActive(t) { return t && !t.session.runEndsAt && (!!t.session.calibrationPausedAt || t.session.calibrationEndsAt > now()); }
function now() { return Date.now() + offset; }
function session(t) {
  const s = t?.session || {};
  if (s.runEndsAt) return { label: s.runPausedAt ? 'Run window paused' : runActive(t) ? 'Run window remaining' : 'Run window ended', remaining: Math.max(0, s.runEndsAt - (s.runPausedAt || now())) };
  if (s.calibrationEndsAt) return { label: s.calibrationPausedAt ? 'Calibration paused' : calibrationActive(t) ? 'Calibration remaining' : 'Calibration complete', remaining: Math.max(0, s.calibrationEndsAt - (s.calibrationPausedAt || now())) };
  return { label: 'Run window remaining', remaining: 600000 };
}
function rankingHtml(rows, limit) {
  if (!rows?.length) return '<li class="empty">Standings appear after the first scored attempt.</li>';
  return rows.slice(0, limit || rows.length).map(t => `<li><span class="rank-number">${t.rank}</span><div class="rank-name"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(t.robotName)} · Attempt ${t.best.number}</small></div><div class="rank-score">${marks(t.best.total)}<small>${t.best.completed ? time(t.best.time) : 'Incomplete'}</small></div></li>`).join('');
}
function renderTeams() {
  const query = $('teamSearch').value.trim().toLowerCase();
  $('teamCount').textContent = `(${state.teams.length})`;
  const teams = state.teams.filter(t => `${t.name} ${t.robotName}`.toLowerCase().includes(query));
  $('teamList').innerHTML = teams.length ? teams.map(t => `<button class="team-item" data-team="${t.id}" aria-pressed="${t.id === state.currentTeamId}"><span class="team-number">${String(t.id).padStart(2, '0')}</span><span class="team-name"><strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(t.robotName)} · ${t.attempts.length}/4 used</small></span>${t.best ? `<span class="team-mark">${marks(t.best.total)}</span>` : ''}</button>`).join('') : '<p class="empty">No teams found.</p>';
}
function rememberScoreDrafts() {
  document.querySelectorAll('[data-score-form]').forEach(form => {
    scoreDrafts.set(form.dataset.key, Object.fromEntries(Array.from(form.elements).filter(el => el.name).map(el => [el.name, el.type === 'checkbox' ? el.checked : el.value])));
  });
}
function renderForm() {
  const t = current(), attempts = t?.attempts.filter(a => a.status !== 'running') || [];
  const key = `${state?.resetVersion || 0}:${t?.session.generation || 0}:${t?.id}:${attempts.map(a => `${a.number}:${a.revision}`).join(',')}`;
  if (key === formKey) return;
  rememberScoreDrafts(); formKey = key;
  $('judgingForms').innerHTML = attempts.length ? attempts.map(a => {
    const draftKey = `${state.resetVersion || 0}:${t.session.generation || 0}:${t.id}:${a.number}:${a.revision}`, draft = scoreDrafts.get(draftKey);
    const value = i => escapeHtml(draft?.[`judge${i}`] ?? a.scores?.[i - 1] ?? '');
    const completed = draft?.completed ?? a.completed;
    const saved = a.status === 'scored';
    return `<form class="attempt-score-form" data-score-form="${a.number}" data-key="${draftKey}" data-team="${t.id}" data-reset-version="${state.resetVersion || 0}" data-generation="${t.session.generation || 0}" data-revision="${a.revision}" data-saved="${saved}"><div class="panel-heading"><h3>Attempt ${a.number} <span class="muted">· ${time(a.time)}</span></h3><span class="badge ${saved ? 'active' : ''}">${saved ? 'Marks saved' : 'Awaiting marks'}</span></div><div class="score-grid">${[1, 2, 3].map(i => `<label>Judge ${i}<input name="judge${i}" aria-label="Attempt ${a.number} Judge ${i}" type="number" required min="0" max="1000000" step="0.01" inputmode="decimal" value="${value(i)}"></label>`).join('')}</div>${saved ? `<label>Recorded time (seconds)<input name="time" aria-label="Attempt ${a.number} recorded time" type="number" min="0.001" max="600" step="0.001" required value="${escapeHtml(draft?.time ?? (a.time / 1000).toFixed(3))}"></label>` : ''}<div class="score-summary"><label class="check"><input name="completed" type="checkbox" ${completed ? 'checked' : ''}>Entire challenge completed (+100 bonus marks)</label><span class="badge" data-bonus>Bonus: 0</span><span class="score-total">Total <strong data-total>—</strong></span><button type="submit" class="${saved ? '' : 'primary'}">${saved ? 'Save correction' : 'Save marks'} · Attempt ${a.number}</button></div></form>`;
  }).join('') : '<p class="empty">Stopped attempts will appear here for scoring. You can complete all four runs before entering any marks.</p>';
  document.querySelectorAll('[data-score-form]').forEach(updateTotal);
}
function updateTotal(form) {
  const inputs = [1, 2, 3].map(i => form.elements[`judge${i}`].value);
  const bonus = form.elements.completed.checked ? 100 : 0;
  form.querySelector('[data-bonus]').textContent = `Bonus: ${bonus}`;
  form.querySelector('[data-total]').textContent = inputs.some(v => v === '' || !Number.isFinite(Number(v))) ? '—' : marks(inputs.reduce((sum, v) => sum + Number(v), 0) + bonus);
}
function renderAdmin() {
  const t = current();
  if (lastTeamId !== t?.id) { formKey = null; lastTeamId = t?.id; $('teamDetails').open = false; }
  renderTeams();
  $('teamHeader').innerHTML = t ? `<div><h2>${escapeHtml(t.name)}</h2><p>${escapeHtml(t.robotName)}</p></div><span class="badge">${t.best ? 'Best score · ' + marks(t.best.total) : 'No scored attempts'}</span>` : '<div><h2>Select a team</h2><p>Choose a team from the roster to begin.</p></div>';
  $('attemptCount').textContent = `${t?.attempts.length || 0} / 4 used`;
  $('attempts').innerHTML = t?.attempts.length ? `<table><thead><tr><th>Attempt</th><th>Time</th><th class="numeric">Judge 1</th><th class="numeric">Judge 2</th><th class="numeric">Judge 3</th><th class="numeric">Bonus</th><th class="numeric">Combined</th><th></th></tr></thead><tbody>${t.attempts.map(a => `<tr><td><strong>${a.number}</strong>${t.best?.number === a.number ? ' <span class="badge best">Best</span>' : ''}</td><td>${a.status === 'running' ? 'Running' : time(a.time)}<small>${a.status === 'pending' ? 'Awaiting scores' : a.status === 'scored' && !a.completed ? 'Incomplete' : ''}</small></td>${[0, 1, 2].map(i => `<td class="numeric">${marks(a.scores?.[i])}</td>`).join('')}<td class="numeric">${marks(a.bonus)}</td><td class="numeric"><strong>${marks(a.total)}</strong></td><td>${a.status !== 'running' ? `<button class="text-button" data-edit="${a.number}" aria-label="${a.status === 'scored' ? 'Edit' : 'Score'} attempt ${a.number}">${a.status === 'scored' ? 'Edit' : 'Enter marks'}</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t ? 'No attempts recorded. Start the team’s run window when ready.' : 'Select a team to view its attempts.'}</p>`;
  $('leaderboard').innerHTML = rankingHtml(state.leaderboard);
  $('displayMode').textContent = `Public display: ${state.view === 'rules' ? 'course map & rules' : state.view === 'winner' ? 'results announcement' : 'live timing'}.`;
  if (document.activeElement !== $('editName')) $('editName').value = t?.name || '';
  if (document.activeElement !== $('editRobot')) $('editRobot').value = t?.robotName || '';
  $('teamDetails').classList.toggle('hidden', !t);
  renderForm(); updateClock();
}
function renderDisplay() {
  const t = current();
  const key = JSON.stringify([state.view, state.currentTeamId, state.winnerIds, t?.name, t?.robotName, t?.attempts.map(a => [a.number, a.status, a.time])]);
  // Clock ticks and score-only changes never restart the entrance animation.
  if (key === displayKey) { updateClock(); return; }
  displayKey = key;
  if (state.view === 'rules') { $('displayContent').classList.remove('audience-stage'); $('displayContent').innerHTML = briefing(); return; }
  $('displayContent').classList.add('audience-stage');
  const winners = state.teams.filter(team => state.winnerIds.includes(team.id));
  const isWinner = state.view === 'winner' && winners.length;
  const attempts = Array.from({ length: 4 }, (_, i) => {
    const a = t?.attempts.find(a => a.number === i + 1);
    return `<div class="audience-attempt ${a?.status === 'running' ? 'on-track' : a ? 'recorded' : ''}"><span>Attempt ${i + 1}</span><strong ${a?.status === 'running' ? 'id="liveAttemptTime"' : ''}>${a?.status === 'running' ? time(0) : a ? time(a.time) : '—'}</strong><small>${a?.status === 'running' ? 'On track' : a ? 'Time recorded' : 'Up next'}</small></div>`;
  }).join('');
  $('displayContent').innerHTML = `<section class="audience-live ${isWinner ? 'winner-stage' : ''}"><div class="audience-topline"><span class="badge active" id="liveStatus">${isWinner ? (winners.length > 1 ? 'Shared first place' : 'Competition winner') : 'Live competition'}</span><span class="muted">ITEX 2.0 · Line following</span></div><h1>${isWinner ? winners.map(team => escapeHtml(team.name)).join('<br>') : t ? escapeHtml(t.name) : 'Ready for the next team'}</h1><p class="audience-robot">${isWinner ? winners.map(team => escapeHtml(team.robotName)).join(' · ') : t ? escapeHtml(t.robotName) : 'Line following robot competition'}</p>${isWinner ? '<div class="winner-finish" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><p class="audience-winner-caption">Congratulations to our winners</p>' : `<div class="timer audience-timer"><div class="time" id="attemptTime">${largeTime(0)}</div><p id="attemptHint">Attempt timer</p></div><div class="audience-window"><div><div class="session-label" id="sessionLabel">Run window remaining</div><div class="session-time" id="sessionTime">10:00</div></div><p id="audienceAttemptLabel">Four attempts. One course.</p></div><div class="window-track" aria-hidden="true"><div id="windowProgress"></div></div><div class="audience-attempts">${attempts}</div>`}</section><footer class="audience-branding" aria-label="Event organizers"><img class="organizer-logo school" src="/assets/school-logo.png" alt="School" width="2480" height="3038"><span class="itex-mark event-logo"><img src="/assets/itex-logo.png" alt="ITEX 2.0" width="2508" height="2508"></span><img class="organizer-logo society" src="/assets/ICTnew.png" alt="ICT Society" width="1241" height="1267"></footer>`;
  updateClock();
}
function updateClock() {
  window.CompetitionSound?.onClock(now(), connected);
  if (!state || !$('attemptTime')) return;
  const t = current(), running = runAttempt(t), latest = t?.attempts.at(-1);
  const paused = !!t?.session.runPausedAt;
  const elapsed = running ? Math.max(0, Math.min(t.session.runPausedAt || now(), t.session.runEndsAt) - running.startedAt) : latest?.time || 0;
  $('attemptTime').innerHTML = largeTime(elapsed);
  const s = session(t);
  $('sessionLabel').textContent = s.label;
  $('sessionTime').textContent = time(Math.ceil(s.remaining / 1000) * 1000, false);
  const hint = running ? `Attempt ${running.number} of 4 · ${paused ? 'Paused by the judge' : 'On track'}` : t?.attempts.length === 4 ? 'All four attempts recorded.' : t?.session.runEndsAt && !runActive(t) ? 'The team’s run window has ended.' : runActive(t) ? paused ? 'Run window paused by the judge.' : 'Ready for the next attempt.' : calibrationActive(t) ? 'Calibration in progress.' : 'Up to four attempts in the team’s run window.';
  $('attemptHint').textContent = hint;
  if (page !== 'admin') {
    if ($('liveStatus')) $('liveStatus').textContent = paused ? 'Timing paused' : running ? 'Robot on track' : calibrationActive(t) ? 'Calibration' : t ? 'Team on track' : 'Waiting for a team';
    $('displayContent').classList.toggle('is-running', !!running && !paused && connected);
    $('displayContent').classList.toggle('is-paused', paused);
    if ($('liveAttemptTime')) $('liveAttemptTime').textContent = time(elapsed);
    if ($('audienceAttemptLabel')) $('audienceAttemptLabel').textContent = `${t?.attempts.length || 0} of 4 attempts used`;
    if ($('windowProgress')) $('windowProgress').style.width = `${Math.min(100, s.remaining / (t?.session.runEndsAt ? 600000 : 120000) * 100)}%`;
    return;
  }
  $('attemptLabel').textContent = running ? `Attempt ${running.number} of 4` : 'Attempt timer';
  $('attemptStatus').textContent = paused ? 'Paused' : running ? 'Running' : latest ? 'Time recorded' : 'Ready';
  $('attemptStatus').classList.toggle('active', !!running && !paused);
  $('calibrate').disabled = !connected || !t || !!t.session.calibrationEndsAt || !!t.session.runEndsAt;
  $('startSession').disabled = !connected || !t || !!t.session.runEndsAt;
  const calActive = calibrationActive(t), active = runActive(t);
  $('pauseCalibration').classList.toggle('hidden', !calActive);
  $('finishCalibration').classList.toggle('hidden', !calActive);
  $('pauseCalibration').textContent = t?.session.calibrationPausedAt ? 'Resume calibration' : 'Pause calibration';
  $('pauseSession').classList.toggle('hidden', !active);
  $('endSession').classList.toggle('hidden', !active);
  $('pauseSession').textContent = paused ? 'Resume run window' : 'Pause run window';
  for (const id of ['pauseCalibration', 'finishCalibration', 'pauseSession', 'endSession']) $(id).disabled = !connected;
  $('startAttempt').disabled = !connected || !t || !active || paused || t.attempts.length >= 4 || !!running;
  $('stopAttempt').disabled = !connected || !running;
  document.querySelectorAll('[data-score-form] button').forEach(button => button.disabled = !connected);
  $('resetTeam').disabled = !connected || !t;
  $('resetAll').disabled = !connected;
  $('announce').disabled = !connected || !state.leaderboard.length;
  $('winnerScope').textContent = `${state.leaderboard.length} of ${state.teams.length} teams have saved scores. Announce whenever you choose; only scored attempts count.`;
}
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/?role=${page === 'display' ? 'display' : 'admin'}`);
  ws.onopen = () => { connected = true; $('connection').textContent = 'Connected'; $('connection').classList.add('online'); updateClock(); };
  ws.onclose = () => {
    connected = false; $('connection').textContent = 'Offline · reconnecting'; $('connection').classList.remove('online');
    updateClock(); setTimeout(connect, 1500);
  };
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.type === 'CLOCK') { offset = message.serverTime - Date.now(); updateClock(); }
    if (message.type === 'FULL_STATE') { state = message.state; window.CompetitionSound?.onState(state); offset = state.serverTime - Date.now(); page === 'admin' ? renderAdmin() : renderDisplay(); }
    if (message.type === 'ERROR' || message.type === 'SUCCESS') {
      const request = requests.get(message.requestId);
      if (request) { clearTimeout(request.timeout); requests.delete(message.requestId); }
      if (message.type === 'ERROR') notify(message.message, true);
      else {
        notify(request?.success || 'Changes saved.');
        if (message.action === 'ADD_TEAM') { $('addTeamForm').reset(); $('addTeamForm').classList.add('hidden'); }
        if (message.action === 'EDIT_ATTEMPT' || message.action === 'SAVE_ATTEMPT') { renderForm(); }
      }
    }
  };
}
if (page === 'admin') {
  $('teamSearch').addEventListener('input', () => state && renderTeams());
  $('teamList').addEventListener('click', e => { const button = e.target.closest('[data-team]'); if (button) send('SET_CURRENT_TEAM', { id: Number(button.dataset.team) }, 'Team selected.'); });
  $('showAdd').onclick = () => { $('addTeamForm').classList.remove('hidden'); $('newTeamName').focus(); };
  $('cancelAdd').onclick = () => $('addTeamForm').classList.add('hidden');
  $('addTeamForm').onsubmit = e => { e.preventDefault(); send('ADD_TEAM', { name: $('newTeamName').value.trim(), robotName: $('newRobotName').value.trim() }, 'Team added.'); };
  $('editTeamForm').onsubmit = e => { e.preventDefault(); send('UPDATE_TEAM', { name: $('editName').value.trim(), robotName: $('editRobot').value.trim() }, 'Team details saved.'); };
  $('removeTeam').onclick = async () => { if (current() && await confirmAction(`Remove ${current().name} and all of its attempts? This cannot be undone.`, 'Remove team')) send('REMOVE_TEAM', {}, 'Team removed.'); };
  $('resetTeam').onclick = async () => {
    const team = current(); if (!team) return;
    const expected = { teamId: team.id, generation: team.session.generation || 0, resetVersion: state.resetVersion || 0 };
    if (await confirmAction(`Reset all attempts, marks, calibration, and run timers for ${team.name}? Its team and robot names will be kept. Any active attempt stops, and the winner announcement is cleared. This cannot be undone.`, 'Reset team data')) send('RESET_TEAM', { ...expected, confirmed: true }, 'Team data reset. Calibration and all four attempts are available again.');
  };
  $('resetAll').onclick = async () => {
    const resetVersion = state?.resetVersion || 0;
    const choice = await confirmCompetitionReset();
    if (choice) send('RESET_ALL', { ...choice, resetVersion }, 'Competition data reset.');
  };
  $('calibrate').onclick = () => send('START_CALIBRATION', {}, 'Two-minute calibration started.');
  $('startSession').onclick = async () => { if (current() && await confirmAction(`Start ${current().name}’s 10-minute run window? You can pause it or end it early from the timer controls.`, 'Start run window')) send('START_SESSION', {}, 'Ten-minute run window started.'); };
  $('pauseCalibration').onclick = () => send(current()?.session.calibrationPausedAt ? 'RESUME_CALIBRATION' : 'PAUSE_CALIBRATION', {}, 'Calibration timer updated.');
  $('finishCalibration').onclick = () => send('STOP_CALIBRATION', {}, 'Calibration finished.');
  $('pauseSession').onclick = () => send(current()?.session.runPausedAt ? 'RESUME_SESSION' : 'PAUSE_SESSION', {}, 'Run timer updated.');
  $('endSession').onclick = async () => { if (await confirmAction('End this team’s run window early? An active attempt will stop and unused attempts will be forfeited. Saved times and marks are retained.', 'End run window')) send('END_SESSION', {}, 'Run window ended. Marks can still be entered below.'); };
  $('startAttempt').onclick = () => send('START_ATTEMPT', {}, 'Attempt started.');
  $('stopAttempt').onclick = () => send('STOP_ATTEMPT', {}, 'Time recorded. Start the next attempt whenever ready; enter marks below later.');
  $('judgingForms').addEventListener('input', event => { const form = event.target.closest('[data-score-form]'); if (form) updateTotal(form); });
  $('judgingForms').addEventListener('submit', event => {
    event.preventDefault(); const form = event.target.closest('[data-score-form]'); if (!form) return;
    const saved = form.dataset.saved === 'true';
    send(saved ? 'EDIT_ATTEMPT' : 'SAVE_ATTEMPT', { resetVersion: Number(form.dataset.resetVersion), generation: Number(form.dataset.generation), teamId: Number(form.dataset.team), number: Number(form.dataset.scoreForm), revision: Number(form.dataset.revision), scores: [1, 2, 3].map(i => Number(form.elements[`judge${i}`].value)), completed: form.elements.completed.checked, ...(saved ? { time: Math.round(Number(form.elements.time.value) * 1000) } : {}) }, `Attempt ${form.dataset.scoreForm} marks saved.`);
  });
  $('attempts').onclick = event => {
    const button = event.target.closest('[data-edit]'); if (!button) return;
    const form = document.querySelector(`[data-score-form="${button.dataset.edit}"]`);
    if (form) { form.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); form.elements.judge1.focus({ preventScroll: true }); }
  };
  $('showRules').onclick = () => send('SET_VIEW', { view: 'rules' }, 'Course map and rules are now on the public display.');
  $('showLive').onclick = () => send('SET_VIEW', { view: 'live' }, 'Live timing is now on the public display.');
  $('announce').onclick = async () => {
    const count = state?.leaderboard.length || 0;
    const pending = state?.teams.reduce((sum, team) => sum + team.attempts.filter(a => a.status !== 'scored').length, 0) || 0;
    const active = state?.teams.some(team => runActive(team) || calibrationActive(team));
    const message = `Announce the winner among ${count} ${count === 1 ? 'team with' : 'teams with'} saved scores? Teams without scores are excluded.${pending ? ` ${pending} unscored ${pending === 1 ? 'attempt is' : 'attempts are'} excluded.` : ''}${active ? ' Active timers will continue while the result is displayed.' : ''} You can continue the competition and announce again later.`;
    if (await confirmAction(message, 'Announce winner')) send('ANNOUNCE_WINNER', {}, 'Winner among the currently scored teams announced.');
  };
  // Keep the initial empty state safe before the first connection arrives.
  for (const id of ['calibrate', 'startSession', 'startAttempt', 'stopAttempt', 'announce']) $(id).disabled = true;
}
if (page === 'admin' || page === 'display') connect();
