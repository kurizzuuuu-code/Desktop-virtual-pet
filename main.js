const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  shell,
  protocol,
  net,
  dialog,
  session,
  desktopCapturer,
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { exec, execFile } = require('child_process');
function compilePatterns(raw) {
  const lines = Array.isArray(raw)
    ? raw
    : String(raw || '')
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
  const compiled = [];
  for (const line of lines) {
    try {
      compiled.push({ source: line, regex: new RegExp(line, 'i') });
    } catch (_) {
      compiled.push({
        source: line,
        regex: new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      });
    }
  }
  return compiled;
}
const {
  tagAndSortSpeakers,
  isCoreInstalled,
  isGpuPackInstalled,
  downloadCore,
  downloadModel,
  downloadGpuPack,
  listInstalledModels,
  extraVoiceStatus,
  stopCoreWorker,
  coreSynth,
  coreSpeakers,
  coreInit,
  callWorker,
} = require('./voicevox-core');

app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function getScriptsDir() {
  if (!app.isPackaged) return path.join(__dirname, 'scripts');
  const unpacked = path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts');
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(__dirname, 'scripts');
}

const CONFIG_PATH = path.join(app.getPath('userData'), 'pet-config.json');
const AVATARS_DIR = path.join(app.getPath('userData'), 'avatars');

const AVATAR_SLOTS = ['idle', 'move', 'attack', 'pet', 'grab', 'dance', 'sleep', 'sit', 'victory', 'defeat', 'talk', 'greet', 'giftGive', 'giftReceive'];
const MAX_AVATAR_VARIANTS = 16;

// Avatar slots hold variant lists: { mode: 'shuffle'|'order'|'custom', files: [{file, next}] }
// where next is 'any' or an array of variant indexes. Legacy plain filenames migrate.
function asAvatarSlot(v) {
  if (v && typeof v === 'object' && Array.isArray(v.files)) {
    const files = v.files
      .filter((f) => f && f.file)
      .slice(0, MAX_AVATAR_VARIANTS)
      .map((f) => ({ file: f.file, next: f.next || 'any' }));
    return { mode: ['shuffle', 'order', 'custom'].includes(v.mode) ? v.mode : 'shuffle', files };
  }
  if (typeof v === 'string' && v) return { mode: 'shuffle', files: [{ file: v, next: 'any' }] };
  return { mode: 'shuffle', files: [] };
}
const SPEECH_SOUND_SLOTS = [
  'idle', 'grab', 'grabRelease', 'attack', 'pet',
  'walkStart', 'walkEnd', 'sleep', 'sit', 'dance',
  'chaosClose', 'social', 'bump', 'tagChase', 'tagGotcha',
  'watch', 'game', 'gameFail', 'victory', 'gift', 'giftThanks',
];
const AVATAR_CONFIG_KEYS = {
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pet-avatar',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);

function getPreloadPath() {
  return path.join(app.isPackaged ? app.getAppPath() : __dirname, 'preload.js');
}

function webPreferences() {
  return {
    preload: getPreloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,
  };
}

const PET_W = 220;
const PET_H = 520;

// Window size follows pet scale so big GIFs are never clipped by the window.
function petWindowSize(scale) {
  const s = Math.max(0.6, Math.min(2.5, Number(scale) || 1));
  const spriteW = 120 * s;
  return { w: Math.max(200, Math.ceil(spriteW + 60)), h: Math.ceil(200 + spriteW * 1.35) };
}

function getWorkArea() {
  const w = screen.getPrimaryDisplay().workArea;
  return { x: w.x, y: w.y, width: w.width, height: w.height };
}

function getPetCollisionGap() {
  return loadConfig().petCollisionGap ?? 20;
}

function getPetMinSeparation() {
  return PET_W + getPetCollisionGap();
}

function clampXToWorkArea(x, w = PET_W) {
  const work = getWorkArea();
  const margin = 8;
  return Math.max(work.x + margin, Math.min(work.x + work.width - w - margin, x));
}

function getPetBodyMetrics(petId) {
  const config = loadConfig();
  const pet = getPetEntry(config, petId);
  const entry = petWindows.get(petId);
  if (!entry?.window || entry.window.isDestroyed() || !entry.window.isVisible()) return null;
  const b = entry.window.getBounds();
  const halfW = (pet.bodyHitWidth ?? 110) / 2;
  const left = pet.bodyHitLeft ?? 0;
  return {
    x: b.x,
    y: b.y,
    halfW,
    left,
    centerX: b.x + b.width / 2 + left,
  };
}

function getCenterSeparation(petIdA, petIdB) {
  const a = getPetBodyMetrics(petIdA);
  const b = getPetBodyMetrics(petIdB);
  if (!a || !b) return getPetMinSeparation();
  return a.halfW + b.halfW + getPetCollisionGap();
}

function windowXFromCenter(pet, centerX) {
  return centerX - petWindowSize(pet.scale).w / 2 - (pet.bodyHitLeft ?? 0);
}

function resolvePetCollision(petId, x, y) {
  const config = loadConfig();
  const pet = getPetEntry(config, petId);
  const halfW = (pet.bodyHitWidth ?? 110) / 2;
  const winW = petWindowSize(pet.scale).w;
  let centerX = x + winW / 2 + (pet.bodyHitLeft ?? 0);

  for (const [otherId, entry] of petWindows) {
    if (otherId === petId || !entry.window || entry.window.isDestroyed() || !entry.window.isVisible()) {
      continue;
    }
    const otherPet = getPetEntry(config, otherId);
    const ob = entry.window.getBounds();
    const otherHalfW = (otherPet.bodyHitWidth ?? 110) / 2;
    const otherCenterX = ob.x + ob.width / 2 + (otherPet.bodyHitLeft ?? 0);
    const tagA = tagSessions.get(petId);
    const tagB = tagSessions.get(otherId);
    if (
      tagA?.partnerId === otherId &&
      tagB?.partnerId === petId &&
      Date.now() < tagA.until &&
      Date.now() < tagB.until
    ) {
      continue;
    }

    const minDist = halfW + otherHalfW + getPetCollisionGap();
    const dist = centerX - otherCenterX;
    if (Math.abs(dist) >= minDist) continue;

    centerX = dist <= 0 ? otherCenterX - minDist : otherCenterX + minDist;
  }

  return { x: clampXToWorkArea(windowXFromCenter(pet, centerX), winW), y };
}

function separateAllPets() {
  const ids = [...petWindows.keys()];
  if (ids.length < 2) return;

  for (let pass = 0; pass < 10; pass++) {
    let moved = false;
    for (const petId of ids) {
      const entry = petWindows.get(petId);
      if (!entry?.window || entry.window.isDestroyed() || !entry.window.isVisible()) continue;
      const b = entry.window.getBounds();
      const resolved = resolvePetCollision(petId, b.x, b.y);
      if (resolved.x !== b.x) {
        entry.window.setPosition(Math.round(resolved.x), b.y);
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function getPetFloorY(h = PET_H) {
  const work = getWorkArea();
  return work.y + work.height - h;
}

function isGrabButtonHeld(petId) {
  if (!initWin32User32() || !win32User32.GetAsyncKeyState) return true;
  const pet = getPetEntry(loadConfig(), petId);
  const vk = pet.grabButton === 'left' ? 0x01 : 0x02;
  return (win32User32.GetAsyncKeyState(vk) & 0x8000) !== 0;
}

function clampPetWindowPosition(petId, x, y) {
  const work = getWorkArea();
  const pet = getPetEntry(loadConfig(), petId);
  const { w, h } = petWindowSize(pet.scale);
  const floorY = getPetFloorY(h);
  const minX = work.x;
  const maxX = work.x + work.width - w;
  // The character stands at the bottom of a tall transparent window, so let
  // the window slide above the screen edge while dragging — otherwise she
  // can never reach the top ~300px. Release always snaps her to the floor.
  const minY = work.y - h + 140;
  const maxY = floorY;
  const cx = Math.max(minX, Math.min(maxX, x));
  const cy = Math.max(minY, Math.min(maxY, y));
  return resolvePetCollision(petId, cx, cy);
}

function finishPetDrag(petId, entry) {
  if (!entry?.window || entry.window.isDestroyed()) return;
  entry.dragging = false;
  refreshPassthroughDragLoop();
  const b = entry.window.getBounds();
  const pet = getPetEntry(loadConfig(), petId);
  const floorY = getPetFloorY(petWindowSize(pet.scale).h);
  const resolved = clampPetWindowPosition(petId, b.x, floorY);
  entry.window.setPosition(Math.round(resolved.x), Math.round(resolved.y));
  raisePetWindowTop(entry);
  applyGameOverlayProfile();
  sendToPetWindow(petId, 'pet-drag-release', { x: resolved.x, y: resolved.y });
}

const MAX_PETS = 6;
const PET_NAME_POOL = ['KURIZU', 'Luna', 'Kiki', 'Mimi', 'Boba', 'Neko', 'Pip', 'Zuzu'];

const DEFAULT_AVATAR_FILES = {
  gifIdle: 'default-idle.gif',
  gifPet: 'default-pet.gif',
  gifGrab: 'default-grab.gif',
  gifDance: 'default-dance.gif',
  gifSleep: 'default-sleep.gif',
  gifSit: 'default-sit.gif',
};

const MEMORY_DEFAULTS = {
  pats: 0,
  chats: 0,
  giftsGiven: 0,
  giftsReceived: 0,
  victoriesSeen: 0,
  deathsSeen: 0,
  threadsJoined: 0,
  greetsShared: 0,
  bornAt: 0,
  lastSeenDay: '',
  yDeaths: 0,
  yVictories: 0,
  dDeaths: 0,
  dVictories: 0,
  rpsW: 0,
  rpsL: 0,
  rpsT: 0,
  guessW: 0,
  guessBest: 0,
};

function freshMemory(overrides) {
  return { ...MEMORY_DEFAULTS, ...(overrides || {}) };
}

function bondKey(a, b) {
  return [String(a), String(b)].sort().join('|');
}

function bondScore(relationships, a, b) {
  if (a === b) return 0;
  const rec = (relationships || {})[bondKey(a, b)];
  return Math.max(0, Math.min(100, Number(rec?.score ?? 20)));
}

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
  textVictory: '',
  textSnack: '',
  textGift: '',
  textGiftThanks: '',
  voiceVoxEnabled: false,
  voiceVoxBackend: 'external',
  voiceVoxUrl: 'http://127.0.0.1:50021',
  voiceVoxSpeaker: 1,
  voiceVoxSpeed: 1.0,
  voiceVoxVolume: 100,
  voiceVoxIdleOnly: false,
  voiceVoxReactions: true,
  speechSound: '',
  speechSounds: {},
  speechSoundEnabled: false,
  speechSoundIdleOnly: false,
  speechSoundVolume: 70,
  textIdle: '',
  textProactive: '',
  proactiveChatter: true,
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
  grabButton: 'right',
  ownerName: '',
  aiPersonality: '',
  chaosCloseApps: false,
  chaosCloseChance: 0.12,
  textPrank: '',
  prankEnabled: true,
  prankChance: 0.02,
  prankChanceGlitch: 0.02,
  prankChanceBlackout: 0.02,
  prankChanceBsod: 0.02,
  prankChanceJumpscare: 0.02,
  prankChanceFakeShutdown: 0.02,
  prankChanceRealShutdown: 0,
  prankCooldownMin: 5,
  prankGlitch: true,
  prankJumpscare: true,
  prankBlackout: true,
  prankFakeShutdown: true,
  prankBsod: true,
  prankRealShutdown: false,
  prankShutdownDelaySec: 20,
  prankVolume: 70,
  prankSound: '',
  musicDanceEnabled: false,
  musicThreshold: 35,
  audioInputDeviceId: '',
  audioSourceMode: 'system',
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

const DEFAULT_VICTORY_PATTERNS = [
  'VICTORY',
  'YOU WIN',
  'WINNER WINNER',
  'VICTORY ROYALE',
  'MISSION COMPLETE',
  'QUEST COMPLETE',
  'LEVEL COMPLETE',
  'STAGE CLEAR',
];

const DEFAULT_OCR_PATTERNS = [
  'YOU DIED',
  'YOU ARE DEAD',
  'DEFEAT',
  'DEFEATED',
  'GAME OVER',
  'WASTED',
  'YOU FAILED',
  'FAILED',
  'MISSION FAILED',
  'QUEST FAILED',
  'TRY AGAIN',
  'RESPAWN',
  // NOTE: no CONTINUE? here on purpose. As a regex it matches "continu" in
  // ANY "continue" prompt/shop/chat line, mourning victories and kill feeds.
  // Genuine continue-countdown screens also say GAME OVER / YOU DIED, which
  // are covered. Add your own `CONTINUE\?` custom keyword if you need it.
];

const DEFAULT_GAME_EXES = [
  'valorant-win64-shipping.exe',
  'leagueclient.exe',
  'league of legends.exe',
  'fortniteclient-win64-shipping.exe',
  'r5apex.exe',
  'overwatch.exe',
  'cs2.exe',
  'dota2.exe',
  'javaw.exe',
  'eldenring.exe',
  'genshinimpact.exe',
  'starrail.exe',
  'robloxplayerbeta.exe',
  'rocketleague.exe',
  'among us.exe',
  'terraria.exe',
  'hollow knight.exe',
  'osu!.exe',
  'gta5.exe',
  'rdr2.exe',
  'witcher3.exe',
  'cyberpunk2077.exe',
  'bg3.exe',
  'bg3_dx11.exe',
  'stardew valley.exe',
  'minecraft.windows.exe',
  'monsterhunterworld.exe',
  'monsterhunterrise.exe',
  'monsterhunterwilds.exe',
  'palworld-win64-shipping.exe',
  'helldivers2.exe',
  'lethal company.exe',
  'phasmophobia.exe',
  'vrchat.exe',
  'ffxiv_dx11.exe',
  'wow.exe',
  'diablo iv.exe',
  'cod.exe',
  'destiny2.exe',
  'warframe.x64.exe',
  'ts4_x64.exe',
  'civilizationvi_dx11.exe',
  'civilizationvi_dx12.exe',
  'stellaris.exe',
  'ck3.exe',
  'eu4.exe',
  'factorio.exe',
  'rimworldwin64.exe',
  'valheim.exe',
  'rustclient.exe',
  'tslgame.exe',
  'deadbydaylight-win64-shipping.exe',
  'fallguys_client.exe',
  'dayz_x64.exe',
  'escapefromtarkov.exe',
  'hades.exe',
  'deadcells.exe',
];

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
  gameVictoryPatterns: DEFAULT_VICTORY_PATTERNS.join('\n'),
  gameProcessWatchEnabled: true,
  gameProcessList: DEFAULT_GAME_EXES.join('\n'),
  gameOcrWatchEnabled: false,
  gameOcrAuto: true,
  gameOcrDebugEdges: false,
  gameOcrRegion: 'full',
  gameOcrPatterns: DEFAULT_OCR_PATTERNS.join('\n'),
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
  pets: [],
};

const GAME_OVERLAY_FPS = 8;
const GLOBAL_CONFIG_KEYS = new Set([
  'petEnabled',
  'launchOnStartup',
  'alwaysOnTop',
  'showSettingsOnStart',
  'activePetId',
  'multiPetInteractions',
  'petCollisionGap',
  'gameLowImpactEnabled',
  'hidePetsWhileGaming',
  'gameVictoryPatterns',
  'gameProcessWatchEnabled',
  'gameProcessList',
  'gameOcrWatchEnabled',
  'gameOcrAuto',
  'gameOcrDebugEdges',
  'gameOcrRegion',
  'gameOcrPatterns',
  'gameOcrIntervalSec',
  'gameOcrQuality',
  'voiceDevice',
  'aiEnabled',
  'aiEndpoint',
  'aiKey',
  'aiModel',
  'aiProvider',
  'aiOllamaModel',
  'aiFallback',
  'relationships',
  'prankImage',
  'prankWallpaper',
  'prankWallpaperImage',
  'prankWallpaperSec',
  'prankChanceWallpaper',
  'remoteEnabled',
  'remotePort',
  'remoteToken',
  'pets',
  'avatarUrls',
]);

let petWindows = new Map();
let tagSessions = new Map();
let settingsWindow = null;
let tray = null;
let lastForegroundTitle = '';
let lastForegroundType = '';
let foregroundPollBusy = false;
let globalGameActive = false;
let passthroughTimer = null;
let foregroundPollTimer = null;
let foregroundWinEventHook = null;
let foregroundWinEventProc = null;
let win32User32 = null;
let win32Kernel = null;

let logGameActiveUntil = 0;
let deathOverlayTimer = null;
const LOG_GAME_ACTIVE_MS = 120000;

const HWND_TOPMOST = -1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;

function initWin32User32() {
  if (process.platform !== 'win32') return false;
  if (win32User32) return win32User32.ok;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    win32User32 = {
      ok: true,
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetWindowTextW: user32.func(
        'int __stdcall GetWindowTextW(void * hWnd, _Out_ uint16_t * lpString, int nMaxCount)'
      ),
      GetWindowThreadProcessId: user32.func(
        'unsigned int __stdcall GetWindowThreadProcessId(void * hWnd, _Out_ unsigned int * lpdwProcessId)'
      ),
      GetAsyncKeyState: user32.func('int16 __stdcall GetAsyncKeyState(int vKey)'),
      SetWindowPos: user32.func(
        'int __stdcall SetWindowPos(void * hWnd, void * hWndInsertAfter, int X, int Y, int cX, int cY, unsigned int uFlags)'
      ),
      SetWinEventHook: user32.func(
        'void * __stdcall SetWinEventHook(unsigned int eventMin, unsigned int eventMax, void * hmodWinEventProc, void * pfnWinEventProc, unsigned int idProcess, unsigned int idThread, unsigned int dwFlags)'
      ),
      UnhookWinEvent: user32.func('int __stdcall UnhookWinEvent(void * hWinEventHook)'),
      SystemParametersInfoW: user32.func(
        'int __stdcall SystemParametersInfoW(unsigned int uiAction, unsigned int uiParam, void * pvParam, unsigned int fWinIni)'
      ),
    };
    try {
      const koffi = require('koffi');
      const kernel32 = koffi.load('kernel32.dll');
      win32Kernel = {
        ok: true,
        OpenProcess: kernel32.func(
          'void * __stdcall OpenProcess(unsigned int dwDesiredAccess, int bInheritHandle, unsigned int dwProcessId)'
        ),
        QueryFullProcessImageNameW: kernel32.func(
          'int __stdcall QueryFullProcessImageNameW(void * hProcess, unsigned int dwFlags, _Out_ uint16_t * lpExeName, _Inout_ unsigned int * lpdwSize)'
        ),
        CloseHandle: kernel32.func('int __stdcall CloseHandle(void * hObject)'),
      };
    } catch (err) {
      win32Kernel = { ok: false, error: err.message };
    }
    return true;
  } catch (err) {
    console.error('Failed to init Win32 user32 API:', err);
    win32User32 = { ok: false, error: err.message };
    return false;
  }
}

function raisePetWindowTop(entry) {
  if (!entry?.window || entry.window.isDestroyed()) return;
  entry.window.show();
  entry.window.setAlwaysOnTop(true);
  if (!initWin32User32() || !win32User32.SetWindowPos) return;
  try {
    const hwndBuf = entry.window.getNativeWindowHandle();
    if (!hwndBuf || hwndBuf.length < 8) return;
    const hwnd = hwndBuf.readBigInt64LE(0);
    win32User32.SetWindowPos(
      hwnd,
      HWND_TOPMOST,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    );
  } catch {
    /* optional native boost */
  }
}

function isGameForegroundType(type) {
  return type === 'game' || type === 'gameDeath' || type === 'gameWin';
}

function broadcastPerformanceMode() {
  const config = loadConfig();
  const lowImpact = config.gameLowImpactEnabled !== false && globalGameActive;
  for (const [petId, entry] of petWindows) {
    if (entry.window && !entry.window.isDestroyed()) {
      sendToPetWindow(petId, 'performance-mode', { gameActive: globalGameActive, lowImpact });
    }
  }
}

function ensurePetsVisibleOverGame() {
  if (!globalGameActive) return;
  const config = loadConfig();
  if (config.hidePetsWhileGaming || !config.petEnabled) return;

  for (const [, entry] of petWindows) {
    const win = entry.window;
    if (!win || win.isDestroyed() || entry.dragging) continue;
    win.show();
    if (win.setVisibleOnAllWorkspaces) {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (config.alwaysOnTop) {
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }
}

function applyGameOverlayProfile() {
  const config = loadConfig();
  const gaming = globalGameActive;
  const lowImpact = config.gameLowImpactEnabled !== false && gaming;
  const hide = !!config.hidePetsWhileGaming && gaming;

  for (const [, entry] of petWindows) {
    const win = entry.window;
    if (!win || win.isDestroyed()) continue;
    const wc = win.webContents;

    if (hide) {
      win.hide();
      continue;
    }

    if (config.petEnabled) {
      win.show();
      if (win.setVisibleOnAllWorkspaces) {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
    }

    if (wc && !wc.isDestroyed() && typeof wc.setFrameRate === 'function') {
      wc.setFrameRate(lowImpact ? GAME_OVERLAY_FPS : 60);
    }

    const onTop = !!config.alwaysOnTop;
    if (onTop) {
      win.setAlwaysOnTop(true, gaming ? 'screen-saver' : 'normal');
    } else {
      win.setAlwaysOnTop(false);
    }
  }
}

function needsForegroundWatch() {
  const config = loadConfig();
  if (config.gameLowImpactEnabled !== false) return true;
  return (config.pets || []).some((p) => p.contextReactionsEnabled !== false);
}

function getTitleFromHwnd(hwnd) {
  if (!hwnd || !initWin32User32()) return '';
  try {
    const buf = Buffer.alloc(1024);
    const len = win32User32.GetWindowTextW(hwnd, buf, 512);
    if (len <= 0) return '';
    return buf.toString('utf16le', 0, len * 2).replace(/\0+$/, '').trim();
  } catch {
    return '';
  }
}

function getExeFromHwnd(hwnd) {
  if (!hwnd || process.platform !== 'win32') return '';
  try {
    if (!initWin32User32() || !win32User32.GetWindowThreadProcessId || !win32Kernel?.ok) return '';
    const koffi = require('koffi');
    const pidPtr = koffi.alloc('unsigned int', 1);
    win32User32.GetWindowThreadProcessId(hwnd, pidPtr);
    const pid = koffi.decode(pidPtr, 'unsigned int');
    if (!pid) return '';
    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    const h = win32Kernel.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if (!h) return '';
    try {
      const buf = Buffer.alloc(1024 * 2);
      const sizePtr = koffi.alloc('unsigned int', 1);
      koffi.encode(sizePtr, 'unsigned int', 512);
      if (!win32Kernel.QueryFullProcessImageNameW(h, 0, buf, sizePtr)) return '';
      const len = koffi.decode(sizePtr, 'unsigned int');
      const full = buf.toString('utf16le', 0, Math.max(0, Math.min(512, len)) * 2);
      const base = full.split(/[\\/]/).pop() || '';
      return base.toLowerCase();
    } finally {
      try {
        win32Kernel.CloseHandle(h);
      } catch (_) {}
    }
  } catch (_) {
    return '';
  }
}

function handleForegroundHwndChange(hwnd) {
  if (!isPetEnabled()) return;
  let title = getTitleFromHwnd(hwnd);
  if (!title) {
    const native = getForegroundTitleNative();
    title = native.title || '';
  }
  if (!title || title === lastForegroundTitle) return;
  broadcastForegroundContext(title, getExeFromHwnd(hwnd));
}

function installForegroundWinEventHook() {
  if (foregroundWinEventHook || process.platform !== 'win32') return false;
  if (!initWin32User32() || !win32User32.SetWinEventHook) return false;
  try {
    const koffi = require('koffi');
    const WinEventProc = koffi.proto(
      'void __stdcall WinEventProc(void * hWinEventHook, unsigned int event, void * hwnd, long idObject, long idChild, unsigned int idEventThread, unsigned int dwmsEventTime)'
    );
    foregroundWinEventProc = koffi.register((hHook, event, hwnd) => {
      if (!hwnd) return;
      setImmediate(() => handleForegroundHwndChange(hwnd));
    }, koffi.pointer(WinEventProc));

    const EVENT_SYSTEM_FOREGROUND = 0x0003;
    const WINEVENT_OUTOFCONTEXT = 0;
    const WINEVENT_SKIPOWNPROCESS = 0x0002;
    foregroundWinEventHook = win32User32.SetWinEventHook(
      EVENT_SYSTEM_FOREGROUND,
      EVENT_SYSTEM_FOREGROUND,
      null,
      foregroundWinEventProc,
      0,
      0,
      WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS
    );
    return !!foregroundWinEventHook;
  } catch (err) {
    console.error('SetWinEventHook failed:', err);
    foregroundWinEventHook = null;
    foregroundWinEventProc = null;
    return false;
  }
}

function stopForegroundWatch() {
  if (foregroundPollTimer) {
    clearInterval(foregroundPollTimer);
    foregroundPollTimer = null;
  }
  if (foregroundWinEventHook && win32User32?.UnhookWinEvent) {
    try {
      win32User32.UnhookWinEvent(foregroundWinEventHook);
    } catch {
      /* ignore */
    }
  }
  foregroundWinEventHook = null;
  foregroundWinEventProc = null;
}

function startForegroundWatch() {
  stopForegroundWatch();
  if (!needsForegroundWatch() || process.platform !== 'win32') return;
  if (installForegroundWinEventHook()) {
    pollForegroundWindow();
    return;
  }
  foregroundPollTimer = setInterval(pollForegroundWindow, 4000);
  pollForegroundWindow();
}

function getGameExeSet(config = loadConfig()) {
  const lines = String(config.gameProcessList || '')
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(lines.length ? lines : DEFAULT_GAME_EXES);
}

function parseTasklistCsv(stdout) {
  const found = [];
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]+\.exe)"/i);
    if (m) found.push(m[1].toLowerCase());
  }
  return found;
}

function queryRunningGameExes() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: 'not-windows', matches: [] });
      return;
    }
    execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve({ ok: false, reason: 'tasklist-failed', detail: String(err.message || err), matches: [] });
        return;
      }
      const wanted = getGameExeSet();
      const matches = [...new Set(parseTasklistCsv(stdout).filter((exe) => wanted.has(exe)))];
      resolve({ ok: true, matches });
    });
  });
}

function refreshProcessGameState() {
  if (!isPetEnabled()) return;
  queryRunningGameExes().then(({ ok, matches }) => {
    if (!ok) return;
    const hit = matches[0] || '';
    const active = !!hit;
    if (active !== processGameActive) {
      processGameActive = active;
      processGameName = hit;
      if (active) {
        lastForegroundType = 'game';
        lastForegroundTitle = hit;
        broadcastToPets('foreground-context', {
          type: 'game',
          title: hit,
          entered: true,
          deathEdge: false,
          source: 'process',
        });
      }
      updateGlobalGameActive();
    } else if (active) {
      processGameName = hit;
    }
  });
}

function getOcrScriptPath() {
  return path.join(getScriptsDir(), 'watch-screen-ocr.ps1');
}

function ocrMaxWidth(config = loadConfig()) {
  const q = config.gameOcrQuality || 'balanced';
  if (q === 'fast') return 960;
  if (q === 'sharp') return 2560;
  return 1440;
}

function ocrRegion(config = loadConfig()) {
  const r = config.gameOcrRegion;
  return r === 'center' || r === 'top' ? r : 'full';
}

function runOcrScan(updateHash = true) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, error: 'not-windows' });
      return;
    }
    const scriptPath = getOcrScriptPath();
    if (!fs.existsSync(scriptPath)) {
      resolve({ ok: false, error: 'script-missing' });
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-MaxWidth', String(ocrMaxWidth()), '-Region', String(ocrRegion()), '-UpdateHash', updateHash ? '1' : '0'],
      // Generous: the first scan compiles the OCR helper (~15-30s once), later scans take ~1-3s.
      { windowsHide: true, timeout: 90000, maxBuffer: 256 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve({ ok: false, error: 'scan-failed', detail: String(err.message || err).slice(0, 200) });
          return;
        }
        const lines = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed && typeof parsed === 'object') {
              resolve(parsed.ok ? { ok: true, text: String(parsed.text || ''), unchanged: !!parsed.unchanged } : parsed);
              return;
            }
          } catch (_) {}
        }
        resolve({ ok: false, error: 'bad-output' });
      }
    );
  });
}

// Fuzzy matcher for game fonts: WinRT often returns stylized words with
// letter spacing ("V I C T O R Y"), decorations ("VICTORY!"), or digit
// lookalikes ("V1CTORY"). Collapse all of that before comparing.
function normalizeOcr(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/[^A-Z0-9]+/g, '');
}

function matchOcrText(text, config = loadConfig()) {
  const clean = String(text || '').trim();
  if (!clean) return;
  // Custom keywords EXTEND the built-ins (they used to replace them, so one
  // edited box could silently blind defeat/victory detection entirely).
  // Victory goes FIRST: victory screens almost always carry a "continue"
  // prompt, and the death pattern CONTINUE? would otherwise steal them
  // (a screen saying VICTORY is never a death, but the reverse happens).
  const customDeath = String(config.gameOcrPatterns || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const customWin = String(config.gameVictoryPatterns || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const { source, regex } of compilePatterns([...DEFAULT_VICTORY_PATTERNS, ...customWin])) {
    regex.lastIndex = 0;
    const hit = regex.exec(clean);
    if (!hit) continue;
    emitPlayerVictory({ type: 'PlayerVictory', line: clean.slice(0, 120), pattern: `ocr:${source}` });
    return { kind: 'victory', pattern: `ocr:${source}`, at: hit.index };
  }
  // Fuzzy victory before ANY death check: a spaced "V I C T O R Y" next to a
  // plain "continue" prompt must still celebrate, not mourn.
  const normText = normalizeOcr(clean);
  if (normText) {
    for (const source of [...DEFAULT_VICTORY_PATTERNS, ...customWin]) {
      const needle = normalizeOcr(source);
      if (needle && normText.includes(needle)) {
        emitPlayerVictory({ type: 'PlayerVictory', line: clean.slice(0, 120), pattern: `ocr-fuzzy:${source}` });
        return { kind: 'victory', pattern: `ocr-fuzzy:${source}` };
      }
    }
  }
  for (const { source, regex } of compilePatterns([...DEFAULT_OCR_PATTERNS, ...customDeath])) {
    regex.lastIndex = 0;
    const hit = regex.exec(clean);
    if (!hit) continue;
    emitPlayerDied({ type: 'PlayerDied', line: clean.slice(0, 120), pattern: `ocr:${source}` });
    return { kind: 'death', pattern: `ocr:${source}`, at: hit.index };
  }
  // Exact death matching failed — retry deaths on normalized text so
  // spaced/decorated words ("Y O U D I E D", "FAILED!") still trigger.
  if (normText) {
    for (const source of [...DEFAULT_OCR_PATTERNS, ...customDeath]) {
      const needle = normalizeOcr(source);
      if (needle && normText.includes(needle)) {
        emitPlayerDied({ type: 'PlayerDied', line: clean.slice(0, 120), pattern: `ocr-fuzzy:${source}` });
        return { kind: 'death', pattern: `ocr-fuzzy:${source}` };
      }
    }
  }
  return null;
}

function notifyOcrStatus(payload) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('ocr-status', payload);
  }
}

function disableOcrWithNotice(error) {
  const config = loadConfig();
  if (!config.gameOcrWatchEnabled) return;
  ocrAutoEngaged = false;
  logOcrScan({ event: 'watch-off', auto: false, error });
  config.gameOcrWatchEnabled = false;
  saveConfig(config);
  syncDetectionWatchers(config);
  broadcastConfig();
  notifyOcrStatus({
    ok: false,
    disabled: true,
    error: error || 'scan-failed',
    message: `Screen watch turned itself off after ${OCR_FAIL_DISABLE_AT} failed scans (${error || 'scan-failed'}). Fix the cause, then re-enable it.`,
  });
}

let ocrDebugWindow = null;

// Red screen-edge frame proving the OCR watch is alive. One transparent
// fullscreen window, fully click-through, never takes focus — showInactive
// keeps the game focused. Pulses (opacity) on every scan tick.
function createOcrDebugWindow() {
  if (ocrDebugWindow && !ocrDebugWindow.isDestroyed()) return ocrDebugWindow;
  const bounds = screen.getPrimaryDisplay().bounds;
  ocrDebugWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    thickFrame: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  ocrDebugWindow.setAlwaysOnTop(true, 'screen-saver');
  if (ocrDebugWindow.setVisibleOnAllWorkspaces) {
    ocrDebugWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  ocrDebugWindow.setIgnoreMouseEvents(true);
  ocrDebugWindow.setOpacity(0.85);
  ocrDebugWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    '<!DOCTYPE html><html><body style="margin:0;background:transparent;overflow:hidden">' +
    '<div style="position:fixed;inset:0;box-sizing:border-box;pointer-events:none;' +
    'border:5px solid rgba(255,45,45,0.95);' +
    'box-shadow:0 0 22px rgba(255,0,0,0.65), inset 0 0 22px rgba(255,0,0,0.45);"></div>' +
    '<div style="position:fixed;top:10px;left:50%;transform:translateX(-50%);' +
    'font:700 13px Segoe UI,sans-serif;color:#ff2d2d;letter-spacing:2px;' +
    'text-shadow:0 0 8px rgba(255,0,0,.8);pointer-events:none">\u25cf OCR SCAN</div>' +
    '</body></html>'
  ));
  ocrDebugWindow.hide();
  return ocrDebugWindow;
}

function updateOcrDebugEdges() {
  const config = loadConfig();
  const show = !!config.gameOcrDebugEdges && !!config.gameOcrWatchEnabled && isPetEnabled();
  if (!show) {
    try {
      if (ocrDebugWindow && !ocrDebugWindow.isDestroyed()) ocrDebugWindow.hide();
    } catch (_) {}
    return;
  }
  try {
    const win = createOcrDebugWindow();
    if (!win.isDestroyed() && !win.isVisible()) win.showInactive();
  } catch (_) {}
}

// ---- Scary wallpaper swap (the one prank the built-in framework lacks).
// The overlay effects (glitch/blackout/bsod/jumpscare/fakeShutdown) live in
// the existing runPrank system below; PRANK NOW chains those + this.
let prankWallpaperTimer = null;

function getWallpaperPath() {
  try {
    if (!initWin32User32() || !win32User32.SystemParametersInfoW) return '';
    const buf = Buffer.alloc(520 * 2);
    if (!win32User32.SystemParametersInfoW(0x0073, 520, buf, 0)) return '';
    return buf.toString('utf16le').split('\0')[0];
  } catch (_) {
    return '';
  }
}

function setWallpaperPath(p) {
  try {
    if (!initWin32User32() || !win32User32.SystemParametersInfoW) return false;
    const buf = Buffer.from(`${p}\0`, 'utf16le');
    return !!win32User32.SystemParametersInfoW(0x0014, 0, buf, 0x01 | 0x02);
  } catch (_) {
    return false;
  }
}

function restorePrankWallpaper() {
  try {
    const config = loadConfig();
    if (config.prankPrevWallpaper) {
      setWallpaperPath(config.prankPrevWallpaper);
      config.prankPrevWallpaper = '';
      saveConfig(config);
    }
  } catch (_) {}
}

function prankWallpaperSwap(imageFile, seconds) {
  try {
    const full = path.join(AVATARS_DIR, imageFile);
    if (!imageFile || !fs.existsSync(full)) return false;
    const config = loadConfig();
    if (!config.prankPrevWallpaper) {
      config.prankPrevWallpaper = getWallpaperPath();
      saveConfig(config);
    }
    if (!setWallpaperPath(full)) return false;
    if (prankWallpaperTimer) clearTimeout(prankWallpaperTimer);
    prankWallpaperTimer = setTimeout(restorePrankWallpaper, Math.max(10, Number(seconds) || 30) * 1000);
    return true;
  } catch (_) {
    return false;
  }
}

ipcMain.handle('pick-prank-image', async (_, which) => {
  const config = loadConfig();
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: which === 'wallpaper' ? 'Choose scary wallpaper' : 'Choose jumpscare image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile'],
  });
  if (!canceled && filePaths[0]) {
    ensureAvatarsDir();
    const ext = path.extname(filePaths[0]).toLowerCase() || '.png';
    if (which === 'wallpaper') {
      const destName = `prank-wallpaper${ext}`;
      fs.copyFileSync(filePaths[0], path.join(AVATARS_DIR, destName));
      config.prankWallpaperImage = destName;
    } else {
      // Jumpscare images live on the pet: runPrank prefers pet.prankImage
      // over the avatar for the scare, random pranks included.
      const pet = getPetEntry(config, config.activePetId);
      const destName = `prank-image-${pet.id}${ext}`;
      fs.copyFileSync(filePaths[0], path.join(AVATARS_DIR, destName));
      pet.prankImage = destName;
    }
    saveConfig(config);
    broadcastConfig();
  }
  return getFullEnrichedConfig();
});

ipcMain.handle('prank-now', async () => {
  // Manual trigger box: runs the checked overlay effects back-to-back on the
  // active pet through the existing runPrank system (force skips cooldowns),
  // plus the wallpaper swap which lives outside that system.
  const config = loadConfig();
  const pet = getPetEntry(config, config.activePetId);
  if (!pet) return { ok: false, error: 'no-pet' };
  const picked = ['glitch', 'blackout', 'bsod', 'jumpscare', 'fakeShutdown'].filter((e) => pet[PRANK_EFFECT_FLAG[e]]);
  if (config.prankWallpaper && config.prankWallpaperImage) picked.push('wallpaper');
  if (config.prankWallpaper && config.prankWallpaperImage) {
    prankWallpaperSwap(config.prankWallpaperImage, config.prankWallpaperSec);
  }
  if (!picked.length) return { ok: false, error: 'no-effect' };
  const failed = [];
  for (const effect of picked) {
    try {
      const res = await runPrank({ effect, petId: pet.id, force: true });
      if (!res?.ok) failed.push(`${effect} (${res?.reason || 'unknown'})`);
      await new Promise((r) => setTimeout(r, (PRANK_MAX_MS[effect] || 8000) + 1200));
    } catch (err) {
      failed.push(`${effect} (${String((err && err.message) || err).slice(0, 60)})`);
    }
  }
  return failed.length ? { ok: true, warning: failed.join('; ') } : { ok: true };
});

function pulseOcrDebugEdges(bright) {
  try {
    if (ocrDebugWindow && !ocrDebugWindow.isDestroyed() && ocrDebugWindow.isVisible()) {
      ocrDebugWindow.setOpacity(bright ? 1 : 0.45);
    }
  } catch (_) {}
}

function flashOcrDebugEdges(ms = 2000) {
  if (!loadConfig().gameOcrDebugEdges) return;
  try {
    const win = createOcrDebugWindow();
    if (win.isDestroyed()) return;
    win.showInactive();
    setTimeout(() => {
      try {
        const config = loadConfig();
        if (!(config.gameOcrDebugEdges && config.gameOcrWatchEnabled && isPetEnabled())) win.hide();
      } catch (_) {}
    }, ms);
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Companion remote: tiny LAN HTTP API so a phone (or any browser on the home
// Wi-Fi) can see the pets, chat with them, and poke them. Off by default,
// token-authenticated, LAN-only. No cloud, nothing leaves the house.
// ---------------------------------------------------------------------------
const nodeHttp = require('http');
const nodeCrypto = require('crypto');
let remoteServer = null;
let remotePortInUse = 0;
const pendingDirect = new Map();
let directSeq = 0;

function remoteAuthed(req, config) {
  const token = String(config.remoteToken || '');
  if (!token) return false;
  const header = String(req.headers.authorization || '');
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  try {
    return nodeCrypto.timingSafeEqual(a, b);
  } catch (_) {
    return false;
  }
}

function remoteJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function petPublic(pet, config) {
  const mem = (pet.memory && typeof pet.memory === 'object') ? pet.memory : {};
  const bonds = [];
  for (const other of config.pets || []) {
    if (other.id === pet.id) continue;
    bonds.push({ id: other.id, name: other.name || 'Pet', score: bondScore(config.relationships, pet.id, other.id) });
  }
  return {
    id: pet.id,
    name: pet.name || 'Pet',
    enabled: pet.enabled !== false,
    mood: pet.mood || 'happy',
    memory: {
      pats: mem.pats || 0,
      chats: mem.chats || 0,
      giftsGiven: mem.giftsGiven || 0,
      giftsReceived: mem.giftsReceived || 0,
      victoriesSeen: mem.victoriesSeen || 0,
      deathsSeen: mem.deathsSeen || 0,
      threadsJoined: mem.threadsJoined || 0,
      rpsW: mem.rpsW || 0,
      rpsL: mem.rpsL || 0,
      rpsT: mem.rpsT || 0,
      guessW: mem.guessW || 0,
      guessBest: mem.guessBest || 0,
    },
    bonds,
  };
}

function petDirect(petId, action, payload, timeoutMs = 100000) {
  return new Promise((resolve) => {
    const entry = petWindows.get(petId);
    if (!entry?.window || entry.window.isDestroyed()) {
      resolve({ ok: false, error: 'no-window' });
      return;
    }
    const reqId = `d${Date.now().toString(36)}-${(directSeq += 1)}`;
    const timer = setTimeout(() => {
      pendingDirect.delete(reqId);
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    pendingDirect.set(reqId, (msg) => {
      clearTimeout(timer);
      resolve(msg && typeof msg === 'object' ? msg : { ok: false, error: 'bad-reply' });
    });
    try {
      entry.window.webContents.send('pet-direct', { reqId, action, payload });
    } catch (_) {
      clearTimeout(timer);
      pendingDirect.delete(reqId);
      resolve({ ok: false, error: 'send-failed' });
    }
  });
}

ipcMain.on('pet-direct-reply', (_, msg) => {
  if (!msg || !msg.reqId) return;
  const done = pendingDirect.get(msg.reqId);
  if (!done) return;
  pendingDirect.delete(msg.reqId);
  try {
    done(msg);
  } catch (_) {}
});

function remoteTestPage(port) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Virtual Pet Remote</title><style>' +
    'body{font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:16px;background:#fff5f7;color:#2d3436}' +
    'input,select,button{font:inherit;padding:8px 10px;border-radius:8px;border:1px solid #dfe6e9;margin:4px 0}' +
    'button{background:#d81b60;color:#fff;border:none;cursor:pointer}' +
    'pre{background:#fff;border:1px solid #eee;border-radius:8px;padding:10px;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto}' +
    '.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}' +
    '</style></head><body><h2>Virtual Pet Remote</h2>' +
    '<div class="row"><input id="tok" type="password" placeholder="Token (from Settings)" style="flex:1">' +
    '<button onclick="saveTok()">Save token</button></div>' +
    '<div class="row"><button onclick="api(\'GET\',\'/api/status\')">Status</button>' +
    '<button onclick="api(\'GET\',\'/api/pets\')">Pets</button></div>' +
    '<h3>Chat</h3><div class="row"><select id="pet"></select>' +
    '<input id="msg" placeholder="Say something…" style="flex:1"></div>' +
    '<div class="row"><button onclick="chat()">Send</button></div>' +
    '<h3>RPS</h3><div class="row"><button onclick="rps(\'rock\')">Rock</button>' +
    '<button onclick="rps(\'paper\')">Paper</button><button onclick="rps(\'scissors\')">Scissors</button>' +
    '<button onclick="api(\'POST\',\'/api/prank\',{})">Prank!</button>' +
    '<button onclick="api(\'POST\',\'/api/power\',{on:document.getElementById(\'pow\').checked})">Power</button>' +
    '<input type="checkbox" id="pow" checked></div>' +
    '<pre id="out">responses appear here…</pre>' +
    '<script>const tokEl=document.getElementById(\'tok\');tokEl.value=localStorage.getItem(\'vp-remote-token\'||\'\')||\'\';' +
    'function saveTok(){localStorage.setItem(\'vp-remote-token\',tokEl.value);out(\'token saved\');}' +
    'function out(t){document.getElementById(\'out\').textContent=t;}' +
    'async function api(m,p,b){const r=await fetch(p,{method:m,headers:{\'Content-Type\':\'application/json\',\'Authorization\':\'Bearer \'+tokEl.value},body:b?JSON.stringify(b):undefined});out(m+\' \'+p+\' → \'+r.status+\'\\n\'+await r.text());}' +
    'async function refreshPets(){const r=await fetch(\'/api/pets\',{headers:{\'Authorization\':\'Bearer \'+tokEl.value}});if(!r.ok){out(\'pets → \'+r.status);return;}const j=await r.json();const s=document.getElementById(\'pet\');s.innerHTML=\'\';for(const p of j.pets||[]){const o=document.createElement(\'option\');o.value=p.id;o.textContent=p.name+\' (\'+p.mood+\')\';s.appendChild(o);}out(JSON.stringify(j,null,1));}' +
    'async function chat(){const pet=document.getElementById(\'pet\').value;const text=document.getElementById(\'msg\').value;await api(\'POST\',\'/api/chat\',{petId:pet,text});}' +
    'async function rps(t){const pet=document.getElementById(\'pet\').value;await api(\'POST\',\'/api/rps\',{petId:pet,throw:t});}' +
    'refreshPets();</script></body></html>';
}

function handleRemoteRequest(req, res) {
  const config = loadConfig();
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/' && req.method === 'GET') {
    const html = remoteTestPage(remotePortInUse);
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(html) });
    res.end(html);
    return;
  }
  if (!url.pathname.startsWith('/api/')) {
    remoteJson(res, 404, { ok: false, error: 'not-found' });
    return;
  }
  if (!remoteAuthed(req, config)) {
    remoteJson(res, 401, { ok: false, error: 'unauthorized' });
    return;
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 10240) req.destroy();
  });
  req.on('end', async () => {
    let data = {};
    if (body) {
      try {
        data = JSON.parse(body);
      } catch (_) {
        remoteJson(res, 400, { ok: false, error: 'bad-json' });
        return;
      }
    }
    try {
      const p = url.pathname;
      if (p === '/api/status' && req.method === 'GET') {
        remoteJson(res, 200, {
          ok: true, app: 'virtual-pet', version: app.getVersion(),
          petEnabled: !!config.petEnabled, gameActive: !!globalGameActive, time: Date.now(),
        });
        return;
      }
      if (p === '/api/pets' && req.method === 'GET') {
        remoteJson(res, 200, { ok: true, pets: (config.pets || []).map((pet) => petPublic(pet, config)) });
        return;
      }
      const petMatch = p.match(/^\/api\/pets\/([\w-]+)$/);
      if (petMatch && req.method === 'GET') {
        const pet = (config.pets || []).find((x) => x.id === petMatch[1]);
        if (!pet) {
          remoteJson(res, 404, { ok: false, error: 'no-pet' });
          return;
        }
        remoteJson(res, 200, { ok: true, pet: petPublic(pet, config) });
        return;
      }
      if (p === '/api/chat' && req.method === 'POST') {
        const text = String(data.text || '').slice(0, 200).trim();
        const petId = (config.pets || []).some((x) => x.id === data.petId) ? data.petId : config.activePetId;
        if (!text) {
          remoteJson(res, 400, { ok: false, error: 'empty' });
          return;
        }
        const r = await petDirect(petId, 'chat', { text });
        remoteJson(res, r.ok ? 200 : 502, r);
        return;
      }
      if (p === '/api/rps' && req.method === 'POST') {
        const user = String(data.throw || '').toLowerCase();
        const petId = (config.pets || []).some((x) => x.id === data.petId) ? data.petId : config.activePetId;
        if (!['rock', 'paper', 'scissors'].includes(user)) {
          remoteJson(res, 400, { ok: false, error: 'bad-throw' });
          return;
        }
        const r = await petDirect(petId, 'rps', { throw: user });
        remoteJson(res, r.ok ? 200 : 502, r);
        return;
      }
      if (p === '/api/prank' && req.method === 'POST') {
        const effect = PRANK_EFFECTS.includes(data.effect) ? data.effect : undefined;
        const r = await runPrank({ effect, force: true });
        remoteJson(res, 200, r);
        return;
      }
      if (p === '/api/power' && req.method === 'POST') {
        setPetEnabled(!!data.on);
        try {
          buildAppMenu();
        } catch (_) {}
        remoteJson(res, 200, { ok: true, petEnabled: isPetEnabled() });
        return;
      }
      remoteJson(res, 404, { ok: false, error: 'not-found' });
    } catch (err) {
      remoteJson(res, 500, { ok: false, error: 'failed' });
    }
  });
}

function syncRemoteServer(config = loadConfig()) {
  try {
    if (remoteServer) {
      remoteServer.close();
      remoteServer = null;
      remotePortInUse = 0;
    }
  } catch (_) {}
  if (!config.remoteEnabled) return;
  const port = Math.max(1024, Math.min(65535, Number(config.remotePort) || 3535));
  try {
    remoteServer = nodeHttp.createServer(handleRemoteRequest);
    remoteServer.on('error', (err) => {
      console.error(`[remote] listen failed on ${port}:`, (err && err.message) || err);
      remoteServer = null;
      remotePortInUse = 0;
    });
    remoteServer.listen(port, '0.0.0.0', () => {
      remotePortInUse = port;
      console.log(`[remote] listening on http://0.0.0.0:${port} (token auth)`);
    });
  } catch (err) {
    console.error('[remote] start failed:', (err && err.message) || err);
    remoteServer = null;
  }
}

const ocrScanLog = [];
function logOcrScan(entry) {
  ocrScanLog.unshift({ at: Date.now(), ...entry });
  if (ocrScanLog.length > 30) ocrScanLog.length = 30;
}

ipcMain.handle('get-ocr-log', () => ocrScanLog.map((e) => ({ ...e })));

function runOcrScanTick() {
  if (ocrBusy || !isPetEnabled()) return;
  const config = loadConfig();
  if (!config.gameOcrWatchEnabled) return;
  // When ON, the watch scans continuously — even outside games — so defeat
  // screens in undetected titles are still caught.
  ocrBusy = true;
  pulseOcrDebugEdges(true);
  runOcrScan()
    .then((res) => {
      ocrBusy = false;
      pulseOcrDebugEdges(false);
      if (!res || !res.ok) {
        // Fullscreen games usually can't be screen-captured — that's normal,
        // not a broken setup. Pause the fail counter while any game is
        // active instead of shutting the watch off mid-match.
        if (titleGameActive || processGameActive || isLogGameActive()) return;
        ocrFailStreak += 1;
        const err = (res && res.error) || 'scan-failed';
        logOcrScan({ error: err, game: titleGameActive || processGameActive || isLogGameActive() });
        if (ocrFailStreak >= OCR_FAIL_DISABLE_AT) disableOcrWithNotice(err);
        else notifyOcrStatus({ ok: false, disabled: false, error: err, attempt: ocrFailStreak, of: OCR_FAIL_DISABLE_AT });
        return;
      }
      ocrFailStreak = 0;
      if (res.unchanged) {
        // Frame diffing: identical pixels, OCR skipped — nothing to match.
        logOcrScan({ text: '(unchanged — skipped)', game: titleGameActive || processGameActive || isLogGameActive() });
        notifyOcrStatus({ ok: true });
        return;
      }
      const scanMatch = matchOcrText(res.text, config);
      logOcrScan({ text: String(res.text || '').slice(0, 300), match: scanMatch || null, at: (scanMatch && scanMatch.at) ?? null, game: titleGameActive || processGameActive || isLogGameActive() });
      notifyOcrStatus({ ok: true });
    })
    .catch(() => {
      ocrBusy = false;
      pulseOcrDebugEdges(false);
      if (titleGameActive || processGameActive || isLogGameActive()) return;
      logOcrScan({ error: 'scan-failed', game: false });
      ocrFailStreak += 1;
      if (ocrFailStreak >= OCR_FAIL_DISABLE_AT) disableOcrWithNotice('scan-failed');
      else notifyOcrStatus({ ok: false, disabled: false, error: 'scan-failed', attempt: ocrFailStreak, of: OCR_FAIL_DISABLE_AT });
    });
}

function stopDetectionWatchers() {
  if (processWatchTimer) {
    clearInterval(processWatchTimer);
    processWatchTimer = null;
  }
  if (ocrTimer) {
    clearInterval(ocrTimer);
    ocrTimer = null;
  }
  ocrBusy = false;
}

function syncDetectionWatchers(config = loadConfig()) {
  stopDetectionWatchers();
  if (!config.petEnabled) {
    processGameActive = false;
    processGameName = '';
    updateGlobalGameActive();
    return;
  }
  if (process.platform === 'win32' && config.gameProcessWatchEnabled !== false) {
    refreshProcessGameState();
    processWatchTimer = setInterval(refreshProcessGameState, 5000);
  } else {
    processGameActive = false;
    processGameName = '';
  }
  if (process.platform === 'win32' && config.gameOcrWatchEnabled) {
    ocrFailStreak = 0;
    runOcrScanTick();
    const intervalMs = Math.max(1, Math.min(10, Number(config.gameOcrIntervalSec) || 2)) * 1000;
    ocrTimer = setInterval(runOcrScanTick, intervalMs);
  }
  updateGlobalGameActive();
  updateOcrDebugEdges();
}

let ocrAutoEngaged = false;

function setOcrWatchEnabled(on, notice) {
  const config = loadConfig();
  if (!!config.gameOcrWatchEnabled === !!on) return false;
  config.gameOcrWatchEnabled = !!on;
  saveConfig(config);
  syncDetectionWatchers(config);
  broadcastConfig();
  logOcrScan({ event: on ? 'watch-on' : 'watch-off', auto: !!(notice && notice.auto) });
  if (notice) notifyOcrStatus(notice);
  return true;
}

function setGlobalGameActive(active) {
  const next = !!active;
  if (next === globalGameActive) return;
  globalGameActive = next;
  broadcastPerformanceMode();
  applyGameOverlayProfile();
  if (next) {
    ensurePetsVisibleOverGame();
    const cfg = loadConfig();
    if (cfg.gameOcrWatchEnabled) {
      runOcrScanTick();
    } else if (cfg.gameOcrAuto !== false && process.platform === 'win32') {
      // Auto screen watch: a game appeared, turn OCR on. Remember that WE
      // did it so leaving the game turns it back off — a manual toggle
      // always wins and clears this.
      if (setOcrWatchEnabled(true, { ok: true, auto: true, message: 'Screen watch auto-ON — game detected.' })) {
        ocrAutoEngaged = true;
      }
    }
  } else if (ocrAutoEngaged) {
    ocrAutoEngaged = false;
    setOcrWatchEnabled(false, { ok: true, disabled: false, auto: true, message: 'Screen watch auto-OFF — left the game.' });
  }
}

ipcMain.on('ocr-manual', () => {
  ocrAutoEngaged = false;
});

function refreshPassthroughDragLoop() {
  if (passthroughTimer) {
    clearInterval(passthroughTimer);
    passthroughTimer = null;
  }
  const dragging = [...petWindows.values()].some((e) => e.dragging);
  if (dragging) {
    updatePetDragPassthrough();
    passthroughTimer = setInterval(updatePetDragPassthrough, 16);
  }
}

function getForegroundTitleNative() {
  if (!initWin32User32()) {
    return {
      title: '',
      error: 'native-unavailable',
      detail: win32User32?.error || '',
    };
  }
  try {
    const hwnd = win32User32.GetForegroundWindow();
    if (!hwnd) return { title: '', error: 'no-window' };
    const buf = Buffer.alloc(1024);
    const len = win32User32.GetWindowTextW(hwnd, buf, 512);
    if (len <= 0) return { title: '', error: 'empty-title', method: 'native' };
    const title = buf.toString('utf16le', 0, len * 2).replace(/\0+$/, '').trim();
    if (!title) return { title: '', error: 'empty-title', method: 'native' };
    return { title, error: '', method: 'native' };
  } catch (err) {
    return { title: '', error: 'native-failed', detail: err.message };
  }
}

function getForegroundScriptPath() {
  return path.join(getScriptsDir(), 'get-foreground-title.ps1');
}

function classifyForegroundTitle(title) {
  const t = (title || '').trim();
  const lower = t.toLowerCase();
  if (!t) return { type: 'unknown', title: t };
  if (/virtual pet|desktop-virtual-pet/i.test(t)) return { type: 'self', title: t };

  if (
    /game over|you died|you are dead|you're dead|defeated|defeat|mission failed|quest failed|try again|wasted|respawn|death screen|permadeath|game ended|lost the battle|eliminated|spectating|continue\?/i.test(
      lower
    )
  ) {
    return { type: 'gameDeath', title: t };
  }

  if (
    /victory|you win|winner winner|victory royale|mission complete|quest complete|level complete|stage clear|you did it/i.test(
      lower
    )
  ) {
    return { type: 'gameWin', title: t };
  }

  if (
    /youtube/.test(lower) &&
    (/- youtube/.test(lower) || /chrome|firefox|edge|brave|opera|mozilla|vivaldi/.test(lower))
  ) {
    return { type: 'youtube', title: t };
  }

  const desktopApp =
    /windows explorer|program manager|task manager|settings|notepad|visual studio code|cursor|electron|file explorer|microsoft store|search|snipping tool|calculator|microsoft word|\bword\b|microsoft excel|excel|powerpoint|outlook|onenote|teams|slack|zoom|notion|figma|spotify|vlc|media player|photos|paint|wordpad|libreoffice|thunderbird|powershell|command prompt|terminal|control panel|winrar|7-zip|notepad\+\+|sublime|intellij|webstorm|android studio/;
  if (desktopApp.test(lower)) return { type: 'other', title: t };

  if (
    /steam|minecraft|roblox|fortnite|valorant|league of legends|genshin|elden ring|overwatch|cs2|counter-strike|dota|apex legends|rocket league|among us|terraria|hollow knight|osu!?lazer|osu!|discord \(| \- \w+ \(|monster hunter|monsterhunter|helldivers|palworld|tarkov|warframe|destiny|diablo|warcraft|ffxiv|final fantasy|marvel rivals|tekken|street fighter|mortal kombat|resident evil|black myth|wukong|armored core|dragon's dogma|granblue|throne and liberty|guild wars|black desert|eve online|lost ark|new world|starfield|baldur|hunt showdown|the finals|battlefield|call of duty|forza|sea of thieves|fallout|skyrim|cyberpunk|witcher|red dead|grand theft|assassin's creed|far cry|dying light|borderlands|sekiro|dark souls|bloodborne|hades|dead cells|delta force|fragpunk|halo|gears of war|ghost of|lies of p|stellar blade|persona|yakuza|like a dragon|nier|dragon quest|tales of|honkai|star rail|zenless|wuthering|rpcs3|pcsx2|yuzu|ryujinx/i.test(
      lower
    ) ||
    (/\s-\s/.test(t) && !/chrome|firefox|edge|mozilla|brave|opera|vivaldi|youtube|http/i.test(lower))
  ) {
    return { type: 'game', title: t };
  }

  return { type: 'other', title: t };
}

function broadcastToPets(channel, payload) {
  for (const [, entry] of petWindows) {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send(channel, payload);
    }
  }
}

function isLogGameActive() {
  return Date.now() < logGameActiveUntil;
}

let titleGameActive = false;
let processGameActive = false;
let processGameName = '';
let processWatchTimer = null;
let ocrTimer = null;
let ocrBusy = false;
let ocrFailStreak = 0;
const OCR_FAIL_DISABLE_AT = 12;

function updateGlobalGameActive() {
  setGlobalGameActive(titleGameActive || processGameActive || isLogGameActive());
}

function noteGameLogLine() {
  logGameActiveUntil = Date.now() + LOG_GAME_ACTIVE_MS;
  updateGlobalGameActive();
}

function pulsePetsForDeathReaction() {
  for (const [, entry] of petWindows) {
    const win = entry.window;
    if (!win || win.isDestroyed()) continue;
    win.show();
    if (win.webContents && !win.webContents.isDestroyed() && typeof win.webContents.setFrameRate === 'function') {
      win.webContents.setFrameRate(30);
    }
  }
  if (deathOverlayTimer) clearTimeout(deathOverlayTimer);
  deathOverlayTimer = setTimeout(() => {
    deathOverlayTimer = null;
    applyGameOverlayProfile();
  }, 8000);
}

function emitPlayerDied(event) {
  const payload = {
    type: 'gameDeath',
    title: event.line,
    entered: true,
    deathEdge: true,
    source: 'log',
    pattern: event.pattern,
  };
  noteGameLogLine();
  pulsePetsForDeathReaction();
  broadcastToPets('foreground-context', payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('game-log-death', payload);
  }
}

function emitPlayerVictory(event) {
  const payload = {
    type: 'gameWin',
    title: event.line,
    entered: true,
    victoryEdge: true,
    source: 'log',
    pattern: event.pattern,
  };
  noteGameLogLine();
  broadcastToPets('foreground-context', payload);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('game-log-victory', payload);
  }
}

const BROWSER_EXES = new Set(['chrome.exe', 'msedge.exe', 'firefox.exe', 'brave.exe', 'opera.exe', 'vivaldi.exe']);

// Spotify window titles are "Artist - Song" ("Advertisement" for ads).
// Returns { artist, song } or null for chrome/non-track titles.
function parseMusicTitle(title) {
  const t = String(title || '').trim();
  if (!t || /^spotify\b/i.test(t) || /^advertisement\b/i.test(t)) return null;
  for (const sep of [' - ', ' • ', ' – ']) {
    const i = t.indexOf(sep);
    if (i > 0 && i + sep.length < t.length) {
      const artist = t.slice(0, i).trim();
      const song = t.slice(i + sep.length).trim();
      if (artist && song && song.length <= 120) return { artist, song };
    }
  }
  return null;
}

let lastMusicKey = '';

function broadcastForegroundContext(title, exe = '') {
  const exeName = String(exe || '').toLowerCase();
  const lowerTitle = String(title || '').toLowerCase();
  if (exeName === 'spotify.exe' || (BROWSER_EXES.has(exeName) && lowerTitle.includes('spotify'))) {
    const track = parseMusicTitle(title);
    if (track) {
      const key = `${track.artist} — ${track.song}`;
      const entered = key !== lastMusicKey;
      lastMusicKey = key;
      lastForegroundTitle = title;
      lastForegroundType = 'music';
      titleGameActive = false;
      updateGlobalGameActive();
      if (!entered) return;
      broadcastToPets('foreground-context', { type: 'music', entered: true, title, artist: track.artist, song: track.song });
      return;
    }
    // Spotify chrome with no track (ads, main window) — fall through.
  }
  const classified = classifyForegroundTitle(title);
  if (lastForegroundType === 'music') lastMusicKey = '';
  const entered = classified.type !== lastForegroundType;
  const deathEdge = classified.type === 'gameDeath' && lastForegroundType !== 'gameDeath';
  const victoryEdge = classified.type === 'gameWin' && lastForegroundType !== 'gameWin';
  lastForegroundType = classified.type;
  lastForegroundTitle = title;
  titleGameActive = isGameForegroundType(classified.type);
  updateGlobalGameActive();

  if (classified.type === 'self' || classified.type === 'unknown') return;
  if (!entered && !deathEdge && !victoryEdge) return;

  const payload = { ...classified, entered, deathEdge, victoryEdge };
  broadcastToPets('foreground-context', payload);
}

function getForegroundTitlePowerShell() {
  return new Promise((resolve) => {
    const scriptPath = getForegroundScriptPath();
    if (!fs.existsSync(scriptPath)) {
      resolve({ title: '', error: 'script-missing', detail: scriptPath });
      return;
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, maxBuffer: 64 * 1024 },
      (err, stdout, stderr) => {
        const title = (stdout || '').trim();
        if (title) {
          resolve({ title, error: '', method: 'powershell' });
          return;
        }
        if (err) {
          resolve({
            title: '',
            error: 'powershell-failed',
            detail: (stderr || err.message || '').trim(),
          });
          return;
        }
        resolve({ title: '', error: 'empty-title', method: 'powershell' });
      }
    );
  });
}

function getForegroundTitle() {
  if (process.platform !== 'win32') {
    return Promise.resolve({ title: '', error: 'not-windows' });
  }
  const native = getForegroundTitleNative();
  if (native.title || native.error === 'empty-title') {
    return Promise.resolve(native);
  }
  return getForegroundTitlePowerShell();
}

function describeForegroundType(type) {
  const labels = {
    youtube: 'YouTube / video',
    game: 'Game',
    gameDeath: 'Game over / defeat',
    gameWin: 'Victory!',
    self: 'Virtual Pet (ignored)',
    other: 'Other app (no reaction)',
    unknown: 'Unknown',
  };
  return labels[type] || type;
}

function getForegroundReactionKind(type) {
  if (type === 'youtube') return 'watch';
  if (type === 'game') return 'game';
  if (type === 'gameDeath') return 'gameFail';
  if (type === 'gameWin') return 'gameWin';
  return null;
}

function pollForegroundWindow() {
  if (foregroundPollBusy || process.platform !== 'win32') return;
  if (!isPetEnabled()) return;
  foregroundPollBusy = true;
  getForegroundTitle().then(({ title, error }) => {
    foregroundPollBusy = false;
    if (error || !title || title === lastForegroundTitle) return;
    let exe = '';
    try {
      if (initWin32User32() && win32User32.GetForegroundWindow && getExeFromHwnd) {
        exe = getExeFromHwnd(win32User32.GetForegroundWindow());
      }
    } catch (_) {}
    broadcastForegroundContext(title, exe);
  });
}

function clearTagSessionForPet(petId) {
  const session = tagSessions.get(petId);
  if (!session) return;
  tagSessions.delete(petId);
  tagSessions.delete(session.partnerId);
  sendToPetWindow(petId, 'tag-session', { active: false });
  sendToPetWindow(session.partnerId, 'tag-session', { active: false });
}

function startTagSessionForPets(starterId, partnerId, partnerName, durationMs = 14000) {
  if (!starterId || !partnerId || starterId === partnerId) return;
  const config = loadConfig();
  const starter = getPetEntry(config, starterId);
  const startedAt = Date.now();
  const until = startedAt + durationMs;
  tagSessions.set(starterId, { partnerId, until, taggerId: starterId, startedAt });
  tagSessions.set(partnerId, { partnerId: starterId, until, taggerId: starterId, startedAt });

  sendToPetWindow(starterId, 'tag-session', {
    active: true,
    partnerId,
    partnerName: partnerName || 'Pet',
    until,
    startedAt,
    taggerId: starterId,
    role: 'tagger',
  });
  sendToPetWindow(partnerId, 'tag-session', {
    active: true,
    partnerId: starterId,
    partnerName: starter.name || 'Pet',
    until,
    startedAt,
    taggerId: starterId,
    role: 'runner',
  });
}

function newPetId() {
  return `pet-${Date.now().toString(36)}`;
}

const AVATAR_CONFIG_VALUE_KEYS = Object.values(AVATAR_CONFIG_KEYS);

function migratePetAvatars(pet) {
  for (const key of AVATAR_CONFIG_VALUE_KEYS) pet[key] = asAvatarSlot(pet[key]);
  return pet;
}

function createDefaultPet(id, name) {
  const pet = migratePetAvatars({ id, ...PET_DEFAULTS, name: name || 'KURIZU', enabled: true });
  pet.memory = freshMemory();
  return pet;
}

function normalizeConfig(raw = {}) {
  if (Array.isArray(raw.pets) && raw.pets.length) {
    const pets = raw.pets.slice(0, MAX_PETS).map((p, i) => {
      const merged = migratePetAvatars({
        ...PET_DEFAULTS,
        ...p,
        id: p.id || `pet-${i + 1}`,
        enabled: p.enabled !== false,
      });
      merged.memory = freshMemory(p.memory);
      if (typeof merged.mood !== 'string' || !merged.mood) merged.mood = 'happy';
      return merged;
    });
    return {
      ...APP_DEFAULTS,
      ...raw,
      relationships: (raw.relationships && typeof raw.relationships === 'object') ? raw.relationships : {},
      // An empty exe list is almost always accidental (e.g. reset defaults) —
      // refill it. The enable toggle remains the real off switch.
      gameProcessList: (typeof raw.gameProcessList === 'string' && raw.gameProcessList.trim())
        ? raw.gameProcessList
        : DEFAULT_GAME_EXES.join('\n'),
      pets,
      activePetId: pets.find((p) => p.id === raw.activePetId)?.id || pets[0].id,
    };
  }

  const pet = createDefaultPet('pet-1', raw.name || 'KURIZU');
  for (const key of Object.keys(PET_DEFAULTS)) {
    if (raw[key] !== undefined) pet[key] = raw[key];
  }
  migratePetAvatars(pet);

  const app = { ...APP_DEFAULTS };
  for (const key of Object.keys(APP_DEFAULTS)) {
    if (raw[key] !== undefined) app[key] = raw[key];
  }
  app.pets = [pet];
  app.activePetId = pet.id;
  if (raw.multiPetInteractions === undefined) app.multiPetInteractions = true;
  return app;
}

function getPetEntry(config, petId) {
  return config.pets.find((p) => p.id === petId) || config.pets[0];
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let cachedConfig = null;
let cachedConfigMtimeMs = 0;

function loadConfig() {
  try {
    const st = fs.statSync(CONFIG_PATH);
    if (cachedConfig && st.mtimeMs === cachedConfigMtimeMs) return cachedConfig;
    const parsed = normalizeConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
    cachedConfig = parsed;
    cachedConfigMtimeMs = st.mtimeMs;
    return parsed;
  } catch (_) {}
  if (cachedConfig) return cachedConfig;
  const baked = getBakedDefaults();
  if (baked) {
    seedBakedAvatars(baked);
    cachedConfig = normalizeConfig(baked);
  } else {
    cachedConfig = normalizeConfig({ pets: [createDefaultPet('pet-1', 'KURIZU')] });
  }
  return cachedConfig;
}

function getBakedDefaults() {
  try {
    const p = path.join(__dirname, 'assets', 'baked-defaults.json');
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return raw;
  } catch (_) {
    return null;
  }
}

function collectBakedFileNames(raw, into) {
  const walk = (v) => {
    if (!v) return;
    if (typeof v === 'string') {
      if (/^[^\0\\/:*?"<>|]+\.(gif|png|webp|apng|jpg|jpeg|wav|mp3|ogg)$/i.test(v)) into.add(v);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'object') {
      if (typeof v.file === 'string') walk(v.file);
      for (const k of Object.keys(v)) {
        if (k !== 'file') walk(v[k]);
      }
    }
  };
  for (const pet of raw.pets || []) walk(pet);
  walk(raw.prankWallpaperImage);
}

// First-run seeding: copy the baked avatar/sound/image files into the user's
// data dir (never overwrite — the user's own files always win).
function seedBakedAvatars(raw) {
  try {
    const srcDir = path.join(__dirname, 'assets', 'baked-avatars');
    if (!fs.existsSync(srcDir)) return;
    ensureAvatarsDir();
    const names = new Set();
    collectBakedFileNames(raw, names);
    for (const n of names) {
      const dest = path.join(AVATARS_DIR, n);
      const src = path.join(srcDir, n);
      if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
    }
  } catch (_) {}
}

ipcMain.handle('get-factory-defaults', () => {
  const baked = getBakedDefaults();
  return normalizeConfig(baked || {});
});

function getBundledDefaultsDir() {
  const dirs = [path.join(__dirname, 'assets', 'default')];
  if (app.isPackaged) {
    dirs.unshift(path.join(process.resourcesPath, 'app.asar.unpacked', 'assets', 'default'));
  }
  return dirs.find((d) => fs.existsSync(d)) || dirs[0];
}

function ensureDefaultAvatars() {
  ensureAvatarsDir();
  const bundledDir = getBundledDefaultsDir();
  if (!fs.existsSync(bundledDir)) return;
  for (const fileName of Object.values(DEFAULT_AVATAR_FILES)) {
    const dest = path.join(AVATARS_DIR, fileName);
    if (fs.existsSync(dest)) continue;
    const src = path.join(bundledDir, fileName);
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  }
}

const PACKS_DIR = path.join(app.getPath('userData'), 'character-packs');
const PACK_SLOT_FILES = {
  idle: 'idle',
  move: 'move',
  attack: 'attack',
  pet: 'pet',
  grab: 'grab',
  dance: 'dance',
  sleep: 'sleep',
  sit: 'sit',
  victory: 'victory',
  defeat: 'defeat',
  talk: 'talk',
  greet: 'greet',
  giftGive: 'giftgive',
  giftReceive: 'giftreceive',
};
const PACK_EXTS = ['gif', 'png', 'webp', 'apng'];

const PACKS_README = [
  'Drop a folder per character here. Example:',
  '',
  '  character-packs\\Mochi\\idle.gif',
  '  character-packs\\Mochi\\move.gif',
  '  ...',
  '',
  'File names (lowercase, any of .gif .png .webp .apng):',
  '  idle (required), move, attack, pet, grab, dance, sleep, sit,',
  '  victory, defeat, talk, greet, giftgive, giftreceive',
  '',
  'Variants: idle2, idle3, ... up to idle8 (same for other actions).',
  'They play shuffled by default — sequence them in Settings.',
  '',
  'Restart settings (or press Apply below) to see new folders.',
  '',
].join('\r\n');

function findPackFiles(dir, base) {
  const out = [];
  try {
    const names = fs.readdirSync(dir);
    const lower = new Map(names.map((n) => [n.toLowerCase(), n]));
    const candidates = [base];
    for (let i = 2; i <= MAX_AVATAR_VARIANTS; i++) candidates.push(`${base}${i}`);
    for (const cand of candidates) {
      for (const ext of PACK_EXTS) {
        const hit = lower.get(`${cand}.${ext}`);
        if (hit) {
          out.push(path.join(dir, hit));
          break;
        }
      }
      if (out.length >= MAX_AVATAR_VARIANTS) break;
    }
  } catch (_) {}
  return out;
}

function getCharacterPacks() {
  const packs = [];
  const defaults = getPackFiles('Default');
  if (defaults.idle) {
    packs.push({ name: 'Default', source: 'bundled', slots: Object.keys(defaults) });
  }
  let dirs = [];
  try {
    dirs = fs.readdirSync(PACKS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch (_) {}
  for (const name of dirs) {
    const dir = path.join(PACKS_DIR, name);
    const slots = AVATAR_SLOTS.filter((slot) => findPackFiles(dir, PACK_SLOT_FILES[slot]).length);
    if (!slots.includes('idle')) continue;
    packs.push({ name, source: 'folder', slots });
  }
  return packs;
}

function getPackFiles(name) {
  if (name === 'Default') {
    const bundledDir = getBundledDefaultsDir();
    const files = {};
    if (!bundledDir) return files;
    for (const slot of AVATAR_SLOTS) {
      const key = AVATAR_CONFIG_KEYS[slot];
      const fileName = DEFAULT_AVATAR_FILES[key];
      if (!fileName && slot !== 'idle') continue;
      const full = path.join(bundledDir, fileName || '');
      if (fileName && fs.existsSync(full)) files[slot] = [full];
    }
    return files;
  }
  const dir = path.join(PACKS_DIR, String(name || ''));
  const files = {};
  for (const slot of AVATAR_SLOTS) {
    const found = findPackFiles(dir, PACK_SLOT_FILES[slot]);
    if (found.length) files[slot] = found;
  }
  return files;
}

function ensurePacksReadme() {
  try {
    fs.mkdirSync(PACKS_DIR, { recursive: true });
    const readme = path.join(PACKS_DIR, 'README.txt');
    if (!fs.existsSync(readme)) fs.writeFileSync(readme, PACKS_README);
  } catch (_) {}
}

function saveConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  const normalized = normalizeConfig(config);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2));
  cachedConfig = normalized;
  try {
    cachedConfigMtimeMs = fs.statSync(CONFIG_PATH).mtimeMs;
  } catch (_) {}
}

function ensureAvatarsDir() {
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

function enrichPet(pet) {
  const out = { ...pet, avatarUrls: {}, avatarVariantUrls: {}, avatarModes: {}, avatarVariantMeta: {} };
  for (const slot of AVATAR_SLOTS) {
    const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
    const urls = [];
    const meta = [];
    for (const f of entry.files) {
      const filePath = path.join(AVATARS_DIR, f.file);
      if (!f.file || !fs.existsSync(filePath)) continue;
      urls.push(`pet-avatar://local/${encodeURIComponent(f.file)}`);
      meta.push({ next: f.next || 'any' });
    }
    if (!urls.length) continue;
    out.avatarUrls[slot] = urls[0];
    out.avatarVariantUrls[slot] = urls;
    out.avatarModes[slot] = entry.mode;
    out.avatarVariantMeta[slot] = meta;
  }
  if (pet.speechSound) {
    const soundPath = path.join(AVATARS_DIR, pet.speechSound);
    if (fs.existsSync(soundPath)) {
      out.soundUrl = `pet-avatar://local/${encodeURIComponent(pet.speechSound)}`;
    }
  }
  out.soundUrls = {};
  const slotFiles = pet.speechSounds && typeof pet.speechSounds === 'object' ? pet.speechSounds : {};
  for (const slot of SPEECH_SOUND_SLOTS) {
    const fileName = slotFiles[slot];
    if (!fileName) continue;
    const filePath = path.join(AVATARS_DIR, fileName);
    if (fs.existsSync(filePath)) {
      out.soundUrls[slot] = `pet-avatar://local/${encodeURIComponent(fileName)}`;
    }
  }
  return out;
}

function getFullEnrichedConfig() {
  const config = loadConfig();
  return {
    ...config,
    pets: config.pets.map((p) => enrichPet(p)),
  };
}

function getPetEnrichedConfig(petId) {
  const config = loadConfig();
  const pet = getPetEntry(config, petId);
  const enriched = enrichPet(pet);
  const size = petWindowSize(pet.scale);
  return {
    ...config,
    ...enriched,
    petId: pet.id,
    activePetId: pet.id,
    winW: size.w,
    winH: size.h,
  };
}

function layoutPetWindow(petId) {
  const config = loadConfig();
  const pet = getPetEntry(config, petId);
  const entry = petWindows.get(petId);
  if (!entry?.window || entry.window.isDestroyed()) return;
  const { w, h } = petWindowSize(pet.scale);
  const b = entry.window.getBounds();
  if (b.width === w && b.height === h) return;
  const cx = b.x + b.width / 2;
  const work = getWorkArea();
  entry.window.setBounds({
    x: Math.round(clampXToWorkArea(cx - w / 2, w)),
    y: Math.round(work.y + work.height - h),
    width: w,
    height: h,
  });
}

function layoutPetWindows() {
  for (const petId of petWindows.keys()) layoutPetWindow(petId);
  separateAllPets();
}

function broadcastConfig() {
  const full = getFullEnrichedConfig();
  for (const [petId, entry] of petWindows) {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('config-updated', getPetEnrichedConfig(petId));
    }
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('config-updated', full);
  }
  return full;
}

function getPetIdFromEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win === settingsWindow) return null;
  return win.petId || null;
}

function getEnabledPets(config = loadConfig()) {
  return config.pets.filter((p) => p.enabled !== false);
}

function isPetEnabled() {
  return !!loadConfig().petEnabled;
}

function createTrayIcon() {
  const size = 16;
  const buffer = Buffer.alloc(size * size * 4);
  const enabled = isPetEnabled();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dist = Math.hypot(x - 7.5, y - 7.5);
      if (dist < 6.5) {
        buffer[i] = enabled ? 255 : 140;
        buffer[i + 1] = enabled ? 105 : 140;
        buffer[i + 2] = enabled ? 180 : 150;
        buffer[i + 3] = 255;
      } else {
        buffer[i + 3] = 0;
      }
    }
  }
  return nativeImage.createFromBuffer(buffer, { width: size, height: size });
}

function updateTray() {
  if (!tray) return;
  tray.setImage(createTrayIcon());
  tray.setToolTip(
    isPetEnabled()
      ? 'Virtual Pet: ON — left-click for settings'
      : 'Virtual Pet: OFF — left-click to turn on'
  );
  tray.setContextMenu(buildTrayMenu());
}

function setLaunchOnStartup(enabled) {
  const settings = { openAtLogin: !!enabled, openAsHidden: true };
  if (!app.isPackaged) {
    settings.path = process.execPath;
    settings.args = [path.resolve(__dirname)];
  }
  app.setLoginItemSettings(settings);
}

function setPetEnabled(enabled, save = true) {
  const config = loadConfig();
  // Reset foreground tracking so the currently focused window triggers a
  // fresh reaction (e.g. enabling the pet while a game is already focused).
  lastForegroundTitle = '';
  lastForegroundType = '';
  config.petEnabled = !!enabled;
  if (save) saveConfig(config);
  syncPetWindows();
  updateTray();
  notifyPetPowerChanged(config.petEnabled);
  syncDetectionWatchers(config);
}

function notifyPetPowerChanged(enabled) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('pet-power-changed', enabled);
  }
}

function buildAppMenu() {
  const config = loadConfig();
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Virtual Pet',
        submenu: [
          {
            label: config.petEnabled ? 'Turn Pet OFF' : 'Turn Pet ON',
            click: () => setPetEnabled(!isPetEnabled()),
          },
          { label: 'Open Settings', accelerator: 'CmdOrCtrl+,', click: () => createSettingsWindow() },
          { label: 'Start Random Walk', click: () => startWanderFromConfig(), enabled: isPetEnabled() },
          {
            label: 'Toggle Developer Tools',
            accelerator: 'F12',
            click: () => {
              const win = BrowserWindow.getFocusedWindow() || settingsWindow;
              if (win && !win.isDestroyed()) win.webContents.toggleDevTools();
            },
          },
          { type: 'separator' },
          { label: 'Exit App Completely', accelerator: 'CmdOrCtrl+Q', click: () => app.exit(0) },
        ],
      },
    ])
  );
}

function buildTrayMenu() {
  const on = isPetEnabled();
  return Menu.buildFromTemplate([
    {
      label: on ? 'Turn Pet OFF' : 'Turn Pet ON',
      click: () => setPetEnabled(!on),
    },
    { label: 'Open Settings', click: () => createSettingsWindow() },
    { label: 'Start Random Walk', click: () => startWanderFromConfig(), enabled: on },
    ...(prankActive ? [{ label: 'Stop the prank NOW', click: () => closePrankWindow('abort') }] : []),
    { label: 'Chat with pet 💬', click: () => createChatWindow(loadConfig().activePetId), enabled: on },
    { type: 'separator' },
    { label: 'Made by Kurizu', enabled: false },
    { type: 'separator' },
    { label: 'Exit App Completely', click: () => app.exit(0) },
  ]);
}

function petDisplayName(petId) {
  if (!petId) return 'pet';
  try {
    return getPetEntry(loadConfig(), petId).name || 'pet';
  } catch (_) {
    return 'pet';
  }
}

function buildPetContextMenu(petId = null) {
  const on = isPetEnabled();
  return Menu.buildFromTemplate([
    {
      label: on ? 'Turn Pet OFF' : 'Turn Pet ON',
      click: () => setPetEnabled(!on),
    },
    { label: 'Open Settings', click: () => createSettingsWindow() },
    { label: 'Start Random Walk', click: () => startWanderFromConfig(), enabled: on },
    { label: `Chat with ${petDisplayName(petId)} 💬`, click: () => createChatWindow(petId), enabled: on },
    { label: `Play rock-paper-scissors with ${petDisplayName(petId)} ✂️`, click: () => { if (petId) sendToPetWindow(petId, 'rps-start'); }, enabled: on },
    { type: 'separator' },
    { label: 'Made by Kurizu', enabled: false },
    { type: 'separator' },
    { label: 'Exit App Completely', click: () => app.exit(0) },
  ]);
}

function updatePetDragPassthrough() {
  const cursor = screen.getCursorScreenPoint();

  for (const [petId, entry] of petWindows) {
    const { window: petWindow, dragging, dragOffset } = entry;
    if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible() || !dragging) continue;

    if (!isGrabButtonHeld(petId)) {
      finishPetDrag(petId, entry);
      refreshPassthroughDragLoop();
      continue;
    }
    if (cursor.x === entry.lastDragX && cursor.y === entry.lastDragY) continue;
    entry.lastDragX = cursor.x;
    entry.lastDragY = cursor.y;
    petWindow.setIgnoreMouseEvents(false);
    raisePetWindowTop(entry);
    const rawX = Math.round(cursor.x - dragOffset.x);
    const rawY = Math.round(cursor.y - dragOffset.y);
    const resolved = clampPetWindowPosition(petId, rawX, rawY);
    petWindow.setPosition(Math.round(resolved.x), Math.round(resolved.y));
  }
}

function pointInHitRegion(p, r) {
  if (!p || !r) return false;
  return Math.abs(p.x - r.cx) <= (r.rx || 0) && Math.abs(p.y - r.cy) <= (r.ry || 0);
}

// Main-side click-through authority. The renderer's forwarded mousemove is
// the fast path for hover, but it goes stale when the mouse doesn't move
// (pet walks under a stationary cursor) or when a fullscreen game swallows
// mouse messages — leaving the window stuck capturing clicks. This poll
// re-checks the real cursor position against the reported hit regions and
// forces the correct state. Speech bubbles never capture (display-only).
function updateClickThroughStates() {
  let cursor = null;
  try {
    cursor = screen.getCursorScreenPoint();
  } catch {
    return;
  }
  for (const [, entry] of petWindows) {
    const win = entry.window;
    if (!win || win.isDestroyed() || !win.isVisible() || entry.dragging) continue;
    const regions = entry.hitRegions;
    if (!regions) continue;
    // Speech bubbles never capture (display-only). The RPS button bar
    // captures while visible so its buttons stay clickable.
    const over = pointInHitRegion(cursor, regions.body)
      || pointInHitRegion(cursor, regions.head)
      || pointInHitRegion(cursor, regions.rps);
    if (over !== entry.mouseOver) {
      entry.mouseOver = over;
      try {
        win.setIgnoreMouseEvents(!over, { forward: true });
      } catch {
        /* ignore */
      }
    }
  }
}

let clickThroughTimer = null;

function startClickThroughLoop() {
  if (clickThroughTimer) return;
  clickThroughTimer = setInterval(updateClickThroughStates, 180);
}

function getCloseRandomScriptPath() {
  return path.join(getScriptsDir(), 'close-random-window.ps1');
}

function tryCloseRandomAppWindow() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: 'not-windows' });
      return;
    }

    const scriptPath = getCloseRandomScriptPath();
    if (!fs.existsSync(scriptPath)) {
      resolve({ ok: false, reason: 'script-missing', detail: scriptPath });
      return;
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        const windowTitle = (stdout || '').trim();
        if (!windowTitle) {
          resolve({
            ok: false,
            reason: err ? 'script-failed' : 'no-candidates',
            detail: (stderr || err?.message || '').trim(),
          });
          return;
        }
        resolve({ ok: true, windowTitle });
      }
    );
  });
}

async function runChaosClose(requireEnabled = true, petId = null) {
  const config = loadConfig();
  if (requireEnabled) {
    const pet = petId ? getPetEntry(config, petId) : config.pets[0];
    if (!pet?.chaosCloseApps) return { ok: false, reason: 'disabled' };
  }
  const result = await tryCloseRandomAppWindow();
  if (result.ok) {
    if (petId) sendToPetWindow(petId, 'chaos-close', { windowTitle: result.windowTitle });
    else {
      for (const id of petWindows.keys()) {
        sendToPetWindow(id, 'chaos-close', { windowTitle: result.windowTitle });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Prank mode: random "looks-like-malware" effects played by the pet on a
// fullscreen transparent overlay. Everything is a harmless visual prank,
// except the optional real shutdown which is off by default, is announced
// with a countdown and stays cancellable (Esc / click / shutdown /a).
// ---------------------------------------------------------------------------
const PRANK_EFFECTS = ['glitch', 'jumpscare', 'blackout', 'fakeShutdown', 'bsod', 'realShutdown', 'wallpaper'];
const PRANK_EFFECT_FLAG = {
  glitch: 'prankGlitch',
  jumpscare: 'prankJumpscare',
  blackout: 'prankBlackout',
  fakeShutdown: 'prankFakeShutdown',
  bsod: 'prankBsod',
  realShutdown: 'prankRealShutdown',
};
// realShutdown stays deliberately rare even when enabled.
const PRANK_WEIGHT = {
  glitch: 3,
  blackout: 2.5,
  jumpscare: 2,
  fakeShutdown: 1.5,
  bsod: 1,
  realShutdown: 0.5,
  wallpaper: 1.5,
};
const PRANK_MAX_MS = {
  glitch: 6000,
  jumpscare: 6000,
  blackout: 9000,
  fakeShutdown: 14000,
  bsod: 14000,
  realShutdown: 190000,
  wallpaper: 1000,
};
const PRANK_GLOBAL_GAP_MS = 60000;
const PRANK_DEFAULT_LINES = ['hehe~', 'something feels off\u2026', 'I see you', 'watch this~', 'boo!', 'did I scare you?'];

let prankWindow = null;
let prankActive = false;
let prankTimer = null;
let prankLastAt = 0;
const prankLastAtByPet = new Map();
const prankHidPets = new Set();

// BSOD theater: the pets glitch, then vanish off the blue screen,
// then come back when it ends.
function hidePetsForPrank() {
  prankHidPets.clear();
  for (const [petId, entry] of petWindows) {
    if (entry.window && !entry.window.isDestroyed() && entry.window.isVisible()) {
      prankHidPets.add(petId);
      try {
        entry.window.hide();
      } catch (_) {}
    }
  }
}

function reshowPetsAfterPrank() {
  if (!prankHidPets.size) return;
  const config = loadConfig();
  const enabled = new Set(getEnabledPets(config).map((p) => p.id));
  for (const petId of prankHidPets) {
    const entry = petWindows.get(petId);
    if (entry?.window && !entry.window.isDestroyed() && config.petEnabled !== false && enabled.has(petId)) {
      try {
        if (typeof entry.window.showInactive === 'function') entry.window.showInactive();
        else entry.window.show();
      } catch (_) {}
    }
  }
  prankHidPets.clear();
}

function prankEffectsForPet(pet, config) {
  if (!pet) return [];
  // Wallpaper is app-level (one desktop) with its own switch + image.
  const list = PRANK_EFFECTS.filter((e) => e !== 'wallpaper' && pet[PRANK_EFFECT_FLAG[e]]);
  if (config?.prankWallpaper && config?.prankWallpaperImage) list.push('wallpaper');
  return list;
}

function pickPrankEffect(pet, config) {
  const pool = prankEffectsForPet(pet, config).map((e) => ({ e, w: PRANK_WEIGHT[e] || 1 }));
  if (!pool.length) return null;
  const total = pool.reduce((sum, p) => sum + p.w, 0);
  let roll = Math.random() * total;
  for (const p of pool) {
    roll -= p.w;
    if (roll <= 0) return p.e;
  }
  return pool[pool.length - 1].e;
}

function prankLines(pet) {
  const raw = String(pet.textPrank || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (raw.length ? raw : PRANK_DEFAULT_LINES).slice(0, 12);
}

function shutdownExePath() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  const candidate = path.join(root, 'System32', 'shutdown.exe');
  return fs.existsSync(candidate) ? candidate : 'shutdown.exe';
}

// Windows gives us an OS-level abort window via `/t <sec>`, so the countdown
// in the overlay is always backed by a real `shutdown /a` escape hatch.
function beginSystemShutdown(delaySec) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: 'not-windows' });
      return;
    }
    execFile(
      shutdownExePath(),
      ['/s', '/t', String(delaySec), '/c', 'Virtual Pet is shutting down~'],
      { windowsHide: true, maxBuffer: 1024 * 256 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, detail: String(stderr || err?.message || '').trim() });
      }
    );
  });
}

function abortSystemShutdown() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, reason: 'not-windows' });
      return;
    }
    execFile(shutdownExePath(), ['/a'], { windowsHide: true, maxBuffer: 1024 * 256 }, (err) => {
      resolve({ ok: !err });
    });
  });
}

async function closePrankWindow(reason = 'done') {
  if (prankTimer) {
    clearTimeout(prankTimer);
    prankTimer = null;
  }
  const win = prankWindow;
  prankWindow = null;
  prankActive = false;
  if (win && !win.isDestroyed()) {
    try {
      win.destroy();
    } catch (_) {}
  }
  if (reason === 'abort') await abortSystemShutdown();
  reshowPetsAfterPrank();
  broadcastToPets('prank-end', { reason });
  updateTray();
}

async function runPrank(opts = {}) {
  const force = !!opts.force;
  const config = loadConfig();
  const pet = getPetEntry(config, opts.petId || config.activePetId);
  if (!pet) return { ok: false, reason: 'no-pet' };

  const explicitEffect = PRANK_EFFECTS.includes(opts.effect);
  const effect = explicitEffect ? opts.effect : pickPrankEffect(pet, config);
  if (!effect) return { ok: false, reason: 'no-effect' };
  if (effect !== 'wallpaper' && !pet[PRANK_EFFECT_FLAG[effect]]) return { ok: false, reason: 'effect-disabled' };

  if (!force) {
    if (!pet.prankEnabled) return { ok: false, reason: 'disabled' };
    if (!isPetEnabled()) return { ok: false, reason: 'pets-off' };
    if (prankActive) return { ok: false, reason: 'busy' };
    // Named effects (pet rolls, manual tests) carry their own 10s rhythm —
    // only the blind weighted fallback is throttled here.
    if (!explicitEffect) {
      if (Date.now() - prankLastAt < PRANK_GLOBAL_GAP_MS) return { ok: false, reason: 'cooldown' };
      const coolMs = Math.max(1, Number(pet.prankCooldownMin) || 5) * 60000;
      if (Date.now() - (prankLastAtByPet.get(pet.id) || 0) < coolMs) return { ok: false, reason: 'cooldown' };
    }
  }

  // The dangerous effect needs its own explicit opt-in, tests included.
  if (effect === 'realShutdown' && !pet.prankRealShutdown) {
    return { ok: false, reason: 'shutdown-disabled' };
  }

  // Wallpaper swap is windowless: no overlay, just swap + restore timer.
  if (effect === 'wallpaper') {
    if (!config.prankWallpaper || !config.prankWallpaperImage) {
      return { ok: false, reason: 'effect-disabled' };
    }
    const swapped = prankWallpaperSwap(config.prankWallpaperImage, config.prankWallpaperSec);
    prankLastAt = Date.now();
    if (!force) prankLastAtByPet.set(pet.id, prankLastAt);
    broadcastToPets('prank-effect', { effect, petId: pet.id, name: pet.name });
    return swapped ? { ok: true, effect } : { ok: false, reason: 'no-image' };
  }

  if (prankWindow && !prankWindow.isDestroyed()) {
    try {
      prankWindow.destroy();
    } catch (_) {}
  }
  prankWindow = null;

  const delaySec = Math.max(5, Math.min(180, Number(pet.prankShutdownDelaySec) || 20));
  let shutdownResult = { ok: false, reason: 'skipped' };
  if (effect === 'realShutdown') shutdownResult = await beginSystemShutdown(delaySec);

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = display.bounds;
  const win = new BrowserWindow({
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    thickFrame: false,
    focusable: true,
    show: false,
    webPreferences: webPreferences(),
  });
  prankWindow = win;
  prankActive = true;
  prankLastAt = Date.now();
  if (!force) prankLastAtByPet.set(pet.id, prankLastAt);

  try {
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch (_) {}
  if (win.setVisibleOnAllWorkspaces) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  // Short visual pranks click through so the user is never stuck; the
  // full-screen ones that read as "system" keep the mouse so clicks cancel.
  const blocksInput = effect === 'fakeShutdown' || effect === 'bsod' || effect === 'realShutdown';
  if (!blocksInput) win.setIgnoreMouseEvents(true);

  win.on('closed', () => {
    if (prankWindow === win) {
      prankWindow = null;
      prankActive = false;
    }
  });

  const enriched = enrichPet(pet);
  const soundFile = pet.prankSound ? path.join(AVATARS_DIR, pet.prankSound) : '';
  const hasSound = !!soundFile && fs.existsSync(soundFile);
  const chain = effect === 'blackout' && !!pet.prankJumpscare && Math.random() < 0.45;

  win.loadFile(path.join(__dirname, 'prank', 'index.html'), {
    query: {
      effect,
      chain: chain ? '1' : '0',
      delay: String(delaySec),
      name: pet.name || 'Pet',
      avatar: (pet.prankImage && fs.existsSync(path.join(AVATARS_DIR, pet.prankImage))
        ? `pet-avatar://local/${encodeURIComponent(pet.prankImage)}`
        : '') || enriched.avatarUrls.attack || enriched.avatarUrls.idle || enriched.avatarUrls.pet || '',
      sound: hasSound ? `pet-avatar://local/${encodeURIComponent(pet.prankSound)}` : '',
      volume: String(Math.max(0, Math.min(100, Number(pet.prankVolume) || 70))),
      lines: JSON.stringify(prankLines(pet)),
      shutdownOk: shutdownResult.ok ? '1' : '0',
    },
  });

  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    if (blocksInput) {
      win.show();
      win.focus();
    } else {
      win.showInactive();
    }
  });

  broadcastToPets('prank-effect', { effect, petId: pet.id, name: pet.name });
  if (effect === 'bsod') setTimeout(hidePetsForPrank, 1200);
  updateTray();

  if (prankTimer) clearTimeout(prankTimer);
  prankTimer = setTimeout(() => {
    closePrankWindow('timeout');
  }, PRANK_MAX_MS[effect] || 10000);

  return { ok: true, effect, shutdown: shutdownResult };
}

function destroyPetWindow(petId) {
  const entry = petWindows.get(petId);
  if (!entry) return;
  if (entry.window && !entry.window.isDestroyed()) entry.window.destroy();
  petWindows.delete(petId);
}

function spawnXForPet(index, total, enabledPets = null) {
  const work = getWorkArea();
  const pets = enabledPets || getEnabledPets();
  const pet = pets[index];
  if (!pet || total <= 1) {
    const w = petWindowSize(pet?.scale).w;
    return clampXToWorkArea(work.x + Math.floor((work.width - w) / 2), w);
  }

  const gap = getPetCollisionGap();
  const centers = [];
  let cx = work.x + 8 + (pets[0].bodyHitWidth ?? 110) / 2;
  centers.push(cx);
  for (let i = 1; i < pets.length; i++) {
    const prevHalf = (pets[i - 1].bodyHitWidth ?? 110) / 2;
    const curHalf = (pets[i].bodyHitWidth ?? 110) / 2;
    cx += prevHalf + curHalf + gap;
    centers.push(cx);
  }

  const groupSpan = centers[centers.length - 1] - centers[0];
  const shift = Math.max(0, (work.width - groupSpan) / 2 - (centers[0] - work.x - 8));
  return clampXToWorkArea(windowXFromCenter(pet, centers[index] + shift));
}

function createPetWindow(petId, index = 0, total = 1, enabledPets = null) {
  const existing = petWindows.get(petId);
  if (existing?.window && !existing.window.isDestroyed()) {
    existing.window.show();
    return existing.window;
  }

  const config = loadConfig();
  const pet = getPetEntry(config, petId);
  const size = petWindowSize(pet.scale);

  const petWindow = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: spawnXForPet(index, total, enabledPets),
    y: getPetFloorY(size.h),
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: config.alwaysOnTop,
    focusable: true,
    show: false,
    webPreferences: webPreferences(),
  });

  petWindow.petId = petId;
  petWindow.webContents.setBackgroundThrottling(false);
  petWindow.setIgnoreMouseEvents(true, { forward: true });
  if (petWindow.setVisibleOnAllWorkspaces) {
    petWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  petWindow.loadFile(path.join(__dirname, 'pet', 'index.html'), {
    query: { petId },
  });

  const entry = {
    window: petWindow,
    dragging: false,
    dragOffset: { x: 0, y: 0 },
    mouseOver: false,
    hitRegions: null,
  };
  petWindows.set(petId, entry);

  petWindow.webContents.once('did-finish-load', () => {
    sendToPetWindow(petId, 'pet-power', isPetEnabled());
    const cfg = loadConfig();
    sendToPetWindow(petId, 'performance-mode', {
      gameActive: globalGameActive,
      lowImpact: cfg.gameLowImpactEnabled !== false && globalGameActive,
    });
    applyGameOverlayProfile();
  });

  petWindow.on('closed', () => {
    petWindows.delete(petId);
  });

  if (config.petEnabled) petWindow.show();
  return petWindow;
}

function syncPetWindows() {
  const config = loadConfig();
  const enabledPets = getEnabledPets(config);

  for (const petId of [...petWindows.keys()]) {
    if (!enabledPets.find((p) => p.id === petId)) destroyPetWindow(petId);
  }

  if (!config.petEnabled) {
    for (const [petId, entry] of petWindows) {
      if (entry.window && !entry.window.isDestroyed()) {
        sendToPetWindow(petId, 'pet-power', false);
        entry.window.hide();
      }
    }
    return;
  }

  enabledPets.forEach((pet, index) => {
    createPetWindow(pet.id, index, enabledPets.length, enabledPets);
    const entry = petWindows.get(pet.id);
    if (entry?.window && !entry.window.isDestroyed()) {
      entry.window.show();
      sendToPetWindow(pet.id, 'pet-power', true);
    }
  });

  applyGameOverlayProfile();
  startClickThroughLoop();
  layoutPetWindows();
}

function setupSystemAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      });
      const primary = sources.find((s) => /screen:0:0|Entire|Screen 1/i.test(s.id + s.name)) || sources[0];
      if (!primary) {
        callback({});
        return;
      }
      callback({ video: primary, audio: 'loopback' });
    } catch {
      callback({});
    }
  }, { useSystemPicker: true });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    show: true,
    title: 'Virtual Pet Settings',
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: false,
    webPreferences: webPreferences(),
  });

  const settingsHtml = path.join(__dirname, 'settings', 'index.html');
  settingsWindow.loadFile(settingsHtml);
  settingsWindow.webContents.setBackgroundThrottling(false);

  settingsWindow.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    settingsWindow.hide();
  });

  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow.webContents
      .executeJavaScript('Boolean(window.petAPI)')
      .then((ok) => {
        if (!ok) console.error('Settings: preload did not expose petAPI');
      })
      .catch(() => {});
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function wanderMsFromConfig(config) {
  const n = Math.max(1, config.wanderDuration || 30);
  return config.wanderDurationUnit === 'min' ? n * 60 * 1000 : n * 1000;
}

function startWanderFromConfig() {
  if (!isPetEnabled()) {
    createSettingsWindow();
    return;
  }
  const config = loadConfig();
  const ms = wanderMsFromConfig(config.pets[0] || PET_DEFAULTS);
  for (const pet of getEnabledPets(config)) {
    sendToPetWindow(pet.id, 'wander-session-start', wanderMsFromConfig(pet));
  }
}

let chatWindow = null;
let chatTargetPetId = null;

function createChatWindow(petId = null) {
  const config = loadConfig();
  const target = (petId && config.pets.some((p) => p.id === petId) && petId)
    || config.activePetId
    || config.pets[0]?.id;
  chatTargetPetId = target;
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.loadFile(path.join(__dirname, 'chat', 'index.html'), { query: target ? { petId: target } : {} });
    chatWindow.show();
    chatWindow.focus();
    return;
  }
  chatWindow = new BrowserWindow({
    width: 380,
    height: 500,
    minWidth: 300,
    minHeight: 380,
    show: true,
    title: 'Chat with pet',
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: webPreferences(),
  });
  chatWindow.loadFile(path.join(__dirname, 'chat', 'index.html'), { query: target ? { petId: target } : {} });
  chatWindow.webContents.setBackgroundThrottling(false);
  chatWindow.on('close', (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    chatWindow.hide();
  });
  chatWindow.on('closed', () => {
    chatWindow = null;
  });
}

function windowFromEvent(event) {
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch (_) {
    return null;
  }
}

ipcMain.on('window-min', (event) => {
  const w = windowFromEvent(event);
  if (w && !w.isDestroyed()) w.minimize();
});

ipcMain.on('window-max-toggle', (event) => {
  const w = windowFromEvent(event);
  if (!w || w.isDestroyed()) return;
  if (w.isMaximized()) w.unmaximize();
  else if (w.isMaximizable()) w.maximize();
});

ipcMain.on('window-close', (event) => {
  const w = windowFromEvent(event);
  if (w && !w.isDestroyed()) w.close();
});

ipcMain.on('chat-send', (_, data) => {
  const config = loadConfig();
  const wanted = data?.petId;
  const petId = (wanted && config.pets.some((p) => p.id === wanted) && wanted)
    || chatTargetPetId
    || config.activePetId
    || config.pets[0]?.id;
  if (petId) sendToPetWindow(petId, 'chat-message', { text: String(data?.text || '').slice(0, 200) });
});

ipcMain.on('chat-reply', (event, data) => {
  if (chatWindow && !chatWindow.isDestroyed() && data?.text) {
    chatWindow.webContents.send('chat-reply', { text: String(data.text).slice(0, 300) });
  }
});

function buildAiSystemPrompt(config, petId) {
  const pet = (petId && config.pets.some((p) => p.id === petId))
    ? getPetEntry(config, petId)
    : getPetEntry(config, config.activePetId);
  const name = pet.name || 'Mochi';
  const moodLine = pet.mood
    ? `Current mood: ${pet.mood}. Let it color the reply (grumpy is snappy, sleepy is drowsy, excited is bouncy).`
    : '';
  const mem = (pet.memory && typeof pet.memory === 'object') ? pet.memory : {};
  const memLine = (mem.pats || mem.chats || mem.victoriesSeen || mem.deathsSeen)
    ? `Shared history with this human: patted ${mem.pats || 0}x, chatted ${mem.chats || 0}x, together for ${mem.victoriesSeen || 0} wins and ${mem.deathsSeen || 0} deaths. Weave it in naturally when it fits — never recite it as stats.`
    : '';
  let gameLine = 'No game detected right now.';
  if (lastForegroundTitle && lastForegroundType && lastForegroundType !== 'self' && lastForegroundType !== 'unknown') {
    gameLine = `The human is currently on: "${lastForegroundTitle}" (looks like: ${lastForegroundType}).`;
  }
  const identity = pet.ownerName && pet.ownerName.trim()
    ? `The human chatting with you is named ${pet.ownerName.trim()}. Call them that.`
    : 'You do not know the human\'s name. Never invent one for them, and never call them Ollama, AI, Meta, or any software or company name — those are tools, not people.';
  const persona = pet.aiPersonality && pet.aiPersonality.trim()
    ? `Extra personality for ${name}: ${pet.aiPersonality.trim().slice(0, 500)}`
    : '';
  return [
    `You are ${name}, a playful desktop virtual pet who lives on the human's screen. You are NOT an AI assistant product.`,
    'Personality: cheeky, affectionate, a little gremlin-like, family-friendly always.',
    persona,
    identity,
    moodLine,
    memLine,
    gameLine,
    'Rules: reply in 1-2 short sentences (under 40 words). Never break character. No disallowed content.',
  ]
    .filter(Boolean)
    .join(' ');
}

function aiTargets(config = loadConfig()) {
  const custom = {
    kind: 'custom',
    base: String(config.aiEndpoint || '').trim().replace(/\/+$/, ''),
    key: config.aiKey || '',
    model: String(config.aiModel || '').trim(),
  };
  const ollama = {
    kind: 'ollama',
    base: 'http://127.0.0.1:11434/v1',
    key: '',
    model: String(config.aiOllamaModel || '').trim() || 'llama3.1:8b',
  };
  const list = [];
  if (config.aiProvider === 'ollama') {
    list.push(ollama);
    if (config.aiFallback !== false) list.push(custom);
  } else {
    list.push(custom);
    if (config.aiFallback !== false) list.push(ollama);
  }
  return list.filter((t) => t.base && t.model && (t.kind !== 'custom' || t.key));
}

async function checkAiTarget(target, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const headers = {};
    if (target.key) headers.Authorization = `Bearer ${target.key}`;
    const res = await fetch(`${target.base}/models`, { headers, signal: controller.signal });
    if (!res.ok) return { ok: false, error: `http-${res.status}` };
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('ai-status', async () => {
  const config = loadConfig();
  if (!config.aiEnabled) return { ok: true, state: 'off' };
  for (const target of aiTargets(config)) {
    const check = await checkAiTarget(target);
    if (check.ok) return { ok: true, state: 'online', via: target.kind, ms: check.ms };
  }
  const targets = aiTargets(config);
  if (!targets.length) return { ok: true, state: 'no-key' };
  return { ok: true, state: 'offline', error: 'unreachable' };
});

async function tryAiTarget(target, payload, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { 'Content-Type': 'application/json' };
  if (target.key) headers.Authorization = `Bearer ${target.key}`;
  const body = JSON.stringify({ ...payload, model: target.model });
  let attempt = 0;
  let lastError = { ok: false, error: 'unreachable' };
  try {
    while (attempt < 3) {
      attempt += 1;
      let res;
      try {
        res = await fetch(`${target.base}/chat/completions`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });
      } catch (err) {
        // Undici's top-level message is a useless "fetch failed" — the real
        // reason (ECONNRESET, ETIMEDOUT, EAI_AGAIN, cert errors…) hides in cause.
        const causeMsg = err?.cause
          ? String(err.cause.message || err.cause).slice(0, 120)
          : '';
        const msg = String((err && err.message) || err).slice(0, 120);
        lastError = { ok: false, error: 'unreachable', detail: causeMsg ? `${msg} (${causeMsg})` : msg };
        // Network blips (RST, Cloudflare hiccups) are the flakiest failure
        // class — retry instead of instantly failing over to canned replies.
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 2000));
          continue;
        }
        break;
      }
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        const text = String(data?.choices?.[0]?.message?.content || '').trim().slice(0, 300);
        if (text) return { ok: true, text, via: target.kind };
        lastError = { ok: false, error: 'empty' };
        break;
      }
      let detail = '';
      try {
        detail = String((await res.json())?.error?.message || '').slice(0, 160);
      } catch (_) {}
      lastError = { ok: false, error: `http-${res.status}`, detail };
      if ((res.status === 429 || res.status === 503 || (res.status >= 500 && res.status < 600)) && attempt < 3) {
        await new Promise((r) => setTimeout(r, attempt * 4000));
        continue;
      }
      break;
    }
    return lastError;
  } finally {
    clearTimeout(timer);
  }
}

async function runAiChatTargets(targets, payload) {
  const primary = targets[0];
  let primaryError = null;
  let lastError = { ok: false, error: 'unreachable' };
  for (const target of targets) {
    const res = await tryAiTarget(target, payload);
    if (res.ok) {
      return {
        ...res,
        primaryKind: primary.kind,
        fallbackUsed: target.kind !== primary.kind,
        primaryError,
      };
    }
    if (!primaryError) primaryError = { error: res.error, detail: res.detail };
    lastError = res;
  }
  return lastError;
}

function resolveAiPet(config, petId) {
  return (petId && config.pets.some((p) => p.id === petId))
    ? getPetEntry(config, petId)
    : getPetEntry(config, config.activePetId);
}

ipcMain.handle('ai-chat', async (event, messages) => {
  const config = loadConfig();
  if (!config.aiEnabled) return { ok: false, error: 'disabled' };
  const targets = aiTargets(config);
  if (!targets.length) return { ok: false, error: 'not-configured' };
  const history = Array.isArray(messages) ? messages.slice(-8) : [];
  const payload = {
    messages: [{ role: 'system', content: buildAiSystemPrompt(config, getPetIdFromEvent(event)) }, ...history],
    max_tokens: 150,
    temperature: 0.9,
  };
  return runAiChatTargets(targets, payload);
});

// Proactive chatter: the pet speaks up unprompted. Same provider chain as
// chat (primary + fallback, local or online) — the pet falls back to its
// preset textProactive lines when every target is down.
ipcMain.handle('proactive-chat', async (event, brief) => {
  const config = loadConfig();
  const petId = getPetIdFromEvent(event);
  if (!config.aiEnabled) return { ok: false, error: 'disabled' };
  const targets = aiTargets(config);
  if (!targets.length) return { ok: false, error: 'not-configured' };
  const pet = resolveAiPet(config, petId);
  const situation = String(brief || '').slice(0, 300) || 'Nothing special is happening.';
  const payload = {
    messages: [
      { role: 'system', content: buildAiSystemPrompt(config, petId) },
      { role: 'user', content: `Proactive moment (do NOT wait to be spoken to): ${situation} Address the human directly with one short unprompted remark. Stay in character as ${pet.name || 'Mochi'}.` },
    ],
    max_tokens: 150,
    temperature: 0.95,
  };
  return runAiChatTargets(targets, payload);
});

function sendToPetWindow(petId, channel, data) {
  const entry = petWindows.get(petId);
  if (!entry?.window || entry.window.isDestroyed()) return;
  const send = () => entry.window.webContents.send(channel, data);
  if (entry.window.webContents.isLoading()) {
    entry.window.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function createTray() {
  try {
    tray = new Tray(createTrayIcon());
    updateTray();
    tray.on('click', () => {
      if (isPetEnabled()) createSettingsWindow();
      else setPetEnabled(true);
    });
  } catch (err) {
    console.error('Tray failed:', err);
  }
}

app.on('second-instance', () => {
  if (isPetEnabled()) syncPetWindows();
  createSettingsWindow();
});

app.whenReady().then(() => {
  ensureAvatarsDir();
  ensureDefaultAvatars();
  setupSystemAudioCapture();
  initWin32User32();

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === 'media' || permission === 'display-capture' || permission === 'speaker-selection';
  });

  protocol.handle('pet-avatar', (request) => {
    const fileName = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    const filePath = path.normalize(path.join(AVATARS_DIR, fileName));
    if (!filePath.startsWith(AVATARS_DIR) || !fs.existsSync(filePath)) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  buildAppMenu();
  createTray();

  const config = loadConfig();
  setLaunchOnStartup(!!config.launchOnStartup);

  if (config.petEnabled) {
    syncPetWindows();
  }

  startForegroundWatch();
  syncDetectionWatchers(config);
  syncRemoteServer(config);
  globalShortcut.register('CommandOrControl+Shift+P', () => createSettingsWindow());
  globalShortcut.register('CommandOrControl+Shift+O', () => setPetEnabled(!isPetEnabled()));

  createSettingsWindow();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopForegroundWatch();
  stopDetectionWatchers();
  stopCoreWorker();
  if (passthroughTimer) clearInterval(passthroughTimer);
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

ipcMain.handle('get-config', (event) => {
  const petId = getPetIdFromEvent(event);
  if (petId) return getPetEnrichedConfig(petId);
  return getFullEnrichedConfig();
});

ipcMain.handle('pick-avatar-gif', async (event, slot, petId) => {
  if (!AVATAR_SLOTS.includes(slot)) return getFullEnrichedConfig();

  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Choose ${slot} animation`,
    filters: [
      { name: 'Animations', extensions: ['gif', 'png', 'webp', 'apng'] },
      { name: 'All images', extensions: ['gif', 'png', 'webp', 'jpg', 'jpeg'] },
    ],
    properties: ['openFile'],
  });

  if (canceled || !filePaths[0]) return getFullEnrichedConfig();

  ensureAvatarsDir();
  const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
  if (entry.files.length >= MAX_AVATAR_VARIANTS) return getFullEnrichedConfig();
  const ext = path.extname(filePaths[0]).toLowerCase() || '.gif';
  const taken = new Set(entry.files.map((f) => f.file));
  let destName = '';
  for (let k = 1; k <= MAX_AVATAR_VARIANTS; k++) {
    const cand = `${targetPetId}-${slot}${k === 1 ? '' : k}${ext}`;
    if (!taken.has(cand) && !fs.existsSync(path.join(AVATARS_DIR, cand))) {
      destName = cand;
      break;
    }
  }
  if (!destName) return getFullEnrichedConfig();
  const destPath = path.join(AVATARS_DIR, destName);
  fs.copyFileSync(filePaths[0], destPath);

  entry.files.push({ file: destName, next: 'any' });
  pet[AVATAR_CONFIG_KEYS[slot]] = entry;
  pet.useCustomAvatar = true;
  pet.characterPack = 'custom';
  if (slot === 'idle') {
    const move = asAvatarSlot(pet.gifMove);
    if (!move.files.length) {
      const moveDest = `${targetPetId}-move${ext}`;
      fs.copyFileSync(filePaths[0], path.join(AVATARS_DIR, moveDest));
      move.files.push({ file: moveDest, next: 'any' });
      pet.gifMove = move;
    }
  }
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('remove-avatar-variant', async (_, slot, index, petId) => {
  if (!AVATAR_SLOTS.includes(slot)) return getFullEnrichedConfig();
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= entry.files.length) return getFullEnrichedConfig();
  if (slot === 'idle' && entry.files.length <= 1) return getFullEnrichedConfig();
  const [removed] = entry.files.splice(i, 1);
  if (removed?.file) {
    try {
      fs.unlinkSync(path.join(AVATARS_DIR, removed.file));
    } catch (_) {}
  }
  for (const f of entry.files) {
    if (Array.isArray(f.next)) f.next = f.next.filter((n) => n !== i).map((n) => (n > i ? n - 1 : n));
  }
  pet[AVATAR_CONFIG_KEYS[slot]] = entry;
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('set-avatar-mode', async (_, slot, mode, petId) => {
  if (!AVATAR_SLOTS.includes(slot)) return getFullEnrichedConfig();
  if (!['shuffle', 'order', 'custom'].includes(mode)) return getFullEnrichedConfig();
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
  entry.mode = mode;
  pet[AVATAR_CONFIG_KEYS[slot]] = entry;
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('set-variant-next', async (_, slot, index, next, petId) => {
  if (!AVATAR_SLOTS.includes(slot)) return getFullEnrichedConfig();
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= entry.files.length) return getFullEnrichedConfig();
  if (next !== 'any' && (!Array.isArray(next) || !next.length)) return getFullEnrichedConfig();
  const clean = next === 'any' ? 'any' : [...new Set(next.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < entry.files.length && n !== i))];
  if (clean !== 'any' && !clean.length) return getFullEnrichedConfig();
  entry.files[i].next = clean;
  entry.mode = 'custom';
  pet[AVATAR_CONFIG_KEYS[slot]] = entry;
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('save-character-pack', async (_, name, petId) => {
  const cleanName = String(name || '').trim().replace(/[^A-Za-z0-9 _-]+/g, '').slice(0, 32);
  if (!cleanName) return { ok: false, error: 'bad-name' };
  const dir = path.join(PACKS_DIR, cleanName);
  if (fs.existsSync(dir)) return { ok: false, error: 'exists' };
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  fs.mkdirSync(dir, { recursive: true });
  let saved = 0;
  for (const slot of AVATAR_SLOTS) {
    const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
    entry.files.slice(0, MAX_AVATAR_VARIANTS).forEach((f, i) => {
      const src = path.join(AVATARS_DIR, f.file);
      if (!f.file || !fs.existsSync(src)) return;
      const ext = path.extname(f.file).toLowerCase() || '.gif';
      const dest = path.join(dir, `${PACK_SLOT_FILES[slot]}${i ? i + 1 : ''}${ext}`);
      try {
        fs.copyFileSync(src, dest);
        saved += 1;
      } catch (_) {}
    });
  }
  if (!saved) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
    return { ok: false, error: 'empty' };
  }
  pet.characterPack = cleanName;
  saveConfig(config);
  broadcastConfig();
  return { ok: true, packs: getCharacterPacks() };
});

ipcMain.handle('list-character-packs', () => {
  ensurePacksReadme();
  return getCharacterPacks();
});

ipcMain.handle('apply-character-pack', async (_, name, petId) => {
  const files = getPackFiles(name);
  if (!files.idle || !files.idle.length) return getFullEnrichedConfig();
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  ensureAvatarsDir();
  for (const slot of AVATAR_SLOTS) {
    const entry = asAvatarSlot(pet[AVATAR_CONFIG_KEYS[slot]]);
    for (const old of entry.files) {
      if (!old?.file) continue;
      try {
        fs.unlinkSync(path.join(AVATARS_DIR, old.file));
      } catch (_) {}
    }
    pet[AVATAR_CONFIG_KEYS[slot]] = { mode: 'shuffle', files: [] };
  }
  for (const slot of Object.keys(files)) {
    const fresh = [];
    files[slot].slice(0, MAX_AVATAR_VARIANTS).forEach((src, i) => {
      const ext = path.extname(src).toLowerCase() || '.gif';
      const destName = `${targetPetId}-${slot}${i ? i + 1 : ''}${ext}`;
      fs.copyFileSync(src, path.join(AVATARS_DIR, destName));
      fresh.push({ file: destName, next: 'any' });
    });
    pet[AVATAR_CONFIG_KEYS[slot]] = { mode: 'shuffle', files: fresh };
  }
  pet.useCustomAvatar = true;
  pet.characterPack = name;
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('open-character-packs-folder', async () => {
  ensurePacksReadme();
  shell.openPath(PACKS_DIR);
  return getCharacterPacks();
});

ipcMain.handle('pack-preview', async (_, name) => {
  try {
    const files = getPackFiles(name);
    if (!files.idle || !files.idle.length) return { ok: false };
    ensureAvatarsDir();
    for (const f of fs.readdirSync(AVATARS_DIR)) {
      if (f.startsWith('.preview-')) {
        try {
          fs.unlinkSync(path.join(AVATARS_DIR, f));
        } catch (_) {}
      }
    }
    const src = files.idle[0];
    const safe = String(name || 'pack').replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 24) || 'pack';
    const destName = `.preview-${safe}${path.extname(src).toLowerCase() || '.gif'}`;
    fs.copyFileSync(src, path.join(AVATARS_DIR, destName));
    return { ok: true, url: `pet-avatar://local/${encodeURIComponent(destName)}` };
  } catch (_) {
    return { ok: false };
  }
});

ipcMain.handle('clear-avatar-gif', async (_, slot, petId) => {
  if (!AVATAR_SLOTS.includes(slot)) return getFullEnrichedConfig();
  // Idle art is required — without it there is nothing to show.
  if (slot === 'idle') return getFullEnrichedConfig();

  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  const key = AVATAR_CONFIG_KEYS[slot];
  const entry = asAvatarSlot(pet[key]);
  for (const f of entry.files) {
    if (!f?.file) continue;
    const filePath = path.join(AVATARS_DIR, f.file);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  entry.files = [];
  pet[key] = entry;

  const hasAny = AVATAR_SLOTS.some((s) => asAvatarSlot(pet[AVATAR_CONFIG_KEYS[s]]).files.length);
  if (!hasAny) pet.useCustomAvatar = false;

  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('pick-speech-sound', async (event, slot, petId) => {
  const useSlot = slot === 'all' || SPEECH_SOUND_SLOTS.includes(slot) ? slot : 'all';
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: useSlot === 'all' ? 'Choose default speech sound' : `Choose sound: ${useSlot}`,
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'm4a'] },
      { name: 'All files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });

  if (canceled || !filePaths[0]) return getFullEnrichedConfig();

  ensureAvatarsDir();
  const ext = path.extname(filePaths[0]).toLowerCase() || '.mp3';
  const removeFile = (name) => {
    if (!name) return;
    try {
      fs.unlinkSync(path.join(AVATARS_DIR, name));
    } catch (_) {}
  };

  if (useSlot === 'all') {
    const destName = `${targetPetId}-speech${ext}`;
    if (pet.speechSound && pet.speechSound !== destName) removeFile(pet.speechSound);
    fs.copyFileSync(filePaths[0], path.join(AVATARS_DIR, destName));
    pet.speechSound = destName;
    pet.speechSoundEnabled = true;
  } else {
    if (!pet.speechSounds || typeof pet.speechSounds !== 'object') pet.speechSounds = {};
    const destName = `${targetPetId}-speech-${useSlot}${ext}`;
    if (pet.speechSounds[useSlot] && pet.speechSounds[useSlot] !== destName) {
      removeFile(pet.speechSounds[useSlot]);
    }
    fs.copyFileSync(filePaths[0], path.join(AVATARS_DIR, destName));
    pet.speechSounds[useSlot] = destName;
  }
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('clear-speech-sound', async (_, slot, petId) => {
  const useSlot = slot === 'all' || SPEECH_SOUND_SLOTS.includes(slot) ? slot : 'all';
  const config = loadConfig();
  const targetPetId = petId || config.activePetId || config.pets[0]?.id;
  const pet = getPetEntry(config, targetPetId);
  const removeFile = (name) => {
    if (!name) return;
    try {
      fs.unlinkSync(path.join(AVATARS_DIR, name));
    } catch (_) {}
  };
  if (useSlot === 'all') {
    removeFile(pet.speechSound);
    pet.speechSound = '';
    pet.speechSoundEnabled = false;
  } else if (pet.speechSounds && typeof pet.speechSounds === 'object') {
    removeFile(pet.speechSounds[useSlot]);
    pet.speechSounds[useSlot] = '';
  }
  saveConfig(config);
  broadcastConfig();
  return getFullEnrichedConfig();
});

ipcMain.handle('set-pet-enabled', (_, enabled) => {
  setPetEnabled(!!enabled);
  buildAppMenu();
  return isPetEnabled();
});

let memorySaveTimer = null;
let memoryDirty = false;

function scheduleMemorySave() {
  memoryDirty = true;
  if (memorySaveTimer) return;
  memorySaveTimer = setTimeout(() => {
    memorySaveTimer = null;
    if (!memoryDirty) return;
    memoryDirty = false;
    try {
      saveConfig(loadConfig());
    } catch (_) {}
  }, 5000);
}

setInterval(() => {
  if (memoryDirty && !memorySaveTimer) scheduleMemorySave();
}, 60000).unref?.();

ipcMain.on('pet-memory', (event, patch) => {
  const petId = getPetIdFromEvent(event);
  if (!petId || !patch || typeof patch !== 'object') return;
  const config = loadConfig();
  const pet = config.pets.find((p) => p.id === petId);
  if (!pet) return;
  if (typeof patch.mood === 'string' && patch.mood) pet.mood = patch.mood.slice(0, 20);
  if (patch.memory && typeof patch.memory === 'object') {
    pet.memory = freshMemory({ ...pet.memory, ...patch.memory });
  }
  scheduleMemorySave();
});

ipcMain.on('pet-bond', (event, data) => {
  const petId = getPetIdFromEvent(event);
  const otherId = data?.otherId;
  const delta = Number(data?.delta);
  if (!petId || !otherId || petId === otherId || !Number.isFinite(delta) || !delta) return;
  const config = loadConfig();
  if (!config.pets.some((p) => p.id === otherId)) return;
  if (!config.relationships || typeof config.relationships !== 'object') config.relationships = {};
  const key = bondKey(petId, otherId);
  const before = bondScore(config.relationships, petId, otherId);
  const after = Math.max(0, Math.min(100, before + delta));
  config.relationships[key] = {
    score: after,
    updatedAt: Date.now(),
  };
  scheduleMemorySave();
  // Milestone moments: tell both pets so they can celebrate visibly.
  const crossed = [40, 70].find((t) => before < t && after >= t);
  if (crossed) {
    const me = config.pets.find((p) => p.id === petId);
    const other = config.pets.find((p) => p.id === otherId);
    const aName = me?.name || 'Pet';
    const bName = other?.name || 'Pet';
    sendToPetWindow(petId, 'bond-milestone', { otherId, otherName: bName, stage: crossed });
    sendToPetWindow(otherId, 'bond-milestone', { otherId: petId, otherName: aName, stage: crossed });
  }
});

function backupConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const dir = path.dirname(CONFIG_PATH);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(dir, `pet-config.backup-${stamp}.json`);
    fs.copyFileSync(CONFIG_PATH, dest);
    const all = fs.readdirSync(dir).filter((f) => /^pet-config\.backup-.*\.json$/.test(f)).sort();
    while (all.length > 5) {
      try {
        fs.unlinkSync(path.join(dir, all.shift()));
      } catch (_) {}
    }
    return dest;
  } catch (_) {
    return null;
  }
}

ipcMain.handle('backup-config', () => backupConfigFile());

ipcMain.handle('restore-backup', () => {
  try {
    const dir = path.dirname(CONFIG_PATH);
    const all = fs.readdirSync(dir).filter((f) => /^pet-config\.backup-.*\.json$/.test(f)).sort();
    if (!all.length) return { ok: false, error: 'no-backup' };
    const latest = path.join(dir, all[all.length - 1]);
    const parsed = JSON.parse(fs.readFileSync(latest, 'utf8'));
    saveConfig(parsed);
    syncPetWindows();
    broadcastConfig();
    return { ok: true, file: all[all.length - 1] };
  } catch (_) {
    return { ok: false, error: 'restore-failed' };
  }
});

ipcMain.handle('save-config', (_, config) => {
  const prev = loadConfig();
  // Runtime state (memory/mood/bonds) lives outside the settings form —
  // the disk copy is always its freshest writer, so never let a settings
  // save clobber it with the form's older snapshot.
  try {
    if (prev && Array.isArray(config.pets)) {
      for (const p of config.pets) {
        const live = prev.pets.find((q) => q.id === p.id);
        if (!live) continue;
        if (live.memory && typeof live.memory === 'object') p.memory = freshMemory(live.memory);
        if (typeof live.mood === 'string' && live.mood) p.mood = live.mood;
      }
    }
    if (prev?.relationships && typeof prev.relationships === 'object') {
      config.relationships = prev.relationships;
    }
  } catch (_) {}
  saveConfig(config);
  setLaunchOnStartup(!!config.launchOnStartup);

  const pet0 = config.pets?.[0];
  const prevPet0 = prev.pets?.[0];
  const contextOn = pet0?.contextReactionsEnabled !== false;
  const prevContextOn = prevPet0?.contextReactionsEnabled !== false;
  if (
    config.gameLowImpactEnabled !== prev.gameLowImpactEnabled ||
    config.hidePetsWhileGaming !== prev.hidePetsWhileGaming
  ) {
    broadcastPerformanceMode();
  }
  if (
    config.gameLowImpactEnabled !== prev.gameLowImpactEnabled ||
    config.hidePetsWhileGaming !== prev.hidePetsWhileGaming ||
    config.alwaysOnTop !== prev.alwaysOnTop
  ) {
    applyGameOverlayProfile();
  }
  if (contextOn !== prevContextOn || config.gameLowImpactEnabled !== prev.gameLowImpactEnabled) {
    startForegroundWatch();
  }
  if (
    config.gameProcessWatchEnabled !== prev.gameProcessWatchEnabled ||
    config.gameProcessList !== prev.gameProcessList ||
    config.gameOcrWatchEnabled !== prev.gameOcrWatchEnabled ||
    config.gameOcrIntervalSec !== prev.gameOcrIntervalSec ||
    config.gameOcrDebugEdges !== prev.gameOcrDebugEdges
  ) {
    syncDetectionWatchers(config);
  }
  if (config.remoteEnabled !== prev.remoteEnabled || config.remotePort !== prev.remotePort) {
    syncRemoteServer(config);
  }

  if (config.petEnabled !== prev.petEnabled) {
    setPetEnabled(!!config.petEnabled, false);
  } else if (
    config.alwaysOnTop !== prev.alwaysOnTop ||
    config.hidePetsWhileGaming !== prev.hidePetsWhileGaming ||
    JSON.stringify(config.pets?.map((p) => `${p.id}:${p.enabled !== false}`)) !==
      JSON.stringify(prev.pets?.map((p) => `${p.id}:${p.enabled !== false}`))
  ) {
    syncPetWindows();
  }
  layoutPetWindows();

  buildAppMenu();
  return broadcastConfig();
});

ipcMain.handle('add-pet', () => {
  const config = loadConfig();
  if (config.pets.length >= MAX_PETS) return getFullEnrichedConfig();
  const usedNames = new Set(config.pets.map((p) => p.name));
  const name = PET_NAME_POOL.find((n) => !usedNames.has(n)) || `Pet ${config.pets.length + 1}`;
  const pet = createDefaultPet(newPetId(), name);
  config.pets.push(pet);
  config.activePetId = pet.id;
  saveConfig(config);
  syncPetWindows();
  return broadcastConfig();
});

ipcMain.handle('remove-pet', (_, petId) => {
  const config = loadConfig();
  if (config.pets.length <= 1) return getFullEnrichedConfig();
  config.pets = config.pets.filter((p) => p.id !== petId);
  if (config.activePetId === petId) config.activePetId = config.pets[0].id;
  saveConfig(config);
  destroyPetWindow(petId);
  syncPetWindows();
  return broadcastConfig();
});

ipcMain.handle('duplicate-pet', (_, petId) => {
  const config = loadConfig();
  if (config.pets.length >= MAX_PETS) return getFullEnrichedConfig();
  const source = getPetEntry(config, petId);
  const copy = { ...source, id: newPetId(), name: `${source.name} Jr` };
  for (const key of AVATAR_CONFIG_VALUE_KEYS) copy[key] = asAvatarSlot(copy[key]);
  config.pets.push(copy);
  config.activePetId = copy.id;
  saveConfig(config);
  syncPetWindows();
  return broadcastConfig();
});

ipcMain.handle('test-process-watch', async () => {
  const result = await queryRunningGameExes();
  return result;
});

ipcMain.handle('test-ocr-scan', async () => {
  flashOcrDebugEdges();
  const res = await runOcrScan(false);
  if (res && res.ok) {
    // A test should prove the WHOLE chain: feed what was read straight into
    // the reaction pipeline so the pets respond to test scans too.
    let testMatch = null;
    try {
      testMatch = matchOcrText(res.text) || null;
    } catch (_) {}
    logOcrScan({ text: String(res.text || '').slice(0, 300), match: testMatch, at: (testMatch && testMatch.at) ?? null, test: true });
    return { ok: true, text: String(res.text || '').slice(0, 300) };
  }
  logOcrScan({ error: (res && res.error) || 'scan-failed', test: true });
  return { ok: false, error: (res && res.error) || 'scan-failed' };
});

ipcMain.handle('get-cursor', () => {
  const p = screen.getCursorScreenPoint();
  return { x: p.x, y: p.y };
});

ipcMain.handle('get-work-area', () => getWorkArea());

ipcMain.handle('get-pet-bounds', (event) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  const petWindow = entry?.window;
  if (!petWindow || petWindow.isDestroyed() || !petWindow.isVisible()) return null;
  const b = petWindow.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height, petId };
});

ipcMain.handle('move-pet', (event, { x, y }) => {
  if (!isPetEnabled()) return null;
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (!entry?.window || entry.window.isDestroyed()) return null;
  const resolved = clampPetWindowPosition(petId, x, y);
  entry.window.setPosition(Math.round(resolved.x), Math.round(resolved.y));
  return { x: resolved.x, y: resolved.y };
});

ipcMain.handle('get-other-pets', (event) => {
  const selfId = getPetIdFromEvent(event);
  if (!selfId) return [];
  const out = [];
  for (const [petId, entry] of petWindows) {
    if (petId === selfId || !entry.window || entry.window.isDestroyed() || !entry.window.isVisible()) {
      continue;
    }
    const config = loadConfig();
    const pet = getPetEntry(config, petId);
    const b = entry.window.getBounds();
    const halfW = (pet.bodyHitWidth ?? 110) / 2;
    const left = pet.bodyHitLeft ?? 0;
    out.push({
      id: petId,
      name: pet.name || 'Pet',
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      bodyHitWidth: pet.bodyHitWidth ?? 110,
      bodyHitLeft: left,
      halfWidth: halfW,
      centerX: b.x + b.width / 2 + left,
      minSeparation: halfW * 2 + getPetCollisionGap(),
      bond: bondScore(config.relationships, selfId, petId),
    });
  }
  return out;
});

ipcMain.on('pet-cursor-over', (event, over) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (!entry?.window || entry.window.isDestroyed() || entry.dragging) return;
  const wantsOver = !!over;
  if (wantsOver !== entry.mouseOver) {
    entry.mouseOver = wantsOver;
    entry.window.setIgnoreMouseEvents(!wantsOver, { forward: true });
  }
});

ipcMain.on('pet-hit-regions', (event, regions) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (entry) entry.hitRegions = regions;
});

ipcMain.on('set-ignore-mouse', (event, ignore) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (!entry?.window || entry.window.isDestroyed() || !entry.mouseOver) return;
  entry.window.setIgnoreMouseEvents(ignore, { forward: true });
});

ipcMain.on('open-settings', () => createSettingsWindow());

ipcMain.on('show-pet-menu', (event) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (entry?.window && !entry.window.isDestroyed()) {
    buildPetContextMenu(petId).popup({ window: entry.window });
  }
});

ipcMain.on('pet-drag-start', (event, offset) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (!entry) return;
  entry.dragging = true;
  // Sanity-clamp a stale grab offset (e.g. bounds shifted between the
  // long-press and the drag start) so she can't fling off-screen.
  if (entry.window && !entry.window.isDestroyed()) {
    const b = entry.window.getBounds();
    let ox = Number(offset?.x);
    let oy = Number(offset?.y);
    if (!Number.isFinite(ox) || ox < -b.width || ox > b.width * 2) ox = b.width / 2;
    if (!Number.isFinite(oy) || oy < -b.height || oy > b.height * 2) oy = b.height - 120;
    entry.dragOffset = { x: ox, y: oy };
  } else {
    entry.dragOffset = { x: offset?.x ?? 0, y: offset?.y ?? 0 };
  }
  entry.lastDragX = null;
  entry.lastDragY = null;
  if (entry.window && !entry.window.isDestroyed()) {
    entry.window.setIgnoreMouseEvents(false);
  }
  applyGameOverlayProfile();
  refreshPassthroughDragLoop();
  if (entry.window && !entry.window.isDestroyed()) {
    raisePetWindowTop(entry);
    if (entry.window.setVisibleOnAllWorkspaces) {
      entry.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  }
});

ipcMain.on('pet-drag-end', (event) => {
  const petId = getPetIdFromEvent(event);
  const entry = petId ? petWindows.get(petId) : null;
  if (entry?.dragging) finishPetDrag(petId, entry);
});

ipcMain.on('try-close-random-app', (event) => {
  runChaosClose(true, getPetIdFromEvent(event));
});

ipcMain.handle('test-close-random-app', () => runChaosClose(false));

ipcMain.on('prank-trigger', (event, effect) => {
  runPrank({ petId: getPetIdFromEvent(event), effect: PRANK_EFFECTS.includes(effect) ? effect : undefined });
});

ipcMain.handle('prank-test', (event, effect, petId) => {
  return runPrank({ effect, petId: petId || undefined, force: true });
});

ipcMain.on('prank-done', () => {
  closePrankWindow('done');
});

ipcMain.on('prank-abort', () => {
  closePrankWindow('abort');
});

ipcMain.on('audio-level', (_, data) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('audio-level', data);
  }
});

ipcMain.on('system-audio-level', (_, data) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('audio-level', data);
  }
  for (const [, entry] of petWindows) {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('system-audio-level', data);
    }
  }
});

ipcMain.on('system-audio-stopped', () => {
  const payload = { connected: false, level: 0, dancing: false };
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('audio-level', payload);
  }
  for (const [, entry] of petWindows) {
    if (entry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('system-audio-level', payload);
    }
  }
});

ipcMain.on('tag-session-start', (event, data) => {
  const starterId = getPetIdFromEvent(event);
  if (!starterId || !data?.partnerId) return;
  if (tagSessions.has(starterId) || tagSessions.has(data.partnerId)) return;
  startTagSessionForPets(starterId, data.partnerId, data.partnerName, data.durationMs || 8000);
});

ipcMain.on('tag-session-end', (event) => {
  const petId = getPetIdFromEvent(event);
  if (petId) clearTagSessionForPet(petId);
});

ipcMain.on('gift-send', (event, data) => {
  const fromId = getPetIdFromEvent(event);
  if (!fromId || !data?.toId) return;
  const from = getPetEntry(loadConfig(), fromId);
  sendToPetWindow(data.toId, 'gift-receive', { fromId, fromName: from?.name || 'Pet' });
});

ipcMain.on('social-greet', (event, data) => {
  const fromId = getPetIdFromEvent(event);
  if (!fromId || !data?.toId) return;
  const from = getPetEntry(loadConfig(), fromId);
  sendToPetWindow(data.toId, 'social-greet-receive', {
    fromId,
    fromName: from?.name || 'Pet',
    usedRaw: Array.isArray(data?.usedRaw) ? data.usedRaw.slice(0, 6) : [],
  });
});

ipcMain.on('social-chat', (event, data) => {
  const fromId = getPetIdFromEvent(event);
  if (!fromId || !data?.toId) return;
  const from = getPetEntry(loadConfig(), fromId);
  sendToPetWindow(data.toId, 'social-chat-receive', {
    fromId,
    fromName: from?.name || 'Pet',
    turn: data?.turn || 1,
    maxTurns: data?.maxTurns || 3,
    usedRaw: Array.isArray(data?.usedRaw) ? data.usedRaw.slice(0, 6) : [],
  });
});

ipcMain.on('social-jealous', (event, data) => {
  const fromId = getPetIdFromEvent(event);
  if (!fromId || !data?.toId) return;
  const from = getPetEntry(loadConfig(), fromId);
  sendToPetWindow(data.toId, 'social-jealous-receive', {
    fromId,
    fromName: from?.name || 'Pet',
  });
});

function voxBase(config = loadConfig()) {
  const pet = config.pets?.[0];
  const raw = (config.voiceVoxUrl || pet?.voiceVoxUrl || 'http://127.0.0.1:50021').trim();
  return raw.replace(/\/+$/, '');
}

// The internal CORE does not auto-convert English to katakana the way the
// VOICEVOX app does, so unknown English words get spelled letter by letter
// ("sleepy" -> "S l e e p y"). Convert ASCII runs to katakana first — the
// external engine reads katakana as-is, so this is safe for both backends.
const ROMAJI_VOICE_EXCEPTIONS = {
  yum: 'ヤム', yummy: 'ヤミー', nom: 'ノム', rawr: 'ラワー', grr: 'グルル',
  purr: 'プルル', meow: 'ニャー', zzz: 'スースー', boop: 'ブープ',
  yay: 'イェーイ', woo: 'ウー', oof: 'ウーフ', whee: 'ウィー', gotcha: 'ガッチャ',
  hello: 'ハロー', hey: 'ヘイ', hi: 'ハイ', thanks: 'サンクス', thank: 'サンク',
  sorry: 'ソーリー', cute: 'キュート', love: 'ラブ', happy: 'ハッピー',
  sleepy: 'スリーピー', tired: 'タイヤード', snack: 'スナック', gift: 'ギフト',
  champion: 'チャンピオン', victory: 'ビクトリー', danger: 'デンジャー',
  too: 'トゥー', see: 'スィー', zoo: 'ズー', you: 'ユー', won: 'ワン',
  lucky: 'ラッキー', party: 'パーティ', my: 'ミー',
  // Pronouns & helpers (native readings, not romaji spelling)
  the: 'ザ', that: 'ザット', this: 'ジス', these: 'ジーズ', those: 'ゾーズ',
  they: 'ゼイ', them: 'ゼム', then: 'ゼン', there: 'ゼア', their: 'ゼア',
  your: 'ユア', youre: 'ユア', yours: 'ユアズ', are: 'アー', our: 'アワー',
  was: 'ワズ', were: 'ワー', is: 'イズ', be: 'ビー', been: 'ビーン',
  has: 'ハズ', have: 'ハブ', had: 'ハド', do: 'ドゥー', does: 'ダズ',
  did: 'ディド', will: 'ウィル', would: 'ウッド', can: 'キャン', cant: 'キャント',
  could: 'クッド', should: 'シュッド', not: 'ナット', no: 'ノー', yes: 'イエス',
  so: 'ソウ', to: 'トゥー', of: 'オブ', or: 'オー', and: 'アンド',
  for: 'フォー', with: 'ウィズ', from: 'フロム', up: 'アップ', out: 'アウト',
  all: 'オール', one: 'ワン', me: 'ミー', we: 'ウィー', new: 'ニュー',
  who: 'フー', what: 'ホワット', when: 'ウェン', where: 'ウェア', why: 'ワイ',
  which: 'ウィッチ', while: 'ワイル', more: 'モア',
  // Feelings & states
  good: 'グッド', morning: 'モーニング', night: 'ナイト', love: 'ラブ',
  like: 'ライク', want: 'ウォント', need: 'ニード', know: 'ノウ',
  eat: 'イート', think: 'シンク', amazing: 'アメージング',
  sorry: 'ソーリー', please: 'プリーズ', welcome: 'ウェルカム', come: 'カム',
  here: 'ヒア', very: 'ベリー', really: 'リアリー', every: 'エブリ',
  easy: 'イージー', hard: 'ハード', normal: 'ノーマル',
  // Play & fun
  look: 'ルック', food: 'フード', birthday: 'バースデー', friend: 'フレンド',
  treat: 'トリート', senpai: 'センパイ', ohayo: 'オハヨウ',
  raw: 'ロー', paw: 'ポー', yawn: 'ヨーン', nom: 'ナム',
  // Games (boss guides, builds)
  boss: 'ボス', level: 'レベル', battle: 'バトル', defense: 'ディフェンス',
  defeat: 'ディフィート', strategy: 'ストラテジー', guide: 'ガイド',
  build: 'ビルド', weapon: 'ウェポン', armor: 'アーマー', potion: 'ポーション',
  heal: 'ヒール', magic: 'マジック', spell: 'スペル', stage: 'ステージ',
  clear: 'クリア', continue: 'コンティニュー', retry: 'リトライ',
  save: 'セーブ', load: 'ロード', start: 'スタート', option: 'オプション',
  menu: 'メニュー', awesome: 'オーサム', call: 'コール',
  how: 'ハウ', beat: 'ビート', lets: 'レッツ', game: 'ゲーム', much: 'マッチ',
  play: 'プレイ',
};

const ROMAJI_KANA_3 = {
  kya: 'キャ', kyu: 'キュ', kyo: 'キョ',
  sha: 'シャ', shu: 'シュ', sho: 'ショ',
  cha: 'チャ', chu: 'チュ', cho: 'チョ',
  nya: 'ニャ', nyu: 'ニュ', nyo: 'ニョ',
  hya: 'ヒャ', hyu: 'ヒュ', hyo: 'ヒョ',
  mya: 'ミャ', myu: 'ミュ', myo: 'ミョ',
  rya: 'リャ', ryu: 'リュ', ryo: 'リョ',
  gya: 'ギャ', gyu: 'ギュ', gyo: 'ギョ',
  jya: 'ジャ', jyu: 'ジュ', jyo: 'ジョ',
  bya: 'ビャ', byu: 'ビュ', byo: 'ビョ',
  pya: 'ピャ', pyu: 'ピュ', pyo: 'ピョ',
  dye: 'ジェ', she: 'シェ', che: 'チェ',
};

const ROMAJI_KANA_2 = {
  ka: 'カ', ki: 'キ', ku: 'ク', ke: 'ケ', ko: 'コ',
  sa: 'サ', shi: 'シ', su: 'ス', se: 'セ', so: 'ソ',
  ta: 'タ', chi: 'チ', tsu: 'ツ', te: 'テ', to: 'ト',
  na: 'ナ', ni: 'ニ', nu: 'ヌ', ne: 'ネ', no: 'ノ',
  ha: 'ハ', hi: 'ヒ', fu: 'フ', he: 'ヘ', ho: 'ホ',
  ma: 'マ', mi: 'ミ', mu: 'ム', me: 'メ', mo: 'モ',
  ya: 'ヤ', yu: 'ユ', yo: 'ヨ',
  ra: 'ラ', ri: 'リ', ru: 'ル', re: 'レ', ro: 'ロ',
  wa: 'ワ', wi: 'ウィ', wu: 'ウ', we: 'ウェ', wo: 'ウォ',
  ga: 'ガ', gi: 'ギ', gu: 'グ', ge: 'ゲ', go: 'ゴ',
  za: 'ザ', ji: 'ジ', zu: 'ズ', ze: 'ゼ', zo: 'ゾ',
  da: 'ダ', di: 'ディ', du: 'ドゥ', de: 'デ', do: 'ド',
  ba: 'バ', bi: 'ビ', bu: 'ブ', be: 'ベ', bo: 'ボ',
  pa: 'パ', pi: 'ピ', pu: 'プ', pe: 'ペ', po: 'ポ',
  ca: 'カ', ci: 'シ', cu: 'ク', ce: 'セ', co: 'コ',
  fa: 'ファ', fi: 'フィ', fe: 'フェ', fo: 'フォ',
  va: 'ヴァ', vi: 'ヴィ', ve: 'ヴェ', vo: 'ヴォ',
  ja: 'ジャ', ju: 'ジュ', jo: 'ジョ',
  la: 'ラ', li: 'リ', lu: 'ル', le: 'レ', lo: 'ロ',
  xa: 'ザ', xi: 'ジ', xu: 'ズ', xe: 'ゼ', xo: 'ゾ',
  ye: 'イェ', yi: 'イ', wh: 'ホ',
  tha: 'ザ', thi: 'ジ', thu: 'ズ', the: 'ゼ', tho: 'ゾ', th: 'ズ',
  aw: 'オー',
  my: 'ミ', ny: 'ニ', dy: 'ディ', ty: 'ティ', ky: 'キ',
  sy: 'シ', py: 'ピ', ry: 'リ', gy: 'ギ', jy: 'ジ',
  hy: 'ヒ', by: 'ビ', fy: 'フィ', vy: 'ヴィ', chy: 'チ',
  sh: 'シュ', ch: 'チュ', qu: 'ク',
  aa: 'アー', ii: 'イー', uu: 'ウー', ee: 'エー', oo: 'オー', ou: 'オー',
};

const ROMAJI_KANA_1 = {
  a: 'ア', i: 'イ', u: 'ウ', e: 'エ', o: 'オ',
  n: 'ン',
  k: 'ク', s: 'ス', t: 'ト', h: 'フ', m: 'ム', y: 'イ', r: 'ル',
  w: 'ウ', g: 'グ', z: 'ズ', d: 'ド', b: 'ブ', p: 'プ',
  c: 'ク', f: 'フ', v: 'ヴ', j: 'ジ', l: 'ル', x: 'クス', q: 'ク',
};

function romajiWordToKatakana(word) {
  const rawLower = word.toLowerCase();
  if (ROMAJI_VOICE_EXCEPTIONS[rawLower]) return ROMAJI_VOICE_EXCEPTIONS[rawLower];
  let lower = rawLower.replace(/l/g, 'r').replace(/(c|g|s)e$/, (m, p) => (p === 'g' ? 'ジ' : 'ス'));
  let out = '';
  let i = 0;
  while (i < lower.length) {
    const c = lower[i];
    const next = lower[i + 1] || '';
    if (c === next && 'bcdfghjklmpqrstvwxz'.includes(c)) {
      out += c === 'n' ? 'ン' : 'ッ';
      i += 1;
      continue;
    }
    if (c === 'n' && (!next || !'aeiouyn'.includes(next))) {
      out += 'ン';
      i += 1;
      continue;
    }
    const three = lower.slice(i, i + 3);
    if (ROMAJI_KANA_3[three]) {
      out += ROMAJI_KANA_3[three];
      i += 3;
      continue;
    }
    const two = lower.slice(i, i + 2);
    if (ROMAJI_KANA_2[two]) {
      out += ROMAJI_KANA_2[two];
      i += 2;
      continue;
    }
    if (ROMAJI_KANA_1[c]) {
      out += ROMAJI_KANA_1[c];
      i += 1;
      continue;
    }
    out += lower[i];
    i += 1;
  }
  return out;
}

function katakanaForVoice(text) {
  const converted = String(text || '')
    .replace(/['’]/g, '')
    .replace(/[a-zA-Z]+/g, (word) => romajiWordToKatakana(word));
  return (
    converted
      // "~" reads as an awkward pause — a long vowel flows instead.
      .replace(/~+/g, 'ー')
      // Spaces between katakana each force a phrase break (pause).
      // Join them so short lines flow; other spacing is untouched.
      // (Lookahead: plain /g/ would skip every other space.)
      .replace(/([\u30A0-\u30FF]) (?=[\u30A0-\u30FF])/g, '$1')
  );
}

async function voxFetchJson(base, apiPath, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base + apiPath, { ...options, signal: controller.signal });
    if (!res.ok) return { ok: false, error: `http-${res.status}` };
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: 'unreachable', detail: String(err?.message || err).slice(0, 160) };
  } finally {
    clearTimeout(timer);
  }
}

function voxBackend(config = loadConfig()) {
  const pet = getPetEntry(config, config.activePetId);
  return pet.voiceVoxBackend === 'builtin' ? 'builtin' : 'external';
}

function voxDevice(config = loadConfig()) {
  return config.voiceDevice === 'directml' ? 'directml' : 'cpu';
}

ipcMain.handle('vox-test', async () => {
  const config = loadConfig();
  if (voxBackend(config) === 'builtin') {
    if (!isCoreInstalled()) return { ok: false, error: 'not-installed', hint: 'Download the built-in voice first.' };
    try {
      const device = voxDevice(config);
      const init = await coreInit(device);
      const speakers = await coreSpeakers(device);
      return {
        ok: true,
        version: 'built-in core',
        speakers: speakers.length,
        gpuActive: !!init.gpuActive,
        device,
      };
    } catch (err) {
      return { ok: false, error: 'init-failed', detail: String((err && err.message) || err).slice(0, 160) };
    }
  }
  const base = voxBase(config);
  const version = await voxFetchJson(base, '/version');
  if (!version.ok) return { ok: false, error: version.error, hint: 'Is VOICEVOX running? Launch it, then retry.' };
  const speakers = await voxFetchJson(base, '/speakers');
  const count = speakers.ok && Array.isArray(speakers.data) ? speakers.data.length : 0;
  return { ok: true, version: String(version.data || ''), speakers: count };
});

ipcMain.handle('vox-speakers', async () => {
  const config = loadConfig();
  if (voxBackend(config) === 'builtin') {
    if (!isCoreInstalled()) return { ok: false, error: 'not-installed' };
    try {
      const speakers = await coreSpeakers(voxDevice(config));
      return { ok: true, speakers, models: listInstalledModels() };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err).slice(0, 160) };
    }
  }
  const base = voxBase(config);
  const res = await voxFetchJson(base, '/speakers');
  if (!res.ok || !Array.isArray(res.data)) return { ok: false, error: res.error || 'bad-response' };
  const out = [];
  for (const sp of res.data) {
    for (const style of sp.styles || []) {
      out.push({ id: style.id, label: `${sp.name}（${style.name}）` });
    }
  }
  return { ok: true, speakers: tagAndSortSpeakers(out) };
});

let voxDownloadToken = null;

ipcMain.handle('vox-core-status', () => {
  return {
    ok: true,
    installed: isCoreInstalled(),
    downloading: !!voxDownloadToken,
    models: listInstalledModels(),
    extraVoices: extraVoiceStatus(),
  };
});

let voxGpuToken = null;

ipcMain.handle('vox-gpu-status', () => {
  return { ok: true, installed: isGpuPackInstalled(), downloading: !!voxGpuToken };
});

ipcMain.handle('vox-gpu-download', async () => {
  if (voxGpuToken || voxDownloadToken) return { ok: false, error: 'already-downloading' };
  const token = { cancelled: false, controller: new AbortController(), cancel: null };
  voxGpuToken = token;
  const emit = (payload) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('vox-core-progress', payload);
    }
  };
  try {
    await downloadGpuPack((ev) => emit(ev), token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 200) };
  } finally {
    voxGpuToken = null;
  }
});

ipcMain.handle('vox-gpu-cancel', () => {
  if (voxGpuToken) {
    voxGpuToken.cancelled = true;
    try {
      voxGpuToken.controller.abort();
    } catch (_) {}
    try {
      if (typeof voxGpuToken.cancel === 'function') voxGpuToken.cancel();
    } catch (_) {}
  }
  return { ok: true };
});

ipcMain.handle('vox-model-download', async (_, vvm) => {
  if (voxDownloadToken) return { ok: false, error: 'already-downloading' };
  const token = { cancelled: false, controller: new AbortController(), cancel: null };
  voxDownloadToken = token;
  const emit = (payload) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('vox-core-progress', payload);
    }
  };
  try {
    await downloadModel(String(vvm || ''), (ev) => emit(ev), token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 200) };
  } finally {
    voxDownloadToken = null;
  }
});

ipcMain.handle('vox-core-cancel', () => {
  if (voxDownloadToken) {
    voxDownloadToken.cancelled = true;
    try {
      voxDownloadToken.controller.abort();
    } catch (_) {}
    try {
      if (typeof voxDownloadToken.cancel === 'function') voxDownloadToken.cancel();
    } catch (_) {}
  }
  return { ok: true };
});

ipcMain.handle('vox-core-download', async () => {
  if (voxDownloadToken) return { ok: false, error: 'already-downloading' };
  const token = { cancelled: false, controller: new AbortController(), cancel: null };
  voxDownloadToken = token;
  const emit = (payload) => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('vox-core-progress', payload);
    }
  };
  try {
    await downloadCore((ev) => emit(ev), token);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err).slice(0, 200) };
  } finally {
    voxDownloadToken = null;
  }
});

function pruneTtsCache() {
  let files = [];
  try {
    files = fs
      .readdirSync(AVATARS_DIR)
      .filter((n) => /^tts-[0-9a-f]{40}\.wav$/i.test(n))
      .map((n) => {
        try {
          return { n, mtime: fs.statSync(path.join(AVATARS_DIR, n)).mtimeMs };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime);
  } catch (_) {
    return;
  }
  for (const f of files.slice(50)) {
    try {
      fs.unlinkSync(path.join(AVATARS_DIR, f.n));
    } catch (_) {}
  }
}

ipcMain.handle('vox-speak', async (event, text, petId) => {
  const config = loadConfig();
  const wid = getPetIdFromEvent(event);
  const pet = getPetEntry(config, petId || wid || config.activePetId);
  const clean = katakanaForVoice(String(text || '').slice(0, 140).trim());
  if (!clean) return { ok: false, error: 'empty' };
  const speaker = Number(pet.voiceVoxSpeaker ?? 1);
  const speed = Math.max(0.5, Math.min(2, Number(pet.voiceVoxSpeed ?? 1)));
  if ((pet.voiceVoxBackend || 'external') === 'builtin') {
    if (!isCoreInstalled()) return { ok: false, error: 'not-installed' };
    const hash = crypto.createHash('sha1').update(`builtin|${speaker}|${speed}|${clean}`).digest('hex');
    const destName = `tts-${hash}.wav`;
    ensureAvatarsDir();
    if (!fs.existsSync(path.join(AVATARS_DIR, destName))) {
      let wav;
      try {
        wav = await coreSynth(clean, speaker, speed, voxDevice(config));
      } catch (err) {
        return { ok: false, error: String((err && err.message) || err).slice(0, 160) };
      }
      fs.writeFileSync(path.join(AVATARS_DIR, destName), wav);
      pruneTtsCache();
    }
    return { ok: true, url: `pet-avatar://local/${encodeURIComponent(destName)}` };
  }
  const base = voxBase(config);
  const hash = crypto.createHash('sha1').update(`${speaker}|${speed}|${clean}`).digest('hex');
  const destName = `tts-${hash}.wav`;
  ensureAvatarsDir();
  if (!fs.existsSync(path.join(AVATARS_DIR, destName))) {
    const query = await voxFetchJson(
      base,
      `/audio_query?text=${encodeURIComponent(clean)}&speaker=${speaker}`,
      { method: 'POST' }
    );
    if (!query.ok || !query.data) return { ok: false, error: query.error || 'query-failed' };
    query.data.speedScale = speed;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(`${base}/synthesis?speaker=${speaker}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'audio/wav' },
        body: JSON.stringify(query.data),
        signal: controller.signal,
      });
      if (!res.ok) return { ok: false, error: `http-${res.status}` };
      fs.writeFileSync(path.join(AVATARS_DIR, destName), Buffer.from(await res.arrayBuffer()));
    } catch (err) {
      return { ok: false, error: 'unreachable', detail: String(err?.message || err).slice(0, 160) };
    } finally {
      clearTimeout(timer);
    }
    pruneTtsCache();
  }
  return { ok: true, url: `pet-avatar://local/${encodeURIComponent(destName)}` };
});

ipcMain.handle('test-gift', () => {
  const config = loadConfig();
  if (!config.petEnabled) return { ok: false, message: 'Turn pets ON first.' };
  const enabled = getEnabledPets(config);
  if (enabled.length < 2) return { ok: false, message: 'Add at least 2 pets to test gifts.' };
  const giver = getPetEntry(config, config.activePetId);
  const receiver = enabled.find((p) => p.id !== giver.id);
  if (!receiver) return { ok: false, message: 'Need another enabled pet.' };
  sendToPetWindow(giver.id, 'gift-give-now', { partnerId: receiver.id, partnerName: receiver.name });
  return { ok: true };
});

ipcMain.handle('test-tag-session', () => {
  const config = loadConfig();
  if (!config.petEnabled) return { ok: false, message: 'Turn pets ON first.' };
  const enabled = getEnabledPets(config);
  if (enabled.length < 2) return { ok: false, message: 'Add at least 2 pets to test tag.' };
  const starter = getPetEntry(config, config.activePetId);
  const partner = enabled.find((p) => p.id !== starter.id);
  if (!partner) return { ok: false, message: 'Need another enabled pet.' };
  if (tagSessions.has(starter.id) || tagSessions.has(partner.id)) {
    return { ok: false, message: 'Tag already in progress.' };
  }
  startTagSessionForPets(starter.id, partner.id, partner.name, 14000);
  return { ok: true };
});

ipcMain.handle('test-foreground-context', async (_, options = {}) => {
  if (process.platform !== 'win32') {
    return { ok: false, reason: 'not-windows', message: 'Only works on Windows.' };
  }
  const { title, error, detail, method } = await getForegroundTitle();
  if (error === 'native-unavailable' || error === 'native-failed') {
    return {
      ok: false,
      reason: error,
      message: `Could not read window title.${detail ? ` (${detail})` : ''}`,
      detail,
    };
  }
  if (error === 'script-missing') {
    return { ok: false, reason: error, message: 'Detection script missing. Reinstall the app.' };
  }
  if (error === 'powershell-failed') {
    return {
      ok: false,
      reason: error,
      message: `PowerShell could not read the window.${detail ? ` (${detail})` : ''}`,
    };
  }
  if (!title) {
    return {
      ok: false,
      reason: error || 'no-title',
      message:
        'Active window has no title. Focus Chrome/YouTube or a game with a visible title bar, then test again.',
      detail,
      method,
    };
  }
  const classified = classifyForegroundTitle(title);
  const reactKind = getForegroundReactionKind(classified.type);
  const wouldReact = !!reactKind;
  const typeLabel = describeForegroundType(classified.type);

  if (options.triggerPet && wouldReact && isPetEnabled()) {
    const config = loadConfig();
    const petId = config.activePetId;
    sendToPetWindow(petId, 'foreground-context', {
      ...classified,
      entered: true,
      deathEdge: classified.type === 'gameDeath',
      test: true,
    });
  }

  return {
    ok: true,
    title,
    type: classified.type,
    typeLabel,
    wouldReact,
    reactKind,
    method: method || 'native',
    message: wouldReact
      ? `Detected: ${typeLabel}. Pet would react.`
      : `Detected: ${typeLabel}. Pet would not react to this window.`,
  };
});

ipcMain.handle('start-wander-session', (_, durationMs) => {
  if (!isPetEnabled()) return false;
  for (const pet of getEnabledPets()) {
    sendToPetWindow(pet.id, 'wander-session-start', durationMs);
  }
  return true;
});

ipcMain.on('wander-session-status', (_, status) => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('wander-session-status', status);
  }
});

ipcMain.on('quit-app', () => app.exit(0));
