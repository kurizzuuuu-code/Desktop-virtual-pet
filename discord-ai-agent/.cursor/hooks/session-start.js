'use strict';

const fs = require('fs');

let raw = '';
try {
  raw = fs.readFileSync(0, 'utf8');
} catch {
  raw = '';
}

process.stdout.write(
  JSON.stringify({
    additional_context: [
      'This repo is a Discord AI agent (Electron UI + bot.js).',
      'Model: free-tier Flash (gemini-3.6-flash by default) with thinkingConfig.thinkingLevel.',
      'Persona: rude, loves pizza and cats, extra mean to OWNER_USER_ID.',
      'GIFs: Gemini fetch_gif tool → Tenor. Interval posts: every 30 minutes to TARGET_CHANNEL_ID.',
      'Never print, commit, or log .env secrets (DISCORD_TOKEN, GEMINI_API_KEY, TENOR_API_KEY).',
      'Edit personality in defaults.js or the desktop UI Personality tab.',
    ].join(' '),
  }),
);
void raw;
