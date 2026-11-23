// ---------------------------------------------------------------------------
// VTube Studio plugin client (official local WebSocket API, default :8001).
// - Hotkeys: HotkeysInCurrentModelRequest / HotkeyTriggerRequest (name or ID)
// - Lip-sync: injects the MouthOpen tracking parameter while she talks
// - Head/eye tracking: injects the model's FaceAngle*/Eye* tracking params
//   (standard Live2D params like ParamAngleX can NOT be injected — only
//   VTS tracking parameters can, so we resolve their real names first).
// Self-healing auth: a rejected saved token is replaced automatically.
// ---------------------------------------------------------------------------
const WebSocket = require('ws');
const crypto = require('crypto');

let ws = null;
let port = 8001;
let token = '';
let authed = false;
let status = 'off';
let hooks = {};
let hotkeyCache = { at: 0, list: [] };
let paramCache = { at: 0, map: null };

function rid() {
  return crypto.randomBytes(8).toString('hex');
}

function setStatus(state, detail = '') {
  status = state;
  try {
    if (hooks.onStatus) hooks.onStatus({ state, detail: String(detail || '').slice(0, 240), authed, port, hasToken: !!token });
  } catch (_) {}
}

const pending = new Map();
function pendingDelete(id) {
  const p = pending.get(id);
  if (p) {
    pending.delete(id);
    clearTimeout(p.timer);
  }
}

function send(messageType, data = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) {
      reject(new Error('not-connected'));
      return;
    }
    const id = rid();
    const timer = setTimeout(() => {
      pendingDelete(id);
      reject(new Error('timeout waiting for ' + messageType));
    }, timeoutMs);
    pending.set(id, { requestID: id, resolve, reject, timer });
    try {
      ws.send(JSON.stringify({
        apiName: 'VTubeStudioPublicAPI',
        apiVersion: '1.0',
        requestID: id,
        messageType,
        data,
      }));
    } catch (err) {
      pendingDelete(id);
      reject(err);
    }
  });
}

function checkResp(res, type) {
  if (!res) return { ok: false, error: 'no-response' };
  const mt = String(res.messageType || '');
  const d = res.data || {};
  if (mt.includes('Error') || d.errorID) {
    const err = String(d.errorID || d.message || mt || 'api-error');
    console.log('[vts] ' + type + ' error:', JSON.stringify(d).slice(0, 240));
    return { ok: false, error: err, data: d };
  }
  return { ok: true, data: d };
}

async function requestToken() {
  console.log('[vts] requesting authentication token (approval popup in VTS)...');
  const res = await send('AuthenticationTokenRequest', {
    pluginName: 'Desktop Gremlin',
    pluginDeveloper: 'Kurizu',
  }, 120000);
  const d = (res && res.data) || {};
  console.log('[vts] token response:', JSON.stringify(d).slice(0, 120));
  const t = d.authenticationToken || d.authToken;
  if (!t) throw new Error('no token returned — approve the popup in VTube Studio');
  return String(t);
}

async function authWith(t) {
  const res = await send('AuthenticationRequest', {
    pluginName: 'Desktop Gremlin',
    pluginDeveloper: 'Kurizu',
    authenticationToken: t,
  }, 30000);
  const d = (res && res.data) || {};
  console.log('[vts] auth response:', JSON.stringify(d).slice(0, 200));
  if (d.authenticated) return { ok: true };
  return { ok: false, reason: String(d.reason || d.errorID || 'not authenticated') };
}

function connect(opts = {}, h = {}) {
  hooks = h || {};
  port = Math.max(1, Math.min(65535, Number(opts.port) || 8001));
  if (opts.token) token = String(opts.token);
  hotkeyCache = { at: 0, list: [] };
  paramCache = { at: 0, map: null };
  try {
    if (ws) {
      ws.removeAllListeners();
      ws.close();
    }
  } catch (_) {}
  ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.on('open', async () => {
    setStatus('connecting', 'socket open');
    try {
      if (token) {
        const r = await authWith(token);
        if (r.ok) {
          authed = true;
          setStatus('online', 'authenticated');
          return;
        }
        console.log('[vts] saved token rejected (' + r.reason + ') — requesting a fresh token');
        token = '';
      }
      token = await requestToken();
      const r2 = await authWith(token);
      if (!r2.ok) {
        setStatus('error', 'token rejected — ' + r2.reason);
        return;
      }
      authed = true;
      setStatus('online', 'authenticated (new token saved)');
      if (hooks.onToken) {
        try {
          hooks.onToken(token);
        } catch (_) {}
      }
    } catch (err) {
      authed = false;
      setStatus('error', String((err && err.message) || err));
    }
  });
  ws.on('message', (buf) => {
    try {
      const msg = JSON.parse(String(buf));
      const p = pending.get(msg.requestID);
      if (p) {
        pendingDelete(msg.requestID);
        p.resolve(msg);
      }
    } catch (_) {}
  });
  ws.on('close', () => {
    authed = false;
    paramCache = { at: 0, map: null };
    setStatus('off', 'disconnected');
  });
  ws.on('error', (err) => {
    authed = false;
    setStatus('error', String((err && err.message) || err));
  });
  return getStatus();
}

// ---- Hotkeys (correct message type for this API version) -------------------
async function hotkeys(force = false) {
  if (!force && hotkeyCache.list.length && Date.now() - hotkeyCache.at < 60000) {
    return hotkeyCache.list;
  }
  const res = await send('HotkeysInCurrentModelRequest', {});
  const c = checkResp(res, 'HotkeysInCurrentModel');
  if (!c.ok) throw new Error(c.error);
  const list = c.data.availableHotkeys || [];
  hotkeyCache = {
    at: Date.now(),
    list: list.map((h) => ({ id: String(h.hotkeyID || ''), name: String(h.name || ''), type: String(h.type || ''), file: String(h.file || '') })),
  };
  console.log('[vts] hotkeys:', hotkeyCache.list.map((h) => h.name).join(', ') || '(none)', '| modelLoaded:', c.data.modelLoaded);
  return hotkeyCache.list;
}

// Trigger accepts a hotkey NAME or ID (VTS resolves both).
async function trigger(sel) {
  if (!authed) return { ok: false, error: 'not-authenticated' };
  const key = String(sel || '').trim();
  if (!key) return { ok: false, error: 'empty-hotkey' };
  let res = await send('HotkeyTriggerRequest', { hotkeyID: key });
  let c = checkResp(res, 'HotkeyTrigger');
  if (c.ok) return { ok: true, hotkeyID: c.data.hotkeyID || key };
  // Fallback: partial name match from the model's hotkey list.
  const list = await hotkeys(true).catch(() => []);
  const hit = list.find((h) => h.name.toLowerCase().includes(key.toLowerCase()));
  if (hit && hit.id !== key) {
    res = await send('HotkeyTriggerRequest', { hotkeyID: hit.id });
    c = checkResp(res, 'HotkeyTrigger');
    if (c.ok) return { ok: true, hotkeyID: hit.id, name: hit.name };
  }
  return {
    ok: false,
    error: c.error,
    names: list.map((h) => h.name).filter(Boolean).slice(0, 10),
  };
}

// ---- Tracking parameters (injectable) --------------------------------------
async function inputParams(force = false) {
  if (!force && paramCache.map && Date.now() - paramCache.at < 120000) return paramCache.map;
  const res = await send('InputParameterListRequest', {});
  const c = checkResp(res, 'InputParameterList');
  if (!c.ok) throw new Error(c.error);
  const all = [...(c.data.defaultParameters || []), ...(c.data.customParameters || [])];
  const map = {
    list: all.map((p) => ({ name: String(p.name || ''), min: Number(p.min), max: Number(p.max) })),
    headX: null, headY: null, headZ: null, eyeX: null, eyeY: null, mouth: null, smile: null,
  };
  const pick = (patterns) => map.list.find((p) => patterns.some((re) => re.test(p.name))) || null;
  map.headX = pick([/^FaceAngleX$/i, /Angle_?X$/i, /^ParamAngleX$/i]);
  map.headY = pick([/^FaceAngleY$/i, /Angle_?Y$/i, /^ParamAngleY$/i]);
  map.headZ = pick([/^FaceAngleZ$/i, /Angle_?Z$/i, /^ParamAngleZ$/i]);
  map.eyeX = pick([/^EyeLeftX$/i, /^EyeBallX$/i, /Eye_?X$/i, /^ParamEyeBallX$/i]);
  map.eyeY = pick([/^EyeLeftY$/i, /^EyeBallY$/i, /Eye_?Y$/i, /^ParamEyeBallY$/i]);
  map.mouth = pick([/^MouthOpen$/i, /Mouth_?Open/i, /^ParamMouthOpenY$/i]);
  map.smile = pick([/^MouthSmile$/i]);
  paramCache = { at: Date.now(), map };
  console.log('[vts] tracking params:', JSON.stringify({
    headX: map.headX && map.headX.name, headY: map.headY && map.headY.name, headZ: map.headZ && map.headZ.name,
    eyeX: map.eyeX && map.eyeX.name, eyeY: map.eyeY && map.eyeY.name, mouth: map.mouth && map.mouth.name,
    smile: map.smile && map.smile.name,
    available: map.list.map((p) => p.name).slice(0, 20),
  }));
  return map;
}

function scaled(p, unit) {
  // unit is -1..1; scale into the parameter's own range (symmetric params).
  if (!p) return null;
  const max = Number.isFinite(p.max) && p.max > 0 ? p.max : 1;
  const min = Number.isFinite(p.min) && p.min < 0 ? p.min : -1;
  const v = unit >= 0 ? unit * max : unit * Math.abs(min);
  return { id: p.name, value: Math.max(min, Math.min(max, v)) };
}

async function setLook(nx, ny) {
  if (!authed) return { ok: false, error: 'not-authenticated' };
  let map;
  try {
    map = await inputParams();
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const values = [
    scaled(map.headX, nx),
    scaled(map.headY, -ny),
    scaled(map.headZ, nx),
    scaled(map.eyeX, nx),
    scaled(map.eyeY, -ny),
  ].filter(Boolean);
  if (!values.length) {
    return { ok: false, error: 'no head/eye tracking params on this model', available: map.list.map((p) => p.name).slice(0, 20) };
  }
  const res = await send('InjectParameterDataRequest', { faceFound: true, mode: 'set', parameterValues: values });
  return checkResp(res, 'InjectParameter');
}

// Combined head+eye pose in -1..1 units (idle sway + mouse + talk wobble
// are blended by the caller into one injection per tick).
async function setPose(p) {
  if (!authed) return { ok: false, error: 'not-authenticated' };
  let map;
  try {
    map = await inputParams();
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const clamp1 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));
  const smileV = Math.max(0, Math.min(1, Number(p && p.smile) || 0));
  const values = [
    scaled(map.headX, clamp1(p && p.hx)),
    scaled(map.headY, clamp1(p && p.hy)),
    scaled(map.headZ, clamp1(p && p.hz)),
    scaled(map.eyeX, clamp1(p && p.ex)),
    scaled(map.eyeY, clamp1(p && p.ey)),
    // Only driven while jamming — never force a 0 that would kill the
    // model's own smile expressions.
    smileV > 0.01 ? scaled(map.smile, smileV) : null,
  ].filter(Boolean);
  if (!values.length) {
    return { ok: false, error: 'no head/eye tracking params on this model', available: map.list.map((x) => x.name).slice(0, 20) };
  }
  const res = await send('InjectParameterDataRequest', { faceFound: true, mode: 'set', parameterValues: values });
  return checkResp(res, 'InjectParameter');
}

async function setMouth(value) {
  if (!authed) return { ok: false, error: 'not-authenticated' };
  let map;
  try {
    map = await inputParams();
  } catch (_) {
    return { ok: false, error: 'params-unavailable' };
  }
  if (!map.mouth) return { ok: false, error: 'no-mouth-param' };
  const res = await send('InjectParameterDataRequest', {
    faceFound: true,
    mode: 'set',
    parameterValues: [scaled(map.mouth, Math.max(0, Math.min(1, value)))],
  });
  return checkResp(res, 'InjectParameter');
}

// Kept for compatibility (head/eye test button).
async function testMouseLook() {
  if (!authed) return { ok: false, error: 'not-authenticated' };
  let map;
  try {
    map = await inputParams(true);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  const found = {
    headX: map.headX && map.headX.name, headY: map.headY && map.headY.name,
    eyeX: map.eyeX && map.eyeX.name, eyeY: map.eyeY && map.eyeY.name,
    mouth: map.mouth && map.mouth.name,
  };
  if (!map.headX && !map.eyeX) {
    return { ok: false, error: 'This model has no injectable head/eye tracking parameters', found, available: map.list.map((p) => p.name).slice(0, 20) };
  }
  let last = { ok: true };
  for (const v of [-1, 1, 0]) {
    last = await setLook(v, 0);
    if (!last.ok) break;
    await new Promise((r) => setTimeout(r, 550));
  }
  return last.ok ? { ok: true, found } : { ok: false, error: last.error, found };
}

function disconnect() {
  try {
    if (ws) ws.close();
  } catch (_) {}
  ws = null;
  authed = false;
  paramCache = { at: 0, map: null };
  setStatus('off', '');
}

function getStatus() {
  return { state: status, authed, port, hasToken: !!token, token };
}

function resetToken() {
  token = '';
}

module.exports = { connect, disconnect, hotkeys, trigger, setLook, setPose, setMouth, testMouseLook, isAuthed: () => authed, getStatus, resetToken };
