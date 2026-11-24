// ---------------------------------------------------------------------------
// Minecraft Bedrock Autopilot (Vision + Win32 SendInput)
// Sees the Minecraft Bedrock window via vision capture, asks the Vision AI
// for the next movement/camera/click action, and executes hardware scan-code
// keyboard + relative mouse inputs via user32.dll SendInput.
//
// Safety guarantees:
// - Only sends inputs while Minecraft is the foreground window.
// - Releases all held keys & mouse buttons on stop, Alt-Tab, error, or F8.
// ---------------------------------------------------------------------------
'use strict';

const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const MOUSEEVENTF_MOVE = 0x0001;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;

// Hardware scan codes (Set 1) — works reliably with DirectInput / UWP Bedrock.
const SCAN = {
  w: 0x11,
  a: 0x1e,
  s: 0x1f,
  d: 0x20,
  space: 0x39,
  shift: 0x2a,
  ctrl: 0x1d,
  e: 0x12,
  q: 0x10,
  '1': 0x02,
  '2': 0x03,
  '3': 0x04,
  '4': 0x05,
  '5': 0x06,
  '6': 0x07,
  '7': 0x08,
  '8': 0x09,
  '9': 0x0a,
};

let user32SendInput = null;
let inputStructSize = process.arch === 'x64' || process.arch === 'arm64' ? 40 : 28;

function initSendInput() {
  if (user32SendInput) return true;
  if (process.platform !== 'win32') return false;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    user32SendInput = user32.func('unsigned int __stdcall SendInput(unsigned int cInputs, uint8 *pInputs, int cbSize)');
    return true;
  } catch (_) {
    return false;
  }
}

function sendKeyScan(scanCode, down) {
  if (!initSendInput() || !scanCode) return false;
  const buf = Buffer.alloc(inputStructSize);
  const unionOff = inputStructSize === 40 ? 8 : 4;
  buf.writeUInt32LE(INPUT_KEYBOARD, 0);
  buf.writeUInt16LE(0, unionOff); // wVk = 0 (use scancode)
  buf.writeUInt16LE(scanCode, unionOff + 2); // wScan
  buf.writeUInt32LE(KEYEVENTF_SCANCODE | (down ? 0 : KEYEVENTF_KEYUP), unionOff + 4);
  try {
    return user32SendInput(1, buf, inputStructSize) === 1;
  } catch (_) {
    return false;
  }
}

function sendMouseRaw(dx, dy, flags) {
  if (!initSendInput()) return false;
  const buf = Buffer.alloc(inputStructSize);
  const unionOff = inputStructSize === 40 ? 8 : 4;
  buf.writeUInt32LE(INPUT_MOUSE, 0);
  buf.writeInt32LE(Math.round(dx || 0), unionOff);
  buf.writeInt32LE(Math.round(dy || 0), unionOff + 4);
  buf.writeUInt32LE(0, unionOff + 8); // mouseData
  buf.writeUInt32LE(flags, unionOff + 12);
  try {
    return user32SendInput(1, buf, inputStructSize) === 1;
  } catch (_) {
    return false;
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const heldKeys = new Set();
let heldLeft = false;
let heldRight = false;

function keyDown(name) {
  const sc = SCAN[name];
  if (!sc) return;
  heldKeys.add(name);
  sendKeyScan(sc, true);
}

function keyUp(name) {
  const sc = SCAN[name];
  if (!sc) return;
  heldKeys.delete(name);
  sendKeyScan(sc, false);
}

function releaseAllInputs() {
  for (const k of [...heldKeys]) {
    try { sendKeyScan(SCAN[k], false); } catch (_) {}
  }
  heldKeys.clear();
  if (heldLeft) {
    heldLeft = false;
    try { sendMouseRaw(0, 0, MOUSEEVENTF_LEFTUP); } catch (_) {}
  }
  if (heldRight) {
    heldRight = false;
    try { sendMouseRaw(0, 0, MOUSEEVENTF_RIGHTUP); } catch (_) {}
  }
}

async function smoothMouseTurn(dx, dy, alive) {
  const clampedX = Math.max(-450, Math.min(450, Math.round(Number(dx) || 0)));
  const clampedY = Math.max(-220, Math.min(220, Math.round(Number(dy) || 0)));
  if (!clampedX && !clampedY) return;
  const steps = Math.max(4, Math.min(16, Math.ceil(Math.max(Math.abs(clampedX), Math.abs(clampedY)) / 24)));
  let accX = 0;
  let accY = 0;
  for (let i = 1; i <= steps; i++) {
    if (!alive()) return;
    const nx = Math.round((clampedX * i) / steps);
    const ny = Math.round((clampedY * i) / steps);
    const stepX = nx - accX;
    const stepY = ny - accY;
    accX = nx;
    accY = ny;
    if (stepX || stepY) sendMouseRaw(stepX, stepY, MOUSEEVENTF_MOVE);
    await wait(16);
  }
}

function parseActionJson(raw) {
  const text = String(raw || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj || typeof obj !== 'object') return null;
    const move = ['forward', 'back', 'left', 'right', 'none'].includes(String(obj.move || '').toLowerCase())
      ? String(obj.move).toLowerCase()
      : 'none';
    const action = ['none', 'tap_left', 'hold_left', 'tap_right', 'hold_right'].includes(String(obj.action || '').toLowerCase())
      ? String(obj.action).toLowerCase()
      : 'none';
    return {
      thought: String(obj.thought || '').slice(0, 140),
      move,
      jump: !!obj.jump,
      sprint: !!obj.sprint,
      sneak: !!obj.sneak,
      turnX: Math.max(-450, Math.min(450, Number(obj.turnX) || 0)),
      turnY: Math.max(-220, Math.min(220, Number(obj.turnY) || 0)),
      action,
      slot: Math.max(0, Math.min(9, parseInt(obj.slot, 10) || 0)),
      durationMs: Math.max(250, Math.min(1800, Number(obj.durationMs) || 700)),
      say: String(obj.say || '').slice(0, 140).trim(),
    };
  } catch (_) {
    return null;
  }
}

function isMinecraftForeground(title, exe) {
  const t = String(title || '').toLowerCase();
  const e = String(exe || '').toLowerCase();
  return /minecraft/.test(t) || /minecraft/.test(e);
}

let running = false;
let runGen = 0;
let state = { running: false, status: 'off', detail: '', lastThought: '', steps: 0 };
let hooks = null;

function emitStatus(patch) {
  state = { ...state, ...patch };
  try {
    if (hooks && hooks.onStatus) hooks.onStatus({ ...state });
  } catch (_) {}
}

async function executeAction(act, alive) {
  if (!alive()) return;
  try {
    if (act.slot >= 1 && act.slot <= 9) {
      const sc = SCAN[String(act.slot)];
      if (sc) {
        sendKeyScan(sc, true);
        await wait(45);
        sendKeyScan(sc, false);
        await wait(45);
      }
    }
    if (act.turnX || act.turnY) {
      await smoothMouseTurn(act.turnX, act.turnY, alive);
    }
    if (!alive()) return;

    const moveKey = act.move === 'forward' ? 'w'
      : act.move === 'back' ? 's'
      : act.move === 'left' ? 'a'
      : act.move === 'right' ? 'd'
      : '';

    if (act.sneak) keyDown('shift');
    else if (act.sprint && moveKey === 'w') keyDown('ctrl');
    if (moveKey) keyDown(moveKey);
    if (act.jump) keyDown('space');

    if (act.action === 'tap_left') {
      heldLeft = true;
      sendMouseRaw(0, 0, MOUSEEVENTF_LEFTDOWN);
      await wait(80);
      heldLeft = false;
      sendMouseRaw(0, 0, MOUSEEVENTF_LEFTUP);
    } else if (act.action === 'hold_left') {
      heldLeft = true;
      sendMouseRaw(0, 0, MOUSEEVENTF_LEFTDOWN);
    } else if (act.action === 'tap_right') {
      heldRight = true;
      sendMouseRaw(0, 0, MOUSEEVENTF_RIGHTDOWN);
      await wait(80);
      heldRight = false;
      sendMouseRaw(0, 0, MOUSEEVENTF_RIGHTUP);
    } else if (act.action === 'hold_right') {
      heldRight = true;
      sendMouseRaw(0, 0, MOUSEEVENTF_RIGHTDOWN);
    }

    const slice = 100;
    let left = act.durationMs;
    while (left > 0 && alive()) {
      await wait(Math.min(slice, left));
      left -= slice;
    }
  } finally {
    releaseAllInputs();
  }
}

async function runLoop(opts, myGen) {
  const goal = String(opts.goal || 'Survive, explore, chop wood, and fight nearby hostile mobs').trim();
  const intervalMs = Math.max(800, Math.min(5000, Number(opts.intervalMs) || 1500));
  const alive = () => running && myGen === runGen;
  let lastSayAt = 0;
  let recentActions = [];

  emitStatus({
    running: true,
    status: 'waiting',
    detail: 'Waiting for Minecraft Bedrock window to be focused… (Press F8 anytime to stop)',
    steps: 0,
  });

  while (alive()) {
    try {
      const fg = hooks.getForeground ? await hooks.getForeground() : { title: '', exe: '' };
      if (!alive()) break;
      if (!isMinecraftForeground(fg.title, fg.exe)) {
        releaseAllInputs();
        emitStatus({
          status: 'paused',
          detail: `Paused — focus Minecraft Bedrock window to resume (currently: ${String(fg.title || 'desktop').slice(0, 40)}). Press F8 to stop.`,
        });
        await wait(1000);
        continue;
      }

      emitStatus({ status: 'thinking', detail: 'Capturing Minecraft Bedrock screen…' });
      const b64 = await hooks.captureFrame();
      if (!alive()) break;
      if (!b64) {
        emitStatus({ status: 'waiting', detail: 'Capture empty — retrying…' });
        await wait(1200);
        continue;
      }

      const historyHint = recentActions.length
        ? `Recent steps: ${recentActions.slice(-3).join(' -> ')}.`
        : '';
      const system = [
        'You are an autonomous Minecraft Bedrock player controlling the game with keyboard and mouse.',
        `Goal: ${goal}`,
        historyHint,
        'Look at the screenshot and choose ONE next short action. Reply with ONLY valid JSON (no markdown, no explanation):',
        '{"thought":"short reason","move":"forward|back|left|right|none","jump":false,"sprint":false,"sneak":false,"turnX":0,"turnY":0,"action":"none|tap_left|hold_left|tap_right|hold_right","slot":0,"durationMs":700,"say":""}',
        'Rules: turnX positive turns right, negative turns left (-300..300). turnY positive looks down, negative looks up (-150..150). Use hold_left to mine a block in crosshair, tap_left to attack a mob, hold_right to eat food, tap_right to place/interact. Leave "say" empty most turns; only add a short fun comment occasionally.',
      ].filter(Boolean).join('\n');

      const res = await hooks.decide(b64, system, 'Decide the next Minecraft Bedrock action as JSON.');
      if (!alive()) break;
      if (!res || !res.ok || !res.text) {
        emitStatus({
          status: 'error',
          detail: `Vision AI error: ${(res && (res.detail || res.error)) || 'no response'}. Retrying…`,
        });
        await wait(2500);
        continue;
      }

      const act = parseActionJson(res.text);
      if (!act) {
        emitStatus({
          status: 'waiting',
          detail: `Model didn't return JSON (tip: use Cloud Vision like Gemini Flash / Qwen2.5-VL instead of moondream).`,
        });
        await wait(2500);
        continue;
      }

      // Re-verify Minecraft is STILL focused right before sending real inputs!
      const fg2 = hooks.getForeground ? await hooks.getForeground() : { title: '', exe: '' };
      if (!alive() || !isMinecraftForeground(fg2.title, fg2.exe)) {
        releaseAllInputs();
        continue;
      }

      const summary = `${act.move}${act.jump ? '+jump' : ''}${act.action !== 'none' ? '+' + act.action : ''}${act.turnX ? ` turnX:${act.turnX}` : ''}`;
      recentActions.push(summary);
      if (recentActions.length > 6) recentActions.shift();

      emitStatus({
        status: 'acting',
        steps: state.steps + 1,
        lastThought: act.thought || summary,
        detail: `Step #${state.steps + 1}: ${act.thought || summary} [${summary}] (F8 to stop)`,
      });

      if (act.say && hooks.onSay && Date.now() - lastSayAt > 12000) {
        lastSayAt = Date.now();
        try { hooks.onSay(act.say); } catch (_) {}
      }

      await executeAction(act, () => alive());
      if (!alive()) break;
      await wait(Math.max(250, intervalMs - act.durationMs));
    } catch (err) {
      releaseAllInputs();
      emitStatus({ status: 'error', detail: `Error: ${String((err && err.message) || err).slice(0, 120)}` });
      await wait(2000);
    }
  }

  releaseAllInputs();
  if (myGen === runGen) {
    emitStatus({ running: false, status: 'off', detail: 'Stopped.' });
  }
}

function start(opts = {}, apiHooks = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Bedrock Autopilot is Windows-only.' };
  }
  if (!initSendInput()) {
    return { ok: false, error: 'Win32 SendInput unavailable (koffi failed).' };
  }
  hooks = apiHooks;
  running = true;
  const myGen = ++runGen;
  runLoop(opts, myGen).catch(() => {
    releaseAllInputs();
    if (myGen === runGen) {
      running = false;
      emitStatus({ running: false, status: 'off', detail: 'Stopped.' });
    }
  });
  return { ok: true, state: { ...state } };
}

function stop(reason = 'Stopped.') {
  running = false;
  runGen += 1;
  releaseAllInputs();
  emitStatus({ running: false, status: 'off', detail: reason });
  return { ok: true, state: { ...state } };
}

function getStatus() {
  return { ...state };
}

module.exports = { start, stop, getStatus, releaseAllInputs, initSendInput };
