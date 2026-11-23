// ---------------------------------------------------------------------------
// Minecraft bot worker: runs minecraft-bot.js in a FORKED subprocess so
// pathfinding/A* can never block Electron's main thread (which was freezing
// cursor polling and the UI while she struggled with a tree).
// Protocol over process.send:
//   main→worker: {t:'connect',opts} {t:'disconnect'} {t:'say',text}
//                {t:'reply',id,text} (fulfills a needReply)
//   worker→main: {t:'status',s} {t:'msa',d} {t:'needReply',id,text}
//                {t:'speak',text} (a line she just said in chat, for TTS)
// ---------------------------------------------------------------------------
const javaBot = require('./minecraft-bot.js');
let mc = javaBot;

const pending = new Map();
let replySeq = 0;

process.on('message', (m) => {
  try {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'connect') {
      try {
        mc = javaBot;
        mc.connect(m.opts || {}, {
          onStatus: (s) => {
            try {
              process.send({ t: 'status', s });
            } catch (_) {}
          },
          onLog: (line) => {
            try {
              process.send({ t: 'log', msg: line });
            } catch (_) {}
          },
          onSay: (line) => {
            try {
              process.send({ t: 'speak', text: line });
            } catch (_) {}
          },
          onMsaCode: (d) => {
            try {
              process.send({ t: 'msa', d });
            } catch (_) {}
          },
          getReply: (text, quiet, extra) => new Promise((resolve) => {
            const id = `r${++replySeq}`;
            pending.set(id, resolve);
            try {
              process.send({
                t: 'needReply', id, text, quiet: !!quiet,
                user: (extra && extra.user) || '',
                scope: (extra && extra.scope) || '',
              });
            } catch (_) {
              pending.delete(id);
              resolve('');
              return;
            }
            setTimeout(() => {
              if (pending.has(id)) {
                pending.delete(id);
                resolve('');
              }
            }, 60000);
          }),
        });
      } catch (_) {}
    } else if (m.t === 'disconnect') {
      try {
        mc.disconnect();
      } catch (_) {}
    } else if (m.t === 'say') {
      try {
        mc.say(m.text);
      } catch (_) {}
    } else if (m.t === 'reply') {
      const r = pending.get(m.id);
      if (r) {
        pending.delete(m.id);
        try {
          r(String(m.text || ''));
        } catch (_) {}
      }
    }
  } catch (_) {}
});

// Die with the parent: main going away closes the IPC channel.
process.on('disconnect', () => {
  try {
    process.exit(0);
  } catch (_) {}
});
