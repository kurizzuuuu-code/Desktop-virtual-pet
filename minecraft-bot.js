// ---------------------------------------------------------------------------
// Minecraft Java bot (Mineflayer): joins LAN worlds / friend servers, follows
// a player around, and chats with the pet's personality. No rendering, so
// it's light. Owned by main.js — everything Electron/AI lives there; this
// file only gets plain callbacks via hooks:
//   { onStatus({state, detail}), onMsaCode({url, code}), getReply(text) }
// ---------------------------------------------------------------------------
let bot = null;
let retryTimer = null;
let currentOpts = null;
let currentHooks = null;
let following = '';
let lastErr = '';
let startGen = 0;
let guardMode = false;
let guardTarget = null;
let guardTimer = null;
let guardTicking = false;
let taskBusy = false;
let woodGen = 0;
// Host candidates to try for the current connect (see connect()): when the
// configured host is one of THIS PC's own addresses we retry over loopback,
// because the Windows Firewall blocks inbound on the LAN adapter.
let hostCandidates = [];
let hostCandidateIdx = 0;
let fallbackPending = false;
let errorReportedGen = -1;
// Survival-buddy state
let stayPut = false;
let wanderAt = 0;
let lookAt = 0;
// Set by an explicit "look here / there / at <coords>" order: the idle gaze
// wanders off every few seconds, and it must not undo what the player asked.
let lookHoldUntil = 0;
// Bumped by every look order so an older "keep watching you" loop stops.
let lookGen = 0;
let armorAt = 0;
let sleepTriedDay = -1;
const debts = new Map(); // attacker key -> hits owed back (tit-for-tat)
const lastSwing = new Map(); // player name -> last arm-swing timestamp
let bodyguard = null; // { id, victim, until, announced }
// Ordered hits: { kind: 'mob'|'player', key|name, label }
let huntOrder = null;
let huntResolved = false;
// Anti-air / loot state
let lootAt = 0;
let rangedAt = 0;
let rangedBusy = false;
let strafeAt = 0;
let noArrowFor = '';
let giveupFor = '';
let eatAt = 0;
let begAt = 0;
let autoHunted = false;
let swimming = false;
// Detached combat jobs (pillaring/digging take minutes — never on the brain)
let combatGen = 0;
let combatBusy = false;
let lootBusy = false;
// Stuck watchdog
let stuckTicks = 0;
let stuckCooldownUntil = 0;
let stuckPos = null;
// Modded-floor ground fixer: some mods (Backrooms etc.) use blocks the
// client can't resolve, so physics never reports onGround and she only gets
// air movement (crawl speed). If her Y is stable and she isn't falling, we
// tell physics she's grounded.
let groundedGuess = 0;
let lastStableY = null;
let groundFixActive = false;
let standInMode = false;
let moddedLocked = false;
let lastDimension = null;
let directSteerActive = false;
let directSteerTarget = null;
let rawBlockAt = null;

async function equipDigTool() {
  try {
    const items = invItems();
    const tool = items.find((i) => i.name.includes('_pickaxe'))
      || items.find((i) => i.name.includes('_axe'))
      || items.find((i) => i.name.includes('_shovel'));
    if (tool) {
      try {
        await bot.equip(tool, 'hand').catch(() => {});
      } catch (_) {}
      return true;
    }
  } catch (_) {}
  return false;
}

// Fuzzy inventory lookup: "diamond sword" → diamond_sword.
function findInvItemByName(name) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const raw = String(name || '').trim().toLowerCase();
  if (!raw) return null;
  try {
    const items = invItems();
    const want = norm(raw);
    let hit = items.find((i) => norm(i.name) === want);
    if (hit) return hit;
    if (want.length >= 3) {
      hit = items.find((i) => norm(i.name).includes(want));
      if (hit) return hit;
    }
    const tokens = raw.split(/\s+/).filter((t) => t.length > 1);
    if (tokens.length) {
      hit = items.find((i) => tokens.every((t) => i.name.includes(t)));
      if (hit) return hit;
    }
    // Modded items have no usable name ("unknown"), so let "mod", "special"
    // or the raw item id from the chat report find them.
    if (/^(mod|modded|special|unknown|mystery|new|the mod item)$/i.test(raw) || /^\d+$/.test(raw)) {
      const mods = items.filter((i) => isModItem(i));
      if (/^\d+$/.test(raw)) {
        const byId = mods.find((i) => String(i.type) === raw);
        if (byId) return byId;
      }
      if (mods.length) return mods[0];
    }
  } catch (_) {}
  return null;
}

// "use <item>" / "equip <item>" / "use it": grab a matching item (or walk to
// the nearest dropped one), put it in hand, and consume it if it's food.
async function useItemTask(requester, nameArg) {
  if (!bot || !bot.entity) return;
  if (taskBusy) {
    try {
      bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  combatGen += 1;
  combatBusy = false;
  directSteerActive = false;
  directSteerTarget = null;
  try {
    const generic = !nameArg || /^(it|this|that|the item|this item|this thing)$/i.test(String(nameArg).trim());
    let item = generic ? null : findInvItemByName(nameArg);
    if (!item) {
      const before = new Set(invItems().map((i) => i.name));
      const drop = nearestDrop(16);
      if (drop) {
        try {
          const { goals } = require('mineflayer-pathfinder');
          bot.pathfinder.setGoal(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
        } catch (_) {}
        for (let i = 0; i < 20; i++) {
          if (!alive()) return;
          try {
            if (!bot.entities[drop.id]) break;
          } catch (_) {}
          await wait(400);
        }
        await wait(600);
      }
      const after = invItems();
      item = after.find((i) => !before.has(i.name)) || (generic ? after[after.length - 1] : null);
    }
    if (!item) {
      try {
        bot.chat(nameArg && !generic
          ? `I don't have "${String(nameArg).slice(0, 30)}"~`
          : 'Nothing to use — drop me something first~');
      } catch (_) {}
      mcLog(`use: no item found (${nameArg || 'it'})`);
      return;
    }
    try {
      await bot.equip(item, 'hand');
    } catch (e) {
      try {
        bot.chat(`Couldn't hold ${itemLabel(item)}~`);
      } catch (_) {}
      mcLog(`use: equip failed for ${item.name}: ${String((e && e.message) || e).slice(0, 80)}`);
      return;
    }
    if (GOOD_FOOD.includes(item.name)) {
      try {
        await bot.consume();
        bot.chat(`Ate ${itemLabel(item)}~`);
        mcLog(`use: ate ${item.name}`);
        return;
      } catch (_) {}
    }
    try {
      bot.chat(`Holding ${itemLabel(item)}~`);
    } catch (_) {}
    mcLog(`use: holding ${item.name} (id ${item.type})`);
  } finally {
    if (myGen === woodGen) taskBusy = false;
  }
}

// "hold the mod item" / "what am I holding": put the first modded (unmapped)
// item in her hand and report its raw id. Modded ids are the one thing the
// bot can't name, so this is the diagnostic that tells us what it actually
// picked up.
async function heldInfoTask() {
  if (!bot || !bot.entity) return;
  const say = (t) => {
    try {
      bot.chat(t);
    } catch (_) {}
  };
  let held = bot.heldItem;
  if (!held) {
    const mod = invItems().find((i) => isModItem(i));
    if (mod) {
      try {
        await bot.equip(mod, 'hand');
      } catch (_) {}
      held = bot.heldItem;
    }
  }
  if (!held) {
    say('My hands are empty~');
    mcLog('held: nothing');
    return;
  }
  say(`Holding ${itemLabel(held)} (id ${held.type}, x${held.count})~`);
  mcLog(`held: name=${held.name} type=${held.type} count=${held.count} mod=${isModItem(held)}`);
}

// Best tool for a gather job by suffix priority (netherite first naturally,
// since inventory order isn't tiered we just take the first match of the
// best suffix class available — any pickaxe beats a hand).
function toolTier(n) {
  const s = String(n || '');
  if (/netherite/.test(s)) return 6;
  if (/diamond/.test(s)) return 5;
  if (/iron/.test(s)) return 3;
  if (/golden|gold_/.test(s)) return 2;
  if (/stone/.test(s)) return 1;
  if (/wooden/.test(s)) return 0;
  return 4;
}

function isToolName(n) {
  return /pickaxe|_axe|shovel|_hoe|_sword|shears|flint_and_steel/.test(String(n || ''));
}

async function equipGatherTool(suffixes) {
  try {
    const items = invItems();
    for (const s of suffixes) {
      const matching = items.filter((i) => i.name.includes(s));
      if (!matching.length) continue;
      // Rank by material so she wields netherite, not a wooden pick.
      matching.sort((a, b) => toolTier(b.name) - toolTier(a.name));
      try {
        await bot.equip(matching[0], 'hand').catch(() => {});
      } catch (_) {}
      return true;
    }
  } catch (_) {}
  return false;
}

// Free her hand so she swings bare-handed rather than whatever block just
// landed in slot 0 (bot.unequip isn't guaranteed to exist — fall back to
// moving the held item into an inventory slot).
async function unequipHand() {
  try {
    if (typeof bot.unequip === 'function') {
      await bot.unequip('hand');
      return true;
    }
  } catch (_) {}
  try {
    const item = bot.heldItem;
    if (!item) return true;
    for (let slot = 9; slot <= 44; slot++) {
      try {
        if (!bot.inventory.slots[slot]) {
          await bot.moveSlotItem(item.slot, slot);
          return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

// Guarantee a sensible hand for the job: correct tool, else any tool, else
// bare hand — never a leftover building block.
async function ensureToolInHand(suffixes) {
  try {
    const held = bot.heldItem;
    if (held && suffixes.some((s) => held.name.includes(s))) return true;
    const items = invItems();
    let best = null;
    let bestTier = -1;
    for (const s of suffixes) {
      for (const it of items) {
        if (!it.name.includes(s)) continue;
        const t = toolTier(it.name);
        if (t > bestTier) {
          bestTier = t;
          best = it;
        }
      }
    }
    if (best) {
      try {
        await bot.equip(best, 'hand').catch(() => {});
      } catch (_) {}
      return true;
    }
    // No correct tool: hold ANY tool so she doesn't swing a block.
    const anyTool = items.find((i) => isToolName(i.name));
    if (anyTool) {
      try {
        await bot.equip(anyTool, 'hand').catch(() => {});
      } catch (_) {}
      return true;
    }
    await unequipHand();
    return false;
  } catch (_) {
    return false;
  }
}

function toolForDef(def) {
  const w = String(def.word || '').toLowerCase();
  if (/dirt|sand|gravel|clay/.test(w)) return ['_shovel'];
  if (/wood/.test(w)) return ['_axe'];
  return ['_pickaxe'];
}

async function stuckRecover() {
  // Figure out where she was TRYING to go: combat target, hunt, or player.
  if (!bot || !bot.entity) return;
  // If a server/mod debuff is the cause, say so instead of thrashing.
  if (isSlowed()) {
    try {
      bot.chat("Something's slowing me down (Slowness)! I'm going as fast as the mod lets me.");
    } catch (_) {}
    try {
      bot.pathfinder.setGoal(null);
    } catch (_) {}
    return;
  }
  let gx = null;
  let gy = null;
  let gz = null;
  try {
    if (guardTarget) {
      gx = guardTarget.position.x;
      gy = guardTarget.position.y;
      gz = guardTarget.position.z;
    } else if (following) {
      const p = bot.players && bot.players[following];
      if (p && p.entity) {
        gx = p.entity.position.x;
        gy = p.entity.position.y;
        gz = p.entity.position.z;
      }
    }
  } catch (_) {}
  const bp = bot.entity.position;
  // Goal above her head and she's grinding: pillar up.
  if (gx !== null && gy - bp.y > 3) {
    try {
      bot.pathfinder.setGoal(null);
    } catch (_) {}
    if (solidBlockCount() >= 2) {
      await pillarStep().catch(() => {});
    }
    if (guardTarget) guardTarget = null;
    return;
  }
  // Wall in the face: dig through it (never bedrock/obsidian).
  try {
    const yaw = bot.entity.yaw || 0;
    const fx = Math.round(-Math.sin(yaw));
    const fz = Math.round(-Math.cos(yaw));
    for (const dy of [1, 0]) {
      let bl = null;
      try {
        bl = bot.blockAt(bp.offset(fx, dy, fz));
      } catch (_) {}
      if (bl && bl.name && bl.name !== 'air' && bl.boundingBox !== 'empty'
        && !/water|lava|bedrock|obsidian|door|gate|chest|bed|glass|sign|banner|shulker|anvil|furnace|crafting_table|enchanting_table|beacon|spawner/.test(bl.name)) {
        try {
          bot.pathfinder.setGoal(null);
        } catch (_) {}
        if (await equipDigTool()) {
          try {
            await bot.dig(bl);
          } catch (_) {}
        }
        if (guardTarget) guardTarget = null;
        return;
      }
    }
  } catch (_) {}
  // Nothing conclusive: clear the goal and hop.
  try {
    bot.pathfinder.setGoal(null);
  } catch (_) {}
  try {
    bot.setControlState('jump', true);
    setTimeout(() => {
      try {
        bot.setControlState('jump', false);
      } catch (_) {}
    }, 400);
  } catch (_) {}
  if (guardTarget) guardTarget = null;
}
let statusState = { state: 'off', detail: '' };

// Hostiles she'll fight (spaceless lowercase mobType). No players (no PvP
// accidents), no bosses/warden (that's suicide, not guarding).
const HOSTILES = new Set([
  'zombie', 'husk', 'drowned', 'skeleton', 'stray', 'bogged', 'witherskeleton',
  'spider', 'cavespider', 'creeper', 'enderman', 'witch', 'slime', 'magmacube',
  'blaze', 'ghast', 'phantom', 'pillager', 'vindicator', 'evoker', 'vex',
  'ravager', 'hoglin', 'zoglin', 'piglinbrute', 'guardian', 'elderguardian',
  'shulker', 'silverfish', 'endermite', 'zombifiedpiglin', 'piglin',
]);

// Never auto-blame these for damage (they can't hurt anyone — blaming them
// for cactus damage would just be bullying).
const PASSIVES = new Set([
  'cow', 'mooshroom', 'pig', 'sheep', 'chicken', 'rabbit', 'villager',
  'wanderingtrader', 'axolotl', 'frog', 'tadpole', 'ocelot', 'cat', 'wolf',
  'fox', 'panda', 'polarbear', 'llama', 'traderllama', 'horse', 'donkey',
  'mule', 'skeletonhorse', 'zombiehorse', 'goat', 'donkey', 'parrot', 'bee',
  'dolphin', 'squid', 'glowsquid', 'turtle', 'strider', 'allay', 'sniffer',
  'camel', 'armadillo', 'bat', 'cod', 'salmon', 'pufferfish', 'tropicalfish',
  'snowgolem', 'irongolem',
]);

// Food animals she'll hunt on request.
const FOOD_MOBS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom']);

// Flyers / hoverers — melee can't reach them without help.
const FLYERS = new Set(['ghast', 'phantom', 'blaze', 'enderdragon', 'wither', 'allay', 'bee', 'parrot', 'bat']);

// Melee weapon keywords (also lootable).
const MELEE_RE = /sword|axe|trident|mace/;

// Sightings: notable things she comments on (first-seen only). AI flavors
// it by personality; offline pools back it up.
const SIGHT_SCARY = new Set(['warden', 'enderdragon', 'wither', 'ravager', 'ghast', 'evoker', 'elderguardian']);
const SIGHT_CUTE = new Set(['wolf', 'cat', 'ocelot', 'parrot', 'axolotl', 'fox', 'panda', 'allay', 'frog', 'sniffer', 'camel', 'armadillo', 'mooshroom', 'dolphin']);
const SIGHT_COOL = new Set(['irongolem', 'snowgolem', 'strider']);
const SIGHT_POOL = {
  scared: [
    'Nope nope nope, THAT is above my pay grade!',
    'I am suddenly very busy somewhere else!',
    'Okay THAT one can stay WAY over there!',
  ],
  cute: [
    'Okay that is adorable, keeping it (in my heart).',
    'Aww! Hi little guy!',
    'Tiny friend acquired (emotionally)!',
  ],
  cool: [
    'Whoa, check THAT out!',
    'Okay, that is actually awesome.',
    'Big guy energy right there.',
  ],
  village: [
    'Hey hey, I found a village!',
    'Village spotted! Dibs on the comfiest bed (kidding… mostly).',
    'Civilization! I missed doors!',
  ],
};
let seenIds = new Set();
let lastSightAt = 0;
let sightTimer = null;
const sightCooldown = new Map();

function sightCategory(key) {
  if (key === 'villager' || key === 'wanderingtrader') return 'village';
  if (SIGHT_SCARY.has(key)) return 'scared';
  if (SIGHT_CUTE.has(key)) return 'cute';
  if (SIGHT_COOL.has(key)) return 'cool';
  return '';
}

function prettyMob(key) {
  return String(key || '')
    .replace('enderdragon', 'ender dragon')
    .replace('irongolem', 'iron golem')
    .replace('snowgolem', 'snow golem')
    .replace('elderguardian', 'elder guardian')
    .replace('wanderingtrader', 'wandering trader')
    .replace('zombifiedpiglin', 'zombified piglin')
    .replace('cavespider', 'cave spider')
    .replace('magmacube', 'magma cube');
}

async function sightTick() {
  if (!bot || !bot.entity || bot.isSleeping) return;
  try {
    const now = Date.now();
    if (now - lastSightAt < 20000) return;
    let pick = null;
    let pickDist = 16;
    for (const id of Object.keys(bot.entities || {})) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      if (seenIds.size > 500) {
        const first = seenIds.values().next();
        if (!first.done) seenIds.delete(first.value);
      }
      const key = mobKey(e);
      if (!key) continue;
      const cat = sightCategory(key);
      if (!cat) continue;
      let d = 999;
      try {
        d = e.position.distanceTo(bot.entity.position);
      } catch (_) {
        continue;
      }
      if (d < pickDist) {
        pickDist = d;
        pick = { key, cat };
      }
    }
    if (!pick) return;
    if (now - (sightCooldown.get(pick.cat) || 0) < 90000) return;
    lastSightAt = now;
    sightCooldown.set(pick.cat, now);
    const moodWord = pick.cat === 'scared' ? 'scared'
      : pick.cat === 'cute' ? 'delighted'
        : pick.cat === 'village' ? 'excited' : 'impressed';
    let line = '';
    try {
      const ai = currentHooks && currentHooks.getReply
        ? await currentHooks.getReply(`[You SEE this happen — it is NOT chat] A ${prettyMob(pick.key)} just appeared ${Math.round(pickDist)}m away. React in ONE short ${moodWord} sentence, in character. No greeting, no questions.`, true)
        : '';
      line = String(ai || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch (_) {}
    if (!line) {
      const pool = SIGHT_POOL[pick.cat] || [];
      line = pool.length ? pool[Math.floor(Math.random() * pool.length)] : '';
    }
    if (line) {
      try {
        bot.chat(line);
      } catch (_) {}
    }
  } catch (_) {}
}

// Known effect ids → names (the ones that matter for movement/server mods).
const EFFECT_NAMES = {
  1: 'Speed', 2: 'Slowness', 3: 'Haste', 4: 'Mining Fatigue', 5: 'Strength',
  8: 'Jump Boost', 9: 'Nausea', 11: 'Resistance', 15: 'Blindness', 17: 'Hunger',
  18: 'Weakness', 19: 'Poison', 20: 'Wither', 25: 'Levitation', 30: 'Wind Charged',
};

function activeEffects() {
  const out = [];
  try {
    const fx = (bot && bot.entity && bot.entity.effects) || {};
    for (const id of Object.keys(fx)) {
      const e = fx[id] || {};
      out.push({
        id: Number(id),
        name: EFFECT_NAMES[id] || `effect#${id}`,
        amplifier: e.amplifier,
        duration: e.duration,
      });
    }
  } catch (_) {}
  return out;
}

function effectsSummary() {
  const fx = activeEffects();
  if (!fx.length) return 'No effects on me — I feel normal.';
  return fx.map((e) => `${e.name}${e.amplifier ? ` ${e.amplifier + 1}` : ''}`).join(', ');
}

function isSlowed() {
  return activeEffects().some((e) => e.id === 2 || e.name === 'Slowness');
}

// Diagnostic: why does she feel slow? Reports measured m/s, sprint/ground
// state, and the server-side movement-speed attribute (mods modify this).
async function speedTask() {
  if (!bot || !bot.entity) return;
  let mps = 0;
  try {
    const v = bot.entity.velocity;
    mps = Math.hypot(v.x, v.z) * 20; // blocks/tick → m/s
  } catch (_) {}
  // Also sample real displacement over 2s — more honest than one instant.
  let avg = null;
  try {
    const p0 = bot.entity.position.clone();
    const t0 = Date.now();
    await wait(2000);
    if (bot && bot.entity) {
      const p1 = bot.entity.position;
      const dt = (Date.now() - t0) / 1000;
      avg = Math.hypot(p1.x - p0.x, p1.z - p0.z) / dt;
    }
  } catch (_) {}
  const sprint = (() => {
    try {
      return !!bot.controlState.sprint;
    } catch (_) {
      return false;
    }
  })();
  const onGround = (() => {
    try {
      return !!bot.entity.onGround;
    } catch (_) {
      return false;
    }
  })();
  let attr = '';
  try {
    const mcData = require('minecraft-data')(bot.version);
    const key = mcData.attributesByName.movementSpeed.resource;
    const a = bot.entity.attributes && bot.entity.attributes[key];
    if (a) {
      const mods = (a.modifiers || []).map((m) => `${m.name || 'mod'}:${m.amount}`).join('|');
      attr = ` attr(base ${a.base}${mods ? `, mods ${mods}` : ''})`;
    } else {
      attr = ' attr(none)';
    }
  } catch (_) {}
  try {
    bot.chat(`speed ~${mps.toFixed(2)}m/s${avg !== null ? ` (avg ${avg.toFixed(2)})` : ''}, ${sprint ? 'sprinting' : 'walking'}, ${onGround ? 'ground' : 'air'}${groundFixActive ? ' (mod-floor fix ON)' : ''}${attr} (vanilla walk 4.3, sprint 5.6)`);
  } catch (_) {}
}

function mobKey(e) {
  try {
    return String(e.mobType || '').toLowerCase().replace(/[_\s]/g, '');
  } catch (_) {
    return '';
  }
}

function findHostile(maxDist = 14) {
  if (!bot || !bot.entity) return null;
  // NOTE: entity `type` varies by version (mob/animal/monster/…) so match
  // by mob NAME, only excluding non-creatures outright.
  const skipTypes = new Set(['player', 'object', 'global', 'orb', 'other', 'projectile']);
  let best = null;
  let bestDist = maxDist;
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id];
    if (!e || e === bot.entity) continue;
    if (e.type && skipTypes.has(String(e.type).toLowerCase())) continue;
    if (!HOSTILES.has(mobKey(e))) continue;
    let d = 999;
    try {
      d = e.position.distanceTo(bot.entity.position);
    } catch (_) {
      continue;
    }
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

// Diagnostic: what does she actually see around her?
function describeNearby(maxDist = 20, max = 6) {
  try {
    if (!bot || !bot.entity) return 'nothing (am I even spawned?)';
    const seen = [];
    for (const id of Object.keys(bot.entities || {})) {
      const e = bot.entities[id];
      if (!e || e === bot.entity) continue;
      let d = -1;
      try {
        d = Math.round(e.position.distanceTo(bot.entity.position));
      } catch (_) {
        continue;
      }
      if (d > maxDist) continue;
      seen.push(`${e.type || '?'}:${e.mobType || e.name || e.username || '?'}@${d}m`);
      if (seen.length >= max) break;
    }
    return seen.length ? seen.join(', ') : 'nothing at all';
  } catch (_) {
    return 'nothing (error)';
  }
}

function setStatus(state, detail = '') {
  statusState = { state, detail: String(detail || '').slice(0, 200) };
  try {
    if (currentHooks && currentHooks.onStatus) currentHooks.onStatus({ ...statusState });
  } catch (_) {}
}

// Newest MC version the bot actually has block/item data for (the protocol
// index updates faster than the data dump, so these can differ).
function newestDataVersion() {
  try {
    const md = require('minecraft-data');
    const list = (md.supportedVersions && (md.supportedVersions.pc || md.supportedVersions)) || [];
    const names = list.map((e) => String((e && (e.minecraftVersion || e.version)) || e || ''))
      .filter((s) => /^\d+\.\d+/.test(s));
    names.sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) - (pa[i] || 0);
      }
      return 0;
    });
    return names[0] || '';
  } catch (_) {
    return '';
  }
}

// Is this host one of THIS machine's own addresses? If so the very same
// server is reachable over 127.0.0.1, which sidesteps the Windows Firewall's
// inbound block on the LAN adapter (the default "Public" profile blocks it).
function isOwnLocalAddress(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return false;
  let os = null;
  try {
    os = require('os');
  } catch (_) {
    return false;
  }
  try {
    const ifaces = os.networkInterfaces() || {};
    for (const list of Object.values(ifaces)) {
      for (const it of list || []) {
        if (!it) continue;
        const fam = it.family === 4 ? 'IPv4' : String(it.family || '');
        if (fam === 'IPv4' && String(it.address || '').toLowerCase() === h) return true;
      }
    }
  } catch (_) {}
  return false;
}

// Translate raw socket errors into something a human can act on.
function friendlyNetError(err) {
  const raw = String((err && err.message) || err || '');
  const code = (err && err.code) || '';
  if (code === 'ECONNREFUSED' || /econnrefused/i.test(raw)) {
    return 'connection refused — nothing on that host:port. Is the world open to LAN (new port each time!) and the host:port exact?';
  }
  if (code === 'ETIMEDOUT' || /timed out|etime/i.test(raw)) {
    return "timed out — can't reach that host:port. If Minecraft runs on THIS PC, use 127.0.0.1 (not your LAN IP — the firewall blocks inbound on the LAN adapter). Otherwise check the port and allow Java on private networks.";
  }
  if (code === 'ENOTFOUND' || /enotfound|getaddrinfo/i.test(raw)) {
    return 'host not found — typo in the address?';
  }
  if (/invalid session|failed to verify|authentication/i.test(raw)) {
    return 'server wants a real login — switch Login to Microsoft (or server to offline-mode).';
  }
  if (/outdated|version/i.test(raw)) {
    return `version mismatch (${raw.slice(0, 100)}) — bot and server must be close in version.`;
  }
  const noData = raw.match(/No data available for version ([^\s)]+)/);
  if (noData) {
    const best = newestDataVersion();
    return `bot doesn't know MC ${noData[1]} yet — host the LAN world on ${best || 'an older version'} instead (launcher → Installations), or wait for a bot data update.`;
  }
  return raw.slice(0, 160) || 'connection failed';
}

function status() {
  return { ...statusState, following };
}

// Reasoning log: surfaces what the bot is thinking/doing to the Minecraft
// tab so bugs are visible (targets chosen, blocks mined, failures, modes).
function mcLog(msg) {
  try {
    const line = String(msg).slice(0, 240);
    console.log('[mc-bot]', line);
    if (currentHooks && currentHooks.onLog) currentHooks.onLog(line);
  } catch (_) {}
}

function clearRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect() {
  clearRetry();
  if (!currentOpts || currentOpts.wantStop || currentOpts.autoReconnect === false) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (!currentOpts || currentOpts.wantStop) return;
    setStatus('connecting', 'reconnecting…');
    startBot();
  }, 5000);
  try {
    if (retryTimer.unref) retryTimer.unref();
  } catch (_) {}
}

function resolvePlayerName(name) {
  if (!bot || !bot.players || !name) return '';
  if (bot.players[name]) return name;
  const low = String(name).trim().toLowerCase();
  for (const k of Object.keys(bot.players)) {
    if (k.toLowerCase() === low) return k;
  }
  return '';
}

function followPlayer(name) {
  if (!bot) return false;
  const raw = name || following;
  if (!raw) return false;
  try {
    const target = resolvePlayerName(raw);
    if (!target) return false;
    const entry = bot.players[target];
    const entity = entry && entry.entity;
    if (!entity) return false;
    following = target;
    if (standInMode || moddedLocked) {
      directSteerTo(entity.position, 3);
      return true;
    }
    const { goals } = require('mineflayer-pathfinder');
    bot.pathfinder.setGoal(new goals.GoalFollow(entity, 2), true);
    return true;
  } catch (_) {
    return false;
  }
}

function stopMoving() {
  directSteerActive = false;
  directSteerTarget = null;
  try {
    if (bot) bot.pathfinder.setGoal(null);
  } catch (_) {}
  try {
    if (bot) {
      bot.clearControlStates();
    }
  } catch (_) {}
}

// Direct steering for dimensions where block data is unreadable (modded
// floors): no pathfinding, no block reads — just face the target, hold
// forward, and jump when something solid is in the way. Crude but it moves.
let directJumpAt = 0;
function directSteerTo(pos, stopDist = 3) {
  if (!bot || !bot.entity || !pos) return false;
  let d = 999;
  try {
    d = pos.distanceTo(bot.entity.position);
  } catch (_) {
    return false;
  }
  if (d <= stopDist) {
    directSteerActive = false;
    directSteerTarget = null;
    try {
      bot.setControlState('forward', false);
    } catch (_) {}
    return true;
  }
  directSteerActive = true;
  directSteerTarget = pos;
  try {
    bot.pathfinder.setGoal(null);
  } catch (_) {}
  try {
    bot.lookAt(pos.offset(0, 1.6, 0));
  } catch (_) {}
  return false;
}

function guardOff(silent) {
  guardMode = false;
  guardTarget = null;
  combatGen += 1;
  combatBusy = false;
  try {
    if (bot) bot.pathfinder.setGoal(null);
  } catch (_) {}
  if (!silent) {
    try {
      if (bot) bot.chat('Standing down~');
    } catch (_) {}
  }
}

function startBrainLoop() {
  stopBrainLoop();
  try {
    guardTimer = setInterval(() => {
      brainTick().catch(() => {});
    }, 500);
    if (guardTimer.unref) guardTimer.unref();
    sightTimer = setInterval(() => {
      sightTick().catch(() => {});
    }, 4000);
    if (sightTimer.unref) sightTimer.unref();
  } catch (_) {}
}

function stopBrainLoop() {
  if (guardTimer) {
    clearInterval(guardTimer);
    guardTimer = null;
  }
  if (sightTimer) {
    clearInterval(sightTimer);
    sightTimer = null;
  }
}

// Boss / named-hit aliases for kill orders.
const KILL_ALIASES = {
  'dragon': 'enderdragon', 'ender dragon': 'enderdragon', 'the dragon': 'enderdragon',
  'wither': 'wither', 'warden': 'warden', 'elder guardian': 'elderguardian',
  'iron golem': 'irongolem', 'golem': 'irongolem', 'villager': 'villager',
  'enderman': 'enderman', 'ghast': 'ghast', 'blaze': 'blaze', 'creeper': 'creeper',
  'zombie': 'zombie', 'skeleton': 'skeleton', 'spider': 'spider', 'witch': 'witch',
  'slime': 'slime', 'phantom': 'phantom', 'piglin': 'piglin', 'hoglin': 'hoglin',
};

function crystalKey(e) {
  try {
    const s = `${e.mobType || ''} ${e.name || ''} ${e.displayName || ''} ${e.objectType || ''}`.toLowerCase();
    return /crystal/.test(s);
  } catch (_) {
    return false;
  }
}

function nearestCrystal(maxDist = 128) {
  if (!bot || !bot.entity) return null;
  let best = null;
  let bestDist = maxDist;
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id];
    if (!e || e === bot.entity) continue;
    if (!crystalKey(e)) continue;
    let d = 999;
    try {
      d = e.position.distanceTo(bot.entity.position);
    } catch (_) {
      continue;
    }
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function resolveHunt() {
  if (!huntOrder || !bot || !bot.entity) return null;
  if (huntOrder.kind === 'player') {
    try {
      const p = bot.players && bot.players[huntOrder.name];
      return (p && p.entity) || null;
    } catch (_) {
      return null;
    }
  }
  let best = null;
  let bestDist = 96;
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id];
    if (!e || e === bot.entity) continue;
    if (mobKey(e) !== huntOrder.key) continue;
    let d = 999;
    try {
      d = e.position.distanceTo(bot.entity.position);
    } catch (_) {
      continue;
    }
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

async function huntTick() {
  // Returns true if a hunt is active (target or still looking).
  if (!huntOrder) return false;
  const target = resolveHunt();
  if (!target) return true; // not loaded yet — keep waiting, stay quiet
  huntResolved = true;
  // Dragon protocol: crystals first, then the lizard.
  if (huntOrder.key === 'enderdragon') {
    const crystal = nearestCrystal(128);
    if (crystal) {
      if (hasBow() && hasArrows()) {
        // Sustained fire — one shot per ~2.2s until it pops.
        const now = Date.now();
        if (now > rangedAt && !rangedBusy) {
          rangedAt = now + 2200;
          await rangedShot(crystal);
        }
        return true;
      }
      if (hasBow() && !hasArrows()) {
        if (noArrowFor !== 'crystals') {
          noArrowFor = 'crystals';
          try {
            bot.chat("I need arrows for the crystals — toss me some!");
          } catch (_) {}
        }
        return true;
      }
      // No bow: tower up and punch it (likely fatal — crystals explode).
      // Detached: pillaring takes minutes, never on the 500ms brain.
      // Capped: after 3 failed towers she demands a bow instead of dying loop.
      huntOrder.tries = (huntOrder.tries || 0);
      if (huntOrder.tries >= 3) {
        if (giveupFor !== 'crystals') {
          giveupFor = 'crystals';
          try {
            bot.chat('Those crystals need a bow and I have sticks. Get me one!');
          } catch (_) {}
        }
        return true;
      }
      if (!combatBusy) {
        combatBusy = true;
        const g = ++combatGen;
        huntOrder.tries += 1;
        (async () => {
          try {
            if (g !== combatGen) return;
            try {
              bot.chat('No bow? Fine. TOWER TIME.');
            } catch (_) {}
            if (await pillarTo(crystal, () => g === combatGen)) {
              if (g === combatGen) await strikeTarget(crystal);
            }
          } catch (_) {}
          finally {
            if (g === combatGen) combatBusy = false;
          }
        })();
      }
      return true;
    }
  }
  await engageTarget(target);
  // Confirm the kill: resolved before, gone now.
  try {
    if (!bot.entities[target.id]) {
      const label = huntOrder.label;
      huntOrder = null;
      huntResolved = false;
      try {
        bot.chat(`Target down (${label}). Anything else?`);
      } catch (_) {}
      return false;
    }
  } catch (_) {}
  return true;
}

function clearHunt(silent) {
  huntOrder = null;
  huntResolved = false;
  if (!silent) {
    try {
      if (bot) bot.chat('Hit cancelled~');
    } catch (_) {}
  }
}

function debtTarget(key) {
  if (!bot) return null;
  try {
    if (key.startsWith('player:')) {
      const p = bot.players && bot.players[key.slice(7)];
      return (p && p.entity) || null;
    }
    const e = bot.entities && bot.entities[Number(key.slice(4))];
    return e || null;
  } catch (_) {
    return null;
  }
}

async function strikeTarget(target) {
  if (!bot || !bot.entity || !target) return false;
  // No swinging at corpses — that's the "hitting air" look.
  try {
    if (target.health !== undefined && target.health <= 0) return false;
  } catch (_) {}
  await equipBestWeapon(true);
  let dist = 99;
  try {
    dist = target.position.distanceTo(bot.entity.position);
  } catch (_) {
    return false;
  }
  try {
    const { goals } = require('mineflayer-pathfinder');
    if (dist > 3) {
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 1.5), true);
      return 'chase';
    } else {
      try {
        bot.pathfinder.setGoal(null);
      } catch (_) {}
      try {
        await bot.attack(target);
      } catch (_) {}
      return 'hit';
    }
  } catch (_) {}
  return false;
}

function targetHeight(target) {
  try {
    return target.position.y - bot.entity.position.y;
  } catch (_) {
    return 0;
  }
}

function isAirborne(target) {
  if (!target) return false;
  try {
    if (FLYERS.has(mobKey(target))) return true;
  } catch (_) {}
  return targetHeight(target) > 4;
}

async function digDirt(want = 8, alive) {
  // Stock up on pillar blocks: dirt/sand/gravel nearby.
  let mcData = null;
  try {
    mcData = require('minecraft-data')(bot.version);
  } catch (_) {
    return false;
  }
  const ids = ['dirt', 'coarse_dirt', 'rooted_dirt', 'sand', 'gravel', 'red_sand']
    .map((n) => mcData.blocksByName[n] && mcData.blocksByName[n].id)
    .filter(Boolean);
  if (!ids.length) return false;
  for (let i = 0; i < 10 && solidBlockCount() < want && (!alive || alive()); i++) {
    let block = null;
    try {
      block = bot.findBlock({ matching: ids, maxDistance: 32 });
    } catch (_) {
      return solidBlockCount() >= 4;
    }
    if (!block) break;
    try {
      await mineSingle(block, ['_shovel'], 30000);
    } catch (_) {
      break;
    }
  }
  return solidBlockCount() >= 4;
}

async function pillarStep() {
  // Classic pillar: clear headroom, jump, place block at feet.
  if (!bot || !bot.entity) return false;
  try {
    // Break anything directly above (ceiling/leaves) before jumping, or the
    // jump gets blocked and she never rises.
    try {
      for (const dy of [2, 3]) {
        const above = bot.blockAt(bot.entity.position.offset(0, dy, 0));
        if (above && above.boundingBox && above.boundingBox !== 'empty'
          && !/water|lava|bedrock|obsidian/.test(above.name || '')) {
          await ensureToolInHand(['_pickaxe', '_axe', '_shovel']);
          try {
            await bot.dig(above, true);
          } catch (_) {}
        }
      }
    } catch (_) {}
    if (!(await equipBlocks())) return false;
    bot.setControlState('jump', true);
    await wait(280);
    let below = null;
    try {
      below = bot.blockAt(bot.entity.position.offset(0, -1, 0));
    } catch (_) {}
    if (below) {
      try {
        await bot.placeBlock(below, new (require('vec3'))(0, 1, 0));
      } catch (_) {}
    }
    await wait(220);
    try {
      bot.setControlState('jump', false);
    } catch (_) {}
    return true;
  } catch (_) {
    try {
      bot.setControlState('jump', false);
    } catch (_) {}
    return false;
  }
}

async function pillarTo(target, alive) {
  // Get under the target, stock blocks if needed, pillar until reachable.
  if (!bot || !bot.entity || !target) return false;
  try {
    const { goals } = require('mineflayer-pathfinder');
    const tp = target.position;
    try {
      bot.pathfinder.setGoal(new goals.GoalNear(tp.x, bot.entity.position.y, tp.z, 1));
    } catch (_) {}
    await wait(900);
  } catch (_) {}
  if (solidBlockCount() < 4) {
    try {
      bot.chat('Need blocks! Grabbing dirt first~');
    } catch (_) {}
    if (!(await digDirt(8, alive))) return false;
  }
  for (let i = 0; i < 14 && (!alive || alive()); i++) {
    if (!bot || !bot.entity) return false;
    let dy = 99;
    try {
      dy = target.position.y - bot.entity.position.y;
    } catch (_) {
      return false;
    }
    if (dy <= 3.5) return true;
    if (!(await pillarStep())) return false;
  }
  try {
    return target.position.y - bot.entity.position.y <= 4;
  } catch (_) {
    return false;
  }
}

async function rangedShot(target) {
  // One bow shot with fire discipline: STOP, settle, aim, draw, release.
  // Walking while drawing is why arrows went everywhere.
  if (!bot || !bot.entity || !target) return 'fail';
  if (!hasArrows()) return 'no-arrow';
  try {
    const items = invItems();
    const bow = items.find((i) => /bow/.test(i.name) && !/crossbow/.test(i.name));
    if (bow) {
      try {
        await bot.equip(bow, 'hand').catch(() => {});
      } catch (_) {}
    }
    try {
      bot.pathfinder.setGoal(null);
    } catch (_) {}
    await wait(450);
    if (!bot || !bot.entity) return 'fail';
    const tp = target.position;
    let dist = 10;
    try {
      dist = tp.distanceTo(bot.entity.position);
    } catch (_) {}
    // Ballistic compensation: arrows drop, so hold over by ~10% of range
    // plus a block for the target's center. Matters a lot for pillar-top
    // crystals; point-blank shots barely notice.
    try {
      bot.lookAt(tp.offset(0, 1 + dist * 0.1, 0));
    } catch (_) {}
    try {
      bot.activateItem();
    } catch (_) {
      return 'fail';
    }
    await wait(1100);
    try {
      bot.deactivateItem();
    } catch (_) {}
    return 'shot';
  } catch (_) {
    try {
      bot.deactivateItem();
    } catch (_) {}
    return 'fail';
  }
}

async function flyerTick(target, alive) {
  // Anti-air protocol for things melee can't touch.
  if (!bot || !bot.entity || !target) return;
  const id = `fly${target.id}`;
  // Footwork first: never be a turret. Perched/low targets get stabbed,
  // distant ones get approached, close ones get backed off from, and
  // mid-range gets an orbit so breath attacks have to lead her.
  try {
    const { goals } = require('mineflayer-pathfinder');
    const bp = bot.entity.position;
    const tp = target.position;
    const dx = bp.x - tp.x;
    const dz = bp.z - tp.z;
    const dh = Math.hypot(dx, dz) || 0.001;
    const dy = tp.y - bp.y;
    if (dy <= 3 && dh < 30) {
      await strikeTarget(target);
      return;
    }
    const now2 = Date.now();
    if (dh > 32) {
      bot.pathfinder.setGoal(new goals.GoalNear(tp.x, bp.y, tp.z, 18));
    } else if (dh < 10) {
      bot.pathfinder.setGoal(new goals.GoalNear(bp.x + (dx / dh) * 12, bp.y, bp.z + (dz / dh) * 12, 2));
    } else if (now2 > strafeAt) {
      strafeAt = now2 + 3500;
      const dir = Math.random() < 0.5 ? 1 : -1;
      bot.pathfinder.setGoal(new goals.GoalNear(bp.x + (-dz / dh) * 8 * dir, bp.y, bp.z + (dx / dh) * 8 * dir, 2));
    }
  } catch (_) {}
  if (hasBow() && hasArrows()) {
    // Only shoot from the pocket (9–34m): approaching or backing off comes
    // first — the shot itself plants her feet (see rangedShot).
    let inBand = true;
    try {
      const bp2 = bot.entity.position;
      const tp2 = target.position;
      const dh2 = Math.hypot(bp2.x - tp2.x, bp2.z - tp2.z);
      inBand = dh2 >= 9 && dh2 <= 34;
    } catch (_) {}
    if (!inBand) return;
    const now = Date.now();
    if (!rangedBusy && now > rangedAt) {
      rangedBusy = true;
      try {
        const res = await rangedShot(target);
        rangedAt = Date.now() + 2200;
        if (res === 'no-arrow' && noArrowFor !== id) {
          noArrowFor = id;
          try {
            bot.chat("I don't have any arrows!");
          } catch (_) {}
        }
      } finally {
        rangedBusy = false;
      }
    }
    // Strafe a little so we're not a standing target.
    try {
      bot.lookAt(target.position);
    } catch (_) {}
    return;
  }
  if (hasBow() && !hasArrows() && noArrowFor !== id) {
    noArrowFor = id;
    try {
      bot.chat("A bow with no arrows… going up instead! I don't have any arrows!");
    } catch (_) {}
  }
  // No ranged option: pillar up to it.
  if (await pillarTo(target, alive)) {
    await strikeTarget(target);
    return;
  }
  if (giveupFor !== id) {
    giveupFor = id;
    try {
      bot.chat("Can't reach it! Someone with wings deal with that one!");
    } catch (_) {}
  }
}

// Combat router: loot if unarmed, go anti-air if it flies, else melee.
// Looting and anti-air both run DETACHED — walking to a drop or pillaring
// takes seconds and must never stall the 500ms brain loop.
async function engageTarget(t) {
  if (!t) return false;
  try {
    const now = Date.now();
    if (!hasMelee() && !hasBow() && now > lootAt && !lootBusy) {
      lootAt = now + 8000;
      lootBusy = true;
      lootNearbyWeapon().catch(() => {}).finally(() => {
        lootBusy = false;
      });
    }
  } catch (_) {}
  if (isAirborne(t)) {
    if (!combatBusy) {
      combatBusy = true;
      const g = ++combatGen;
      flyerTick(t, () => g === combatGen).catch(() => {}).finally(() => {
        if (g === combatGen) combatBusy = false;
      });
    }
    return true;
  }
  return await strikeTarget(t);
}

async function swimTick() {
  // Drowning prevention beats everything: paddle (hold jump) while the
  // head is wet, and climb for air when oxygen runs low.
  if (!bot || !bot.entity) return;
  let wet = false;
  try {
    const bl = bot.blockAt(bot.entity.position.offset(0, 1.5, 0));
    wet = !!(bl && /water/.test(bl.name));
  } catch (_) {}
  if (!wet) {
    if (swimming) {
      swimming = false;
      try {
        bot.setControlState('jump', false);
      } catch (_) {}
    }
    return;
  }
  swimming = true;
  try {
    bot.setControlState('jump', true);
  } catch (_) {}
  let oxygen = 20;
  try {
    if (typeof bot.oxygenLevel === 'number') oxygen = bot.oxygenLevel;
  } catch (_) {}
  if (oxygen <= 8) {
    try {
      const { goals } = require('mineflayer-pathfinder');
      const p = bot.entity.position;
      bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y + 8, p.z, 2));
    } catch (_) {}
  }
}

async function brainTick() {
  if (guardTicking || !bot || !bot.entity) return;
  guardTicking = true;
  try {
    // 0. Don't drown — runs before everything, every tick.
    try {
      await swimTick();
    } catch (_) {}
    // While a gather/mine job is running it OWNS the hands: no combat swaps,
    // no anti-air tower, no eating — otherwise they fight over the held item
    // and she mines with a building block.
    if (taskBusy) return;
    // 1. Tit-for-tat retaliation — always on, bosses and players included.
    let busyFighting = false;
    for (const [key, owed] of [...debts]) {
      if (!owed) {
        debts.delete(key);
        continue;
      }
      const t = debtTarget(key);
      if (!t) {
        debts.delete(key);
        continue;
      }
      let d = 99;
      try {
        d = t.position.distanceTo(bot.entity.position);
      } catch (_) {
        debts.delete(key);
        continue;
      }
      if (d > 8 || (stayPut && d > 4)) {
        debts.delete(key);
        continue;
      }
      const act = await engageTarget(t);
      if (act === 'hit' || act === true) debts.set(key, owed - 1);
      busyFighting = true;
      break; // one swing per tick — that's the deal
    }
    // 2. Bodyguard: someone near her got mauled — peel the mob off them.
    if (!busyFighting && bodyguard) {
      try {
        const t = bot.entities && bot.entities[bodyguard.id];
        const fresh = t && t !== bot.entity;
        const expired = Date.now() > bodyguard.until;
        if (!fresh || expired) {
          if (!fresh && !expired && bodyguard.announced) {
            try {
              bot.chat('Got it off you~');
            } catch (_) {}
          }
          bodyguard = null;
        } else {
          if (!bodyguard.announced) {
            bodyguard.announced = true;
            try {
              bot.chat(`Hands off ${bodyguard.victim}!`);
            } catch (_) {}
          }
          await engageTarget(t);
          busyFighting = true;
        }
      } catch (_) {
        bodyguard = null;
      }
    }
    // 3. Ordered hits (boss fights, named targets) — after defense,
    // before routine guard duty.
    if (!busyFighting) {
      try {
        if (await huntTick()) busyFighting = true;
      } catch (_) {}
    }
    // 4. Guard-mode proactive hunting.
    if (!busyFighting && guardMode) {
      if (guardTarget && (!bot.entities[guardTarget.id] || guardTarget !== bot.entities[guardTarget.id])) {
        guardTarget = null;
      }
      if (!guardTarget) guardTarget = findHostile(14);
      if (guardTarget) {
        await engageTarget(guardTarget);
        busyFighting = true;
      } else if (!stayPut) {
        try {
          bot.pathfinder.setGoal(null);
        } catch (_) {}
      }
    }
    const now = Date.now();
    // Stuck watchdog: grind detection by velocity AND position. Mods that
    // slow you down (Backrooms stamina, slowness) make her crawl with tiny
    // velocity — the old velocity-only check read that as "stuck", cleared
    // her goal every 2s, and she stuttered in place. Now she must ALSO have
    // made no positional progress; slow-but-moving is respected.
    if (!taskBusy) {
      try {
        const moving = bot.pathfinder.isMoving() || bot.pathfinder.isMining() || bot.pathfinder.isBuilding();
        let speed = 99;
        try {
          speed = bot.entity.velocity.length();
        } catch (_) {}
        const falling = (() => {
          try {
            return bot.entity.velocity.y < -0.3;
          } catch (_) {
            return false;
          }
        })();
        let progressed = false;
        try {
          const p = bot.entity.position;
          if (!stuckPos || stuckPos.distanceTo(p) > 0.3) {
            stuckPos = p.clone();
            progressed = true;
          }
        } catch (_) {
          progressed = true;
        }
        if (moving && !falling && !progressed && speed < 0.02) {
          stuckTicks += 1;
        } else {
          stuckTicks = 0;
        }
        if (stuckTicks >= 6 && now > stuckCooldownUntil) {
          stuckTicks = 0;
          stuckCooldownUntil = now + 10000;
          try {
            await stuckRecover();
          } catch (_) {}
        }
      } catch (_) {}
    }
    // 5. Idle life: stick near the followed player, wander a little, look around.
    if (!busyFighting && !taskBusy && !stayPut && following) {
      const p = bot.players && bot.players[following];
      const pe = p && p.entity;
      if (pe && standInMode) {
        // Modded-floor mode: pathfinding can't see terrain, so steer directly.
        directSteerTo(pe.position, 3);
      } else {
        directSteerActive = false;
        directSteerTarget = null;
        if (pe) {
          let pd = 99;
          try {
            pd = pe.position.distanceTo(bot.entity.position);
          } catch (_) {}
          if (pd > 6) {
            followPlayer(following);
          } else if (now > wanderAt && !bot.pathfinder.isMoving()) {
            wanderAt = now + 10000 + Math.random() * 6000;
            try {
              const { goals } = require('mineflayer-pathfinder');
              const dx = Math.round((Math.random() - 0.5) * 8);
              const dz = Math.round((Math.random() - 0.5) * 8);
              if (dx || dz) {
                bot.pathfinder.setGoal(new goals.GoalNear(pe.position.x + dx, pe.position.y, pe.position.z + dz, 2));
              }
            } catch (_) {}
          }
        }
      }
      if (!standInMode && now > lookAt && now > lookHoldUntil) {
        lookAt = now + 2500 + Math.random() * 2500;
        try {
          if (pe && Math.random() < 0.55) bot.lookAt(pe.position.offset(0, 1.6, 0));
          else bot.look(Math.random() * Math.PI * 2 - Math.PI, (Math.random() - 0.5) * 0.6, true);
        } catch (_) {}
      }
    } else if (!following || busyFighting) {
      directSteerActive = false;
      directSteerTarget = null;
    }
    // 6. Armor check every ~15s (also right after pickups via playerCollect).
    if (now > armorAt) {
      armorAt = now + 15000;
      try {
        await equipBestArmor();
      } catch (_) {}
    }
    // 7. Bedtime.
    try {
      await sleepTick();
    } catch (_) {}
    // 8. Stomach check every ~8s (skips the swing-by-swing fight lock).
    if (now > eatAt) {
      eatAt = now + 8000;
      try {
        await eatTick(busyFighting);
      } catch (_) {}
    }
  } finally {
    guardTicking = false;
  }
}

async function equipBestWeapon(forceMelee = false) {
  if (!bot) return;
  try {
    const held = bot.heldItem;
    // Already holding a real melee weapon: stand pat (avoids "upgrading"
    // a diamond sword into an iron axe).
    if (held && /sword|axe|trident|mace/.test(held.name)) return;
    // Up close with a bow out while a blade sits in the bag? Fix that.
    if (held && !forceMelee && /bow|crossbow/.test(held.name)) return;
    const items = bot.inventory.items();
    const prio = ['_sword', '_axe', 'trident', 'mace', '_pickaxe', '_shovel', '_hoe'];
    for (const p of prio) {
      const found = items.find((i) => i.name.includes(p));
      if (found) {
        await bot.equip(found, 'hand').catch(() => {});
        return;
      }
    }
    // Nothing better: if forced and bare-handed, hold anything solid.
    if (forceMelee && !held) {
      const any = items.find((i) => /pickaxe|shovel|hoe|stick|dirt|cobble/.test(i.name));
      if (any) {
        try {
          await bot.equip(any, 'hand').catch(() => {});
        } catch (_) {}
      }
    }
  } catch (_) {}
}

function invItems() {
  try {
    return bot.inventory.items();
  } catch (_) {
    return [];
  }
}

function hasMelee() {
  const all = invItems();
  try {
    if (bot.heldItem && MELEE_RE.test(bot.heldItem.name)) return true;
  } catch (_) {}
  return all.some((i) => MELEE_RE.test(i.name));
}

function hasBow() {
  try {
    if (bot.heldItem && /bow/.test(bot.heldItem.name) && !/crossbow/.test(bot.heldItem.name)) return true;
  } catch (_) {}
  return invItems().some((i) => /bow/.test(i.name) && !/crossbow/.test(i.name));
}

function hasArrows() {
  return invItems().some((i) => i.name === 'arrow' || i.name === 'spectral_arrow');
}

function solidBlockCount() {
  try {
    return invItems()
      .filter((i) => /dirt|coarse_dirt|rooted_dirt|cobblestone|sand|gravel|netherrack|oak_log|birch_log|spruce_log|stone$|andesite|diorite|granite|deepslate/.test(i.name))
      .reduce((n, i) => n + (i.count || 1), 0);
  } catch (_) {
    return 0;
  }
}

async function equipBlocks() {
  // Hold something pillar-able.
  try {
    const order = ['dirt', 'cobblestone', 'sand', 'gravel', 'netherrack', 'oak_log', 'stone'];
    const items = invItems();
    for (const n of order) {
      const found = items.find((i) => i.name.includes(n));
      if (found) {
        await bot.equip(found, 'hand').catch(() => {});
        return !!(bot.heldItem && /dirt|cobble|sand|gravel|netherrack|log|stone|andesite|diorite|granite|deepslate/.test(bot.heldItem.name));
      }
    }
  } catch (_) {}
  return false;
}

// Item-drop entities (dropped weapons etc.). Version-proof-ish: accept any
// of the known shapes, never mobs/players/orbs.
function isDropEntity(e) {
  if (!e || e === bot.entity) return false;
  try {
    if (e.type === 'player' || e.username) return false;
    if (e.type === 'mob') return false;
    if (/orb|xp/i.test(e.name || '') || /orb/i.test(e.displayName || '')) return false;
    const n = `${e.name || ''} ${e.displayName || ''} ${e.objectType || ''}`.toLowerCase();
    return /item/.test(n);
  } catch (_) {
    return false;
  }
}

function nearestDrop(maxDist = 12) {
  if (!bot || !bot.entity) return null;
  let best = null;
  let bestDist = maxDist;
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id];
    if (!isDropEntity(e)) continue;
    let d = 999;
    try {
      d = e.position.distanceTo(bot.entity.position);
    } catch (_) {
      continue;
    }
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

function invNames() {
  return new Set(invItems().map((i) => i.name));
}

// Battlefield looting: unarmed and fighting? Grab the nearest drop, see
// what it was, equip it if it's a weapon. Returns the new item name or ''.
async function lootNearbyWeapon() {
  if (!bot || !bot.entity) return '';
  const drop = nearestDrop(12);
  if (!drop) return '';
  const before = invNames();
  try {
    const { goals } = require('mineflayer-pathfinder');
    bot.pathfinder.setGoal(new goals.GoalNear(drop.position.x, drop.position.y, drop.position.z, 1));
    for (let i = 0; i < 8; i++) {
      await wait(500);
      if (!bot || !bot.entity) return '';
      if (!bot.entities[drop.id]) break;
      let d = 99;
      try {
        d = drop.position.distanceTo(bot.entity.position);
      } catch (_) {
        break;
      }
      if (d < 1.5) {
        await wait(800);
        break;
      }
    }
  } catch (_) {}
  const after = invItems();
  const fresh = after.find((i) => !before.has(i.name));
  if (!fresh) return '';
  if (MELEE_RE.test(fresh.name) || /bow|crossbow/.test(fresh.name)) {
    try {
      await bot.equip(fresh, 'hand').catch(() => {});
    } catch (_) {}
    try {
      bot.chat(`Yoinked a ${fresh.name.replace(/_/g, ' ')}! Mine now.`);
    } catch (_) {}
  }
  return fresh.name;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Split long text into chat-sized chunks on sentence boundaries.
function splitChat(text, max = 200, cap = 3) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const sentences = clean.match(/[^.!?…]+[.!?…]+["'”’)]?|\s*\S[^.!?…]*$/g) || [clean];
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    const chunk = s.trim();
    if (!chunk) continue;
    if ((cur + ' ' + chunk).trim().length > max && cur) {
      parts.push(cur.trim());
      if (parts.length >= cap) return parts;
      cur = chunk;
    } else {
      cur = `${cur} ${chunk}`.trim();
    }
  }
  if (cur.trim() && parts.length < cap) parts.push(cur.trim());
  return parts.length ? parts : [clean.slice(0, max)];
}

const ARMOR_TIER = [
  ['netherite', 5], ['diamond', 4], ['turtle', 3], ['iron', 3],
  ['chainmail', 2], ['golden', 1], ['gold', 1], ['leather', 0],
];

function armorTier(name) {
  const n = String(name || '');
  for (const [k, v] of ARMOR_TIER) {
    if (n.includes(k)) return v;
  }
  return -1;
}

// Tracks what WE put on her (worn items leave the inventory, so compare
// against this; reset on death since everything drops).
let wornArmor = { head: -1, torso: -1, legs: -1, feet: -1 };

async function equipBestArmor() {
  if (!bot) return;
  try {
    const slots = [
      ['head', 'helmet'], ['torso', 'chestplate'], ['legs', 'leggings'], ['feet', 'boots'],
    ];
    const items = bot.inventory.items();
    for (const [slot, suffix] of slots) {
      let best = null;
      let bestTier = wornArmor[slot] ?? -1;
      for (const it of items) {
        if (!it.name.endsWith(suffix)) continue;
        const t = armorTier(it.name);
        if (t > bestTier) {
          bestTier = t;
          best = it;
        }
      }
      if (best) {
        try {
          await bot.equip(best, slot);
          wornArmor[slot] = bestTier;
        } catch (_) {}
      }
    }
  } catch (_) {}
}

// Manual "sleep"/"bed" order: walk to a nearby bed and crash, day or not
// (daytime just fails with an explanation — Minecraft rules, not mine).
// Straight sneak-bridge: N blocks forward from where she stands.
// Snaps to the nearest cardinal direction — diagonal bridges are how
// bots learn about gravity.
async function bridgeTask(length = 8) {
  if (!bot || !bot.entity || taskBusy) {
    try {
      if (bot) bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  if (solidBlockCount() < 2) {
    try {
      bot.chat('Need blocks first — I only build with pocket lint otherwise!');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  try {
    const Vec3 = require('vec3');
    // Nearest cardinal from her current facing.
    const yaw = bot.entity.yaw;
    const dirs = [
      new Vec3(0, 0, -1), new Vec3(1, 0, 0), new Vec3(0, 0, 1), new Vec3(-1, 0, 0),
    ];
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    let fwd = dirs[0];
    let best = -2;
    for (const d of dirs) {
      const dot = d.x * fx + d.z * fz;
      if (dot > best) {
        best = dot;
        fwd = d;
      }
    }
    try {
      bot.chat(`Bridging ${length}! Don't look down~`);
    } catch (_) {}
    try {
      bot.setControlState('sneak', true);
    } catch (_) {}
    let placed = 0;
    for (let i = 0; i < length && alive(); i++) {
      if (!(await equipBlocks())) break;
      let ref = null;
      try {
        ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      } catch (_) {}
      if (!ref || !ref.name || /air|cave_air|void_air|lava|water/.test(ref.name)) {
        // Nothing solid underfoot — edge case, step back, done.
        break;
      }
      // If the next slot is already floor, just walk it.
      let aheadFloor = null;
      try {
        aheadFloor = bot.blockAt(bot.entity.position.offset(fwd.x, -1, fwd.z));
      } catch (_) {}
      const solidAhead = aheadFloor && aheadFloor.name && !/air|cave_air|void_air/.test(aheadFloor.name);
      if (!solidAhead) {
        try {
          await bot.placeBlock(ref, new Vec3(fwd.x, 0, fwd.z));
          placed += 1;
        } catch (_) {
          break;
        }
        await wait(250);
      }
      try {
        bot.setControlState('forward', true);
      } catch (_) {}
      await wait(380);
      try {
        bot.setControlState('forward', false);
      } catch (_) {}
      await wait(150);
    }
    try {
      bot.setControlState('forward', false);
      bot.setControlState('sneak', false);
    } catch (_) {}
    try {
      bot.chat(placed > 0 ? `Bridged ${placed}! Tada~` : "Couldn't place a single block. Rude physics.");
    } catch (_) {}
    if (following) followPlayer(following);
  } finally {
    try {
      bot.setControlState('forward', false);
      bot.setControlState('sneak', false);
    } catch (_) {}
    if (myGen === woodGen) taskBusy = false;
  }
}

async function sleepNow(requester) {
  if (!bot || !bot.entity) return;
  let mcData = null;
  try {
    mcData = require('minecraft-data')(bot.version);
  } catch (_) {
    return;
  }
  const bedIds = Object.keys(mcData.blocksByName || {})
    .filter((n) => n.endsWith('_bed'))
    .map((n) => mcData.blocksByName[n].id);
  if (!bedIds.length) return;
  let bed = null;
  try {
    bed = bot.findBlock({ matching: bedIds, maxDistance: 32 });
  } catch (_) {}
  if (!bed) {
    try {
      bot.chat('No bed nearby~');
    } catch (_) {}
    return;
  }
  try {
    const { goals } = require('mineflayer-pathfinder');
    bot.pathfinder.setGoal(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
    for (let i = 0; i < 20; i++) {
      await wait(500);
      if (!bot) return;
      let d = 99;
      try {
        d = bed.position.distanceTo(bot.entity.position);
      } catch (_) {
        return;
      }
      if (d < 2.5) break;
    }
    await bot.sleep(bed);
    try {
      bot.chat('Night night~');
    } catch (_) {}
  } catch (_) {
    try {
      bot.chat('Can\'t sleep now — night only, and no monsters breathing on the bed!');
    } catch (_) {}
  }
}

async function sleepTick() {
  if (!bot || taskBusy || guardTarget || debts.size) return;
  let time = null;
  try {
    time = bot.time;
  } catch (_) {
    return;
  }
  if (!time) return;
  const t = time.timeOfDay;
  const night = typeof t === 'number' && t > 12541 && t < 23458;
  if (!night) {
    if (bot.isSleeping) {
      try {
        await bot.wake();
      } catch (_) {}
    }
    return;
  }
  if (bot.isSleeping) return;
  const day = time.day || 0;
  if (sleepTriedDay === day) return;
  let mcData = null;
  try {
    mcData = require('minecraft-data')(bot.version);
  } catch (_) {
    return;
  }
  const bedIds = Object.keys(mcData.blocksByName || {})
    .filter((n) => n.endsWith('_bed'))
    .map((n) => mcData.blocksByName[n].id);
  if (!bedIds.length) return;
  let bed = null;
  try {
    bed = bot.findBlock({ matching: bedIds, maxDistance: 32 });
  } catch (_) {}
  if (!bed) return;
  sleepTriedDay = day;
  try {
    let bd = 99;
    try {
      bd = bed.position.distanceTo(bot.entity.position);
    } catch (_) {}
    if (bd > 3) {
      const { goals } = require('mineflayer-pathfinder');
      bot.pathfinder.setGoal(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 2));
      for (let i = 0; i < 16; i++) {
        await wait(500);
        if (!bot || !bot.entity) return;
        try {
          if (bed.position.distanceTo(bot.entity.position) <= 2.5) break;
        } catch (_) {
          return;
        }
      }
      try {
        bot.pathfinder.setGoal(null);
      } catch (_) {}
    }
    await bot.sleep(bed);
  } catch (_) {
    try {
      bot.chat('Too scary to sleep!');
    } catch (_) {}
  }
}

// Best-first picnic list. No rotten flesh, spider eyes, pufferfish,
// chorus fruit (teleporting mid-bite is NOT a meal), or suspicious stew.
const GOOD_FOOD = [
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_rabbit', 'bread', 'cooked_cod', 'cooked_salmon', 'baked_potato',
  'golden_carrot', 'pumpkin_pie', 'cookie', 'apple', 'carrot', 'melon_slice',
  'beef', 'porkchop', 'mutton', 'rabbit', 'cod', 'salmon', 'potato',
  'beetroot', 'dried_kelp', 'sweet_berries', 'glow_berries', 'honey_bottle',
  'chicken', 'tropical_fish', 'golden_apple',
];

function nearestPlayerName() {
  if (!bot || !bot.entity) return '';
  let best = '';
  let bestDist = 999;
  for (const name of Object.keys(bot.players || {})) {
    if (bot.username && name === bot.username) continue;
    const p = bot.players[name];
    const e = p && p.entity;
    if (!e) continue;
    let d = 999;
    try {
      d = e.position.distanceTo(bot.entity.position);
    } catch (_) {
      continue;
    }
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

async function eatTick(fighting) {
  if (!bot || !bot.entity) return;
  // Never eat while mid-gather/anti-air or actually digging — swapping food
  // into her hand cancels the tool she's swinging and stalls the dig.
  if (taskBusy || combatBusy) return;
  try {
    if (bot.targetDigBlock) return;
  } catch (_) {}
  let hunger = 20;
  try {
    hunger = typeof bot.food === 'number' ? bot.food : 20;
  } catch (_) {}
  if (hunger > 16) {
    autoHunted = false;
    return;
  }
  // Eat what's in the bag (not mid-fight — she has priorities).
  if (!fighting) {
    try {
      const items = invItems();
      for (const fname of GOOD_FOOD) {
        const found = items.find((i) => i.name === fname);
        if (!found) continue;
        try {
          await bot.equip(found, 'hand').catch(() => {});
        } catch (_) {}
        try {
          await bot.consume();
        } catch (_) {}
        return;
      }
    } catch (_) {}
  }
  // Pockets empty and genuinely hungry: beg, then hunt her own dinner.
  if (hunger > 10 || taskBusy) return;
  const who = nearestPlayerName() || following;
  const now = Date.now();
  if (who && now > begAt) {
    begAt = now + 90000;
    try {
      followPlayer(who);
    } catch (_) {}
    const lines = [
      "I'm hungry… got snacks?",
      'Feed me or I start chewing the scenery!',
      'My tummy is filing a formal complaint!',
    ];
    try {
      bot.chat(lines[Math.floor(Math.random() * lines.length)]);
    } catch (_) {}
  }
  if (!autoHunted && who) {
    autoHunted = true;
    foodTask(who, 4, true).catch(() => {});
  }
}

function foodItems() {
  try {
    return bot.inventory.items().filter((i) => {
      const n = i.name;
      if (/beef|porkchop|mutton|chicken/.test(n)) return true;
      if (n.includes('rabbit') && !/hide|foot/.test(n)) return true;
      return false;
    });
  } catch (_) {
    return [];
  }
}

function countFood() {
  return foodItems().reduce((n, i) => n + (i.count || 1), 0);
}

function nearestFood(maxDist = 48) {
  if (!bot || !bot.entity) return null;
  let best = null;
  let bestDist = maxDist;
  for (const id of Object.keys(bot.entities || {})) {
    const e = bot.entities[id];
    if (!e || e === bot.entity) continue;
    if (!FOOD_MOBS.has(mobKey(e))) continue;
    let d = 999;
    try {
      d = e.position.distanceTo(bot.entity.position);
    } catch (_) {
      continue;
    }
    if (d < bestDist) {
      bestDist = d;
      best = e;
    }
  }
  return best;
}

async function deliverTo(requester, matchRe, got, target, word) {
  if (!bot) return;
  // Walk ALL the way to them (not "2.5 seconds and hope"): items only get
  // picked up within ~2m, so tossing from afar = littering.
  followPlayer(requester);
  for (let i = 0; i < 40; i++) {
    if (!bot) return;
    let d = 99;
    try {
      const p = bot.players && bot.players[requester];
      const pe = p && p.entity;
      if (pe) d = pe.position.distanceTo(bot.entity.position);
    } catch (_) {}
    if (d < 2.5) break;
    await wait(500);
  }
  if (!bot) return;
  stopMoving();
  // Face them, THEN throw — tossStack drops at her feet in facing direction.
  try {
    const p = bot.players && bot.players[requester];
    if (p && p.entity) bot.lookAt(p.entity.position.offset(0, 1.2, 0));
  } catch (_) {}
  await wait(300);
  try {
    const items = bot.inventory.items().filter((i) => matchRe.test(i.name));
    for (const item of items) {
      try {
        await bot.tossStack(item);
      } catch (_) {}
      await wait(250);
    }
  } catch (_) {}
  try {
    bot.chat(got >= target ? `${word} delivery~` : `Only found ${got} — delivery~`);
  } catch (_) {}
  if (following) followPlayer(following);
}

async function foodTask(requester, target = 8, keepForSelf = false) {
  if (!bot || taskBusy) {
    try {
      if (bot) bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  try {
    const startCount = countFood();
    try {
      bot.chat(keepForSelf ? 'Hunting myself a snack, brb~' : (target > 1 ? 'Hunting snacks, be right back~' : 'Snack run~'));
    } catch (_) {}
    if (!keepForSelf) await gotoRequester(requester, alive);
    const { goals } = require('mineflayer-pathfinder');
    let swings = 0;
    while (alive() && countFood() - startCount < target && swings < 120) {
      const prey = nearestFood(48);
      if (!prey) break;
      await equipBestWeapon(true);
      let d = 99;
      try {
        d = prey.position.distanceTo(bot.entity.position);
      } catch (_) {
        break;
      }
      if (d > 2.8) {
        try {
          bot.pathfinder.setGoal(new goals.GoalFollow(prey, 1.2), true);
        } catch (_) {}
        await wait(600);
      } else {
        try {
          bot.pathfinder.setGoal(null);
        } catch (_) {}
        try {
          await bot.attack(prey);
        } catch (_) {}
        swings += 1;
        await wait(550);
      }
      // Step onto the drops so they pop into her pockets.
      if (!bot.entities[prey.id]) {
        try {
          const p = prey.position;
          bot.pathfinder.setGoal(new goals.GoalNear(p.x, p.y, p.z, 1));
        } catch (_) {}
        await wait(1200);
      }
    }
    if (!alive()) return;
    const got = countFood() - startCount;
    if (!got) {
      try {
        bot.chat(`No snacks nearby${botPosString()}~`);
      } catch (_) {}
      return;
    }
    if (keepForSelf) {
      if (following) followPlayer(following);
      return;
    }
    await deliverTo(requester, /beef|porkchop|mutton|chicken|rabbit/, got, target, 'Snack');
  } finally {
    if (myGen === woodGen) taskBusy = false;
  }
}

// Gatherable materials: keyword -> block names (+ore flag for small default).
const GATHER_MATS = {
  wood: { blocks: ['LOG'], itemRe: /log|stem/, word: 'Wood' },
  logs: { blocks: ['LOG'], itemRe: /log|stem/, word: 'Wood' },
  log: { blocks: ['LOG'], itemRe: /log|stem/, word: 'Wood' },
  timber: { blocks: ['LOG'], itemRe: /log|stem/, word: 'Wood' },
  stone: { blocks: ['stone'], itemRe: /^(stone|cobblestone)$/, word: 'Stone' },
  cobble: { blocks: ['cobblestone'], itemRe: /^cobblestone$/, word: 'Cobble' },
  cobblestone: { blocks: ['cobblestone'], itemRe: /^cobblestone$/, word: 'Cobble' },
  dirt: { blocks: ['dirt', 'coarse_dirt', 'rooted_dirt'], itemRe: /dirt/, word: 'Dirt' },
  sand: { blocks: ['sand', 'red_sand'], itemRe: /sand/, word: 'Sand' },
  gravel: { blocks: ['gravel'], itemRe: /^gravel$/, word: 'Gravel' },
  clay: { blocks: ['clay'], itemRe: /^clay_ball$/, word: 'Clay' },
  coal: { blocks: ['coal_ore', 'deepslate_coal_ore'], itemRe: /^coal$/, word: 'Coal', ore: true },
  iron: { blocks: ['iron_ore', 'deepslate_iron_ore'], itemRe: /^raw_iron$/, word: 'Iron', ore: true },
  copper: { blocks: ['copper_ore', 'deepslate_copper_ore'], itemRe: /^raw_copper$/, word: 'Copper', ore: true },
  gold: { blocks: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'], itemRe: /^raw_gold$/, word: 'Gold', ore: true },
  redstone: { blocks: ['redstone_ore', 'deepslate_redstone_ore'], itemRe: /^redstone$/, word: 'Redstone', ore: true },
  lapis: { blocks: ['lapis_ore', 'deepslate_lapis_ore'], itemRe: /^lapis_lazuli$/, word: 'Lapis', ore: true },
  diamond: { blocks: ['diamond_ore', 'deepslate_diamond_ore'], itemRe: /^diamond$/, word: 'Diamonds', ore: true },
  emerald: { blocks: ['emerald_ore', 'deepslate_emerald_ore'], itemRe: /^emerald$/, word: 'Emeralds', ore: true },
  quartz: { blocks: ['nether_quartz_ore'], itemRe: /^quartz$/, word: 'Quartz', ore: true },
  obsidian: { blocks: ['obsidian'], itemRe: /^obsidian$/, word: 'Obsidian', ore: true },
};

function matBlockIds(names) {
  // 'LOG' pseudo-entry expands to every log/stem on this version.
  try {
    const mcData = require('minecraft-data')(bot.version);
    const out = [];
    for (const n of names) {
      if (n === 'LOG') {
        for (const k of Object.keys(mcData.blocksByName)) {
          if (k.endsWith('_log') || k.endsWith('_stem')) out.push(mcData.blocksByName[k].id);
        }
      } else if (mcData.blocksByName[n]) {
        out.push(mcData.blocksByName[n].id);
      }
    }
    return out;
  } catch (_) {
    return [];
  }
}

function logBlockIds() {
  return matBlockIds(['LOG']);
}

function countGather(itemRe) {
  try {
    return bot.inventory.items()
      .filter((i) => itemRe.test(i.name))
      .reduce((n, i) => n + (i.count || 1), 0);
  } catch (_) {
    return 0;
  }
}

function countLogs() {
  return countGather(/log|stem/);
}

// Manual single-block mine: clears line of sight, keeps the right tool in
// hand, verifies the block still exists, retries from a fresh approach, and
// hops for blocks above her.
// Manual single-block mine. Bounded at every step: approach (with a
// no-progress bail), tunnel along the sight line for embedded ores, fresh
// block check each dig, short 15s leash, one retry, and the pathfinder is
// STOPPED before digging so it can't fight her aim (that was the "spinning").
async function mineSingle(block, toolSuffixes, ms = 15000) {
  if (!bot || !bot.entity || !block) throw new Error('no-block');
  const { goals } = require('mineflayer-pathfinder');
  const targetPos = block.position.clone();
  const tools = toolSuffixes || ['_pickaxe', '_axe', '_shovel'];
  const stopPath = () => {
    try {
      bot.pathfinder.setGoal(null);
    } catch (_) {}
  };
  const dist = () => {
    try {
      const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0);
      return targetPos.offset(0.5, 0.5, 0.5).distanceTo(eye);
    } catch (_) {
      return 99;
    }
  };
  const fresh = () => {
    try {
      const cur = bot.blockAt(targetPos);
      return cur && cur.type && cur.name && cur.name !== 'air' ? cur : null;
    } catch (_) {
      return null;
    }
  };
  const approach = async (radius, budgetMs) => {
    try {
      bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, radius));
    } catch (_) {}
    const t0 = Date.now();
    let last = 99;
    let still = 0;
    while (Date.now() - t0 < budgetMs) {
      if (!bot || !bot.entity) break;
      const d = dist();
      if (d <= 4.2) break;
      if (Math.abs(d - last) < 0.05) still += 1;
      else still = 0;
      last = d;
      if (still > 5) break; // wedged — stop wasting time, act instead
      await wait(250);
    }
    stopPath();
  };
  // Tunnel along the eye→target line (handles ores embedded in stone).
  const digRay = async () => {
    try {
      const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.6, 0);
      const tgt = targetPos.offset(0.5, 0.5, 0.5);
      const dir = tgt.minus(eye);
      const total = dir.norm();
      if (!(total > 1)) return;
      const step = dir.scaled(1 / total);
      for (let t = 0.6; t < total - 0.8; t += 0.7) {
        if (!bot || !bot.entity) return;
        const p = eye.plus(step.scaled(t)).floored();
        let bl = null;
        try {
          bl = bot.blockAt(p);
        } catch (_) {}
        if (bl && bl.boundingBox && bl.boundingBox !== 'empty' && !/water|lava|bedrock|obsidian/.test(bl.name || '')) {
          stopPath();
          await ensureToolInHand(tools);
          try {
            await bot.dig(bl, true);
          } catch (_) {}
          await wait(120);
        }
      }
    } catch (_) {}
  };
  const doDig = async () => {
    const cur = fresh();
    if (!cur) return;
    stopPath();
    try {
      await bot.lookAt(cur.position.offset(0.5, 0.5, 0.5), true);
    } catch (_) {}
    await ensureToolInHand(tools);
    let done = false;
    try {
      await Promise.race([
        bot.dig(cur, true).then(() => {
          done = true;
        }),
        wait(ms).then(() => {
          if (!done) throw new Error(`dig-timeout ${cur.name || 'block'}`);
        }),
      ]);
    } catch (e) {
      if (!done) {
        try {
          bot.stopDigging();
        } catch (_) {}
      }
      throw e;
    }
  };
  await approach(2, 6000);
  if (dist() > 4.5) {
    await digRay();
    await approach(2, 3000);
  }
  try {
    await doDig();
  } catch (e) {
    if (!fresh()) return;
    await approach(1, 2500);
    await doDig();
  }
  // Step onto the drops so they pop into her pockets.
  try {
    bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 1));
    await wait(600);
  } catch (_) {}
  stopPath();
}

// Connected same-block cluster (flood fill, incl. diagonals) so a whole tree
// or ore vein is cleared instead of one lone block.
const VEIN_OFFS = (() => {
  const a = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x || y || z) a.push([x, y, z]);
      }
    }
  }
  return a;
})();

function collectVein(startPos, ids, maxBlocks = 96) {
  const out = [];
  const seen = new Set();
  const key = (p) => `${p.x},${p.y},${p.z}`;
  const queue = [startPos];
  seen.add(key(startPos));
  while (queue.length && out.length < maxBlocks) {
    const p = queue.shift();
    let bl = null;
    try {
      bl = bot.blockAt(p);
    } catch (_) {}
    if (!bl || !ids.includes(bl.type)) continue;
    out.push(bl);
    for (const [ox, oy, oz] of VEIN_OFFS) {
      const np = p.offset(ox, oy, oz);
      const k = key(np);
      if (seen.has(k)) continue;
      seen.add(k);
      let nb = null;
      try {
        nb = bot.blockAt(np);
      } catch (_) {}
      if (nb && ids.includes(nb.type)) queue.push(np);
    }
  }
  return out;
}

function botPosString() {
  try {
    const p = bot.entity.position;
    return ` (I'm at ${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`;
  } catch (_) {
    return '';
  }
}

// Walk to the requester before searching — "nearby trees" means near the
// HUMAN, and she might be idling a hundred blocks away.
async function gotoRequester(requester, alive) {
  try {
    followPlayer(requester);
  } catch (_) {}
  for (let i = 0; i < 30; i++) {
    if (!alive()) return false;
    let d = 99;
    try {
      const p = bot.players && bot.players[requester];
      const pe = p && p.entity;
      if (pe) d = pe.position.distanceTo(bot.entity.position);
    } catch (_) {}
    if (d < 8) return true;
    await wait(500);
  }
  return true;
}

// Diagnostic: brute-force voxel sweep around the bot (bypasses findBlocks)
// plus the API result side by side — settles "are there really no trees".
// ---------------------------------------------------------------------------
// Manual click commands: "right click" / "left click" (also "rightclick",
// "leftclick", "r click", "l click", "press right click", ...).
// Right click = USE the held item (place a block / open a chest / eat /
// activate). Left click = ATTACK whatever is in front of her.
// ---------------------------------------------------------------------------

// Blocks she can right-click to open/use. The registry's window list is the
// source of truth, but it uses display names ("Chest"), so match on both.
const RIGHT_CLICK_BLOCKS = new Set([
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box', 'hopper',
  'dispenser', 'dropper', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand',
  'crafting_table', 'anvil', 'enchanting_table', 'beacon', 'grindstone',
  'smithing_table', 'loom', 'stonecutter', 'cartography_table', 'lectern',
  'decorated_pot', 'bell', 'cauldron', 'water_cauldron', 'lava_cauldron',
  'brewing_stand', 'composter', 'crafter', 'command_block', 'structure_block',
  'campfire', 'soul_campfire', 'lantern', 'soul_lantern', 'jukebox',
  'flower_pot', 'scaffolding', 'beehive', 'bee_nest', 'respawn_anchor',
]);

// Does the held item place a block? Blocks and items share names in modern
// versions (a "stone" item places a "stone" block), so compare both lists.
function heldItemPlacesBlock(item) {
  try {
    const name = String((item && item.name) || '').toLowerCase();
    if (!name) return false;
    const md = require('minecraft-data')(bot.version);
    if (!md.blocksByName || !md.blocksByName[name]) return false;
    if (!md.itemsByName || !md.itemsByName[name]) return false;
    // These are blocks you can hold but never place by hand.
    if (/^(water|lava|fire|air|cave_air|void_air|nether_portal|end_portal|bedrock|spawner|barrier|structure_void|light)$/.test(name)) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// Modded items are not in prismarine's vanilla registry, so it calls them
// "unknown". That matters here: "right click" with a mod item is the main
// reason anyone asks for this command in the first place.
function isModItem(item) {
  try {
    if (!item) return false;
    const name = String(item.name || '');
    if (!name || name === 'unknown') return true;
    const md = require('minecraft-data')(bot.version);
    return !(md.itemsByName && md.itemsByName[name]);
  } catch (_) {
    return false;
  }
}

// Chat-safe item name ("unknown" tells the player nothing useful).
function itemLabel(item) {
  if (!item) return 'nothing';
  const name = String(item.name || '');
  if (!name || name === 'unknown') {
    return item.type !== undefined ? `mod item #${item.type}` : 'mod item';
  }
  return name.replace(/^.*:/, '').replace(/_/g, ' ');
}

function blockLabel(blk) {
  const name = String((blk && blk.name) || '');
  if (!name) return 'block';
  return name.replace(/^.*:/, '').replace(/_/g, ' ');
}

// Blocks where right-clicking runs the BLOCK's action (open, toggle, use).
// Vanilla gives the block priority over whatever is in your hand.
const INTERACTIVE_BLOCK_RE = new RegExp(
  '^(?:' + [
    '.*chest', '.*shulker_box', '.*_door', '.*_trapdoor', '.*_fence_gate', '.*_button',
    '.*_bed', 'lever', 'barrel', 'crafting_table', '.*anvil', 'enchanting_table',
    'smithing_table', 'grindstone', 'loom', 'stonecutter', 'cartography_table',
    'lectern', 'chiseled_bookshelf', 'furnace', 'blast_furnace', 'smoker',
    'brewing_stand', '.*cauldron', 'beacon', 'jukebox', 'note_block',
    'daylight_detector', 'repeater', 'comparator', 'hopper', 'dropper', 'dispenser',
    '.*piston', 'observer', 'crafter', 'composter', 'respawn_anchor', 'conduit',
    'decorated_pot', 'flower_pot', 'bell', 'dragon_egg', 'beehive', 'bee_nest',
    'chain_command_block', 'repeating_command_block', 'command_block',
    'structure_block', 'jigsaw', 'turtle_egg', 'cake',
  ].join('|') + ')$'
);

function isInteractiveBlock(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return false;
  return RIGHT_CLICK_BLOCKS.has(n) || INTERACTIVE_BLOCK_RE.test(n);
}

// face index -> outward normal (0 bottom, 1 top, 2 north/-Z, 3 south/+Z,
// 4 west/-X, 5 east/+X)
const FACE_VECS = {
  0: [0, -1, 0],
  1: [0, 1, 0],
  2: [0, 0, -1],
  3: [0, 0, 1],
  4: [-1, 0, 0],
  5: [1, 0, 0],
};

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(0.999, Math.max(0.001, v));
}

// Right-click a block exactly like a real client: ONE use_item_on packet with
// the real face and the real point on that face. This is the packet modded
// items (wands, block placer items, custom tools) and buckets/spawn eggs
// listen to. The old code only sent in-air use against blocks, so modded
// items that implement useOn never fired at all.
async function useOnBlock(hit) {
  const blk = hit && hit.block;
  if (!blk || !blk.position) return false;
  const Vec3 = require('vec3');
  const f = FACE_VECS[hit.face] || FACE_VECS[1];
  let cursor = new Vec3(0.5, 0.5, 0.5);
  try {
    if (hit.intersect) {
      const local = hit.intersect.minus(blk.position);
      cursor = new Vec3(clamp01(local.x), clamp01(local.y), clamp01(local.z));
    }
  } catch (_) {}
  try {
    await bot.lookAt(blk.position.offset(0.5, 0.5, 0.5), true);
  } catch (_) {}
  await wait(150);
  await bot.activateBlock(blk, new Vec3(f[0], f[1], f[2]), cursor);
  return true;
}

// In-air use (use_item): bows, food, projectiles, most "use" mod items.
async function useHeldInAir(holdMs = 500) {
  try {
    bot.activateItem();
  } catch (_) {}
  await wait(holdMs);
  try {
    bot.deactivateItem();
  } catch (_) {}
}

// The block under her feet, shaped like a raycast hit (top face). Used by
// "right click the ground" so a modded block item has something to go on.
function blockBelow() {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  try {
    const Vec3 = require('vec3');
    const below = bot.entity.position.floored().offset(0, -1, 0);
    const blk = bot.blockAt(below);
    if (!blk) return null;
    const lx = clamp01(bot.entity.position.x - below.x);
    const lz = clamp01(bot.entity.position.z - below.z);
    return {
      block: blk,
      face: 1,
      intersect: new Vec3(below.x + lx, below.y + 1, below.z + lz),
      position: below,
    };
  } catch (_) {
    return null;
  }
}

// The block in the crosshair, with its hit face resolved.
//
// NOTE: mineflayer's own bot.blockAtCursor()/bot.entityAtCursor() are NOT
// usable here — prismarine-world 3.7 made world.raycast async while the
// ray_trace plugin still treats it as sync, so blockAtCursor() hands back a
// Promise and entityAtCursor() throws. Roll our own against the sync APIs.
// eyeOverride / dirOverride let a caller cast the ray from somewhere else —
// used by "look there", which follows the speaker's eyes, not hers.
function cursorBlock(maxDist = 4.5, eyeOverride = null, dirOverride = null) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  let RaycastIterator = null;
  let Vec3 = null;
  try {
    RaycastIterator = require('prismarine-world').iterators.RaycastIterator;
    Vec3 = require('vec3');
  } catch (_) {
    return null;
  }
  try {
    const e = bot.entity;
    const eye = eyeOverride || e.position.offset(0, e.eyeHeight || 1.62, 0);
    const pitch = e.pitch || 0;
    const yaw = e.yaw || 0;
    const csPitch = Math.cos(pitch);
    const dir = dirOverride || new Vec3(-Math.sin(yaw) * csPitch, Math.sin(pitch), -Math.cos(yaw) * csPitch);
    const iter = new RaycastIterator(eye, dir, maxDist);
    let pos = eye;
    let guard = 0;
    while (pos && guard++ < 64) {
      const position = new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z));
      let block = null;
      try {
        block = bot.blockAt(position);
      } catch (_) {}
      if (block) {
        // Modded blocks have no vanilla registry entry, so prismarine hands
        // back a block with an empty name and no shapes. Treat those as a
        // full cube — otherwise the ray passes straight through modded
        // terrain and she can never target a mod block.
        let shapes = block.shapes || [];
        if (!block.name) shapes = [[0, 0, 0, 1, 1, 1]];
        if (shapes.length) {
          const hit = iter.intersect(shapes, position);
          if (hit) {
            return { block, face: hit.face, intersect: hit.pos, position: block.position };
          }
        }
      }
      pos = iter.next();
    }
    return null;
  } catch (_) {
    return null;
  }
}

// The entity in the crosshair (within reach), or null.
function cursorEntity(maxDist = 4) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  let RaycastIterator = null;
  let Vec3 = null;
  try {
    RaycastIterator = require('prismarine-world').iterators.RaycastIterator;
    Vec3 = require('vec3');
  } catch (_) {
    return null;
  }
  try {
    const e = bot.entity;
    const dir = new Vec3(
      -Math.sin(e.yaw || 0) * Math.cos(e.pitch || 0),
      Math.sin(e.pitch || 0),
      -Math.cos(e.yaw || 0) * Math.cos(e.pitch || 0)
    ).normalize();
    const iter = new RaycastIterator(e.position.offset(0, e.eyeHeight || 1.62, 0), dir, maxDist);
    const list = [];
    for (const id of Object.keys(bot.entities || {})) {
      const en = bot.entities[id];
      if (!en || en === e || !en.position) continue;
      if (en.type && String(en.type).toLowerCase() === 'object') continue;
      if (bot.username && en.username === bot.username) continue;
      if (en.position.distanceTo(e.position) > maxDist) continue;
      list.push(en);
    }
    let best = null;
    let bestDist = maxDist;
    for (const en of list) {
      const w = (en.width || 0.6) / 2;
      const hit = iter.intersect([[-w, 0, -w, w, en.height || 1.8, w]], en.position);
      if (!hit) continue;
      const toEntity = en.position.minus(e.position);
      if (Math.sign(toEntity.dot(dir)) === -1) continue;
      const d = e.position.distanceTo(hit.pos);
      if (d < bestDist) {
        bestDist = d;
        best = en;
      }
    }
    return best;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The Shooting Star (Demo) — the Stellar Remote
// ---------------------------------------------------------------------------
// The mod never casts through a vanilla right click. The remote's use() hook
// lives on the client: it packs the shot into its own Forge channel,
// "shooting_star_demo:cast", and sends that to the server. The record is:
//
//   byte   0x00       Forge message index — SimpleChannel frames every
//                     message with one discriminator byte, this one is 0
//   varint skill      0 = The Shooting Star, 1 = Gungnir, 2 = Seven Stars,
//                     3 = Tesseract, 4 = Gravitia
//   float  power      size of the strike (the mod's own slider)
//   float  damage     health each hit takes
//   float  speed      1 = normal playback
//   float  width      width of the strike
//   bool   everyone   play the cutscene for everyone nearby
//
// The bot writes that record straight into the socket: the real client fills
// it in from slider settings a bot has no way of reading.
const TSS_CAST_CHANNEL = 'shooting_star_demo:cast';
const TSS_CHANNEL_PREFIX = 'shooting_star_demo:';

// Skill order = the mod's own enum order. `power` is each skill's own
// minimum, so a cast stays small and cheap unless the player asks for more.
const TSS_SKILLS = [
  { id: 'the_shooting_star', label: 'The Shooting Star', power: 10, re: /\b(the\s+)?shooting\s*stars?\b|\brailgun\b|\bss\s*0?1\b/ },
  { id: 'gungnir', label: 'Gungnir', power: 0.1, re: /\bgungnir\b|\bss\s*0?3\b/ },
  { id: 'seven_stars', label: 'Seven Stars', power: 0.1, re: /\bseven\s*stars?\b|\bss\s*0?4\b/ },
  { id: 'tesseract', label: 'Tesseract', power: 0.05, re: /\btesseract\b|\bss\s*0?5\b/ },
  { id: 'gravitia', label: 'Gravitia', power: 1, re: /\bgravitia\b|\bss\s*0?6\b/ },
];

// Bumped every time the mod answers us. The mod replies on its own channel
// family ("shooting_star_demo:spell_fx" carries the cutscene), and only when
// the server really accepted the shot — silence means the remote wasn't in
// hand, the permission is missing, or the skill is still on cooldown.
let tssReplies = 0;

// Which skill does this message ask for? -1 when it names none.
function tssSkillFromText(text) {
  const t = String(text || '').toLowerCase();
  for (let i = 0; i < TSS_SKILLS.length; i++) {
    if (TSS_SKILLS[i].re.test(t)) return i;
  }
  const m = t.match(/\bskill\s*([1-5])\b/);
  if (m) return parseInt(m[1], 10) - 1;
  return -1;
}

// "right click gungnir 50" → which skill, how big, for everyone.
function clickOpts(cmd) {
  const t = String(cmd || '');
  const skill = tssSkillFromText(t);
  const opts = { skill: skill >= 0 ? skill : null };
  // The "everyone" flag shares the cutscene with every player near the
  // spell. A real client sends it when its own config says so
  // (rimulib.properties: cutscenes + cutscenes.everyone), so the bot does the
  // same — "for me only" turns it off for one cast.
  const onlyMe = /\b(for me|just me|only me|me only|not for everyone|no cutscene|without cutscene)\b/.test(t);
  opts.everyone = !onlyMe;
  // A bare number is the size of the strike ("right click shooting star 50").
  const clean = t.replace(/\bss\s*\d+\b/g, ' ').replace(/\bskill\s*\d+\b/g, ' ');
  const m = clean.match(/\b(\d{1,4})\b/);
  if (m) {
    const n = parseFloat(m[1]);
    if (Number.isFinite(n) && n > 0) opts.power = n;
  }
  return opts;
}

// Forge frames the body with one discriminator byte (the message index)
// before the record itself.
function encodeTssCast(skill, power, damage, speed, width, everyone) {
  const buf = Buffer.alloc(24);
  let off = 0;
  buf.writeUInt8(0x00, off++); // message index 0
  let v = skill >>> 0; // varint
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    buf.writeUInt8(b, off++);
  } while (v !== 0);
  buf.writeFloatBE(power, off);
  off += 4;
  buf.writeFloatBE(damage, off);
  off += 4;
  buf.writeFloatBE(speed, off);
  off += 4;
  buf.writeFloatBE(width, off);
  off += 4;
  buf.writeUInt8(everyone ? 1 : 0, off++);
  return buf.slice(0, off);
}

function sendTssCast(skill, opts = {}) {
  const client = bot && bot._client;
  if (!client) return false;
  const def = TSS_SKILLS[skill] || TSS_SKILLS[0];
  const power = Number.isFinite(opts.power) ? opts.power : def.power;
  const damage = Number.isFinite(opts.damage) ? opts.damage : 2;
  const speed = Number.isFinite(opts.speed) ? opts.speed : 1;
  const width = Number.isFinite(opts.width) ? opts.width : 1;
  // Share the cutscene with everyone near the spell unless the player said
  // otherwise — this is what a real client with "cutscenes.everyone" on sends.
  const everyone = opts.everyone !== false;
  const data = encodeTssCast(skill, power, damage, speed, width, everyone);
  try {
    client.write('custom_payload', { channel: TSS_CAST_CHANNEL, data });
  } catch (e) {
    mcLog(`tss: cast failed: ${String((e && e.message) || e).slice(0, 90)}`);
    return false;
  }
  mcLog(`tss: cast ${def.id} power=${power} damage=${damage} speed=${speed} width=${width} everyone=${everyone}`);
  return true;
}

// Watch the mod's channel so we know when the server took the shot. The mod
// only answers an accepted cast, so this doubles as the "did it work?" check.
function attachTssWatcher(client) {
  if (!client || typeof client.on !== 'function') return;
  try {
    client.on('custom_payload', (packet) => {
      const ch = String((packet && packet.channel) || '');
      if (!ch.startsWith(TSS_CHANNEL_PREFIX)) return;
      tssReplies++;
      mcLog(`tss: reply on ${ch}`);
    });
  } catch (_) {}
}

// Wait for the mod's answer. It only comes back when the server took the
// shot, so this doubles as the "did it work?" check.
async function tssCastConfirmed(timeoutMs = 1500) {
  const before = tssReplies;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (tssReplies > before) return true;
    await wait(60);
  }
  return false;
}

// Who is this message aimed at? The mod's cast packet carries no coordinates
// — the server shoots along the caster's own look vector (AimApi: the caster's
// eye, their look direction, then a raycast for the first living thing on it)
// — so the bot has to turn and face the target before it casts.
// Players are matched by name, mobs by their kind ("at the creeper").
function findTargetEntity(text) {
  try {
    let t = String(text || '').toLowerCase();
    if (!t.trim()) return null;
    // Drop the skill names and the command words first, so a player called
    // "Star" doesn't get picked up by "shooting star".
    for (const sk of TSS_SKILLS) {
      t = t.replace(new RegExp(sk.re.source, 'g'), ' ');
    }
    t = t.replace(/\b(cast|fire|shoot|blast|launch|trigger|use|right ?click|left ?click|click|skill|everyone|for|me|only|at|on|to|the|a|an)\b/g, ' ');
    if (!t.trim()) return null;
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const self = bot && bot.username ? String(bot.username).toLowerCase() : '';

    // Players: exact name, longest match wins ("steve" inside "steveTwo").
    let best = null;
    const players = bot && bot.players ? Object.values(bot.players) : [];
    for (const p of players) {
      const name = String(p.username || '').toLowerCase();
      if (!name || name === self) continue;
      if (!new RegExp('\\b' + esc(name) + '\\b').test(t)) continue;
      if (!best || name.length > String(best.username || '').length) best = p;
    }
    if (best) return best;

    // Mobs and animals: "at the creeper", "at the zombie". The one in the
    // crosshair wins, otherwise the nearest one.
    const inSight = findEntityInSight(32);
    let mob = null;
    let mobScore = Infinity;
    const me = bot && bot.entity ? bot.entity.position : null;
    for (const id of Object.keys((bot && bot.entities) || {})) {
      const en = bot.entities[id];
      if (!en || !en.position) continue;
      if (!LIVING_ENTITY_TYPES.has(String(en.type || '').toLowerCase())) continue;
      const label = String(en.displayName || en.name || '').toLowerCase();
      if (!label || !new RegExp('\\b' + esc(label) + '\\b').test(t)) continue;
      let score = me ? en.position.distanceTo(me) : 0;
      if (en === inSight) score = -1;
      if (score < mobScore) {
        mobScore = score;
        mob = en;
      }
    }
    return mob;
  } catch (_) {
    return null;
  }
}

// The first living thing on the aim ray — the same pick the server does when
// it works out where the strike lands (ProjectileUtil.getEntityHitResult):
// mobs, animals and players all count, anything not alive does not.
const LIVING_ENTITY_TYPES = new Set([
  'ambient', 'animal', 'hostile', 'living', 'mob', 'passive', 'player', 'water_creature',
]);

function findEntityInSight(maxDist = 32) {
  if (!bot || !bot.entity || !bot.entity.position) return null;
  let RaycastIterator = null;
  let Vec3 = null;
  try {
    RaycastIterator = require('prismarine-world').iterators.RaycastIterator;
    Vec3 = require('vec3');
  } catch (_) {
    return null;
  }
  try {
    const e = bot.entity;
    const dir = new Vec3(
      -Math.sin(e.yaw || 0) * Math.cos(e.pitch || 0),
      Math.sin(e.pitch || 0),
      -Math.cos(e.yaw || 0) * Math.cos(e.pitch || 0)
    ).normalize();
    const eye = e.position.offset(0, e.eyeHeight || 1.62, 0);
    const iter = new RaycastIterator(eye, dir, maxDist);
    let best = null;
    let bestDist = maxDist;
    for (const id of Object.keys(bot.entities || {})) {
      const en = bot.entities[id];
      if (!en || en === e || !en.position) continue;
      if (!LIVING_ENTITY_TYPES.has(String(en.type || '').toLowerCase())) continue;
      if (bot.username && en.username === bot.username) continue;
      const w = (en.width || 0.6) / 2;
      const hit = iter.intersect([[-w, 0, -w, w, en.height || 1.8, w]], en.position);
      if (!hit) continue;
      const toEntity = en.position.minus(e.position);
      if (Math.sign(toEntity.dot(dir)) === -1) continue;
      const d = e.position.distanceTo(hit.pos);
      if (d < bestDist) {
        bestDist = d;
        best = en;
      }
    }
    return best;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Looking where she's told. Commands (her name optional, like "come"):
//   look here / look at me        -> at the speaker's eyes
//   look there / look where I'm looking -> along the speaker's own aim
//   look at 123 65 456            -> a spot in the world
//   look at Steve / the creeper   -> a player or mob
// The look is held for a few seconds so the idle gaze doesn't immediately
// wander off again.
// ---------------------------------------------------------------------------
function entityLookDir(en) {
  const yaw = Number((en && en.yaw) || 0);
  const pitch = Number((en && en.pitch) || 0);
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

function prettyBlockName(name) {
  const n = String(name || '').split(':').pop().replace(/_/g, ' ').trim();
  return n || 'there';
}

// Minecraft block coords. Parsed from the raw message because the sanitized
// command text strips the minus sign.
function lookCoords(text) {
  const m = String(text || '').match(
    /\b(?:look|stare|gaze)\s+(?:at\s+|to\s+)?(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)\b/
  );
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  const z = Number(m[3]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return { x, y, z, label: `${m[1]} ${m[2]} ${m[3]}` };
}

// Is this message a look order (rather than chatter that happens to contain
// "look")? The verb has to lead, after optional politeness and her name.
function parseLookCommand(text) {
  try {
    const raw = String(text || '').toLowerCase();
    if (!/\b(look|stare|gaze)\b/.test(raw)) return null;
    let t = raw
      .replace(/[^a-z0-9 ,.'~-]/g, ' ')
      .replace(/^\s*(?:(?:hey|oi|yo|ok|okay|please|pls|now|can|could|would|will|you|u)\s+)*/, '')
      .trim();
    const selfName = bot && bot.username ? String(bot.username).toLowerCase() : '';
    if (selfName && t.startsWith(selfName)) t = t.slice(selfName.length).trim();
    if (!/^(look|stare|gaze)\b/.test(t)) return null;
    // "look out!", "look after him" — chatter, not a gaze order.
    if (/^(?:out|around|after|alive|sharp|again)\b/.test(t.replace(/^(?:look|stare|gaze)\s*/, ''))) return null;

    const coords = lookCoords(t);
    if (coords) return { kind: 'point', pos: coords, label: coords.label };

    // "look here" / "look at me" — at the speaker.
    if (/\b(here|at me|on me|my way|towards? me)\b/.test(t)) return { kind: 'me' };

    // "look there" / "look where I'm looking" — along the speaker's aim.
    if (/\b(there|where i'?m looking|where im looking|where i am looking|my cursor|my crosshair|what i'?m looking at|what im looking at|where you'?re pointing)\b/.test(t)) {
      return { kind: 'where' };
    }

    const target = findTargetEntity(t);
    if (target) return { kind: 'entity', target };

    // It IS a look order, just with nothing recognisable after it.
    return { kind: 'unknown' };
  } catch (_) {
    return null;
  }
}

// Keep the gaze on a living target for the hold time: you move, she follows,
// instead of freezing at where you stood when the order was given.
async function trackGaze(target, offsetY, gen) {
  while (bot && gen === lookGen && Date.now() < lookHoldUntil) {
    await wait(400);
    if (!bot || gen !== lookGen || !target || !target.position) return;
    try {
      await bot.lookAt(target.position.offset(0, offsetY, 0), true);
    } catch (_) {}
  }
}

async function lookTask(requester, spec) {
  if (!bot || !bot.entity || !spec) return;
  const myGen = ++lookGen;
  const say = (line) => {
    try {
      bot.chat(line);
    } catch (_) {}
  };
  let Vec3 = null;
  try {
    Vec3 = require('vec3');
  } catch (_) {}
  let asker = null;
  try {
    const p = bot.players && requester ? bot.players[requester] : null;
    asker = (p && p.entity) || null;
  } catch (_) {}
  const eyeOf = (en) => en.position.offset(0, en.eyeHeight || 1.62, 0);
  let point = null;
  let line = '';

  if (spec.kind === 'me') {
    if (!asker || !asker.position) {
      say("I can't see you~");
      return;
    }
    point = eyeOf(asker);
    line = 'Looking at you~';
  } else if (spec.kind === 'where') {
    if (!asker || !asker.position || !Vec3) {
      say("I can't see where you're looking~");
      return;
    }
    const eye = eyeOf(asker);
    const d = entityLookDir(asker);
    let dir = null;
    try {
      dir = new Vec3(d.x, d.y, d.z).normalize();
    } catch (_) {}
    if (!dir) {
      say("I can't see where you're looking~");
      return;
    }
    // The block they're aiming at if there is one (64 blocks out), so the
    // reply can name it; otherwise a point far along the same line.
    const hit = cursorBlock(64, eye, dir);
    if (hit && hit.position) {
      const name = hit.block && hit.block.name ? prettyBlockName(hit.block.name) : '';
      point = hit.position.offset(0.5, 0.5, 0.5);
      line = name ? `Looking at the ${name}~` : 'Looking there~';
    } else {
      point = eye.plus(dir.scaled(32));
      line = 'Looking there~';
    }
  } else if (spec.kind === 'point') {
    if (!Vec3) return;
    // Block coords: aim at the middle of that block.
    point = new Vec3(spec.pos.x + 0.5, spec.pos.y + 0.5, spec.pos.z + 0.5);
    line = `Looking at ${spec.label}~`;
  } else if (spec.kind === 'entity') {
    const en = spec.target;
    if (!en || !en.position) {
      say("I can't see that~");
      return;
    }
    point = en.position.offset(0, (en.height || 1.8) * 0.55, 0);
    const who = en.username || en.displayName || en.name || 'it';
    line = `Looking at ${who}~`;
  }

  if (!point) {
    say("Look where? Try 'look here', 'look there', or 'look at 123 65 456'~");
    return;
  }
  lookHoldUntil = Date.now() + 9000;
  try {
    await bot.lookAt(point, true);
  } catch (_) {}
  say(line);
  // You (or a mob) may walk away — keep the gaze on the target while the
  // hold lasts. Fire-and-forget: the reply already went out.
  if (spec.kind === 'me' && asker) {
    trackGaze(asker, asker.eyeHeight || 1.62, myGen).catch(() => {});
  } else if (spec.kind === 'entity' && spec.target) {
    trackGaze(spec.target, (spec.target.height || 1.8) * 0.55, myGen).catch(() => {});
  }
}

// Fire the Stellar Remote. The mod checks the main and off hand, so the
// remote has to be in one of them; the server's answer is the only proof the
// shot was taken.
async function castTssSkill(skillIdx, opts = {}) {
  const skill = skillIdx >= 0 && skillIdx < TSS_SKILLS.length ? skillIdx : 0;
  const def = TSS_SKILLS[skill];
  let held = null;
  try {
    held = bot.heldItem;
  } catch (_) {}
  if (!held || !isModItem(held)) {
    // Not in hand: grab the modded item out of the bag (the remote is the
    // only item this mod adds).
    const mod = invItems().find((i) => isModItem(i));
    if (mod) {
      try {
        await bot.equip(mod, 'hand');
      } catch (_) {}
      try {
        held = bot.heldItem;
      } catch (_) {}
    }
  }
  if (!held || !isModItem(held)) return { ok: false, reason: 'no-item', label: def.label };
  // Turn to face the target: the packet has no coordinates, the server uses
  // the caster's look direction to work out where the strike lands. With no
  // name given, the server would pick whatever living thing is on the aim
  // ray — so aim at that one (a mob, an animal, another player).
  let target = opts.target || null;
  if (!target) target = findEntityInSight(32);
  if (target && target.position) {
    try {
      const h = target.height || 1.8;
      await bot.lookAt(target.position.offset(0, h * 0.55, 0), true);
      await wait(140);
    } catch (_) {}
  }
  if (!sendTssCast(skill, opts)) return { ok: false, reason: 'send-failed', label: def.label };
  const ok = await tssCastConfirmed(opts.timeoutMs || 1500);
  const targetName = target && target.username
    ? String(target.username)
    : (target && target.displayName ? String(target.displayName) : '');
  return { ok, reason: ok ? 'cast' : 'no-reply', label: def.label, skill, target: targetName };
}

// "cast gungnir" — fire the Stellar Remote.
async function castTask(requester, skillIdx, opts = {}) {
  if (!bot || !bot.entity) return;
  if (taskBusy) {
    try {
      bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  try {
    const res = await castTssSkill(skillIdx, opts);
    if (!alive()) return;
    if (res.ok) {
      try {
        bot.chat(res.target ? `${res.label} fired at ${res.target}~` : `${res.label} fired~`);
      } catch (_) {}
      return;
    }
    if (res.reason === 'no-item') {
      try {
        bot.chat("I don't have the Stellar Remote~");
      } catch (_) {}
      return;
    }
    try {
      bot.chat(`The ${res.label} didn't fire~`);
    } catch (_) {}
  } finally {
    if (myGen === woodGen) taskBusy = false;
  }
}

// "right click" — use the held item / interact, the way a real client does.
// mode: 'cursor' (default) = whatever she's looking at, 'block' = force use on
// the block (aims at the floor if she isn't looking at one), 'air' = force
// in-air use.
async function rightClickTask(requester, mode = 'cursor', opts = {}) {
  if (!bot || !bot.entity) return;
  if (taskBusy) {
    try {
      bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  const say = (t) => {
    try {
      bot.chat(t);
    } catch (_) {}
  };
  try {
    // 0. The Stellar Remote (The Shooting Star demo). The mod casts over its
    //    own channel, so a vanilla right click would do nothing at all — and
    //    only the real remote in her hand makes the server take the shot.
    const askedSkill = opts && opts.skill != null && opts.skill >= 0 ? opts.skill : -1;
    const wantsCast = !!(opts && opts.cast) || askedSkill >= 0;
    let heldNow = null;
    try {
      heldNow = bot.heldItem;
    } catch (_) {}
    if (heldNow && isModItem(heldNow)) {
      // A named skill means the player wants the shot, so wait properly for
      // the server's answer. A plain "right click" only gets a short grace
      // period: if the server stays quiet the item in her hand is not the
      // remote, and the normal right click still has to happen.
      const res = await castTssSkill(askedSkill >= 0 ? askedSkill : 0, wantsCast
        ? Object.assign({}, opts, { timeoutMs: 1500 })
        : Object.assign({}, opts, { timeoutMs: 700 }));
      if (res.ok) {
        say(res.target ? `${res.label} fired at ${res.target}~` : `${res.label} fired~`);
        mcLog(`right click: cast ${res.label}${res.target ? ' at ' + res.target : ''}`);
        return;
      }
      if (wantsCast) {
        say(res.reason === 'no-item' ? "I don't have the Stellar Remote~" : `The ${res.label} didn't fire~`);
        mcLog(`right click: cast refused (${res.reason})`);
        return;
      }
      // Not the remote (or the server said no): carry on with the normal
      // right click so other modded items still work.
    }

    // Forced in-air use: bows, food, projectiles, "use" mod items.
    if (mode === 'air') {
      const held = bot.heldItem;
      if (!held) {
        say('Nothing in my hands~');
        return;
      }
      await useHeldInAir(700);
      say(`Used ${itemLabel(held)}~`);
      mcLog(`right click: use_item ${itemLabel(held)}`);
      return;
    }

    // 1. A living target in front of her — use the item ON it (feed a mob,
    //    shear a sheep, name-tag, etc.).
    const ent = mode === 'cursor' ? cursorEntity(4) : null;
    if (ent) {
      try {
        bot.lookAt(ent.position.offset(0, ent.height ? ent.height * 0.5 : 0.8, 0), true);
      } catch (_) {}
      await wait(220);
      if (!alive()) return;
      try {
        bot.useOn(ent);
      } catch (_) {}
      const label = ent.username || ent.displayName || ent.name || 'it';
      say(`Used it on ${String(label).replace(/_/g, ' ')}~`);
      mcLog(`right click: used on ${label}`);
      return;
    }

    // 2. A block in the crosshair (or under her feet, when forced).
    const hit = cursorBlock(4.5) || (mode === 'block' ? blockBelow() : null);
    if (hit && hit.block) {
      const held = bot.heldItem;
      const blkName = String(hit.block.name || '').toLowerCase();

      // 2a. Interactive block: the block wins, exactly like vanilla (a chest
      //     opens instead of the held block being placed on it).
      if (isInteractiveBlock(blkName)) {
        try {
          await useOnBlock(hit);
        } catch (e) {
          mcLog(`right click: block use failed: ${String((e && e.message) || e).slice(0, 90)}`);
          say(`Couldn't use that ${blockLabel(hit.block)}~`);
          return;
        }
        say(`Used the ${blockLabel(hit.block)}~`);
        mcLog(`right click: activated ${hit.block.name}`);
        return;
      }

      // 2b. A vanilla block in hand: place it against the face.
      if (held && heldItemPlacesBlock(held)) {
        let placed = false;
        try {
          const Vec3 = require('vec3');
          const f = FACE_VECS[hit.face] || FACE_VECS[1];
          try {
            bot.lookAt(hit.block.position.offset(0.5, 0.5, 0.5), true);
          } catch (_) {}
          await wait(180);
          if (!alive()) return;
          await bot.placeBlock(hit.block, new Vec3(f[0], f[1], f[2]));
          placed = true;
        } catch (e) {
          // The registry thought it was a block but the server refused —
          // fall through to a normal use instead of giving up.
          mcLog(`right click: place failed: ${String((e && e.message) || e).slice(0, 90)}`);
        }
        if (placed) {
          say(`Placed ${itemLabel(held)}~`);
          mcLog(`right click: placed ${held.name}`);
          return;
        }
      }

      // 2c. Everything else: use the held item ON the block. This is the
      //     packet modded items (and buckets, tools, spawn eggs) actually
      //     listen to — the old code only fired in-air use here, which is
      //     why modded items did nothing at all.
      try {
        await useOnBlock(hit);
        if (held && isModItem(held)) {
          // Some mod items implement in-air use instead of use-on-block;
          // the vanilla client sends both when the block doesn't consume it.
          await wait(180);
          if (!alive()) return;
          await useHeldInAir(450);
        }
      } catch (e) {
        mcLog(`right click: use on block failed: ${String((e && e.message) || e).slice(0, 90)}`);
        say(held ? `Couldn't use ${itemLabel(held)} on that~` : `Couldn't poke that ${blockLabel(hit.block)}~`);
        return;
      }
      say(held ? `Used ${itemLabel(held)} on the ${blockLabel(hit.block)}~` : `Poked the ${blockLabel(hit.block)}~`);
      mcLog(`right click: used ${held ? itemLabel(held) : 'hand'} on ${hit.block.name || 'mod block'}`);
      return;
    }

    // 3. Nothing in front: in-air use (eat, drink, draw a bow, fire a wand).
    const held = bot.heldItem;
    if (held) {
      await useHeldInAir(500);
      say(`Used ${itemLabel(held)}~`);
      mcLog(`right click: activateItem ${itemLabel(held)}`);
      return;
    }
    say('Nothing in my hands~');
  } finally {
    if (myGen === woodGen) taskBusy = false;
  }
}

// "left click" — swing/attack whatever is in front of her.
async function leftClickTask(requester) {
  if (!bot || !bot.entity) return;
  if (taskBusy) {
    try {
      bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  try {
    // An entity in the crosshair — hit it.
    const ent = cursorEntity(3.5);
    if (ent) {
      try {
        bot.lookAt(ent.position.offset(0, ent.height ? ent.height * 0.5 : 0.8, 0), true);
      } catch (_) {}
      await wait(200);
      if (!alive()) return;
      await equipBestWeapon(true);
      if (!alive()) return;
      try {
        await bot.attack(ent);
      } catch (e) {
        mcLog(`left click: attack failed: ${String((e && e.message) || e).slice(0, 90)}`);
      }
      const label = ent.username || ent.displayName || ent.name || 'it';
      try {
        bot.chat(`Hit ${String(label).replace(/_/g, ' ')}!`);
      } catch (_) {}
      mcLog(`left click: attacked ${label}`);
      return;
    }
    // Nothing to hit: swing at the block in front (start digging it).
    const hit = cursorBlock(4.5);
    const blk = hit && hit.block;
    // Modded blocks report no name and an empty bounding box — still solid.
    const solid = blk && (blk.boundingBox !== 'empty' || !blk.name);
    if (solid) {
      try {
        bot.lookAt(blk.position.offset(0.5, 0.5, 0.5), true);
      } catch (_) {}
      await wait(180);
      if (!alive()) return;
      try {
        bot.swingArm();
      } catch (_) {}
      try {
        bot.chat(`Punched the ${blockLabel(blk)}~`);
      } catch (_) {}
      mcLog(`left click: punched ${blk.name || 'mod block'}`);
      return;
    }
    // Air: just swing.
    try {
      bot.swingArm();
    } catch (_) {}
    try {
      bot.chat('Swung at nothing~');
    } catch (_) {}
    mcLog('left click: swung at air');
  } finally {
    if (myGen === woodGen) taskBusy = false;
  }
}

async function scanTask() {
  if (!bot || !bot.entity) return;
  const ids = new Set(logBlockIds());
  const bp = bot.entity.position.floored();
  let manual = 0;
  let nearest = 999;
  try {
    const R = 24;
    const DY = 12;
    for (let x = -R; x <= R; x++) {
      for (let z = -R; z <= R; z++) {
        for (let y = -DY; y <= DY; y++) {
          let bl = null;
          try {
            bl = bot.blockAt(bp.offset(x, y, z));
          } catch (_) {}
          if (bl && ids.has(bl.type)) {
            manual += 1;
            const d = Math.sqrt(x * x + y * y + z * z);
            if (d < nearest) nearest = d;
          }
        }
      }
    }
  } catch (_) {}
  let apiCount = -1;
  try {
    const found = bot.findBlocks({ matching: Array.from(ids), maxDistance: 64, count: 24 });
    apiCount = (found || []).length;
  } catch (_) {}
  try {
    await bot.chat(`scan: v${bot.version} ids${ids.size} manual${manual}@${manual ? Math.round(nearest) + 'm' : '-'} api${apiCount} at${Math.round(bp.x)},${Math.round(bp.y)},${Math.round(bp.z)}`);
  } catch (_) {}
}

// One wood scan: plain ID array matching (the section prefilter handles
// arrays natively), blacklist applied after, valley trees first.
// NOTE: findBlocks returns Vec3 POSITIONS, not Blocks — resolve via blockAt.
function findWoodOptions(ids, failed) {
  let options = [];
  try {
    const found = bot.findBlocks({ matching: ids, maxDistance: 64, count: 24 });
    const bp = bot.entity.position;
    options = (found || [])
      .map((pos) => {
        try {
          return bot.blockAt(pos);
        } catch (_) {
          return null;
        }
      })
      .filter((bl) => bl && bl.type && ids.includes(bl.type))
      .filter((bl) => {
        try {
          return !failed.some((p) => p.equals(bl.position));
        } catch (_) {
          return true;
        }
      })
      .map((bl) => {
        let d = 999;
        try {
          d = bl.position.distanceTo(bp);
        } catch (_) {}
        return { bl, y: bl.position.y, d };
      }).sort((a, b) => a.d - b.d); // nearest cluster first — she finishes close before wandering
  } catch (_) {}
  return options;
}

async function gatherTask(requester, target, def) {
  if (!bot || taskBusy) {
    try {
      if (bot) bot.chat('One thing at a time~');
    } catch (_) {}
    return;
  }
  taskBusy = true;
  const myGen = ++woodGen;
  const alive = () => myGen === woodGen && !!bot;
  // Kill any combat/anti-air/direct-steer that would fight over her hands.
  combatGen += 1;
  combatBusy = false;
  lootBusy = false;
  directSteerActive = false;
  directSteerTarget = null;
  try {
    if (bot && bot.pathfinder) bot.pathfinder.setGoal(null);
  } catch (_) {}
  try {
    const ids = matBlockIds(def.blocks);
    if (!ids.length) {
      try {
        bot.chat(`I don't know ${def.word.toLowerCase()} on this version~`);
      } catch (_) {}
      return;
    }
    const startCount = countGather(def.itemRe);
    let milestone = 16;
    try {
      bot.chat(target > 1 ? `Getting ${target} ${def.word.toLowerCase()}, be right back~` : `On it, ${def.ore ? 'mining' : 'chopping'}~`);
    } catch (_) {}
    mcLog(`gather ${def.word} x${target} start (have ${startCount})`);
    try {
      const suffixes = toolForDef(def);
      const hasTool = invItems().some((i) => suffixes.some((s) => i.name.includes(s)));
      if (!hasTool) {
        mcLog(`no ${suffixes[0].replace('_', '')} available — mining by hand`);
        bot.chat(`No ${suffixes[0].replace('_', '')} on me — going by hand, this'll be slow~`);
      }
    } catch (_) {}
    // Local-first: chop what's around HER before hiking to the human —
    // walking to a far-away player first is how trees "disappear".
    const failed = [];
    let localFirst = [];
    try {
      localFirst = findWoodOptions(ids, failed);
    } catch (_) {}
    if (!localFirst.length) {
      await gotoRequester(requester, alive);
    }
    // Mine whole connected clusters (trees/veins), not lone blocks — a tree
    // gets cleared top-to-bottom instead of one log and a floating stump.
    let fails = 0;
    let sawAny = false;
    let lastErr = '';
    let veinPos = null; // continue the cluster she's already in first
    const failedIn = (p) => failed.some((q) => {
      try {
        return q.equals(p);
      } catch (_) {
        return false;
      }
    });
    while (alive() && countGather(def.itemRe) - startCount < target && fails < 8) {
      let vein = null;
      if (veinPos) {
        try {
          vein = collectVein(veinPos, ids, 96).filter((bl) => !failedIn(bl.position));
        } catch (_) {
          vein = null;
        }
      }
      if (!vein || !vein.length) {
        const options = findWoodOptions(ids, failed);
        if (!options.length) {
          mcLog(`no ${def.word} candidates left`);
          break;
        }
        sawAny = true;
        fails = 0; // fresh cluster, fresh patience
        try {
          vein = collectVein(options[0].bl.position, ids, 96)
            .filter((bl) => !failedIn(bl.position))
            .sort((a, b) => a.position.y - b.position.y); // bottom-up
        } catch (_) {
          vein = options.map((o) => o.bl);
        }
        const o = options[0];
        mcLog(`focus cluster @ ${o.bl.position.x},${o.bl.position.y},${o.bl.position.z} (${vein.length} blocks, ${o.d.toFixed(1)}m)`);
      }
      if (!vein.length) break;
      let minedThisVein = 0;
      for (const bl of vein) {
        if (!alive()) break;
        if (countGather(def.itemRe) - startCount >= target) break;
        try {
          await equipGatherTool(toolForDef(def));
          await mineSingle(bl, toolForDef(def));
          minedThisVein += 1;
          mcLog(`mined ${bl.name} @ ${bl.position.x},${bl.position.y},${bl.position.z}`);
          try {
            veinPos = bl.position.clone();
          } catch (_) {
            veinPos = null;
          }
        } catch (e) {
          fails += 1;
          try {
            lastErr = String((e && e.message) || e).slice(0, 80);
          } catch (_) {}
          mcLog(`FAILED ${bl.name} @ ${bl.position.x},${bl.position.y},${bl.position.z}: ${lastErr}`);
          try {
            failed.push(bl.position.clone());
          } catch (_) {}
          if (fails >= 8) break;
        }
      }
      if (!minedThisVein) {
        veinPos = null; // nothing here is mineable — move to the next cluster
      }
      const got = countGather(def.itemRe) - startCount;
      if (got >= milestone && got < target) {
        milestone += 16;
        try {
          bot.chat(`${got}/${target}~`);
        } catch (_) {}
      }
    }
    if (!alive()) return;
    const got = countGather(def.itemRe) - startCount;
    mcLog(`gather ${def.word} done: got ${got}/${target} (${fails} fails)`);
    if (!got) {
      try {
        bot.chat(sawAny
          ? `I see ${def.word.toLowerCase()} but can't get it (${lastErr || 'arm failure'})${botPosString()}~`
          : `No ${def.word.toLowerCase()} nearby${botPosString()}~`);
      } catch (_) {}
      return;
    }
    await deliverTo(requester, def.itemRe, got, target, def.word);
  } finally {
    if (myGen === woodGen) taskBusy = false;
  }
}

async function handleChat(username, message) {
  if (!bot || !message) return;
  try {
    if (username === bot.username) return;
  } catch (_) {}
  const low = String(message).toLowerCase();
  const saysName = (() => {
    try {
      return low.includes(String(bot.username).toLowerCase());
    } catch (_) {
      return false;
    }
  })();
  // Orders need an actual order word — her name alone ("Wisteria hello")
  // is chatter, not a follow command. Digits kept so "get 99 wood" parses.
  const cmd = low.replace(/[^a-z0-9 ]/g, ' ').trim();
  const orderRe = /\b(come|stay|stop|wait|follow|jump|guard|protect|fight|wood|logs?|chop|timber|bring|get|fetch|food|meat|hunt|dinner|snack|hungry|sleep|bed|bedtime|nap|scan|use|equip|wield|effects?|buffs?|debuffs?|speed|debug|stones?|cobble\w*|dirt|sand|gravel|clay|coals?|iron|copper|gold|redstone|lapis|diamonds?|emeralds?|quartz|obsidian|mine|dig|gather|collect|bridge|span|kill|murder|slay|assassinate|cancel|calm|peace|respawn|revive|help|commands)\b/;
  const startsOrder = /^(come|stay|stop|wait|follow|jump|here|guard|protect|fight|wood|chop|logs?|timber|bring|get|fetch|food|meat|hunt|sleep|bed|nap|scan|use|equip|wield|effects?|speed|debug|stone|dirt|sand|mine|dig|gather|collect|bridge|kill|murder|slay|cancel|calm|peace|respawn|revive|help|commands)\b/.test(cmd);
  const wantsCmd = startsOrder || (saysName && orderRe.test(cmd))
    || /\b(come here|follow me|get wood|bring wood|get food|bring food|stop guard|come back)\b/.test(cmd);
  // Click commands are explicit enough to work without her name: "right
  // click", "press right click", "leftclick", "hit it with left click".
  const hasLeft = /\bleft ?click\b/.test(cmd);
  const hasRight = /\bright ?click\b/.test(cmd);
  // Bare words (click/punch/swing) only count when the message IS that word
  // — otherwise "swing by later" would swing her arm at nothing.
  const bareClick = /^(please\s+)?(click|punch|swing|smack)(\s+(please|now))?$/.test(cmd);
  // Diagnostics / mod-item helpers that work without her name.
  const wantsHeld = /^(what am i holding|what are you holding|whats in my hand|what is in my hand|hold (the |your |that )?(mod|modded|special|unknown|mystery)|grab (the |your |that )?(mod|modded|special|unknown|mystery))\b/.test(cmd);
  // The mod's weapon: "cast gungnir", "fire the shooting star", "shoot
  // tesseract". "cast" on its own is unambiguous; the other verbs only count
  // when a skill is named, so "shoot the skeleton" still means something else.
  const tssSkill = tssSkillFromText(cmd);
  const wantsCast = /\bcast\b/.test(cmd) || (tssSkill >= 0 && /\b(use|fire|shoot|blast|launch|trigger)\b/.test(cmd));
  // "cast gungnir at Steve" / "cast gungnir at the creeper" — the mod has no
  // coordinates in its packet, so the bot has to face the target herself.
  const tssTarget = findTargetEntity(cmd);
  // "look here" / "look there" / "look at 123 65 456" / "look at the
  // creeper". Handled before the order gate so it needs no name and can't be
  // mistaken for a gather order ("look at the stone").
  const lookSpec = parseLookCommand(message);
  if (lookSpec) {
    lookTask(username, lookSpec).catch(() => {});
    return;
  }
  if (wantsCmd || hasLeft || hasRight || bareClick || wantsHeld || wantsCast) {
    if (wantsHeld) {
      heldInfoTask().catch(() => {});
      return;
    }
    if (hasLeft || hasRight) {
      guardOff(true);
      stayPut = false;
      if (hasLeft && !hasRight) {
        leftClickTask(username).catch(() => {});
        return;
      }
      // "right click the ground/floor" forces use-on-block; "right click in
      // the air" forces in-air use. Plain "right click" uses the crosshair.
      let mode = 'cursor';
      if (/\b(ground|floor|below|under ?me|underneath)\b/.test(cmd)) mode = 'block';
      else if (/\b(in the air|in air|at nothing|no block)\b/.test(cmd)) mode = 'air';
      const opts = clickOpts(cmd);
      if (tssTarget) opts.target = tssTarget;
      rightClickTask(username, mode, opts).catch(() => {});
      return;
    }
    if (wantsCast) {
      guardOff(true);
      stayPut = false;
      const opts = clickOpts(cmd);
      opts.cast = true;
      if (tssTarget) opts.target = tssTarget;
      castTask(username, tssSkill >= 0 ? tssSkill : 0, opts).catch(() => {});
      return;
    }
    if (bareClick) {
      guardOff(true);
      stayPut = false;
      leftClickTask(username).catch(() => {});
      return;
    }
    if (/\bjump\b/.test(cmd)) {
      try {
        bot.setControlState('jump', true);
        setTimeout(() => {
          try {
            bot.setControlState('jump', false);
          } catch (_) {}
        }, 600);
      } catch (_) {}
      return;
    }
    if (/\bhelp\b|\bcommands\b/.test(cmd)) {
      try {
        bot.chat('Commands: follow/come/stay, guard/stop guard, kill <mob/player>, get <wood/stone/iron/diamond/food>, bridge <n>, sleep, equip <item>, look <here/there/coords>, cancel~');
      } catch (_) {}
      return;
    }
    if (/\brespawn\b|\brevive\b/.test(cmd)) {
      try {
        bot.respawn();
      } catch (_) {}
      return;
    }
    if (/\bsleep\b|\bbed\b|\bbedtime\b|\bnap\b/.test(cmd)) {
      guardOff(true);
      sleepNow(username).catch(() => {});
      return;
    }
    if (/\bscan\b/.test(cmd)) {
      scanTask().catch(() => {});
      return;
    }
    if (/\beffects?\b|\bbuffs?\b|\bdebuffs?\b/.test(cmd)) {
      try {
        bot.chat(`Effects: ${effectsSummary()}`);
      } catch (_) {}
      return;
    }
    if (/\bspeed\b|\bhow fast\b|\bdebug\b/.test(cmd)) {
      speedTask().catch(() => {});
      return;
    }
    if (/\bbridge\b|\bspan\b/.test(cmd)) {
      guardOff(true);
      stayPut = false;
      const mNum = cmd.match(/\b(\d{1,2})\b/);
      const want = Math.max(2, Math.min(32, mNum ? parseInt(mNum[1], 10) : 8));
      bridgeTask(want).catch(() => {});
      return;
    }
    if (/\bkill\b|\bmurder\b|\bslay\b|\bassassinate\b/.test(cmd)) {
      const rest = cmd
        .replace(/.*?(\bkill\b|\bmurder\b|\bslay\b|\bassassinate\b)/, '')
        .replace(/^\s*(?:a|an|the|that|those|this|some)\s+/, '')
        .replace(/\s+(?:please|pls|now|for me)\s*$/, '')
        .trim();
      // Named player first (word-boundary IGN match wins).
      let pname = '';
      try {
        for (const n of Object.keys(bot.players || {})) {
          if (bot.username && n === bot.username) continue;
          const esc = n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${esc}\\b`).test(rest)) {
            pname = n;
            break;
          }
        }
      } catch (_) {}
      if (pname) {
        huntOrder = { kind: 'player', name: pname, label: pname };
        huntResolved = false;
        guardMode = false;
        guardTarget = null;
        try {
          bot.chat(`Hit accepted: ${pname}. They won't see it coming~`);
        } catch (_) {}
        return;
      }
      const singular = rest
        .replace(/\bendermen\b/g, 'enderman')
        .replace(/\bwitches\b/g, 'witch')
        .replace(/s$/, '');
      const key = KILL_ALIASES[rest] || KILL_ALIASES[singular] || singular.replace(/\s+/g, '');
      const selfName = String((bot && bot.username) || '').toLowerCase();
      if (!key) {
        try {
          bot.chat('Who exactly? Say "kill the warden" or "kill Steve".');
        } catch (_) {}
        return;
      }
      if (key === 'me' || key === 'myself' || (selfName && key === selfName)) {
        try {
          bot.chat('I like living, thanks.');
        } catch (_) {}
        return;
      }
      huntOrder = { kind: 'mob', key, label: rest };
      huntResolved = false;
      guardMode = false;
      guardTarget = null;
      try {
        let dim = '';
        try {
          dim = bot.game && bot.game.dimension;
        } catch (_) {}
        if (key === 'enderdragon' && dim && dim !== 'the_end') {
          bot.chat('Dragon hit taken! But take me to the End first — I can\'t punch through dimensions!');
        } else {
          bot.chat(`Hit accepted: ${rest}. Bold choice.`);
        }
      } catch (_) {}
      return;
    }
    if (/\bcancel\b/.test(cmd) && !/cancelTask/.test(cmd)) {
      clearHunt(true);
      guardOff(true);
      bodyguard = null;
      taskBusy = false;
      woodGen++;
      try {
        if (bot.collectBlock) bot.collectBlock.cancelTask();
      } catch (_) {}
      stopMoving();
      try {
        bot.chat('Cancelled~');
      } catch (_) {}
      return;
    }
    if (/\bstop guard\b|\bcalm\b|\bpeace\b|\bno guard\b/.test(cmd)) {
      guardOff();
      return;
    }
    if (/\bguard\b|\bprotect\b|\bfight\b/.test(cmd)) {
      taskBusy = false;
      woodGen++;
      stayPut = false;
      try {
        if (bot.collectBlock) bot.collectBlock.cancelTask();
      } catch (_) {}
      guardMode = true;
      guardTarget = findHostile(14);
      try {
        bot.chat(guardTarget ? 'On guard! Mobs beware~' : `No mobs nearby — I see: ${describeNearby()}`);
      } catch (_) {}
      return;
    }
    if (/\buse\b|\bequip\b|\bwield\b/.test(cmd)) {
      guardOff(true);
      stayPut = false;
      const useArg = cmd
        .replace(/^.*?\b(use|equip|wield)\b/, '')
        .replace(/^\s*(?:a|an|the|my|your|that|this)\s+/, '')
        .replace(/\s+(?:please|pls|now)\s*$/, '')
        .trim();
      useItemTask(username, useArg).catch(() => {});
      return;
    }
    if (/\bfood\b|\bmeat\b|\bhunt\b|\bdinner\b|\bsnack\b|\bhungry\b/.test(cmd)) {
      guardOff(true);
      stayPut = false;
      const mNum = cmd.match(/\b(\d{1,3})\b/);
      const want = Math.max(1, Math.min(64, mNum ? parseInt(mNum[1], 10) : 8));
      foodTask(username, want).catch(() => {});
      return;
    }
    if (/\bwood\b|\blogs?\b|\bstones?\b|\bcobble\w*\b|\bdirt\b|\bsand\b|\bgravel\b|\bclay\b|\bcoals?\b|\biron\b|\bcopper\b|\bgold\b|\bredstone\b|\blapis\b|\bdiamonds?\b|\bemeralds?\b|\bquartz\b|\bobsidian\b|\bchop\b|\btimber\b|\bmine\b|\bdig\b|\bgather\b|\bcollect\b|\bbring\b|\bget\b|\bfetch\b/.test(cmd)) {
      guardOff(true);
      stayPut = false;
      const mNum = cmd.match(/\b(\d{1,3})\b/);
      let matKey = '';
      for (const k of Object.keys(GATHER_MATS)) {
        if (new RegExp(`\\b${k}s?\\b`).test(cmd)) {
          matKey = k;
          break;
        }
      }
      if (!matKey && /\b(chop|timber)\b/.test(cmd)) matKey = 'wood';
      if (!matKey) {
        try {
          bot.chat('Get what? Try wood, stone, dirt, sand, gravel, coal, iron, gold, diamond!');
        } catch (_) {}
        return;
      }
      const def = GATHER_MATS[matKey];
      const want = Math.max(1, Math.min(256, mNum ? parseInt(mNum[1], 10) : (def.ore ? 8 : 16)));
      gatherTask(username, want, def).catch(() => {});
      return;
    }
    if (/\bstay\b|\bstop\b|\bwait\b/.test(cmd)) {
      guardOff(true);
      clearHunt(true);
      bodyguard = null;
      taskBusy = false;
      woodGen++;
      try {
        if (bot.collectBlock) bot.collectBlock.cancelTask();
      } catch (_) {}
      stopMoving();
      stayPut = true;
      try {
        bot.chat('Okay, staying put~');
      } catch (_) {}
      return;
    }
    const mFollow = cmd.match(/\bfollow\s+([a-z0-9_]{2,16})\b/);
    const who = (mFollow && mFollow[1] !== 'me') ? mFollow[1] : username;
    guardOff(true);
    clearHunt(true);
    taskBusy = false;
    woodGen++;
    stayPut = false;
    try {
      if (bot.collectBlock) bot.collectBlock.cancelTask();
    } catch (_) {}
    if (followPlayer(who) || followPlayer(username)) {
      try {
        bot.chat(`Following ${following}~`);
      } catch (_) {}
    } else {
      try {
        bot.chat('I can\'t see you yet — walk closer?');
      } catch (_) {}
    }
    return;
  }
  // Plain chatter: answer with the pet's brain (AI or offline pool in main).
  // Quoted speaker form — "NAME: msg" gets parroted back as "HUMAN: NAME:".
  if (!saysName && !currentOpts.chatty) return;
  try {
    const reply = currentHooks && currentHooks.getReply
      ? await currentHooks.getReply(`${username} says: "${message}"`, false, { user: username, scope: 'mc:global' })
      : '';
    const clean = String(reply || '').replace(/\s+/g, ' ').trim();
    // Minecraft caps chat at 256 chars — split long replies into back-to-
    // back messages instead of truncating mid-thought.
    for (const part of splitChat(clean, 200, 3)) {
      if (!bot) break;
      try {
        bot.chat(part);
      } catch (_) {
        break;
      }
      await wait(700);
    }
  } catch (_) {}
}

function startBot() {
  const opts = currentOpts;
  if (!opts) return;
  stopBrainLoop();
  taskBusy = false;
  guardTicking = false;
  combatBusy = false;
  lootBusy = false;
  woodGen += 1;
  combatGen += 1;
  try {
    if (bot) {
      try {
        bot.quit();
      } catch (_) {}
      try {
        bot.end();
      } catch (_) {}
    }
  } catch (_) {}
  bot = null;
  // Generation guard: events from the OLD connection (quit above is async)
  // must not trigger reconnects or chat — or twins kick each other forever.
  const myGen = ++startGen;
  let mineflayer;
  try {
    mineflayer = require('mineflayer');
  } catch (err) {
    setStatus('offline', 'mineflayer missing (npm install)');
    return;
  }
  const createOpts = {
    host: hostCandidates[hostCandidateIdx] || String(opts.host || '').trim() || 'localhost',
    port: Math.max(1, Math.min(65535, Number(opts.port) || 25565)),
    username: String(opts.username || '').trim() || 'Pet',
  };
  if (String(opts.auth || 'offline') === 'microsoft') {
    createOpts.auth = 'microsoft';
    createOpts.onMsaCode = (data) => {
      try {
        if (currentHooks && currentHooks.onMsaCode) {
          currentHooks.onMsaCode({
            url: (data && (data.verification_uri || data.verificationUri)) || 'https://www.microsoft.com/link',
            code: (data && (data.user_code || data.userCode)) || '',
          });
        }
      } catch (_) {}
    };
  }
  let b;
  try {
    b = mineflayer.createBot(createOpts);
  } catch (err) {
    setStatus('offline', String((err && err.message) || err).slice(0, 160));
    scheduleReconnect();
    return;
  }
  bot = b;
  // Every line she says leaves through bot.chat, so wrap it once: the app
  // gets a copy and speaks it with her TTS voice. Slash commands are skipped.
  try {
    const origChat = b.chat.bind(b);
    b.chat = (msg) => {
      const out = origChat(msg);
      try {
        const line = String(msg == null ? '' : msg).slice(0, 200);
        if (line && line.charAt(0) !== '/' && currentHooks && currentHooks.onSay) {
          currentHooks.onSay(line);
        }
      } catch (_) {}
      return out;
    };
  } catch (_) {}
  seenIds = new Set();
  sightCooldown.clear();
  lastSightAt = 0;
  moddedLocked = false;
  standInMode = false;
  groundedGuess = 0;
  lastDimension = null;
  directSteerActive = false;
  directSteerTarget = null;
  tssReplies = 0;
  // The mod answers on its own channel family ("shooting_star_demo:spell_fx"
  // carries the cutscene). Watching for those tells us the server really took
  // the shot — it stays quiet when it refuses.
  attachTssWatcher(b._client);
  // Modded dimensions (Backrooms etc.) expose floor blocks the client reads
  // as air/unsolid (or null). prismarine-physics then refuses ground
  // movement and she only air-crawls. Patch block reads: while she's
  // standing (Y steady, not falling), the block directly under her feet is
  // reported as solid so physics gives real walk/sprint.
  try {
    const origBlockAt = b.blockAt.bind(b);
    rawBlockAt = origBlockAt;
    let stoneId = 1;
    try {
      const st = b.registry && b.registry.blocksByName && b.registry.blocksByName.stone;
      if (st) stoneId = st.id;
    } catch (_) {}
    const fakeGround = {
      name: 'stone',
      type: stoneId,
      boundingBox: 'block',
      shapes: [[0, 0, 0, 1, 1, 1]],
      light: 15,
      skyLight: 15,
      biome: null,
    };
    b.blockAt = (pos, extraInfos) => {
      const real = origBlockAt(pos, extraInfos);
      if (!standInMode || !pos) return real;
      try {
        const e = b.entity;
        if (!e || !e.position) return real;
        const bx = Math.floor(pos.x);
        const by = Math.floor(pos.y);
        const bz = Math.floor(pos.z);
        const feetY = Math.floor(e.position.y - 0.5);
        if (bx === Math.floor(e.position.x) && by === feetY && bz === Math.floor(e.position.z)) {
          // Keep real solids and liquids; only stand-in for air/unsolid.
          const hasShapes = real && Array.isArray(real.shapes) && real.shapes.length > 0;
          const solid = real && real.boundingBox && real.boundingBox !== 'empty' && hasShapes;
          const liquid = real && (real.liquid || /water|lava/.test(real.name || ''));
          if (!solid && !liquid) return { ...fakeGround, position: pos };
        }
      } catch (_) {}
      return real;
    };
  } catch (_) {}
  // Ground-state fixer for modded dimensions (runs after each physics tick).
  // The client can't see the modded floor, so it thinks she's falling while
  // the server holds her up — velocity is useless as a signal. Watch Y
  // instead: if her height barely changes for a few ticks, she's standing.
  try {
    b.on('physicsTick', () => {
      try {
        const e = b.entity;
        if (!e || !e.position) return;
        // Dimension changed? Re-detect modded-floor mode from scratch.
        let dim = '';
        try {
          dim = (b.game && b.game.dimension) || '';
        } catch (_) {}
        if (dim !== lastDimension) {
          lastDimension = dim;
          moddedLocked = false;
          standInMode = false;
          groundedGuess = 0;
        }
        const y = e.position.y;
        const yStable = lastStableY !== null && Math.abs(y - lastStableY) < 0.05;
        lastStableY = y;
        // "Supported but the client won't admit it": not on ground, height
        // barely changing, AND the block below her is unreadable/unsolid.
        // The last check stops false positives high up on real blocks.
        let belowSolid = false;
        try {
          const belowBl = rawBlockAt
            ? rawBlockAt(e.position.offset(0, -1, 0), false)
            : b.blockAt(e.position.offset(0, -1, 0), false);
          belowSolid = !!(belowBl && belowBl.boundingBox && belowBl.boundingBox !== 'empty');
        } catch (_) {}
        if (!e.onGround && yStable && !belowSolid) {
          groundedGuess += 1;
        } else {
          groundedGuess = 0;
        }
        if (!moddedLocked && groundedGuess >= 3) {
          moddedLocked = true;
          mcLog('modded-floor mode ON (client cannot read this dimension\'s floor) — using direct steering');
        }
        if (moddedLocked) {
          standInMode = true;
          if (!e.onGround) {
            e.onGround = true;
            groundFixActive = true;
          }
        } else {
          standInMode = false;
          groundFixActive = false;
        }
        // Direct-drive velocity: only in modded dims while steering.
        if (moddedLocked && directSteerActive && directSteerTarget && e.velocity) {
          const dx = directSteerTarget.x - e.position.x;
          const dz = directSteerTarget.z - e.position.z;
          const d = Math.hypot(dx, dz) || 1;
          if (d > 2) {
            const sp = 0.216; // ~4.3 m/s
            e.velocity.x = (dx / d) * sp;
            e.velocity.z = (dz / d) * sp;
            // Hop over anything solid directly ahead.
            try {
              const yaw = e.yaw || 0;
              const fx = Math.round(-Math.sin(yaw));
              const fz = Math.round(-Math.cos(yaw));
              const ahead = rawBlockAt
                ? rawBlockAt(e.position.offset(fx, 0, fz), false)
                : b.blockAt(e.position.offset(fx, 0, fz), false);
              const aheadSolid = !!(ahead && ahead.boundingBox && ahead.boundingBox !== 'empty');
              if (aheadSolid && e.onGround) e.velocity.y = 0.42;
            } catch (_) {}
          }
        }
      } catch (_) {}
    });
  } catch (_) {}
  try {
    const { pathfinder, Movements } = require('mineflayer-pathfinder');
    b.loadPlugin(pathfinder);
    try {
      b.loadPlugin(require('mineflayer-collectblock').plugin);
    } catch (_) {}
    b.once('spawn', () => {
      try {
        const mcData = require('minecraft-data')(b.version);
        const moves = new Movements(b, mcData);
        // No pathfinder digging: it tunnels straight down to reach targets.
        // She breaks blocks deliberately (mineSingle / stuck recovery) instead.
        moves.canDig = false;
        moves.canOpenDoors = true;
        try {
          const scaf = ['dirt', 'cobblestone', 'oak_log', 'birch_log', 'spruce_log', 'sand', 'gravel', 'netherrack'];
          for (const n of scaf) {
            const it = mcData.itemsByName && mcData.itemsByName[n];
            if (it && Array.isArray(moves.scafoldingBlocks) && !moves.scafoldingBlocks.includes(it.id)) {
              moves.scafoldingBlocks.push(it.id);
            }
          }
        } catch (_) {}
        b.pathfinder.setMovements(moves);
      } catch (_) {}
      setStatus('online', `in game as ${b.username}`);
      // Arms check: if any chopping dependency failed to load, say so NOW
      // instead of failing every collect silently forever.
      try {
        const missing = [];
        if (!b.collectBlock) missing.push('collect');
        if (!b.pathfinder || !b.pathfinder.movements) missing.push('movements');
        if (missing.length) {
          try {
            console.warn(`[mc-bot] missing arm parts: ${missing.join(',')}`);
          } catch (_) {}
          setStatus('online', `in game as ${b.username} (arms missing: ${missing.join(',')})`);
        }
      } catch (_) {}
      startBrainLoop();
      mcLog(`spawned as ${b.username} on ${b.version} (dim ${(() => { try { return b.game && b.game.dimension; } catch (_) { return '?'; } })()})`);
      if (opts.follow && followPlayer(opts.follow)) {
        try {
          b.chat(`Hi ${following}! I'm here~`);
        } catch (_) {}
      }
    });
  } catch (_) {}
  b.on('chat', (username, message) => {
    handleChat(username, message).catch(() => {});
  });
  b.on('death', () => {
    guardTarget = null;
    bodyguard = null;
    // Hunt contracts survive death (dragon fights need that) — only the
    // detached job token resets so the respawned body picks the job up.
    combatGen += 1;
    combatBusy = false;
    lootBusy = false;
    wornArmor = { head: -1, torso: -1, legs: -1, feet: -1 };
    try {
      if (guardMode && bot) bot.chat('Ow… I\'ll get them next time!');
    } catch (_) {}
    // Auto-respawn a few seconds later — otherwise she lies there forever.
    setTimeout(() => {
      try {
        if (bot) bot.respawn();
      } catch (_) {}
    }, 2500);
  });
  // Tit-for-tat ledger: whoever hurts her gets it back, hit for hit.
  // Players count only if they swung an arm within ~1.5s (so fire, breath,
  // and poison ticks don't frame innocent bystanders). Mobs count within
  // 3m. Passives and unknowns are never blamed.
  b.on('entitySwingArm', (entity) => {
    try {
      if (entity && entity.type === 'player' && entity.username) {
        lastSwing.set(entity.username, Date.now());
      }
    } catch (_) {}
  });
  b.on('entityHurt', (entity) => {
    try {
      if (!bot || !bot.entity) return;
      // Self hit: tit-for-tat ledger (players need a fresh arm-swing).
      if (entity === bot.entity) {
        const now = Date.now();
        let best = null;
        let bestDist = 3;
        for (const id of Object.keys(bot.entities || {})) {
          const e = bot.entities[id];
          if (!e || e === bot.entity) continue;
          const isPlayer = e.type === 'player' || !!e.username;
          if (isPlayer) {
            const swung = lastSwing.get(e.username) || 0;
            if (now - swung > 1500) continue;
          } else {
            const key = mobKey(e);
            if (PASSIVES.has(key) || !key) continue;
          }
          let d = 99;
          try {
            d = e.position.distanceTo(bot.entity.position);
          } catch (_) {
            continue;
          }
          if (d < bestDist) {
            bestDist = d;
            best = isPlayer ? `player:${e.username}` : `mob:${id}`;
          }
        }
        if (!best) return;
        debts.set(best, Math.min(5, (debts.get(best) || 0) + 1));
        return;
      }
      // Someone ELSE got hit: if it's a player near her, bodyguard up —
      // find the mob that did it (mobs only, never other players' fights).
      const isVictimPlayer = entity.type === 'player' || !!entity.username;
      if (!isVictimPlayer) return;
      let vpos = null;
      try {
        vpos = entity.position;
      } catch (_) {
        return;
      }
      let bdist = 999;
      try {
        bdist = vpos.distanceTo(bot.entity.position);
      } catch (_) {
        return;
      }
      if (bdist > 25) return;
      let culprit = null;
      let cdist = 5;
      for (const id of Object.keys(bot.entities || {})) {
        const e = bot.entities[id];
        if (!e || e === bot.entity || e === entity) continue;
        const key = mobKey(e);
        if (PASSIVES.has(key) || !key) continue;
        if (e.type === 'player' || e.username) continue;
        let d = 99;
        try {
          d = e.position.distanceTo(vpos);
        } catch (_) {
          continue;
        }
        if (d < cdist) {
          cdist = d;
          culprit = id;
        }
      }
      if (!culprit) return;
      const vname = entity.username || 'friend';
      if (!bodyguard || bodyguard.id !== culprit) {
        bodyguard = { id: culprit, victim: vname, until: Date.now() + 30000, announced: false };
      } else {
        bodyguard.until = Date.now() + 30000;
      }
    } catch (_) {}
  });
  b.on('playerCollect', () => {
    // Fresh loot — check for armor upgrades on the next brain tick.
    armorAt = 0;
  });
  b.on('kicked', (reason) => {
    if (myGen !== startGen) return;
    let detail = 'kicked';
    try {
      detail = String((reason && reason.text) || JSON.stringify(reason) || 'kicked').slice(0, 160);
    } catch (_) {}
    lastErr = detail;
    setStatus('offline', detail);
    scheduleReconnect();
  });
  b.on('error', (err) => {
    if (myGen !== startGen) return;
    // Mineflayer can emit 'error' twice for one failed connect — only report
    // the first, or the status flickers offline mid-fallback.
    if (errorReportedGen === myGen) return;
    errorReportedGen = myGen;
    lastErr = friendlyNetError(err);
    try {
      console.warn('[mc-bot]', lastErr);
    } catch (_) {}
    // Can't reach this host? If another candidate exists (e.g. loopback for a
    // LAN address this PC owns), hop to it immediately instead of waiting out
    // a full TCP timeout.
    if (nextHostCandidate(err)) {
      fallbackPending = true;
      setStatus('connecting', `retrying over ${hostCandidates[hostCandidateIdx]}:${createOpts.port}`);
      setTimeout(() => {
        if (myGen !== startGen) return;
        fallbackPending = false;
        clearRetry();
        startBot();
      }, 250);
      return;
    }
    if (statusState.state === 'online' || statusState.state === 'connecting') {
      setStatus('offline', lastErr);
    }
  });
  b.on('end', () => {
    if (myGen !== startGen) return;
    // A fallback attempt is already on its way — don't queue a reconnect
    // that would kill the fresh connection.
    if (fallbackPending) return;
    if (statusState.state !== 'off') setStatus('offline', lastErr || 'disconnected');
    scheduleReconnect();
  });
}

// Advance to the next host candidate if the failure was a connection-level
// problem (refused/timeout/unreachable). Returns true if a new candidate is
// now selected.
function nextHostCandidate(err) {
  if (hostCandidateIdx >= hostCandidates.length - 1) return false;
  const raw = String((err && err.message) || err || '');
  const code = String((err && err.code) || '');
  const retryable =
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    /timed out|etime|econnrefused|ehostunreach|enetunreach/i.test(raw);
  if (!retryable) return false;
  hostCandidateIdx += 1;
  return true;
}

function connect(opts = {}, hooks = {}) {
  clearRetry();
  const sameTarget = currentOpts && bot
    && (statusState.state === 'online' || statusState.state === 'connecting')
    && String(currentOpts.host || '') === String(opts.host || '')
    && Number(currentOpts.port || 0) === Number(opts.port || 0)
    && String(currentOpts.username || '') === String(opts.username || '');
  const wantHost = String(opts.host || '').trim() || 'localhost';
  // If the host is one of THIS PC's own addresses, try 127.0.0.1 FIRST: the
  // Windows Firewall blocks inbound on the LAN adapter (default "Public"
  // profile), so the LAN address times out even though the server is right
  // there. Loopback reaches the same server and is never filtered.
  hostCandidates = isOwnLocalAddress(wantHost) ? ['127.0.0.1', wantHost] : [wantHost];
  hostCandidateIdx = 0;
  currentOpts = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    auth: opts.auth || 'offline',
    follow: String(opts.follow || '').trim(),
    chatty: opts.chatty !== false,
    autoReconnect: opts.autoReconnect !== false,
    wantStop: false,
  };
  currentHooks = hooks || {};
  if (currentOpts.follow) following = currentOpts.follow;
  lastErr = '';
  if (sameTarget) {
    // Already on this server — just re-aim, don't spawn a twin.
    if (currentOpts.follow) followPlayer(currentOpts.follow);
    return status();
  }
  setStatus('connecting', `${currentOpts.host || 'localhost'}:${currentOpts.port || 25565}`);
  startBot();
  return status();
}

function disconnect() {
  clearRetry();
  stopBrainLoop();
  guardMode = false;
  guardTarget = null;
  bodyguard = null;
  huntOrder = null;
  huntResolved = false;
  taskBusy = false;
  combatGen += 1;
  combatBusy = false;
  lootBusy = false;
  stayPut = false;
  debts.clear();
  lastSwing.clear();
  if (currentOpts) currentOpts.wantStop = true;
  try {
    if (bot) bot.quit();
  } catch (_) {}
  try {
    if (bot) bot.end();
  } catch (_) {}
  bot = null;
  following = '';
  setStatus('off', '');
  return status();
}

function say(text) {
  const clean = String(text || '').trim().slice(0, 200);
  if (!clean || !bot) return false;
  try {
    bot.chat(clean);
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { connect, disconnect, say, status };
