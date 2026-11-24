const $ = (id) => document.getElementById(id);
let cfg = {};

function setStatus(msg) {
  const el = $('qStatus');
  if (el) el.textContent = String(msg || '');
}

async function syncState() {
  try {
    cfg = (await window.petAPI.getConfig()) || {};
    $('qVision')?.classList.toggle('on', cfg.visionMode && cfg.visionMode !== 'off');
    $('qDiscordHide')?.classList.toggle('on', !!cfg.discordHidePet);
    $('qDiscordListen')?.classList.toggle('on', !!cfg.discordVoiceListen);
  } catch (_) {}
}

async function patchConfig(patch, label) {
  try {
    const cur = (await window.petAPI.getConfig()) || {};
    const next = { ...cur, ...patch };
    await window.petAPI.saveConfig(next);
    cfg = next;
    await syncState();
    setStatus(label);
  } catch (err) {
    setStatus(`Error: ${String((err && err.message) || err)}`);
  }
}

async function sendSay() {
  const inp = $('qSayInput');
  const text = String(inp?.value || '').trim();
  if (!text) return;
  inp.value = '';
  setStatus('Speaking…');
  try {
    const res = await window.petAPI.petSayNow?.(text);
    setStatus(res?.ok ? `Spoke: "${res.text}"` : `Failed: ${res?.error || 'unknown'}`);
  } catch (err) {
    setStatus(`Error: ${String((err && err.message) || err)}`);
  }
}

$('qSayBtn')?.addEventListener('click', sendSay);
$('qSayInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendSay();
  }
});

$('qVision')?.addEventListener('click', () => {
  const isOn = cfg.visionMode && cfg.visionMode !== 'off';
  const nextMode = isOn ? 'off' : 'local';
  patchConfig({ visionMode: nextMode }, `Vision: ${nextMode.toUpperCase()}`);
});

$('qScan')?.addEventListener('click', async () => {
  setStatus('Scanning screen…');
  try {
    const res = await window.petAPI.visionTest?.();
    setStatus(res?.ok ? `Saw: "${String(res.text || '').slice(0, 70)}"` : `Scan: ${res?.error || 'failed'}`);
  } catch (_) {
    setStatus('Scan failed.');
  }
});

$('qDiscordHide')?.addEventListener('click', () => {
  const next = !cfg.discordHidePet;
  patchConfig({ discordHidePet: next }, `Discord Hide Mode: ${next ? 'ON' : 'OFF'}`);
});

$('qDiscordListen')?.addEventListener('click', () => {
  const next = !cfg.discordVoiceListen;
  patchConfig({ discordVoiceListen: next }, `Discord VC Listen: ${next ? 'ON' : 'OFF'}`);
});

$('qChat')?.addEventListener('click', () => {
  window.petAPI.openChat?.();
});

$('qSettings')?.addEventListener('click', () => {
  window.petAPI.openSettings?.();
});

$('qClose')?.addEventListener('click', () => {
  window.petAPI.windowClose?.();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.petAPI.windowClose?.();
});

window.addEventListener('focus', () => {
  syncState();
  $('qSayInput')?.focus();
});

syncState();
