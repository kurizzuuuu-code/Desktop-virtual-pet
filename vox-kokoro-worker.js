// Kokoro TTS worker: runs in its own process so onnxruntime inference and
// the 90MB model download never block the main thread (which would freeze
// every window while she talks).
const fs = require('fs');

let ttsPromise = null;
let envCacheDir = null;

async function kokoroEngine() {
  if (!ttsPromise) {
    ttsPromise = (async () => {
      const mod = await import('kokoro-js');
      try {
        if (envCacheDir) {
          mod.env.cacheDir = envCacheDir;
          mod.env.allowLocalModels = false;
        }
      } catch (_) {}
      return mod.KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'cpu',
        progress_callback: (p) => {
          try {
            process.send({ t: 'progress', percent: Math.round(Number((p && p.progress) || 0)) });
          } catch (_) {}
        },
      });
    })().catch((err) => {
      ttsPromise = null;
      throw err;
    });
  }
  return ttsPromise;
}

process.on('message', async (msg) => {
  if (!msg || msg.t !== 'kokoro') return;
  try {
    if (msg.cacheDir) envCacheDir = msg.cacheDir;
    const tts = await kokoroEngine();
    const audio = await tts.generate(String(msg.text || ''), {
      voice: msg.voice || 'af_heart',
      speed: Math.max(0.5, Math.min(2, Number(msg.speed) || 1)),
    });
    const wav = Buffer.from(audio.toWav());
    if (!wav.length) throw new Error('empty audio');
    fs.writeFileSync(msg.outPath, wav);
    process.send({ id: msg.id, ok: true });
  } catch (err) {
    process.send({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
});
