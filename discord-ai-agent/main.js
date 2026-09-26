'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { DiscordAiAgent } = require('./bot');
const { DEFAULT_SETTINGS, mergeSettings } = require('./defaults');

let mainWindow = null;
let settings = mergeSettings();
const logs = [];

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function envPath() {
  return path.join(process.cwd(), '.env');
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function settingsFromEnv() {
  const env = parseEnvFile(envPath());
  return {
    discordToken: env.DISCORD_TOKEN && !env.DISCORD_TOKEN.includes('your_') ? env.DISCORD_TOKEN : '',
    geminiApiKey: env.GEMINI_API_KEY && !env.GEMINI_API_KEY.includes('your_') ? env.GEMINI_API_KEY : '',
    tenorApiKey: env.TENOR_API_KEY && !env.TENOR_API_KEY.includes('your_') ? env.TENOR_API_KEY : '',
    targetChannelId:
      env.TARGET_CHANNEL_ID && !/^1234567890/.test(env.TARGET_CHANNEL_ID)
        ? env.TARGET_CHANNEL_ID
        : '',
    ownerUserId: env.OWNER_USER_ID && /^\d+$/.test(env.OWNER_USER_ID) ? env.OWNER_USER_ID : '',
  };
}

function loadSettings() {
  const fromEnv = settingsFromEnv();
  try {
    if (fs.existsSync(settingsPath())) {
      settings = mergeSettings(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
      for (const [key, value] of Object.entries(fromEnv)) {
        if (!settings[key] && value) settings[key] = value;
      }
      if (settings._remappedPaidModel) {
        appendLog(
          `Switched saved model ${settings._remappedPaidModel} → ${settings.model} (free tier only).`,
        );
        delete settings._remappedPaidModel;
        saveSettingsToDisk();
      }
      return;
    }
  } catch (error) {
    appendLog(`Could not read settings.json: ${error.message}`);
  }

  settings = mergeSettings(fromEnv);
}

function saveSettingsToDisk() {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf8');
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function appendLog(line) {
  const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
  logs.push(stamped);
  if (logs.length > 300) logs.shift();
  sendToRenderer('log', stamped);
  console.log(line);
}

const agent = new DiscordAiAgent({
  getSettings: () => settings,
  log: appendLog,
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    backgroundColor: '#12141c',
    title: 'Discord AI Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  appendLog('UI ready. Save settings, then start the bot.');
});

app.on('window-all-closed', async () => {
  if (agent.getStatus().running) await agent.stop();
  app.quit();
});

ipcMain.handle('settings:get', () => ({
  settings,
  logs,
  status: agent.getStatus(),
}));

ipcMain.handle('settings:save', async (_event, nextSettings) => {
  settings = mergeSettings(nextSettings);
  if (settings._remappedPaidModel) {
    appendLog(`Paid model ${settings._remappedPaidModel} ignored. Using free ${settings.model}.`);
    delete settings._remappedPaidModel;
  }
  saveSettingsToDisk();
  agent.applyLiveSettings();
  appendLog('Settings saved. New chats will use the updated personality.');
  return { ok: true, settings };
});

ipcMain.handle('bot:start', async () => {
  try {
    const status = await agent.start();
    return { ok: true, status };
  } catch (error) {
    appendLog(`Start failed: ${error.message}`);
    return { ok: false, error: error.message, status: agent.getStatus() };
  }
});

ipcMain.handle('bot:stop', async () => {
  const status = await agent.stop();
  return { ok: true, status };
});

ipcMain.handle('bot:status', () => agent.getStatus());
