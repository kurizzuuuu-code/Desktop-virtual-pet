'use strict';

const fs = require('fs');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  raw = '';
}

let command = '';
try {
  command = String(JSON.parse(raw || '{}').command || '');
} catch {
  command = raw;
}

const looksLikeSecretDump =
  /(\.env\b|DISCORD_TOKEN|GEMINI_API_KEY|TENOR_API_KEY)/i.test(command) &&
  /(git\s+add|git\s+commit|git\s+push|\btype\b|\bcat\b|Get-Content|Set-Clipboard|\becho\b|Write-Output|\bcurl\b|Invoke-WebRequest)/i.test(
    command,
  );

if (looksLikeSecretDump) {
  process.stdout.write(
    JSON.stringify({
      permission: 'deny',
      user_message: 'Blocked a command that could leak bot tokens or API keys.',
      agent_message: 'Do not read, print, commit, or upload .env secrets.',
    }),
  );
  process.exit(0);
} else {
  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}
