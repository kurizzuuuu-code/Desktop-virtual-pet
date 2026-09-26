/* Virtual Pet — prank overlay renderer.
 * One effect per window. Runs the visuals + synthesized sound, then asks the
 * main process to close the window. Everything here is a harmless visual
 * prank except "realShutdown", which drives the OS shutdown countdown that
 * main.js has already started (and which stays cancellable). */

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const effect = params.get('effect') || 'glitch';
  const chainToScare = params.get('chain') === '1';
  const delaySec = Math.max(3, Math.min(180, parseInt(params.get('delay') || '20', 10) || 20));
  const petName = params.get('name') || 'Pet';
  const avatar = params.get('avatar') || '';
  const soundUrl = params.get('sound') || '';
  const shutdownOk = params.get('shutdownOk') !== '0';
  const volume = Math.max(0, Math.min(100, parseInt(params.get('volume') || '70', 10) || 70)) / 100;

  let lines = [];
  try {
    const parsed = JSON.parse(params.get('lines') || '[]');
    if (Array.isArray(parsed)) lines = parsed.filter((l) => typeof l === 'string' && l.trim());
  } catch (_) {}

  const LINE_FALLBACKS = ['hehe~', 'something feels off…', 'I see you', 'watch this', 'boo~'];
  function pickLine() {
    const pool = lines.length ? lines : LINE_FALLBACKS;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  const $ = (id) => document.getElementById(id);
  const root = $('prank-root');

  /* ------------------------------------------------------------------ audio */

  let ctx = null;
  let master = null;

  function audio() {
    if (ctx) return ctx;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    } catch (_) {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function noiseBuffer(seconds) {
    const c = audio();
    if (!c) return null;
    const len = Math.max(1, Math.floor(c.sampleRate * seconds));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function tone(freq, duration, opts) {
    const c = audio();
    if (!c) return;
    const o = opts || {};
    const t0 = c.currentTime + (o.at || 0);
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + duration);
    const peak = o.gain == null ? 0.25 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g);
    g.connect(master || c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  function noiseBurst(duration, opts) {
    const c = audio();
    if (!c) return;
    const o = opts || {};
    const buf = noiseBuffer(duration + 0.05);
    if (!buf) return;
    const t0 = c.currentTime + (o.at || 0);
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = o.filter || 'bandpass';
    filter.frequency.setValueAtTime(o.from || 400, t0);
    if (o.to) filter.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + duration);
    filter.Q.value = o.q == null ? 1.1 : o.q;
    const g = c.createGain();
    const peak = o.gain == null ? 0.3 : o.gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(master || c.destination);
    src.start(t0);
    src.stop(t0 + duration + 0.05);
  }

  function playScreech() {
    // Layered noise + detuned saws: the classic "holy crap" stinger.
    noiseBurst(1.25, { from: 5200, to: 320, gain: 0.6, q: 0.8 });
    noiseBurst(0.6, { from: 900, to: 120, gain: 0.45, filter: 'lowpass' });
    tone(1180, 0.95, { type: 'sawtooth', to: 180, gain: 0.34 });
    tone(1237, 0.95, { type: 'sawtooth', to: 190, gain: 0.24 });
    tone(62, 1.3, { type: 'triangle', gain: 0.4 });
  }

  function playStatic(totalMs) {
    let played = 0;
    const step = 190;
    const tick = () => {
      const remaining = totalMs - played;
      if (remaining <= 0) return;
      noiseBurst(0.16, { from: 1400 + Math.random() * 5200, to: 320, gain: 0.12, q: 0.7 });
      if (Math.random() < 0.35) tone(70 + Math.random() * 220, 0.12, { type: 'square', gain: 0.06 });
      played += step;
      setTimeout(tick, step);
    };
    tick();
  }

  function playShutdownChime() {
    tone(784, 0.28, { type: 'sine', gain: 0.3 });
    tone(587, 0.42, { type: 'sine', gain: 0.28, at: 0.22 });
    tone(196, 0.9, { type: 'triangle', gain: 0.22, at: 0.5 });
  }

  function playCustomSound() {
    if (!soundUrl) return false;
    try {
      const el = new Audio(soundUrl);
      el.volume = volume;
      el.play().catch(() => {});
      return true;
    } catch (_) {
      return false;
    }
  }

  /* ----------------------------------------------------------------- finish */

  let finished = false;
  function done() {
    if (finished) return;
    finished = true;
    try {
      window.petAPI.prankDone(effect);
    } catch (_) {
      window.close();
    }
  }

  function abort() {
    if (finished) return;
    finished = true;
    try {
      window.petAPI.prankAbort(effect);
    } catch (_) {
      window.close();
    }
  }

  function hideAll() {
    document.querySelectorAll('.fx').forEach((el) => { el.hidden = true; });
  }

  function show(id) {
    hideAll();
    const el = $(id);
    if (el) el.hidden = false;
    return el;
  }

  /* -------------------------------------------------------------- fallback art */

  const CREEPY_FACE_SVG =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 400'>" +
      "<rect width='400' height='400' fill='#07070a'/>" +
      "<ellipse cx='200' cy='210' rx='132' ry='156' fill='#cfc6bd'/>" +
      "<ellipse cx='148' cy='176' rx='30' ry='40' fill='#0a0a0a'/>" +
      "<ellipse cx='252' cy='176' rx='30' ry='40' fill='#0a0a0a'/>" +
      "<path d='M120 262 Q200 340 280 262' stroke='#3a090c' stroke-width='16' fill='none' stroke-linecap='round'/>" +
      "<path d='M120 262 l18 40 l18 -32 l18 44 l18 -42 l18 40 l18 -32 l18 34 l18 -44 l18 36 l18 -30 l10 34' fill='#ffffff'/>" +
      "</svg>"
    );

  /* ---------------------------------------------------------------- effects */

  function runGlitch() {
    // Screen stays clean on purpose — the PET does the glitching
    // (flicker + teleport visuals on her own window).
    playStatic(2400);
    setTimeout(done, 2600);
  }

  function runJumpscare() {
    const el = show('fx-scare');
    const img = $('sc-img');
    const flash = $('sc-flash');
    const text = $('sc-text');
    if (text) text.textContent = pickLine().toUpperCase().slice(0, 24);

    if (img) {
      img.src = avatar || CREEPY_FACE_SVG;
      img.onerror = () => { img.src = CREEPY_FACE_SVG; };
    }

    setTimeout(() => {
      el.classList.add('sc-on');
      if (flash) {
        flash.classList.add('sc-hit');
        setTimeout(() => flash.classList.remove('sc-hit'), 380);
      }
      if (!playCustomSound()) playScreech();
    }, 240);

    setTimeout(() => {
      el.classList.remove('sc-on');
      el.style.background = '#000';
      if (avatar && img) img.style.opacity = '0';
      setTimeout(done, 200);
    }, 1650);
  }

  function runBlackout(thenScare) {
    show('fx-black');
    playStatic(900);
    const creep = setTimeout(() => {
      const el = $('fx-black');
      if (el) el.classList.add('bk-creep');
      const hint = $('bk-hint');
      if (hint) hint.textContent = `don't look behind you`;
    }, 800);

    setTimeout(() => {
      clearTimeout(creep);
      if (thenScare) runJumpscare();
      else done();
    }, 2100 + Math.random() * 1200);
  }

  function runFakeShutdown() {
    show('fx-fakesd');
    playShutdownChime();
    const text = $('sd-text');
    const sub = $('sd-sub');

    setTimeout(() => {
      if (text) text.textContent = 'Shutting down...';
    }, 0);

    setTimeout(() => {
      if (text) text.textContent = 'A problem is preventing Windows from shutting down';
      if (sub) {
        sub.textContent = `${petName} is refusing to close (error 0xPET)`;
        sub.classList.add('sd-error');
      }
      tone(220, 0.4, { type: 'square', gain: 0.2 });
    }, 5200);

    setTimeout(() => {
      if (text) text.textContent = 'Just kidding :)';
      if (sub) {
        sub.textContent = pickLine();
        sub.classList.remove('sd-error');
      }
      playShutdownChime();
    }, 7600);

    setTimeout(done, 10200);
  }

  function runBsod() {
    show('fx-bsod');
    playShutdownChime();
    setTimeout(done, 9000);
  }

  function runRealShutdown() {
    show('fx-realsd');
    const countEl = $('rs-count');
    const note = $('rs-note');

    if (!shutdownOk) {
      if (note) {
        note.textContent = 'Windows refused the shutdown command (no permission), so this countdown is fake. Press Esc to close.';
        note.classList.add('rs-ok');
      }
    } else {
      playShutdownChime();
    }

    let left = delaySec;
    if (countEl) countEl.textContent = String(left);

    const timer = setInterval(() => {
      left -= 1;
      if (countEl) countEl.textContent = String(Math.max(0, left));
      if (left <= 3 && left > 0) tone(880, 0.18, { type: 'square', gain: 0.22 });
      if (left <= 0) {
        clearInterval(timer);
        if (shutdownOk) done();
        else {
          // Nothing will happen — show the joke instead of hanging forever.
          if (note) note.textContent = `${petName} says: gotcha~`;
          setTimeout(done, 1800);
        }
      }
    }, 1000);
  }

  /* ------------------------------------------------------------------ input */

  $('rs-cancel').addEventListener('click', abort);
  document.addEventListener('click', () => { if (effect === 'realShutdown') abort(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') abort();
  });

  /* ------------------------------------------------------------------- boot */

  function boot() {
    audio();
    switch (effect) {
      case 'jumpscare': runJumpscare(); break;
      case 'blackout': runBlackout(chainToScare); break;
      case 'fakeShutdown': runFakeShutdown(); break;
      case 'bsod': runBsod(); break;
      case 'realShutdown': runRealShutdown(); break;
      case 'glitch':
      default: runGlitch(); break;
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
