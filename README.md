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

## Minecraft bot

The full build also runs a Minecraft Java bot (`minecraft-bot.js`, mineflayer) so
the pet can join a LAN world or a friend server and act in it. Type commands
in the game's chat:

| Command | What she does |
| --- | --- |
| `right click` | Uses what she's looking at: opens a chest, places the block in her hand, or fires the Stellar Remote |
| `right click the ground` | Uses the block under her feet instead of the crosshair |
| `right click in the air` | Uses the item without aiming at anything |
| `left click` | Attacks the mob or player in front of her |
| `cast gungnir` | Fires the Stellar Remote (The Shooting Star demo) |
| `cast gungnir at Steve` | Aims at that player first, then fires |
| `cast gungnir at the creeper` | Aims at that mob first, then fires |
| `right click gungnir 50` | Fires that skill with a bigger strike (the number is the power) |
| `hold the mod item` | Puts the modded item in her hand and reports its id |
| `look here` / `look at me` | Turns and looks at you (wherever you are) |
| `look there` | Looks at whatever *you* are aiming at (your cursor, up to 64 blocks out) |
| `look at 123 65 456` | Looks at those Minecraft coordinates |
| `look at Steve` / `look at the creeper` | Looks at that player or mob |

Her look orders need no name and hold for a few seconds, so the idle gaze
doesn't immediately wander off again. `look there` casts a ray from *your*
eyes along your crosshair, so it works even if she is standing somewhere
else; if you're looking at the sky she looks the same direction into the air.

Everything she says in Minecraft chat is also shown and spoken by the desktop
pet with her TTS voice (turn it off with **Minecraft → Say her Minecraft chat
out loud** in Settings).

The Stellar Remote (The Shooting Star demo) does not cast through a normal
right click — the mod talks over its own Forge channel, so the bot writes the
shot record itself and waits for the mod to answer. Skills: The Shooting Star,
Gungnir, Seven Stars, Tesseract, Gravitia (say `cast <name>`).

Casts share the cutscene with everyone near the spell (like a real client
with `cutscenes.everyone` on in `rimulib.properties`); say "for me only" to
keep one cast private. The bot itself never shows a cutscene — it is a
headless client without the mod's renderer — but the strike, the erased
terrain and the film for everyone else all happen.

The mod's cast packet carries no coordinates: the server shoots along the
caster's look vector, so the bot turns to face the target ("at Steve", "at
the creeper") before it fires. With no name given she aims at whatever living
thing is in her crosshair — mobs and animals count too, exactly like for a
real player — and fires where she is looking otherwise.

## Setup notes

- **Voices:** launch VOICEVOX at `http://127.0.0.1:50021`, or download the
  built-in CORE in Settings → Voice (downloads ~180MB once).
- **AI chat:** paste a key in Settings → Chat. Keys stay in your local config
  file and are never baked into builds.
- **Content mode:** Settings → Chat → *Content & restriction mode* controls the
  tone. It defaults to **Uncensored** (no app-level word filter, no refusal
  instructions). Pick **Model default** to inject no content instructions at
  all and let the model decide. Some providers still apply their own safety
  layer - Gemini's OpenAI-compatible endpoint, for example, does not expose
  safety settings, so it can still soften or block a reply no matter what the
  app asks for.
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
