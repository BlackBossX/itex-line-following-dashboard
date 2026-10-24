const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function setup(reduced = false) {
  let elapsed = 0, nextId = 0; const tasks = new Map(), cues = [], events = {}, classes = new Set();
  const classList = () => { const entries = new Set(), additions = []; return { additions, add: (...names) => { additions.push(...names); names.forEach(n => entries.add(n)); }, remove: (...names) => names.forEach(n => entries.delete(n)), contains: n => entries.has(n) }; };
  const rows = ['Alpha','Beta','Gamma'].map(name => {
    const text = { textContent: name }, lock = { textContent: 'Ready' };
    return { classList: classList(), querySelector: selector => selector === '[data-draw-name]' ? text : lock, text, lock };
  });
  const list = { classList: classList() };
  const status = { textContent: 'Ready' }, root = { isConnected: true, dataset: {}, classList: classList(), setAttribute() {}, querySelectorAll: () => rows, querySelector: selector => selector === '.public-team-order' ? list : selector === '[data-draw-status]' ? status : selector === '#displayShuffle' ? { removeAttribute() {} } : null };
  const preference = { matches: reduced, addEventListener: (name, fn) => { events.motion = fn; } };
  const window = { matchMedia: () => preference, CompetitionSound: { play: cue => cues.push(cue), celebrate: () => cues.push('winner') } };
  const document = { visibilityState: 'visible', body: { classList: { toggle: (n, v) => v ? classes.add(n) : classes.delete(n) } }, addEventListener: (name, fn) => { events[name] = fn; }, querySelectorAll: () => [], querySelector: selector => selector === '.team-order-stage' ? root : null };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/display-stage.js'),'utf8'), { window, document,
    setTimeout: (callback, delay) => { const id = ++nextId; tasks.set(id, { at: elapsed + delay, callback }); return id; },
    clearTimeout: id => tasks.delete(id), cancelAnimationFrame() {}, requestAnimationFrame() { throw new Error('Reduced-motion/confetti-free fixture must not start a canvas loop'); }
  });
  function advance(duration) { const end = elapsed + duration; while (tasks.size) { const [id, task] = [...tasks.entries()].sort((a,b) => a[1].at - b[1].at)[0]; if (task.at > end) break; tasks.delete(id); elapsed = task.at; task.callback(); } elapsed = end; }
  return { stage: window.ITEXStage, root, list, rows, status, cues, tasks, advance, events, document, preference };
}
test('the rolling shuffle settles into each server-confirmed name and completes without leaving timers running', () => {
  const env = setup(); env.stage.draw(env.root, ['Gamma','Alpha','Beta']);
  assert.equal(env.stage.isDrawing(), true);
  assert.ok(env.rows.every(r => r.classList.contains('is-rolling')));
  env.advance(3000);
  assert.deepEqual(env.rows.map(r => r.text.textContent), ['Gamma','Alpha','Beta']);
  assert.ok(env.rows.every(r => r.classList.contains('is-locked')));
  assert.equal(env.status.textContent, 'Running order confirmed'); assert.equal(env.stage.isDrawing(), false);
  assert.equal(env.cues.filter(c => c === 'drawLock').length, 3);
  assert.ok(env.cues.includes('drawTick'));
  assert.equal(env.tasks.size, 0); assert.equal(env.cues.filter(c => c === 'drawFinish').length, 1);
});
test('changing views or hiding the page restores final order and cancels the remaining draw work', () => {
  for (const hidden of [false,true]) {
    const env = setup(); env.stage.draw(env.root, ['Beta','Gamma','Alpha']); env.advance(200);
    if (hidden) { env.document.visibilityState = 'hidden'; env.events.visibilitychange(); } else env.stage.reset();
    const cueCount = env.cues.length; env.advance(4000);
    assert.deepEqual(env.rows.map(r => r.text.textContent), ['Beta','Gamma','Alpha']);
    assert.equal(env.tasks.size, 0); assert.equal(env.cues.length, cueCount); assert.equal(env.stage.isDrawing(), false);
  }
});
test('reduced motion presents the final order immediately with no spinning slots or decorative audio', () => {
  const env = setup(true); env.stage.draw(env.root, ['Gamma','Beta','Alpha']);
  assert.deepEqual(env.rows.map(r => r.text.textContent), ['Gamma','Beta','Alpha']);
  assert.equal(env.tasks.size, 0); assert.deepEqual(env.cues, []); assert.equal(env.stage.isDrawing(), false);
});
test('enabling reduced motion mid-draw settles the final order immediately', () => {
  const env = setup(); env.stage.draw(env.root, ['Beta','Alpha','Gamma']);
  env.preference.matches = true; env.events.motion(); env.advance(4000);
  assert.deepEqual(env.rows.map(r => r.text.textContent), ['Beta','Alpha','Gamma']); assert.equal(env.tasks.size, 0);
});

test('winner visuals repeat every seven seconds without replaying sound', () => {
  const env = setup(); env.stage.celebrate(env.root);
  const count = () => env.root.classList.additions.filter(n => n === 'is-celebration-burst').length;
  assert.equal(count(), 1); env.advance(6999); assert.equal(count(), 1);
  env.advance(1); assert.equal(count(), 2); env.advance(14000); assert.equal(count(), 4);
  assert.deepEqual(env.cues, []);
  assert.equal(env.root.classList.additions.filter(n => n === 'celebrating').length, 1, 'winner name reveals once and stays readable during recurring bursts');
  env.stage.reset(); const finalCount = count(); env.advance(21000);
  assert.equal(count(), finalCount); assert.equal(env.tasks.size, 0);
});
test('winner cycles stop while hidden and resume silently, and view changes cancel them', () => {
  const env = setup(); env.stage.celebrate(env.root); env.advance(1000);
  env.document.visibilityState = 'hidden'; env.events.visibilitychange(); assert.equal(env.tasks.size, 0);
  const count = () => env.root.classList.additions.filter(n => n === 'is-celebration-burst').length;
  env.advance(20000); assert.equal(count(), 1);
  env.document.visibilityState = 'visible'; env.events.visibilitychange(); env.advance(7000); assert.equal(count(), 2);
  assert.deepEqual(env.cues, []);
  env.stage.reset(); env.document.visibilityState = 'hidden'; env.events.visibilitychange();
  env.document.visibilityState = 'visible'; env.events.visibilitychange(); env.advance(20000); assert.equal(count(), 2);
});
test('reduced motion suppresses recurring winner animation and changing the preference cancels cycles', () => {
  const env = setup(true); env.stage.celebrate(env.root); env.advance(21000);
  assert.equal(env.root.classList.additions.filter(n => n === 'is-celebration-burst').length, 0);
  assert.equal(env.tasks.size, 0);
  env.preference.matches = false; env.events.motion(); env.advance(7000);
  assert.equal(env.root.classList.additions.filter(n => n === 'is-celebration-burst').length, 1);
  env.preference.matches = true; env.events.motion(); assert.equal(env.tasks.size, 0);
});
