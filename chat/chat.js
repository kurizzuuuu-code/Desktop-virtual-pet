const logEl = document.getElementById('chat-log');
const inputEl = document.getElementById('chat-input');
const sendBtn = document.getElementById('chat-send');
const nameEl = document.getElementById('chat-pet-name');
let chatPetId = null;
try {
  chatPetId = new URLSearchParams(window.location.search).get('petId');
} catch (_) {}

function addMsg(text, who) {
  const div = document.createElement('div');
  div.className = `msg ${who}`;
  div.textContent = text;
  logEl.appendChild(div);
  trimLog();
  logEl.scrollTop = logEl.scrollHeight;
}

// Approval cards are never trimmed away — losing one strands a whole task.
function trimLog() {
  let guard = 0;
  while (logEl.children.length > 200 && guard++ < 220) {
    const first = logEl.firstChild;
    if (first.classList && first.classList.contains('approval') && first.nextElementSibling) {
      logEl.removeChild(first.nextElementSibling);
    } else if (first.classList && first.classList.contains('approval')) {
      break;
    } else {
      logEl.removeChild(first);
    }
  }
}

let typingEl = null;
const beamEl = document.getElementById('chat-beam');
function setBeamActive(active) {
  if (beamEl) beamEl.classList.toggle('active', !!active);
}

function send() {
  const text = (inputEl.value || '').trim().slice(0, 200);
  if (!text) return;
  inputEl.value = '';
  addMsg(text, 'me');
  setBeamActive(true);
  if (!typingEl) {
    typingEl = document.createElement('div');
    typingEl.className = 'msg pet typing';
    typingEl.textContent = '…';
    logEl.appendChild(typingEl);
    logEl.scrollTop = logEl.scrollHeight;
  }
  window.petAPI.chatSend({ text, petId: chatPetId });
}

sendBtn.addEventListener('click', send);
const modeBtn = document.getElementById('chatModeBtn');
let agentModeOn = false;
function paintModeBtn() {
  if (!modeBtn) return;
  modeBtn.classList.toggle('on', agentModeOn);
  modeBtn.textContent = agentModeOn ? 'AGENT' : 'AI';
  try {
    document.body.classList.toggle('agent-on', agentModeOn);
  } catch (_) {}
  modeBtn.title = agentModeOn
    ? 'Agent mode ON — every message is a task (click for chat mode)'
    : 'Agent mode OFF — click so every message is a task';
}
modeBtn?.addEventListener('click', () => {
  agentModeOn = !agentModeOn;
  paintModeBtn();
  try {
    window.petAPI.setAgentMode({ petId: chatPetId, on: agentModeOn });
  } catch (_) {}
});
paintModeBtn();
document.getElementById('chatMin')?.addEventListener('click', () => window.petAPI.windowMin?.());
document.getElementById('chatClose')?.addEventListener('click', () => window.petAPI.windowClose?.());
document.getElementById('chat-header')?.addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  window.petAPI.windowMaxToggle?.();
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

const THEMES = ['pink', 'purple', 'dark', 'light'];
function applyChatTheme(name) {
  const theme = THEMES.includes(name) ? name : 'pink';
  try {
    document.documentElement.dataset.theme = theme;
  } catch (_) {}
  try {
    localStorage.setItem('vp-theme', theme);
  } catch (_) {}
}
try {
  applyChatTheme(localStorage.getItem('vp-theme') || 'pink');
} catch (_) {}
try {
  window.petAPI.onTheme?.((data) => applyChatTheme(data?.theme));
} catch (_) {}

async function init() {
  if (!window.petAPI) {
    addMsg('Open me from the app, not a browser~', 'pet');
    return;
  }
  try {
    const config = await window.petAPI.getConfig();
    const pets = config.pets || [];
    const target = (chatPetId && pets.find((p) => p.id === chatPetId))
      || pets.find((p) => p.id === config.activePetId)
      || pets[0]
      || {};
    if (!chatPetId && target.id) chatPetId = target.id;
    nameEl.textContent = target.name || 'Pet';
    document.title = `Chat with ${target.name || 'pet'}`;
  } catch (_) {}
  addMsg('Hi hi! Type anything — I can chat, do math, flip coins, tell jokes… or type "games" to play rock-paper-scissors and number guessing~', 'pet');
  function addApproval(approval) {
    const card = document.createElement('div');
    card.className = 'msg pet approval';    const title = document.createElement('div');
    title.textContent = 'She wants to do this:';
    title.style.fontWeight = '700';
    card.appendChild(title);
    for (const a of approval.actions || []) {
      const line = document.createElement('div');
      line.textContent = '• ' + a;
      card.appendChild(line);
    }
    const row = document.createElement('div');
    row.className = 'approval-row';
    const yes = document.createElement('button');
    yes.type = 'button';
    yes.textContent = 'Approve';
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      setBeamActive(true);
      addMsg('Approved ✓', 'me');
      const res = await window.petAPI.chatApprove({ sessionId: approval.sessionId, approved: true });
      if (!res?.ok && !res?.reply) {
        setBeamActive(false);
        addMsg(`Hmm (${res?.error || 'unknown'})`, 'pet');
      }
    });
    const no = document.createElement('button');
    no.type = 'button';
    no.textContent = 'Deny';
    no.addEventListener('click', async () => {
      yes.disabled = true;
      no.disabled = true;
      setBeamActive(false);
      addMsg('Denied', 'me');
      await window.petAPI.chatApprove({ sessionId: approval.sessionId, approved: false });
    });
    row.appendChild(yes);
    row.appendChild(no);
    card.appendChild(row);
    logEl.appendChild(card);
    trimLog();
    logEl.scrollTop = logEl.scrollHeight;
    try {
      card.scrollIntoView({ block: 'nearest' });
      card.classList.add('flash');
      setTimeout(() => card.classList.remove('flash'), 2400);
    } catch (_) {}
  }

  let activityBox = null;
  function ensureActivityBox() {
    if (!activityBox) {
      activityBox = document.createElement('details');
      activityBox.className = 'activity single';
      activityBox.open = true;
      const sum = document.createElement('summary');
      const label = document.createElement('span');
      label.textContent = 'Task activity';
      const cnt = document.createElement('span');
      cnt.className = 'activity-count';
      cnt.textContent = '0';
      sum.appendChild(label);
      sum.appendChild(document.createTextNode(' ('));
      sum.appendChild(cnt);
      sum.appendChild(document.createTextNode(')'));
      activityBox.appendChild(sum);
      const inner = document.createElement('div');
      inner.className = 'activity-body';
      activityBox.appendChild(inner);
      logEl.appendChild(activityBox);
    }
    return activityBox;
  }
  function activityLine(el) {
    const box = ensureActivityBox();
    box.open = true;
    const inner = box.querySelector('.activity-body');
    inner.appendChild(el);
    while (inner.children.length > 60) inner.removeChild(inner.firstChild);
    const cnt = box.querySelector('.activity-count');
    if (cnt) cnt.textContent = String(inner.children.length);
    logEl.appendChild(box);
    trimLog();
    logEl.scrollTop = logEl.scrollHeight;
  }
  function closeActivityBox() { if (activityBox) activityBox.open = false; }

  window.petAPI.onChatReply((data) => {
    if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
    closeActivityBox();
    if (data?.text) {
      addMsg(data.text, 'pet');
      setBeamActive(false);
    }
    closeActivityBox();
    if (data?.approval) {
      addApproval(data.approval);
      setBeamActive(false);
    }
    if (data?.step) {
      setBeamActive(true);
      const st = document.createElement('div');
      st.className = 'msg sys step';
      st.textContent = data.step;
      activityLine(st);
    }
    if (data?.thinking) {
      setBeamActive(true);
      const th = document.createElement('div');
      th.className = 'msg sys thinking';
      th.textContent = '\u{1F4AD} ' + data.thinking;
      activityLine(th);
    }
    if (data?.taskActive !== undefined) {
      setBeamActive(Boolean(data.taskActive));
    }
    if (data?.note) {
      const sys = document.createElement('div');
      sys.className = 'msg sys';
      sys.textContent = data.note;
      logEl.appendChild(sys);
      logEl.scrollTop = logEl.scrollHeight;
    }
  });
  inputEl.focus();
}

init();
