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
  while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

let typingEl = null;

function send() {
  const text = (inputEl.value || '').trim().slice(0, 200);
  if (!text) return;
  inputEl.value = '';
  addMsg(text, 'me');
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
document.getElementById('chatMin')?.addEventListener('click', () => window.petAPI.windowMin?.());
document.getElementById('chatClose')?.addEventListener('click', () => window.petAPI.windowClose?.());
document.getElementById('chat-header')?.addEventListener('dblclick', (e) => {
  if (e.target.closest('button')) return;
  window.petAPI.windowMaxToggle?.();
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') send();
});

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
  window.petAPI.onChatReply((data) => {
    if (typingEl) {
      typingEl.remove();
      typingEl = null;
    }
    if (data?.text) addMsg(data.text, 'pet');
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
