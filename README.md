# Virtual Pet 🐾

A customizable desktop virtual pet (Electron, Windows) that lives on your screen:
walks around, reacts to games and music, chats with AI, talks to other pets, and
occasionally pranks you.

## Quick start (dev)

```bat
npm install
npm start
```

Dev config lives in `%APPDATA%\desktop-virtual-pet\pet-config.json`.
The portable exe uses `%APPDATA%\Virtual Pet\pet-config.json`.

## Build the portable exe

```bat
Build Virtual Pet.exe.bat
```

`npm run build` first runs `prebuild`, which bakes your dev settings
(sanitized — API keys and personal history are stripped) into
`assets/baked-defaults.json` so fresh installs start from your setup.
Output: `Virtual Pet.exe` in the project root.

## Features

- Multi-pet desktop companions (GIF avatars, character packs, variants)
- Game reactions: window titles, running processes, log-free screen OCR
  (defeat/victory), per-game trash talk
- VOICEVOX text-to-speech (external engine or built-in CORE, incl. GPU)
- AI chat (OpenAI-compatible endpoints + local Ollama, with fallbacks)
- Pet-to-pet conversations, friendships, jealousy, gifts, tag, RPS mini-games
- Moods + persistent memory, morning greetings, proactive chatter
- Music-reactive dancing, Spotify now-playing reactions
- Prank kit (glitch, blackout, fake BSOD, jumpscare, wallpaper — all reversible)
- Click-through overlay that never eats game input

## Setup notes

- **Voices:** launch VOICEVOX at `http://127.0.0.1:50021`, or download the
  built-in CORE in Settings → Voice (downloads ~180MB once).
- **AI chat:** paste a key in Settings → Chat. Keys stay in your local config
  file and are never baked into builds.
- **Discord agent:** `discord-ai-agent/` is a separate bot. Copy its
  `.env.example` to `.env` and fill in your own tokens — `.env` is git-ignored.

## Project layout

| Path | What |
| --- | --- |
| `main.js` | App wiring: windows, IPC, detection, AI/voice backends |
| `preload.js` | Renderer bridge |
| `pet/` | Pet window: sprite, speech, social, minigames |
| `settings/` | Settings window UI |
| `chat/` | Chat window |
| `prank/` | Prank overlay scenes |
| `scripts/` | PowerShell helpers (OCR, foreground, now-playing) + bake script |
| `assets/` | Icons, default art (per-machine baked files regenerate on build) |

Made by Kurizu.
