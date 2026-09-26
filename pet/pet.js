const petEl = document.getElementById('pet');
const petRoot = document.getElementById('pet-root');
const petInteract = document.getElementById('pet-interact');
const headHitbox = document.getElementById('head-hitbox');
const speechHitbox = document.getElementById('speech-hitbox');
const bodyHitbox = document.getElementById('body-hitbox');
const speechEl = document.getElementById('speech');
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
let voiceDeadUntil = 0;
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
  blipPlaying = false;
  if (voiceResolve) {
    const r = voiceResolve;
    voiceResolve = null;
    r();
  }
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
        const done = () => {
          voiceResolve = null;
          voiceAudioEl = null;
          resolve();
        };
        try {
          const a = new Audio(res.url);
          voiceAudioEl = a;
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
      voiceDeadUntil = Date.now() + 60000;
    }
  } catch (_) {
    voiceDeadUntil = Date.now() + 60000;
  }
  voicePlaying = false;
  pumpVoiceQueue();
}

async function checkVoiceEngine() {
  if (!config.voiceVoxEnabled) return;
  try {
    const res = await window.petAPI.voxTest();
    if (!res?.ok) voiceDeadUntil = Date.now() + 60000;
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
let wanderSessionEnd = 0;
let wanderSessionTotalMs = 0;
let isWandering = false;
let petActive = false;
let currentAnimKey = 'idle';
let attackAnimTimer = null;
let isGrabbing = false;
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

async function refreshWorkArea() {
  const now = Date.now();
  if (workArea && now - workAreaAt < 2000) return;
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
  const floorY = getFloorY();
  const nx = clampX(petBounds.x);
  if (Math.abs(petBounds.y - floorY) > 0.5 || nx !== petBounds.x) {
    await window.petAPI.movePet({ x: nx, y: floorY });
    petBounds.x = nx;
    petBounds.y = floorY;
  }
  vy = 0;
}
const DOUBLE_CLICK_MS = 450;
const LONG_PRESS_RIGHT_MS = 450;

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
    showSpeech(pickBumpLine(hit.name), 1500, { social: true, sound: 'bump' });
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
  let thinkingTimer = null;
  // Shared chat pipeline (chat window AND companion remote): history,
  // mini-games, AI with fallback note, offline brain, speech + voice.
  async function processChatMessage(text) {
    chatHistory.push({ role: 'user', content: text });
    chatHistory = chatHistory.slice(-8);
    mem().chats += 1;
    saveMemory();
    // Mini-games are instant and local — never send them to the AI.
    const gameReply = tryMiniGame(text);
    if (gameReply) {
      chatHistory.push({ role: 'assistant', content: gameReply });
      chatHistory = chatHistory.slice(-8);
      showSpeech(gameReply, 4500);
      return { reply: gameReply, note: '' };
    }
    showSpeech('Thinking… 🤔', 8000, { quiet: true });
    if (thinkingTimer) clearInterval(thinkingTimer);
    thinkingTimer = setInterval(() => {
      if (petActive) showSpeech('Thinking… 🤔', 8000, { quiet: true });
    }, 8000);
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
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
    if (!reply) reply = brainReply(text);
    chatHistory.push({ role: 'assistant', content: reply });
    chatHistory = chatHistory.slice(-8);
    showSpeech(reply, 4500);
    return { reply, note };
  }

  window.petAPI.onChatMessage(async (data) => {
    if (!petActive) return;
    const text = String(data?.text || '').slice(0, 200).trim();
    if (!text) return;
    const { reply, note } = await processChatMessage(text);
    window.petAPI.chatReply({ text: reply, note });
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
    audioContext = new AudioContext();
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
  if (audioContext) {
    audioContext.close().catch(() => {});
    audioContext = null;
  }
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
        if (Math.random() < 0.08) showSpeech(pickSpeech('textDance', DEFAULT_SPEECH.textDance), 800, { sound: 'dance' });
      }
      isDancing = true;
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
    if (e.button !== getGrabMouseButton()) return;
    e.preventDefault();
    rightMouseDownAt = Date.now();
    suppressContextMenu = false;
    longPressTimer = setTimeout(() => startGrab(), LONG_PRESS_RIGHT_MS);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== getGrabMouseButton()) {
      if (e.button === 2 && getGrabMouseButton() === 0 && !isGrabbing) {
        window.petAPI.showPetMenu();
      }
      return;
    }
    clearTimeout(longPressTimer);
    if (isGrabbing) endGrab();
    else if (
      getGrabMouseButton() === 2 &&
      Date.now() - rightMouseDownAt < LONG_PRESS_RIGHT_MS &&
      !suppressContextMenu
    ) {
      window.petAPI.showPetMenu();
    }
  });

  petEl.addEventListener('contextmenu', (e) => e.preventDefault());

  rpsBar?.querySelectorAll('.rps-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onRpsPick(btn.dataset.throw);
    });
  });
  setupPointerPassthrough();
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

  document.addEventListener('mousemove', (e) => notify(pointOverPet(e.clientX, e.clientY)));
  document.addEventListener('mouseleave', () => notify(false));
}

async function startGrab() {
  if (lowImpactMode) resumeGameLoopRaf();
  clearAnimOverride();
  suppressContextMenu = true;
  isGrabbing = true;
  cancelRps();
  petRoot.classList.add('is-grabbing');
  vx = 0;
  vy = 0;
  clearIdleActivity();
  setState('grab');
  updateSprite(true);
  showSpeech(pickSpeech('textGrab', DEFAULT_SPEECH.textGrab), 900, { sound: 'grab' });

  const bounds = (await window.petAPI.getPetBounds()) || petBounds;
  const cursor = await window.petAPI.getCursor();
  window.petAPI.startPetDrag({
    x: cursor.x - bounds.x,
    y: cursor.y - bounds.y,
  });
}

async function endGrab() {
  if (!isGrabbing) return;
  isGrabbing = false;
  petRoot.classList.remove('is-grabbing');
  window.petAPI.endPetDrag();
  if (lowImpactMode) startIdleGameLoop();
  await refreshWorkArea();
  petBounds = (await window.petAPI.getPetBounds()) || petBounds;
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
  if (/how are you|howre you|how do you feel|how r u/.test(t)) {
    if (happiness < 25) return 'Hungry… and a little ignored. Snacks would fix both~';
    if (happiness > 75) return R(['Amazing! {name} is living her best desktop life!', 'So good! Pat me to make it perfect~']);
    return 'Pretty good! Bored, but good. Talk to me more~';
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
  if (/play|bored|tag|hide and seek|game with me/.test(t)) return 'Tag! …wait, I need at least one other pet for that. Ask the human to add me a friend~';
  if (/dance|music|song|sing/.test(t)) return 'Put on something with bass and watch me go~ (Music tab, threshold thingy!)';
  if (/sleep|tired|nap|sleepy/.test(t)) return 'Mmm… five more minutes… * flops over *';
  if (/what time|the time|clock/.test(t)) {
    return `It’s ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}! Time flies when you’re cute.`;
  }
  if (/what day|today.*day|date/.test(t)) return `Today is ${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}!`;
  if (/help|what can you do|commands|how do i/.test(t)) {
    return 'I chat, do math, flip coins, roll dice, tell jokes, answer yes/no questions… and sit on your screen looking cute. Try “flip a coin”!';
  }
  if (/weather|outside|rain|sunny|snow/.test(t)) return 'I live inside a glowing rectangle — ALL weather is screen weather to me. It’s cozy in here~';
  if (/smart|cool|awesome|amazing|best|greatest/.test(t) && /you|u /.test(t)) return 'I KNOW, right?! Finally, recognition~';
  if (/stupid|dumb|idiot|hate you|shut up|ugly/.test(t)) return R(['Rude! {name} is filing a complaint with the human.', 'Ouch. My pixels hurt. Apologize with snacks.']);
  if (/fuck|shit|bitch|asshole|dick\b/.test(t)) return 'Hey! Clean words around me — I’m a lady. A pixel lady.';
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

function tryIdleActivity() {
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
  if (!config.idleChatter) return;
  if (!petActive || isGrabbing || isWandering || isDancing || idleActivity || tagSession) return;
  if (state !== 'idle') return;
  if (Date.now() < nextChatterAt || Date.now() < socialBusyUntil) return;
  // Never talk over an active voice (e.g. a chat reply being spoken) —
  // just wait for the next chatter window instead of cutting her off.
  if (isVoiceActive()) {
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

const ANIM_OVERRIDE_CLASSES = ['show-victory', 'show-defeat', 'show-greet', 'show-giftGive', 'show-giftReceive'];

function setAnimOverride(slot) {
  animOverride = slot;
  petEl.classList.remove(...ANIM_OVERRIDE_CLASSES);
  petEl.classList.add(`show-${slot}`);
  currentAnimKey = '';
  updateSprite(true);
}

function clearAnimOverride() {
  if (!animOverride) return;
  animOverride = null;
  petEl.classList.remove(...ANIM_OVERRIDE_CLASSES);
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
  reportInteractiveHitRegions();
}

function fitSpeechZoneToText() {
  const { maxW, boxW, boxH, maxH } = getSpeechBaseSize();

  speechEl.style.width = `${maxW}px`;
  speechEl.style.maxWidth = `${maxW}px`;
  speechEl.style.height = 'auto';
  speechEl.style.maxHeight = 'none';

  let w = Math.max(boxW, Math.min(maxW, speechEl.scrollWidth));
  let h = Math.max(boxH, Math.min(maxH, speechEl.scrollHeight));

  speechEl.style.width = `${w}px`;
  w = Math.max(boxW, Math.min(maxW, speechEl.scrollWidth));
  h = Math.max(boxH, Math.min(maxH, speechEl.scrollHeight));

  speechZoneExpanded = { w, h };
  applySpeechZoneDimensions(w, h);
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

function resumeGameLoopRaf() {
  if (gameLoopTimer) {
    clearInterval(gameLoopTimer);
    gameLoopTimer = null;
  }
  if (gameLoopRafId) return;
  function frame() {
    gameLoopRafId = requestAnimationFrame(frame);
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

function reportInteractiveHitRegions(force = false) {
  if (!petActive || !window.petAPI.reportHitRegions) return;
  if (lowImpactMode && !force) return;
  const now = Date.now();
  if (!force && now - lastHitReportAt < 280) return;
  lastHitReportAt = now;
  const speech =
    speechEl.classList.contains('show') && speechEl.textContent.trim()
      ? rectToHitRegion(speechEl.getBoundingClientRect())
      : null;
  window.petAPI.reportHitRegions({
    body: rectToHitRegion(bodyHitbox.getBoundingClientRect()),
    head: rectToHitRegion(headHitbox.getBoundingClientRect()),
    speech,
    rps: rpsBar && !rpsBar.hidden ? rectToHitRegion(rpsBar.getBoundingClientRect()) : null,
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
  showSpeech(pickSpeech('textWalkStart', DEFAULT_SPEECH.textWalkStart), 1500, { sound: 'walkStart' });
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
  showSpeech(pickSpeech('textWalkEnd', DEFAULT_SPEECH.textWalkEnd), 2000, { sound: 'walkEnd' });
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
  if (!petActive || isGrabbing || tagSession) return;
  petHoverMs = 0;
  happiness = Math.min(100, happiness + 4);
  mem().pats += 1;
  saveMemory();
  refreshMood();
  jealousyRoll();
  if (idleActivity) clearIdleActivity();
  vy = -3;
  setState('pet');
  showSpeech('♡ ' + pickSpeech('textPet', DEFAULT_SPEECH.textPet), 1500, { sound: 'pet' });
}

function showSpeech(text, ms = 2000, opts = {}) {
  speechEl.innerHTML = renderSpeechHtml(text);
  speechEl.classList.add('show');
  if (!opts.quiet && !prankMuted) {
    stopVoice();
    if (!requestVoice(text, !!opts.chatter, !!opts.react)) playSpeechSound(!!opts.chatter, opts.sound);
  }
  requestAnimationFrame(() => {
    fitSpeechZoneToText();
  });
  updateSprite();
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => {
    speechEl.classList.remove('show');
    speechZoneExpanded = null;
    updateSpeechLayout();
    reportInteractiveHitRegions();
    updateSprite();
  }, ms);
}

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function playAttackAnim() {
  if (state === 'grab') return;
  setState('attack');
  showSpeech(pickSpeech('textAttack', DEFAULT_SPEECH.textAttack), 700, { sound: 'attack' });
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
  if (lowImpactMode) return;

  if (Date.now() - lastBoundsSyncAt > 2000) {
    lastBoundsSyncAt = Date.now();
    petBounds = (await window.petAPI.getPetBounds()) || petBounds;
  }
  const cursor = await window.petAPI.getCursor();
  const onHead = cursorOnHead(cursor);

  if (onHead && state !== 'pet' && state !== 'attack' && state !== 'grab') {
    if (idleActivity) clearIdleActivity();
    petHoverMs += 50;
    if (petHoverMs >= 300) {
      setState('pet');
      showSpeech(pickSpeech('textPet', DEFAULT_SPEECH.textPet), 1500, { sound: 'pet' });
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
    tryIdleChatter();
    tryProactiveChatter();
    tryRandomAttack();
    tryPrank();
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
let lastForcedHitReportAt = 0;
async function gameLoopTick() {
  if (!petActive) return;
  if (isGrabbing) {
    if (currentAnimKey !== 'grab' && config.avatarUrls?.grab) updateSprite(true);
    reportInteractiveHitRegions(true);
    return;
  }

  const nowMs = Date.now();
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

  const floorY = getFloorY();
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
}

init();
