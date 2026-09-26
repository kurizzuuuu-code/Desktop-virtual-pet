const fields = [
  'discordToken',
  'geminiApiKey',
  'tenorApiKey',
  'targetChannelId',
  'ownerUserId',
  'botName',
  'identity',
  'tone',
  'catchphrases',
  'dislikes',
  'extraRules',
  'model',
  'thinkingLevel',
  'temperature',
  'maxOutputTokens',
  'maxHistoryTurns',
  'cooldownMs',
  'scheduleEveryMinutes',
  'fallbackReply',
];

const checks = ['replyOnMention', 'replyOnReply', 'replyInDm', 'scheduledEnabled'];

function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 2200);
}

function readForm() {
  const settings = {};
  for (const id of fields) {
    const el = document.getElementById(id);
    settings[id] = el.type === 'number' ? Number(el.value) : el.value;
  }
  for (const id of checks) {
    settings[id] = document.getElementById(id).checked;
  }
  return settings;
}

function fillForm(settings) {
  const model = document.getElementById('model');
  if (settings.model && ![...model.options].some((option) => option.value === settings.model)) {
    model.append(new Option(settings.model, settings.model, true, true));
  }
  for (const id of fields) {
    const el = document.getElementById(id);
    if (el && settings[id] != null) el.value = settings[id];
  }
  for (const id of checks) {
    document.getElementById(id).checked = Boolean(settings[id]);
  }
}

function setStatus(status) {
  const line = document.getElementById('statusLine');
  line.textContent = status.running
    ? `Running as ${status.botTag || 'bot'}`
    : 'Stopped';
  line.classList.toggle('running', Boolean(status.running));
  document.getElementById('startBtn').disabled = Boolean(status.running);
  document.getElementById('stopBtn').disabled = !status.running;
}

function appendLog(line) {
  const view = document.getElementById('logView');
  view.textContent += `${line}\n`;
  view.scrollTop = view.scrollHeight;
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  await window.agent.saveSettings(readForm());
  toast('Settings saved');
});

document.getElementById('startBtn').addEventListener('click', async () => {
  await window.agent.saveSettings(readForm());
  const result = await window.agent.start();
  setStatus(result.status);
  toast(result.ok ? 'Bot started' : result.error);
});

document.getElementById('stopBtn').addEventListener('click', async () => {
  const result = await window.agent.stop();
  setStatus(result.status);
  toast('Bot stopped');
});

(async () => {
  if (!window.agent) {
    document.getElementById('statusLine').textContent = 'Launch the desktop app to edit live settings.';
    return;
  }
  const data = await window.agent.getSettings();
  fillForm(data.settings);
  setStatus(data.status);
  document.getElementById('logView').textContent = (data.logs || []).join('\n') + (data.logs?.length ? '\n' : '');
  window.agent.onLog(appendLog);
})();
