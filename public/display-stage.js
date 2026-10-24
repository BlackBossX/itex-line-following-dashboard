/* Audience-only presentation. Never changes competition state or clocks. */
(function () {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const jobs = new Set();
  let frame = null, finishDraw = null, timerKey = null, winnerRoot = null;
  function later(callback, delay) {
    const job = setTimeout(() => { jobs.delete(job); callback(); }, delay);
    jobs.add(job); return job;
  }
  function reset() {
    winnerRoot = null;
    finishDraw?.(); finishDraw = null;
    document.querySelectorAll('.celebrating, .is-celebration-burst').forEach(root => root.classList.remove('celebrating', 'is-celebration-burst'));
    jobs.forEach(clearTimeout); jobs.clear();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    document.querySelectorAll('.stage-confetti').forEach(canvas => canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height));
  }
  function confetti(root) {
    const canvas = root.querySelector('.stage-confetti');
    if (!canvas || motion.matches || document.visibilityState === 'hidden') return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const width = root.clientWidth, height = Math.min(root.clientHeight, window.innerHeight || 1000), ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = width * ratio; canvas.height = height * ratio;
    ctx.scale(ratio, ratio);
    const particles = Array.from({ length: width < 600 ? 45 : 90 }, (_, i) => ({
      x: width * (i % 2 ? 0.12 : 0.88), y: height * 0.56,
      vx: (i % 2 ? 1 : -1) * (80 + Math.random() * 240), vy: -160 - Math.random() * 360,
      rotation: Math.random() * 6, spin: Math.random() * 6 - 3, color: ['#e4c38a','#7bc5db','#edf2f7'][i % 3], size: 4 + Math.random() * 5
    }));
    let start = null, previous = null;
    function paint(stamp) {
      if (start === null) start = stamp;
      const dt = Math.min((stamp - (previous ?? stamp)) / 1000, 0.035); previous = stamp;
      ctx.clearRect(0, 0, width, height);
      if (!root.isConnected || document.visibilityState === 'hidden' || motion.matches || stamp - start > 3500) { frame = null; return; }
      const opacity = Math.min(1, (3500 - (stamp - start)) / 800);
      particles.forEach(p => {
        p.vy += 270 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rotation += p.spin * dt;
        ctx.save(); ctx.globalAlpha = opacity; ctx.fillStyle = p.color; ctx.translate(p.x,p.y); ctx.rotate(p.rotation);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore();
      });
      frame = requestAnimationFrame(paint);
    }
    frame = requestAnimationFrame(paint);
  }
  function celebrationCycle() {
    const root = winnerRoot;
    if (!root?.isConnected || motion.matches || document.visibilityState === 'hidden') return;
    root.classList.remove('is-celebration-burst'); void root.offsetWidth; root.classList.add('is-celebration-burst');
    confetti(root);
    later(() => root.classList.remove('celebrating', 'is-celebration-burst'), 3800);
    // Only the first announcement plays a fanfare, via sound.onState.
    later(celebrationCycle, 7000);
  }
  function celebrate(root) {
    reset();
    if (!root?.isConnected) return;
    winnerRoot = root;
    if (!motion.matches && document.visibilityState !== 'hidden') root.classList.add('celebrating');
    celebrationCycle();
  }
  function draw(root, names) {
    reset();
    const rows = Array.from(root.querySelectorAll('[data-draw-row]'));
    const status = root.querySelector('[data-draw-status]');
    if (!rows.length) return;
    let finished = false;
    const lock = (row, index, audible) => {
      row.querySelector('[data-draw-name]').textContent = names[index];
      row.classList.remove('is-rolling'); row.classList.add('is-locked');
      row.querySelector('[data-lock]').textContent = 'Locked';
      if (audible) window.CompetitionSound?.play('drawLock');
    };
    const finish = (audible = false) => {
      if (finished) return; finished = true;
      rows.forEach((row,i) => lock(row,i,false));
      root.dataset.drawing = 'false'; root.setAttribute('aria-busy','false');
      if (status) status.textContent = 'Running order confirmed';
      if (audible) window.CompetitionSound?.play('drawFinish');
    };
    finishDraw = () => finish(false);
    if (motion.matches || document.visibilityState === 'hidden') { finish(); return; }
    root.dataset.drawing = 'true'; root.setAttribute('aria-busy','true');
    if (status) status.textContent = 'Drawing the running order…';
    const total = 2300, spacing = Math.min(230, 1300 / rows.length);
    rows.forEach((row,i) => {
      row.classList.add('is-rolling'); row.classList.remove('is-locked');
      row.querySelector('[data-lock]').textContent = 'Drawing';
      const end = Math.min(total, 700 + i * spacing);
      let tick = i;
      const roll = elapsed => {
        if (finished || !root.isConnected) return;
        if (elapsed >= end) { lock(row,i,true); return; }
        row.querySelector('[data-draw-name]').textContent = names[(tick++ + i) % names.length];
        if (i === 0) window.CompetitionSound?.play('drawTick');
        later(() => roll(elapsed + 80), 80);
      };
      roll(0);
    });
    later(() => { finish(true); finishDraw = null; }, Math.min(total, 700 + (rows.length - 1) * spacing) + 180);
  }
  function timer(mode, key) {
    const root = document.querySelector('.audience-live');
    if (!root) return;
    root.dataset.timing = mode;
    if (timerKey === key) return;
    timerKey = key;
    root.classList.remove('timing-change'); void root.offsetWidth; root.classList.add('timing-change');
  }
  function suspendCelebration() {
    const root = winnerRoot; reset(); winnerRoot = root;
  }
  function resumeCelebration() {
    if (winnerRoot?.isConnected && !motion.matches && document.visibilityState !== 'hidden') later(celebrationCycle, 7000);
  }
  document.addEventListener('visibilitychange', () => {
    const hidden = document.visibilityState === 'hidden';
    document.body.classList.toggle('stage-hidden', hidden);
    if (hidden) suspendCelebration(); else resumeCelebration();
  });
  motion.addEventListener?.('change', () => { suspendCelebration(); resumeCelebration(); });
  window.ITEXStage = { reset, draw, timer, celebrate, isDrawing: () => document.querySelector('.team-order-stage')?.dataset.drawing === 'true' };
})();
