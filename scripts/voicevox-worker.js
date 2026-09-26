// VOICEVOX CORE synthesizer worker (runs in a worker thread so the
// ~1s synth never blocks Electron's main process).
// workerData: { koffiPath, coreDll, ortDll, ortDllCpu, libDirs[], dictDir, vvmPaths[], gpu }
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');
const koffi = require(workerData.koffiPath);

process.env.PATH = [...(workerData.libDirs || []), path.dirname(workerData.coreDll)]
  .filter(Boolean)
  .join(';') + ';' + process.env.PATH;

const lib = koffi.load(workerData.coreDll);
koffi.struct('LoadOrtOpts', { filename: 'str' });
koffi.struct('InitOpts', { acceleration_mode: 'int32', cpu_num_threads: 'uint16' });
koffi.struct('LoadModelOpts', { on_existing: 'int32' });
koffi.struct('SynthOpts', { enable_interrogative_upspeak: 'bool' });

const loadOrt = lib.func('int voicevox_onnxruntime_load_once(LoadOrtOpts opts, void *out)');
const openJtalk = lib.func('int voicevox_open_jtalk_rc_new(str dic_dir, void *out)');
const synthNew = lib.func('int voicevox_synthesizer_new(void *ort, void *oj, InitOpts opts, void *out)');
const modelOpen = lib.func('int voicevox_voice_model_file_open(str path, void *out)');
const loadModel = lib.func('int voicevox_synthesizer_load_voice_model(void *synth, void *model, LoadModelOpts opts)');
const metasJson = lib.func('void *voicevox_voice_model_file_create_metas_json(void *model)');
const createQuery = lib.func('int voicevox_synthesizer_create_audio_query(void *synth, str text, uint32_t style_id, void *out)');
const synthesis = lib.func(
  'int voicevox_synthesizer_synthesis(void *synth, str query_json, uint32_t style_id, SynthOpts opts, void *wav_len, void *wav)'
);
const jsonFree = lib.func('void voicevox_json_free(void *json)');
const wavFree = lib.func('void voicevox_wav_free(void *wav)');
const errMsg = lib.func('const char *voicevox_error_result_to_message(int code)');

const crt = koffi.load('msvcrt.dll');
const cStrlen = crt.func('size_t strlen(void *s)');
const cMemcpy = crt.func('void *memcpy(void *dst, void *src, size_t n)');

function ptrOut() {
  return Buffer.alloc(8);
}
function readPtr(buf) {
  return Number(buf.readBigUInt64LE(0));
}
function readCString(addr) {
  const len = Number(cStrlen(addr));
  if (!len || len > 64 * 1024 * 1024) throw new Error('bad string length');
  const buf = Buffer.alloc(len);
  cMemcpy(buf, addr, len);
  return buf.toString('utf8');
}

let synth = 0;
let modelHandles = [];
let loadWarnings = [];
let gpuActive = false;

function ensureReady() {
  if (synth) return '';
  try {
    const threads = Math.max(1, Math.floor(os.cpus().length / 2));
    const wantGpu = !!workerData.gpu;
    // Try GPU first when requested, fall back to CPU so voice never dies.
    const attempts = wantGpu
      ? [
          { ort: workerData.ortDll, mode: 2, gpu: true },
          { ort: workerData.ortDllCpu || workerData.ortDll, mode: 1, gpu: false },
        ]
      : [{ ort: workerData.ortDll, mode: 1, gpu: false }];
    let ort = 0;
    let oj = 0;
    let lastErr = '';
    for (const attempt of attempts) {
      let b = ptrOut();
      let rc = loadOrt({ filename: attempt.ort }, b);
      if (rc !== 0) {
        lastErr = 'onnxruntime: ' + errMsg(rc);
        continue;
      }
      ort = readPtr(b);
      b = ptrOut();
      rc = openJtalk(workerData.dictDir, b);
      if (rc !== 0) {
        lastErr = 'openjtalk: ' + errMsg(rc);
        continue;
      }
      oj = readPtr(b);
      b = ptrOut();
      rc = synthNew(ort, oj, { acceleration_mode: attempt.mode, cpu_num_threads: threads }, b);
      if (rc !== 0) {
        lastErr = 'synthesizer: ' + errMsg(rc);
        continue;
      }
      synth = readPtr(b);
      gpuActive = attempt.gpu;
      lastErr = '';
      break;
    }
    if (!synth) return lastErr || 'init failed';
    const vvmPaths = workerData.vvmPaths && workerData.vvmPaths.length
      ? workerData.vvmPaths
      : [workerData.vvmPath].filter(Boolean);
    if (!vvmPaths.length) return 'no voice models';
    const loadErrors = [];
    for (const vvmPath of vvmPaths) {
      b = ptrOut();
      rc = modelOpen(vvmPath, b);
      if (rc !== 0) {
        loadErrors.push(`${vvmPath}: open (${errMsg(rc)})`);
        continue;
      }
      const model = readPtr(b);
      rc = loadModel(synth, model, { on_existing: 1 });
      if (rc !== 0) {
        loadErrors.push(`${vvmPath}: load (${errMsg(rc)})`);
        continue;
      }
      modelHandles.push(model);
    }
    if (!modelHandles.length) return 'no voice models loaded (' + loadErrors.join('; ').slice(0, 200) + ')';
    loadWarnings = loadErrors.slice();
    return '';
  } catch (e) {
    return 'init: ' + (e && e.message ? e.message : String(e));
  }
}

parentPort.on('message', (msg) => {
  const { seq, cmd } = msg || {};
  const reply = (payload) => parentPort.postMessage({ seq, ...payload });
  try {
    if (cmd === 'init' || cmd === 'speakers' || cmd === 'synth') {
      const err = ensureReady();
      if (err) {
        reply({ ok: false, error: err });
        return;
      }
    }
    if (cmd === 'init') {
      reply({ ok: true, warnings: loadWarnings, gpuActive });
      return;
    }
    if (cmd === 'speakers') {
      const out = [];
      for (const model of modelHandles) {
        const mptr = Number(metasJson(model));
        const json = readCString(mptr);
        jsonFree(mptr);
        const parsed = JSON.parse(json);
        for (const sp of parsed) {
          for (const style of sp.styles || []) {
            if (style.type && style.type !== 'talk' && style.type !== 'streaming_talk') continue;
            out.push({ id: style.id, label: `${sp.name}（${style.name}）` });
          }
        }
      }
      reply({ ok: true, speakers: out, warnings: loadWarnings });
      return;
    }
    if (cmd === 'synth') {
      const text = String(msg.text || '').slice(0, 140);
      const styleId = Number(msg.styleId ?? 1) >>> 0;
      const speed = Math.max(0.5, Math.min(2, Number(msg.speed ?? 1)));
      const b = ptrOut();
      const rc = createQuery(synth, text, styleId, b);
      if (rc !== 0) {
        reply({ ok: false, error: String(errMsg(rc)) });
        return;
      }
      const qptr = readPtr(b);
      const qstr = readCString(qptr);
      jsonFree(qptr);
      const q = JSON.parse(qstr);
      q.speedScale = speed;
      const lenBuf = Buffer.alloc(8);
      const wavBuf = Buffer.alloc(8);
      const rc2 = synthesis(synth, JSON.stringify(q), styleId, { enable_interrogative_upspeak: true }, lenBuf, wavBuf);
      if (rc2 !== 0) {
        reply({ ok: false, error: String(errMsg(rc2)) });
        return;
      }
      const wavLen = Number(lenBuf.readBigUInt64LE(0));
      if (!wavLen || wavLen > 32 * 1024 * 1024) {
        reply({ ok: false, error: 'bad wav length' });
        return;
      }
      const wbuf = Buffer.alloc(wavLen);
      const wptr = readPtr(wavBuf);
      cMemcpy(wbuf, wptr, wavLen);
      wavFree(wptr);
      reply({ ok: true, wav: wbuf });
      return;
    }
    reply({ ok: false, error: 'unknown command' });
  } catch (e) {
    reply({ ok: false, error: (e && e.message ? e.message : String(e)).slice(0, 300) });
  }
});

