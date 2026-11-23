// Subtitle caption renderer: shows her spoken line as a bottom caption while
// the desktop pet is hidden (VTube Studio mode). Display-only, click-through.
let hideTimer = null;

function render(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1');
}

function hideCaption() {
  clearTimeout(hideTimer);
  document.body.classList.remove('show');
}

window.petAPI?.onSubtitle?.((data) => {
  const line = document.getElementById('line');
  if (!line || !data) return;
  // Explicit end from the pet: her voice finished / the bubble closed.
  if (data.end) {
    hideCaption();
    return;
  }
  const text = String(data.text || '').trim();
  if (!text) return;
  line.innerHTML = render(text);
  document.body.classList.add('show');
  clearTimeout(hideTimer);
  const ms = Math.min(30000, Math.max(1800, Number(data.ms) || 3200));
  hideTimer = setTimeout(hideCaption, ms);
});
