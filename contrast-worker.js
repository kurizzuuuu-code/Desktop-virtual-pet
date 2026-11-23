// Contrast worker: Fast zero-allocation lookup-table contrast stretch.
// Offloaded from the main UI thread to prevent any stutter.
const { parentPort } = require('worker_threads');

parentPort.on('message', (msg) => {
  if (!msg || msg.t !== 'contrast') return;
  try {
    const buf = Buffer.from(msg.buf);
    const factor = Number(msg.factor) || 1;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) {
      const out = (v - 128) * factor + 128;
      lut[v] = out <= 0 ? 0 : out >= 255 ? 255 : Math.round(out);
    }
    for (let i = 0; i + 3 < buf.length; i += 4) {
      buf[i] = lut[buf[i]];
      buf[i + 1] = lut[buf[i + 1]];
      buf[i + 2] = lut[buf[i + 2]];
    }
    parentPort.postMessage({ id: msg.id, ok: true, buf }, [buf.buffer]);
  } catch (err) {
    parentPort.postMessage({ id: msg.id, ok: false, error: String((err && err.message) || err) });
  }
});
