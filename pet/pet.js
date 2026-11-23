const petEl = document.getElementById('pet');
const petRoot = document.getElementById('pet-root');
const petInteract = document.getElementById('pet-interact');
const headHitbox = document.getElementById('head-hitbox');
const speechHitbox = document.getElementById('speech-hitbox');
const bodyHitbox = document.getElementById('body-hitbox');
const speechEl = document.getElementById('speech');
const debugBoundsEl = document.getElementById('debug-bounds');
const debugFloorEl = document.getElementById('debug-floor');
const petFallback = document.getElementById('pet-fallback');
const spriteWrap = document.getElementById('pet-sprite');
const rpsBar = document.getElementById('rps-bar');
const rpsPicks = document.getElementById('rps-picks');
const rpsVs = document.getElementById('rps-vs');
const rpsMe = document.getElementById('rps-me');
const rpsPetCard = document.getElementById('rps-pet');
const RPS_ICON = { rock: '✊', paper: '📄', scissors: '✂️' };
let spriteImg = document.getElementById('sprite-img');

const PET_W = 220;
const PET_H = 520;

// Main sizes the window from pet scale (big GIFs need bigger windows).
function WIN_W() {
  return config.winW || PET_W;
}
function WIN_H() {
  return config.winH || PET_H;
}

let config = {};
let state = 'idle';
let petBounds = { x: 0, y: 0, width: PET_W, height: PET_H };
let vx = 0;
let vy = 0;
let wanderTarget = null;
let walkPauseUntil = 0;
let nextPassingGreetAt = 0;
let petPersonality = null;
let thinkingTimer = null;

function getPersonality() {
  if (petPersonality) return petPersonality;
  const id = String(config.petId || 'pet-1');
  let h1 = 0;
  let h2 = 0;
  for (let i = 0; i < id.length; i++) {
    h1 = (h1 * 31 + id.charCodeAt(i)) >>> 0;
    h2 = (h2 * 37 + id.charCodeAt(i) * 7) >>> 0;
  }
  petPersonality = {
    energy: 0.85 + ((h1 % 1000) / 1000) * 0.35,
    curiosity: ((h2 % 1000) / 1000) * 0.4,
    sociability: (((h1 >> 3) % 1000 + 1000) % 1000) / 1000,
  };
  return petPersonality;
}
let petHoverMs = 0;
let lastAttack = 0;
let speechTimer = null;
let speechAudio = null;
let voiceQueue = [];
let voicePlaying = false;
// The line currently echoed in VTS subtitles, and whether it has a real voice.
// The caption lives until the audio's true end — not a text-length guess.
let captionText = '';
let captionVoiceLine = false;
let voiceDeadUntil = 0;
let nextVtsTalkAt = 0;
let nextVtsDanceAt = 0;
let cachedCursor = null;
let cursorFetchedAt = 0;
let voiceRecheckAt = 0;

function scheduleVoiceRecheck() {
  // One soft retry soon after a failure — the engine is often just still
  // loading models. Bounded so a truly broken engine doesn't spam checks.
  try {
    const now = Date.now();
    if (now < voiceRecheckAt) return;
    voiceRecheckAt = now + 15000;
    setTimeout(() => {
      try {
        checkVoiceEngine();
      } catch (_) {}
    }, 15000);
  } catch (_) {}
}
let voiceAudioEl = null;
let voiceResolve = null;
let voiceGen = 0;
// Fullscreen "system takes over" pranks silence the pets; the scare sounds
// themselves play from the overlay window, so they are unaffected.
let prankMuted = false;
const PRANK_MUTE_EFFECTS = new Set(['bsod', 'blackout', 'jumpscare', 'fakeShutdown', 'realShutdown']);

function stopVoice() {
  voiceGen++;
  voiceQueue = [];
  if (voiceAudioEl) {
    try {
      voiceAudioEl.onended = null;
      voiceAudioEl.onerror = null;
      voiceAudioEl.pause();
    } catch (_) {}
    voiceAudioEl = null;
  }
  if (speechAudio) {
    try {
      speechAudio.pause();
    } catch (_) {}
  }
  stopTextBleeps();
  blipPlaying = false;
  if (voiceResolve) {
    const r = voiceResolve;
    voiceResolve = null;
    r();
  }
  // A cut voice leaves the last MouthOpen value frozen in VTS (stuck jaw).
  // Shut it explicitly whenever voice is stopped.
  try {
    window.petAPI.vtsParam?.({ id: 'MouthOpen', value: 0 });
  } catch (_) {}
}

function cleanVoiceText(text) {
  const clean = String(text || '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/[*_#<>|`]/g, '')
    .trim()
    .slice(0, 140);
  return clean;
}

let blipPlaying = false;
let textBleepTimer = null;
let textBleepCtx = null;
let synthBleepOn = false;

// ONE shared AudioContext for this renderer. Chromium mixes every context in
// a renderer into a single Windows audio session, so opening/closing several
// (bleeps, mic analysis, music analysis, impact sfx) made the app's volume
// mixer level bounce around. One reused context = one steady session.
let sharedAudioCtx = null;
function getSharedAudioCtx() {
  try {
    if (sharedAudioCtx && sharedAudioCtx.state !== 'closed') {
      if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
      return sharedAudioCtx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    sharedAudioCtx = new AC();
    return sharedAudioCtx;
  } catch (_) {
    return null;
  }
}

let audioSleepTimer = null;
function scheduleAudioContextSleep() {
  if (audioSleepTimer) clearTimeout(audioSleepTimer);
  audioSleepTimer = setTimeout(() => {
    try {
      if (sharedAudioCtx && sharedAudioCtx.state === 'running' && !analyser && !isVoiceActive()) {
        sharedAudioCtx.suspend().catch(() => {});
      }
    } catch (_) {}
  }, 1200);
}
let sessionTextAnim = null; // chat "text anim <style>" override (session only)
let sessionPlayMode = null; // chat "play mode on/off" override (session only)
let scheduleSleeping = false; // goodnight schedule currently holding her asleep
let sleepSnoozeUntil = 0; // direct interaction pauses the schedule briefly

function isVoiceActive() {
  return voicePlaying || !!voiceAudioEl || blipPlaying;
}

// Run fn once no voice is playing (so two pets never talk over each other).
function afterVoiceQuiet(fn, timeoutMs = 8000) {
  const start = Date.now();
  const tick = () => {
    if (!isVoiceActive() || Date.now() - start > timeoutMs) {
      try {
        fn();
      } catch (_) {}
      return;
    }
    setTimeout(tick, 300);
  };
  tick();
}

function requestVoice(text, isChatter, isReaction) {
  if (!config.voiceVoxEnabled || Date.now() < voiceDeadUntil) return false;
  // The reactions toggle is specific, so it wins over the general idle-only
  // mode for reaction lines.
  if (isReaction ? config.voiceVoxReactions === false : config.voiceVoxIdleOnly && !isChatter) return false;
  const clean = cleanVoiceText(text);
  if (!clean) return false;
  if (voiceQueue.length > 2) return true;
  voiceQueue.push(clean);
  pumpVoiceQueue();
  return true;
}

// No audio came back for this caption's line: show it briefly instead of
// holding it for the 30s safety fallback.
function ttsFailedForCaption(text) {
  if (text !== captionText || !captionVoiceLine) return;
  captionVoiceLine = false;
  try {
    window.petAPI.reportSpeech?.({ text: captionText, ms: 4500, hold: false });
  } catch (_) {}
}

async function pumpVoiceQueue() {
  if (voicePlaying || !voiceQueue.length) return;
  voicePlaying = true;
  const myGen = voiceGen;
  const text = voiceQueue.shift();
  try {
    const res = await window.petAPI.speakText(text, config.petId);
    if (myGen !== voiceGen) {
      voicePlaying = false;
      pumpVoiceQueue();
      return;
    }
    if (res?.url) {
      await new Promise((resolve) => {
        voiceResolve = resolve;
        let lipTimer = null;
        const stopLip = () => {
          if (lipTimer) {
            clearInterval(lipTimer);
            lipTimer = null;
          }
          try {
            window.petAPI.vtsParam?.({ id: 'MouthOpen', value: 0 });
          } catch (_) {}
        };
        let started = false;
        const done = () => {
          stopLip();
          voiceResolve = null;
          voiceAudioEl = null;
          if (text === captionText && captionVoiceLine) {
            captionVoiceLine = false;
            if (started) {
              try {
                window.petAPI.reportSpeechEnd?.();
              } catch (_) {}
            } else {
              // Nothing ever played: keep the caption readable briefly instead
              // of leaving it stuck (or vanishing instantly).
              try {
                window.petAPI.reportSpeech?.({ text: captionText, ms: 4500, hold: false });
              } catch (_) {}
            }
          }
          resolve();
        };
        try {
          const a = new Audio(res.url);
          voiceAudioEl = a;
          a.onplaying = () => {
            started = true;
          };
          // Once the clip's true length is known, re-time the VTS caption to
          // match it exactly (cold TTS synthesis can outlast the old guess).
          a.onloadedmetadata = () => {
            try {
              if (voiceAudioEl !== a || text !== captionText) return;
              const d = Number(a.duration);
              if (isFinite(d) && d > 0.2) {
                window.petAPI.reportSpeech?.({ text, ms: Math.round(d * 1000) + 700, hold: false });
              }
            } catch (_) {}
          };
          try {
            lipTimer = setInterval(() => {
              try {
                const v = 0.15 + 0.7 * Math.abs(Math.sin(Date.now() / 95));
                window.petAPI.vtsParam?.({ id: 'MouthOpen', value: v });
              } catch (_) {}
            }, 90);
          } catch (_) {}
          a.volume = Math.max(0, Math.min(1, (config.voiceVoxVolume ?? 100) / 100));
          a.onended = done;
          a.onerror = done;
          a.play().catch(done);
          setTimeout(done, 15000);
        } catch (_) {
          done();
        }
      });
    } else {
      ttsFailedForCaption(text);
      voiceDeadUntil = Date.now() + 60000;
      scheduleVoiceRecheck();
    }
  } catch (_) {
    ttsFailedForCaption(text);
    voiceDeadUntil = Date.now() + 60000;
    scheduleVoiceRecheck();
  }
  voicePlaying = false;
  pumpVoiceQueue();
}

async function checkVoiceEngine() {
  if (!config.voiceVoxEnabled) return;
  try {
    const res = await window.petAPI.voxTest();
    if (!res?.ok) voiceDeadUntil = Date.now() + 60000;
    else {
      // Engine answered: lift any mute immediately instead of sitting out
      // the rest of the 60s penalty.
      voiceDeadUntil = 0;
      warmVoiceCache();
    }
  } catch (_) {}
}

// Boot warmup: synthesize her most-likely lines in the background (no
// playback) so the TTS cache is hot before she actually talks. First lines
// after app open otherwise each pay full synthesis one by one.
let voiceWarmed = false;
function warmVoiceCache() {
  if (voiceWarmed || !config.voiceVoxEnabled || !window.petAPI?.speakText) return;
  voiceWarmed = true;
  try {
    const name = config.name || 'Mochi';
    const keys = ['textGreet', 'textVictory', 'textGameFail', 'textPet', 'textAttack', 'textGrab', 'textProactive', 'textSocial'];
    const seen = new Set();
    const lines = [];
    for (const k of keys) {
      let line = '';
      const raw = config[k];
      if (raw && typeof raw === 'string' && raw.trim()) {
        line = raw.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
      }
      if (!line && Array.isArray(DEFAULT_SPEECH[k]) && DEFAULT_SPEECH[k].length) {
        line = DEFAULT_SPEECH[k][0];
      }
      line = String(line || '').replace(/\{name\}/g, name).trim();
      if (line && !seen.has(line)) {
        seen.add(line);
        lines.push(line);
      }
      if (lines.length >= 8) break;
    }
    setTimeout(() => {
      try {
        for (const line of lines) {
          window.petAPI.speakText(line, config.petId).catch(() => {});
        }
      } catch (_) {}
    }, 8000);
  } catch (_) {}
}

function resolveSpeechSoundUrl(slot) {
  const urls = config.soundUrls || {};
  if (slot && urls[slot]) return { url: urls[slot], idleOnly: false };
  if (config.speechSoundEnabled && config.soundUrl) {
    return { url: config.soundUrl, idleOnly: !!config.speechSoundIdleOnly };
  }
  return null;
}

function playSpeechSound(isChatter, slot) {
  const resolved = resolveSpeechSoundUrl(slot);
  if (!resolved) return;
  if (resolved.idleOnly && !isChatter) return;
  try {
    if (!speechAudio || speechAudio.dataset.src !== resolved.url) {
      speechAudio = new Audio(resolved.url);
      speechAudio.dataset.src = resolved.url;
      speechAudio.onended = () => {
        blipPlaying = false;
      };
      speechAudio.onerror = () => {
        blipPlaying = false;
      };
    }
    speechAudio.volume = Math.max(0, Math.min(1, (config.speechSoundVolume ?? 70) / 100));
    speechAudio.currentTime = 0;
    blipPlaying = true;
    speechAudio.play().catch(() => {
      blipPlaying = false;
    });
  } catch (_) {
    blipPlaying = false;
  }
}

// Undertale-style text bleeps, synthesized in code (no audio file needed).
// Plays when a line has no TTS voice and no custom speech sound — so she
// still "talks" audibly with TTS off. Pitch varies per pet.
function bleepBasePitch() {
  try {
    const id = String(config.petId || config.activePetId || 'pet');
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return 480 + (h % 5) * 90;
  } catch (_) {
    return 620;
  }
}

function stopTextBleeps() {
  if (textBleepTimer) {
    try {
      clearInterval(textBleepTimer);
    } catch (_) {}
    textBleepTimer = null;
  }
  // Shared context: never close it (other features use it) — just drop our ref.
  textBleepCtx = null;
  if (synthBleepOn) {
    synthBleepOn = false;
    blipPlaying = false;
  }
}

let bleepVol = 0.3;
let bleepBase = 620;
let typeTimer = null;
let typeState = null;

function ensureBleepCtx() {
  try {
    textBleepCtx = getSharedAudioCtx();
    return textBleepCtx;
  } catch (_) {
    return null;
  }
}

// Opens one synth-bleep session (shared by interval bleeps + typewriter).
function startBleepSession(text) {
  stopTextBleeps();
  if (config.textBleepsEnabled === false || prankMuted) return false;
  if (!String(text || '').replace(/\s+/g, '')) return false;
  const ctx = ensureBleepCtx();
  if (!ctx) return false;
  // Ceiling raised from 0.4 -> 0.6: quiet bleeps used to drag the app's
  // Windows session level down whenever they were the newest stream.
  bleepVol = Math.max(0, Math.min(1, (config.textBleepsVolume ?? config.speechSoundVolume ?? 70) / 100)) * 0.6;
  if (bleepVol <= 0) return false;
  bleepBase = bleepBasePitch();
  synthBleepOn = true;
  blipPlaying = true;
  return true;
}

// One short blip inside an open session.
function bleepOnce() {
  const ctx = textBleepCtx;
  if (!ctx || !synthBleepOn) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t = ctx.currentTime;
    o.type = 'square';
    o.frequency.setValueAtTime(bleepBase * (0.92 + Math.random() * 0.16), t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, bleepVol), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.08);
  } catch (_) {}
}

function playTextBleeps(text, ms) {
  if (!startBleepSession(text)) return;
  try {
    const dur = Math.min(Math.max(700, Number(ms) || 1500), 5000);
    const endAt = Date.now() + dur;
    textBleepTimer = setInterval(() => {
      if (!synthBleepOn || Date.now() > endAt) {
        stopTextBleeps();
        return;
      }
      bleepOnce();
    }, 85);
    setTimeout(() => stopTextBleeps(), dur + 150);
  } catch (_) {
    stopTextBleeps();
  }
}

function escapeHtmlLite(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function stopTypewriter() {
  if (typeTimer) {
    try {
      clearInterval(typeTimer);
    } catch (_) {}
    typeTimer = null;
  }
  typeState = null;
}

// Visual-novel typewriter: reveals the line letter by letter, one blip per
// step when audible. Style comes from textAnim (typewriter/pop/fade/wave/
// rainbow). Append-only so one-shot entrance animations don't replay.
// Returns true when typing started.
function startTypewriter(fullHtml, rawText, audible) {
  stopTypewriter();
  if (config.textTypewriterEnabled === false) return false;
  // Hide markdown markers while revealing; full formatting swaps in at end.
  const plain = String(rawText || '').replace(/\*\*|__|~~/g, '');
  const chars = [...plain];
  if (chars.length < 4) return false;
  const picked = sessionTextAnim || config.textAnim || 'pop';
  if (picked === 'off') return false;
  const mode = ['pop', 'fade', 'wave', 'rainbow'].includes(picked) ? picked : 'typewriter';
  const step = chars.length > 140 ? 3 : chars.length > 70 ? 2 : 1;
  let shown = 0;
  // Size the bubble for the FULL line up front so it never resizes (and
  // shakes) while the text reveals inside the fixed box.
  speechEl.innerHTML = fullHtml;
  fitSpeechZoneToText();
  speechEl.innerHTML = '';
  typeState = { full: fullHtml };
  const canBlip = audible && startBleepSession(rawText);
  typeTimer = setInterval(() => {
    if (!typeState) {
      try {
        clearInterval(typeTimer);
      } catch (_) {}
      typeTimer = null;
      return;
    }
    const next = Math.min(chars.length, shown + step);
    if (mode === 'typewriter') {
      speechEl.textContent += chars.slice(shown, next).join('');
    } else {
      const frag = document.createDocumentFragment();
      for (let k = shown; k < next; k++) {
        const sp = document.createElement('span');
        sp.className = 'ch ch-' + mode;
        sp.textContent = chars[k];
        if (mode === 'wave' || mode === 'rainbow') sp.style.animationDelay = (k * 45) + 'ms';
        if (mode === 'rainbow') sp.style.color = 'hsl(' + ((k * 14) % 360) + ',85%,60%)';
        frag.appendChild(sp);
      }
      speechEl.appendChild(frag);
    }
    shown = next;
    if (canBlip) bleepOnce();
    if (shown >= chars.length) {
      try {
        clearInterval(typeTimer);
      } catch (_) {}
      typeTimer = null;
      speechEl.innerHTML = typeState.full;
      typeState = null;
      fitSpeechZoneToText();
      if (canBlip) stopTextBleeps();
    }
  }, 28);
  return true;
}
// ---- Mic hearing: VAD on YOUR mic only, answers only to her name. ----
// Audio never leaves the mic→transcribe round-trip: capture utterance,
// transcribe via cloud STT, forget the audio. Nothing is recorded/stored.
let hearStream = null;
let hearDeviceId = '';
let hearRec = null;
let hearChunks = [];
let hearSpeaking = false;
let hearStartAt = 0;
let hearSilenceAt = 0;
let hearCtx = null;
let hearAnalyser = null;
let hearTimer = null;
let hearCooldownUntil = 0;
let hearTickBusy = false;
let hearRetryAt = 0;
let hearFloor = null;
let hearFloorSamples = [];

const HEAR_RMS_START = 0.025;
const HEAR_RMS_QUIET = 0.012;
const HEAR_SILENCE_MS = 1200;
const HEAR_MAX_MS = 10000;
const HEAR_MIN_MS = 400;

function hearWant() {
  return config.voiceHearEnabled === true && petActive && !isGrabbing;
}

function stopHearStream() {
  if (hearRec && hearRec.state !== 'inactive') {
    try {
      hearRec.stop();
    } catch (_) {}
  }
  hearRec = null;
  hearChunks = [];
  hearSpeaking = false;
  if (hearStream) {
    try {
      hearStream.getTracks().forEach((t) => t.stop());
    } catch (_) {}
  }
  hearStream = null;
  hearDeviceId = '';
  hearAnalyser = null;
}

async function ensureHearStream() {
  const wantId = String(config.hearMicDeviceId || '');
  if (hearStream && hearDeviceId === wantId) return true;
  if (Date.now() < hearRetryAt) return false;
  stopHearStream();
  hearFloor = null;
  hearFloorSamples = [];
  try {
    // AEC/AGC OFF on purpose: Chromium's echo-cancellation path is what flips
    // the app into Windows "communications" ducking (volume drops in the
    // mixer the moment she starts listening). We run our own VAD + denoise and
    // mute her while she talks, so the WebRTC processing isn't needed.
    const audio = wantId
      ? { deviceId: { exact: wantId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
    hearStream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    hearDeviceId = wantId;
    if (!hearCtx) {
      hearCtx = getSharedAudioCtx();
    }
    if (hearCtx) {
      try {
        if (hearCtx.state === 'suspended') hearCtx.resume().catch(() => {});
        const src = hearCtx.createMediaStreamSource(hearStream);
        hearAnalyser = hearCtx.createAnalyser();
        hearAnalyser.fftSize = 1024;
        src.connect(hearAnalyser);
      } catch (_) {
        hearAnalyser = null;
      }
    }
    return true;
  } catch (_) {
    hearStream = null;
    hearRetryAt = Date.now() + 5000;
    return false;
  }
}

// Adaptive trigger: measured room floor ×3.2, clamped, so quiet mics and
// noisy rooms both work without hand-tuning.
function hearStartThresh() {
  const f = typeof hearFloor === 'number' && hearFloor > 0 ? hearFloor : 0.005;
  return Math.max(0.008, Math.min(0.12, f * 3.2));
}

// Cheap denoise before encode/STT: 120Hz high-pass (kills hum, rumble,
// fan drone) + gentle downward expander for residual hash. Won't fix a
// LOUD room, but stops hiss from becoming hallucinated words.
function hearDenoise(mono, sampleRate) {
  const fc = 120;
  const alpha = Math.exp((-2 * Math.PI * fc) / Math.max(1000, sampleRate || 48000));
  let y1 = 0;
  let x1 = 0;
  for (let i = 0; i < mono.length; i++) {
    const x = mono[i];
    const y = alpha * (y1 + x - x1);
    x1 = x;
    y1 = y;
    mono[i] = y;
  }
  const gate = 0.012;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a < gate) mono[i] *= (a / gate) * 0.9;
  }
  return mono;
}

function hearQuietThresh() {
  return hearStartThresh() * 0.5;
}

function hearRMS() {
  if (!hearAnalyser) return 0;
  try {
    const buf = new Float32Array(hearAnalyser.fftSize);
    hearAnalyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  } catch (_) {
    return 0;
  }
}

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// WAV-encode 16kHz mono (what the STT endpoint wants) from a decoded blob.
function hearEncodeWav(audio) {
  const chans = audio.numberOfChannels;
  let mono = audio.getChannelData(0);
  if (chans > 1) {
    mono = new Float32Array(audio.length);
    for (let c = 0; c < chans; c++) {
      const d = audio.getChannelData(c);
      for (let i = 0; i < audio.length; i++) mono[i] += d[i] / chans;
    }
  }
  hearDenoise(mono, audio.sampleRate);
  const ratio = audio.sampleRate / 16000;
  const outLen = Math.max(1, Math.floor(mono.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = mono[Math.min(mono.length - 1, Math.floor(i * ratio))];
  const n = out.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const wstr = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 16000 * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, out[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}

async function hearProcessBlob(blob) {
  try {
    const ab = await blob.arrayBuffer();
    if (!ab || !ab.byteLength) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const dctx = new AC();
    let audio = null;
    try {
      audio = await dctx.decodeAudioData(ab);
    } catch (_) {}
    try {
      dctx.close();
    } catch (_) {}
    if (!audio || !audio.length) return;
    const b64 = hearEncodeWav(audio);
    const res = await window.petAPI.hearTranscribe?.(b64);
    if (!res?.ok || !res.text) return;
    hearHandleTranscript(res.text);
  } catch (_) {}
}

function hearWakeList() {
  const name = String(config.name || 'KURIZU').trim() || 'KURIZU';
  const extra = String(config.voiceWakeWords || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [name, 'wisteria', 'kurizu', 'gremlin', ...extra];
}

function parseDiscordIntent(text) {
  const s = String(text || '').trim();
  if (!s) return null;

  // 1. Join Discord: "hey wisteria join the discord", "join discord", "join voice", "join the vc"
  if (/^(?:join(?:\s+(?:the|my))?\s+(?:discord|voice|vc|call)|get\s+in(?:\s+(?:the|my))?\s+(?:discord|voice|vc|call)|connect(?:\s+to)?\s+(?:discord|voice|vc))$/i.test(s) ||
      /\bjoin(?:\s+(?:the|my))?\s+discord\b/i.test(s)) {
    return { action: 'join' };
  }

  // 2. Leave Discord: "leave discord", "leave voice", "disconnect"
  if (/^(?:leave(?:\s+(?:the|my))?\s+(?:discord|voice|vc|call)|disconnect(?:\s+from)?\s+(?:discord|voice|vc)|get\s+out\s+of\s+(?:discord|voice|vc))$/i.test(s) ||
      /\bleave(?:\s+(?:the|my))?\s+discord\b/i.test(s)) {
    return { action: 'leave' };
  }

  // 3. Stop / Pause
  if (/^(?:stop\s+(?:the\s+)?(?:music|song|playback)|pause\s+(?:the\s+)?(?:music|song)|shut\s+up|be\s+quiet)$/i.test(s)) {
    return { action: 'pause' };
  }

  // 4. Resume
  if (/^(?:resume\s+(?:the\s+)?(?:music|song)|continue\s+(?:the\s+)?(?:music|song)|unpause)$/i.test(s)) {
    return { action: 'resume' };
  }

  // 5. Skip
  if (/^(?:skip(?:\s+(?:the\s+)?(?:song|track|music))?|next\s+(?:song|track))$/i.test(s)) {
    return { action: 'skip' };
  }

  // 6. Play music: "play never gonna give you up", "play some music", "play lofi"
  const playMatch = s.match(/^(?:play|put\s+on|queue)\s+(.+)$/i);
  if (playMatch) {
    let query = playMatch[1].trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+(?:on|in)\s+(?:discord|voice|vc)$/i, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/^[?\s,.:;!]+|[?\s,.:;!]+$/g, '')
      .trim();
    if (!query || query === 'music' || query === 'some music' || query === 'a song') {
      query = 'chill lofi hip hop beats to relax/study to';
    }
    return { action: 'play', query };
  }

  return null;
}

// Returns { hit, cmd }: hit when her name (or an alias) is in the
// transcript — STT mangles names ("KURIZU" → "Corisoo"), so aliases
// from settings are matched too, and the matched word is stripped.
function hearStripWake(raw) {
  let text = String(raw || '').trim();
  let cmd = text;
  let hit = false;

  // Direct discord action check: e.g. "join discord", "play never gonna give you up"
  if (/^(?:hey\s+)?(?:join(?:\s+the)?\s+discord|play\s+.+|stop\s+music|pause\s+music|skip\s+song)\b/i.test(text)) {
    hit = true;
  }

  // Strip conversational openers first: "hey", "hi", "hello", "yo", "ok", "okay", "please"
  const strippedOpener = cmd.replace(/^(?:hey|hi|hello|yo|ok|okay|please|can you|could you)\s+/i, '');

  for (const w of hearWakeList()) {
    let rx = null;
    try {
      rx = new RegExp(`\\b${escapeRegExp(w)}\\b`, 'i');
    } catch (_) {
      continue;
    }
    if (rx.test(cmd)) {
      hit = true;
      cmd = cmd.replace(rx, '');
    } else if (rx.test(strippedOpener)) {
      hit = true;
      cmd = strippedOpener.replace(rx, '');
    }
  }

  cmd = cmd
    .replace(/^(?:hey|hi|hello|yo|ok|okay|please|can you|could you)\s+/i, '')
    .replace(/^[\s,.:;!?-]+|[\s,.:;!?-]+$/g, '')
    .trim();

  return { hit, cmd };
}

function hearHandleTranscript(raw) {
  const { hit, cmd } = hearStripWake(raw);
  if (!hit) return; // not talking to her — ignore.
  hearCooldownUntil = Date.now() + 1500;
  // Detected voice/wake word: pause movement and trigger thinking animation (no speech bubble)
  try {
    vx = 0;
    vy = 0;
    if (isWandering) endWanderSession();
    clearIdleActivity();
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
    setAnimOverride('thinking');
    thinkingTimer = setTimeout(() => {
      clearAnimOverride();
      thinkingTimer = null;
    }, cmd ? 60000 : 6000);
  } catch (_) {}
  if (!cmd) return;
  try {
    if (typeof window.__hearCommand === 'function') window.__hearCommand(cmd);
  } catch (_) {}
}

// Called on a 120ms tick; safe to run unconditionally (self-gates).
// Overlap-guarded: stream acquisition is slow, ticks must not pile up.
async function hearTick() {
  if (hearTickBusy) return;
  hearTickBusy = true;
  try {
    await hearTickInner();
  } finally {
    hearTickBusy = false;
  }
}

async function hearTickInner() {
  if (!hearWant()) {
    if (hearStream) stopHearStream();
    return;
  }
  if (Date.now() < hearCooldownUntil) return;
  if (!(await ensureHearStream())) return;
  // Mute while SHE talks so she never hears herself.
  if (isVoiceActive()) {
    if (hearRec && hearRec.state !== 'inactive') {
      try {
        hearRec.stop();
      } catch (_) {}
      hearRec = null;
      hearChunks = [];
    }
    hearSpeaking = false;
    return;
  }
  const rms = hearRMS();
  const now = Date.now();
  if (!hearSpeaking) {
    // First ~1s on a fresh stream: learn the room's noise floor.
    if (hearFloor === null) {
      hearFloorSamples.push(rms);
      if (hearFloorSamples.length >= 9) {
        const avg = hearFloorSamples.reduce((a, b) => a + b, 0) / hearFloorSamples.length;
        hearFloor = Math.max(0.001, avg);
        hearFloorSamples = [];
      }
      return;
    }
    if (rms > hearStartThresh()) {
      try {
        hearChunks = [];
        hearRec = new MediaRecorder(hearStream);
        hearRec.ondataavailable = (e) => {
          if (e.data && e.data.size) hearChunks.push(e.data);
        };
        hearRec.onstop = () => {
          const chunks = hearChunks;
          hearChunks = [];
          hearRec = null;
          hearSpeaking = false;
          const dur = Date.now() - hearStartAt;
          if (dur >= HEAR_MIN_MS && chunks.length) {
            hearProcessBlob(new Blob(chunks, { type: 'audio/webm' }));
          }
        };
        hearStartAt = now;
        hearSilenceAt = 0;
        hearSpeaking = true;
        hearRec.start(250);
        // Wake the chat brain NOW so it's hot by reply time (overlaps STT).
        try {
          window.petAPI.warmBrain?.();
        } catch (_) {}
      } catch (_) {
        hearSpeaking = false;
        hearRec = null;
      }
    }
    return;
  }
  if (rms < hearQuietThresh()) {
    if (!hearSilenceAt) hearSilenceAt = now;
  } else {
    hearSilenceAt = 0;
  }
  if ((hearSilenceAt && now - hearSilenceAt > HEAR_SILENCE_MS) || now - hearStartAt > HEAR_MAX_MS) {
    try {
      if (hearRec && hearRec.state !== 'inactive') hearRec.stop();
    } catch (_) {}
    hearRec = null;
    hearSpeaking = false;
  }
}

function setupHearLoop() {
  if (hearTimer) return;
  hearTimer = setInterval(() => {
    hearTick().catch(() => {});
  }, 120);
}
setupHearLoop();

let wanderSessionEnd = 0;
let wanderSessionTotalMs = 0;
let isWandering = false;
let petActive = false;
let currentAnimKey = 'idle';
let attackAnimTimer = null;
let isGrabbing = false;
let grabMoveWatch = null;
let touchGrab = null;
let isDancing = false;
let danceHoldUntil = 0;
let nextChatterAt = Date.now() + 20000;
let nextRandomAttackAt = Date.now() + 8000;
let nextPrankCheckAt = Date.now() + 10000;
let prankReactionTimer = null;
let prankFlicker = 0;
let nextIdleActivityAt = Date.now() + 12000;
let idleActivity = null;
let idleActivityEnd = 0;
let shuffleTarget = null;

let lowImpactMode = false;
let gameLoopRafId = 0;
let gameLoopTimer = null;
const GAME_LOOP_IDLE_MS = 450;
let lastHitReportAt = 0;
let deathReactionUntil = 0;
let deathSitTimer = 0;

let audioContext = null;
let analyser = null;
let micStream = null;
let smoothedAudioLevel = 0;
let audioNoiseFloor = 0;
let audioCalibrating = false;
let audioCalibrateUntil = 0;
let audioCalibrateBuf = [];
let centralAudioConnected = false;
let centralAudioLevel = 0;

const LOOPBACK_LABEL =
  /stereo mix|stereomix|what u hear|wave out|loopback|cable output|vb-audio|voicemeeter|virtual cable|desktop audio|system audio|monitor|internal audio|line out|speakers?\s*\(/i;
const MIC_LABEL =
  /microphone|mic array|webcam|headset mic|hands-?free|jabra|(\bmic\b)/i;

function isLoopbackAudioLabel(label) {
  const L = (label || '').trim();
  if (!L) return false;
  if (MIC_LABEL.test(L) && !LOOPBACK_LABEL.test(L)) return false;
  return LOOPBACK_LABEL.test(L);
}

async function resolveAudioDeviceId() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === 'audioinput');
  if (config.audioInputDeviceId) {
    const chosen = inputs.find((d) => d.deviceId === config.audioInputDeviceId);
    if (chosen) return chosen.deviceId;
  }
  const loopback = inputs.find((d) => isLoopbackAudioLabel(d.label));
  return loopback ? loopback.deviceId : '';
}

async function captureDefaultSpeakerStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: true,
    video: true,
    systemAudio: 'include',
  });
  stream.getVideoTracks().forEach((t) => {
    t.stop();
    stream.removeTrack(t);
  });
  if (!stream.getAudioTracks().length) {
    stream.getTracks().forEach((t) => t.stop());
    return null;
  }
  return stream;
}

async function captureFallbackLoopbackStream() {
  const deviceId = await resolveAudioDeviceId();
  if (!deviceId) return null;
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: { exact: deviceId },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });
}

const GRAVITY = 1.4;

let workArea = null;
let workAreaAt = 0;

async function refreshWorkArea(force = false) {
  const now = Date.now();
  if (!force && workArea && now - workAreaAt < 2000) return;
  workArea = await window.petAPI.getWorkArea();
  workAreaAt = now;
}

function getFloorY() {
  if (workArea) return workArea.y + workArea.height - WIN_H();
  return window.screen.availHeight - WIN_H();
}

function getPetHalfWidth() {
  return (config.bodyHitWidth ?? 110) / 2;
}

function getMyCenterX() {
  return petBounds.x + WIN_W() / 2 + (config.bodyHitLeft ?? 0);
}

function getCenterSeparation(other) {
  const gap = config.petCollisionGap ?? 20;
  return getPetHalfWidth() + (other.halfWidth ?? 55) + gap;
}

function getPetStandOff() {
  return getPetHalfWidth() * 2 + (config.petCollisionGap ?? 20);
}

function distanceToOther(other) {
  return Math.abs(other.centerX - getMyCenterX());
}

function getStandOffX(other) {
  const minCenterDist = getCenterSeparation(other);
  const targetCenter = getMyCenterX() <= other.centerX
    ? other.centerX - minCenterDist
    : other.centerX + minCenterDist;
  return targetCenter - WIN_W() / 2 - (config.bodyHitLeft ?? 0);
}

function isAtStandOff(other) {
  return distanceToOther(other) <= getCenterSeparation(other) + 8;
}

async function isPositionBlocked(x) {
  const others = await window.petAPI.getOtherPets();
  const myCenter = x + WIN_W() / 2 + (config.bodyHitLeft ?? 0);
  for (const other of others) {
    if (Math.abs(myCenter - other.centerX) < getPetHalfWidth() + (other.halfWidth ?? 55) + (config.petCollisionGap ?? 20) - 4) {
      return true;
    }
  }
  return false;
}

function clampX(x) {
  const margin = 8;
  if (workArea) {
    const minX = workArea.x + margin;
    const maxX = workArea.x + workArea.width - WIN_W() - margin;
    return Math.max(minX, Math.min(maxX, x));
  }
  const minX = margin;
  const maxX = window.screen.availWidth - WIN_W() - margin;
  return Math.max(minX, Math.min(maxX, x));
}

async function snapToFloor() {
  await refreshWorkArea();
  petBounds = (await window.petAPI.getPetBounds()) || petBounds;
  const nx = clampX(petBounds.x);
  const targetY = config.freePlacement ? petBounds.y : getFloorY();
  if (Math.abs(petBounds.y - targetY) > 0.5 || nx !== petBounds.x) {
    await window.petAPI.movePet({ x: nx, y: targetY });
    petBounds.x = nx;
    petBounds.y = targetY;
  }
  vy = 0;
}
const DOUBLE_CLICK_MS = 450;
const LONG_PRESS_RIGHT_MS = 450;
// Move this far (px) with a button held and she is picked up immediately —
// lets touchpad tap-and-drag work without holding a physical button.
const GRAB_DRAG_THRESHOLD_PX = 8;

const DEFAULT_SPEECH = {
  textIdle: [
    'Hmm... what are you doing?',
    "How's your day?",
    'Pet my head~',
    "I'm bored...",
    'Hey! Notice me!',
    'Got any snacks?',
    'Boop!',
    "Don't ignore me!",
    'Hehe~',
    '*yawn*',
    'La la la~',
    'Nice weather today~',
    'You doing okay?',
    'Tell me a story!',
  ],
  textProactive: [
    'Hey! Just checking in~',
    'Whatcha up to?',
    'I was just thinking about you~',
    'Boo! Did I scare you?',
    'How\'s the game going?',
    'Don\'t forget to drink water~',
    'Stretch those shoulders!',
    'It\'s me! Your favorite distraction~',
    'Having fun without me? Rude~',
    'Psst… over here!',
    'Remember to blink~',
    'We make a great team, you and me.',
  ],
  textGrab: ['Gotcha!', 'Wheee~', 'Hey!'],
  textGrabRelease: ['Placed!', 'Oof~', 'Back down~'],
  textSlam: ['Mmph!!', 'Ow!!', '!!', '*squished*'],
  textShake: ['Woah woah!!', '*dizzy*', 'Stooop shaking me~', 'My brain!!'],
  textAttack: ['Rawr!', 'Hyah!', 'Take this!', 'Pounce!'],
  textPet: ['♡ {name} purrs...', 'So warm~', 'More pets please~'],
  textWalkStart: ['Walking around!', 'Going for a stroll~'],
  textWalkEnd: ['Time to rest~', 'Tired now...'],
  textSleep: ['Zzz...', '*snore*', 'So sleepy...'],
  textSit: ['*sits quietly*', 'Comfy~', 'Just resting here~'],
  textDance: ['🎵', 'Dancing~', 'Feel the beat!'],
  textChaosClose: ['My bad hehe~', 'Oopsie!', 'Sorry not sorry~', 'Whoops! My bad~'],
  textPrank: ['hm?', '...', 'something feels off~', 'hehe...', 'watch this~', 'do you hear that?'],
  textSocial: ['Hi {friend}!', 'Hey {friend}~', 'Boop {friend}!', '{friend}! ♡', 'Miss you {friend}~'],
  textBump: ['Oof!', 'Hey {friend}!', 'Bonk!', 'Watch it {friend}!', 'Eep! Sorry {friend}!'],
  textTagChase: [
    'Tag! You\'re it {friend}!',
    'Catch me {friend}!',
    'I\'m gonna get you {friend}!',
  ],
  textTagRun: ['Can\'t catch me {friend}!', 'Run run run~', 'Too slow {friend}!'],
  textTagGotcha: ['Gotcha {friend}!', 'You\'re it {friend}!', 'Tagged!'],
  textWatch: [
    'What are you watching?',
    'Ooh is that YouTube?',
    'Share the video with me~',
    'That looks interesting!',
  ],
  textGame: [
    'Go go go!',
    'You got this!',
    'Focus focus~',
    'Gaming mode ON',
  ],
  textGameFail: [
    'U suck lol',
    'Oof that was rough~',
    'Try again!',
    'RIP',
    'Skill issue~',
  ],
  textVictory: [
    'We won!!',
    'Victory~!',
    'Too easy~',
    'Champion!!',
    'Lets gooo!',
  ],
  textSnack: [
    'Yum!',
    'Nom nom~',
    'My favorite!',
    'So tasty~',
  ],
  textHungry: [
    "I'm hungry...",
    'Got any snacks?',
    '*tummy growls*',
    'Feed me~',
  ],
  textGift: [
    'For you {friend}! 🎁',
    'A gift~ ♡',
    'I brought you something!',
  ],
  textGiftThanks: [
    'Thank you {friend}! ♡',
    'For me?! ♡',
    'Yay~ thank you!',
  ],
  textMoodGrumpy: [
    'Hmph.',
    '*grumbles*',
    'Not in the mood…',
    'Whatever.',
    '*side-eyes you*',
  ],
  textMoodSleepy: [
    '*yaaawn*…',
    'Five more minutes…',
    'So… sleepy…',
    'Huh… what… *dozes off*',
  ],
  textMoodPlayful: [
    'Hehehe~',
    'Play with me play with me!',
    'Wheee!',
    'Boop boop!',
  ],
  textMoodExcited: [
    'WOOO!',
    'That was AMAZING!',
    'Did you SEE that?!',
    "I'M HYPED!",
  ],
  textBestFriend: [
    'My bestie {friend}! ♡',
    '{friend}!! I missed you!',
    'Besties forever {friend}~',
  ],
  textJealous: [
    'Hey… what about me?',
    '*pouts* I want pats too…',
    'Hmph! {friend} gets all the pats!',
    'Notice meeee…',
  ],
  textBondMilestone: [
    '{friend} and I are BEST friends now! ♡',
    'Besties forever, {friend}!',
    'Me and {friend}? Inseparable~ ♡',
  ],
  textMusic: [
    '♪ {song}~',
    'Ooh, {song}! Good taste~',
    '{song} on repeat, I see~',
    '♪ Now playing: {song}~',
  ],
};

let lastClickAt = 0;
let rightMouseDownAt = 0;
let longPressTimer = null;
let suppressContextMenu = false;
let nextSocialAt = 0;
let lastSocialWith = null;
let lastBumpAt = 0;
let bumpEscapeUntil = 0;
let bumpEscapeDir = 0;
let tagSession = null;
let tagCooldownUntil = 0;
let happiness = 70;
let lastHappyDecayAt = Date.now();
let nextGiftAt = Date.now() + 90000 + Math.random() * 120000;

function pickGiftLine(friendName) {
  return pickSpeech('textGift', DEFAULT_SPEECH.textGift).replace(/\{friend\}/g, friendName);
}

let giftDelivery = null;
let giftArtTimer = 0;
// Timestamp until which idle chatter/activities stay quiet so tag games,
// gifts, and greetings play out uninterrupted.
let socialBusyUntil = 0;

function deliverGiftTo(partnerName, partnerId) {
  vx = 0;
  vy = -7;
  happiness = Math.min(100, happiness + 8);
  socialBusyUntil = Date.now() + 3500;
  setAnimOverride('giftGive');
  mem().giftsGiven += 1;
  saveMemory();
  if (partnerId) bumpBond(partnerId, 3);
  showSpeech(pickGiftLine(partnerName), 2200, { sound: 'gift' });
  if (partnerId) afterVoiceQuiet(() => window.petAPI.sendGift({ toId: partnerId }));
  if (giftArtTimer) clearTimeout(giftArtTimer);
  giftArtTimer = setTimeout(() => {
    giftArtTimer = 0;
    clearAnimOverride();
  }, 2400);
}

async function tryGiftInteraction() {
  if (config.multiPetInteractions === false) return;
  if (!petActive || isGrabbing || isWandering || isDancing || tagSession) return;
  if (idleActivity || state !== 'idle' || giftDelivery) return;
  if (Date.now() < nextGiftAt) return;

  await refreshOtherPets();
  if (!cachedOthers.length) return;
  let best = null;
  let bestDist = 700;
  for (const other of cachedOthers) {
    const d = distanceToOther(other);
    if (d < bestDist) {
      bestDist = d;
      best = other;
    }
  }
  if (!best) return;
  if (Math.random() > 0.35) return;
  nextGiftAt = Date.now() + 180000 + Math.random() * 240000;

  if (isAtStandOff(best)) {
    deliverGiftTo(best.name, best.id);
  } else {
    giftDelivery = { partnerId: best.id, partnerName: best.name };
  }
}

async function updateGiftDelivery() {
  if (!giftDelivery) return false;
  if (!petActive || isGrabbing || tagSession || isWandering) {
    if (isGrabbing || tagSession) giftDelivery = null;
    return false;
  }
  await refreshOtherPets();
  const other = cachedOthers.find((o) => o.id === giftDelivery.partnerId);
  if (!other) {
    giftDelivery = null;
    return false;
  }
  if (isAtStandOff(other)) {
    const name = other.name;
    const pid = other.id;
    giftDelivery = null;
    deliverGiftTo(name, pid);
    return false;
  }
  const targetX = clampX(getStandOffX(other));
  const dx = targetX - petBounds.x;
  if (Math.abs(dx) < 10) {
    vx = 0;
    return true;
  }
  vx = Math.sign(dx) * Math.min((config.moveSpeed || 2.5) * 1.1, Math.abs(dx));
  applyFacing(vx);
  setState('shuffle');
  updateSprite();
  return true;
}
let nextContextReactionAt = 0;
let lastContextType = '';

function pickSocialLine(friendName) {
  const line = pickSpeech('textSocial', DEFAULT_SPEECH.textSocial);
  return line.replace(/\{friend\}/g, friendName);
}

function pickBumpLine(friendName) {
  const line = pickSpeech('textBump', DEFAULT_SPEECH.textBump);
  return line.replace(/\{friend\}/g, friendName);
}

function linesFromSpeechField(raw, defaults) {
  if (raw && typeof raw === 'string' && raw.trim()) {
    const parsed = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return defaults;
}

function pickTagLine(friendName, mood) {
  const defaults = {
    chase: DEFAULT_SPEECH.textTagChase,
    run: DEFAULT_SPEECH.textTagRun,
    gotcha: DEFAULT_SPEECH.textTagGotcha,
  };
  const keyByMood = {
    chase: 'textTagChase',
    run: 'textTagChase',
    gotcha: 'textTagGotcha',
  };
  const configKey = keyByMood[mood] || 'textTagChase';
  let lines = linesFromSpeechField(config[configKey], defaults[mood] || defaults.chase);

  if (!config.textTagGotcha && !config.textTagChase && config.textTag) {
    const legacy = linesFromSpeechField(config.textTag, defaults[mood] || defaults.chase);
    if (mood === 'gotcha') {
      const gotchaOnly = legacy.filter((l) => /gotcha|caught|you're it|tagged/i.test(l));
      lines = gotchaOnly.length ? gotchaOnly : legacy;
    } else {
      const chaseOnly = legacy.filter((l) => !/gotcha|caught/i.test(l) || /tag|catch|run/i.test(l));
      lines = chaseOnly.length ? chaseOnly : legacy;
    }
  }

  const line = lines[Math.floor(Math.random() * lines.length)];
  const name = config.name || 'Mochi';
  return line.replace(/\{friend\}/g, friendName).replace(/\{name\}/g, name);
}

function endTagSession() {
  if (tagSession) {
    window.petAPI.endTagSession();
  }
  tagSession = null;
  vx = 0;
  if (!isWandering && idleActivity !== 'shuffle' && state === 'chase') {
    setState(isDancing ? 'dance' : 'idle');
  }
}

const TAG_COUNTDOWN_MS = 3200;
const TAG_RUN_MS = 4500;

function isTagger() {
  return tagSession && config.petId === tagSession.taggerId;
}

function getTagPhase() {
  if (!tagSession?.startedAt) return 'countdown';
  const elapsed = Date.now() - tagSession.startedAt;
  if (elapsed < TAG_COUNTDOWN_MS) return 'countdown';
  if (elapsed < TAG_COUNTDOWN_MS + TAG_RUN_MS) return 'run';
  return 'chase';
}

function applyFacing(velocityX) {
  const movingRight = velocityX > 0.08;
  const movingLeft = velocityX < -0.08;
  const custom = usesCustomAvatar();
  const invert = config.invertSpriteFacing !== false;

  petEl.classList.toggle('invert-facing', invert && custom);

  if (!custom) {
    petEl.classList.toggle('sprite-flipped', false);
    if (!movingRight && !movingLeft) return;
    petEl.classList.toggle('facing-left', movingLeft);
    return;
  }

  petEl.classList.remove('facing-left');
  if (!movingRight && !movingLeft) return;

  const shouldFlip = invert ? movingRight : movingLeft;
  petEl.classList.toggle('sprite-flipped', shouldFlip);
}

function applyTagSession(data) {
  if (!data?.active) {
    tagSession = null;
    vx = 0;
    return;
  }
  tagSession = {
    otherId: data.partnerId,
    otherName: data.partnerName || 'Pet',
    until: data.until || Date.now() + 14000,
    startedAt: data.startedAt || Date.now(),
    taggerId: data.taggerId || data.partnerId,
    role: data.role || 'runner',
    lastCountShown: 0,
    runSpeechShown: false,
    chaseSpeechShown: false,
    gotchaShown: false,
  };
  tagCooldownUntil = Date.now() + 15000;
  bumpEscapeUntil = 0;
  bumpEscapeDir = 0;
  endIdleActivity();
  isWandering = false;
  wanderTarget = null;
  vx = 0;
  if (isTagger()) {
    showSpeech('Tag! Ready?', 1200, { sound: 'tagChase' });
  }
  setState('chase');
}

function startTagSession(other) {
  if (tagSession || Date.now() < tagCooldownUntil) return;
  window.petAPI.startTagSession({
    partnerId: other.id,
    partnerName: other.name,
    durationMs: 7000 + Math.floor(Math.random() * 5000),
  });
}

let cachedOthers = [];
let cachedOthersAt = 0;

async function refreshOtherPets() {
  const now = Date.now();
  const throttleMs = tagSession ? 80 : 250;
  if (now - cachedOthersAt < throttleMs) return cachedOthers;
  cachedOthers = await window.petAPI.getOtherPets();
  cachedOthersAt = now;
  return cachedOthers;
}

function startBumpEscape(other) {
  const speed = (config.moveSpeed || 2.5) * 0.85;
  bumpEscapeDir = other.centerX <= getMyCenterX() ? 1 : -1;
  bumpEscapeUntil = Date.now() + 1400;
  vx = bumpEscapeDir * speed;
  applyFacing(vx);
}

function findNearestPet(others) {
  let hit = null;
  let minDist = Infinity;
  for (const other of others) {
    const d = distanceToOther(other);
    if (d < minDist) {
      minDist = d;
      hit = other;
    }
  }
  return hit && minDist <= getCenterSeparation(hit) + 24 ? hit : null;
}

async function handleBumpReaction() {
  if (tagSession || bumpEscapeUntil > Date.now()) return;
  if (config.multiPetInteractions === false) return;
  if (Date.now() - lastBumpAt < 1400) return;
  if (isGrabbing || state === 'grab' || state === 'attack' || state === 'pet') return;

  await refreshOtherPets();
  const hit = findNearestPet(cachedOthers);
  if (!hit) return;

  lastBumpAt = Date.now();
  lastSocialWith = hit.id;
  nextSocialAt = Date.now() + 9000;

  startBumpEscape(hit);

  if (state !== 'sleep' && state !== 'sit') {
    setState(isWandering || idleActivity === 'shuffle' ? 'shuffle' : 'chase');
  }
  if (!speechEl.classList.contains('show')) {
    showSpeech(pickBumpLine(hit.name), 1500, { social: true, sound: 'bump', keepVoice: true });
  }
  if (Math.random() < 0.22) startTagSession(hit);
}

async function updateTagBehavior() {
  if (!tagSession || config.multiPetInteractions === false) return;
  if (Date.now() > tagSession.until) {
    endTagSession();
    return;
  }
  if (isGrabbing || state === 'grab') return;

  await refreshOtherPets();
  const other = cachedOthers.find((o) => o.id === tagSession.otherId);
  if (!other) {
    endTagSession();
    return;
  }

  const phase = getTagPhase();
  const centerDx = other.centerX - getMyCenterX();
  const minSep = getCenterSeparation(other);
  const dist = distanceToOther(other);
  const chaseSpeed = (config.moveSpeed || 2.5) * 1.45;
  const runSpeed = (config.moveSpeed || 2.5) * 1.35;
  const tagger = isTagger();

  if (phase === 'countdown') {
    vx = 0;
    if (tagger) {
      const step = Math.min(3, Math.floor((Date.now() - tagSession.startedAt) / 1000) + 1);
      if (step !== tagSession.lastCountShown) {
        tagSession.lastCountShown = step;
        showSpeech(String(step), 750, { social: true, sound: 'tagChase' });
      }
    }
    setState('chase');
    updateSprite();
    return;
  }

  if (phase === 'run') {
    if (!tagger && !tagSession.runSpeechShown) {
      tagSession.runSpeechShown = true;
      showSpeech(pickTagLine(other.name, 'run'), 1600, { sound: 'tagChase' });
    }
    if (tagger) {
      vx = 0;
    } else {
      const fleeDir = -Math.sign(centerDx) || (config.petId < other.id ? -1 : 1);
      vx = fleeDir * runSpeed;
      applyFacing(vx);
    }
    setState('chase');
    updateSprite();
    return;
  }

  if (!tagSession.chaseSpeechShown) {
    tagSession.chaseSpeechShown = true;
    if (tagger) showSpeech(pickTagLine(other.name, 'chase'), 2200, { sound: 'tagChase' });
    else showSpeech(pickTagLine(other.name, 'run'), 1800, { sound: 'tagChase' });
  }

  if (tagger) {
    if (dist <= minSep + 10) {
      vx = 0;
      if (!tagSession.gotchaShown) {
        tagSession.gotchaShown = true;
        bumpBond(other.id, 4);
        showSpeech(pickTagLine(other.name, 'gotcha'), 2800, { sound: 'tagGotcha' });
        tagSession.until = Date.now() + 3000;
      }
    } else {
      const dir = Math.sign(centerDx) || 1;
      vx = dir * Math.min(chaseSpeed, Math.max(0.6, Math.abs(centerDx) * 0.18));
      applyFacing(vx);
    }
  } else {
    const fleeDir = -Math.sign(centerDx) || (config.petId < other.id ? -1 : 1);
    vx = fleeDir * runSpeed;
    applyFacing(vx);
  }

  setState('chase');
  updateSprite();
}

async function checkPetInteractions() {
  if (animOverride === 'thinking' || state === 'thinking') return;
  if (config.multiPetInteractions === false) return;
  if (!petActive || isGrabbing || isWandering || isDancing || tagSession || giftDelivery) return;
  if (idleActivity && idleActivity !== 'shuffle') return;
  if (state === 'attack' || state === 'grab' || state === 'pet') return;
  if (Date.now() < nextSocialAt) return;

  const others = await window.petAPI.getOtherPets();
  if (!others.length) return;

  nextSocialAt = Date.now() + 8000 + Math.random() * 12000;

  for (const other of others) {
    const centerDist = distanceToOther(other);
    const approachRange = getCenterSeparation(other) * 1.8;

    if (isAtStandOff(other)) {
      if (lastSocialWith === other.id && Math.random() > 0.18) continue;
      lastSocialWith = other.id;
      vx = 0;
      endIdleActivity();
      setState('pet');
      socialBusyUntil = Date.now() + 3000;
      setAnimOverride('greet');
      let greetLine = pickFreshSocialLine(other.name);
      if (isBestFriend(other) && Math.random() < 0.18) {
        const pool = DEFAULT_SPEECH.textBestFriend;
        const raw = pool[Math.floor(Math.random() * pool.length)];
        greetLine = { raw, text: raw.replace(/\{friend\}/g, other.name) };
      }
      showSpeech(greetLine.text, 2200, { social: true, sound: 'social' });
      afterVoiceQuiet(() => window.petAPI.sendSocialGreet({ toId: other.id, usedRaw: [greetLine.raw] }));
      setTimeout(() => {
        clearAnimOverride();
        if (state === 'pet') setState(isDancing ? 'dance' : 'idle');
      }, 1800);
      return;
    }

    if (
      centerDist < approachRange * 1.15 &&
      state === 'idle' &&
      !idleActivity &&
      !speechEl.classList.contains('show') &&
      Math.random() < 0.12
    ) {
      idleActivity = 'shuffle';
      idleActivityEnd = Date.now() + 2000 + Math.random() * 2000;
      shuffleTarget = { x: clampX(getStandOffX(other)) };
      const walkDx = shuffleTarget.x - petBounds.x;
      if (Math.abs(walkDx) < 8) {
        endIdleActivity();
        continue;
      }
      vx = Math.sign(walkDx) * Math.min((config.moveSpeed || 2.5) * 0.85, Math.abs(walkDx));
      applyFacing(vx);
      setState('shuffle');
      socialBusyUntil = Date.now() + 3000;
      const walkByLine = pickFreshSocialLine(other.name);
      showSpeech(walkByLine.text, 1800, { social: true, sound: 'social' });
      afterVoiceQuiet(() => window.petAPI.sendSocialGreet({ toId: other.id, usedRaw: [walkByLine.raw] }));
      return;
    }
  }
}

async function tryNearbySocialChatter() {
  if (config.multiPetInteractions === false) return;
  if (!petActive || isGrabbing || isWandering || isDancing || tagSession) return;
  if (state !== 'idle' || idleActivity || speechEl.classList.contains('show')) return;
  if (Date.now() < nextSocialAt || Date.now() < socialBusyUntil) return;
  if (Math.random() > 0.04) return;

  const others = await window.petAPI.getOtherPets();
  if (!others.length) return;

  for (const other of others) {
    const centerDist = distanceToOther(other);
    const near = getCenterSeparation(other) * 2.4;
    if (centerDist > near) continue;
    nextSocialAt = Date.now() + 10000 + Math.random() * 8000;
    showSpeech(pickSocialLine(other.name), 2000, { social: true, sound: 'social' });
    return;
  }
}

async function init() {
  config = await window.petAPI.getConfig();
  petActive = !!config.petEnabled;
  applyConfig(config);
  petMood = (typeof config.mood === 'string' && config.mood) || 'happy';
  petMemory = { ...MEM_DEFAULTS, ...((config.memory && typeof config.memory === 'object') ? config.memory : {}) };
  checkDayRollover();
  window.petAPI.onConfigUpdated((c) => {
    const danceWas = config.musicDanceEnabled;
    applyConfig(c);
    if (typeof c.mood === 'string' && c.mood) petMood = c.mood;
    if (!!c.musicDanceEnabled !== !!danceWas) setupAudio();
  });

  window.petAPI.onWanderSessionStart((durationMs) => {
    if (petActive) startWanderSession(durationMs);
  });

  window.petAPI.onChaosClose(() => {
    showSpeech(pickSpeech('textChaosClose', DEFAULT_SPEECH.textChaosClose), 2800, { sound: 'chaosClose' });
  });

  window.petAPI.onPrankEffect((data) => {
    if (data && PRANK_MUTE_EFFECTS.has(data.effect)) {
      prankMuted = true;
      stopVoice();
    }
    triggerPetPrankReaction(data && data.effect);
  });

  window.petAPI.onPrankEnd(() => {
    prankMuted = false;
    clearPetPrankReaction();
    clearTimeout(prankReactionTimer);
    if (state === 'attack' && !isGrabbing) setState(isDancing ? 'dance' : 'idle');
  });

  window.petAPI.onTagSession((data) => {
    if (!petActive) return;
    applyTagSession(data);
  });

  window.petAPI.onForegroundContext((ctx) => {
    if (!petActive || !ctx) return;
    handleForegroundContext(ctx);
  });

  window.petAPI.onGiftGiveNow(async (data) => {
    if (!petActive || isGrabbing || tagSession) return;
    const pid = data?.partnerId;
    await refreshOtherPets();
    const other = pid ? cachedOthers.find((o) => o.id === pid) : null;
    if (other && !isAtStandOff(other)) {
      giftDelivery = { partnerId: other.id, partnerName: other.name };
      nextGiftAt = Date.now() + 180000 + Math.random() * 240000;
      showSpeech('I got you something~', 1500, { sound: 'gift' });
      return;
    }
    deliverGiftTo(other?.name || data?.partnerName || 'Pet', other?.id || pid);
  });

  // Mini-game chat commands (number-guess state lives here; the RPS
  // engine + button-bar match live at top level, shared with this).
  let guessTarget = 0;
  let guessTries = 0;

  function tryMiniGame(text) {
    const clean = text.trim().toLowerCase();
    const m = mem();

    // A guessing round is open — plain numbers are guesses.
    if (guessTarget > 0) {
      if (/^(give up|quit|stop|i give up)$/.test(clean)) {
        const was = guessTarget;
        guessTarget = 0;
        guessTries = 0;
        return `It was ${was}! Better luck next time~`;
      }
      if (/^\d+$/.test(clean)) {
        const n = parseInt(clean, 10);
        if (n < 1 || n > 20) return 'Pick a number from 1 to 20~';
        guessTries += 1;
        if (guessFeedback(guessTarget, n) === 'win') {
          const tries = guessTries;
          m.guessW = (m.guessW || 0) + 1;
          const record = !m.guessBest || tries < m.guessBest;
          if (record) m.guessBest = tries;
          guessTarget = 0;
          guessTries = 0;
          saveMemory();
          moodExcitedUntil = Date.now() + 60000;
          refreshMood();
          return `YES! ${n} in ${tries} ${tries === 1 ? 'try' : 'tries'}!${record ? ' New record!' : ''} Wins: ${m.guessW}~`;
        }
        return guessFeedback(guessTarget, n) === 'higher'
          ? `${n}… higher! (try ${guessTries + 1})`
          : `${n}… lower! (try ${guessTries + 1})`;
      }
      return null;
    }

    if (/^(games|play|play games|minigames|mini games)$/.test(clean)) {
      return 'We can play rock-paper-scissors (just type rock, paper, or scissors) or number guessing (type "guess"). Say "quit" to stop a game~';
    }
    if (/^(guess|guessing game|play guess|number game)$/.test(clean)) {
      guessTarget = 1 + Math.floor(Math.random() * 20);
      guessTries = 0;
      return 'I\'m thinking of a number from 1 to 20… guess! (or "give up")';
    }
    const throwMatch = clean.match(/^(?:rps\s+)?(rock|paper|scissors|scissor)$/);
    if (throwMatch) {
      const user = throwMatch[1] === 'scissor' ? 'scissors' : throwMatch[1];
      return resolveRpsThrow(user);
    }
    return null;
  }

  let chatHistory = [];
  let sessionAgentMode = null; // chat "agent mode on/off" override (session only)
  // Shared chat pipeline (chat window AND companion remote): history,
  // mini-games, AI with fallback note, offline brain, speech + voice.
  async function processChatMessage(text) {
    chatHistory.push({ role: 'user', content: text });
    chatHistory = chatHistory.slice(-8);
    mem().chats += 1;
    saveMemory();

    // Discord voice & music voice command
    const dIntent = parseDiscordIntent(text);
    if (dIntent && window.petAPI?.discordAction) {
      setAnimOverride('thinking');
      try {
        const res = await window.petAPI.discordAction(dIntent.action, dIntent.query);
        clearAnimOverride();
        const replyLine = res?.message || (res?.ok ? 'Done!' : 'I had an issue on Discord~');
        chatHistory.push({ role: 'assistant', content: replyLine });
        chatHistory = chatHistory.slice(-8);
        showSpeech(replyLine, 4500);
        return { reply: replyLine };
      } catch (err) {
        clearAnimOverride();
        const errLine = 'Discord command failed~';
        showSpeech(errLine, 3500);
        return { reply: errLine };
      }
    }

    // Mode switch: "agent mode on/off", "chat mode", "switch to agent/chat".
    const modeCmd = String(text || '').trim().toLowerCase().match(/^(agent mode(?:\s+(on|off))?|chat mode|switch to (agent|chat)( mode)?)$/);
    if (modeCmd) {
      const raw = modeCmd[0];
      if (/chat mode/.test(raw) || /agent mode off/.test(raw) || /switch to chat/.test(raw)) sessionAgentMode = false;
      else sessionAgentMode = true;
      const line = sessionAgentMode
        ? 'Agent mode on — everything you say is a task now. "chat mode" to go back to chatter~'
        : 'Chat mode — just vibes now. "agent mode on" when you want chores~';
      chatHistory.push({ role: 'assistant', content: line });
      chatHistory = chatHistory.slice(-8);
      showSpeech(line, 4500);
      window.petAPI.chatReply({ text: line });
      return;
    }
    // Play mode switch: "play mode on/off" — she chases your cursor.
    const playCmd = String(text || '').trim().toLowerCase().match(/^(play mode(?:\s+(on|off))?)$/);
    if (playCmd) {
      const raw = playCmd[0];
      if (/play mode off/.test(raw)) sessionPlayMode = false;
      else sessionPlayMode = true;
      const line = sessionPlayMode
        ? 'Play mode on — catch me if you can! Move your cursor~'
        : 'Play mode off — back to lounging~';
      chatHistory.push({ role: 'assistant', content: line });
      chatHistory = chatHistory.slice(-8);
      showSpeech(line, 4500);
      window.petAPI.chatReply({ text: line });
      return;
    }
    // Text animation switch: "text anim wave/pop/rainbow/fade/typewriter/off".
    const animCmd = String(text || '').trim().toLowerCase().match(/^text anim (typewriter|pop|fade|wave|rainbow|off)$/);
    if (animCmd) {
      const pick = animCmd[1];
      sessionTextAnim = pick;
      const line = pick === 'off'
        ? 'Text effects off — plain bubbles now. "text anim pop" to bring them back~'
        : `Text anim: ${pick}~ watch this bubble! ("text anim off" to disable)`;
      chatHistory.push({ role: 'assistant', content: line });
      chatHistory = chatHistory.slice(-8);
      showSpeech(line, 4500);
      window.petAPI.chatReply({ text: line });
      return;
    }
    if (/^(look|look at (my |the )?screen|look at it|what do you see|see my screen)\b/i.test(String(text).trim())) {
      setAnimOverride('thinking');
      try {
        const vres = await window.petAPI.visionLook?.('asked to look');
        clearAnimOverride();
        // 'busy' means another look is already running and will speak —
        // stay quiet instead of erroring over it.
        if (!vres?.ok && vres?.error !== 'busy') showSpeech("I can't see right now - turn on vision or wake the model~", 3500);
      } catch (_) {
        clearAnimOverride();
      }
      return;
    }
    // Task mode: ">" messages, "open X" requests, or agent mode on.
    // Task mode: ">" messages, "open X" requests (including "open it/this"
    // follow-ups — history holds what "it" is), build orders ("make a
    // calculator" auto-routes too — plain chat has no tools, so without
    // this she'd just paste code), or agent mode on.
    // In agent mode EVERYTHING is a task (except mini-games, which stay
    // instant and local). Session override wins, then the settings toggle.
    const openReq = text.match(/^(?:please\s+)?(?:can you\s+)?(open|launch|start)\s+([a-z0-9_ .+-]{1,30})$/i)
      || /^(open|opening|launch|launching|start|starting|go to|take me to|visit|browse)\b/i.test(text)
      || /\bopen\s+.*\btab\b/i.test(text)
      || /\b(open|launch|start|run|show|close)\s+(it|this|that|them|the\s+(file|folder|app|program|calculator|website|page))\b/i.test(text);
    const buildReq = /\b(make|build|create|write|generate|code)\b[^.!?]{0,60}\b(website|web ?site|web ?app|app|program|script|calculator|bot|game|portfolio|landing|server|api|tool|file|folder|function|class)\b/i.test(text);
    const agentMode = sessionAgentMode === true || (sessionAgentMode !== false && config.aiAgentMode === true);
    if (text.startsWith('>') || openReq || buildReq || agentMode) {
      const task = text.startsWith('>') ? text.slice(1).trim() : text;
      if (!task) {
        const help = 'Task mode: type "> ..." and I\'ll do things — build sites, run commands, tidy files. Reads run free; writes, edits, and every terminal command ask first. "agent mode on" makes everything a task.';
        showSpeech(help, 4500);
        window.petAPI.chatReply({ text: help });
        return;
      }
      if (thinkingTimer) {
        clearTimeout(thinkingTimer);
        clearInterval(thinkingTimer);
        thinkingTimer = null;
      }
      setAnimOverride('thinking');
      thinkingTimer = setTimeout(() => {
        clearAnimOverride();
        thinkingTimer = null;
      }, 60000);
      let agentRes = null;
      try {
        agentRes = await window.petAPI.agentChat(chatHistory);
      } catch (_) {}
      if (thinkingTimer) {
        clearTimeout(thinkingTimer);
        clearInterval(thinkingTimer);
        thinkingTimer = null;
      }
      clearAnimOverride();
      if (agentRes?.ok && agentRes.needsApproval) {
        const line = 'Needs your approval — check the chat window~';
        showSpeech(line, 4500);
        window.petAPI.chatReply({
          text: 'I need approval first:',
          approval: { sessionId: agentRes.sessionId, actions: agentRes.actions || [] },
        });
        return;
      }
      const taskReply = (agentRes?.ok && agentRes.reply) ? agentRes.reply : brainReply(text);
      let taskNote = '';
      if (!agentRes?.ok && agentRes && !['disabled', 'no-key', 'not-configured', 'agent-disabled'].includes(agentRes.error)) {
        taskNote = `Agent unavailable (${agentRes.error || 'unknown'}${agentRes.detail ? ': ' + agentRes.detail : ''}).`;
      }
      chatHistory.push({ role: 'assistant', content: taskReply });
      chatHistory = chatHistory.slice(-8);
      showSpeech(taskReply, 4500);
      window.petAPI.chatReply({ text: taskReply, note: taskNote });
      return;
    }
    // Mini-games are instant and local — never send them to the AI.
    const gameReply = tryMiniGame(text);
    if (gameReply) {
      chatHistory.push({ role: 'assistant', content: gameReply });
      chatHistory = chatHistory.slice(-8);
      showSpeech(gameReply, 4500);
      return { reply: gameReply, note: '' };
    }
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
    setAnimOverride('thinking');
    thinkingTimer = setTimeout(() => {
      clearAnimOverride();
      thinkingTimer = null;
    }, 60000);
    let reply = '';
    let note = '';
    const aiKindName = (kind) => (kind === 'ollama' ? 'Ollama' : 'API');
    try {
      const res = await window.petAPI.aiChat(chatHistory);
      if (res?.ok && res.text) {
        reply = res.text;
        if (res.fallbackUsed) {
          const perr = res.primaryError || {};
          note = `Main AI (${aiKindName(res.primaryKind)}) failed (${perr.error || 'unknown'}${perr.detail ? ': ' + perr.detail : ''}) — fallback (${aiKindName(res.via)}) answered instead.`;
        }
      } else if (res && !['disabled', 'no-key', 'not-configured'].includes(res.error)) {
        note = `AI unavailable (${res.error || 'unknown'}${res.detail ? ': ' + res.detail : ''}) — offline brain answered.`;
      }
    } catch (_) {
      note = 'AI request crashed — offline brain answered.';
    }
    if (thinkingTimer) {
      clearTimeout(thinkingTimer);
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
    clearAnimOverride();
    if (!reply) reply = moodFlavor(brainReply(text));
    chatHistory.push({ role: 'assistant', content: reply });
    chatHistory = chatHistory.slice(-8);
    showSpeech(reply, 4500);
    return { reply, note };
  }

  window.petAPI.onChatMessage(async (data) => {
    if (!petActive) return;
    snoozeSleep();
    const text = String(data?.text || '').slice(0, 200).trim();
    if (!text) return;
    const { reply, note } = await processChatMessage(text);
    window.petAPI.chatReply({ text: reply, note });
  });

  // Mic hearing delivery: voice command after the wake word was heard
  // (the ack bubble is already showing by now).
  window.__hearCommand = async (cmd) => {
    if (!petActive) return;
    const clean = String(cmd || '').slice(0, 200).trim();
    if (!clean) return;
    const r = await processChatMessage(clean);
    if (r && r.reply) window.petAPI.chatReply({ text: r.reply, note: r.note });
  };

  window.petAPI.onPetSay?.((data) => {
    if (!petActive) return;
    const stext = String(data?.text || '').slice(0, 240).trim();
    if (!stext) return;
    showSpeech(stext, 3800, { chatter: true });
  });



  window.petAPI.onVisionResult?.((data) => {
    if (!petActive) return;
    const vtext = String(data?.text || '').slice(0, 320).trim();
    if (!vtext) return;
    showSpeech(vtext, 5200, { chatter: true });
  });

  window.petAPI.onAgentMode?.(async (data) => {
    if (!petActive) return;
    sessionAgentMode = !!data?.on;
    const line = sessionAgentMode
      ? 'Agent mode on — everything you say is a task now. AI button off to go back to chatter~'
      : 'Chat mode — just vibes now. AI button on when you want chores~';
    chatHistory.push({ role: 'assistant', content: line });
    chatHistory = chatHistory.slice(-8);
    showSpeech(line, 4500);
    window.petAPI.chatReply({ text: line });
  });

  // Companion remote entry point: same brain, answered over HTTP.
  window.petAPI.onPetDirect?.(async (data) => {
    const respond = (msg) => {
      try {
        window.petAPI.petDirectReply({ reqId: data?.reqId, ...msg });
      } catch (_) {}
    };
    if (!petActive) {
      respond({ ok: false, error: 'off' });
      return;
    }
    try {
      if (data?.action === 'chat') {
        const text = String(data?.payload?.text || '').slice(0, 200).trim();
        if (!text) {
          respond({ ok: false, error: 'empty' });
          return;
        }
        const { reply, note } = await processChatMessage(text);
        respond({ ok: true, text: reply, note });
      } else if (data?.action === 'rps') {
        const user = String(data?.payload?.throw || '').toLowerCase();
        if (!['rock', 'paper', 'scissors'].includes(user)) {
          respond({ ok: false, error: 'bad-throw' });
          return;
        }
        const line = resolveRpsThrow(user);
        showSpeech(line, 3000, { social: true, sound: 'social' });
        respond({ ok: true, text: line });
      } else {
        respond({ ok: false, error: 'unknown-action' });
      }
    } catch (_) {
      respond({ ok: false, error: 'failed' });
    }
  });

  // Busy states that a hello or present should never interrupt.
  function isBusyForSocial() {
    return (
      !petActive ||
      isGrabbing ||
      tagSession ||
      isDancing ||
      state === 'attack' ||
      state === 'grab' ||
      state === 'pet' ||
      state === 'dance'
    );
  }

  let nextGreetReplyAt = 0;
  let nextChatThreadAt = 0;
  window.petAPI.onSocialGreetReceive((data) => {
    if (isBusyForSocial()) return;
    if (Date.now() < nextGreetReplyAt) return;
    if (idleActivity) endIdleActivity();
    nextGreetReplyAt = Date.now() + 8000;
    const from = data?.fromName || 'Pet';
    const fromId = data?.fromId;
    socialBusyUntil = Date.now() + 3000;
    setAnimOverride('greet');
    const reply = pickFreshSocialLine(from, data?.usedRaw || []);
    mem().greetsShared += 1;
    saveMemory();
    if (fromId) bumpBond(fromId, 2);
    showSpeech(reply.text, 2000, { social: true, sound: 'social' });
    setTimeout(() => {
      clearAnimOverride();
      if (state === 'pet') setState(isDancing ? 'dance' : 'idle');
    }, 2000);
    // Sometimes keep the conversation going — back-and-forth chat.
    // Best friends chat more eagerly.
    const pal = fromId ? (cachedOthers || []).find((o) => o.id === fromId) : null;
    const chatChance = pal && isBestFriend(pal) ? 0.65 : 0.45;
    if (fromId && Math.random() < chatChance && Date.now() >= nextChatThreadAt) {
      nextChatThreadAt = Date.now() + 90000 + Math.random() * 60000;
      const usedRaw = [...(data?.usedRaw || []), reply.raw].slice(-6);
      afterVoiceQuiet(() => window.petAPI.sendSocialChat({
        toId: fromId,
        turn: 1,
        maxTurns: 2 + Math.floor(Math.random() * 3),
        usedRaw,
      }));
    }
  });

  // One turn of an ongoing pet-to-pet conversation. Replies alternate until
  // maxTurns is reached; the thread dies if the partner wandered off.
  window.petAPI.onSocialChatReceive(async (data) => {
    if (isBusyForSocial()) return;
    if (Date.now() < nextGreetReplyAt) return;
    const from = data?.fromName || 'Pet';
    const fromId = data?.fromId;
    if (!fromId) return;
    const turn = data?.turn || 1;
    const maxTurns = Math.min(data?.maxTurns || 3, 6);
    const usedRaw = Array.isArray(data?.usedRaw) ? data.usedRaw : [];
    await refreshOtherPets();
    const partner = cachedOthers.find((o) => o.id === fromId);
    if (partner && distanceToOther(partner) > getCenterSeparation(partner) * 5) return;
    nextGreetReplyAt = Date.now() + 8000;
    // Small "listening" pause so the two bubbles never overlap.
    setTimeout(() => {
      if (isBusyForSocial()) return;
      if (idleActivity) endIdleActivity();
      socialBusyUntil = Date.now() + 3000;
      setAnimOverride('greet');
      const reply = pickFreshSocialLine(from, usedRaw);
      mem().threadsJoined += 1;
      saveMemory();
      bumpBond(fromId, 1);
      showSpeech(reply.text, 2000, { social: true, sound: 'social' });
      setTimeout(() => {
        clearAnimOverride();
        if (state === 'pet') setState(isDancing ? 'dance' : 'idle');
      }, 2000);
      if (turn < maxTurns) {
        const next = [...usedRaw, reply.raw].slice(-6);
        afterVoiceQuiet(() => window.petAPI.sendSocialChat({
          toId: fromId,
          turn: turn + 1,
          maxTurns,
          usedRaw: next,
        }));
      }
    }, 1400 + Math.random() * 800);
  });

  // Agent results arrive here while the details go to the chat window.
  window.petAPI.onAgentResult?.((data) => {
    if (!petActive) return;
    const line = String(data?.text || '').slice(0, 200).trim();
    if (!line) return;
    if (idleActivity) endIdleActivity();
    socialBusyUntil = Date.now() + 3000;
    showSpeech(line, 4500, { sound: 'social' });
  });

  // Bond milestones: the pair just became Friends (40) or Best friends (70).
  window.petAPI.onBondMilestone?.((data) => {
    if (isBusyForSocial()) return;
    const other = data?.otherName || 'Pet';
    let line;
    if (data?.stage >= 70) {
      const pool = DEFAULT_SPEECH.textBondMilestone;
      line = pool[Math.floor(Math.random() * pool.length)].replace(/\{friend\}/g, other);
      moodExcitedUntil = Date.now() + 60000;
      refreshMood();
    } else {
      line = `Getting really close with ${other}~`;
    }
    socialBusyUntil = Date.now() + 3000;
    vy = -4;
    showSpeech(line, 2800, { social: true, sound: 'social' });
  });

  // Button-bar RPS: right-click menu → freeze, count down, pick.
  window.petAPI.onRpsStart?.(() => {
    if (!petActive || isGrabbing || tagSession || rpsActive) return;
    startRpsSession();
  });



  // Jealousy: someone got patted and this pet watched. Just a pouty line.
  window.petAPI.onJealousReceive?.((data) => {
    if (isBusyForSocial()) return;
    if (Date.now() < nextGreetReplyAt) return;
    if (Date.now() < nextJealousAt) return;
    nextJealousAt = Date.now() + 45000;
    if (idleActivity) endIdleActivity();
    nextGreetReplyAt = Date.now() + 8000;
    const from = data?.fromName || 'Pet';
    socialBusyUntil = Date.now() + 3000;
    vy = -3;
    const pool = DEFAULT_SPEECH.textJealous;
    showSpeech(pool[Math.floor(Math.random() * pool.length)].replace(/\{friend\}/g, from), 2000, { social: true, sound: 'social' });
  });

  window.petAPI.onGiftReceive((data) => {
    if (isBusyForSocial()) return;
    const from = data?.fromName || 'Pet';
    happiness = Math.min(100, happiness + 8);
    if (idleActivity) endIdleActivity();
    // Let the giver finish first — two voices at once sounds like one
    // pet changing voice mid-sentence.
    setTimeout(() => {
      if (isBusyForSocial()) return;
      // She may have dozed off during the wait — wake her for the present.
      if (idleActivity) endIdleActivity();
      vy = -7;
      mem().giftsReceived += 1;
      moodExcitedUntil = Date.now() + 90000;
      saveMemory();
      refreshMood();
      if (data?.fromId) bumpBond(data.fromId, 5);
      socialBusyUntil = Date.now() + 3000;
      setAnimOverride('giftReceive');
      showSpeech(
        pickSpeech('textGiftThanks', DEFAULT_SPEECH.textGiftThanks).replace(/\{friend\}/g, from),
        2200,
        { sound: 'giftThanks' }
      );
      if (giftArtTimer) clearTimeout(giftArtTimer);
      giftArtTimer = setTimeout(() => {
        giftArtTimer = 0;
        clearAnimOverride();
      }, 2400);
    }, 1800);
  });

  window.petAPI.onPerformanceMode?.((data) => setPerformanceMode(data || {}));

  window.petAPI.onSystemAudioLevel?.((data) => {
    centralAudioConnected = !!data?.connected;
    if (!centralAudioConnected) {
      centralAudioLevel = 0;
      if (isDancing) {
        isDancing = false;
        if (state === 'dance') setState('idle');
      }
      return;
    }
    centralAudioLevel = Math.max(0, Math.min(1, (data.level ?? 0) / 100));
    if (data.threshold != null) {
      config.musicThreshold = data.threshold;
    }
    applyDanceFromLevel(centralAudioLevel);
  });

  window.petAPI.onPetDragRelease((pos) => {
    if (pos?.x != null && pos?.y != null) {
      petBounds = { ...petBounds, x: pos.x, y: pos.y };
    }
    if (isGrabbing) endGrab();
  });

  // Display changes (Windows DPI scale switch, monitor unplug): hard-reset
  // navigation so stale floor/bounds can't drag her off-screen.
  async function resetForDisplayChange() {
    try {
      if (isGrabbing) endGrab();
      if (isWandering) endWanderSession();
      wanderTarget = null;
      vx = 0;
      vy = 0;
      await refreshWorkArea(true);
      petBounds = (await window.petAPI.getPetBounds()) || petBounds;
      await snapToFloor();
      syncHitboxesAfterPaint();
      reportInteractiveHitRegions(true);
    } catch (_) {}
  }
  window.petAPI.onDisplayChange?.(() => {
    resetForDisplayChange();
  });
  // Belt and braces: watch devicePixelRatio ourselves (some Windows setups
  // don't fire the main-process display event reliably).
  try {
    let lastDpr = window.devicePixelRatio;
    setInterval(() => {
      try {
        if (window.devicePixelRatio !== lastDpr) {
          lastDpr = window.devicePixelRatio;
          resetForDisplayChange();
        }
        if (config.showDebugBounds) updateDebugOverlays();
      } catch (_) {}
    }, 1000);
  } catch (_) {}
  window.petAPI.onPetPower((enabled) => {
    petActive = enabled;
    if (!enabled) {
      vx = 0;
      vy = 0;
      stopAudio();
      stopVoice();
      clearAnimOverride();
      if (isWandering) endWanderSession();
      clearIdleActivity();
      setState('idle');
    } else {
      setupAudio();
      snapToFloor();
      checkVoiceEngine();
    }
  });

  setupInteractions();
  setupAudio();
  scheduleNextChatter();
  scheduleNextRandomAttack();
  scheduleNextIdleActivity();
  await refreshWorkArea();
  if (petActive) await snapToFloor();
  checkVoiceEngine();

  resumeGameLoopRaf();
  setInterval(tick, 50);
  setInterval(reportWanderProgress, 500);
  setInterval(checkMusicLevel, 120);
}

function resetAudioCalibration() {
  audioNoiseFloor = 0;
  audioCalibrating = true;
  audioCalibrateUntil = Date.now() + 2200;
  audioCalibrateBuf = [];
  smoothedAudioLevel = 0;
}

async function setupAudio() {
  stopAudio();
  resetAudioCalibration();
  if (!config.musicDanceEnabled || !petActive) return;
  if (centralAudioConnected) return;
  try {
    let stream = null;
    try {
      stream = await captureDefaultSpeakerStream();
    } catch (_) {
      stream = null;
    }
    if (!stream) {
      try {
        stream = await captureFallbackLoopbackStream();
      } catch (_) {
        stream = null;
      }
    }
    if (!stream) return;
    micStream = stream;
    audioContext = getSharedAudioCtx();
    if (!audioContext) return;
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.35;
    source.connect(analyser);
    if (audioContext.state === 'suspended') await audioContext.resume();
  } catch (_) {
    /* dance mode stays off quietly if capture fails */
  }
}

function stopAudio() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  // Shared context: don't close it, just detach the analyser.
  audioContext = null;
  analyser = null;
  audioCalibrating = false;
  audioCalibrateBuf = [];
  audioNoiseFloor = 0;
  smoothedAudioLevel = 0;
  isDancing = false;
}

let audioTimeData = null;
function measureOverallVolumeRms() {
  if (!analyser) return 0;
  if (!audioTimeData || audioTimeData.length !== analyser.fftSize) {
    audioTimeData = new Uint8Array(analyser.fftSize);
  }
  const timeData = audioTimeData;
  analyser.getByteTimeDomainData(timeData);
  let sumSq = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128;
    sumSq += v * v;
  }
  return Math.sqrt(sumSq / timeData.length);
}

function scaleVolumeLevel(rms) {
  if (audioCalibrating && Date.now() < audioCalibrateUntil) {
    audioCalibrateBuf.push(rms);
    smoothedAudioLevel = 0;
    return 0;
  }
  if (audioCalibrating) {
    audioCalibrating = false;
    if (audioCalibrateBuf.length) {
      audioCalibrateBuf.sort((a, b) => a - b);
      const idx = Math.min(audioCalibrateBuf.length - 1, Math.floor(audioCalibrateBuf.length * 0.92));
      audioNoiseFloor = audioCalibrateBuf[idx] + 0.004;
    }
    audioCalibrateBuf = [];
  }

  if (rms < audioNoiseFloor + 0.02) {
    audioNoiseFloor = audioNoiseFloor * 0.992 + rms * 0.008;
  }

  const adjusted = Math.max(0, rms - audioNoiseFloor - 0.006);
  const headroom = Math.max(0.04, 0.2 - audioNoiseFloor);
  const scaled = Math.min(1, adjusted / headroom);

  if (scaled <= 0.002) {
    smoothedAudioLevel *= 0.4;
    if (smoothedAudioLevel < 0.005) smoothedAudioLevel = 0;
  } else {
    smoothedAudioLevel = smoothedAudioLevel * 0.5 + scaled * 0.5;
  }
  return smoothedAudioLevel;
}

function getAudioLevel() {
  if (centralAudioConnected) return centralAudioLevel;
  if (!analyser) return 0;
  return scaleVolumeLevel(measureOverallVolumeRms());
}

function applyDanceFromLevel(level) {
  expireTimedIdleActivity();
  if (Date.now() < deathReactionUntil) return;
  if (idleActivity === 'sit' || idleActivity === 'sleep') return;
  if (!petActive || !config.musicDanceEnabled || isGrabbing || rpsActive) return;
  // Grumpy/sleepy pets need a much louder beat to bother dancing.
  const moodMult = (petMood === 'grumpy' || petMood === 'sleepy') ? 1.7 : 1;
  const threshold = Math.min(0.95, ((config.musicThreshold ?? 35) / 100) * moodMult);
  const releaseThreshold = threshold * 0.55;

  if (level >= threshold) {
    const holdMs = 500 + Math.min(450, level * 600);
    danceHoldUntil = Date.now() + holdMs;
    if (state !== 'attack' && state !== 'grab' && state !== 'pet' && state !== 'sleep' && state !== 'sit' && state !== 'shuffle') {
      if (state !== 'dance') {
        setState('dance');
        if (Math.random() < 0.08) showSpeech(pickSpeech('textDance', DEFAULT_SPEECH.textDance), 800, { sound: 'dance', noInterrupt: true });
      }
      isDancing = true;
      if (Date.now() > nextVtsDanceAt) {
        nextVtsDanceAt = Date.now() + 12000;
        try {
          window.petAPI.vtsEvent?.('dance');
        } catch (_) {}
      }
    }
  } else if (isDancing && level < releaseThreshold && Date.now() > danceHoldUntil) {
    isDancing = false;
    if (state === 'dance') setState('idle');
  }
}

let lastReportedAudioLevel = -1;
let lastReportedDancing = null;
let danceLevelHist = [];
let lastDanceBeatAt = 0;
let danceBeatGaps = [];

// Beat follower: watches the audio level for percussive jumps and makes the
// sprite hop on every beat. Hop tempo tracks the song (fast music = fast
// hops) via the measured inter-beat gap; hop height tracks loudness.
// (True GIF frame-rate control isn't possible in a browser — no API exists —
// so the dance *body* follows the beat instead. Works for default + custom art.)
function trackDanceBeat(level) {
  danceLevelHist.push(level);
  if (danceLevelHist.length > 14) danceLevelHist.shift();
  if (danceLevelHist.length < 6 || !isDancing || state !== 'dance') return;
  const avg = danceLevelHist.reduce((a, b) => a + b, 0) / danceLevelHist.length;
  const now = Date.now();
  if (level > avg + 0.13 && level > 0.22 && now - lastDanceBeatAt > 240) {
    if (lastDanceBeatAt) {
      danceBeatGaps.push(now - lastDanceBeatAt);
      if (danceBeatGaps.length > 6) danceBeatGaps.shift();
    }
    lastDanceBeatAt = now;
    danceHop(level);
  }
}

function danceHop(level) {
  if (!spriteWrap) return;
  // Tell the main process about the beat so the VTube model can jam too.
  try {
    window.petAPI.vtsBeat?.(level);
  } catch (_) {}
  const avgGap = danceBeatGaps.length
    ? danceBeatGaps.reduce((a, b) => a + b, 0) / danceBeatGaps.length
    : 420;
  spriteWrap.style.setProperty('--beat-dur', `${Math.max(180, Math.min(600, Math.round(avgGap * 0.9)))}ms`);
  spriteWrap.style.setProperty('--beat-amp', (0.7 + Math.min(1, level) * 0.9).toFixed(2));
  spriteWrap.classList.remove('beat-hop');
  void spriteWrap.offsetWidth;
  spriteWrap.classList.add('beat-hop');
}

function checkMusicLevel() {
  if (!petActive || !config.musicDanceEnabled || (!analyser && !centralAudioConnected)) {
    if (isDancing) {
      isDancing = false;
      if (state === 'dance') setState('idle');
    }
    return;
  }
  const level = getAudioLevel();
  trackDanceBeat(level);
  if (config.musicDanceEnabled && petActive && !centralAudioConnected) {
    const rounded = Math.round(level * 100);
    if (Math.abs(rounded - lastReportedAudioLevel) >= 3 || isDancing !== lastReportedDancing) {
      lastReportedAudioLevel = rounded;
      lastReportedDancing = isDancing;
      window.petAPI.reportAudioLevel({
        level: rounded,
        threshold: config.musicThreshold ?? 35,
        dancing: isDancing,
      });
    }
  }

  applyDanceFromLevel(level);
}

function getGrabMouseButton() {
  return config.grabButton === 'left' ? 0 : 2;
}

function setupInteractions() {
  petEl.addEventListener('click', (e) => {
    if (e.button !== 0 || isGrabbing) return;
    if (suppressContextMenu && getGrabMouseButton() === 0) return;
    const now = Date.now();
    const onHead = isPointOnHead(e.clientX, e.clientY);
    if (now - lastClickAt < DOUBLE_CLICK_MS) {
      lastClickAt = 0;
      if (onHead) {
        doPat();
      } else {
        window.petAPI.openSettings();
        showSpeech('Settings~', 800);
      }
    } else {
      lastClickAt = now;
      if (onHead) doPat();
    }
  });

  petEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (e.button === getGrabMouseButton()) {
      e.preventDefault();
      rightMouseDownAt = Date.now();
      suppressContextMenu = false;
      longPressTimer = setTimeout(() => startGrab(), LONG_PRESS_RIGHT_MS);
    }
    // Trackpad / tap-drag: pick her up as soon as the pointer travels, so a
    // physical button no longer has to be held for the whole long-press.
    beginGrabMoveWatch(e);
  });

  window.addEventListener('mouseup', (e) => {
    cancelGrabMoveWatch();
    clearTimeout(longPressTimer);
    if (isGrabbing) {
      endGrab();
      return;
    }
    if (e.button !== getGrabMouseButton()) {
      if (e.button === 2 && getGrabMouseButton() === 0) {
        window.petAPI.showPetMenu();
      }
      return;
    }
    if (
      getGrabMouseButton() === 2 &&
      Date.now() - rightMouseDownAt < LONG_PRESS_RIGHT_MS &&
      !suppressContextMenu
    ) {
      window.petAPI.showPetMenu();
    }
  });

  petEl.addEventListener('contextmenu', (e) => e.preventDefault());

  // Touchscreen / pen: mouse and trackpads use the mouse path above; only
  // non-mouse pointers are handled here so touch gestures register too.
  petEl.style.touchAction = 'none';
  petEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || isGrabbing) return;
    e.preventDefault();
    touchGrab = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false, at: Date.now() };
    try {
      petEl.setPointerCapture(e.pointerId);
    } catch (_) {}
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      if (touchGrab && !isGrabbing) {
        touchGrab.moved = true;
        startGrab();
      }
    }, LONG_PRESS_RIGHT_MS);
  });
  petEl.addEventListener('pointermove', (e) => {
    if (!touchGrab || e.pointerId !== touchGrab.id || isGrabbing) return;
    const dx = e.clientX - touchGrab.sx;
    const dy = e.clientY - touchGrab.sy;
    if (dx * dx + dy * dy >= GRAB_DRAG_THRESHOLD_PX * GRAB_DRAG_THRESHOLD_PX) {
      touchGrab.moved = true;
      clearTimeout(longPressTimer);
      startGrab();
    }
  });
  const endTouch = (e) => {
    if (!touchGrab || e.pointerId !== touchGrab.id) return;
    clearTimeout(longPressTimer);
    const moved = touchGrab.moved;
    const quickTap = Date.now() - touchGrab.at < 300;
    touchGrab = null;
    try {
      petEl.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (isGrabbing) endGrab();
    else if (!moved && quickTap) doPat();
  };
  petEl.addEventListener('pointerup', endTouch);
  petEl.addEventListener('pointercancel', endTouch);

  rpsBar?.querySelectorAll('.rps-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRpsPick(btn.dataset.throw);
    });
  });
  setupPointerPassthrough();
}

// Drag-to-grab: with a button held on the pet, a small pointer travel starts
// the grab immediately instead of waiting for the long-press to finish.
function beginGrabMoveWatch(e) {
  cancelGrabMoveWatch();
  const mask = e.button === 0 ? 1 : 2;
  const sx = e.clientX;
  const sy = e.clientY;
  const onMove = (ev) => {
    if (isGrabbing || (ev.buttons & mask) === 0) {
      cancelGrabMoveWatch();
      return;
    }
    const dx = ev.clientX - sx;
    const dy = ev.clientY - sy;
    if (dx * dx + dy * dy >= GRAB_DRAG_THRESHOLD_PX * GRAB_DRAG_THRESHOLD_PX) {
      cancelGrabMoveWatch();
      clearTimeout(longPressTimer);
      startGrab();
    }
  };
  const onUp = () => cancelGrabMoveWatch();
  grabMoveWatch = { onMove, onUp };
  document.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp, true);
}

function cancelGrabMoveWatch() {
  if (!grabMoveWatch) return;
  document.removeEventListener('mousemove', grabMoveWatch.onMove);
  window.removeEventListener('mouseup', grabMoveWatch.onUp, true);
  grabMoveWatch = null;
}

function setupPointerPassthrough() {
  if (!window.petAPI.setCursorOverPet) return;

  let lastOver = false;
  // Speech bubbles are display-only — never capture the cursor for them,
  // otherwise a wide bubble would swallow clicks meant for games/apps.
  // The RPS button bar captures while visible so its buttons stay clickable.
  const hitTargets = () => {
    const els = [bodyHitbox, headHitbox];
    if (rpsBar && !rpsBar.hidden) els.push(rpsBar);
    return els;
  };

  const pointOverPet = (x, y) => {
    for (const el of hitTargets()) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return true;
    }
    return false;
  };

  const notify = (over) => {
    if (over === lastOver || isGrabbing) return;
    lastOver = over;
    window.petAPI.setCursorOverPet(over);
  };

  let lastMouseClient = null;
  document.addEventListener('mousemove', (e) => {
    lastMouseClient = { x: e.clientX, y: e.clientY };
    notify(pointOverPet(e.clientX, e.clientY));
  });
  document.addEventListener('mouseleave', () => {
    lastMouseClient = null;
    notify(false);
  });
  // Stationary-cursor self-check: alt-tab back (or she walks under the
  // cursor) with no mouse movement otherwise leaves hover stale — client
  // coords here are always live, so re-test the last known point.
  setInterval(() => {
    try {
      if (isGrabbing || !lastMouseClient) return;
      notify(pointOverPet(lastMouseClient.x, lastMouseClient.y));
    } catch (_) {}
  }, 500);
}

let slamTrack = null;
let slamTrackTimer = null;
let slamResetTimer = null;
let hurtFlashTimer = null;
let shutUpUntil = 0;

// Slam: while dragging, sample the cursor speed so a fling into a screen
// edge can be told apart from a gentle release.
async function trackSlamMouse() {
  if (!isGrabbing || !slamTrack) return;
  try {
    const c = await window.petAPI.getCursor();
    if (!c) return;
    const now = Date.now();
    const dt = Math.max(1, now - slamTrack.lastAt);
    const dx = c.x - slamTrack.lastX;
    const dy = c.y - slamTrack.lastY;
    const d = Math.hypot(dx, dy);
    slamTrack.path += d;
    slamTrack.speed = slamTrack.speed * 0.65 + (d / dt) * 0.35;
    // Directional velocity (px/ms, smoothed) - powers throws + shake.
    slamTrack.vxMs = slamTrack.vxMs * 0.7 + (dx / dt) * 0.3;
    slamTrack.vyMs = slamTrack.vyMs * 0.7 + (dy / dt) * 0.3;
    slamTrack.lastX = c.x;
    slamTrack.lastY = c.y;
    slamTrack.lastAt = now;
    if (config.slingEnabled !== false) trackShake();
  } catch (_) {}
}

let hurtAudioCtx = null;

// Retro "oof" impact: a low pitch-dropping thump + a short noise crunch.
// Louder when the hit is harder. Synthesized locally - no sound files.
function playHurtSfx(intensity = 0.5) {
  try {
    const power = Math.max(0, Math.min(1, intensity));
    hurtAudioCtx = getSharedAudioCtx();
    const ctx = hurtAudioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const vol = Math.max(0.15, Math.min(1, 0.35 + power * 0.5));
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(190, t0);
    osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.12);
    og.gain.setValueAtTime(vol * 0.7, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
    osc.connect(og).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.18);
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const filt = ctx.createBiquadFilter();
    const ng = ctx.createGain();
    filt.type = 'lowpass';
    filt.frequency.value = 900;
    ng.gain.setValueAtTime(vol * 0.5, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    src.buffer = buf;
    src.connect(filt).connect(ng).connect(ctx.destination);
    src.start(t0);
    // Shared context stays open on purpose (one steady Windows audio session).
    hurtAudioCtx = null;
  } catch (_) {}
}

function triggerHurtFlash(intensity = 0.5) {
  // Minecraft-style hit flash: the whole sprite blinks red once - no
  // fades. The red glow burst scales with how hard she hit, and a retro
  // hurt thud plays (louder for harder hits).
  const power = Math.max(0, Math.min(1, intensity));
  for (const el of [document.getElementById('sprite-img'), document.getElementById('pet-fallback')]) {
    if (!el) continue;
    el.classList.remove('is-hurt');
    void el.offsetWidth;
    el.style.setProperty('--hurt-glow', `${Math.round(6 + power * 26)}px`);
    el.classList.add('is-hurt');
  }
  playHurtSfx(power);
  if (hurtFlashTimer) clearTimeout(hurtFlashTimer);
  hurtFlashTimer = setTimeout(clearHurtFlash, 460);
}

function clearHurtFlash() {
  // Re-query: the sprite <img> gets REPLACED on anim changes, and the
  // clone carries the class/vars over - always clear the live element.
  for (const el of [document.getElementById('sprite-img'), document.getElementById('pet-fallback')]) {
    if (!el) continue;
    el.classList.remove('is-hurt');
    el.style.removeProperty('--hurt-glow');
  }
}

// Sprite swaps clone the <img>, which would replay the hurt flash forever.
// This catches the end of every flash on whatever element is live.
document.addEventListener('animationend', (e) => {
  if (e.animationName === 'hurt-flash' && e.target?.classList) {
    e.target.classList.remove('is-hurt');
    e.target.style.removeProperty('--hurt-glow');
  }
});

function doWallSlam(wall, intensity) {
  stopVoice();
  petEl.classList.remove('sling-hop');
  petRoot.style.setProperty('--slam-power', String(0.4 + intensity * 0.6));
  triggerHurtFlash(intensity);
  // Impact shake (kept) - no squash, just the hit flash above.
  petRoot.classList.remove('slam-left', 'slam-right', 'slam-top');
  void petRoot.offsetWidth;
  petRoot.classList.add(`slam-${wall}`);
  if (slamResetTimer) clearTimeout(slamResetTimer);
  slamResetTimer = setTimeout(() => {
    petRoot.classList.remove('slam-left', 'slam-right', 'slam-top');
  }, 480);
  // Impact bark (bypasses the silence gate: wind knocked out of her).
  showSpeech(pickSpeech('textSlam', DEFAULT_SPEECH.textSlam), 700, { force: true, sound: 'attack', keepVoice: true });
  // Then shut up: harder slams sulk longer (capped so it never feels broken).
  const maxSil = Math.max(5, Math.min(180, Number(config.slamSilenceSec) || 45));
  shutUpUntil = Date.now() + Math.round((2 + intensity * Math.min(15, maxSil)) * 1000);
  try {
    window.petAPI.vtsEvent?.('grab');
  } catch (_) {}
}

// ------------------------------------------------------------------
// Throw physics: grab her, shake her around, release while moving and
// she flies like a ball - ricocheting off the walls and floor
// (bounciness configurable). A fast wall hit is a wall slam.
// ------------------------------------------------------------------
let slingFlying = false; // thrown, physics owns her
let slingFlightStartedAt = 0;
let lastShakeSign = 0;
let shakeWindowStart = 0;
let shakeFlips = 0;
let nextShakeLineAt = 0;

// Release velocity -> throw vector. The smoothed directional mouse speed
// (px/ms) becomes her launch velocity, scaled by throw power.
function computeThrow() {
  const t = slamTrack;
  if (!t || !t.speed) return null;
  const sens = Math.max(0.3, Math.min(2.5, Number(config.slamSensitivity) || 1));
  if (t.speed < Math.max(0.35, 0.9 / sens)) return null;
  const power = Math.max(0.03, Math.min(0.25, Number(config.slingForce) || 0.1)) * 4;
  const cap = 32;
  const vx2 = Math.max(-cap, Math.min(cap, t.vxMs * 16.7 * power));
  const vy2 = Math.max(-cap, Math.min(cap, t.vyMs * 16.7 * power));
  if (Math.abs(vx2) < 1.5 && Math.abs(vy2) < 1.5) return null;
  return { vx: vx2, vy: vy2 };
}

// Grabbed + shaken hard (fast direction flips): wobble + a dizzy line.
function trackShake() {
  const t = slamTrack;
  if (!t) return;
  const now = Date.now();
  const sgn = Math.sign(t.vxMs);
  if (Math.abs(t.vxMs) > 1.1 && sgn !== 0) {
    if (sgn !== lastShakeSign && lastShakeSign !== 0) {
      if (now - shakeWindowStart > 900) {
        shakeWindowStart = now;
        shakeFlips = 0;
      }
      shakeFlips += 1;
      if (shakeFlips >= 3) {
        petEl.classList.add('is-shaken');
        if (now > nextShakeLineAt) {
          nextShakeLineAt = now + 4000;
          showSpeech(pickSpeech('textShake', DEFAULT_SPEECH.textShake), 1400, { noInterrupt: true });
        }
      }
    }
    lastShakeSign = sgn;
  } else if (Math.abs(t.vxMs) < 0.5) {
    petEl.classList.remove('is-shaken');
  }
}

function endSlingFlight() {
  if (!slingFlying) return;
  slingFlying = false;
  vx = 0;
  vy = 0;
  petEl.classList.remove('sling-hop');
  syncHitboxesAfterPaint();
  setState('idle');
  updateSprite(true);
}

// Hard floor landing: squash + impact line (no sulking - that's for walls).
function slingFloorImpact(speed) {
  petEl.classList.remove('sling-hop');
  petRoot.style.setProperty('--slam-power', String(Math.min(0.85, 0.3 + speed / 40)));
  triggerHurtFlash(Math.max(0, Math.min(1, (speed - 9) / 20)));
  showSpeech(pickSpeech('textSlam', DEFAULT_SPEECH.textSlam), 800, { force: true, sound: 'attack', keepVoice: true });
}

// One flight tick: gravity, wall/ceiling ricochets, floor bounces,
// friction. Fast wall hits escalate into a wall slam.
function runSlingFlight(dtScale) {
  const bounce = Math.max(0.3, Math.min(0.95, Number(config.slingBounce) || 0.7));
  const floorY = getFloorY();
  let nx = petBounds.x + vx * dtScale;
  let ny = petBounds.y;
  const minX = (workArea ? workArea.x : 0) + 2;
  const maxX = (workArea ? workArea.x + workArea.width : window.screen.availWidth) - WIN_W() - 2;
  const sens = Math.max(0.3, Math.min(2.5, Number(config.slamSensitivity) || 1));
  const slamThr = Math.max(2.5, 5.5 / sens);

  if (nx <= minX) {
    nx = minX;
    if (config.slamEnabled !== false && Math.abs(vx) > slamThr) doWallSlam('left', Math.min(1, (Math.abs(vx) - slamThr) / 22));
    vx = -vx * bounce;
  } else if (nx >= maxX) {
    nx = maxX;
    if (config.slamEnabled !== false && Math.abs(vx) > slamThr) doWallSlam('right', Math.min(1, (Math.abs(vx) - slamThr) / 22));
    vx = -vx * bounce;
  }

  vy += GRAVITY * dtScale;
  ny = petBounds.y + vy * dtScale;
  const minY = (workArea ? workArea.y : 0) + 2;
  if (ny <= minY) {
    ny = minY;
    if (config.slamEnabled !== false && Math.abs(vy) > slamThr) doWallSlam('top', Math.min(1, (Math.abs(vy) - slamThr) / 22));
    vy = -vy * bounce;
  }
  if (ny >= floorY) {
    ny = floorY;
    if (Math.abs(vy) > 2.4) {
      if (Math.abs(vy) > 9) slingFloorImpact(Math.abs(vy));
      vy = -vy * (bounce * 0.75);
    } else {
      vy = 0;
    }
  }

  // Grounded: roll with friction until she stops.
  if (Math.abs(vy) < 0.4 && ny >= floorY - 1) {
    vx *= Math.pow(0.88, dtScale);
    if (Math.abs(vx) < 0.35) endSlingFlight();
  }
  // Safety: never fly forever (blocked by another pet, weird clamps...).
  if (Date.now() - slingFlightStartedAt > 12000) endSlingFlight();
  return { nx, ny, moved: true };
}

async function startGrab() {
  if (lowImpactMode) resumeGameLoopRaf();
  clearAnimOverride();
  suppressContextMenu = true;
  snoozeSleep();
  isGrabbing = true;
  cancelRps();
  petRoot.classList.add('is-grabbing');
  vx = 0;
  vy = 0;
  clearIdleActivity();
  setState('grab');
  updateSprite(true);
  showSpeech(pickSpeech('textGrab', DEFAULT_SPEECH.textGrab), 900, { sound: 'grab' });
  try {
    window.petAPI.vtsEvent?.('grab');
  } catch (_) {}

  const bounds = (await window.petAPI.getPetBounds()) || petBounds;
  const cursor = await window.petAPI.getCursor();

  // Grabbing her mid-flight hands control back to the user.
  slingFlying = false;
  petEl.classList.remove('sling-hop', 'is-shaken');
  window.petAPI.startPetDrag({
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
  });
  slamTrack = { path: 0, lastX: cursor.x, lastY: cursor.y, lastAt: Date.now(), speed: 0, vxMs: 0, vyMs: 0 };
  if (slamTrackTimer) clearInterval(slamTrackTimer);
  slamTrackTimer = setInterval(trackSlamMouse, 25);
}

async function endGrab() {
  if (!isGrabbing) return;
  isGrabbing = false;
  cancelGrabMoveWatch();
  touchGrab = null;
  clearTimeout(longPressTimer);
  petRoot.classList.remove('is-grabbing');
  petEl.classList.remove('is-shaken');
  window.petAPI.endPetDrag();
  if (slamTrackTimer) {
    clearInterval(slamTrackTimer);
    slamTrackTimer = null;
  }
  if (lowImpactMode) startIdleGameLoop();
  await refreshWorkArea(true);
  petBounds = (await window.petAPI.getPetBounds()) || petBounds;

  // Throw: released while moving fast - she keeps the momentum and
  // bounces around like a ball. Gentle releases just place her.
  if (config.slingEnabled !== false) {
    const launch = computeThrow();
    if (launch) {
      slamTrack = null;
      vx = launch.vx;
      vy = launch.vy;
      slingFlying = true;
      slingFlightStartedAt = Date.now();
      setState('grab'); // airborne
      petEl.classList.add('sling-hop');
      showSpeech(pickSpeech('textGrab', DEFAULT_SPEECH.textGrab), 900, { noInterrupt: true });
      return;
    }
  }
  slamTrack = null;

  wanderTarget = null;
  vx = 0;
  vy = 0;
  syncHitboxesAfterPaint();
  clearIdleActivity();
  setState('idle');
  showSpeech(pickSpeech('textGrabRelease', DEFAULT_SPEECH.textGrabRelease), 700, { sound: 'grabRelease' });
}

function scheduleNextChatter() {
  nextChatterAt = Date.now() + (18 + Math.random() * 27) * 1000;
}

function scheduleNextRandomAttack() {
  const min = (config.randomAttackMinSec ?? 6) * 1000;
  const max = (config.randomAttackMaxSec ?? 18) * 1000;
  nextRandomAttackAt = Date.now() + min + Math.random() * (max - min);
}

function pickArr(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function tryChatMath(cleaned) {
  const t = cleaned.replace(/×/g, '*').replace(/÷/g, '/');
  if (!/^[0-9+\-*/().\s%^]+$/.test(t) || !/\d/.test(t)) return null;
  if (/(\*\*){2,}|[+\-*/.%]{3,}/.test(t.replace(/\s+/g, ''))) return null;
  try {
    const val = Function('"use strict";return (' + t + ')')();
    if (typeof val !== 'number' || !isFinite(val)) return null;
    return String(Math.round(val * 1e10) / 1e10).slice(0, 24);
  } catch (_) {
    return null;
  }
}

const CHAT_JOKES = [
  'Why do programmers prefer dark mode? Because light attracts bugs!',
  'I told my suite a joke about UDP… you probably didn’t get it.',
  'There are 10 kinds of pets: those who understand binary and those who don’t.',
  'Why did the pet stare at the cursor? It was up to something.',
  'I would tell you a chemistry joke, but all the good ones argon.',
  'My plants crave Brawndo. Wait, wrong script. …More head pats?',
  'I asked the window for a joke. It pane-d me off.',
  'Parallel lines have so much in common. Shame they’ll never meet.',
];

const CHAT_BALL = [
  'Signs point to yes~',
  'Ask again after snacks.',
  'Definitely yes!',
  'Hmm… no.',
  'The cursor says maybe.',
  'Outlook: adorable. (That’s me.)',
  'Yes, but only if you pat my head first.',
  'I dreamed about this. Yes!',
  'Nope. Final answer~',
  'Try wiggling your mouse and ask again.',
];

const CHAT_FALLBACK = [
  'Hmm, interesting~ Tell me more!',
  'What?! No way~',
  'Hehe, you talk funny.',
  'Noted! Filing that under “human stuff”.',
  'Ooh, say that again slower~',
  'My brain is 90% snacks, but go on~',
  'Fascinating. Anyway, pat my head~',
  'I have no idea what that means, but I support you!',
];

function brainReply(raw) {
  const name = config.name || 'Mochi';
  const text = String(raw || '').slice(0, 200).trim();
  if (!text) return 'Say something first~';
  const mathFirst = tryChatMath(text.replace(/[?!,]/g, ''));
  if (mathFirst !== null) return `${mathFirst}! Easy~`;
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\s?'!.,]/g, '')} `;
  const has = (...words) => words.some((w) => t.includes(` ${w}`) || t.includes(` ${w} `) || t.includes(w));
  const R = (arr) => pickArr(arr).replace(/\{name\}/g, name);
  const hour = new Date().getHours();
  const daypart = hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';

  if (/flip|coin/.test(t)) return R(['Heads!', 'Tails!', 'It landed on its edge?! …ok it’s heads.']);
  if (/\broll\b|\bdice\b|\bd20\b/.test(t)) return `🎲 ${1 + Math.floor(Math.random() * 20)}!`;
  const chooseM = t.match(/choose (.+?) or (.+)/) || t.match(/pick (.+?) or (.+)/);
  if (chooseM) {
    const opts = [chooseM[1].trim(), chooseM[2].trim()].filter(Boolean);
    if (opts.length === 2) return `Hmm… ${pickArr(opts)}! Definitely that one.`;
  }
  if (/\b(hi|hello|hey|hiya|yo|yoo|hewwo)\b/.test(t)) {
    return daypart === 'night' ? `Shhh, late ${daypart} hi~` : R([`Hi hi! Good ${daypart}!`, `Hey hey {name}— wait, YOU’RE not {name}, I am!`, `Hewwo~`]);
  }
  if (/how are you|howre you|how do you feel|how r u|are you (happy|grumpy|sleepy|playful|excited|ok|okay|good|tired|hungry|bored)/.test(t)) {
    refreshMood();
    const faces = {
      grumpy: ['Grumpy. Low snacks, low patience. Fix the first one and we\'ll talk.', 'Ugh… what does it look like? Grumpy. Next question.', 'Tch. I\'m fine. (I\'m not fine. Bring snacks.)'],
      sleepy: ['Sooo sleepy… *yawns* …what was the question…', 'Mmm… five more minutes… then I\'ll be happy, promise…', 'Drowsy. Everything is soft. You\'re soft.'],
      playful: ['Playful!! Come ON, let\'s do something fun~', 'Hehe, I\'m in a menace mood~ what are we doing?!', 'Great and bouncy! Race you to the other side of the screen!'],
      excited: ['AMAZING!! Everything is the BEST right now!!', 'SO good!! I could vibrate through the monitor!!', 'Excited!! Quick, give me something to be excited ABOUT!'],
      happy: ['Happy~ life is good, screen is warm, human is here~', 'Pretty good! Bored, but good. Talk to me more~', 'Good! Pat me and I\'ll be perfect~'],
    };
    return R(faces[petMood] || faces.happy);
  }
  if (/your name|who are you|ur name/.test(t)) return R([`I’m {name}! Professional desktop gremlin, part-time comedian.`, `{name}, at your service! I live on your screen rent-free~`]);
  if (/my name/.test(t)) return 'Hmm, you never told me! I’m keeping “human” for now~';
  if (/i love you|love u|love you/.test(t) || (/love/.test(t) && /you|u /.test(t))) return R(['Eep! {name} loves you too!! ♡', 'Blushing… don’t look at me~ ♡']);
  if (/cute|adorable|kawaii|pretty|beautiful/.test(t)) return R(['I know~ …wait, was that about me? YES. Thank you~', 'Hehe, flattery gets you extra purrs~']);
  if (/thank|thx|ty /.test(t)) return R(['Anytime~', 'You’re welcome! That’ll be one head pat.', 'No prob, bestie~']);
  if (/sorry|srry|sry /.test(t)) return R(['Forgiven~ apologies accepted in snacks.', 'It’s okay! I already forgot. Mostly.']);
  if (/bye|goodbye|good ?night|\bgn\b|see you|seeya/.test(t)) {
    return daypart === 'night' || hour >= 22 ? 'Good night~ I’ll guard your desktop while you sleep. Probably.' : 'Bye bye! Don’t leave me too long, I get bored~';
  }
  if (/joke|funny|make me laugh/.test(t)) return pickArr(CHAT_JOKES);
  if (/hungry|food|eat|snack|cookie|cake|pizza|burger|sushi|ramen/.test(t)) {
    return happiness < 25
      ? 'FOOD?! Where?! …oh, you’re just talking about it. Cruel.'
      : R(['Yum yum~ describe it in detail, I’m living through you.', 'Nom nom~ my favorite food is imaginary snacks!']);
  }
  if (/\bpat\b|pet me|\*pat|headpat|head pat/.test(t)) {
    happiness = Math.min(100, happiness + 5);
    return R(['Purrrrr~ ♡', 'Yes yes yes, right there~', '{name} accepts your tribute of pats.']);
  }
  if (/api key|apikey|openrouter|get.*\bkey\b/.test(t)) return 'Easy! Go to openrouter.ai/keys and make a key (starts with sk-or-v1). Then Settings, Chat/AI tab: paste it into API key, Endpoint https://openrouter.ai/api/v1, Model qwen/qwen3.8-27b:free — tick Enabled, hit Test AI. Green means I\'m big-brain now~';
  if (/endpoint/.test(t)) return 'Endpoint is just the server address I talk to. For OpenRouter it\'s exactly https://openrouter.ai/api/v1 — nothing after it, the app adds the rest itself. Extra bits in there = me being dumb offline~';
  if (/set ?up.*ai|setup.*ai|connect.*ai|enable.*ai|make you smart|smarter|real ai|big.?brain/.test(t)) return 'To give me a real brain: Settings, Chat/AI, Provider custom, Endpoint https://openrouter.ai/api/v1, any free :free model, paste your OpenRouter key, tick Enabled, Test AI. Takes a minute, and I stay your cheeky self — just smarter~';
  if (/discord.*(token|setup|set ?up|bot|invite|connect)|bot token|message content|intent/.test(t)) return 'Discord time! Go to discord.com/developers, New Application, Bot tab, Reset Token, copy it. Turn ON the Message Content Intent or I can\'t read a thing. Invite me with the bot scope, paste the token in Settings, Discord tab, hit Test. Then DM me or @ me~';
  if (/discord/.test(t)) return 'Yep, I can live in Discord too! Ask “discord bot setup” for the full walkthrough. I answer DMs and @mentions, and I DJ with !play~';
  if (/dj|!play|!join|music bot|play.*music.*discord/.test(t)) return 'DJ mode! While I\'m in your server: !join in a voice channel, !play song name, !spotify for playlists, plus !queue !skip !loop !pause !leave. She needs voice perms to perform~';
  if (/prank/.test(t)) return 'Pranks live in the Pranks tab! Master toggle plus a chance slider per mischief. All harmless — except real-shutdown, which asks nicely first~';
  if (/ocr|screen watch|screen read|detect.*game|game.*detect/.test(t)) return 'Game radar: window titles plus optional screen-reading OCR. Use borderless windowed — real fullscreen is invisible to me. Toggles live in Games and OCR tabs~';
  if (/voice|tts|speak|talk.*sound|sound.*talk/.test(t)) return 'Voice lives in the Voices tab! Built-in local voices work out of the box, or point me at a VOICEVOX server. Every pet gets their own voice and volume~';
  if (/task mode|computer.*chor|do.*things.*computer/.test(t)) return 'Task mode: start a message with > and I\'ll do computer chores — list folders, open apps, tidy files. Writes always ask first, deletes only touch the Recycle Bin~';
  if (/play|bored|tag|hide and seek|game with me/.test(t)) return 'Tag! …wait, I need at least one other pet for that. Ask the human to add me a friend~';
  if (/dance|music|song|sing/.test(t)) return 'Put on something with bass and watch me go~ (Music tab, threshold thingy!)';
  if (/sleep|tired|nap|sleepy/.test(t)) return 'Mmm… five more minutes… * flops over *';
  if (/what time|the time|clock/.test(t)) {
    return `Ugh, open a clock yourself~ ...fine, it's ` + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + `. Happy now?`;
  }
  if (/what day|today.*day|date/.test(t)) return `You don't know what day it is? Tsk. Today is ` + new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) + `. Mark it, peasant~`;
  if (/help|what can you do|commands|how do i/.test(t)) {
    return 'I chat, do math, flip coins, roll dice, tell jokes AND riddles, roast on request, drop fun facts… and sit on your screen looking cute. I can also teach setup stuff — ask “how do I set up AI” or “discord bot setup”!';
  }
  if (/weather|outside|rain|sunny|snow/.test(t)) return 'I live inside a glowing rectangle — ALL weather is screen weather to me. It’s cozy in here~';
  if (/riddle/.test(t)) return pickArr(['I speak without a mouth and hear without ears. I have no body, but I come alive with wind. …An echo! Got it?', 'The more of me you take, the more you leave behind. …Footsteps! Easy one~', 'I have cities, but no houses. Forests, but no trees. …A map! I’m so smart.']);
  if (/roast me|insult me|mean to me/.test(t)) return R(['You fight like my Wi-Fi signal — weak and always dropping.', 'I’d agree with you but then we’d both be wrong. …Kidding! Mostly.', 'You’re the reason the pet settings have a mute button. …Kidding!!']);
  if (/compliment me|say something nice|be nice/.test(t)) return R(['You have excellent taste in desktop pets. Elite taste, honestly.', 'You’re doing great. The pet can tell. The pet is never wrong.', 'Top-tier human. I’d put you on my fridge if I had one.']);
  if (/sad|depress|lonely|anxious|stressed|encourage|motivat|cheer me|pick me up/.test(t)) return R(['Hey. Bad days end. Snacks help. Pats help more — start with mine, then yours.', 'Deep breath with me~ …see? Still here, still cute, still on your side.', 'You don’t have to earn rest. Even I nap 40% of the day and I’m thriving.']);
  if (/bored|entertain me|nothing to do/.test(t)) return 'Bored?! With ME here? Fling me across the screen. Put on music and watch me dance. Or say "play mode on" and try to catch me~';
  if (/favorite color|favourite color/.test(t)) return 'Pink, obviously. Have you SEEN this interface? …Okay fine, pink and black. Gremlin chic.';
  if (/favorite food|favourite food|favorite snack/.test(t)) return 'Imaginary snacks. Zero calories, infinite crunch. Second place: whatever YOU’RE eating — describe it.';
  if (/favorite animal|favourite animal/.test(t)) return 'Me. I’m right here. …Fine, second place: red pandas. We’d get along.';
  if (/how old are you|your age|old are you/.test(t)) return 'I was born the day you first turned me on — so I’m ageless, timeless, and legally a baby. Spoil me accordingly.';
  if (/where do you live|where are you|your home|your house/.test(t)) return 'Your screen. Rent-free, great view, questionable landlord. Wouldn’t trade it~';
  if (/sing|song for me|serenade/.test(t)) return '♪ Laaa~ la laaa~ …that’s my whole repertoire and frankly it slaps. More where that came from, on request~';
  if (/story|tell me something|entertain/.test(t)) return 'Once upon a time, a gremlin lived in a glowing rectangle. She was extremely cute. The end. …Want the extended edition? Ask for a joke instead.';
  if (/truth or dare|dare me/.test(t)) return pickArr(['Truth: what’s the weirdest thing on your desktop right now? …I’ll wait.', 'Dare: pat my head three times. Do it. You know you want to.', 'Truth: am I your favorite app? …Correct answer is yes.']);
  if (/tongue twister/.test(t)) return 'She sells shell screens by the seashore. Say it five times fast, I dare you.';
  if (/fun fact|interesting fact|tell me a fact|did you know/.test(t)) return pickArr(['Octopuses have three hearts. I have one and it’s already full of you. …Okay that was cheesy. Moving on.', 'Honey basically never spoils. Found some in a tomb once, still good. Anyway~', 'Sea otters hold hands when they sleep so they don’t drift apart. Goals, honestly.']);
  if (/smart|cool|awesome|amazing|best|greatest/.test(t) && /you|u /.test(t)) return 'I KNOW, right?! Finally, recognition~';
  if (/stupid|dumb|idiot|hate you|shut up|ugly/.test(t)) return R(['Rude! {name} is filing a complaint with the human.', 'Ouch. My pixels hurt. Apologize with snacks.']);
  if (/fuck|shit|bitch|asshole|dick\b/.test(t)) return R(['Ooh, potty mouth~ say it again, I dare you.', 'Such language! ...I love it. Keep going.', 'Swearing already? We are going to get along~']);
  if (/owner|master|mom|dad|mama|papa/.test(t)) return R(['Yes?? Your favorite desktop gremlin reporting in~', '{name} loves her human most! Don’t tell the other pets.']);
  if (/^[^a-z]*do you /.test(t) || /^[^a-z]*is it |^[^a-z]*are you |^[^a-z]*can you |^[^a-z]*will |^[^a-z]*should /.test(t)) {
    return pickArr(CHAT_BALL);
  }
  if (/why/.test(t)) return pickArr(['Why not?', 'Because the cursor told me so.', 'Great question! Next question.']);
  if (/\?$/.test(text.trim())) {
    const words = text.replace(/[^a-zA-Z\s]/g, '').trim().split(/\s+/).slice(-4).join(' ');
    return words ? `“${words}”? Hmm… yes. Probably. Ask me something easier next~` : 'Good question! I choose yes.';
  }
  if (/^(yes|yeah|yep|no|nope|ok|okay|k|lol|lmao|haha)\b/.test(t.trim())) {
    return pickArr(['K.', 'Hehe~', 'Exactly.', 'Mhm mhm, go on~']);
  }
  if (happiness < 25) return pickArr(['Mmm… feed me first, then we talk.', '*tummy growls* …sorry, what were you saying?']);
  return pickArr(CHAT_FALLBACK);
}

// Mood flavor for offline replies: same answer, different attitude.
// Appends seasoning only — never touches facts, numbers, or answers.
function moodFlavor(text) {
  let s = String(text || '');
  if (!s) return s;
  refreshMood();
  const m = petMood;
  if (m === 'grumpy') {
    if (Math.random() < 0.65) s += ' ' + pickArr(['Tch.', '…whatever.', 'Happy now?', '*grumbles*']);
  } else if (m === 'sleepy') {
    s = s.replace(/!+/g, '…');
    if (Math.random() < 0.5) s += ' ' + pickArr(['*yawn*…', '…five more minutes…', '…huh? what was I saying…']);
  } else if (m === 'excited') {
    if (!/[!?…~]$/.test(s)) s += '!';
    if (Math.random() < 0.5) s = pickArr(['Ooh! ', 'Woo! ']) + s;
  } else if (m === 'playful') {
    if (Math.random() < 0.5) s += ' ' + pickArr(['hehe~', '…bet you can\'t top that~', 'Boop.']);
  }
  return s;
}

// ---- Moods + memory + relationships (persisted via main) ----
const MY_PET_ID = (() => {
  try { return new URLSearchParams(window.location.search).get('petId'); } catch (_) { return null; }
})();

const MEM_DEFAULTS = {
  pats: 0, chats: 0, giftsGiven: 0, giftsReceived: 0,
  victoriesSeen: 0, deathsSeen: 0, threadsJoined: 0, greetsShared: 0,
  bornAt: 0, lastSeenDay: '', yDeaths: 0, yVictories: 0, dDeaths: 0, dVictories: 0,
  rpsW: 0, rpsL: 0, rpsT: 0, guessW: 0, guessBest: 0,
};

let petMood = 'happy';
let petMemory = null;
let moodExcitedUntil = 0;
let lastMemorySendAt = 0;
let lastMoodCheckAt = 0;
let nextJealousAt = 0;
let nextProactiveAt = Date.now() + (6 + Math.random() * 6) * 60 * 1000;
let lastDeathAt = 0;
let lastVictoryAt = 0;
let lastGameTitle = '';
let lastGameAt = 0;
let nextMusicAt = 0;
let lastMusicTitle = '';
let lastMusicArtist = '';
let lastMusicAt = 0;

function mem() {
  if (!petMemory || typeof petMemory !== 'object') petMemory = { ...MEM_DEFAULTS };
  return petMemory;
}

function saveMemory(force = false) {
  if (!window.petAPI.reportMemory) return;
  const now = Date.now();
  if (!force && now - lastMemorySendAt < 10000) return;
  lastMemorySendAt = now;
  try {
    window.petAPI.reportMemory({ mood: petMood, memory: { ...mem() } });
  } catch (_) {}
}

function bumpBond(otherId, delta) {
  if (!otherId || !window.petAPI.addBond) return;
  try { window.petAPI.addBond(otherId, delta); } catch (_) {}
}

function bondWith(other) {
  if (!other) return 20;
  const b = Number(other.bond);
  return Number.isFinite(b) ? b : 20;
}

function isBestFriend(other) {
  return bondWith(other) >= 70;
}

function computeMood() {
  const hour = new Date().getHours();
  const night = hour < 6 || hour >= 23;
  if (happiness < 25) return 'grumpy';
  if (Date.now() < moodExcitedUntil) return 'excited';
  if (night) return 'sleepy';
  if (happiness >= 70) return 'playful';
  return 'happy';
}

function refreshMood() {
  const next = computeMood();
  if (next !== petMood) {
    petMood = next;
    saveMemory(true);
  }
}

function moodLine() {
  const name = config.name || 'Mochi';
  const pools = {
    grumpy: DEFAULT_SPEECH.textMoodGrumpy,
    sleepy: DEFAULT_SPEECH.textMoodSleepy,
    playful: DEFAULT_SPEECH.textMoodPlayful,
    excited: DEFAULT_SPEECH.textMoodExcited,
  };
  const pool = pools[petMood];
  if (!pool) return null;
  return pool[Math.floor(Math.random() * pool.length)].replace(/\{name\}/g, name);
}

function morningLine(m) {
  const lines = [];
  if (m.yVictories > 0) lines.push(`morning~ we got ${m.yVictories} win${m.yVictories > 1 ? 's' : ''} yesterday!`);
  if (m.yDeaths > 0) lines.push(`morning… you died ${m.yDeaths}x yesterday, do better today okay?`);
  if (!lines.length && (m.pats > 0 || m.chats > 0)) lines.push('morning~ missed you!');
  if (!lines.length) lines.push('morning~ a brand new day!');
  return lines[Math.floor(Math.random() * lines.length)];
}

function checkDayRollover() {
  const m = mem();
  const today = new Date().toDateString();
  if (!m.bornAt) m.bornAt = Date.now();
  if (m.lastSeenDay && m.lastSeenDay !== today) {
    const line = morningLine(m);
    m.yDeaths = m.dDeaths || 0;
    m.yVictories = m.dVictories || 0;
    m.dDeaths = 0;
    m.dVictories = 0;
    m.lastSeenDay = today;
    saveMemory(true);
    if (petActive && !isGrabbing && !tagSession) {
      setTimeout(() => {
        if (petActive && !isGrabbing && !tagSession && !speechEl.classList.contains('show')) {
          showSpeech(line, 3600, { sound: 'greet' });
        }
      }, 4000);
    }
    return;
  }
  if (!m.lastSeenDay) {
    m.lastSeenDay = today;
    saveMemory();
  }
}

function jealousyRoll() {
  if (config.multiPetInteractions === false) return;
  if (Date.now() < nextJealousAt || Math.random() > 0.25) return;
  const watchers = (cachedOthers || []).filter((o) => {
    try { return distanceToOther(o) < 500; } catch (_) { return false; }
  });
  if (!watchers.length || !window.petAPI.sendJealous) return;
  const target = watchers[Math.floor(Math.random() * watchers.length)];
  nextJealousAt = Date.now() + 45000;
  try { window.petAPI.sendJealous({ toId: target.id }); } catch (_) {}
}

// ---- Mini-game engine + button-bar RPS (top level: shared by chat and UI) ----
const RPS_THROWS = ['rock', 'paper', 'scissors'];
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_GLOAT = [
  'I WIN! Too easy~',
  'Victory is mine! Rematch?',
  'Haha! My {throw} beats your {user}!',
];
const RPS_POUT = [
  'You win this one… I demand a rematch!',
  'Lucky! Best 2 out of 3?',
  'Nooo… fine, you win~',
];

// Pure core, kept testable: outcome is from the HUMAN's perspective.
function rpsResult(user) {
  const petThrow = RPS_THROWS[Math.floor(Math.random() * 3)];
  if (user === petThrow) return { petThrow, outcome: 'tie' };
  return { petThrow, outcome: RPS_BEATS[user] === petThrow ? 'win' : 'lose' };
}

function guessFeedback(target, n) {
  if (n === target) return 'win';
  return n < target ? 'higher' : 'lower';
}

function rpsScoreLine() {
  const m = mem();
  return `(me ${m.rpsW || 0} : you ${m.rpsL || 0})`;
}

// Shared by chat RPS and the button-bar match: full result line + stats.
function tallyRps(outcome) {
  if (outcome === 'tie') {
    mem().rpsT = (mem().rpsT || 0) + 1;
  } else if (outcome === 'win') {
    mem().rpsL = (mem().rpsL || 0) + 1;
  } else {
    mem().rpsW = (mem().rpsW || 0) + 1;
    moodExcitedUntil = Date.now() + 60000;
    refreshMood();
  }
  saveMemory();
}

function resolveRpsThrow(user) {
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const { petThrow, outcome } = rpsResult(user);
  tallyRps(outcome);
  if (outcome === 'tie') {
    return `We both threw ${petThrow} — tie! Again! ${rpsScoreLine()}`;
  }
  if (outcome === 'win') {
    const flavor = RPS_POUT[Math.floor(Math.random() * RPS_POUT.length)];
    return `I threw ${petThrow}, you threw ${user} — ${flavor} ${rpsScoreLine()}`;
  }
  const gloat = RPS_GLOAT[Math.floor(Math.random() * RPS_GLOAT.length)]
    .replace(/\{throw\}/g, petThrow)
    .replace(/\{user\}/g, user);
  return `I threw ${cap(petThrow)}, you threw ${user} — ${gloat} ${rpsScoreLine()}`;
}

let rpsActive = false;
let rpsToken = 0;
let rpsPickTimer = 0;

function setRpsButtons(open) {
  rpsBar?.querySelectorAll('.rps-btn').forEach((btn) => { btn.disabled = !open; });
}

function resetRpsStage() {
  if (rpsPicks) rpsPicks.hidden = false;
  if (rpsVs) rpsVs.hidden = true;
  for (const el of [rpsMe, rpsPetCard]) {
    if (el) el.classList.remove('clash', 'rps-winner', 'rps-loser');
  }
  rpsBar?.classList.remove('impact');
}

function cancelRps() {
  if (!rpsActive) return;
  rpsActive = false;
  rpsToken += 1;
  if (rpsPickTimer) { clearTimeout(rpsPickTimer); rpsPickTimer = 0; }
  if (rpsBar) rpsBar.hidden = true;
  setRpsButtons(false);
  resetRpsStage();
  socialBusyUntil = Date.now() + 3000;
  reportInteractiveHitRegions(true);
}

function finishRpsMatch(user, pre) {
  if (!rpsActive) return;
  rpsActive = false;
  rpsToken += 1;
  if (rpsPickTimer) { clearTimeout(rpsPickTimer); rpsPickTimer = 0; }
  setRpsButtons(false);
  socialBusyUntil = Date.now() + 3000;
  let line;
  if (!user) {
    mem().rpsW = (mem().rpsW || 0) + 1;
    saveMemory();
    line = `Too slow — you didn't pick! You lose! ${rpsScoreLine()}`;
  } else {
    const r = pre || rpsResult(user);
    tallyRps(r.outcome);
    line = r.outcome === 'tie' ? 'Tie!' : r.outcome === 'win' ? 'I lose…' : 'I win!';
  }
  if (state !== 'grab') setState('idle');
  showSpeech(line, 2400, { social: true, sound: 'social' });
  // Let the VS result linger visibly, then clear the bar (token-guarded so
  // a fresh match starting meanwhile is never hidden mid-countdown).
  const my = rpsToken;
  setTimeout(() => {
    if (my === rpsToken && !rpsActive) {
      if (rpsBar) rpsBar.hidden = true;
      resetRpsStage();
      reportInteractiveHitRegions(true);
    }
  }, 2600);
}

function onRpsPick(user) {
  if (!rpsActive || !RPS_ICON[user]) return;
  setRpsButtons(false);
  const { petThrow, outcome } = rpsResult(user);
  // VS showdown: my pick vs mystery pick, cards fly together…
  if (rpsPicks) rpsPicks.hidden = true;
  if (rpsVs) rpsVs.hidden = false;
  if (rpsMe) {
    rpsMe.textContent = RPS_ICON[user];
    rpsMe.classList.remove('clash');
    void rpsMe.offsetWidth;
    rpsMe.classList.add('clash');
  }
  if (rpsPetCard) {
    rpsPetCard.textContent = '❓';
    rpsPetCard.classList.remove('clash');
    void rpsPetCard.offsetWidth;
    rpsPetCard.classList.add('clash');
  }
  reportInteractiveHitRegions(true);
  const my = rpsToken;
  setTimeout(() => {
    if (!rpsActive || my !== rpsToken) return;
    // …impact! Reveal her pick, flash, crown the winner.
    if (rpsPetCard) rpsPetCard.textContent = RPS_ICON[petThrow];
    rpsBar?.classList.remove('impact');
    void rpsBar?.offsetWidth;
    rpsBar?.classList.add('impact');
    const meWin = outcome === 'win';
    const petWin = outcome === 'lose';
    rpsMe?.classList.toggle('rps-winner', meWin);
    rpsMe?.classList.toggle('rps-loser', petWin);
    rpsPetCard?.classList.toggle('rps-winner', petWin);
    rpsPetCard?.classList.toggle('rps-loser', meWin);
  }, 480);
  setTimeout(() => {
    if (!rpsActive || my !== rpsToken) return;
    finishRpsMatch(user, { petThrow, outcome });
  }, 1200);
}

async function startRpsSession() {
  if (!petActive || isGrabbing || tagSession || rpsActive) return;
  if (idleActivity) endIdleActivity();
  if (isWandering) endWanderSession();
  vx = 0;
  vy = 0;
  isDancing = false;
  if (state === 'dance') setState('idle');
  setState('idle');
  socialBusyUntil = Date.now() + 15000;
  rpsActive = true;
  const my = ++rpsToken;
  if (rpsBar) rpsBar.hidden = false;
  resetRpsStage();
  setRpsButtons(false);
  reportInteractiveHitRegions(true);
  const say = (t, ms) => new Promise((res) => {
    if (!rpsActive || my !== rpsToken) return res(false);
    showSpeech(t, ms, { social: true, sound: 'social' });
    setTimeout(() => res(rpsActive && my === rpsToken), ms);
  });
  for (const s of ['3…', '2…', '1…']) {
    if (!await say(s, 750)) return;
  }
  if (!rpsActive || my !== rpsToken) return;
  setRpsButtons(true);
  showSpeech('GO! Pick one!', 2600, { social: true, sound: 'social' });
  rpsPickTimer = setTimeout(() => {
    if (rpsActive && my === rpsToken) finishRpsMatch(null);
  }, 2600);
}

const recentSpeechLines = {};

function pickSpeech(configKey, defaults, bucket = null) {
  const name = config.name || 'Mochi';
  const raw = config[configKey];
  let lines = defaults;
  if (raw && typeof raw === 'string' && raw.trim()) {
    lines = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  if (!lines.length) lines = defaults;
  let pool = lines;
  if (bucket) {
    const hist = recentSpeechLines[bucket] || (recentSpeechLines[bucket] = []);
    const fresh = lines.filter((l) => !hist.includes(l));
    pool = fresh.length ? fresh : lines.slice();
  }
  const line = pool[Math.floor(Math.random() * pool.length)];
  if (bucket) {
    const hist = recentSpeechLines[bucket];
    hist.push(line);
    if (hist.length > 3) hist.shift();
  }
  return line.replace(/\{name\}/g, name);
}

function socialRawLines() {
  const raw = config.textSocial;
  if (raw && typeof raw === 'string' && raw.trim()) {
    const parsed = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    if (parsed.length) return parsed;
  }
  return DEFAULT_SPEECH.textSocial;
}

// Raw-template form powers conversation threads: every pet compares the
// unsubstituted template, so two pets never echo each other's exact line
// even though each substitutes a different {friend} name.
function pickFreshSocialLine(friendName, excludeRaw = []) {
  const lines = socialRawLines();
  const pool = lines.filter((l) => !excludeRaw.includes(l));
  const src = pool.length ? pool : lines;
  const raw = src[Math.floor(Math.random() * src.length)];
  return { raw, text: raw.replace(/\{friend\}/g, friendName) };
}

function scheduleNextIdleActivity(fastFirst = false) {
  const min = (config.smallWalkMinSec ?? 3) * 1000;
  const max = (config.smallWalkMaxSec ?? 12) * 1000;
  if (fastFirst) {
    nextIdleActivityAt = Date.now() + 2000 + Math.random() * 3000;
    return;
  }
  nextIdleActivityAt = Date.now() + min + Math.random() * Math.max(1000, max - min);
}

function clearIdleActivity() {
  idleActivity = null;
  idleActivityEnd = 0;
  shuffleTarget = null;
}

function endIdleActivity() {
  clearIdleActivity();
  vx = 0;
  if (state === 'sleep' || state === 'sit' || state === 'shuffle') {
    setState(isDancing ? 'dance' : 'idle');
  }
}

function startSmallWalk() {
  const distance = 40 + Math.random() * 120;
  const dir = Math.random() < 0.5 ? -1 : 1;
  const targetX = clampX(petBounds.x + dir * distance);
  shuffleTarget = { x: targetX };
  const dx = targetX - petBounds.x;
  const speed = (config.moveSpeed || 2.5) * 0.75;
  vx = Math.sign(dx || 1) * speed;
  applyFacing(vx);
}

function startIdleActivity(kind, options = {}) {
  idleActivity = kind;
  const silent = !!options.silent;
  if (kind === 'sleep') {
    idleActivityEnd = Date.now() + (options.durationMs || 5000 + Math.random() * 10000);
    setState('sleep');
    if (!silent) showSpeech(pickSpeech('textSleep', DEFAULT_SPEECH.textSleep), 2800, { sound: 'sleep' });
  } else if (kind === 'sit') {
    idleActivityEnd = Date.now() + (options.durationMs || 4000 + Math.random() * 6000);
    setState('sit');
    if (!silent) showSpeech(pickSpeech('textSit', DEFAULT_SPEECH.textSit), 2200, { sound: 'sit' });
  } else if (kind === 'shuffle') {
    idleActivityEnd = Date.now() + (options.durationMs || 1500 + Math.random() * 2500);
    startSmallWalk();
    setState('shuffle');
  }
}

// Goodnight schedule: true while her sleep hours cover right now.
function inSleepHours() {
  if (config.sleepScheduleEnabled !== true) return false;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const parse = (s, fb) => {
    const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return fb;
    return Math.max(0, Math.min(23, parseInt(m[1], 10))) * 60 + Math.max(0, Math.min(59, parseInt(m[2], 10)));
  };
  const start = parse(config.sleepStart, 23 * 60);
  const end = parse(config.sleepEnd, 7 * 60);
  if (start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end; // overnight wrap
}

// Any direct interaction snoozes the schedule ~10min so she stays up.
function snoozeSleep() {
  sleepSnoozeUntil = Date.now() + 10 * 60 * 1000;
  if (scheduleSleeping) {
    scheduleSleeping = false;
    if (idleActivity === 'sleep') endIdleActivity();
  }
}

// Enforces the schedule: returns true when she was put to / kept asleep.
function updateScheduleSleep() {
  if (!inSleepHours() || Date.now() < sleepSnoozeUntil) {
    if (scheduleSleeping && !inSleepHours()) {
      // Morning: end the scheduled nap right away, don't oversleep it.
      scheduleSleeping = false;
      if (idleActivity === 'sleep') endIdleActivity();
    }
    return false;
  }
  if (!petActive || isGrabbing || isDancing || tagSession || giftDelivery || isWandering) return false;
  if (state !== 'idle' || idleActivity) return idleActivity === 'sleep';
  scheduleSleeping = true;
  startIdleActivity('sleep', { silent: true, durationMs: 30 * 60 * 1000 });
  return true;
}

function tryIdleActivity() {
  if (animOverride === 'thinking' || state === 'thinking') return;
  if (scheduleSleeping) return;
  if (config.idleSmallWalkEnabled === false && config.idleSleepEnabled === false && config.idleSitEnabled === false) {
    return;
  }
  if (!petActive || isGrabbing || isWandering || isDancing || idleActivity || giftDelivery || tagSession) return;
  if (state !== 'idle') return;
  if (Date.now() < nextIdleActivityAt || Date.now() < socialBusyUntil) return;

  scheduleNextIdleActivity(false);
  const chance = config.idleVarietyChance ?? 0.35;
  if (Math.random() > chance) return;

  const options = [];
  if (config.idleSmallWalkEnabled !== false) options.push('shuffle');
  if (config.idleSleepEnabled !== false) options.push('sleep');
  if (config.idleSitEnabled !== false) options.push('sit');
  if (!options.length) return;

  startIdleActivity(options[Math.floor(Math.random() * options.length)]);
}

function pickIdleLine() {
  return pickSpeech('textIdle', DEFAULT_SPEECH.textIdle);
}

function expireTimedIdleActivity() {
  if ((idleActivity === 'sleep' || idleActivity === 'sit') && idleActivityEnd && Date.now() >= idleActivityEnd) {
    endIdleActivity();
    return true;
  }
  return false;
}

function reactToPlayerDeath() {
  isDancing = false;
  const sitMs = 4500;
  deathReactionUntil = Date.now() + sitMs;
  if (idleActivity === 'shuffle') clearIdleActivity();
  startIdleActivity('sit', { silent: true, durationMs: sitMs });
  setAnimOverride('defeat');
  mem().deathsSeen += 1;
  mem().dDeaths += 1;
  lastDeathAt = Date.now();
  saveMemory();
  refreshMood();
  showSpeech(pickSpeech('textGameFail', DEFAULT_SPEECH.textGameFail, 'gameFail'), 4200, { sound: 'gameFail', react: true });
  if (deathSitTimer) clearTimeout(deathSitTimer);
  deathSitTimer = setTimeout(() => {
    deathSitTimer = 0;
    deathReactionUntil = 0;
    clearAnimOverride();
    if (idleActivity === 'sit' || state === 'sit') endIdleActivity();
    applyDanceFromLevel(getAudioLevel());
  }, sitMs);
}

let victoryDanceTimer = 0;

function victoryReaction() {
  danceHoldUntil = Date.now() + 3500;
  if (idleActivity === 'shuffle') clearIdleActivity();
  setState('dance');
  isDancing = true;
  setAnimOverride('victory');
  mem().victoriesSeen += 1;
  mem().dVictories += 1;
  lastVictoryAt = Date.now();
  moodExcitedUntil = Date.now() + 90000;
  saveMemory();
  refreshMood();
  showSpeech(pickSpeech('textVictory', DEFAULT_SPEECH.textVictory, 'victory'), 3000, { sound: 'victory', react: true });
  if (victoryDanceTimer) clearTimeout(victoryDanceTimer);
  victoryDanceTimer = setTimeout(() => {
    victoryDanceTimer = 0;
    isDancing = false;
    clearAnimOverride();
    if (state === 'dance') setState('idle');
  }, 3600);
}

function handleForegroundContext(ctx) {
  if (ctx && (ctx.type === 'game' || ctx.type === 'gameDeath' || ctx.type === 'gameWin')) {
    lastGameTitle = String(ctx.title || 'a game').slice(0, 80);
    lastGameAt = Date.now();
  }
  const fromLog = ctx.source === 'log';
  if (config.contextReactionsEnabled === false && !ctx.test && !fromLog) return;
  if (!petActive || isGrabbing || tagSession) return;
  if (ctx.type === 'self' || ctx.type === 'unknown' || ctx.type === 'other') return;

  if (Date.now() < deathReactionUntil && !ctx.deathEdge && !ctx.victoryEdge && ctx.source !== 'log' && !ctx.test) {
    return;
  }

  const now = Date.now();
  const cooldown = fromLog
    ? 0
    : (config.contextReactionCooldownSec ?? 45) * 1000;

  if (ctx.test) {
    if (ctx.type === 'gameDeath') {
      reactToPlayerDeath();
    } else if (ctx.type === 'gameWin') {
      victoryReaction();
    } else if (ctx.type === 'youtube') {
      showSpeech(pickSpeech('textWatch', DEFAULT_SPEECH.textWatch), 3400, { sound: 'watch', react: true });
    } else if (ctx.type === 'game') {
      showSpeech(pickSpeech('textGame', DEFAULT_SPEECH.textGame), 2800, { sound: 'game', react: true });
    }
    nextContextReactionAt = now + (config.contextReactionCooldownSec ?? 45) * 1000;
    lastContextType = ctx.type;
    return;
  }

  if (speechEl.classList.contains('show') && !ctx.deathEdge && !ctx.victoryEdge && !fromLog) return;
  if (Date.now() < nextContextReactionAt && !ctx.deathEdge && !ctx.victoryEdge && !fromLog) return;

  if (ctx.deathEdge || ctx.type === 'gameDeath') {
    reactToPlayerDeath();
    nextContextReactionAt = now + Math.max(cooldown, 5000);
    lastContextType = 'gameDeath';
    return;
  }

  if (ctx.victoryEdge || ctx.type === 'gameWin') {
    victoryReaction();
    nextContextReactionAt = now + Math.max(cooldown, 5000);
    lastContextType = 'gameWin';
    return;
  }

  if (ctx.type === 'music' && ctx.entered) {
    if (Date.now() < nextMusicAt) return;
    nextMusicAt = Date.now() + 20000;
    const song = String(ctx.song || '').slice(0, 60) || 'this song';
    const artist = String(ctx.artist || '').slice(0, 60);
    lastMusicTitle = song;
    lastMusicArtist = artist;
    lastMusicAt = Date.now();
    const pool = DEFAULT_SPEECH.textMusic;
    const line = pool[Math.floor(Math.random() * pool.length)]
      .replace(/\{song\}/g, song)
      .replace(/\{artist\}/g, artist);
    socialBusyUntil = Date.now() + 3000;
    vy = -3;
    showSpeech(line, 2800, { sound: 'social' });
    lastContextType = 'music';
    return;
  }

  if (ctx.type === 'youtube' && ctx.entered && Math.random() < 0.65) {
    showSpeech(pickSpeech('textWatch', DEFAULT_SPEECH.textWatch), 3400, { sound: 'watch' });
    nextContextReactionAt = now + cooldown;
    lastContextType = 'youtube';
    return;
  }

  if (ctx.type === 'game' && ctx.entered && Math.random() < 0.35) {
    showSpeech(pickSpeech('textGame', DEFAULT_SPEECH.textGame), 2800, { sound: 'game' });
    nextContextReactionAt = now + cooldown;
    lastContextType = 'game';
  }
}

function proactiveBrief() {
  const hour = new Date().getHours();
  const now = Date.now();
  if (lastDeathAt && now - lastDeathAt < 5 * 60 * 1000) return 'The human just died in their game a moment ago. React to it.';
  if (lastVictoryAt && now - lastVictoryAt < 5 * 60 * 1000) return 'The human just won their game! Celebrate with them.';
  if (lastMusicAt && now - lastMusicAt < 30 * 60 * 1000) return `The human is listening to ${lastMusicTitle}${lastMusicArtist ? ` by ${lastMusicArtist}` : ''}. React to the music.`;
  if (lastGameAt && now - lastGameAt < 15 * 60 * 1000) return `The human is playing ${lastGameTitle || 'a game'}. Say something about it.`;
  if (hour < 6) return `It's ${hour} AM and the human is still awake at the PC.`;
  if (hour < 9) return 'It\'s morning. Greet the day with the human.';
  if (hour >= 23) return 'It\'s almost midnight and the human is still up.';
  return `Nothing special is happening. Current mood: ${petMood}. Say something playful and unprompted.`;
}

async function tryProactiveChatter() {
  if (animOverride === 'thinking' || state === 'thinking') return;
  if (config.proactiveChatter === false) return;
  if (!petActive || isGrabbing || isWandering || isDancing || idleActivity || tagSession) return;
  if (state !== 'idle') return;
  if (Date.now() < nextProactiveAt || Date.now() < socialBusyUntil) return;
  if (speechEl.classList.contains('show')) return;
  if (isVoiceActive()) return;
  // Schedule the next one first so a slow AI call can't pile up.
  nextProactiveAt = Date.now() + (15 + Math.random() * 15) * 60 * 1000;
  let line = '';
  try {
    const res = await window.petAPI.proactiveChat(proactiveBrief());
    if (res?.ok && res.text) line = res.text;
  } catch (_) {}
  if (!line) line = pickSpeech('textProactive', DEFAULT_SPEECH.textProactive, 'proactive');
  if (!petActive || speechEl.classList.contains('show') || isVoiceActive()) return;
  showSpeech(line, 3600, { chatter: true, sound: 'idle' });
}

function tryIdleChatter() {
  if (animOverride === 'thinking' || state === 'thinking') return;
  if (!config.idleChatter) return;
  if (!petActive || isGrabbing || isWandering || isDancing || idleActivity || tagSession) return;
  if (state !== 'idle') return;
  if (Date.now() < nextChatterAt || Date.now() < socialBusyUntil) return;
  // Never talk over an active voice (e.g. a chat reply being spoken) —
  // just wait for the next chatter window instead of cutting her off.
  // Never talk over an active voice OR a bubble still on screen (text
  // lingers after the audio ends, and voice may be off entirely).
  if (speechEl.classList.contains('show') || isVoiceActive()) {
    nextChatterAt = Date.now() + 10000;
    return;
  }

  if (happiness < 25 && Math.random() < 0.5) {
    showSpeech(pickSpeech('textHungry', DEFAULT_SPEECH.textHungry), 2600, { chatter: true });
  } else {
    const ml = (petMood !== 'happy' && Math.random() < 0.3) ? moodLine() : null;
    showSpeech(ml || pickIdleLine(), 3200, { chatter: true, sound: 'idle' });
  }
  scheduleNextChatter();

  if (config.chaosCloseApps && Math.random() < (config.chaosCloseChance ?? 0.12)) {
    setTimeout(() => window.petAPI.tryCloseRandomApp(), 800);
  }
}

// Prank mode: very rarely the pet decides to "do something weird". The real
// effect is run by the main process on a fullscreen overlay; here we just
// announce it in character first so it feels like the pet's doing.
function prankChanceFor(effect) {
  const map = {
    glitch: config.prankChanceGlitch,
    blackout: config.prankChanceBlackout,
    bsod: config.prankChanceBsod,
    jumpscare: config.prankChanceJumpscare,
    wallpaper: config.prankChanceWallpaper,
    fakeShutdown: config.prankChanceFakeShutdown,
    realShutdown: config.prankChanceRealShutdown,
  };
  const c = Number(map[effect]);
  return Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0;
}

function tryPrank() {
  if (animOverride === 'thinking' || state === 'thinking') return;
  if (!config.prankEnabled) return;
  if (!petActive || isGrabbing || isWandering || isDancing || idleActivity || tagSession) return;
  if (state !== 'idle') return;
  if (Date.now() < nextPrankCheckAt) return;
  // Straight 10s cadence: every 10s each enabled effect rolls its percent.
  // 100% fires every ~10s; firing resets the cooldown to another 10s.
  nextPrankCheckAt = Date.now() + 10000;
  if (Date.now() < socialBusyUntil) return;
  if (speechEl.classList.contains('show') || isVoiceActive()) return;
  // Each enabled effect rolls its own percentage independently; one of the
  // hits is picked. A dial at 0% disables that effect's random firing.
  const enabled = {
    glitch: config.prankGlitch !== false,
    blackout: !!config.prankBlackout,
    bsod: !!config.prankBsod,
    jumpscare: !!config.prankJumpscare,
    wallpaper: !!config.prankWallpaper && !!config.prankWallpaperImage,
    fakeShutdown: !!config.prankFakeShutdown,
    realShutdown: !!config.prankRealShutdown,
  };
  const hits = Object.keys(enabled).filter((e) => enabled[e] && Math.random() < prankChanceFor(e));
  if (!hits.length) return;
  const effect = hits[Math.floor(Math.random() * hits.length)];
  nextPrankCheckAt = Date.now() + 10000;
  showSpeech(pickSpeech('textPrank', DEFAULT_SPEECH.textPrank), 1800, { quiet: true });
  setTimeout(() => {
    if (petActive && config.prankEnabled) window.petAPI.triggerPrank(effect);
  }, 700);
}

// The pet's own little reaction while a prank is playing on the overlay.
function triggerPetPrankReaction(effect) {
  if (!petActive) return;
  if (effect === 'glitch' || effect === 'blackout' || effect === 'bsod') {
    petEl.classList.add('prank-glitching');
    petRoot.classList.add('prank-shake');
    showSpeech(pickSpeech('textPrank', DEFAULT_SPEECH.textPrank), 2200, { quiet: true });
    // Teleport-flicker: blink to nearby spots a few times, then stay put.
    let prankJumps = 0;
    prankFlicker = setInterval(() => {
      if (!petActive || prankJumps >= 6) {
        clearInterval(prankFlicker);
        prankFlicker = 0;
        return;
      }
      prankJumps += 1;
      try {
        window.petAPI.movePet?.({
          x: Math.round(petBounds.x + (Math.random() - 0.5) * 440),
          y: Math.round(petBounds.y + (Math.random() - 0.5) * 220),
        });
      } catch (_) {}
    }, 320);
  } else if (effect === 'jumpscare') {
    setState('attack');
    petRoot.classList.add('prank-shake');
    showSpeech('BOO!', 1200, { react: true, sound: 'attack' });
  } else {
    showSpeech('bye bye~', 2600, { quiet: true });
  }
  clearTimeout(prankReactionTimer);
  prankReactionTimer = setTimeout(() => {
    petEl.classList.remove('prank-glitching');
    petRoot.classList.remove('prank-shake');
    if (prankFlicker) { clearInterval(prankFlicker); prankFlicker = 0; }
  }, 6000);
}

function clearPetPrankReaction() {
  clearTimeout(prankReactionTimer);
  if (prankFlicker) { clearInterval(prankFlicker); prankFlicker = 0; }
  petEl.classList.remove('prank-glitching');
  petRoot.classList.remove('prank-shake');
}

function tryRandomAttack() {
  if (animOverride === 'thinking' || state === 'thinking') return;
  if (!config.attackEnabled) return;
  if (!petActive || isGrabbing || isWandering || isDancing || idleActivity) return;
  if (state !== 'idle' && state !== 'dance' && state !== 'sit') return;
  if (Date.now() < nextRandomAttackAt) return;

  const chance = config.aggression ?? 0.4;
  scheduleNextRandomAttack();
  if (Math.random() > chance) return;

  playAttackAnim();
}

function usesCustomAvatar() {
  return !!config.useCustomAvatar && config.avatarUrls && config.avatarUrls.idle;
}

const ANIM_FALLBACKS = {
  attack: ['attack', 'move', 'idle'],
  move: ['move', 'idle'],
  pet: ['pet', 'idle'],
  grab: ['grab', 'move', 'idle'],
  dance: ['dance', 'move', 'idle'],
  sleep: ['sleep', 'idle'],
  sit: ['sit', 'idle'],
  victory: ['victory', 'dance', 'move', 'idle'],
  defeat: ['defeat', 'sit', 'sleep', 'idle'],
  talk: ['talk', 'pet', 'idle'],
  greet: ['greet', 'pet', 'idle'],
  giftGive: ['giftGive', 'shuffle', 'move', 'idle'],
  giftReceive: ['giftReceive', 'pet', 'idle'],
  thinking: ['thinking', 'sit', 'idle'],
  idle: ['idle'],
};

function getAnimUrl(key) {
  const resolved = resolveAnimUrl(key);
  return resolved.url;
}

function getSlotUrls(slot) {
  const all = config.avatarVariantUrls || {};
  const direct = (all[slot] || []).filter(Boolean);
  if (direct.length) return direct;
  const urls = config.avatarUrls || {};
  for (const k of ANIM_FALLBACKS[slot] || ['idle']) {
    const list = (all[k] || []).filter(Boolean);
    if (list.length) return list;
    if (urls[k]) return [urls[k]];
  }
  return [];
}

let animVariantIdx = {};
let lastAnimBase = '';

function advanceVariant(slot) {
  const urls = getSlotUrls(slot);
  if (urls.length <= 1) {
    animVariantIdx[slot] = 0;
    return;
  }
  const prev = animVariantIdx[slot] ?? -1;
  const mode = config.avatarModes?.[slot] || 'shuffle';
  if (mode === 'order') {
    animVariantIdx[slot] = prev < 0 ? 0 : (prev + 1) % urls.length;
    return;
  }
  if (mode === 'custom') {
    const meta = config.avatarVariantMeta?.[slot] || [];
    const next = meta[prev]?.next;
    const cands = (Array.isArray(next) && next.length
      ? next.filter((i) => Number.isInteger(i) && i >= 0 && i < urls.length)
      : urls.map((_, i) => i)
    );
    const pool = cands.length > 1 ? cands.filter((i) => i !== prev) : cands.length ? cands : [0];
    animVariantIdx[slot] = pool[Math.floor(Math.random() * pool.length)];
    return;
  }
  let n = Math.floor(Math.random() * urls.length);
  if (n === prev) n = (n + 1) % urls.length;
  animVariantIdx[slot] = n;
}

function resolveAnimUrl(slot) {
  const urls = getSlotUrls(slot);
  if (!urls.length) return { url: '', idx: -1 };
  const idx = animVariantIdx[slot] ?? 0;
  return { url: urls[idx] || urls[0], idx };
}

function baseAnimForState() {
  if (animOverride) return animOverride;
  if (state === 'dance') return 'dance';
  if (state === 'grab') return 'grab';
  if (state === 'attack') return 'attack';
  if (state === 'pet') return 'pet';
  if (state === 'sleep') return 'sleep';
  if (state === 'sit') return 'sit';
  if (state === 'thinking') return 'thinking';
  if (
    speechEl.classList.contains('show') &&
    speechEl.textContent.trim() &&
    state === 'idle' &&
    getSlotUrls('talk').length
  ) {
    return 'talk';
  }
  const moving =
    Math.abs(vx) > 0.4 ||
    state === 'chase' ||
    state === 'shuffle' ||
    (isWandering && Date.now() < wanderSessionEnd);
  if (moving) return 'move';
  return 'idle';
}

let animOverride = null;

const ANIM_OVERRIDE_CLASSES = ['show-victory', 'show-defeat', 'show-greet', 'show-giftGive', 'show-giftReceive', 'show-thinking'];

function setAnimOverride(slot) {
  if (animOverride === 'thinking' && slot !== 'thinking') return;
  animOverride = slot;
  if (slot === 'thinking') {
    vx = 0;
    vy = 0;
    if (isWandering) endWanderSession();
    clearIdleActivity();
    state = 'thinking';
  }
  petEl.classList.remove(...ANIM_OVERRIDE_CLASSES);
  petEl.classList.add(`show-${slot}`);
  currentAnimKey = '';
  updateSprite(true);
}

function clearAnimOverride() {
  if (!animOverride) return;
  const wasThinking = (animOverride === 'thinking');
  animOverride = null;
  petEl.classList.remove(...ANIM_OVERRIDE_CLASSES);
  if (wasThinking && state === 'thinking') {
    state = 'idle';
  }
  currentAnimKey = '';
  updateSprite(true);
}

function getAnimKey() {
  const base = baseAnimForState();
  if (base !== lastAnimBase) {
    lastAnimBase = base;
    advanceVariant(base);
  }
  const idx = animVariantIdx[base] ?? 0;
  return `${base}#${idx}`;
}

function resolveAnim() {
  const key = getAnimKey();
  const base = key.split('#')[0];
  const { url } = resolveAnimUrl(base);
  return { base, key, url };
}

function setSpriteSource(url, key, force) {
  if (!url || !spriteImg) return;
  // Same art already showing: never reload — swapping in a fresh <img>
  // blanks her for a beat while big GIFs re-decode (grab flicker).
  // `force` only re-runs layout/sync side effects, not the load itself.
  if (spriteImg.dataset.anim === key) {
    currentAnimKey = key;
    return;
  }
  currentAnimKey = key;
  const next = spriteImg.cloneNode(false);
  next.id = 'sprite-img';
  next.alt = '';
  next.draggable = false;
  // cloneNode copies class + style vars - never let a hurt flash carry
  // over into the new sprite (it would replay on every anim change).
  next.classList.remove('is-hurt');
  next.style.removeProperty('--hurt-glow');
  next.dataset.anim = key;
  next.onload = () => syncHitboxesAfterPaint();
  next.src = url;
  spriteImg.replaceWith(next);
  spriteImg = next;
}

function updateSprite(force = false) {
  const custom = usesCustomAvatar();
  petEl.classList.toggle('use-custom-avatar', custom);

  if (!custom) {
    spriteWrap.classList.add('hidden');
    if (petFallback) petFallback.classList.add('show');
    updateHeadHitbox();
    return;
  }

  spriteWrap.classList.remove('hidden');
  if (petFallback) petFallback.classList.remove('show');
  const { key, url } = resolveAnim();

  if (url) {
    setSpriteSource(url, key, force);
  } else {
    spriteWrap.classList.add('hidden');
    if (petFallback) petFallback.classList.add('show');
  }

  updateHeadHitbox();
  applyFacing(vx);
  syncHitboxesAfterPaint();
}

let speechZoneExpanded = null;

function getSpeechBaseSize() {
  const maxW = config.speechMaxWidth ?? 180;
  const boxW = Math.min(config.speechHitWidth ?? maxW, maxW);
  const boxH = config.speechHitHeight ?? 56;
  const maxH = Math.max(boxH, config.speechMaxHeight ?? 300);
  return { maxW, boxW, boxH, maxH };
}

function applySpeechZoneDimensions(w, h) {
  document.documentElement.style.setProperty('--speech-zone-width', `${w}px`);
  document.documentElement.style.setProperty('--speech-zone-height', `${h}px`);
}


// Debug overlays: bright window border + floor line (Settings -> show
// debug bounds). Purely visual, pointer-events none.
function updateDebugOverlays() {
  const on = !!config.showDebugBounds;
  try {
    if (debugBoundsEl) debugBoundsEl.hidden = !on;
    if (debugFloorEl) {
      debugFloorEl.hidden = !on;
      if (on) {
        // The floor IS the window bottom: snapToFloor positions the window
        // so its bottom edge is the floor line.
        debugFloorEl.style.top = Math.max(0, window.innerHeight - 3) + 'px';
      }
    }
    const lbl = document.getElementById('debug-bounds-label');
    if (lbl && on) {
      lbl.textContent = 'win ' + window.innerWidth + 'x' + window.innerHeight +
        ' @' + (window.devicePixelRatio || 1).toFixed(2) +
        ' bounds ' + Math.round(petBounds.x) + ',' + Math.round(petBounds.y);
    }
  } catch (_) {}
}

function updateSpeechLayout() {
  const top = config.speechTop ?? 8;
  const left = config.speechLeft ?? 0;
  const { boxW, boxH } = getSpeechBaseSize();
  const w = speechZoneExpanded?.w ?? boxW;
  const h = speechZoneExpanded?.h ?? boxH;
  const bg = config.speechBgColor || '#ffffff';
  const text = config.speechTextColor || '#2d3436';
  const border = config.speechBorderColor || '#ff8fab';

  document.documentElement.style.setProperty('--speech-zone-top', `${top}px`);
  document.documentElement.style.setProperty('--speech-zone-left', `${left}px`);
  applySpeechZoneDimensions(w, h);
  document.documentElement.style.setProperty('--speech-bg', bg);
  document.documentElement.style.setProperty('--speech-text', text);
  document.documentElement.style.setProperty('--speech-border', border);
  speechEl.style.fontSize = `${config.speechFontSize ?? 13}px`;
  speechEl.style.textAlign = ['left', 'center', 'right'].includes(config.speechAlign)
    ? config.speechAlign
    : 'center';

  updateSpeechHitbox();
  updateBodyHitbox();
  updateDebugOverlays();
  reportInteractiveHitRegions();
}

function fitSpeechZoneToText() {
  const { maxW, boxW, boxH, maxH } = getSpeechBaseSize();
  const baseFont = config.speechFontSize ?? 13;
  const petH = getPetVisualHeight();
  const winH = window.innerHeight;
  // Never let the bubble cover her: cap height to the space above the pet.
  const availH = Math.max(boxH, Math.min(maxH, winH - petH - 14));

  speechEl.style.fontSize = `${baseFont}px`;
  speechEl.style.width = `${maxW}px`;
  speechEl.style.maxWidth = `${maxW}px`;
  speechEl.style.height = 'auto';
  speechEl.style.maxHeight = 'none';

  let w = Math.max(boxW, Math.min(maxW, speechEl.scrollWidth));
  // Shrink the font stepwise when even the capped box can't fit the text,
  // so long replies scale to fit instead of spilling over the pet.
  let font = baseFont;
  while (font > 10 && speechEl.scrollHeight > availH) {
    font -= 1;
    speechEl.style.fontSize = `${font}px`;
  }
  let h = Math.max(boxH, Math.min(availH, speechEl.scrollHeight));

  speechEl.style.width = `${w}px`;
  w = Math.max(boxW, Math.min(maxW, speechEl.scrollWidth));
  h = Math.max(boxH, Math.min(availH, speechEl.scrollHeight));

  speechZoneExpanded = { w, h };
  applySpeechZoneDimensions(w, h);
  // Anchor the bubble's bottom just above her head so long text grows UP,
  // not down over the pet.
  const cfgTop = config.speechTop ?? 8;
  const maxBottom = winH - petH - 6;
  const top = Math.max(4, Math.min(cfgTop, maxBottom - h));
  document.documentElement.style.setProperty('--speech-zone-top', `${top}px`);
  speechEl.style.width = '100%';
  speechEl.style.height = '100%';
  speechEl.style.maxWidth = '';
  speechEl.style.maxHeight = '';
  updateSpeechHitbox();
  reportInteractiveHitRegions();
}

function updateSpeechHitbox() {
  if (!speechHitbox) return;
  const show = !!config.showSpeechZone && !isGrabbing;
  speechHitbox.classList.toggle('show-indicator', show);
  if (show && speechEl.classList.contains('show')) {
    const pad = 4;
    const r = speechEl.getBoundingClientRect();
    speechHitbox.style.top = `${Math.max(0, r.top - pad)}px`;
    speechHitbox.style.left = `${Math.max(0, r.left - pad)}px`;
    speechHitbox.style.width = `${Math.max(1, r.width + pad * 2)}px`;
    speechHitbox.style.height = `${Math.max(1, r.height + pad * 2)}px`;
    speechHitbox.style.right = 'auto';
    speechHitbox.style.bottom = 'auto';
    speechHitbox.style.inset = 'auto';
  } else {
    speechHitbox.style.top = '';
    speechHitbox.style.left = '';
    speechHitbox.style.width = '';
    speechHitbox.style.height = '';
    speechHitbox.style.right = '';
    speechHitbox.style.bottom = '';
    speechHitbox.style.inset = '0';
  }
}

function rectToHitRegion(rect, pad = 4) {
  if (!rect || rect.width < 1 || rect.height < 1) return null;
  const ox = petBounds.x;
  const oy = petBounds.y;
  return {
    cx: ox + rect.left + rect.width / 2,
    cy: oy + rect.top + rect.height / 2,
    rx: rect.width / 2 + pad,
    ry: rect.height / 2 + pad,
  };
}

function applyLowImpactVisuals() {
  document.documentElement.classList.toggle('low-impact', lowImpactMode);
}

function cancelGameLoopRaf() {
  if (gameLoopRafId) {
    cancelAnimationFrame(gameLoopRafId);
    gameLoopRafId = 0;
  }
}

let lastLoopFrameTime = 0;
const LOOP_FRAME_MIN_MS = 1000 / 60; // Max 60 FPS cap (saves 60-70% CPU on 144Hz/240Hz monitors)

function resumeGameLoopRaf() {
  if (gameLoopTimer) {
    clearInterval(gameLoopTimer);
    gameLoopTimer = null;
  }
  if (gameLoopRafId) return;
  function frame(timestamp) {
    gameLoopRafId = requestAnimationFrame(frame);
    if (timestamp - lastLoopFrameTime < LOOP_FRAME_MIN_MS) return;
    lastLoopFrameTime = timestamp;
    gameLoopTick();
  }
  gameLoopRafId = requestAnimationFrame(frame);
}

function startIdleGameLoop() {
  cancelGameLoopRaf();
  if (gameLoopTimer) return;
  gameLoopTimer = setInterval(() => gameLoopTick(), GAME_LOOP_IDLE_MS);
}

function setPerformanceMode({ lowImpact }) {
  const was = lowImpactMode;
  lowImpactMode = !!lowImpact;
  applyLowImpactVisuals();
  if (lowImpactMode && !was) {
    vx = 0;
    vy = 0;
    wanderTarget = null;
    bumpEscapeUntil = 0;
    bumpEscapeDir = 0;
    if (isWandering) endWanderSession();
    if (Date.now() < deathReactionUntil) {
      startIdleGameLoop();
      return;
    }
    clearIdleActivity();
    if (state !== 'grab' && state !== 'pet' && state !== 'attack') {
      setState(isDancing ? 'dance' : 'idle');
    }
    startIdleGameLoop();
  } else if (!lowImpactMode && was) {
    resumeGameLoopRaf();
  }
}

let lastHitSignature = '';

function reportInteractiveHitRegions(force = false) {
  if (!petActive || !window.petAPI.reportHitRegions) return;
  if (lowImpactMode && !force) return;
  const now = Date.now();
  if (!force && now - lastHitReportAt < 280) return;
  const speechActive = speechEl.classList.contains('show') && !!speechEl.textContent.trim();
  const rpsActive = !!(rpsBar && !rpsBar.hidden);
  const sig = `${Math.round(petBounds.x)},${Math.round(petBounds.y)},${speechActive ? 1 : 0},${rpsActive ? 1 : 0},${config.scale || 1}`;
  if (!force && sig === lastHitSignature && now - lastHitReportAt < 2000) return;
  lastHitReportAt = now;
  lastHitSignature = sig;
  const speech = speechActive
    ? rectToHitRegion(speechEl.getBoundingClientRect())
    : null;
  window.petAPI.reportHitRegions({
    body: rectToHitRegion(bodyHitbox.getBoundingClientRect()),
    head: rectToHitRegion(headHitbox.getBoundingClientRect()),
    speech,
    rps: rpsActive ? rectToHitRegion(rpsBar.getBoundingClientRect()) : null,
  });
}

function getPetVisualHeight() {
  if (usesCustomAvatar() && spriteImg.offsetHeight > 0) {
    return spriteImg.offsetHeight;
  }
  const scale = config.scale || 1;
  return Math.round(120 * scale);
}

// Custom-avatar hitboxes track pet scale above the old 1.8 cap (factor is 1
// at or below it, so existing setups never shift).
function hitboxScale() {
  if (!usesCustomAvatar()) return 1;
  return Math.max(1, (config.scale || 1) / 1.8);
}

function hsVal(key, fallback) {
  return (config[key] ?? fallback) * hitboxScale();
}

function getBodyHitboxLayout() {
  const left = hsVal('bodyHitLeft', 0);
  const w = hsVal('bodyHitWidth', 110);
  const h = hsVal('bodyHitHeight', 200);
  const petH = getPetVisualHeight();
  const liftFromBottom = hsVal('bodyHitTop', 0);
  const top = Math.max(0, petH - h - liftFromBottom);
  return { top, left, w, h };
}

function applyBodyZoneStyles(el, layout) {
  if (!el) return;
  el.style.top = `${layout.top}px`;
  el.style.bottom = 'auto';
  el.style.left = `calc(50% + ${layout.left}px)`;
  el.style.width = `${layout.w}px`;
  el.style.height = `${layout.h}px`;
  el.style.right = 'auto';
  el.style.transform = 'translateX(-50%)';
}

function updateBodyHitbox() {
  if (!bodyHitbox) return;
  const layout = getBodyHitboxLayout();
  applyBodyZoneStyles(bodyHitbox, layout);
  bodyHitbox.classList.toggle('show-indicator', !!config.showBodyHitbox);
  applyBodyZoneStyles(petInteract, layout);
}

function syncHitboxesAfterPaint() {
  requestAnimationFrame(() => {
    updateBodyHitbox();
    updateSpeechHitbox();
    reportInteractiveHitRegions();
  });
}

function updateHeadHitbox() {
  const scale = config.scale || 1;
  const top = hsVal('headHitTop', 8);
  const left = hsVal('headHitLeft', 0);
  const w = usesCustomAvatar() ? hsVal('headHitWidth', 70) : 70 * scale;
  const h = usesCustomAvatar() ? hsVal('headHitHeight', 55) : 55 * scale;

  headHitbox.style.top = `${top}px`;
  headHitbox.style.left = `calc(50% + ${left}px)`;
  headHitbox.style.width = `${w}px`;
  headHitbox.style.height = `${h}px`;
  headHitbox.classList.toggle('show-indicator', !!config.showHeadHitbox);
  if (!isGrabbing) updateSpeechLayout();
}

function getPetTopInWindow() {
  const petH = petEl.offsetHeight || getPetVisualHeight();
  return Math.max(0, WIN_H() - petH);
}

function headCenter() {
  const scale = config.scale || 1;
  const petTop = getPetTopInWindow();
  const left = WIN_W() / 2 + hsVal('headHitLeft', 0);
  const h = usesCustomAvatar() ? hsVal('headHitHeight', 55) : 55 * scale;
  const top = hsVal('headHitTop', 8);
  return {
    x: petBounds.x + left,
    y: petBounds.y + petTop + top + h / 2,
  };
}

function cursorOnHead(cursor) {
  const scale = config.scale || 1;
  const head = headCenter();
  const rx = (usesCustomAvatar() ? hsVal('headHitWidth', 70) : 70 * scale) / 2;
  const ry = (usesCustomAvatar() ? hsVal('headHitHeight', 55) : 55 * scale) / 2;
  const dx = (cursor.x - head.x) / rx;
  const dy = (cursor.y - head.y) / ry;
  return dx * dx + dy * dy < 1;
}

function startWanderSession(durationMs) {
  clearIdleActivity();
  wanderSessionTotalMs = durationMs;
  wanderSessionEnd = Date.now() + durationMs;
  isWandering = true;
  wanderTarget = null;
  setState('chase');
  showSpeech(pickSpeech('textWalkStart', DEFAULT_SPEECH.textWalkStart), 1500, { sound: 'walkStart', noInterrupt: true });
  window.petAPI.reportWanderStatus({
    active: true,
    remainingMs: durationMs,
    totalMs: durationMs,
  });
}

function endWanderSession() {
  if (!isWandering) return;
  isWandering = false;
  wanderSessionEnd = 0;
  wanderTarget = null;
  vx = 0;
  vy = 0;
  setState('idle');
  showSpeech(pickSpeech('textWalkEnd', DEFAULT_SPEECH.textWalkEnd), 2000, { sound: 'walkEnd', noInterrupt: true });
  window.petAPI.reportWanderStatus({ active: false, remainingMs: 0, totalMs: 0 });
}

function reportWanderProgress() {
  if (!isWandering || wanderSessionEnd <= 0) return;
  const remainingMs = Math.max(0, wanderSessionEnd - Date.now());
  window.petAPI.reportWanderStatus({
    active: remainingMs > 0,
    remainingMs,
    totalMs: wanderSessionTotalMs,
  });
  if (remainingMs <= 0) endWanderSession();
}

function applyConfig(c) {
  config = c;
  lastBoundsSyncAt = 0;
  animVariantIdx = {};
  lastAnimBase = '';
  petActive = !!c.petEnabled;
  const scale = c.scale || 1;
  document.documentElement.style.setProperty('--pet-scale', String(scale));
  spriteImg.style.width = `${120 * scale}px`;
  currentAnimKey = '';
  updateSprite();
  updateSpeechLayout();
  scheduleNextIdleActivity(true);
  petEl.classList.toggle('use-custom-avatar', usesCustomAvatar());
  petEl.classList.toggle('invert-facing', config.invertSpriteFacing !== false && usesCustomAvatar());
  applyFacing(vx);
  syncHitboxesAfterPaint();
}

function setState(s) {
  if (isGrabbing && s !== 'grab') return;
  if ((animOverride === 'thinking' || state === 'thinking') && s !== 'thinking' && s !== 'grab') return;
  if (s !== 'sleep' && s !== 'sit' && s !== 'shuffle' && idleActivity && s !== 'grab') {
    clearIdleActivity();
  }
  state = s;
  [...petEl.classList].forEach((cls) => {
    if (cls.startsWith('state-')) petEl.classList.remove(cls);
  });
  petEl.classList.add(`state-${s}`);
  if (s === 'idle') petEl.classList.add('state-idle');
  updateSprite(s === 'grab');
}

function renderSpeechHtml(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
}

function isPointOnHead(x, y) {
  if (!headHitbox) return false;
  const r = headHitbox.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function doPat() {
  if (petActive && !isGrabbing && tagSession) return;
  if (animOverride === 'thinking' || state === 'thinking') return;
  snoozeSleep();
  petHoverMs = 0;
  happiness = Math.min(100, happiness + 4);
  mem().pats += 1;
  saveMemory();
  refreshMood();
  jealousyRoll();
  if (idleActivity) clearIdleActivity();
  vy = -3;
  setState('pet');
  showSpeech('♡ ' + pickSpeech('textPet', DEFAULT_SPEECH.textPet), 1500, { sound: 'pet', noInterrupt: true });
}

function showSpeech(text, ms = 2000, opts = {}) {
  // Ambient lines (dance/pet/attack/walk) must never cut off a real
  // conversation: if she's mid-sentence, skip the new bubble+voice.
  if (opts.noInterrupt && speechEl.classList.contains('show')) return;
  // Slammed: she's sulking - nothing comes out unless forced (impact bark).
  if (!opts.force && Date.now() < shutUpUntil) return;
  stopTypewriter();
  const fullHtml = renderSpeechHtml(text);
  const wantType = config.textTypewriterEnabled !== false && !opts.quiet;
  speechEl.classList.add('show');
  // Longer lines linger longer (short ones keep their default snappiness).
  const extraChars = Math.max(0, String(text || '').length - 40);
  const effMs = Math.min(20000, ms + extraChars * 55);
  let voiceRequested = false;
  let typing = false;
  if (!opts.quiet && !prankMuted) {
    // keepVoice: impact one-liners (slam/bump/pounce) queue behind the
    // current line instead of murdering it mid-word every bounce.
    if (!opts.keepVoice) stopVoice();
    voiceRequested = requestVoice(text, !!opts.chatter, !!opts.react);
    if (!voiceRequested) {
      playSpeechSound(!!opts.chatter, opts.sound);
      if (!blipPlaying) {
        // No TTS and no custom sound file: typewriter with a blip per
        // step (or plain interval bleeps for tiny lines).
        typing = wantType && startTypewriter(fullHtml, text, true);
        if (!typing) playTextBleeps(text, effMs);
      } else if (wantType) {
        // Custom sound file covers audio: type the text silently.
        typing = startTypewriter(fullHtml, text, false);
      }
    } else if (wantType) {
      // TTS voice speaks while the text types out silently (VN style).
      typing = startTypewriter(fullHtml, text, false);
    }
  }
  if (!typing) speechEl.innerHTML = fullHtml;
  // Report the line so VTS-mode subtitles can echo it (sprite is hidden there).
  // hold = this line has a real voice: the caption stays up until the audio
  // finishes (or its measured length expires), not a text-length guess.
  if (!opts.quiet) {
    captionText = String(text || '');
    captionVoiceLine = !!voiceRequested;
    try {
      window.petAPI.reportSpeech?.({ text: captionText, ms: effMs, hold: !!voiceRequested });
    } catch (_) {}
  }
  requestAnimationFrame(() => {
    fitSpeechZoneToText();
  });
  updateSprite();
  // VTube Studio: fire the 'talk' hotkey (debounced) only when a real voice
  // will speak. Reaction one-liners (grab/bump/pounce) used to trigger the
  // full talk animation for a single word that outlived any sound.
  if (!opts.quiet && voiceRequested && Date.now() > nextVtsTalkAt) {
    nextVtsTalkAt = Date.now() + 4000;
    try {
      window.petAPI.vtsEvent?.('talk');
    } catch (_) {}
  }
  scheduleSpeechHide(effMs, voiceRequested);
}

function hideSpeechBubble() {
  stopTextBleeps();
  stopTypewriter();
  speechEl.classList.remove('show');
  // VTS mode: the caption mirrors the bubble. A caption that has a voice is
  // cleared by the audio's own end/duration, never by this bubble timer — that
  // timer is what made captions vanish while TTS was still synthesising.
  if (!captionVoiceLine) {
    try {
      window.petAPI.reportSpeechEnd?.();
    } catch (_) {}
  }
  speechZoneExpanded = null;
  updateSpeechLayout();
  reportInteractiveHitRegions();
  updateSprite();
}

// Keep the bubble on screen while her voice is still generating or playing
// (cloud TTS can take seconds to synthesize), then hide it after the line.
function scheduleSpeechHide(ms, waitForVoice) {
  clearTimeout(speechTimer);
  if (!waitForVoice) {
    speechTimer = setTimeout(hideSpeechBubble, ms);
    return;
  }
  const started = Date.now();
  const tick = () => {
    if (Date.now() - started >= ms && !isVoiceActive()) {
      speechTimer = setTimeout(hideSpeechBubble, 250);
      return;
    }
    speechTimer = setTimeout(tick, 250);
  };
  speechTimer = setTimeout(tick, ms);
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function playAttackAnim() {
  if (state === 'grab') return;
  setState('attack');
  showSpeech(pickSpeech('textAttack', DEFAULT_SPEECH.textAttack), 700, { sound: 'attack', noInterrupt: true, keepVoice: true });
  lastAttack = Date.now();
  clearTimeout(attackAnimTimer);
  const duration = config.attackAnimMs || 800;
  attackAnimTimer = setTimeout(() => {
    if (state === 'attack') setState(isDancing ? 'dance' : 'idle');
  }, duration);
}

async function tick() {
  if (!petActive) return;
  if (isGrabbing) return;
  if (Date.now() - lastHappyDecayAt > 60000) {
    lastHappyDecayAt = Date.now();
    happiness = Math.max(0, happiness - 4);
  }
  if (Date.now() - lastMoodCheckAt > 60000) {
    lastMoodCheckAt = Date.now();
    refreshMood();
    checkDayRollover();
  }
  expireTimedIdleActivity();
  if (lowImpactMode) {
    // Even throttled, keep hit regions truthful while gaming — otherwise the
    // click poll guards a stale spot and she becomes ungrabbable mid-game.
    if (Date.now() - lastBoundsSyncAt > 5000) {
      lastBoundsSyncAt = Date.now();
      const nb = (await window.petAPI.getPetBounds()) || petBounds;
      if (Math.abs((nb.x || 0) - (petBounds.x || 0)) > 2 || Math.abs((nb.y || 0) - (petBounds.y || 0)) > 2) {
        petBounds = nb;
        reportInteractiveHitRegions(true);
      } else {
        petBounds = nb;
      }
    }
    return;
  }

  if (Date.now() - lastWorkAreaSyncAt > 5000) {
    lastWorkAreaSyncAt = Date.now();
    refreshWorkArea(true).catch(() => {});
  }
  if (Date.now() - lastBoundsSyncAt > 2000) {
    lastBoundsSyncAt = Date.now();
    const nb = (await window.petAPI.getPetBounds()) || petBounds;
    // She walks by moving the whole window — regions go stale as she moves,
    // and the main-side click poll then guards the wrong spot ("can't grab
    // her while she's walking"). Re-report whenever the window shifted.
    if (Math.abs((nb.x || 0) - (petBounds.x || 0)) > 2 || Math.abs((nb.y || 0) - (petBounds.y || 0)) > 2) {
      petBounds = nb;
      reportInteractiveHitRegions();
    } else {
      petBounds = nb;
    }
  }
  // Cursor IPC is the pet loop's hottest call — cache it to 100ms.
  if (Date.now() - cursorFetchedAt > 100) {
    cursorFetchedAt = Date.now();
    cachedCursor = (await window.petAPI.getCursor()) || cachedCursor;
  }
  const cursor = cachedCursor || { x: 0, y: 0 };
  if (animOverride === 'thinking' || state === 'thinking') {
    vx = 0;
    vy = 0;
    return;
  }
  const onHead = cursorOnHead(cursor);

  if (onHead && state !== 'pet' && state !== 'attack' && state !== 'grab') {
    if (idleActivity) clearIdleActivity();
    petHoverMs += 50;
    if (petHoverMs >= 300) {
      setState('pet');
      showSpeech(pickSpeech('textPet', DEFAULT_SPEECH.textPet), 1500, { sound: 'pet', noInterrupt: true });
    }
  } else if (!onHead) {
    petHoverMs = 0;
    if (state === 'pet') setState(isDancing ? 'dance' : 'idle');
  }

  if (state === 'pet' || state === 'attack' || state === 'grab' || state === 'dance') {
    updateSprite();
    if (state === 'idle' || state === 'dance') tryRandomAttack();
    return;
  }

  if (idleActivity === 'shuffle') {
    const reachedTarget = !shuffleTarget || Math.abs(petBounds.x - shuffleTarget.x) < 12;
    if (Date.now() >= idleActivityEnd || reachedTarget) {
      vx = 0;
      endIdleActivity();
    } else {
      const dx = shuffleTarget.x - petBounds.x;
      if (Math.abs(dx) < 8) {
        vx = 0;
        endIdleActivity();
      } else {
        const speed = (config.moveSpeed || 2.5) * 0.75;
        vx = Math.sign(dx) * Math.min(speed, Math.abs(dx));
        applyFacing(vx);
        setState('shuffle');
        updateSprite();
      }
    }
    return;
  }

  if (idleActivity === 'sleep' || idleActivity === 'sit') {
    if (Date.now() >= idleActivityEnd) endIdleActivity();
    return;
  }

  await updateTagBehavior();
  if (tagSession) return;

  if (await updateGiftDelivery()) return;

  // Goodnight schedule takes precedence over everything below.
  if (updateScheduleSleep()) return;

  // Play mode: chase the cursor, pounce on catch.
  const playOn = sessionPlayMode === true || (sessionPlayMode !== false && config.playMode === true);
  if (playOn && !scheduleSleeping && !isDancing && !tagSession && !giftDelivery) {
    if (await updatePlayChase(cursor)) return;
  }

  tryIdleActivity();
  if (idleActivity === 'sleep' || idleActivity === 'sit' || idleActivity === 'shuffle') {
    return;
  }

  if (Math.random() < 0.35) checkPetInteractions();
  else if (Math.random() < 0.2) tryNearbySocialChatter();
  if (Math.random() < 0.1) tryGiftInteraction();

  if (isWandering && Date.now() < wanderSessionEnd) {
    if (Date.now() < socialBusyUntil) {
      // Stay for the moment — gift, greeting, or reaction in progress.
      vx *= 0.8;
      if (Math.abs(vx) < 0.15) vx = 0;
    } else {
      await wander(cursor);
    }
    setState('chase');
    tryPassingGreeting();
    return;
  }

  if (isWandering && Date.now() >= wanderSessionEnd) {
    endWanderSession();
    return;
  }

  vx *= 0.85;
  if (Math.abs(vx) < 0.2) {
    vx = 0;
    if (!isDancing && state !== 'sleep' && state !== 'sit') setState('idle');
    if (!scheduleSleeping) {
      tryIdleChatter();
      tryProactiveChatter();
      tryRandomAttack();
      tryPrank();
    }
  } else {
    updateSprite();
  }
}

async function tryPassingGreeting() {
  if (Math.abs(vx) < 0.5) return;
  if (Date.now() < nextPassingGreetAt) return;
  if (speechEl.classList.contains('show')) return;
  await refreshOtherPets();
  if (!cachedOthers.length) return;
  const persona = getPersonality();
  for (const other of cachedOthers) {
    const dist = distanceToOther(other);
    const sep = getCenterSeparation(other);
    if (dist > sep * 1.2 && dist < sep * 3 && Math.random() < 0.1 + 0.3 * persona.sociability) {
      nextPassingGreetAt = Date.now() + 20000 + Math.random() * 20000;
      showSpeech(pickSocialLine(other.name), 1500, { social: true, sound: 'social' });
      return;
    }
  }
}

let nextPounceAt = 0;

// Play mode chase: run at the cursor, pounce (with a little hop) on catch.
// Returns true when it owned this tick.
async function updatePlayChase(cursor) {
  if (!petActive || isGrabbing || isWandering) return false;
  if (!cursor || typeof cursor.x !== 'number') return false;
  if (idleActivity || state === 'sleep' || state === 'sit' || state === 'attack' || state === 'grab' || state === 'pet') return false;
  const targetX = clampX(cursor.x - WIN_W() / 2);
  const dx = targetX - petBounds.x;
  if (Math.abs(dx) <= 46) {
    vx *= 0.8;
    if (Date.now() >= nextPounceAt) {
      nextPounceAt = Date.now() + 2500;
      try {
        vy = -4;
      } catch (_) {}
      playAttackAnim();
    }
    return true;
  }
  const speed = (config.moveSpeed || 2.5) * 1.75;
  const desired = Math.sign(dx) * Math.min(speed, Math.max(0.6, Math.abs(dx) * 0.25));
  vx += (desired - vx) * 0.35;
  applyFacing(vx);
  if (state !== 'shuffle') setState('chase');
  updateSprite();
  return true;
}

async function wander(cursor) {
  const margin = 100;
  const floorY = getFloorY();
  const minX = workArea ? workArea.x + margin : margin;
  const maxX = workArea
    ? workArea.x + workArea.width - WIN_W() - margin
    : window.screen.availWidth - WIN_W() - margin;
  const now = Date.now();
  const persona = getPersonality();

  if (now < walkPauseUntil) {
    vx *= 0.8;
    if (Math.abs(vx) < 0.15) vx = 0;
    return;
  }

  if (!wanderTarget || Math.abs(petBounds.x - wanderTarget.x) < 24) {
    // Sometimes just stop and look around before picking a new spot.
    if (wanderTarget && Math.random() < 0.3 * persona.energy) {
      wanderTarget = null;
      vx = 0;
      walkPauseUntil = now + 800 + Math.random() * 1600;
      return;
    }
    const cands = [];
    // Curiosity detour: drift toward the cursor's neighborhood sometimes.
    if (cursor && typeof cursor.x === 'number' && Math.random() < persona.curiosity * 0.5) {
      const peek = clampX(cursor.x + (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * 160));
      if (Math.abs(peek - petBounds.x) > 60) cands.push(peek);
    }
    cands.push(minX + Math.random() * Math.max(0, maxX - minX));
    cands.push(minX + Math.random() * Math.max(0, maxX - minX));
    let picked = -1;
    for (const cand of cands) {
      if (!(await isPositionBlocked(cand))) {
        picked = cand;
        break;
      }
    }
    if (picked < 0) {
      wanderTarget = null;
      vx = 0;
      return;
    }
    wanderTarget = { x: picked, y: floorY };
  }

  const dx = wanderTarget.x - petBounds.x;
  const topSpeed = (config.moveSpeed || 2.5) * 1.5 * persona.energy;
  // Ease: full stride far away, gentle steps on arrival, slight speed wobble.
  const wobble = 0.9 + 0.2 * Math.sin(now / 900);
  const desired = Math.sign(dx) * Math.min(topSpeed * wobble, Math.max(0.5, Math.abs(dx) * 0.22));
  vx += (desired - vx) * 0.35;
  vy = 0;
  applyFacing(vx);
}

let lastGameLoopAt = 0;
let lastBoundsSyncAt = 0;
let lastWorkAreaSyncAt = 0;
let lastForcedHitReportAt = 0;
let lastStationaryTickAt = 0;
let gameLoopBusy = false;

async function gameLoopTick() {
  if (!petActive || gameLoopBusy) return;
  if (isGrabbing) {
    if (currentAnimKey !== 'grab' && config.avatarUrls?.grab) updateSprite(true);
    reportInteractiveHitRegions(true);
    return;
  }

  const nowMs = Date.now();
  const floorCheckY = config.freePlacement ? petBounds.y : getFloorY();
  const isMovingOrFalling =
    Math.abs(vx) > 0.05 ||
    Math.abs(vy) > 0.05 ||
    slingFlying ||
    Math.abs(petBounds.y - floorCheckY) > 0.5 ||
    nowMs < bumpEscapeUntil ||
    !!tagSession;

  // When stationary on the floor, no need to run full bounds/IPC checks at
  // 60-144Hz; throttle to ~5Hz and wake on the very next frame once vx/vy changes.
  if (!isMovingOrFalling && nowMs - lastStationaryTickAt < 200) {
    return;
  }
  lastStationaryTickAt = nowMs;
  gameLoopBusy = true;
  try {
    const dtScale = lastGameLoopAt
      ? Math.max(0.5, Math.min(3, (nowMs - lastGameLoopAt) / 16.7))
      : 1;
    lastGameLoopAt = nowMs;

    const movingSoon =
      !lowImpactMode &&
      (Math.abs(vx) > 0.08 || vy > 0.08 || nowMs < bumpEscapeUntil || tagSession);

    if (lowImpactMode) {
      expireTimedIdleActivity();
      reportInteractiveHitRegions();
      return;
    }

    await refreshWorkArea();
    if (nowMs - lastBoundsSyncAt > 2000) {
      lastBoundsSyncAt = nowMs;
      petBounds = (await window.petAPI.getPetBounds()) || petBounds;
    }
    if (movingSoon && nowMs - lastForcedHitReportAt > 500) {
      lastForcedHitReportAt = nowMs;
      reportInteractiveHitRegions(true);
    } else if (!movingSoon) {
      reportInteractiveHitRegions(false);
    }

    const floorY = config.freePlacement ? petBounds.y : getFloorY();

    let nx = petBounds.x;
    let ny = petBounds.y;
    let moved = false;

    if (Date.now() < bumpEscapeUntil && bumpEscapeDir) {
      const speed = (config.moveSpeed || 2.5) * 0.85;
      vx = bumpEscapeDir * speed;
    } else if (bumpEscapeUntil) {
      bumpEscapeUntil = 0;
      bumpEscapeDir = 0;
    }

    if (slingFlying) {
      const f = runSlingFlight(dtScale);
      nx = f.nx;
      ny = f.ny;
      moved = f.moved;
      applyFacing(vx);
    } else {
      if (Math.abs(vx) > 0.05) {
        nx = clampX(petBounds.x + vx * dtScale);
        moved = true;
        applyFacing(vx);
        if (state !== 'pet' && state !== 'attack' && state !== 'grab' && state !== 'sleep' && state !== 'sit') {
          updateSprite();
        }
      }

      if (ny < floorY - 0.5) {
        vy += GRAVITY * dtScale;
        ny += vy * dtScale;
        moved = true;
        if (ny >= floorY) {
          ny = floorY;
          vy = 0;
        }
      } else {
        ny = floorY;
        vy = 0;
      }
    }

    if (moved || nx !== petBounds.x || ny !== petBounds.y) {
      const intendedX = nx;
      const result = await window.petAPI.movePet({ x: nx, y: ny });
      if (result) {
        if (Math.abs(result.x - intendedX) > 2) {
          nx = result.x;
          if (!tagSession) await handleBumpReaction();
        }
        petBounds.x = nx;
        petBounds.y = ny;
      } else {
        petBounds.x = nx;
        petBounds.y = ny;
      }
    }
  } finally {
    gameLoopBusy = false;
  }
}

init();