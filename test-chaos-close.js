const { exec } = require('child_process');

const ps = [
  "$skip = @('Virtual Pet','electron','Electron','Program Manager','Windows Input Experience','Task Manager');",
  '$list = Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowHandle -ne 0 };',
  '$candidates = $list | Where-Object {',
  '  $ok = $true',
  '  foreach ($s in $skip) { if ($_.MainWindowTitle -like "*$s*" -or $_.ProcessName -like "*electron*") { $ok = $false } }',
  '  $ok',
  '};',
  'if ($candidates) {',
  '  $p = $candidates | Get-Random',
  '  $title = $p.MainWindowTitle',
  '  Write-Output $title',
  '} else { Write-Output "" }',
].join(' ');

exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, { windowsHide: true }, (err, stdout, stderr) => {
  console.log('stdout:', JSON.stringify(stdout));
  console.log('stderr:', JSON.stringify(stderr));
  console.log('err:', err);
});
