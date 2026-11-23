// Stamps Windows version-info + icon onto the built portable exe.
// electron-builder's own editing path (signAndEditExecutable) needs symlink
// privileges this machine doesn't grant, so we stamp with a standalone
// rcedit binary instead. Usage: node scripts/stamp-exe.js <exe> [version]
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exe = process.argv[2];
const version = process.argv[3] || require('../package.json').version;
if (!exe || !fs.existsSync(exe)) {
  console.error('[stamp-exe] exe not found:', exe);
  process.exit(1);
}
const rcedit = path.join(os.homedir(), 'AppData', 'Local', 'electron-stamp-tools', 'rcedit-x64.exe');
if (!fs.existsSync(rcedit)) {
  console.error('[stamp-exe] rcedit missing — download rcedit-x64.exe into %LOCALAPPDATA%\\electron-stamp-tools');
  process.exit(1);
}
const root = path.join(__dirname, '..');
const args = [
  exe,
  '--set-version-string', 'CompanyName', 'Kurizu',
  '--set-version-string', 'FileDescription', 'Virtual Pet — desktop virtual pet companion',
  '--set-version-string', 'ProductName', 'Virtual Pet',
  '--set-version-string', 'LegalCopyright', 'Copyright © 2026 Kurizu',
  '--set-file-version', version,
  '--set-product-version', version,
  '--set-icon', path.join(root, 'assets', 'icon.ico'),
];
const size = fs.statSync(exe).size;
if (size > 20 * 1024 * 1024 && !process.argv.includes('--force-portable')) {
  console.error(
    '[stamp-exe] REFUSED: this looks like a portable exe with an appended payload ' +
      `(${(size / 1048576).toFixed(1)} MB). rcedit would truncate it to a stub. ` +
      'Stamp win-unpacked exes only, or pass --force-portable if you really mean it.'
  );
  process.exit(1);
}
try {
  execFileSync(rcedit, args, { windowsHide: true, timeout: 120000 });
  console.log(`[stamp-exe] stamped ${path.basename(exe)} as Virtual Pet ${version}`);
} catch (err) {
  console.error('[stamp-exe] failed:', String((err && err.message) || err).slice(0, 200));
  process.exit(1);
}
