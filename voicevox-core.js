// Built-in VOICEVOX CORE voice (Zundamon pack) — download-on-demand into
// userData so the portable exe stays lean. Synthesis runs in a worker thread
// via koffi (no native builds, no child process, no ports).
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { Worker } = require('worker_threads');

const DL_EXE_URL =
  'https://github.com/VOICEVOX/voicevox_core/releases/latest/download/download-windows-x64.exe';

// Optional extra voice packs (downloaded on demand, loaded alongside 0.vvm).
const EXTRA_VOICES = [
  {
    vvm: '13.vvm',
    label: '猫使アル・猫使ビィ (female)',
    credit: 'VOICEVOX:猫使アル・猫使ビィ',
    sizeHint: '~62MB',
    url: 'https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/main/vvms/13.vvm',
  },
  {
    vvm: '4.vvm',
    label: '玄野武宏・剣崎雌雄 (male)',
    credit: 'VOICEVOX:玄野武宏・剣崎雌雄',
    sizeHint: '~59MB',
    url: 'https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/main/vvms/4.vvm',
  },
  {
    vvm: '9.vvm',
    label: '白上虎太郎 (male)',
    credit: 'VOICEVOX:白上虎太郎',
    sizeHint: '~58MB',
    url: 'https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/main/vvms/9.vvm',
  },
  {
    vvm: '12.vvm',
    label: '聖騎士紅桜・雀松朱司・麒ヶ島宗麟 (male)',
    credit: 'VOICEVOX:†聖騎士 紅桜†・雀松朱司・麒ヶ島宗麟',
    sizeHint: '~59MB',
    url: 'https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/main/vvms/12.vvm',
  },
  {
    vvm: '15.vvm',
    label: '青山龍星 (male) + more',
    credit: 'VOICEVOX:青山龍星・ずんだもん・もち子さん・小夜/SAYO',
    sizeHint: '~67MB',
    url: 'https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/main/vvms/15.vvm',
  },
];

// Keep only human-meaningful downloader output; the tool is chatty
// (license walls, WARN noise, pager crashes) and that scares users.
function cleanDownloadLog(line) {
  const text = String(line || '').replace(/\[[0-9;]*m/g, '').trim();
  if (!text) return '';
  if (/WARN|panick|pager|利用規約|kiyaku|terms|^https?:|^[│─┌┐└┘├┤┬┴┼\s]+$/.test(text)) return '';
  if (/INFO|ダウンロード|完了|downloading|Downloading|%|\.vvm|\.dll|\.dic|\.exe/i.test(text)) {
    return text.replace(/^[│\s]+/, '').slice(0, 140);
  }
  return '';
}

function voxRoot() {
  return path.join(app.getPath('userData'), 'voicevox');
}

function corePaths() {
  const root = voxRoot();
  return {
    root,
    coreDll: path.join(root, 'c_api', 'lib', 'voicevox_core.dll'),
    ortDll: path.join(root, 'onnxruntime', 'lib', 'voicevox_onnxruntime.dll'),
    ortCopy: path.join(root, 'c_api', 'lib', 'voicevox_onnxruntime.dll'),
    ortDmlDll: path.join(root, 'onnxruntime-directml', 'lib', 'voicevox_onnxruntime.dll'),
    dmlLibDir: path.join(root, 'onnxruntime-directml', 'lib'),
    dmlExtraDir: path.join(root, 'additional-libraries'),
    dictDir: path.join(root, 'dict', 'open_jtalk_dic_utf_8-1.11'),
    vvmPath: path.join(root, 'models', 'vvms', '0.vvm'),
    dlExe: path.join(root, 'dl.exe'),
    installJson: path.join(root, 'INSTALL.json'),
  };
}

function isGpuPackInstalled() {
  try {
    const p = corePaths();
    return fs.existsSync(p.ortDmlDll) && fs.existsSync(path.join(p.dmlExtraDir, 'DirectML.dll'));
  } catch (_) {
    return false;
  }
}

async function downloadGpuPack(onEvent = () => {}, cancelToken = {}) {
  const emit = (phase, message, percent) => {
    try {
      onEvent({ phase, message, percent: percent ?? null });
    } catch (_) {}
  };
  const p = corePaths();
  fs.mkdirSync(p.root, { recursive: true });
  if (!fs.existsSync(p.dlExe)) {
    emit('tool', 'Downloading installer tool…', 2);
    await fetchToFile(DL_EXE_URL, p.dlExe, null, cancelToken.controller && cancelToken.controller.signal);
  }
  if (cancelToken.cancelled) throw new Error('cancelled');
  emit('gpu', 'Downloading GPU runtime (DirectML, ~30MB)…', null);
  const tmpOut = path.join(p.root, '.gpu-dl');
  const dlResult = await runDownloader(
    p.dlExe,
    tmpOut,
    ['--devices', 'directml', '--only', 'onnxruntime', 'additional-libraries'],
    (line) => {
      const text = String(line)
        .split(/\r?\n/)
        .map((s) => cleanDownloadLog(s))
        .filter(Boolean)
        .pop();
      if (text) emit('gpu', text, null);
    },
    cancelToken
  );
  if (cancelToken.cancelled) throw new Error('cancelled');
  if (!dlResult.ok) throw new Error('GPU runtime download failed.');
  const stagedOrt = path.join(tmpOut, 'onnxruntime');
  const stagedExtra = path.join(tmpOut, 'additional_libraries');
  if (!fs.existsSync(path.join(stagedOrt, 'lib', 'voicevox_onnxruntime.dll'))) {
    throw new Error('GPU runtime files incomplete — please retry.');
  }
  fs.rmSync(path.join(p.root, 'onnxruntime-directml'), { recursive: true, force: true });
  fs.rmSync(path.join(p.root, 'additional-libraries'), { recursive: true, force: true });
  fs.renameSync(stagedOrt, path.join(p.root, 'onnxruntime-directml'));
  if (fs.existsSync(stagedExtra)) fs.renameSync(stagedExtra, path.join(p.root, 'additional-libraries'));
  fs.rmSync(tmpOut, { recursive: true, force: true });
  stopCoreWorker();
  emit('done', 'GPU runtime ready! Voices will use your GPU.', 100);
  return { ok: true };
}

function isCoreInstalled() {
  try {
    const p = corePaths();
    return (
      fs.existsSync(p.coreDll) &&
      fs.existsSync(p.ortDll) &&
      fs.existsSync(p.dictDir) &&
      fs.existsSync(p.vvmPath) &&
      fs.existsSync(p.installJson)
    );
  } catch (_) {
    return false;
  }
}

function modelPath(vvm) {
  return path.join(voxRoot(), 'models', 'vvms', vvm);
}

function listInstalledModels() {
  const out = [];
  try {
    if (fs.existsSync(modelPath('0.vvm'))) out.push('0.vvm');
    for (const extra of EXTRA_VOICES) {
      if (fs.existsSync(modelPath(extra.vvm))) out.push(extra.vvm);
    }
  } catch (_) {}
  return out;
}

function extraVoiceStatus() {
  return EXTRA_VOICES.map((e) => ({
    vvm: e.vvm,
    label: e.label,
    credit: e.credit,
    sizeHint: e.sizeHint,
    installed: fs.existsSync(modelPath(e.vvm)),
  }));
}

async function fetchToFile(url, dest, onProgress, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`download failed (http-${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const fh = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.length;
    await new Promise((resolve, reject) => {
      fh.write(value, (err) => (err ? reject(err) : resolve()));
    });
    if (onProgress) onProgress(loaded, total);
  }
  await new Promise((resolve, reject) => {
    fh.end((err) => (err ? reject(err) : resolve()));
  });
}

function runDownloader(dlExe, outDir, extraArgs, onLog, cancelToken) {
  return new Promise((resolve) => {
    const child = spawn(dlExe, [...extraArgs, '-o', outDir], { windowsHide: true, timeout: 20 * 60 * 1000 });
    let finished = false;
    const done = (result) => {
      if (finished) return;
      finished = true;
      resolve(result);
    };
    cancelToken.cancel = () => {
      try {
        child.kill();
      } catch (_) {}
      done({ ok: false, error: 'cancelled' });
    };
    try {
      child.stdin.write('y\n');
      child.stdin.end();
    } catch (_) {}
    child.stdout.on('data', (d) => {
      if (onLog) onLog(String(d));
    });
    child.stderr.on('data', (d) => {
      if (onLog) onLog(String(d));
    });
    child.on('error', (err) => done({ ok: false, error: String((err && err.message) || err).slice(0, 200) }));
    child.on('exit', (code) => done({ ok: code === 0, code }));
  });
}

async function downloadCore(onEvent = () => {}, cancelToken = {}) {
  const emit = (phase, message, percent) => {
    try {
      onEvent({ phase, message, percent: percent ?? null });
    } catch (_) {}
  };
  const throwIfCancelled = () => {
    if (cancelToken.cancelled) throw new Error('cancelled');
  };
  const p = corePaths();
  fs.mkdirSync(p.root, { recursive: true });

  emit('tool', 'Downloading installer tool…', 2);
  await fetchToFile(DL_EXE_URL, p.dlExe, null, cancelToken.controller && cancelToken.controller.signal);
  throwIfCancelled();

  emit('libs', 'Downloading voice engine (core + runtime + dictionary)…', null);
  const dlResult = await runDownloader(
    p.dlExe,
    p.root,
    ['--devices', 'cpu', '--only', 'c-api', 'onnxruntime', 'dict', 'models', '--models-pattern', '0.vvm'],
    (line) => {
      const text = String(line)
        .split(/\r?\n/)
        .map((s) => cleanDownloadLog(s))
        .filter(Boolean)
        .pop();
      if (text) emit('libs', text, null);
    },
    cancelToken
  );
  if (cancelToken.cancelled) throw new Error('cancelled');
  if (!dlResult.ok) throw new Error('Voice engine download failed.');

  for (const f of [p.coreDll, p.ortDll, p.vvmPath]) {
    if (!fs.existsSync(f)) throw new Error('Voice engine files incomplete — please retry.');
  }
  try {
    fs.copyFileSync(p.ortDll, p.ortCopy);
  } catch (_) {}
  fs.writeFileSync(p.installJson, JSON.stringify({ core: '0.17.0', models: ['0.vvm'], date: new Date().toISOString() }));
  emit('done', 'Built-in voice ready!', 100);
  return { ok: true };
}

async function downloadModel(vvm, onEvent = () => {}, cancelToken = {}) {
  const emit = (phase, message, percent) => {
    try {
      onEvent({ phase, message, percent: percent ?? null });
    } catch (_) {}
  };
  const entry = EXTRA_VOICES.find((e) => e.vvm === vvm);
  if (!entry) throw new Error('unknown voice pack');
  const dest = modelPath(vvm);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  emit('model', `Downloading ${entry.label} (${entry.sizeHint})…`, 0);
  await fetchToFile(entry.url, dest, (loaded, total) => {
    if (total > 0) emit('model', `Downloading ${entry.label}… ${Math.round((loaded / total) * 100)}%`, Math.round((loaded / total) * 100));
  }, cancelToken.controller && cancelToken.controller.signal);
  if (cancelToken.cancelled) throw new Error('cancelled');
  if (!fs.existsSync(dest)) throw new Error('Voice pack files incomplete — please retry.');
  stopCoreWorker();
  emit('done', `${entry.label} ready!`, 100);
  return { ok: true };
}

// ---- worker lifecycle ----
let worker = null;
let workerSeq = 0;
const workerPending = new Map();
let synthChain = Promise.resolve();

function workerScriptPath() {
  if (!app.isPackaged) return path.join(__dirname, 'scripts', 'voicevox-worker.js');
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'voicevox-worker.js');
}

function koffiPath() {
  if (!app.isPackaged) return require.resolve('koffi');
  return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'koffi', 'index.cjs');
}

function failAllPending(err) {
  for (const [, entry] of workerPending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(err));
  }
  workerPending.clear();
}

let workerDevice = '';
function ensureWorker(device = 'cpu') {
  const want = device === 'directml' && isGpuPackInstalled() ? 'directml' : 'cpu';
  if (worker && workerDevice === want) return worker;
  console.log(`[voice] starting worker (device=${want}, reason=new-or-device-switch)`);
  if (worker) stopCoreWorker();
  workerDevice = want;
  const p = corePaths();
  const vvmPaths = listInstalledModels().map((v) => modelPath(v));
  worker = new Worker(workerScriptPath(), {
    workerData: {
      koffiPath: koffiPath(),
      coreDll: p.coreDll,
      ortDll: want === 'directml' ? p.ortDmlDll : p.ortCopy,
      ortDllCpu: p.ortCopy,
      libDirs: want === 'directml' ? [path.dirname(p.ortDmlDll), p.dmlExtraDir, path.dirname(p.coreDll)] : [],
      dictDir: p.dictDir,
      vvmPaths,
      gpu: want === 'directml',
    },
  });
  worker.on('message', (msg) => {
    const entry = msg && workerPending.get(msg.seq);
    if (!entry) return;
    workerPending.delete(msg.seq);
    clearTimeout(entry.timer);
    entry.resolve(msg);
  });
  worker.on('error', (err) => {
    failAllPending('voice worker crashed');
    stopCoreWorker();
  });
  worker.on('exit', (code) => {
    if (code !== 0) failAllPending('voice worker exited');
    worker = null;
  });
  return worker;
}

function stopCoreWorker() {
  failAllPending('voice worker stopped');
  if (worker) {
    try {
      worker.terminate();
    } catch (_) {}
    worker = null;
  }
  workerDevice = '';
}

function callWorker(msg, timeoutMs = 90000, device = 'cpu') {
  ensureWorker(device);
  const seq = ++workerSeq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      workerPending.delete(seq);
      reject(new Error('voice timed out'));
    }, timeoutMs);
    workerPending.set(seq, { resolve, reject, timer });
    worker.postMessage({ ...msg, seq });
  });
}

function coreSynth(text, styleId, speed, device = 'cpu') {
  const run = synthChain.then(() => callWorker({ cmd: 'synth', text, styleId, speed }, 90000, device));
  synthChain = run.catch(() => {});
  return run.then((res) => {
    if (!res || !res.ok || !res.wav) throw new Error((res && res.error) || 'synth failed');
    return Buffer.from(res.wav);
  });
}

// Known style genders (VOICEVOX API has no gender field).
// 0.vvm: Metan/Zundamon/Tsumugi/Hau. 13.vvm: Nana/Al/Bii.
// 4.vvm: Takehiro/Kenji. 9.vvm: Kotaro. 12.vvm: knights. 15.vvm: mixed.
const VOICE_GENDER_FEMALE = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 54, 55, 56, 57, 58, 59, 60, 75, 76, 20, 66, 77, 78, 79, 80, 46]);
const VOICE_GENDER_MALE = new Set([11, 21, 12, 32, 33, 34, 35, 51, 52, 53, 13, 81, 82, 83, 84, 85, 86]);

function voiceGender(id) {
  const n = Number(id);
  if (VOICE_GENDER_FEMALE.has(n)) return 'F';
  if (VOICE_GENDER_MALE.has(n)) return 'M';
  return 'U';
}

function tagAndSortSpeakers(speakers) {
  const list = (speakers || []).map((s) => {
    const gender = voiceGender(s.id);
    const tag = gender === 'F' ? '♀ ' : gender === 'M' ? '♂ ' : '';
    return { ...s, gender, label: `${tag}${s.label || `Voice ${s.id}`}` };
  });
  const rank = { F: 0, M: 1, U: 2 };
  list.sort((a, b) => rank[a.gender] - rank[b.gender] || a.id - b.id);
  return list;
}

async function coreSpeakers(device = 'cpu') {
  const res = await callWorker({ cmd: 'speakers' }, 120000, device);
  if (!res || !res.ok) throw new Error((res && res.error) || 'voice init failed');
  return tagAndSortSpeakers(res.speakers);
}

async function coreInit(device = 'cpu') {
  const res = await callWorker({ cmd: 'init' }, 120000, device);
  if (!res || !res.ok) throw new Error((res && res.error) || 'voice init failed');
  return res;
}

module.exports = {
  voxRoot,
  corePaths,
  voiceGender,
  tagAndSortSpeakers,
  isCoreInstalled,
  isGpuPackInstalled,
  downloadCore,
  downloadModel,
  downloadGpuPack,
  listInstalledModels,
  extraVoiceStatus,
  ensureWorker,
  stopCoreWorker,
  callWorker,
  coreSynth,
  coreSpeakers,
  coreInit,
};
