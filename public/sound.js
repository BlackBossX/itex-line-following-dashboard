(function () {
  'use strict';
  const button = document.getElementById('soundToggle');
  if (!button || !window.ITEXAudioCues) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  let context = null, enabled = false, available = !!AudioContextClass;
  let previousState = null, latestState = null, previousTimer = null, lastTick = null, suppressedExpiryKey = null;
  const voices = new Set();
  function updateButton() {
    const ready = enabled && context?.state === 'running';
    button.textContent = !available ? 'Sound unavailable' : ready ? 'Sound on' : enabled ? 'Resume sound' : 'Enable sound';
    button.setAttribute('aria-pressed', String(ready));
    button.title = ready ? 'Mute timing sounds on this screen' : 'Enable timing sounds on this screen';
    button.disabled = !available;
  }
  function silence() {
    for (const oscillator of voices) { try { oscillator.stop(); } catch {} }
    voices.clear();
  }
  function note(frequency, delay, duration, volume = 0.12) {
    const oscillator = context.createOscillator(), envelope = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(volume, start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope); envelope.connect(context.destination);
    oscillator.onended = () => { voices.delete(oscillator); oscillator.disconnect(); envelope.disconnect(); };
    voices.add(oscillator); oscillator.start(start); oscillator.stop(start + duration + 0.01);
  }
  function play(cue) {
    if (!cue || !enabled || context?.state !== 'running' || document.visibilityState === 'hidden') return;
    try {
      if (cue === 'tick') { note(1400, 0, 0.035, 0.08); return; }
      silence();
      const tones = { start: [523.25, 783.99], pause: [523.25, 440], stop: [659.25, 440], finish: [659.25, 523.25, 392] }[cue];
      tones?.forEach((frequency, i) => note(frequency, i * 0.12, cue === 'finish' ? 0.24 : 0.16));
    } catch { enabled = false; silence(); updateButton(); }
  }
  button.addEventListener('click', async () => {
    if (enabled && context?.state === 'running') { enabled = false; silence(); updateButton(); return; }
    try {
      if (!context || context.state === 'closed') context = new AudioContextClass();
      context.onstatechange = updateButton;
      await context.resume(); enabled = true; updateButton(); play('start');
    } catch { enabled = false; updateButton(); }
  });
  window.CompetitionSound = {
    onState(next) {
      latestState = next;
      if (previousState) {
        const cue = window.ITEXAudioCues.transition(previousState, next);
        const timer = window.ITEXAudioCues.timerInfo(next, next.serverTime);
        if (cue === 'stop' && timer?.remaining === 0) suppressedExpiryKey = timer.key;
        play(cue);
      }
      previousState = next;
    },
    onClock(now, connected) {
      const timer = window.ITEXAudioCues.timerInfo(latestState, now);
      const warning = connected && timer && !timer.paused && !timer.ended && timer.remaining > 0 && timer.remaining <= 10000;
      document.body.classList.toggle('timer-warning', !!warning);
      if (!connected) { previousTimer = null; silence(); return; }
      if (timer) {
        const second = Math.ceil(timer.remaining / 1000);
        const tickKey = `${timer.key}:${second}`;
        if (warning && tickKey !== lastTick) { play('tick'); lastTick = tickKey; }
        if (previousTimer?.key === timer.key && previousTimer.remaining > 0 && timer.remaining === 0 && !timer.paused && !timer.ended && suppressedExpiryKey !== timer.key) play('finish');
      }
      previousTimer = timer;
    }
  };
  updateButton();
})();
