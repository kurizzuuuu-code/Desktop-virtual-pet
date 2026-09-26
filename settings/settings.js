const DEFAULT_AVATAR_FILES = {
  gifIdle: 'default-idle.gif',
  gifPet: 'default-pet.gif',
  gifGrab: 'default-grab.gif',
  gifDance: 'default-dance.gif',
  gifSleep: 'default-sleep.gif',
  gifSit: 'default-sit.gif',
};

const PET_DEFAULTS = {
  enabled: true,
  name: 'KURIZU',
  mood: 'happy',
  memory: null,
  scale: 1.8,
  moveSpeed: 2.5,
  attackEnabled: false,
  aggression: 0.4,
  randomAttackMinSec: 6,
  randomAttackMaxSec: 18,
  wanderDuration: 30,
  wanderDurationUnit: 'sec',
  useCustomAvatar: true,
  gifIdle: { mode: 'shuffle', files: [{ file: DEFAULT_AVATAR_FILES.gifIdle, next: 'any' }] },
  gifMove: { mode: 'shuffle', files: [] },
  gifAttack: { mode: 'shuffle', files: [] },
  gifPet: { mode: 'shuffle', files: [{ file: DEFAULT_AVATAR_FILES.gifPet, next: 'any' }] },
  gifGrab: { mode: 'shuffle', files: [{ file: DEFAULT_AVATAR_FILES.gifGrab, next: 'any' }] },
  gifDance: { mode: 'shuffle', files: [{ file: DEFAULT_AVATAR_FILES.gifDance, next: 'any' }] },
  gifSleep: { mode: 'shuffle', files: [{ file: DEFAULT_AVATAR_FILES.gifSleep, next: 'any' }] },
  gifSit: { mode: 'shuffle', files: [{ file: DEFAULT_AVATAR_FILES.gifSit, next: 'any' }] },
  gifVictory: { mode: 'shuffle', files: [] },
  gifDefeat: { mode: 'shuffle', files: [] },
  gifTalk: { mode: 'shuffle', files: [] },
  gifGreet: { mode: 'shuffle', files: [] },
  gifGiftGive: { mode: 'shuffle', files: [] },
  gifGiftReceive: { mode: 'shuffle', files: [] },
  characterPack: '',
  attackAnimMs: 800,
  textIdle: '',
  textGrab: '',
  textGrabRelease: '',
  textAttack: '',
  textPet: '',
  textWalkStart: '',
  textWalkEnd: '',
  textSleep: '',
  textSit: '',
  textDance: '',
  textChaosClose: '',
  textSocial: '',
  textBump: '',
  textTag: '',
  textTagChase: '',
  textTagGotcha: '',
  textWatch: '',
  textGame: '',
  textGameFail: '',
  textVictory: '',
  textGift: '',
  textGiftThanks: '',
  gameVictoryPatterns: '',
  voiceVoxEnabled: false,
  voiceVoxBackend: 'external',
  voiceVoxUrl: 'http://127.0.0.1:50021',
  voiceVoxSpeaker: 1,
  voiceVoxSpeed: 1.0,
  voiceVoxVolume: 100,
  voiceVoxIdleOnly: false,
  voiceVoxReactions: true,
  speechSoundEnabled: false,
  speechSoundIdleOnly: false,
  speechSoundVolume: 70,
  contextReactionsEnabled: true,
  contextReactionCooldownSec: 45,
  idleSleepEnabled: true,
  idleSitEnabled: true,
  idleSmallWalkEnabled: true,
  idleVarietyChance: 0.35,
  smallWalkMinSec: 3,
  smallWalkMaxSec: 12,
  invertSpriteFacing: true,
  headHitTop: 96,
  headHitLeft: 22,
  headHitWidth: 86,
  headHitHeight: 56,
  showHeadHitbox: false,
  idleChatter: true,
  proactiveChatter: true,
  prankEnabled: true,
  prankFakeShutdown: true,
  prankChanceFakeShutdown: 0.02,
  prankRealShutdown: false,
  prankChanceRealShutdown: 0,
  prankChanceGlitch: 0.02,
  prankChanceBlackout: 0.02,
  prankChanceBsod: 0.02,
  prankChanceJumpscare: 0.02,
  prankCooldownMin: 5,
  prankBsod: true,
  prankImage: '',
  textProactive: '',
  grabButton: 'right',
  ownerName: '',
  aiPersonality: '',
  chaosCloseApps: false,
  chaosCloseChance: 0.12,
  musicDanceEnabled: false,
  musicThreshold: 35,
  audioInputDeviceId: '',
  speechTop: 300,
  speechLeft: 26,
  speechMaxWidth: 170,
  speechZoneHeight: 68,
  speechHitWidth: 120,
  speechHitHeight: 44,
  speechMaxHeight: 200,

  speechBgColor: '#614259',
  speechTextColor: '#f7f7f8',
  speechBorderColor: '#ff8fab',
  speechFontSize: 13,
  speechAlign: 'center',
  speechAutoAvoid: true,
  speechAnchorSide: 'auto',
  showSpeechZone: false,
  bodyHitTop: 0,
  bodyHitLeft: 20,
  bodyHitWidth: 92,
  bodyHitHeight: 120,
  showBodyHitbox: false,
};

const APP_DEFAULTS = {
  petEnabled: false,
  launchOnStartup: false,
  alwaysOnTop: true,
  showSettingsOnStart: true,
  activePetId: 'pet-1',
  multiPetInteractions: true,
  petCollisionGap: 20,
  gameLowImpactEnabled: true,
  hidePetsWhileGaming: false,
  gameProcessWatchEnabled: true,
  gameProcessList: '',
  gameOcrWatchEnabled: false,
  gameOcrAuto: true,
  gameOcrDebugEdges: false,
  gameOcrRegion: 'full',
  gameOcrPatterns: '',
  gameOcrIntervalSec: 2,
  gameOcrQuality: 'balanced',
  voiceDevice: 'cpu',
  aiEnabled: false,
  aiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  aiKey: '',
  aiModel: 'gemini-3.6-flash',
  aiProvider: 'custom',
  aiOllamaModel: 'llama3.1:8b',
  aiFallback: true,
  relationships: {},
  remoteEnabled: false,
  remotePort: 3535,
  remoteToken: '',
  prankImage: '',
  prankWallpaper: true,
  prankWallpaperImage: '',
  prankWallpaperSec: 30,
  prankChanceWallpaper: 0.02,
  pets: [{ id: 'pet-1', ...PET_DEFAULTS }],
};

const DEFAULTS = { ...APP_DEFAULTS, ...PET_DEFAULTS };

const SLOT_PREVIEW = {
  idle: 'previewIdle',
  move: 'previewMove',
  attack: 'previewAttack',
  pet: 'previewPet',
  grab: 'previewGrab',
  dance: 'previewDance',
  sleep: 'previewSleep',
  sit: 'previewSit',
  victory: 'previewVictory',
  defeat: 'previewDefeat',
  talk: 'previewTalk',
  greet: 'previewGreet',
  giftGive: 'previewGiftGive',
  giftReceive: 'previewGiftReceive',
};

const SLOT_NAME = {
  idle: 'nameIdle',
  move: 'nameMove',
  attack: 'nameAttack',
  pet: 'namePet',
  grab: 'nameGrab',
  dance: 'nameDance',
  sleep: 'nameSleep',
  sit: 'nameSit',
  victory: 'nameVictory',
  defeat: 'nameDefeat',
  talk: 'nameTalk',
  greet: 'nameGreet',
  giftGive: 'nameGiftGive',
  giftReceive: 'nameGiftReceive',
};

const SLOT_CONFIG_KEY = {
  idle: 'gifIdle',
  move: 'gifMove',
  attack: 'gifAttack',
  pet: 'gifPet',
  grab: 'gifGrab',
  dance: 'gifDance',
  sleep: 'gifSleep',
  sit: 'gifSit',
  victory: 'gifVictory',
  defeat: 'gifDefeat',
  talk: 'gifTalk',
  greet: 'gifGreet',
  giftGive: 'gifGiftGive',
  giftReceive: 'gifGiftReceive',
};

function asAvatarSlot(v) {
  if (v && typeof v === 'object' && Array.isArray(v.files)) {
    const files = v.files
      .filter((f) => f && f.file)
      .slice(0, 8)
      .map((f) => ({ file: f.file, next: f.next || 'any' }));
    return { mode: ['shuffle', 'order', 'custom'].includes(v.mode) ? v.mode : 'shuffle', files };
  }
  if (typeof v === 'string' && v) return { mode: 'shuffle', files: [{ file: v, next: 'any' }] };
  return { mode: 'shuffle', files: [] };
}

let cachedConfig = { ...APP_DEFAULTS };

function $(id) { return document.getElementById(id); }

window.addEventListener('error', (e) => {
  try {
    const el = document.getElementById('status');
    if (el) {
      el.textContent = 'Settings error: ' + (e.message || (e.error && e.error.message) || 'unknown');
      el.style.color = '#d63031';
    }
  } catch (_) {}
  console.error('[settings]', e.message || e.error);
});

function getActivePet(config = cachedConfig) {
  if (!config.pets?.length) return { id: 'pet-1', ...PET_DEFAULTS };
  return config.pets.find((p) => p.id === config.activePetId) || config.pets[0];
}

function readPetFields() {
  return {
    enabled: $('petIndividualEnabled').checked,
    name: $('name').value.trim() || 'Mochi',
    scale: parseFloat($('scale').value),
    moveSpeed: parseFloat($('moveSpeed').value),
    attackEnabled: $('attackEnabled').checked,
    aggression: parseFloat($('aggression').value),
    wanderDuration: parseInt($('wanderDuration').value, 10) || 30,
    wanderDurationUnit: $('wanderDurationUnit').value,
    useCustomAvatar: $('useCustomAvatar').checked,
    characterPack: $('characterPack')?.value || 'custom',
    invertSpriteFacing: $('invertSpriteFacing').checked,
    attackAnimMs: parseInt($('attackAnimMs').value, 10),
    headHitTop: parseInt($('headHitTop').value, 10),
    headHitLeft: parseInt($('headHitLeft').value, 10),
    headHitWidth: parseInt($('headHitWidth').value, 10),
    headHitHeight: parseInt($('headHitHeight').value, 10),
    showHeadHitbox: $('showHeadHitbox').checked,
    textIdle: $('textIdle').value,
    textGrab: $('textGrab').value,
    textGrabRelease: $('textGrabRelease').value,
    textAttack: $('textAttack').value,
    textPet: $('textPet').value,
    textWalkStart: $('textWalkStart').value,
    textWalkEnd: $('textWalkEnd').value,
    textSleep: $('textSleep').value,
    textSit: $('textSit').value,
    textDance: $('textDance').value,
    textChaosClose: $('textChaosClose').value,
    textSocial: $('textSocial').value,
    textBump: $('textBump').value,
    textTagChase: $('textTagChase').value,
    textTagGotcha: $('textTagGotcha').value,
    textWatch: $('textWatch').value,
    textGame: $('textGame').value,
    textGameFail: $('textGameFail').value,
    textVictory: $('textVictory').value,
    textGift: $('textGift').value,
    textGiftThanks: $('textGiftThanks').value,
    voiceVoxEnabled: $('voiceVoxEnabled').checked,
    voiceVoxBackend: $('voiceVoxBackend').value === 'builtin' ? 'builtin' : 'external',
    voiceVoxUrl: $('voiceVoxUrl').value.trim() || 'http://127.0.0.1:50021',
    voiceVoxSpeaker: parseInt($('voiceVoxSpeaker').value, 10) || 0,
    voiceVoxSpeed: parseFloat($('voiceVoxSpeed').value) || 1.0,
    voiceVoxVolume: Math.max(0, Math.min(100, parseInt($('voiceVoxVolume').value, 10) || 0)),
    voiceVoxIdleOnly: $('voiceVoxIdleOnly').checked,
    voiceVoxReactions: $('voiceVoxReactions').checked,
    speechSoundEnabled: $('speechSoundEnabled').checked,
    speechSoundIdleOnly: $('speechSoundIdleOnly').checked,
    speechSoundVolume: parseInt($('speechSoundVolume').value, 10) || 0,
    contextReactionsEnabled: $('contextReactionsEnabled').checked,
    contextReactionCooldownSec: parseInt($('contextReactionCooldownSec').value, 10),
    idleSleepEnabled: $('idleSleepEnabled').checked,
    idleSitEnabled: $('idleSitEnabled').checked,
    idleSmallWalkEnabled: $('idleSmallWalkEnabled').checked,
    idleVarietyChance: parseFloat($('idleVarietyChance').value),
    smallWalkMinSec: parseInt($('smallWalkMinSec').value, 10) || 8,
    smallWalkMaxSec: parseInt($('smallWalkMaxSec').value, 10) || 22,
    idleChatter: $('idleChatter').checked,
    prankEnabled: $('prankEnabled').checked,
    prankFakeShutdown: $('prankFakeShutdown').checked,
    prankChanceFakeShutdown: readPct('prankChanceFakeShutdown'),
    prankGlitch: $('prankGlitch').checked,
    prankBlackout: $('prankBlackout').checked,
    prankBsod: $('prankBsod').checked,
    prankJumpscare: $('prankJumpscare').checked,
    prankRealShutdown: $('prankRealShutdown').checked,
    prankChanceRealShutdown: readPct('prankChanceRealShutdown'),
    prankChanceGlitch: readPct('prankChanceGlitch'),
    prankChanceBlackout: readPct('prankChanceBlackout'),
    prankChanceBsod: readPct('prankChanceBsod'),
    prankChanceJumpscare: readPct('prankChanceJumpscare'),
    proactiveChatter: $('proactiveChatter').checked,
    textProactive: $('textProactive').value,
    grabButton: $('grabButton').value === 'left' ? 'left' : 'right',
    ownerName: $('ownerName').value.trim().slice(0, 30),
    aiPersonality: $('aiPersonality').value.trim().slice(0, 500),
    chaosCloseApps: $('chaosCloseApps').checked,
    chaosCloseChance: parseFloat($('chaosCloseChance').value),
    musicDanceEnabled: $('musicDanceEnabled').checked,
    musicThreshold: parseInt($('musicThreshold').value, 10),
    audioInputDeviceId: '',
    audioSourceMode: 'system',
    speechTop: parseInt($('speechTop').value, 10),
    speechLeft: parseInt($('speechLeft').value, 10),
    speechMaxWidth: parseInt($('speechMaxWidth').value, 10),
    speechZoneHeight: parseInt($('speechZoneHeight').value, 10),
    speechHitWidth: parseInt($('speechHitWidth').value, 10),
    speechHitHeight: parseInt($('speechHitHeight').value, 10),
    speechBgColor: $('speechBgColor').value,
    speechTextColor: $('speechTextColor').value,
    speechBorderColor: $('speechBorderColor').value,
    speechFontSize: parseInt($('speechFontSize').value, 10) || 13,
    speechAlign: ['left', 'center', 'right'].includes($('speechAlign').value) ? $('speechAlign').value : 'center',
    showSpeechZone: $('showSpeechZone').checked,
    bodyHitTop: parseInt($('bodyHitTop').value, 10),
    bodyHitLeft: parseInt($('bodyHitLeft').value, 10),
    bodyHitWidth: parseInt($('bodyHitWidth').value, 10),
    bodyHitHeight: parseInt($('bodyHitHeight').value, 10),
    showBodyHitbox: $('showBodyHitbox').checked,
  };
}

function readForm() {
  const activeId = cachedConfig.activePetId;
  const petFields = readPetFields();
  const pets = (cachedConfig.pets || []).map((p) => {
    if (p.id !== activeId) return p;
    return { ...p, ...petFields };
  });

  return {
    ...cachedConfig,
    pets,
    activePetId: activeId,
    petEnabled: $('petPowerBtn').classList.contains('on'),
    launchOnStartup: $('launchOnStartup').checked,
    alwaysOnTop: $('alwaysOnTop').checked,
    gameLowImpactEnabled: $('gameLowImpactEnabled').checked,
    hidePetsWhileGaming: $('hidePetsWhileGaming').checked,
    showSettingsOnStart: $('showSettingsOnStart').checked,
    multiPetInteractions: $('multiPetInteractions').checked,
    petCollisionGap: parseInt($('petCollisionGap').value, 10) || 20,
    gameVictoryPatterns: $('gameVictoryPatterns').value,
    gameProcessWatchEnabled: $('gameProcessWatchEnabled').checked,
    gameProcessList: $('gameProcessList').value,
    gameOcrWatchEnabled: $('ocrPowerBtn').classList.contains('on'),
    gameOcrAuto: $('gameOcrAuto').checked,
    gameOcrDebugEdges: $('gameOcrDebugEdges').checked,
    gameOcrPatterns: $('gameOcrPatterns').value,
    gameOcrIntervalSec: parseInt($('gameOcrIntervalSec').value, 10) || 2,
    gameOcrQuality: ['fast', 'balanced', 'sharp'].includes($('gameOcrQuality').value) ? $('gameOcrQuality').value : 'balanced',
    gameOcrRegion: ['full', 'center', 'top'].includes($('gameOcrRegion').value) ? $('gameOcrRegion').value : 'full',
    voiceDevice: $('voiceDevice').value === 'directml' ? 'directml' : 'cpu',
    aiEnabled: $('aiEnabled').checked,
    aiEndpoint: $('aiEndpoint').value.trim(),
    aiKey: $('aiKey').value,
    aiModel: $('aiModel').value.trim(),
    aiProvider: $('aiProvider').value === 'ollama' ? 'ollama' : 'custom',
    aiOllamaModel: $('aiOllamaModel').value.trim() || 'llama3.1:8b',
    aiFallback: $('aiFallback').checked,
    remoteEnabled: $('remoteEnabled').checked,
    remotePort: Math.max(1024, Math.min(65535, parseInt($('remotePort').value, 10) || 3535)),
    remoteToken: $('remoteToken').value.trim().slice(0, 128),
    prankWallpaper: $('prankWallpaper').checked,
    prankWallpaperSec: parseInt($('prankWallpaperSec').value, 10) || 30,
    prankChanceWallpaper: readPct('prankChanceWallpaper'),
  };
}

function readPct(id) {
  const el = $(id);
  if (!el) return 0;
  const v = parseInt(el.value, 10);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) / 100 : 0;
}

const PANEL_META = {
  'panel-app': { title: 'App', sub: 'Power, appearance, pets, and window options.' },
  'panel-character': { title: 'Character', sub: 'Name, GIF avatar, size, bubbles, and touch zones.' },
  'panel-behavior': { title: 'Behavior', sub: 'Attacks, walking, and idle activities.' },
  'panel-speech': { title: 'Speech', sub: 'What she says, line by line. Sounds live in Voice.' },
  'panel-voice': { title: 'Voice', sub: 'Blip sounds and spoken voices for her lines.' },
  'panel-games': { title: 'Games', sub: 'How she notices YouTube and games. Pick one method.' },
  'panel-dance': { title: 'Music & dance', sub: 'Dance to your default Windows speaker output.' },
  'panel-chaos': { title: 'Chaos', sub: 'Controls, idle chatter, and optional chaos mode.' },
};

const THEMES = ['pink', 'purple', 'dark', 'light'];

function getTheme() {
  try {
    const t = localStorage.getItem('vp-theme') || 'pink';
    return THEMES.includes(t) ? t : 'pink';
  } catch (_) {
    return 'pink';
  }
}

function applyTheme(name) {
  const theme = THEMES.includes(name) ? name : 'pink';
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem('vp-theme', theme);
  } catch (_) {}
  document.querySelectorAll('.theme-swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.theme === theme);
  });
}

const TUTORIAL_STEPS = [
  {
    title: 'Welcome! 🐾',
    text: 'This is your desktop pet. She lives on your screen, reacts to your games, and loves head pats. This 30-second tour gets her set up.',
  },
  {
    title: 'Step 1 of 3 — Turn her ON',
    text: 'Press “Turn pet ON” below (or left-click the pink tray icon by your clock). She will appear at the bottom of your screen.',
  },
  {
    title: 'Step 2 of 3 — Pick her look',
    text: 'She needs character art to appear. Choose a companion below — one click dresses her head to toe.',
    cta: { label: 'Choose character…', overlay: true },
  },
  {
    title: 'Step 3 of 3 — Play with her',
    text: 'Hold right-click on her to drag. Hover or click her head to pet her. Double-click her body to come back to settings. Have fun!',
  },
];

let tutorialStep = 0;

function isTutorialDone() {
  try {
    return localStorage.getItem('vp-tutorial-done') === '1';
  } catch (_) {
    return true;
  }
}

function renderTutorial() {
  const step = TUTORIAL_STEPS[tutorialStep];
  if (!step) return;
  $('tutorialStepTitle').textContent = step.title;
  $('tutorialStepText').textContent = step.text;
  $('tutorialStepCount').textContent = `Step ${tutorialStep + 1} of ${TUTORIAL_STEPS.length}`;
  $('tutorialBack').disabled = tutorialStep === 0;
  $('tutorialNext').textContent = tutorialStep === TUTORIAL_STEPS.length - 1 ? 'Finish!' : 'Next';
  const cta = $('tutorialCta');
  if (step.cta) {
    cta.hidden = false;
    cta.textContent = step.cta.label;
    cta.onclick = () => {
      if (step.cta.overlay) openCharacterSelect();
      else if (step.cta.panel) showSettingsPanel(step.cta.panel);
    };
  } else {
    cta.hidden = true;
    cta.onclick = null;
  }
}

function setupTutorial() {
  const card = $('tutorialCard');
  if (!card || isTutorialDone()) {
    if (card) card.hidden = true;
    return;
  }
  card.hidden = false;
  tutorialStep = 0;
  renderTutorial();
  $('tutorialBack').addEventListener('click', () => {
    tutorialStep = Math.max(0, tutorialStep - 1);
    renderTutorial();
  });
  $('tutorialNext').addEventListener('click', () => {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) {
      try {
        localStorage.setItem('vp-tutorial-done', '1');
      } catch (_) {}
      card.hidden = true;
      return;
    }
    tutorialStep += 1;
    renderTutorial();
  });
  $('tutorialSkip').addEventListener('click', () => {
    try {
      localStorage.setItem('vp-tutorial-done', '1');
    } catch (_) {}
    card.hidden = true;
  });
}

function setupThemePicker() {
  applyTheme(getTheme());
  document.querySelectorAll('.theme-swatch').forEach((b) => {
    b.addEventListener('click', () => applyTheme(b.dataset.theme));
  });
}

const SPEECH_SOUND_FIELDS = [
  ['textIdle', 'idle'],
  ['textGrab', 'grab'],
  ['textGrabRelease', 'grabRelease'],
  ['textAttack', 'attack'],
  ['textPet', 'pet'],
  ['textWalkStart', 'walkStart'],
  ['textWalkEnd', 'walkEnd'],
  ['textSleep', 'sleep'],
  ['textSit', 'sit'],
  ['textDance', 'dance'],
  ['textChaosClose', 'chaosClose'],
  ['textSocial', 'social'],
  ['textBump', 'bump'],
  ['textTagChase', 'tagChase'],
  ['textTagGotcha', 'tagGotcha'],
  ['textWatch', 'watch'],
  ['textGame', 'game'],
  ['textGameFail', 'gameFail'],
  ['textVictory', 'victory'],
  ['textGift', 'gift'],
  ['textGiftThanks', 'giftThanks'],
];

function setupSpeechSoundRows() {
  SPEECH_SOUND_FIELDS.forEach(([fieldId, slot]) => {
    const field = $(fieldId)?.closest('.speech-field');
    if (!field || field.querySelector('.speech-sound-row')) return;
    const row = document.createElement('div');
    row.className = 'speech-sound-row';
    row.dataset.slot = slot;
    row.innerHTML =
      '<span class="meter-hint speech-sound-name">No sound</span>' +
      '<button type="button" class="btn-secondary btn-small btn-sound-pick">🔊 Sound</button>' +
      '<button type="button" class="btn-secondary btn-small btn-sound-test">▶</button>' +
      '<button type="button" class="btn-secondary btn-small btn-sound-clear">Clear</button>';
    field.appendChild(row);
    row.querySelector('.btn-sound-pick').addEventListener('click', async () => {
      await window.petAPI.saveConfig(readForm());
      config = await window.petAPI.pickSpeechSound(slot, cachedConfig.activePetId);
      fillForm(config);
      setStatus(
        getActivePet(config).speechSounds?.[slot] ? `Sound attached to this line.` : 'No file chosen.'
      );
    });
    row.querySelector('.btn-sound-clear').addEventListener('click', async () => {
      await window.petAPI.saveConfig(readForm());
      config = await window.petAPI.clearSpeechSound(slot, cachedConfig.activePetId);
      fillForm(config);
      setStatus('Line sound cleared.');
    });
    row.querySelector('.btn-sound-test').addEventListener('click', () => {
      const url = getActivePet().soundUrls?.[slot];
      if (!url) {
        setStatus('Attach a sound to this line first.');
        return;
      }
      try {
        const a = new Audio(url);
        a.volume = (getActivePet().speechSoundVolume ?? 70) / 100;
        a.play().catch(() => setStatus('Could not play sound.'));
      } catch (_) {
        setStatus('Could not play sound.');
      }
    });
  });
}

function setVoxSpeakerOptions(selectedId, speakers = null) {
  const sel = $('voiceVoxSpeaker');
  if (!sel) return;
  const list = speakers || [...sel.options].map((o) => ({ id: Number(o.value), label: o.textContent }));
  sel.innerHTML = '';
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = String(selectedId ?? 1);
    opt.textContent = `Speaker ${selectedId ?? 1} (refresh to list voices)`;
    sel.appendChild(opt);
    return;
  }
  for (const sp of list) {
    const opt = document.createElement('option');
    opt.value = String(sp.id);
    opt.textContent = sp.label;
    if (Number(sp.id) === Number(selectedId)) opt.selected = true;
    sel.appendChild(opt);
  }
  // Never silently switch voices: if the saved ID isn't in the current list
  // (e.g. an extra VVM voice while on the external backend), keep a
  // placeholder so saving settings can't overwrite it with index 0.
  const savedId = Number(selectedId);
  if (!list.some((sp) => Number(sp.id) === savedId) && Number.isFinite(savedId)) {
    const opt = document.createElement('option');
    opt.value = String(savedId);
    opt.textContent = `Speaker ${savedId} (not in current voice list)`;
    opt.selected = true;
    sel.appendChild(opt);
  } else if (![...sel.options].some((o) => o.selected)) {
    sel.selectedIndex = 0;
  }
}

function toggleVoxBuiltinBox() {
  const box = $('voxBuiltinBox');
  if (box) box.style.display = $('voiceVoxBackend')?.value === 'builtin' ? '' : 'none';
}

function toggleAiRows() {
  const ollama = $('aiProvider')?.value === 'ollama';
  [$('aiEndpoint'), $('aiKey'), $('aiModel')]
    .map((el) => el?.closest('.speech-field'))
    .filter(Boolean)
    .forEach((row) => {
      row.style.display = ollama ? 'none' : '';
    });
  const ollamaRow = $('ollamaModelRow');
  if (ollamaRow) ollamaRow.style.display = ollama ? '' : 'none';
}

function toggleVoxGpuBox() {
  const box = $('voxGpuBox');
  if (box) box.style.display = $('voiceDevice')?.value === 'directml' ? '' : 'none';
}

async function refreshVoxGpuStatus() {
  const el = $('voxGpuStatus');
  if (!el || !window.petAPI.voxGpuStatus) return;
  try {
    const st = await window.petAPI.voxGpuStatus();
    el.textContent = st?.installed ? 'GPU pack ready.' : 'GPU pack not downloaded (~30MB).';
  } catch (_) {}
}

const VOX_BASE_CREDIT = 'VOICEVOX:ずんだもん・四国めたん・春日部つむぎ・雨晴はう';

let voxBusy = false;

async function doRefreshVoxSpeakers() {
  const el = $('voxStatus');
  if (voxBusy) {
    if (el) el.textContent = 'Please wait — a download is in progress…';
    return;
  }
  await window.petAPI.saveConfig(readForm());
  if (el) el.textContent = 'Contacting voice…';
  const result = await window.petAPI.voxSpeakers();
    if (result?.ok) {
      setVoxSpeakerOptions(getActivePet().voiceVoxSpeaker ?? 1, result.speakers);
      if (el) {
        const models = (result.models || []).join(', ');
        el.textContent = `Found ${result.speakers.length} voices${models ? ` (${models})` : ''}.`;
      }
    } else if (el) {
    const detail = result?.error ? ` (${result.error})` : '';
    el.textContent = `Voice list failed${detail}. Built-in: download it above. External: launch VOICEVOX.`;
  }
}

function renderExtraVoices(status) {
  const box = $('voxExtraVoices');
  if (!box) return;
  box.innerHTML = '';
  for (const extra of (status && status.extraVoices) || []) {
    const row = document.createElement('div');
    row.className = 'speech-sound-row' + (extra.installed ? ' has-sound' : '');
    row.innerHTML =
      `<span class="meter-hint speech-sound-name">${extra.installed ? '✓ ' : ''}${extra.label} (${extra.sizeHint})</span>` +
      (extra.installed
        ? ''
        : '<button type="button" class="btn-secondary btn-small btn-vox-model-dl">Download</button>');
    if (!extra.installed) {
      row.querySelector('.btn-vox-model-dl').addEventListener('click', async () => {
        const el = $('voxCoreStatus');
        if (voxBusy) {
          if (el) el.textContent = 'A download is already in progress…';
          return;
        }
        if (!$('voxAgreeTerms')?.checked) {
          if (el) el.textContent = 'Please agree to the terms first (checkbox above).';
          return;
        }
        voxBusy = true;
        await window.petAPI.saveConfig(readForm());
        if (el) el.textContent = `Downloading ${extra.label} (${extra.sizeHint})…`;
        const result = await window.petAPI.voxModelDownload(extra.vvm);
        voxBusy = false;
        if (result?.ok) {
          if (el) el.textContent = `${extra.label} ready! Loading voices…`;
          await doRefreshVoxSpeakers();
        } else if (el) {
          el.textContent = result?.error === 'cancelled'
            ? 'Download cancelled.'
            : `Download failed: ${(result && result.error) || 'unknown error'}. Check internet and retry.`;
        }
        refreshVoxCoreStatus();
      });
    }
    box.appendChild(row);
  }
  const credit = $('voxCredit');
  if (credit) {
    const extras = ((status && status.extraVoices) || []).filter((e) => e.installed).map((e) => e.credit);
    credit.textContent = 'Voice credit (required by license): ' + [VOX_BASE_CREDIT, ...extras].join('・');
  }
}

async function refreshVoxCoreStatus() {
  const el = $('voxCoreStatus');
  if (!el || !window.petAPI.voxCoreStatus) return;
  try {
    const st = await window.petAPI.voxCoreStatus();
    renderExtraVoices(st);
    if (st?.installed) {
      el.textContent = 'Built-in voice ready.';
      setVoxProgress(100);
    } else if (!st?.downloading) {
      el.textContent = 'Built-in voice not downloaded.';
      setVoxProgress(0);
    }
  } catch (_) {}
}

function setVoxProgress(percent) {
  const bar = $('voxProgressBar');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent ?? 0))}%`;
}

function updateSpeechSoundLabels(pet) {
  document.querySelectorAll('.speech-sound-row').forEach((row) => {
    const file = pet.speechSounds?.[row.dataset.slot];
    const nameEl = row.querySelector('.speech-sound-name');
    if (nameEl) nameEl.textContent = file ? `🔊 ${file}` : 'No sound';
    row.classList.toggle('has-sound', !!file);
  });
}

function showSettingsPanel(panelId) {
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  const panel = $(panelId);
  const btn = document.querySelector(`.nav-btn[data-panel="${panelId}"]`);
  if (panel) panel.classList.add('active');
  if (btn) btn.classList.add('active');
  const meta = PANEL_META[panelId];
  if (meta) {
    $('panelTitle').textContent = meta.title;
    $('panelSubtitle').textContent = meta.sub;
  }
  try {
    localStorage.setItem('vp-settings-panel', panelId);
  } catch (_) {}
}

function setupSettingsNav() {
  const nav = $('settingsNav');
  if (!nav) return;
  nav.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => showSettingsPanel(btn.dataset.panel));
  });
  const saved = localStorage.getItem('vp-settings-panel');
  if (saved && $(saved)) showSettingsPanel(saved);
}

let systemAudioStream = null;
let systemAudioCtx = null;
let systemAudioAnalyser = null;
let systemAudioTimer = null;
let systemAudioCalibrating = false;
let systemAudioCalibrateUntil = 0;
let systemAudioCalibrateBuf = [];
let systemAudioNoiseFloor = 0;
let systemAudioSmoothed = 0;
let systemAudioConnected = false;
let systemAudioDancing = false;
let systemAudioDanceHoldUntil = 0;

function resumeSystemAudioContext() {
  if (systemAudioCtx && systemAudioCtx.state === 'suspended') {
    systemAudioCtx.resume().catch(() => {});
  }
}

function stopSystemAudioCapture() {
  document.removeEventListener('visibilitychange', resumeSystemAudioContext);
  window.removeEventListener('focus', resumeSystemAudioContext);
  if (systemAudioTimer) {
    clearInterval(systemAudioTimer);
    systemAudioTimer = null;
  }
  if (systemAudioStream) {
    systemAudioStream.getTracks().forEach((t) => t.stop());
    systemAudioStream = null;
  }
  if (systemAudioCtx) {
    systemAudioCtx.close().catch(() => {});
    systemAudioCtx = null;
  }
  systemAudioAnalyser = null;
  systemAudioConnected = false;
  systemAudioSmoothed = 0;
  systemAudioDancing = false;
  const btn = $('connectSystemAudio');
  if (btn) btn.textContent = 'Connect system audio';
  window.petAPI?.stopSystemAudio?.();
}

function resetSystemAudioCalibration() {
  systemAudioCalibrating = true;
  systemAudioCalibrateUntil = Date.now() + 2200;
  systemAudioCalibrateBuf = [];
  systemAudioNoiseFloor = 0;
  systemAudioSmoothed = 0;
}

function scaleSystemVolume(rms) {
  if (systemAudioCalibrating && Date.now() < systemAudioCalibrateUntil) {
    systemAudioCalibrateBuf.push(rms);
    systemAudioSmoothed = 0;
    return 0;
  }
  if (systemAudioCalibrating) {
    systemAudioCalibrating = false;
    if (systemAudioCalibrateBuf.length) {
      systemAudioCalibrateBuf.sort((a, b) => a - b);
      const idx = Math.min(
        systemAudioCalibrateBuf.length - 1,
        Math.floor(systemAudioCalibrateBuf.length * 0.92)
      );
      systemAudioNoiseFloor = systemAudioCalibrateBuf[idx] + 0.004;
    }
    systemAudioCalibrateBuf = [];
  }

  if (rms < systemAudioNoiseFloor + 0.02) {
    systemAudioNoiseFloor = systemAudioNoiseFloor * 0.992 + rms * 0.008;
  }

  const adjusted = Math.max(0, rms - systemAudioNoiseFloor - 0.006);
  const headroom = Math.max(0.04, 0.2 - systemAudioNoiseFloor);
  const scaled = Math.min(1, adjusted / headroom);

  if (scaled <= 0.002) {
    systemAudioSmoothed *= 0.4;
    if (systemAudioSmoothed < 0.005) systemAudioSmoothed = 0;
  } else {
    systemAudioSmoothed = systemAudioSmoothed * 0.5 + scaled * 0.5;
  }
  return systemAudioSmoothed;
}

function tickSystemAudio() {
  if (!systemAudioAnalyser || !systemAudioConnected) return;
  if (systemAudioCtx && systemAudioCtx.state === 'suspended') {
    systemAudioCtx.resume().catch(() => {});
  }

  const timeData = new Uint8Array(systemAudioAnalyser.fftSize);
  systemAudioAnalyser.getByteTimeDomainData(timeData);
  let sumSq = 0;
  for (let i = 0; i < timeData.length; i++) {
    const v = (timeData[i] - 128) / 128;
    sumSq += v * v;
  }
  const rms = Math.sqrt(sumSq / timeData.length);
  const level = scaleSystemVolume(rms);
  const thresholdPct = parseInt($('musicThreshold').value, 10) || 35;
  const threshold = thresholdPct / 100;
  const releaseThreshold = threshold * 0.55;

  if (level >= threshold) {
    systemAudioDanceHoldUntil = Date.now() + 700;
    systemAudioDancing = true;
  } else if (
    systemAudioDancing &&
    level < releaseThreshold &&
    Date.now() > systemAudioDanceHoldUntil
  ) {
    systemAudioDancing = false;
  }

  const payload = {
    connected: true,
    level: Math.round(level * 100),
    threshold: thresholdPct,
    dancing: systemAudioDancing,
  };
  updateAudioMeter(payload);
  window.petAPI.sendSystemAudioLevel(payload);
}

async function connectSystemAudio() {
  if (!window.petAPI?.sendSystemAudioLevel) {
    setStatus('Run Virtual Pet.exe — do not open this page in a browser.');
    return;
  }

  if (systemAudioConnected) {
    stopSystemAudioCapture();
    setStatus('System audio disconnected.');
    return;
  }

  stopSystemAudioCapture();
  resetSystemAudioCalibration();

  try {
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
      setStatus('No audio track — enable "Share system audio" in the Windows dialog.');
      return;
    }

    await window.petAPI.saveConfig(readForm());
    systemAudioStream = stream;
    systemAudioCtx = new AudioContext();
    const src = systemAudioCtx.createMediaStreamSource(stream);
    systemAudioAnalyser = systemAudioCtx.createAnalyser();
    systemAudioAnalyser.fftSize = 2048;
    systemAudioAnalyser.smoothingTimeConstant = 0.35;
    src.connect(systemAudioAnalyser);
    if (systemAudioCtx.state === 'suspended') await systemAudioCtx.resume();

    const keepAlive = systemAudioCtx.createGain();
    keepAlive.gain.value = 0.0001;
    const osc = systemAudioCtx.createOscillator();
    osc.frequency.value = 20;
    osc.connect(keepAlive);
    keepAlive.connect(systemAudioCtx.destination);
    osc.start();

    document.addEventListener('visibilitychange', resumeSystemAudioContext);
    window.addEventListener('focus', resumeSystemAudioContext);

    systemAudioConnected = true;
    $('connectSystemAudio').textContent = 'Disconnect system audio';
    setStatus('Connected — volume keeps updating after you alt-tab.');
    systemAudioTimer = setInterval(tickSystemAudio, 80);
  } catch (err) {
    const msg =
      err?.name === 'NotAllowedError'
        ? 'Cancelled — click Connect system audio again.'
        : `Could not capture audio: ${err?.message || err}`;
    setStatus(msg);
    stopSystemAudioCapture();
  }
}

function updateAudioMeter(data) {
  const level = data?.level ?? 0;
  const threshold = data?.threshold ?? parseInt($('musicThreshold').value, 10);
  $('audioLevelVal').textContent = level;
  $('audioDanceVal').textContent = data?.dancing ? 'yes' : 'no';
  $('audioMeterFill').style.width = `${Math.min(100, level)}%`;
  updateThresholdLine(threshold);
}

function updateThresholdLine(thresholdPct) {
  const t = thresholdPct ?? parseInt($('musicThreshold').value, 10);
  const line = $('audioThresholdLine');
  const meter = line?.parentElement;
  if (!line || !meter) return;
  const pct = Math.max(0, Math.min(100, t)) / 100;
  const x = Math.round(meter.clientWidth * pct);
  line.style.left = `${x}px`;
}

async function loadCharacterPacks() {
  const sel = $('characterPack');
  if (!sel || !window.petAPI.listCharacterPacks) return;
  let packs = [];
  try {
    packs = (await window.petAPI.listCharacterPacks()) || [];
  } catch (_) {
    packs = [];
  }
  const current = getActivePet().characterPack;
  sel.innerHTML = '';
  for (const pack of packs) {
    const opt = document.createElement('option');
    opt.value = pack.name;
    opt.textContent = `${pack.name} (${pack.slots.length} looks)`;
    sel.appendChild(opt);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom files (below)';
  sel.appendChild(custom);
  sel.value = packs.some((p) => p.name === current) ? current : 'custom';
}

async function openCharacterSelect() {
  const overlay = $('characterSelectOverlay');
  const grid = $('characterCards');
  if (!overlay || !grid || !window.petAPI.listCharacterPacks) return;
  grid.innerHTML = '';
  let packs = [];
  try {
    packs = (await window.petAPI.listCharacterPacks()) || [];
  } catch (_) {
    packs = [];
  }
  if (!packs.length) {
    grid.textContent = 'No characters found yet — upload art below first.';
  }
  for (const pack of packs) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'character-card';
    const img = document.createElement('img');
    img.className = 'character-card-img';
    img.alt = pack.name;
    try {
      const prev = await window.petAPI.packPreview(pack.name);
      if (prev?.ok && prev.url) img.src = `${prev.url}?t=${Date.now()}`;
    } catch (_) {}
    const name = document.createElement('span');
    name.className = 'character-card-name';
    name.textContent = pack.name;
    const meta = document.createElement('span');
    meta.className = 'meter-hint';
    meta.textContent = `${pack.slots.length} looks`;
    card.appendChild(img);
    card.appendChild(name);
    card.appendChild(meta);
    card.addEventListener('click', async () => {
      await window.petAPI.saveConfig(readForm());
      const nextCfg = await window.petAPI.applyCharacterPack(pack.name, cachedConfig.activePetId);
      try {
        localStorage.setItem('vp-character-chosen', '1');
      } catch (_) {}
      overlay.hidden = true;
      fillForm(nextCfg);
      await loadCharacterPacks();
      setStatus(`Say hi to ${pack.name}!`);
    });
    grid.appendChild(card);
  }
  overlay.hidden = false;
}

function closeCharacterSelect() {
  const overlay = $('characterSelectOverlay');
  if (overlay) overlay.hidden = true;
}

async function maybeShowCharacterSelect() {
  let chosen = false;
  try {
    chosen = localStorage.getItem('vp-character-chosen') === '1';
  } catch (_) {
    chosen = true;
  }
  if (chosen || !window.petAPI.listCharacterPacks) return;
  let packs = [];
  try {
    packs = (await window.petAPI.listCharacterPacks()) || [];
  } catch (_) {
    packs = [];
  }
  // A real choice exists once the user adds character folders.
  if (packs.length >= 2) openCharacterSelect();
}

function slotVariantUrls(pet, slot) {
  if (pet.avatarVariantUrls && Array.isArray(pet.avatarVariantUrls[slot])) {
    return pet.avatarVariantUrls[slot].filter(Boolean);
  }
  const single = (pet.avatarUrls || {})[slot];
  return single ? [single] : [];
}

function updateAvatarPreviews(pet) {
  const urls = pet.avatarUrls || {};

  for (const slot of Object.keys(SLOT_PREVIEW)) {
    const img = $(SLOT_PREVIEW[slot]);
    const label = $(SLOT_NAME[slot]);
    const entry = asAvatarSlot(pet[SLOT_CONFIG_KEY[slot]]);
    const file = entry.files[0]?.file || '';
    const url = urls[slot];

    if (url) {
      img.src = `${url}?t=${Date.now()}`;
      label.textContent = entry.files.length > 1 ? `${file} (+${entry.files.length - 1} more)` : file || slot;
    } else {
      img.removeAttribute('src');
      const fallbacks = {
        idle: 'None (required)',
        move: 'None (uses idle)',
        attack: 'None (uses move or idle)',
        pet: 'None (uses idle)',
        grab: 'None (uses move)',
        dance: 'None (uses move)',
        sleep: 'None (uses idle)',
        sit: 'None (uses idle)',
        victory: 'None (uses dance)',
        defeat: 'None (uses sit)',
        talk: 'None (uses pet)',
        greet: 'None (uses pet)',
        giftGive: 'None (uses move)',
        giftReceive: 'None (uses pet)',
      };
      label.textContent = fallbacks[slot];
    }
    renderSlotVariants(pet, slot);
  }
}

function variantThumbUrl(pet, slot, index) {
  const list = slotVariantUrls(pet, slot);
  return list[index] || '';
}

function renderSlotVariants(pet, slot) {
  const slotEl = document.querySelector(`.gif-slot[data-slot="${slot}"]`);
  if (!slotEl) return;
  let box = slotEl.querySelector('.slot-variants');
  if (!box) {
    box = document.createElement('div');
    box.className = 'slot-variants';
    slotEl.appendChild(box);
  }
  const entry = asAvatarSlot(pet[SLOT_CONFIG_KEY[slot]]);
  box.innerHTML = '';
  if (entry.files.length <= 1) return;

  const modeRow = document.createElement('div');
  modeRow.className = 'variant-mode-row';
  const modeLabel = document.createElement('span');
  modeLabel.className = 'meter-hint';
  modeLabel.textContent = 'Play order: ';
  const modeSel = document.createElement('select');
  modeSel.className = 'variant-mode';
  for (const [val, label] of [['shuffle', 'Shuffle'], ['order', 'In order'], ['custom', 'Custom links']]) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (entry.mode === val) opt.selected = true;
    modeSel.appendChild(opt);
  }
  modeSel.addEventListener('change', async () => {
    const nextCfg = await window.petAPI.setAvatarMode(slot, modeSel.value, cachedConfig.activePetId);
    fillForm(nextCfg);
    setStatus(`“${slot}” now plays ${modeSel.value}.`);
  });
  modeRow.appendChild(modeLabel);
  modeRow.appendChild(modeSel);
  box.appendChild(modeRow);

  entry.files.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'variant-row';
    const thumb = document.createElement('img');
    thumb.className = 'variant-thumb';
    thumb.alt = '';
    const url = variantThumbUrl(pet, slot, i);
    if (url) thumb.src = `${url}?t=${Date.now()}`;
    const name = document.createElement('span');
    name.className = 'variant-name';
    name.textContent = `#${i + 1} ${f.file}`;
    row.appendChild(thumb);
    row.appendChild(name);
    if (entry.mode === 'custom') {
      const nextInput = document.createElement('input');
      nextInput.type = 'text';
      nextInput.className = 'variant-next';
      nextInput.title = 'After this, play: any, or variant numbers like 4,6';
      nextInput.placeholder = 'after: any';
      nextInput.value = Array.isArray(f.next) ? f.next.map((n) => n + 1).join(',') : 'any';
      nextInput.addEventListener('change', async () => {
        const raw = nextInput.value.trim().toLowerCase();
        let next = 'any';
        if (raw && raw !== 'any') {
          const nums = [
            ...new Set(
              raw
                .split(',')
                .map((s) => parseInt(s, 10) - 1)
                .filter((n) => Number.isInteger(n) && n >= 0 && n < entry.files.length && n !== i)
            ),
          ];
          if (!nums.length) {
            setStatus('Use “any” or variant numbers like 4,6.');
            return;
          }
          next = nums;
        }
        const nextCfg = await window.petAPI.setVariantNext(slot, i, next, cachedConfig.activePetId);
        fillForm(nextCfg);
        setStatus(`Linked “${slot}” #${i + 1}.`);
      });
      row.appendChild(nextInput);
    }
    const canDelete = !(slot === 'idle' && entry.files.length <= 1);
    if (canDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn-secondary btn-small btn-variant-del';
      del.textContent = '×';
      del.title = 'Remove this variant';
      del.addEventListener('click', async () => {
        const nextCfg = await window.petAPI.removeAvatarVariant(slot, i, cachedConfig.activePetId);
        fillForm(nextCfg);
        setStatus(`Removed “${slot}” #${i + 1}.`);
      });
      row.appendChild(del);
    }
    box.appendChild(row);
  });
}

function renderPetList() {
  const list = $('petList');
  if (!list) return;
  list.innerHTML = '';

  for (const pet of cachedConfig.pets || []) {
    const wrap = document.createElement('div');
    wrap.className = `pet-tab${pet.id === cachedConfig.activePetId ? ' active' : ''}`;

    const dot = document.createElement('span');
    dot.className = 'pet-dot';
    dot.textContent = (pet.name || 'P').slice(0, 1).toUpperCase();

    const label = document.createElement('span');
    label.textContent = pet.name || 'Pet';
    label.style.cursor = 'pointer';
    label.onclick = () => selectPet(pet.id);

    wrap.appendChild(dot);
    wrap.appendChild(label);

    if (pet.id === cachedConfig.activePetId) {
      const actions = document.createElement('span');
      actions.className = 'pet-tab-actions';
      if ((cachedConfig.pets || []).length > 1) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'pet-mini-btn';
        removeBtn.title = 'Remove pet';
        removeBtn.textContent = '✕';
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          removePet(pet.id);
        };
        actions.appendChild(removeBtn);
      }
      const dupBtn = document.createElement('button');
      dupBtn.type = 'button';
      dupBtn.className = 'pet-mini-btn';
      dupBtn.title = 'Duplicate pet';
      dupBtn.textContent = '⧉';
      dupBtn.onclick = (e) => {
        e.stopPropagation();
        duplicatePet(pet.id);
      };
      actions.appendChild(dupBtn);
      wrap.appendChild(actions);
    }

    wrap.onclick = () => selectPet(pet.id);
    list.appendChild(wrap);
  }

  const addBtn = $('addPet');
  if (addBtn) addBtn.disabled = (cachedConfig.pets || []).length >= 6;
}

async function selectPet(petId) {
  if (petId === cachedConfig.activePetId) return;
  await window.petAPI.saveConfig(readForm());
  const config = await window.petAPI.getConfig();
  config.activePetId = petId;
  await window.petAPI.saveConfig(config);
  fillForm(config);
  showSettingsPanel('panel-character');
  setStatus('Switched pet.');
}

async function removePet(petId) {
  if ((cachedConfig.pets || []).length <= 1) return;
  if (!window.confirm('Remove this pet?')) return;
  const config = await window.petAPI.removePet(petId);
  fillForm(config);
  setStatus('Pet removed.');
}

async function duplicatePet(petId) {
  if ((cachedConfig.pets || []).length >= 6) {
    setStatus('Maximum 6 pets.');
    return;
  }
  const config = await window.petAPI.duplicatePet(petId);
  fillForm(config);
  setStatus('Pet duplicated!');
}

function updatePowerUI(enabled) {
  const btn = $('petPowerBtn');
  const status = $('petPowerStatus');
  btn.classList.toggle('on', enabled);
  btn.classList.toggle('off', !enabled);
  btn.textContent = enabled ? 'Turn pet OFF' : 'Turn pet ON';
  status.textContent = enabled ? 'Pet is ON' : 'Pet is OFF';
  status.classList.toggle('on', enabled);
  status.classList.toggle('off', !enabled);
  $('startWander').disabled = !enabled;
}

function bondStage(score) {
  if (score >= 70) return 'Best friends ♡';
  if (score >= 40) return 'Friends';
  if (score >= 20) return 'Warming up';
  return 'Strangers';
}

function svgDonut(pct, color) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  return `<svg class="bond-donut" viewBox="0 0 42 42">` +
    `<circle cx="21" cy="21" r="15.9155" fill="none" style="stroke:var(--meter-track)" stroke-width="5"/>` +
    `<circle cx="21" cy="21" r="15.9155" fill="none" stroke="${color}" stroke-width="5" ` +
    `stroke-dasharray="${v} 100" stroke-linecap="round" transform="rotate(-90 21 21)"/></svg>`;
}

function renderBonds(config) {
  const box = $('bondList');
  if (!box) return;
  const pets = (config?.pets || []).filter((p) => p.enabled !== false);
  box.innerHTML = '';
  if (pets.length < 2) {
    const hint = document.createElement('p');
    hint.className = 'meter-hint';
    hint.textContent = 'Need 2+ pets for friendships.';
    box.appendChild(hint);
  } else {
    const rels = (config.relationships && typeof config.relationships === 'object') ? config.relationships : {};
    for (let i = 0; i < pets.length; i++) {
      for (let j = i + 1; j < pets.length; j++) {
        const a = pets[i];
        const b = pets[j];
        const key = [String(a.id), String(b.id)].sort().join('|');
        const score = Math.max(0, Math.min(100, Number(rels[key]?.score ?? 20)));
        const row = document.createElement('div');
        row.className = 'bond-row';
        const top = document.createElement('div');
        top.className = 'bond-top';
        const ring = document.createElement('span');
        ring.innerHTML = svgDonut(score, score >= 70 ? '#e84393' : score >= 40 ? '#00b894' : '#a29bfe');
        const label = document.createElement('div');
        label.className = 'meter-hint';
        label.textContent = `${a.name || 'Pet'} + ${b.name || 'Pet'} — ${score} · ${bondStage(score)}`;
        top.appendChild(ring);
        top.appendChild(label);
        const track = document.createElement('div');
        track.className = 'vox-progress';
        const fill = document.createElement('div');
        fill.className = 'vox-progress-bar';
        fill.style.width = `${score}%`;
        track.appendChild(fill);
        row.appendChild(top);
        row.appendChild(track);
        box.appendChild(row);
      }
    }
  }
  const rec = $('recordList');
  if (rec) {
    rec.innerHTML = '';
    for (const p of pets) {
      const m = (p.memory && typeof p.memory === 'object') ? p.memory : {};
      const w = Number(m.victoriesSeen) || 0;
      const l = Number(m.deathsSeen) || 0;
      const t = w + l;
      const pct = t ? Math.round((w / t) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'record-row';
      const ring = document.createElement('span');
      ring.innerHTML = svgDonut(pct, '#00b894');
      const label = document.createElement('div');
      label.className = 'meter-hint';
      label.textContent = `${p.name || 'Pet'} — ${w}W / ${l}L${t ? ` · ${pct}% wins` : ' · no matches yet'}`;
      row.appendChild(ring);
      row.appendChild(label);
      rec.appendChild(row);
    }
  }
}

async function renderOcrLog() {
  const box = $('ocrLog');
  if (!box || !window.petAPI.getOcrLog) return;
  let entries = [];
  try {
    entries = await window.petAPI.getOcrLog();
  } catch (_) {}
  box.innerHTML = '';
  if (!entries.length) {
    const hint = document.createElement('div');
    hint.className = 'ocr-log-row';
    hint.textContent = 'No scans yet — turn the watch on or run a test scan.';
    box.appendChild(hint);
    return;
  }
  for (const e of entries.slice(0, 30)) {
    const row = document.createElement('div');
    row.className = 'ocr-log-row';
    const time = document.createElement('span');
    time.className = 'ocr-log-time';
    try {
      time.textContent = new Date(e.at).toLocaleTimeString();
    } catch (_) {
      time.textContent = '';
    }
      row.appendChild(time);
      if (e.event) {
        const ev = document.createElement('span');
        ev.className = 'ocr-log-match';
        ev.textContent = e.event === 'watch-on'
          ? `── watch ON${e.auto ? ' (auto)' : ''} ──`
          : `── watch OFF${e.error ? ` (${e.error})` : ''} ──`;
        row.appendChild(ev);
        box.appendChild(row);
        continue;
      }
      const star = document.createElement('span');
      star.textContent = e.test ? '★ ' : '';
      row.appendChild(star);
      const pad = document.createElement('span');
      pad.textContent = e.game ? '🎮 ' : '';
      row.appendChild(pad);
      if (e.error) {
      const err = document.createElement('span');
      err.className = 'ocr-log-error';
      err.textContent = `scan failed (${e.error})`;
      row.appendChild(err);
      } else {
        const txt = document.createElement('span');
        let shown = e.text || '(empty)';
        if (Number.isFinite(e.at) && e.at >= 0 && e.text && e.text.length > 90) {
          const s = Math.max(0, e.at - 40);
          shown = (s > 0 ? '…' : '') + e.text.slice(s, s + 100) + (e.text.length > s + 100 ? '…' : '');
        }
        txt.textContent = shown;
        row.appendChild(txt);
      if (e.match) {
        const badge = document.createElement('span');
        badge.className = 'ocr-log-match';
        badge.textContent = `  → ${e.match.kind} (${e.match.pattern})`;
        row.appendChild(badge);
      }
    }
    box.appendChild(row);
  }
}

function newRemoteToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function updateRemoteStatus(config = cachedConfig) {
  const el = $('remoteStatus');
  if (!el) return;
  if (config.remoteEnabled) {
    el.textContent = `Server ON — this PC: http://localhost:${config.remotePort || 3535}/ · phone: this PC's Wi-Fi IP + port.`;
  } else {
    el.textContent = 'Server off.';
  }
}

function updatePrankLabels(pet, appConfig = cachedConfig) {
  const img = $('prankImageLabel');
  if (img) img.textContent = pet?.prankImage ? `Image file: ${pet.prankImage}` : 'No image selected';
  const wall = $('prankWallpaperLabel');
  if (wall) wall.textContent = appConfig?.prankWallpaperImage ? `Image file: ${appConfig.prankWallpaperImage}` : 'No image selected';
}

function updateDashHeader(fullConfig, pet) {
  try {
    const h = new Date().getHours();
    const greet = h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('dashGreeting').textContent = greet;
  } catch (_) {}
  try {
    const name = (pet && pet.name) || 'Mochi';
    $('profilePetName').textContent = name;
    const av = $('profilePetAvatar');
    const img = pet && pet.avatarUrls && pet.avatarUrls.idle;
    if (av) {
      if (img) {
        av.innerHTML = '';
        const im = document.createElement('img');
        im.src = img;
        im.alt = '';
        av.appendChild(im);
      } else {
        av.textContent = name.charAt(0).toUpperCase();
      }
    }
    const mood = $('profilePetMood');
    if (mood) mood.textContent = (pet && pet.mood) || 'happy';
    const dot = $('profilePetDot');
    if (dot) dot.style.background = fullConfig && fullConfig.petEnabled ? '#22c55e' : '';
    $('pillPower').classList.toggle('on', !!(fullConfig && fullConfig.petEnabled));
    $('pillAi').classList.toggle('on', !!(fullConfig && fullConfig.aiEnabled));
    $('pillVoice').classList.toggle('on', !!(pet && pet.voiceVoxEnabled));
  } catch (_) {}
}

function updateOcrPowerUI(enabled) {
  const btn = $('ocrPowerBtn');
  const status = $('ocrPowerStatus');
  if (!btn || !status) return;
  btn.classList.toggle('on', enabled);
  btn.classList.toggle('off', !enabled);
  btn.textContent = enabled ? 'Turn screen watch OFF' : 'Turn screen watch ON';
  status.textContent = enabled ? 'Screen watch is ON — scanning continuously' : 'Screen watch is OFF';
  status.classList.toggle('on', enabled);
  status.classList.toggle('off', !enabled);
}

function fillForm(fullConfig) {
  cachedConfig = {
    ...APP_DEFAULTS,
    ...fullConfig,
    pets: fullConfig.pets?.length ? fullConfig.pets : [{ id: 'pet-1', ...PET_DEFAULTS }],
  };
  const pet = getActivePet(cachedConfig);

  $('petIndividualEnabled').checked = pet.enabled !== false;
  $('multiPetInteractions').checked = fullConfig.multiPetInteractions !== false;
  renderBonds(fullConfig);
  updateDashHeader(fullConfig, pet);
  try { renderOcrLog(); } catch (_) {}
  $('petCollisionGap').value = fullConfig.petCollisionGap ?? 20;
  $('name').value = pet.name || 'Mochi';
  $('scale').value = pet.scale;
  $('moveSpeed').value = pet.moveSpeed;
  $('attackEnabled').checked = !!pet.attackEnabled;
  $('aggression').value = pet.aggression ?? 0.4;
  $('wanderDuration').value = pet.wanderDuration ?? 30;
  $('wanderDurationUnit').value = pet.wanderDurationUnit || 'sec';
  $('alwaysOnTop').checked = fullConfig.alwaysOnTop;
  $('gameLowImpactEnabled').checked = fullConfig.gameLowImpactEnabled !== false;
  $('hidePetsWhileGaming').checked = !!fullConfig.hidePetsWhileGaming;
  $('gameProcessWatchEnabled').checked = fullConfig.gameProcessWatchEnabled !== false;
  $('gameProcessList').value = fullConfig.gameProcessList || '';
  updateOcrPowerUI(!!fullConfig.gameOcrWatchEnabled);
  $('gameOcrAuto').checked = fullConfig.gameOcrAuto !== false;
  $('gameOcrDebugEdges').checked = !!fullConfig.gameOcrDebugEdges;
  $('gameOcrPatterns').value = fullConfig.gameOcrPatterns || '';
  $('gameOcrIntervalSec').value = fullConfig.gameOcrIntervalSec ?? 2;
  $('gameOcrIntervalSecVal').textContent = fullConfig.gameOcrIntervalSec ?? 2;
  $('gameOcrRegion').value = ['full', 'center', 'top'].includes(fullConfig.gameOcrRegion)
    ? fullConfig.gameOcrRegion
    : 'full';
  $('gameOcrQuality').value = ['fast', 'balanced', 'sharp'].includes(fullConfig.gameOcrQuality)
    ? fullConfig.gameOcrQuality
    : 'balanced';
  $('voiceDevice').value = fullConfig.voiceDevice === 'directml' ? 'directml' : 'cpu';
  $('aiEnabled').checked = !!fullConfig.aiEnabled;
  $('aiEndpoint').value = fullConfig.aiEndpoint || '';
  $('aiKey').value = fullConfig.aiKey || '';
  $('aiModel').value = fullConfig.aiModel || '';
  $('aiProvider').value = fullConfig.aiProvider === 'ollama' ? 'ollama' : 'custom';
  $('aiOllamaModel').value = fullConfig.aiOllamaModel || 'llama3.1:8b';
  $('aiFallback').checked = fullConfig.aiFallback !== false;
  $('remoteEnabled').checked = !!fullConfig.remoteEnabled;
  $('remotePort').value = fullConfig.remotePort ?? 3535;
  if (!String($('remoteToken').value || '').trim() && fullConfig.remoteToken) {
    $('remoteToken').value = fullConfig.remoteToken;
  }
  updateRemoteStatus(fullConfig);
  $('prankEnabled').checked = pet.prankEnabled !== false;
  $('prankRealShutdown').checked = !!pet.prankRealShutdown;
  $('prankChanceRealShutdown').value = Math.round((pet.prankChanceRealShutdown ?? 0) * 100);
  $('prankChanceRealShutdownVal').textContent = Math.round((pet.prankChanceRealShutdown ?? 0) * 100);
  $('prankFakeShutdown').checked = pet.prankFakeShutdown !== false;
  $('prankChanceFakeShutdown').value = Math.round((pet.prankChanceFakeShutdown ?? 0.02) * 100);
  $('prankChanceFakeShutdownVal').textContent = Math.round((pet.prankChanceFakeShutdown ?? 0.02) * 100);
  $('prankGlitch').checked = pet.prankGlitch !== false;
  $('prankBlackout').checked = !!pet.prankBlackout;
  $('prankBsod').checked = !!pet.prankBsod;
  $('prankJumpscare').checked = !!pet.prankJumpscare;
  const pctFill = (id, v) => {
    $(id).value = Math.round((v ?? 0.02) * 100);
    $(id + 'Val').textContent = Math.round((v ?? 0.02) * 100);
  };
  pctFill('prankChanceGlitch', pet.prankChanceGlitch);
  pctFill('prankChanceBlackout', pet.prankChanceBlackout);
  pctFill('prankChanceBsod', pet.prankChanceBsod);
  pctFill('prankChanceJumpscare', pet.prankChanceJumpscare);
  pctFill('prankChanceWallpaper', fullConfig.prankChanceWallpaper);
  $('prankWallpaper').checked = !!fullConfig.prankWallpaper;
  $('prankWallpaperSec').value = fullConfig.prankWallpaperSec ?? 30;
  $('prankWallpaperSecVal').textContent = fullConfig.prankWallpaperSec ?? 30;
  updatePrankLabels(pet, fullConfig);
  toggleAiRows();
  toggleVoxGpuBox();
  refreshVoxGpuStatus();
  $('showSettingsOnStart').checked = fullConfig.showSettingsOnStart;
  $('launchOnStartup').checked = !!fullConfig.launchOnStartup;
  $('idleChatter').checked = pet.idleChatter !== false;
  $('grabButton').value = pet.grabButton === 'left' ? 'left' : 'right';
  $('ownerName').value = pet.ownerName || '';
  $('aiPersonality').value = pet.aiPersonality || '';
  $('chaosCloseApps').checked = !!pet.chaosCloseApps;
  $('chaosCloseChance').value = pet.chaosCloseChance ?? 0.12;
  $('useCustomAvatar').checked = !!pet.useCustomAvatar;
  $('invertSpriteFacing').checked = pet.invertSpriteFacing !== false;
  $('attackAnimMs').value = pet.attackAnimMs ?? 800;
  $('headHitTop').value = pet.headHitTop ?? 8;
  $('headHitLeft').value = pet.headHitLeft ?? 0;
  $('headHitWidth').value = pet.headHitWidth ?? 70;
  $('headHitHeight').value = pet.headHitHeight ?? 55;
  $('showHeadHitbox').checked = !!pet.showHeadHitbox;
  $('idleSmallWalkEnabled').checked = pet.idleSmallWalkEnabled !== false;
  $('idleSleepEnabled').checked = pet.idleSleepEnabled !== false;
  $('idleSitEnabled').checked = pet.idleSitEnabled !== false;
  $('idleVarietyChance').value = pet.idleVarietyChance ?? 0.35;
  $('smallWalkMinSec').value = pet.smallWalkMinSec ?? 8;
  $('smallWalkMaxSec').value = pet.smallWalkMaxSec ?? 22;
  $('textIdle').value = pet.textIdle || '';
  $('textProactive').value = pet.textProactive || '';
  $('proactiveChatter').checked = pet.proactiveChatter !== false;
  $('textGrab').value = pet.textGrab || '';
  $('textGrabRelease').value = pet.textGrabRelease || '';
  $('textAttack').value = pet.textAttack || '';
  $('textPet').value = pet.textPet || '';
  $('textWalkStart').value = pet.textWalkStart || '';
  $('textWalkEnd').value = pet.textWalkEnd || '';
  $('textSleep').value = pet.textSleep || '';
  $('textSit').value = pet.textSit || '';
  $('textDance').value = pet.textDance || '';
  $('textChaosClose').value = pet.textChaosClose || '';
  $('textSocial').value = pet.textSocial || '';
  $('textBump').value = pet.textBump || '';
  $('textTagChase').value = pet.textTagChase || pet.textTag || '';
  $('textTagGotcha').value = pet.textTagGotcha || '';
  $('textWatch').value = pet.textWatch || '';
  $('textGame').value = pet.textGame || '';
  $('textGameFail').value = pet.textGameFail || '';
  $('textVictory').value = pet.textVictory || '';
  $('textGift').value = pet.textGift || '';
  $('textGiftThanks').value = pet.textGiftThanks || '';
  $('voiceVoxEnabled').checked = !!pet.voiceVoxEnabled;
  $('voiceVoxBackend').value = pet.voiceVoxBackend === 'builtin' ? 'builtin' : 'external';
  toggleVoxBuiltinBox();
  refreshVoxCoreStatus();
  $('voiceVoxUrl').value = pet.voiceVoxUrl || 'http://127.0.0.1:50021';
  setVoxSpeakerOptions(pet.voiceVoxSpeaker ?? 1);
  $('voiceVoxSpeed').value = pet.voiceVoxSpeed ?? 1.0;
  $('voiceVoxSpeedVal').textContent = Number(pet.voiceVoxSpeed ?? 1.0).toFixed(1);
  $('voiceVoxVolume').value = pet.voiceVoxVolume ?? 100;
  $('voiceVoxVolumeVal').textContent = pet.voiceVoxVolume ?? 100;
  $('voiceVoxIdleOnly').checked = !!pet.voiceVoxIdleOnly;
  $('voiceVoxReactions').checked = pet.voiceVoxReactions !== false;
  $('gameVictoryPatterns').value = fullConfig.gameVictoryPatterns || '';
  $('speechSoundEnabled').checked = !!pet.speechSoundEnabled;
  $('speechSoundIdleOnly').checked = !!pet.speechSoundIdleOnly;
  $('speechSoundVolume').value = pet.speechSoundVolume ?? 70;
  $('speechSoundLabel').textContent = pet.speechSound
    ? `Sound file: ${pet.speechSound}`
    : 'No sound file selected';
  $('contextReactionsEnabled').checked = pet.contextReactionsEnabled !== false;
  $('contextReactionCooldownSec').value = pet.contextReactionCooldownSec ?? 45;
  $('musicDanceEnabled').checked = !!pet.musicDanceEnabled;
  $('musicThreshold').value = pet.musicThreshold ?? 35;
  $('speechTop').value = pet.speechTop ?? 8;
  $('speechLeft').value = pet.speechLeft ?? 0;
  $('speechMaxWidth').value = pet.speechMaxWidth ?? 180;
  $('speechZoneHeight').value = pet.speechZoneHeight ?? 72;
  $('speechHitWidth').value = pet.speechHitWidth ?? pet.speechMaxWidth ?? 180;
  $('speechHitHeight').value = pet.speechHitHeight ?? 56;
  $('speechBgColor').value = pet.speechBgColor || '#ffffff';
  $('speechTextColor').value = pet.speechTextColor || '#2d3436';
  $('speechBorderColor').value = pet.speechBorderColor || '#ff8fab';
  $('speechFontSize').value = pet.speechFontSize ?? 13;
  $('speechAlign').value = ['left', 'center', 'right'].includes(pet.speechAlign) ? pet.speechAlign : 'center';
  $('showSpeechZone').checked = !!pet.showSpeechZone;
  $('bodyHitTop').value = pet.bodyHitTop ?? 0;
  $('bodyHitLeft').value = pet.bodyHitLeft ?? 0;
  $('bodyHitWidth').value = pet.bodyHitWidth ?? 110;
  $('bodyHitHeight').value = pet.bodyHitHeight ?? 200;
  $('showBodyHitbox').checked = !!pet.showBodyHitbox;
  updateThresholdLine();
  updatePowerUI(!!fullConfig.petEnabled);
  updateLabels();
  updateSpeechSoundLabels(pet);
  updateAvatarPreviews(pet);
  const packSel = $('characterPack');
  if (packSel && pet.characterPack && [...packSel.options].some((o) => o.value === pet.characterPack)) {
    packSel.value = pet.characterPack;
  }
  renderPetList();
  toggleAttackFields();
  toggleChaosFields();
}

function wanderDurationMs(c) {
  const n = Math.max(1, c.wanderDuration || 30);
  return c.wanderDurationUnit === 'min' ? n * 60 * 1000 : n * 1000;
}

function formatRemaining(ms) {
  const sec = Math.ceil(ms / 1000);
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${sec}s`;
}

function updateLabels() {
  $('scaleVal').textContent = parseFloat($('scale').value).toFixed(1);
  $('moveSpeedVal').textContent = $('moveSpeed').value;
  $('aggressionVal').textContent = Math.round(parseFloat($('aggression').value) * 100);
  $('attackAnimMsVal').textContent = $('attackAnimMs').value;
  $('headHitTopVal').textContent = $('headHitTop').value;
  $('headHitLeftVal').textContent = $('headHitLeft').value;
  $('headHitWidthVal').textContent = $('headHitWidth').value;
  $('headHitHeightVal').textContent = $('headHitHeight').value;
  $('musicThresholdVal').textContent = $('musicThreshold').value;
  $('speechTopVal').textContent = $('speechTop').value;
  $('speechLeftVal').textContent = $('speechLeft').value;
  $('speechMaxWidthVal').textContent = $('speechMaxWidth').value;
  $('speechZoneHeightVal').textContent = $('speechZoneHeight').value;
  $('speechHitWidthVal').textContent = $('speechHitWidth').value;
  $('speechHitHeightVal').textContent = $('speechHitHeight').value;
  $('speechFontSizeVal').textContent = $('speechFontSize').value;
  $('speechSoundVolumeVal').textContent = $('speechSoundVolume').value;
  $('contextReactionCooldownSecVal').textContent = $('contextReactionCooldownSec').value;
  $('bodyHitTopVal').textContent = $('bodyHitTop').value;
  $('bodyHitLeftVal').textContent = $('bodyHitLeft').value;
  $('bodyHitWidthVal').textContent = $('bodyHitWidth').value;
  $('bodyHitHeightVal').textContent = $('bodyHitHeight').value;
  $('idleVarietyChanceVal').textContent = Math.round(parseFloat($('idleVarietyChance').value) * 100);
  $('smallWalkMinSecVal').textContent = $('smallWalkMinSec').value;
  $('smallWalkMaxSecVal').textContent = $('smallWalkMaxSec').value;
  $('chaosCloseChanceVal').textContent = Math.round(parseFloat($('chaosCloseChance').value) * 100);
  $('petCollisionGapVal').textContent = $('petCollisionGap').value;
  updateThresholdLine();
}

function toggleAttackFields() {
  const on = $('attackEnabled').checked;
  document.querySelectorAll('.attack-only').forEach((el) => {
    el.classList.toggle('disabled', !on);
  });
}

function toggleChaosFields() {
  const on = $('chaosCloseApps').checked;
  document.querySelectorAll('.chaos-only').forEach((el) => {
    el.classList.toggle('disabled', !on);
  });
  $('testChaosClose').disabled = false;
}

let saveTimer = null;
function queueSave(ms = 350) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    window.petAPI.saveConfig(readForm()).catch(() => {});
  }, ms);
}

function setStatus(msg, ms = 2500) {
  $('status').textContent = msg;
  setTimeout(() => { $('status').textContent = ''; }, ms);
}

function setContextTestResult(html, kind = '') {
  const el = $('contextTestResult');
  if (!el) return;
  el.innerHTML = html;
  el.classList.remove('hit', 'miss');
  if (kind) el.classList.add(kind);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function updateWanderUI(status) {
  const el = $('wanderStatus');
  const btn = $('startWander');
  if (status.active && status.remainingMs > 0) {
    el.textContent = `Walking — ${formatRemaining(status.remainingMs)} left`;
    el.classList.add('active');
    btn.disabled = true;
    btn.textContent = 'Walking...';
  } else {
    el.textContent = 'Not walking (pet is resting)';
    el.classList.remove('active');
    btn.disabled = false;
    btn.textContent = 'Start random walk';
  }
}

async function waitForPetAPI(maxWaitMs = 8000) {
  const start = Date.now();
  while (!window.petAPI && Date.now() - start < maxWaitMs) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return window.petAPI;
}

async function init() {
  const api = await waitForPetAPI();
  if (!api) {
    const msg = document.getElementById('status');
    if (msg) {
      msg.textContent =
        'Not running inside the app. Double-click "Start Virtual Pet.bat" or "Virtual Pet.exe" in the project folder — do not open this HTML file in a browser.';
      msg.style.color = '#d63031';
    }
    return;
  }

  let config = await api.getConfig();
  console.log('[settings] init: config loaded');
  try {
    fillForm(config);
  } catch (e) {
    console.error('[settings] fillForm failed', e);
    setStatus('Startup failed: ' + (e && e.message ? e.message : e), 60000);
    throw e;
  }
  console.log('[settings] init: form filled');
  const active = getActivePet(config);
  setupSettingsNav();
  console.log('[settings] init: nav ready');
  setupThemePicker();
  setupTutorial();
  setupSpeechSoundRows();
  updateSpeechSoundLabels(getActivePet());

  $('winMin')?.addEventListener('click', () => window.petAPI.windowMin?.());
  $('winMax')?.addEventListener('click', () => window.petAPI.windowMaxToggle?.());
  $('winClose')?.addEventListener('click', () => window.petAPI.windowClose?.());
  document.querySelector('.titlebar')?.addEventListener('dblclick', (e) => {
    if (e.target.closest('button')) return;
    window.petAPI.windowMaxToggle?.();
  });

  window.petAPI.onConfigUpdated((c) => {
    fillForm(c);
  });

  $('remoteEnabled')?.addEventListener('change', async () => {
    if ($('remoteEnabled').checked && !$('remoteToken').value.trim()) {
      $('remoteToken').value = newRemoteToken();
    }
    await window.petAPI.saveConfig(readForm());
    updateRemoteStatus(readForm());
  });

  $('regenRemoteToken')?.addEventListener('click', async () => {
    $('remoteToken').value = newRemoteToken();
    await window.petAPI.saveConfig(readForm());
    setStatus('New remote token set — re-pair the phone.');
  });

  $('ocrPowerBtn')?.addEventListener('click', async () => {
    const next = !$('ocrPowerBtn').classList.contains('on');
    updateOcrPowerUI(next);
    try { window.petAPI.ocrManual?.(); } catch (_) {}
    await window.petAPI.saveConfig(readForm());
    setStatus(next ? 'Screen watch ON — scanning continuously.' : 'Screen watch OFF.');
  });

  $('refreshBonds')?.addEventListener('click', async () => {
    try {
      const latest = await window.petAPI.getConfig();
      renderBonds(latest);
    } catch (_) {}
  });

  $('testProcessWatch')?.addEventListener('click', async () => {
    await window.petAPI.saveConfig(readForm());
    const el = $('processWatchStatus');
    if (el) el.textContent = 'Scanning running programs…';
    const result = await window.petAPI.testProcessWatch();
    if (el) {
      if (!result?.ok) {
        el.textContent = 'Process scan unavailable on this PC.';
      } else if (result.matches?.length) {
        el.textContent = `Detected game: ${result.matches.join(', ')}`;
      } else {
        el.textContent = 'No known game running. Launch a game and test again — or add its .exe above.';
      }
    }
  });

  function toggleAiRows() {
    const ollama = $('aiProvider')?.value === 'ollama';
    const customRows = [$('aiEndpoint'), $('aiKey'), $('aiModel')].map((el) => el?.closest('.speech-field')).filter(Boolean);
    customRows.forEach((row) => { row.style.display = ollama ? 'none' : ''; });
    const ollamaRow = $('ollamaModelRow');
    if (ollamaRow) ollamaRow.style.display = ollama ? '' : 'none';
  }

  $('aiProvider')?.addEventListener('change', async () => {
    toggleAiRows();
    await window.petAPI.saveConfig(readForm());
    refreshAiOnline(true);
  });

  const aiGraphHist = [];
  function renderAiGraph() {
    const box = $('aiGraph');
    if (!box) return;
    box.innerHTML = '';
    const pts = aiGraphHist.slice(-20);
    if (!pts.length) {
      const hint = document.createElement('span');
      hint.className = 'meter-hint';
      hint.textContent = 'No checks yet.';
      box.appendChild(hint);
      return;
    }
    const maxMs = Math.max(500, ...pts.map((p) => p.ms || 0));
    for (const p of pts) {
      const bar = document.createElement('div');
      bar.className = 'ai-bar ' + (p.state === 'online' ? 'on' : (p.state === 'off' || p.state === 'no-key') ? 'idle' : 'off');
      bar.style.height = `${Math.max(10, Math.round(((p.ms || 0) / maxMs) * 100))}%`;
      bar.title = `${p.state}${p.ms != null ? ` ${p.ms}ms` : ''}${p.via ? ` via ${p.via}` : ''}`;
      box.appendChild(bar);
    }
    const on = pts.filter((p) => p.state === 'online');
    const avg = on.length ? Math.round(on.reduce((a, p) => a + (p.ms || 0), 0) / on.length) : null;
    const label = $('aiGraphLabel');
    if (label) label.textContent = `${pts.length} checks · ${on.length} online${avg != null ? ` · avg ${avg}ms` : ''}`;
  }

  async function refreshAiOnline(silent) {
    const el = $('aiOnline');
    if (!el) return;
    let st = null;
    try {
      st = await window.petAPI.aiStatus();
    } catch (_) {}
    aiGraphHist.push({ state: (st && st.state) || 'unknown', ms: (st && st.ms) ?? null, via: (st && st.via) || '' });
    if (aiGraphHist.length > 20) aiGraphHist.shift();
    renderAiGraph();
    if (!st) {
      if (!silent) el.textContent = 'API: unknown';
      return;
    }
    if (st.state === 'off') el.textContent = 'API: off (enable above to use AI)';
    else if (st.state === 'no-key') el.textContent = 'API: no key saved';
    else if (st.state === 'online') {
      el.textContent = `API: ● online${st.via ? ` via ${st.via}` : ''}${st.ms != null ? ` (${st.ms}ms)` : ''}`;
    } else el.textContent = `API: ○ offline${st.error ? ` (${st.error})` : ''} — she'll use her offline brain`;
  }

  $('checkAi')?.addEventListener('click', async () => {
    const el = $('aiOnline');
    if (el) el.textContent = 'API: checking…';
    await refreshAiOnline();
  });

  refreshAiOnline(true);
  setInterval(() => {
    try {
      refreshAiOnline(true);
    } catch (_) {}
  }, 15000);

  $('testAi')?.addEventListener('click', async () => {
    const el = $('aiStatus');
    await window.petAPI.saveConfig(readForm());
    if (el) el.textContent = 'Asking AI…';
    const result = await window.petAPI.aiChat([{ role: 'user', content: 'Reply with exactly: AI online!' }]);
    if (el) {
      const via = result?.via ? ` (via ${result.via === 'ollama' ? 'Ollama' : 'API'})` : '';
      const fellBack = result?.fallbackUsed ? ' — primary failed, this is the fallback!' : '';
      el.textContent = result?.ok
        ? `AI replied${via}${fellBack}: ${(result.text || '').slice(0, 120)}`
        : `AI failed (${result?.error || 'unknown'}${result?.detail ? ': ' + result.detail : ''}). Check key, model, internet.`;
    }
    refreshAiOnline(true);
  });

  ['aiEnabled', 'aiFallback'].forEach((id) => {
    $(id)?.addEventListener('change', async () => {
      await window.petAPI.saveConfig(readForm());
      refreshAiOnline(true);
    });
  });

  $('testOcrScan')?.addEventListener('click', async () => {
    const el = $('ocrStatus');
    if (el) el.textContent = 'Scanning screen… (takes a few seconds)';
    const result = await window.petAPI.testOcrScan();
    if (el) {
      if (result?.ok) {
        const preview = (result.text || '').slice(0, 160);
        el.textContent = preview ? `Screen reads: ${preview}` : 'Scan worked but no text found on screen.';
      } else {
        el.textContent =
          result?.error === 'ocr-unavailable'
            ? 'Windows OCR is unavailable (missing language pack). Screen watch will not work here.'
            : 'Screen scan failed on this PC.';
      }
    }
  });

  window.petAPI.onOcrStatus?.((data) => {
    const el = $('ocrStatus');
    if (!el || !data) return;
    if (data.disabled) {
      el.textContent = data.message || 'Screen watch turned itself off.';
    } else if (data.attempt) {
      el.textContent = `Scan hiccup (${data.attempt}/${data.of || '?'}): ${data.error || 'unknown'} — retrying…`;
    } else if (data.message) {
      el.textContent = data.message;
    }
    renderOcrLog();
  });

  $('refreshOcrLog')?.addEventListener('click', renderOcrLog);

  ['gameProcessWatchEnabled', 'gameOcrAuto', 'gameOcrDebugEdges', 'gameOcrRegion', 'petIndividualEnabled'].forEach((id) => {
    $(id)?.addEventListener('change', async () => {
      await window.petAPI.saveConfig(readForm());
    });
  });

  $('addPet')?.addEventListener('click', async () => {
    await window.petAPI.saveConfig(readForm());
    const next = await window.petAPI.addPet();
    fillForm(next);
    setStatus('New pet added!');
  });

  await loadCharacterPacks();

  $('characterPack')?.addEventListener('change', async () => {
    const name = $('characterPack').value;
    if (!name || name === 'custom') {
      await window.petAPI.saveConfig(readForm());
      return;
    }
    await window.petAPI.saveConfig(readForm());
    config = await window.petAPI.applyCharacterPack(name, cachedConfig.activePetId);
    fillForm(config);
    setStatus(`Dressed her in “${name}”!`);
  });

  $('openPacksFolder')?.addEventListener('click', async () => {
    await window.petAPI.openCharacterPacksFolder();
    setStatus('Drop a character folder in, then change the pack dropdown to refresh.');
    await loadCharacterPacks();
  });

  $('savePackBtn')?.addEventListener('click', async () => {
    const name = ($('newPackName')?.value || '').trim();
    if (!name) {
      setStatus('Name her first, then save.');
      return;
    }
    await window.petAPI.saveConfig(readForm());
    const result = await window.petAPI.saveCharacterPack(name, cachedConfig.activePetId);
    if (result?.ok) {
      $('newPackName').value = '';
      await loadCharacterPacks();
      setStatus(`Saved “${name}” as a character!`);
    } else if (result?.error === 'exists') {
      setStatus('That name is taken — pick another.');
    } else if (result?.error === 'empty') {
      setStatus('Nothing to save — give her some art first.');
    } else {
      setStatus('Could not save character. Use letters, numbers, spaces.');
    }
  });

  $('openCharacterSelect')?.addEventListener('click', () => {
    openCharacterSelect();
  });

  // Backdrop click + Escape always dismiss the overlay so it can never
  // trap clicks even if something above fails partway.
  $('characterSelectOverlay')?.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'characterSelectOverlay') closeCharacterSelect();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCharacterSelect();
  });

  $('characterSelectClose')?.addEventListener('click', () => {
    closeCharacterSelect();
  });

  $('characterSelectCustom')?.addEventListener('click', () => {
    closeCharacterSelect();
    showSettingsPanel('panel-character');
  });

  // NOTE: no auto-popup — the overlay only opens from buttons/tutorial so it
  // can never trap clicks on launch.

  let collapsedSlots = {};
  try {
    collapsedSlots = JSON.parse(localStorage.getItem('vp-slot-collapsed') || '{}');
  } catch (_) {
    collapsedSlots = {};
  }
  const saveCollapsed = () => {
    try {
      localStorage.setItem('vp-slot-collapsed', JSON.stringify(collapsedSlots));
    } catch (_) {}
  };
  document.querySelectorAll('.gif-slot').forEach((slotEl) => {
    const slot = slotEl.dataset.slot;
    const head = slotEl.querySelector('.gif-slot-head');
    if (head && !head.querySelector('.slot-arrow')) {
      const arrow = document.createElement('span');
      arrow.className = 'slot-arrow';
      arrow.textContent = '▼';
      head.prepend(arrow);
      head.addEventListener('click', () => {
        const collapsed = slotEl.classList.toggle('collapsed');
        collapsedSlots[slot] = !!collapsed;
        saveCollapsed();
      });
    }
    if (collapsedSlots[slot]) slotEl.classList.add('collapsed');
    slotEl.querySelector('.btn-pick-gif').addEventListener('click', async () => {
      const before = asAvatarSlot(getActivePet()[SLOT_CONFIG_KEY[slot]]).files.length;
      if (before >= 16) {
        setStatus(`“${slot}” already has 16 variants — remove one first.`);
        return;
      }
      config = await window.petAPI.pickAvatarGif(slot, cachedConfig.activePetId);
      fillForm(config);
      const after = asAvatarSlot(getActivePet(config)[SLOT_CONFIG_KEY[slot]]).files.length;
      setStatus(after > before ? `Added “${slot}” variant #${after}.` : `Could not add — slot may be full (16 max). Remove one first.`);
    });
    slotEl.querySelector('.btn-clear-gif').addEventListener('click', async () => {
      if (slot === 'idle') {
        setStatus('Idle animation is required — pick a replacement instead of clearing it.');
        return;
      }
      config = await window.petAPI.clearAvatarGif(slot, cachedConfig.activePetId);
      fillForm(config);
      setStatus(`Cleared ${slot} animation.`);
    });
  });

  $('pickSpeechSound')?.addEventListener('click', async () => {
    await window.petAPI.saveConfig(readForm());
    config = await window.petAPI.pickSpeechSound('all', cachedConfig.activePetId);
    fillForm(config);
    setStatus(getActivePet(config).speechSound ? 'Speech sound loaded.' : 'No file chosen.');
  });

  $('clearSpeechSound')?.addEventListener('click', async () => {
    await window.petAPI.saveConfig(readForm());
    config = await window.petAPI.clearSpeechSound('all', cachedConfig.activePetId);
    fillForm(config);
    setStatus('Speech sound cleared.');
  });

  $('testSpeechSound')?.addEventListener('click', () => {
    const pet = getActivePet();
    if (!pet.soundUrl) {
      setStatus('Choose a sound file first.');
      return;
    }
    try {
      const a = new Audio(pet.soundUrl);
      a.volume = (pet.speechSoundVolume ?? 70) / 100;
      a.play().catch(() => setStatus('Could not play sound.'));
    } catch (_) {
      setStatus('Could not play sound.');
    }
  });

  [
    'scale', 'moveSpeed', 'aggression', 'attackAnimMs',
    'headHitTop', 'headHitLeft', 'headHitWidth', 'headHitHeight',
    'musicThreshold', 'speechTop', 'speechLeft', 'speechMaxWidth', 'speechZoneHeight', 'speechFontSize',
    'speechHitWidth', 'speechHitHeight', 'speechSoundVolume',
    'bodyHitTop', 'bodyHitLeft', 'bodyHitWidth', 'bodyHitHeight',
    'idleVarietyChance', 'smallWalkMinSec', 'smallWalkMaxSec', 'chaosCloseChance', 'petCollisionGap',
    'contextReactionCooldownSec',
  ].forEach((id) => {
    $(id).addEventListener('input', async () => {
      updateLabels();
      if (id.startsWith('speech') || id.startsWith('bodyHit') || id === 'petCollisionGap' || id === 'showSpeechZone' || id === 'showBodyHitbox') {
        queueSave();
      }
    });
  });

  $('voiceVoxBackend')?.addEventListener('change', async () => {
    toggleVoxBuiltinBox();
    refreshVoxCoreStatus();
    await window.petAPI.saveConfig(readForm());
  });

  $('voiceDevice')?.addEventListener('change', async () => {
    toggleVoxGpuBox();
    refreshVoxGpuStatus();
    await window.petAPI.saveConfig(readForm());
  });

  $('downloadVoxGpu')?.addEventListener('click', async () => {
    const el = $('voxGpuStatus');
    await window.petAPI.saveConfig(readForm());
    if (el) el.textContent = 'Downloading GPU pack (~30MB)…';
    const result = await window.petAPI.voxGpuDownload();
    if (el) {
      el.textContent = result?.ok
        ? 'GPU pack ready! Voices will use your GPU.'
        : `Download failed: ${(result && result.error) || 'unknown error'}. Check internet and retry.`;
    }
    refreshVoxGpuStatus();
  });

  $('cancelVoxGpu')?.addEventListener('click', async () => {
    await window.petAPI.voxGpuCancel();
  });

  $('downloadVoxCore')?.addEventListener('click', async () => {
    const el = $('voxCoreStatus');
    if (voxBusy) {
      if (el) el.textContent = 'A download is already in progress…';
      return;
    }
    if (!$('voxAgreeTerms')?.checked) {
      if (el) el.textContent = 'Please agree to the terms first (checkbox above).';
      return;
    }
    voxBusy = true;
    await window.petAPI.saveConfig(readForm());
    setVoxProgress(3);
    if (el) el.textContent = 'Starting download… (~180MB, a few minutes). You can keep using settings meanwhile.';
    const result = await window.petAPI.voxCoreDownload();
    voxBusy = false;
    if (result?.ok) {
      if (el) el.textContent = 'Built-in voice ready! Loading voices…';
      setVoxProgress(100);
      await doRefreshVoxSpeakers();
    } else if (el) {
      el.textContent = result?.error === 'cancelled' ? 'Download cancelled.' : `Download failed: ${result?.error || 'unknown error'}. Check internet and retry.`;
    }
    refreshVoxCoreStatus();
  });

  $('cancelVoxCore')?.addEventListener('click', async () => {
    await window.petAPI.voxCoreCancel();
  });

  window.petAPI.onVoxCoreProgress?.((ev) => {
    const el = $('voxCoreStatus');
    if (ev?.percent != null) setVoxProgress(ev.percent);
    if (el && ev?.message) el.textContent = ev.message;
  });

  ['showHeadHitbox', 'showSpeechZone', 'showBodyHitbox', 'contextReactionsEnabled', 'speechSoundEnabled', 'speechSoundIdleOnly', 'voiceVoxEnabled', 'voiceVoxIdleOnly', 'voiceVoxReactions'].forEach((id) => {
    $(id)?.addEventListener('change', async () => {
      await window.petAPI.saveConfig(readForm());
    });
  });

  $('voiceVoxSpeed')?.addEventListener('input', async () => {
    $('voiceVoxSpeedVal').textContent = Number($('voiceVoxSpeed').value).toFixed(1);
    queueSave();
  });

  $('voiceVoxVolume')?.addEventListener('input', async () => {
    $('voiceVoxVolumeVal').textContent = $('voiceVoxVolume').value;
    queueSave();
  });

  $('gameOcrIntervalSec')?.addEventListener('input', async () => {
    $('gameOcrIntervalSecVal').textContent = $('gameOcrIntervalSec').value;
    queueSave();
  });

  $('gameOcrQuality')?.addEventListener('change', async () => {
    await window.petAPI.saveConfig(readForm());
  });

  $('refreshVoxSpeakers')?.addEventListener('click', doRefreshVoxSpeakers);

  $('testVoxVoice')?.addEventListener('click', async () => {
    const el = $('voxStatus');
    await window.petAPI.saveConfig(readForm());
    const backend = getActivePet().voiceVoxBackend === 'builtin' ? 'built-in' : 'external';
    if (el) el.textContent = `Synthesizing via ${backend}…`;
    const t0 = Date.now();
    const result = await window.petAPI.speakText(`Hello! I'm ${getActivePet().name || 'your pet'}!`);
    const ms = Date.now() - t0;
    if (el) {
      if (result?.ok) {
        el.textContent = `Playing test voice (${result.gpuActive ? 'built-in GPU' : backend}, ${ms}ms)…`;
        try {
          const a = new Audio(result.url);
          a.volume = Math.max(0, Math.min(1, (parseInt($('voiceVoxVolume').value, 10) || 100) / 100));
          a.play().catch(() => { if (el) el.textContent = 'Synthesized but could not play.'; });
        } catch (_) {
          el.textContent = 'Synthesized but could not play.';
        }
      } else {
        el.textContent = `Voice failed (${backend}): ${result?.error || 'unknown'}. External: launch VOICEVOX. Built-in: download it above.`;
      }
    }
  });

  ['speechBgColor', 'speechTextColor', 'speechBorderColor'].forEach((id) => {
    $(id).addEventListener('input', async () => {
      queueSave();
    });
  });

  $('speechAlign')?.addEventListener('change', async () => {
    await window.petAPI.saveConfig(readForm());
  });

  let thresholdSaveTimer = null;
  $('musicThreshold').addEventListener('input', () => {
    $('musicThresholdVal').textContent = $('musicThreshold').value;
    updateThresholdLine();
    clearTimeout(thresholdSaveTimer);
    thresholdSaveTimer = setTimeout(() => {
      window.petAPI.saveConfig(readForm());
    }, 400);
  });

  window.addEventListener('resize', () => updateThresholdLine());

  $('connectSystemAudio').addEventListener('click', () => connectSystemAudio());

  $('musicDanceEnabled').addEventListener('change', async () => {
    await window.petAPI.saveConfig(readForm());
    if ($('musicDanceEnabled').checked && !systemAudioConnected) {
      setStatus('Click "Connect system audio" — Windows will ask to share screen + audio.');
    }
    if (!$('musicDanceEnabled').checked) stopSystemAudioCapture();
  });

  window.petAPI.onAudioLevel(updateAudioMeter);

  $('attackEnabled').addEventListener('change', toggleAttackFields);
  $('chaosCloseApps').addEventListener('change', toggleChaosFields);

  $('testChaosClose').addEventListener('click', async () => {
    const ok = window.confirm(
      'This will close ONE random open program window (not Virtual Pet).\n\nSave your work first. Continue?'
    );
    if (!ok) return;
    await window.petAPI.saveConfig(readForm());
    const result = await window.petAPI.testCloseRandomApp();
    if (result?.ok) {
      setStatus(`Closed "${result.windowTitle || 'a window'}". Pet should say sorry~`);
    } else if (result?.reason === 'not-windows') {
      setStatus('Chaos close only works on Windows.');
    } else if (result?.reason === 'no-candidates') {
      setStatus('No suitable window found. Open another app (e.g. Notepad) and try again.');
    } else {
      setStatus(`Could not close a window${result?.detail ? `: ${result.detail}` : ''}.`);
    }
  });

  $('prankWallpaperSec')?.addEventListener('input', () => {
    $('prankWallpaperSecVal').textContent = $('prankWallpaperSec').value;
    queueSave();
  });

  ['prankChanceGlitch', 'prankChanceBlackout', 'prankChanceBsod', 'prankChanceJumpscare', 'prankChanceWallpaper', 'prankChanceRealShutdown', 'prankChanceFakeShutdown'].forEach((id) => {
    $(id)?.addEventListener('input', () => {
      $(id + 'Val').textContent = $(id).value;
      queueSave();
    });
  });

  $('pickPrankImage')?.addEventListener('click', async () => {
    await window.petAPI.saveConfig(readForm());
    const next = await window.petAPI.pickPrankImage('image');
    fillForm(next);
    const saved = next?.pets?.find((p) => p.id === next?.activePetId)?.prankImage;
    setStatus(saved ? `Jumpscare image set: ${saved}` : 'No image chosen.');
  });

  $('pickPrankWallpaper')?.addEventListener('click', async () => {
    await window.petAPI.saveConfig(readForm());
    const next = await window.petAPI.pickPrankImage('wallpaper');
    fillForm(next);
    setStatus(next?.prankWallpaperImage ? `Wallpaper image set: ${next.prankWallpaperImage}` : 'No image chosen.');
  });

  const prankTests = [
    ['testPrankGlitch', 'glitch'],
    ['testPrankBlackout', 'blackout'],
    ['testPrankBsod', 'bsod'],
    ['testPrankJumpscare', 'jumpscare'],
    ['testPrankWallpaper', 'wallpaper'],
    ['testPrankFakeShutdown', 'fakeShutdown'],
  ];
  for (const [btnId, effect] of prankTests) {
    $(btnId)?.addEventListener('click', async () => {
      const el = $('prankStatus');
      await window.petAPI.saveConfig(readForm());
      if (el) el.textContent = `Testing ${effect}… (ESC stops overlay pranks)`;
      const result = await window.petAPI.prankTest(effect);
      if (el) {
        el.textContent = result?.ok
          ? `${effect} done 😈`
          : `Could not run ${effect} (${result?.reason || 'unknown'}).`;
      }
    });
  }

  $('prankNow')?.addEventListener('click', async () => {
    const ok = window.confirm('Unleash the selected pranks NOW?\n\nAll fake and reversible. The wallpaper restores itself.');
    if (!ok) return;
    await window.petAPI.saveConfig(readForm());
    const el = $('prankStatus');
    if (el) el.textContent = 'Pranking… 😈';
    const result = await window.petAPI.prankNow();
    if (el) {
      el.textContent = result?.ok
        ? (result?.warning ? `Pranked, with skips: ${result.warning} 😈` : 'Pranked! 😈')
        : `Prank failed (${result?.error || 'unknown'}).`;
    }
  });

  window.petAPI.onWanderSessionStatus(updateWanderUI);
  window.petAPI.onPetPowerChanged(updatePowerUI);

  $('petPowerBtn').addEventListener('click', async () => {
    const next = !$('petPowerBtn').classList.contains('on');
    await window.petAPI.setPetEnabled(next);
    updatePowerUI(next);
    setStatus(next ? 'Pet is ON!' : 'Pet is OFF (hidden).');
  });

  $('launchOnStartup').addEventListener('change', async () => {
    const c = readForm();
    await window.petAPI.saveConfig(c);
    setStatus(c.launchOnStartup ? 'Will start with Windows (pet stays OFF until you turn it on).' : 'Removed from Windows startup.');
  });

  $('exitApp').addEventListener('click', () => {
    window.petAPI.quitApp();
  });

  $('testTag')?.addEventListener('click', async () => {
    const c = readForm();
    if (!c.petEnabled) {
      setStatus('Turn pets ON first.');
      return;
    }
    await window.petAPI.saveConfig(c);
    const result = await window.petAPI.testTagSession();
    if (result?.ok) {
      setStatus('Tag game started! Active pet is the tagger.');
    } else {
      setStatus(result?.message || 'Could not start tag.');
    }
  });

  $('testGift')?.addEventListener('click', async () => {
    const c = readForm();
    if (!c.petEnabled) {
      setStatus('Turn pets ON first.');
      return;
    }
    await window.petAPI.saveConfig(c);
    const result = await window.petAPI.testGift();
    if (result?.ok) {
      setStatus('Gift sent! Watch the active pet give it to the other pet.');
    } else {
      setStatus(result?.message || 'Could not send gift.');
    }
  });

  $('testContextReaction')?.addEventListener('click', async () => {
    const btn = $('testContextReaction');
    setContextTestResult('');
    await window.petAPI.saveConfig(readForm());

    for (let i = 3; i >= 1; i--) {
      btn.disabled = true;
      btn.textContent = `Switch to target app… ${i}`;
      setStatus(`Click YouTube or your game now — checking in ${i}…`, 1200);
      await sleep(1000);
    }

    btn.textContent = 'Checking…';
    const c = readForm();
    const result = await window.petAPI.testForegroundContext({
      triggerPet: c.petEnabled && c.contextReactionsEnabled !== false,
    });

    btn.disabled = false;
    btn.textContent = 'Test active window (3 sec)';

    if (!result?.ok) {
      setContextTestResult(result?.message || 'Test failed.', 'miss');
      setStatus(result?.message || 'Test failed.', 5000);
      return;
    }

    const titleShort = result.title.length > 80 ? `${result.title.slice(0, 77)}…` : result.title;
    const reactNote = result.wouldReact
      ? (c.petEnabled && c.contextReactionsEnabled !== false
        ? 'Pet should say a line now.'
        : 'Would react if pet is ON and reactions are enabled.')
      : 'Try a YouTube tab or a game window with a clearer title.';

    setContextTestResult(
      `<strong>${result.typeLabel}</strong><br>Window: “${titleShort.replace(/"/g, '&quot;')}”<br>${reactNote}`,
      result.wouldReact ? 'hit' : 'miss'
    );
    setStatus(result.message, 6000);
  });

  ['useCustomAvatar', 'invertSpriteFacing'].forEach((id) => {
    $(id)?.addEventListener('change', async () => {
      await window.petAPI.saveConfig(readForm());
    });
  });

  $('startWander').addEventListener('click', async () => {
    const c = readForm();
    if (!c.petEnabled) {
      setStatus('Turn the pet ON first.');
      return;
    }
    await window.petAPI.saveConfig(c);
    const pet = getActivePet(c);
    const ms = wanderDurationMs(pet);
    await window.petAPI.startWanderSession(ms);
    const label = pet.wanderDurationUnit === 'min'
      ? `${pet.wanderDuration} min`
      : `${pet.wanderDuration} sec`;
    setStatus(`Pet will walk randomly for ${label}.`);
  });

  $('save').addEventListener('click', async () => {
    const config = readForm();
    await window.petAPI.saveConfig(config);
    setStatus('Saved! Changes applied to your pet.');
  });

  $('resetDefaults')?.addEventListener('click', async () => {
    const ok = window.confirm(
      'Reset ALL settings to defaults?\n\nA backup of your current settings is saved first — you can undo with Restore backup.'
    );
    if (!ok) return;
    const backup = await window.petAPI.backupConfig();
    const backupName = backup ? String(backup).split(/[\\/]/).pop() : '';
    let base = null;
    try {
      base = await window.petAPI.getFactoryDefaults();
    } catch (_) {}
    const defaults = base && base.pets ? base : APP_DEFAULTS;
    fillForm(defaults);
    await window.petAPI.saveConfig(defaults);
    setStatus(
      backupName
        ? `Reset to defaults. Backup saved (${backupName}) — Restore backup undoes this.`
        : 'Reset to defaults.'
    );
  });

  $('restoreBackup')?.addEventListener('click', async () => {
    const result = await window.petAPI.restoreBackup();
    if (result?.ok) {
      const latest = await window.petAPI.getConfig();
      fillForm(latest);
      setStatus(`Restored from ${result.file}.`);
    } else {
      setStatus('No backup found yet. A backup is saved automatically before every reset.');
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init().catch((e) => setStatus(e.message)));
} else {
  init().catch((e) => setStatus(e.message));
}
