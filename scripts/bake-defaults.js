// Bakes the developer's live settings into the build as factory defaults.
// Runs automatically before `npm run build` (see package.json "prebuild").
//
// Sanitization (never baked):
//   - aiKey            -> '' (your key stays yours; never ships in the exe)
//   - per-pet memory   -> recreated fresh (your history doesn't ship)
//   - per-pet mood     -> recreated fresh
//   - prankPrevWallpaper transient restore path
// Everything else (pets, toggles, lines, voices, friendships, prank setup,
// image *names*) ships as-is. Referenced avatar/sound/image files are copied
// into assets/baked-avatars and seeded into the user's data dir on first run.
// Never fails the build: warns and exits 0 when there is nothing to bake.
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'assets', 'baked-defaults.json');
const OUT_DIR = path.join(ROOT, 'assets', 'baked-avatars');

function fileNameRef(v) {
  return (
    typeof v === 'string' &&
    /^[^\0\\/:*?"<>|]+\.(gif|png|webp|apng|jpg|jpeg|wav|mp3|ogg)$/i.test(v)
  );
}

function collectFiles(raw, into) {
  const walk = (v) => {
    if (!v) return;
    if (typeof v === 'string') {
      if (fileNameRef(v)) into.add(v);
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

function main() {
  if (process.platform !== 'win32') {
    console.log('[bake-defaults] non-Windows build machine — skipping.');
    return;
  }
  const devConfig = path.join(os.homedir(), 'AppData', 'Roaming', 'desktop-virtual-pet', 'pet-config.json');
  const devAvatars = path.join(os.homedir(), 'AppData', 'Roaming', 'desktop-virtual-pet', 'avatars');
  if (!fs.existsSync(devConfig)) {
    console.log('[bake-defaults] no dev config found — shipping factory defaults.');
    return;
  }
  const raw = JSON.parse(fs.readFileSync(devConfig, 'utf8'));
  const baked = JSON.parse(JSON.stringify(raw));
  baked.aiKey = '';
  delete baked.prankPrevWallpaper;
  for (const pet of baked.pets || []) {
    delete pet.memory;
    delete pet.mood;
  }

  const names = new Set();
  collectFiles(baked, names);

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let copied = 0;
  const missing = [];
  for (const n of names) {
    const src = path.join(devAvatars, n);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(OUT_DIR, n));
      copied += 1;
    } else {
      missing.push(n);
    }
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(baked, null, 2));
  console.log(
    `[bake-defaults] baked ${(baked.pets || []).length} pet(s), ${copied} file(s) to assets/baked-avatars ` +
      `(aiKey stripped, memory/mood reset).`
  );
  if (missing.length) {
    console.log(`[bake-defaults] warning: ${missing.length} referenced file(s) not found in dev avatars and skipped: ${missing.join(', ')}`);
  }
}

try {
  main();
} catch (err) {
  console.log(`[bake-defaults] warning: ${String((err && err.message) || err)} — shipping factory defaults.`);
}
