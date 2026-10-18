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
  return `<div class="page-title"><div><h1>Course map & competition rules</h1><p>ITEX 2.0 · Line following robot competition</p></div><a class="button" href="/assets/competition-map.jpg" target="_blank" rel="noopener">Open full map</a></div><div class="brief-grid"><figure style="margin:0"><img class="map-image" src="/assets/competition-map.jpg" width="2000" height="1414" alt="ITEX line following course map: five numbered sections with straights, curves, right-angle turns and an angled path, between two square pads."><figcaption class="map-caption"><span>Competition course · Five path sections</span><span>Reference map</span></figcaption></figure><div><section class="rule"><h2>Calibration · 2 minutes</h2><p>Teams may take <strong>up to 2 minutes of calibration</strong> if needed, before their run window begins. Calibration is optional and separate from run time.</p></section><section class="rule"><h2>Run window · 10 minutes</h2><p>Each team receives <strong>one continuous 10-minute window</strong> with a maximum of <strong>4 attempts</strong>. The window continues between attempts.</p></section><section class="rule"><h2>Three judges, one attempt score</h2><p>Each judge gives a total for the attempt. The three totals are added to form its <strong>combined score</strong>. Time and each judge’s total are recorded for every attempt.</p></section><section class="rule"><h2>How the winner is decided</h2><p>A team’s <strong>highest combined attempt score</strong> determines its position. If teams tie, the <strong>fastest completion time at that score</strong> ranks first. An exact score-and-time tie remains shared.</p></section></div></div><p class="brief-footer">The course’s five sections are shown for briefing. Record only each judge’s total for the full attempt in competition control.</p>`;
}
if (page === 'rules') $('brief').innerHTML = briefing();
let state = null, ws, offset = 0, connected = false, toastTimer;
let edit = null, formKey = null, lastTeamId = null;
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
function send(type, payload = {}, success = 'Changes saved.') {
  if (!connected || ws.readyState !== WebSocket.OPEN) { notify('Connection lost. Wait for the server to reconnect before making changes.', true); return; }
  if (requests.size) { notify('A change is still being saved. Please wait.'); return; }
  const requestId = crypto.randomUUID();
  const timeout = setTimeout(() => { requests.delete(requestId); notify('Save confirmation was not received. Check the current record before retrying.', true); }, 8000);
  requests.set(requestId, { success, timeout });
  ws.send(JSON.stringify({ type, teamId: state?.currentTeamId, ...payload, requestId }));
}
function current() { return state?.teams.find(t => t.id === state.currentTeamId); }
function runAttempt(t = current()) { return t?.attempts.find(a => a.status === 'running'); }
function pendingAttempt(t = current()) { return t?.attempts.find(a => a.status === 'pending'); }
function now() { return Date.now() + offset; }
function session(t) {
  const s = t?.session || {};
  if (s.runEndsAt) return { label: s.runEndsAt > now() ? 'Run window remaining' : 'Run window ended', remaining: Math.max(0, s.runEndsAt - now()) };
  if (s.calibrationEndsAt) return { label: s.calibrationEndsAt > now() ? 'Calibration remaining' : 'Calibration complete', remaining: Math.max(0, s.calibrationEndsAt - now()) };
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
function renderForm() {
  const t = current();
  const a = edit ? t?.attempts.find(a => a.number === edit.number) : pendingAttempt(t);
  const key = a ? `${t.id}:${a.number}:${a.revision}:${edit ? 'edit' : 'new'}` : null;
  $('scoreForm').classList.toggle('hidden', !a);
  if (key === formKey) return;
  formKey = key;
  if (!a) return;
  $('scoreTitle').textContent = `${edit ? 'Edit' : 'Score'} attempt ${a.number}`;
  $('saveScore').textContent = edit ? 'Save correction' : 'Save attempt';
  for (let i = 1; i <= 3; i++) $(`judge${i}`).value = a.scores?.[i - 1] ?? '';
  $('completed').checked = a.completed;
  $('editTimeLabel').classList.toggle('hidden', !edit);
  $('editTime').required = !!edit;
  $('cancelEdit').classList.toggle('hidden', !edit);
  $('editTime').value = (a.time / 1000).toFixed(3);
  updateTotal();
}
function updateTotal() {
  const inputs = [1, 2, 3].map(i => $(`judge${i}`).value);
  $('scoreTotal').textContent = inputs.some(v => v === '' || !Number.isFinite(Number(v))) ? '—' : marks(inputs.reduce((sum, v) => sum + Number(v), 0));
}
function renderAdmin() {
  const t = current();
  if (lastTeamId !== t?.id) { edit = null; formKey = null; lastTeamId = t?.id; $('teamDetails').open = false; }
  renderTeams();
  $('teamHeader').innerHTML = t ? `<div><h2>${escapeHtml(t.name)}</h2><p>${escapeHtml(t.robotName)}</p></div><span class="badge">${t.best ? 'Best score · ' + marks(t.best.total) : 'No scored attempts'}</span>` : '<div><h2>Select a team</h2><p>Choose a team from the roster to begin.</p></div>';
  $('attemptCount').textContent = `${t?.attempts.length || 0} / 4 used`;
  $('attempts').innerHTML = t?.attempts.length ? `<table><thead><tr><th>Attempt</th><th>Time</th><th class="numeric">Judge 1</th><th class="numeric">Judge 2</th><th class="numeric">Judge 3</th><th class="numeric">Combined</th><th></th></tr></thead><tbody>${t.attempts.map(a => `<tr><td><strong>${a.number}</strong>${t.best?.number === a.number ? ' <span class="badge best">Best</span>' : ''}</td><td>${a.status === 'running' ? 'Running' : time(a.time)}<small>${a.status === 'pending' ? 'Awaiting scores' : a.status === 'scored' && !a.completed ? 'Incomplete' : ''}</small></td>${[0, 1, 2].map(i => `<td class="numeric">${marks(a.scores?.[i])}</td>`).join('')}<td class="numeric"><strong>${marks(a.total)}</strong></td><td>${a.status === 'scored' ? `<button class="text-button" data-edit="${a.number}" aria-label="Edit attempt ${a.number}">Edit</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="empty">${t ? 'No attempts recorded. Start the team’s run window when ready.' : 'Select a team to view its attempts.'}</p>`;
  $('leaderboard').innerHTML = rankingHtml(state.leaderboard);
  $('displayMode').textContent = `Public display: ${state.view === 'rules' ? 'course map & rules' : state.view === 'winner' ? 'results announcement' : 'live timing'}.`;
  if (document.activeElement !== $('editName')) $('editName').value = t?.name || '';
  if (document.activeElement !== $('editRobot')) $('editRobot').value = t?.robotName || '';
  $('teamDetails').classList.toggle('hidden', !t);
  renderForm(); updateClock();
}
function renderDisplay() {
  if (state.view === 'rules') { $('displayContent').innerHTML = briefing(); return; }
  const t = current(), winners = state.leaderboard.filter(t => state.winnerIds.includes(t.id));
  const title = state.view === 'winner' ? 'Competition results' : 'Live competition';
  let main;
  if (winners.length && state.view === 'winner') {
    main = `<span class="badge best">${winners.length > 1 ? 'Shared first place' : 'Competition winner'}</span><h1 style="margin-top:24px">${winners.map(t => escapeHtml(t.name)).join('<br>')}</h1><p>${winners.map(t => escapeHtml(t.robotName)).join(' · ')}</p><div class="winner-score">${marks(winners[0].best.total)} <small style="font-size:1.1rem">points</small></div><p>Best combined attempt score</p><p style="margin-top:18px">${winners[0].best.completed ? 'Completion time · ' + time(winners[0].best.time) : 'Course incomplete'}</p>`;
  } else {
    main = `<span class="badge active" id="liveStatus">${t ? 'Team on track' : 'Ready for the next team'}</span><h1 style="margin-top:24px">${t ? escapeHtml(t.name) : 'Line following competition'}</h1><p>${t ? escapeHtml(t.robotName) : 'Live timing and results will appear here.'}</p><div class="timer"><div class="time" id="attemptTime">${largeTime(0)}</div><p id="attemptHint">Attempt timer</p></div><div class="session-row"><div><div class="session-label" id="sessionLabel">Run window remaining</div><div class="session-time" id="sessionTime">10:00</div></div><div><div class="session-label">Attempts used</div><div class="session-time">${t?.attempts.length || 0} <span class="muted" style="font-size:1rem">/ 4</span></div></div></div>${t?.best ? `<p>Best score · <strong style="color:var(--gold)">${marks(t.best.total)}</strong> points${t.best.completed ? ' · ' + time(t.best.time) : ''}</p>` : ''}`;
  }
  $('displayContent').innerHTML = `<div class="display-title"><h2>${title}</h2><p style="font-size:.85rem">ITEX 2.0</p></div><div class="display-grid"><section class="display-main">${main}</section><aside><section class="panel"><div class="panel-heading"><h2>Standings</h2><span class="badge">Score first</span></div><ol class="rank-list">${rankingHtml(state.leaderboard, 10)}</ol><p class="note">Best combined score, then fastest completion time at that score.</p></section><p class="note">Optional 2-minute calibration · 10-minute run window · 4 attempts · 3 judges</p></aside></div>`;
  updateClock();
}
function updateClock() {
  if (!state || !$('attemptTime')) return;
  const t = current(), running = runAttempt(t), pending = pendingAttempt(t), latest = t?.attempts.at(-1);
  const elapsed = running ? Math.max(0, Math.min(now(), t.session.runEndsAt) - running.startedAt) : latest?.time || 0;
  $('attemptTime').innerHTML = largeTime(elapsed);
  const s = session(t);
  $('sessionLabel').textContent = s.label;
  // Countdown rounds up so the display never reads 00:00 while time remains.
  $('sessionTime').textContent = time(Math.ceil(s.remaining / 1000) * 1000, false);
  const hint = running ? `Attempt ${running.number} of 4 is running.` : pending ? `Attempt ${pending.number} stopped. Awaiting judges’ scores.` : t?.attempts.length === 4 ? 'All four attempts have been used.' : t?.session.runEndsAt && s.remaining === 0 ? 'The team’s run window has ended.' : t?.session.runEndsAt ? 'Ready for the next attempt. The run window continues.' : t?.session.calibrationEndsAt > now() ? 'Calibration is in progress. Start the run window when ready.' : 'Up to four attempts within the team’s run window.';
  $('attemptHint').textContent = hint;
  if (page !== 'admin') { if ($('liveStatus')) $('liveStatus').textContent = running ? 'Attempt running' : pending ? 'Awaiting scores' : t ? s.label : 'Waiting for a team'; return; }
  $('attemptLabel').textContent = running || pending ? `Attempt ${(running || pending).number} of 4` : 'Attempt timer';
  $('attemptStatus').textContent = running ? 'Running' : pending ? 'Awaiting scores' : latest ? 'Recorded' : 'Ready';
  $('attemptStatus').classList.toggle('active', !!running);
  $('calibrate').disabled = !connected || !t || !!t.session.calibrationEndsAt || !!t.session.runEndsAt;
  $('startSession').disabled = !connected || !t || !!t.session.runEndsAt;
  $('startAttempt').disabled = !connected || !t || !(t.session.runEndsAt > now()) || t.attempts.length >= 4 || !!running || !!pending;
  $('stopAttempt').disabled = !connected || !running;
  $('saveScore').disabled = !connected;
  $('announce').disabled = !connected || !state.leaderboard.length || state.teams.some(t => t.session.runEndsAt > now() || t.attempts.some(a => a.status !== 'scored'));
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
    if (message.type === 'FULL_STATE') { state = message.state; offset = state.serverTime - Date.now(); page === 'admin' ? renderAdmin() : renderDisplay(); }
    if (message.type === 'ERROR' || message.type === 'SUCCESS') {
      const request = requests.get(message.requestId);
      if (request) { clearTimeout(request.timeout); requests.delete(message.requestId); }
      if (message.type === 'ERROR') notify(message.message, true);
      else {
        notify(request?.success || 'Changes saved.');
        if (message.action === 'ADD_TEAM') { $('addTeamForm').reset(); $('addTeamForm').classList.add('hidden'); }
        if (message.action === 'EDIT_ATTEMPT' || message.action === 'SAVE_ATTEMPT') { edit = null; formKey = null; renderForm(); }
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
  $('calibrate').onclick = () => send('START_CALIBRATION', {}, 'Two-minute calibration started.');
  $('startSession').onclick = async () => { if (current() && await confirmAction(`Start ${current().name}’s continuous 10-minute run window? It cannot be paused or restarted.`, 'Start run window')) send('START_SESSION', {}, 'Ten-minute run window started.'); };
  $('startAttempt').onclick = () => send('START_ATTEMPT', {}, 'Attempt started.');
  $('stopAttempt').onclick = () => send('STOP_ATTEMPT', {}, 'Attempt stopped. Enter all three judges’ totals.');
  for (let i = 1; i <= 3; i++) $(`judge${i}`).addEventListener('input', updateTotal);
  $('scoreForm').onsubmit = e => {
    e.preventDefault(); const a = edit ? current()?.attempts.find(a => a.number === edit.number) : pendingAttempt(); if (!a) return;
    send(edit ? 'EDIT_ATTEMPT' : 'SAVE_ATTEMPT', { number: a.number, revision: a.revision, scores: [1, 2, 3].map(i => Number($(`judge${i}`).value)), completed: $('completed').checked, ...(edit ? { time: Math.round(Number($('editTime').value) * 1000) } : {}) }, edit ? 'Attempt correction saved.' : 'Attempt saved.');
  };
  $('attempts').onclick = e => { const button = e.target.closest('[data-edit]'); if (button) { if (pendingAttempt()) return notify('Score the pending attempt before editing a previous one.', true); edit = { number: Number(button.dataset.edit) }; formKey = null; renderForm(); $('scoreForm').scrollIntoView({ block: 'center' }); } };
  $('cancelEdit').onclick = () => { edit = null; formKey = null; renderForm(); };
  $('showRules').onclick = () => send('SET_VIEW', { view: 'rules' }, 'Course map and rules are now on the public display.');
  $('showLive').onclick = () => send('SET_VIEW', { view: 'live' }, 'Live timing is now on the public display.');
  $('announce').onclick = async () => { if (await confirmAction('Announce the current first-place result on the public display?', 'Announce winner')) send('ANNOUNCE_WINNER', {}, 'Results announced.'); };
  // Keep the initial empty state safe before the first connection arrives.
  for (const id of ['calibrate', 'startSession', 'startAttempt', 'stopAttempt', 'announce']) $(id).disabled = true;
}
if (page === 'admin' || page === 'display') connect();
