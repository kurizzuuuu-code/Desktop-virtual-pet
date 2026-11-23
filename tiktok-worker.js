// TikTok LIVE chat worker: connects to a public TikTok live (read-only,
// unofficial) and forwards chat/gift/follow events to the main process.
// Runs in its own process so a connector hiccup can't take down the app.
// Transient drops auto-reconnect; a live ending stops everything.
let conn = null;
let wantConnected = false;
let currentUsername = '';
let lastSignKey = '';
let reconnectTimer = null;
let reconnectDelay = 5000;
let shortDrops = 0;
let connectedAt = 0;

function msgTime(d) {
  const raw = (d && d.common && d.common.createTime) || (d && d.createTime) || 0;
  const t = Number(raw);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function isFresh(d) {
  const t = msgTime(d);
  if (!t) return true;
  return t >= connectedAt - 5000;
}
let rawRoomUsers = 0;

function pickViewerCount(d) {
  if (!d) return 0;
  for (const k of ['viewerCount', 'totalUser', 'total', 'viewer_count', 'onlineUserCount', 'totalUsers']) {
    const v = d[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}
const diag = { chat: 0, chatEmpty: 0, gift: 0, follow: 0, social: 0, like: 0, member: 0, roomUser: 0, raw: {}, firstChatKeys: [] };
let diagTimer = null;

function send(obj) {
  try {
    process.send(obj);
  } catch (_) {}
}

function errText(e) {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  if (e.message) return String(e.message);
  try {
    if (e.info) return String(e.info);
    if (e.type) return String(e.type);
    const seen = {};
    for (const k of Object.keys(e)) {
      const v = e[k];
      if (v == null || typeof v === 'object') continue;
      seen[k] = String(v);
    }
    return JSON.stringify(seen).slice(0, 200) || String(e);
  } catch (_) {
    return String(e);
  }
}

function detailText(d) {
  if (!d) return '';
  try {
    if (typeof d === 'string') return d.slice(0, 120);
    if (d.message) return String(d.message).slice(0, 120);
    const seen = {};
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (v == null || typeof v === 'object') continue;
      seen[k] = String(v);
    }
    return JSON.stringify(seen).slice(0, 120);
  } catch (_) {
    return '';
  }
}

function userOf(d) {
  const u = (d && d.user) || {};
  return {
    user: u.uniqueId || (d && d.uniqueId) || '',
    nick: u.nickname || u.uniqueId || (d && d.nickname) || '',
  };
}

function scheduleReconnect() {
  if (!wantConnected || reconnectTimer) return;
  const delay = reconnectDelay;
  reconnectDelay = Math.min(60000, Math.round(reconnectDelay * 1.7));
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!wantConnected) return;
    send({ t: 'status', state: 'reconnecting', username: currentUsername });
    try {
      await connect(currentUsername, lastSignKey);
    } catch (err) {
      send({ t: 'status', state: 'error', error: errText(err), username: currentUsername });
    }
  }, delay);
}

async function connect(username, signKey) {
  const mod = await import('tiktok-live-connector');
  const TikTokLiveConnection = mod.TikTokLiveConnection;
  // Free Euler tier: the signed WebSocket route is available; the HTTP
  // signature routes (room info / extended gifts) require Business plan.
  // Without the plan those options throw "[Empty Payload] ... Business plan"
  // and break connecting, so keep the options minimal.
  const opts = {};
  if (signKey) opts.signApiKey = String(signKey);
  conn = new TikTokLiveConnection(username, opts);

  conn.on('chat', (d) => {
    if (!isFresh(d)) return;
    diag.chat += 1;
    const { user, nick } = userOf(d);
    const text = (d && (d.content || d.comment)) || '';
    if (!text) diag.chatEmpty += 1;
    if (diag.firstChatKeys.length < 3) {
      try { diag.firstChatKeys.push((d && typeof d.comment) + '|' + Object.keys(d || {}).slice(0, 10).join(',')); } catch (_) {}
    }
    send({ t: 'chat', user, nick, text });
  });
  conn.on('gift', (d) => {
    if (!isFresh(d)) return;
    diag.gift += 1;
    const { user, nick } = userOf(d);
    const details = (d && d.giftDetails) || {};
    send({
      t: 'gift',
      user,
      nick,
      gift: (d && (d.giftName || details.giftName)) || (d && d.giftId) || 'gift',
      count: (d && d.repeatCount) || 1,
      repeatEnd: !d || d.repeatEnd !== false,
      diamonds: (d && d.diamondCount) || details.diamondCount || 0,
    });
  });
  conn.on('follow', (d) => {
    diag.follow += 1;
    const { user, nick } = userOf(d);
    send({ t: 'follow', user, nick });
  });
  conn.on('like', (d) => {
    diag.like += 1;
    const { user } = userOf(d);
    send({ t: 'like', user, count: (d && d.likeCount) || 0 });
  });
  conn.on('roomUser', (d) => {
    diag.roomUser += 1;
    const count = pickViewerCount(d);
    if (diag.roomUser <= 2) {
      let dbg = '';
      try {
        dbg = JSON.stringify({ viewerCount: d && d.viewerCount, totalUser: d && (d.totalUser ?? d.total), keys: Object.keys(d || {}).slice(0, 14) }).slice(0, 220);
      } catch (_) { dbg = 'dbg-error'; }
      send({ t: 'viewers', count, dbg });
    } else {
      send({ t: 'viewers', count });
    }
  });
  conn.on('member', () => {
    diag.member += 1;
  });
  let rawCaptures = 0;
  conn.on('decodedData', (method, data, payload) => {
    try {
      diag.raw[method] = (diag.raw[method] || 0) + 1;
    } catch (_) {}
    try {
      if (method === 'WebcastChatMessage' && rawCaptures < 3 && !(data && (data.content || data.comment))) {
        rawCaptures += 1;
        send({ t: 'chatraw', n: rawCaptures, b64: Buffer.from(payload).toString('base64') });
      }
      if (method === 'WebcastRoomUserSeqMessage' && rawRoomUsers < 2) {
        rawRoomUsers += 1;
        send({ t: 'chatraw', kind: 'roomuser', n: rawRoomUsers, b64: Buffer.from(payload).toString('base64') });
      }
    } catch (_) {}
  });
  if (diagTimer) clearInterval(diagTimer);
  diagTimer = setInterval(() => {
    try {
      if (!wantConnected) return;
      const rawTop = Object.entries(diag.raw)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([k, v]) => `${String(k).replace('Webcast', '')}=${v}`)
        .join(' ');
      send({ t: 'diag', counts: { chat: diag.chat, empty: diag.chatEmpty, gift: diag.gift, follow: diag.follow, like: diag.like, member: diag.member, roomUser: diag.roomUser }, raw: rawTop, firstChatKeys: diag.firstChatKeys.slice(0, 3) });
    } catch (_) {}
  }, 15000);
  conn.on('streamEnd', () => {
    wantConnected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    send({ t: 'status', state: 'ended' });
  });
  conn.on('disconnected', (d) => {
    // Only reset the backoff after a session that actually lasted. Quick
    // connect/drop cycles keep growing the delay instead of hammering.
    const short = Date.now() - connectedAt < 12000;
    if (short) shortDrops += 1;
    else {
      reconnectDelay = 5000;
      shortDrops = 0;
    }
    const out = { t: 'status', state: 'disconnected', detail: detailText(d), username: currentUsername };
    if (shortDrops === 3) {
      out.hint =
        'TikTok keeps closing the socket right after the handshake. Most likely you are not live right now, or the live audience is private/selected - only PUBLIC lives can be read. Go live with a Public audience, then Connect. If you ARE live and public, check the Sign API key box.\nNote: stream tests with 0 viewers are normal and work fine.';
    }
    send(out);
    scheduleReconnect();
  });
  conn.on('error', (e) => {
    send({ t: 'status', state: 'error', error: errText(e), username: currentUsername });
  });

  try {
    const state = await conn.connect();
    connectedAt = Date.now();
    shortDrops = 0;
    send({
      t: 'status',
      state: 'connected',
      room: (state && state.roomId) || '',
      viewers: (state && state.viewerCount) || 0,
      username,
    });
  } catch (err) {
    const msg = errText(err);
    if (/illegal room id/i.test(msg)) {
      send({
        t: 'status',
        state: 'error',
        error: msg,
        hint: 'TikTok rejected the room. Private / selected-audience lives cannot be read anonymously - set the live audience to Public, then reconnect.',
      });
      return;
    }
    if (wantConnected && /isn't online|UserOffline/i.test(msg)) {
      send({ t: 'status', state: 'offline', error: 'Not live yet - waiting for your live to start...', username });
      reconnectDelay = 60000;
      scheduleReconnect();
      return;
    }
    send({ t: 'status', state: 'error', error: msg, username });
  }
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'connect') {
    wantConnected = true;
    currentUsername = String(msg.username || '').replace(/^@+/, '').trim();
    lastSignKey = msg.signKey || '';
    reconnectDelay = 5000;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      if (conn) {
        try {
          conn.disconnect();
        } catch (_) {}
        conn = null;
      }
      await connect(currentUsername, lastSignKey);
    } catch (err) {
      send({ t: 'status', state: 'error', error: errText(err), username: currentUsername });
    }
    return;
  }
  if (msg.t === 'disconnect') {
    wantConnected = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    try {
      if (conn) conn.disconnect();
    } catch (_) {}
    conn = null;
    send({ t: 'status', state: 'off' });
  }
});
