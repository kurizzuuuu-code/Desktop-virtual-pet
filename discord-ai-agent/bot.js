'use strict';

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ChannelType,
} = require('discord.js');
const { GoogleGenAI, Type } = require('@google/genai');
const axios = require('axios');
const cron = require('node-cron');
const { buildSystemInstruction, FREE_TIER_MODELS, preferFreeModel } = require('./defaults');

const MAX_DISCORD_LENGTH = 2000;
const MAX_TOOL_ROUNDS = 3;

function errorText(error) {
  return String(error?.message || error || '');
}

function httpStatus(error) {
  const text = errorText(error);
  if (error?.status != null) return error.status;
  if (error?.response?.status != null) return error.response.status;
  if (text.includes('"code":429')) return 429;
  return undefined;
}

function isZeroFreeTierQuota(error) {
  const text = errorText(error);
  return /free_tier/i.test(text) && /limit:\s*0/i.test(text);
}

function isQuotaError(error) {
  return httpStatus(error) === 429 || /RESOURCE_EXHAUSTED/i.test(errorText(error));
}

function retryDelayMs(error, attempt) {
  const match = errorText(error).match(/retry in ([0-9.]+)s/i);
  if (match) return Math.min(15000, Math.ceil(Number(match[1]) * 1000));
  return Math.min(8000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
}

function withRetries(fn, label, log, attempts = 3) {
  return (async () => {
    let lastError;
    for (let i = 0; i < attempts; i += 1) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const status = httpStatus(error);
        const retryable = status === 429 || status === 503 || status === 500;
        log(`[${label}] attempt ${i + 1}/${attempts} failed: ${errorText(error)}`);
        if (isZeroFreeTierQuota(error)) break;
        if (!retryable || i === attempts - 1) break;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(error, i)));
      }
    }
    throw lastError;
  })();
}

function splitForDiscord(text) {
  if (!text) return [];
  if (text.length <= MAX_DISCORD_LENGTH) return [text];

  const chunks = [];
  let remaining = text;
  while (remaining.length > MAX_DISCORD_LENGTH) {
    let slice = remaining.slice(0, MAX_DISCORD_LENGTH);
    const lastBreak = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf(' '));
    if (lastBreak > 200) slice = slice.slice(0, lastBreak);
    chunks.push(slice);
    remaining = remaining.slice(slice.length).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function composeReply(text, gifUrl) {
  const body = text || 'whatever. brain empty. pizza later.';
  if (!gifUrl) return body;
  if (body.includes(gifUrl)) return body;
  const combined = `${body}\n${gifUrl}`;
  if (combined.length <= MAX_DISCORD_LENGTH) return combined;
  return `${body.slice(0, MAX_DISCORD_LENGTH - gifUrl.length - 1)}\n${gifUrl}`;
}

class DiscordAiAgent {
  constructor({ getSettings, log = console.log } = {}) {
    this.getSettings = getSettings;
    this.log = (message) => log(String(message));
    this.client = null;
    this.ai = null;
    this.chatSessions = new Map();
    this.userCooldowns = new Map();
    this.cronTask = null;
    this.running = false;
    this.botTag = '';
    this.messageHandler = null;
    this.errorHandler = null;
    this.unavailableModels = new Set();
  }

  getStatus() {
    return {
      running: this.running,
      botTag: this.botTag,
    };
  }

  resetMemory() {
    this.chatSessions.clear();
  }

  modelCandidates(settings) {
    const preferred = preferFreeModel(settings.model);
    return [preferred, ...FREE_TIER_MODELS.filter((model) => model !== preferred)].filter(
      (model) => !this.unavailableModels.has(model),
    );
  }

  async withModelFallback(settings, runForModel) {
    const models = this.modelCandidates(settings);
    if (!models.length) {
      throw new Error(
        'No Gemini free-tier models left to try. Check https://ai.dev/rate-limit — Flash daily quota may be used up.',
      );
    }

    let lastError;
    for (let i = 0; i < models.length; i += 1) {
      const model = models[i];
      try {
        return await runForModel(model);
      } catch (error) {
        lastError = error;
        if (!isQuotaError(error) && httpStatus(error) !== 404) throw error;
        this.unavailableModels.add(model);
        this.chatSessions.clear();
        const next = models[i + 1];
        this.log(
          `[gemini] ${model} is blocked on this API key (${
            isZeroFreeTierQuota(error)
              ? 'free-tier quota is 0 or used up for this model'
              : 'quota or model unavailable'
          }). ${next ? `Falling back to ${next}…` : 'No fallback models left.'}`,
        );
      }
    }
    throw lastError;
  }

  fetchGifDeclaration() {
    return {
      name: 'fetch_gif',
      description:
        'Search Tenor for a GIF (pizza, cats, reactions) and return a URL to embed in Discord.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          search_term: {
            type: Type.STRING,
            description: 'Short Tenor query, e.g. "grumpy cat pizza", "eye roll".',
          },
        },
        required: ['search_term'],
      },
    };
  }

  thinkingConfig(settings) {
    const level = String(settings.thinkingLevel || 'high').toLowerCase();
    return { thinkingConfig: { thinkingLevel: level } };
  }

  getChatConfig(settings) {
    return {
      systemInstruction: buildSystemInstruction(settings),
      temperature: Number(settings.temperature) || 1,
      maxOutputTokens: Number(settings.maxOutputTokens) || 512,
      tools: [{ functionDeclarations: [this.fetchGifDeclaration()] }],
      automaticFunctionCalling: { disable: true },
      ...this.thinkingConfig(settings),
    };
  }

  async start() {
    if (this.running) return this.getStatus();

    const settings = this.getSettings();
    if (!settings.discordToken || !settings.geminiApiKey) {
      throw new Error('Discord token and Gemini API key are required.');
    }

    process.env.GEMINI_API_KEY = settings.geminiApiKey;
    if (!process.env.GOOGLE_API_KEY) {
      process.env.GOOGLE_API_KEY = settings.geminiApiKey;
    }

    this.ai = new GoogleGenAI({});
    this.unavailableModels.clear();
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel, Partials.Message],
    });

    this.messageHandler = (message) => this.onMessage(message);
    this.errorHandler = (error) => this.log(`[discord] client error: ${error?.message || error}`);

    this.client.once(Events.ClientReady, (readyClient) => {
      this.botTag = readyClient.user.tag;
      this.log(`Logged in as ${this.botTag}`);
      this.scheduleIntervalPost();
    });
    this.client.on(Events.MessageCreate, this.messageHandler);
    this.client.on(Events.Error, this.errorHandler);

    try {
      await this.client.login(settings.discordToken);
      this.running = true;
      return this.getStatus();
    } catch (error) {
      await this.cleanupClient();
      throw error;
    }
  }

  async stop() {
    await this.cleanupClient();
    this.running = false;
    this.botTag = '';
    this.resetMemory();
    this.log('Bot stopped.');
    return this.getStatus();
  }

  async cleanupClient() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }
    if (this.client) {
      this.client.removeAllListeners();
      try {
        await this.client.destroy();
      } catch (error) {
        this.log(`[discord] destroy failed: ${error?.message || error}`);
      }
    }
    this.client = null;
    this.ai = null;
  }

  applyLiveSettings() {
    this.resetMemory();
    this.unavailableModels.clear();
    if (this.running) this.scheduleIntervalPost();
  }

  getChat(sessionKey, settings, model) {
    const maxTurns = Number(settings.maxHistoryTurns) || 40;
    const existing = this.chatSessions.get(sessionKey);
    if (existing && existing.turns < maxTurns && existing.model === model) return existing.chat;

    const chat = this.ai.chats.create({
      model,
      config: this.getChatConfig(settings),
    });
    this.chatSessions.set(sessionKey, { chat, turns: 0, model });
    return chat;
  }

  async fetchGif(searchTerm, settings) {
    const key = (settings.tenorApiKey || '').trim();
    if (!key) return { ok: false, error: 'TENOR_API_KEY is not set.' };

    try {
      const response = await withRetries(
        () =>
          axios.get('https://tenor.googleapis.com/v2/search', {
            params: {
              q: searchTerm,
              key,
              client_key: 'discord-ai-agent',
              limit: 1,
              media_filter: 'gif',
            },
            timeout: 8000,
          }),
        'tenor',
        this.log,
      );

      const result = response.data?.results?.[0];
      const url =
        result?.media_formats?.gif?.url ||
        result?.media_formats?.mediumgif?.url ||
        result?.media_formats?.tinygif?.url ||
        result?.url;

      if (!url) return { ok: false, error: 'No GIF found.' };
      return { ok: true, url, search_term: searchTerm };
    } catch (error) {
      this.log(`[tenor] fetch_gif failed: ${error?.message || error}`);
      return { ok: false, error: 'Tenor request failed.' };
    }
  }

  async runChatTurn(chat, userText, settings) {
    const toolResults = [];
    let response = await withRetries(
      () => chat.sendMessage({ message: userText }),
      'gemini-chat',
      this.log,
    );

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const calls = response.functionCalls;
      if (!calls || calls.length === 0) break;

      const functionResponseParts = [];
      for (const call of calls) {
        const args = call.args || {};
        let payload = { ok: false, error: `Unknown tool: ${call.name}` };

        if (call.name === 'fetch_gif') {
          const term = String(args.search_term || args.query || '').trim();
          payload = term
            ? await this.fetchGif(term, settings)
            : { ok: false, error: 'Missing search_term.' };
          toolResults.push(payload);
        }

        functionResponseParts.push({
          functionResponse: {
            name: call.name,
            id: call.id,
            response: payload,
          },
        });
      }

      response = await withRetries(
        () => chat.sendMessage({ message: functionResponseParts }),
        'gemini-tool-followup',
        this.log,
      );
    }

    const gifUrl = toolResults.find((result) => result?.ok && result.url)?.url || null;
    return { text: (response.text || '').trim(), gifUrl };
  }

  async shouldReply(message, settings) {
    if (message.author.bot || message.system) return false;
    if (settings.replyInDm && message.channel.type === ChannelType.DM) return true;
    if (settings.replyOnMention && message.mentions.has(this.client.user)) return true;
    if (!settings.replyOnReply || !message.reference?.messageId) return false;
    if (message.mentions.repliedUser?.id === this.client.user.id) return true;

    try {
      const referenced = await message.fetchReference();
      return referenced.author?.id === this.client.user.id;
    } catch (error) {
      this.log(`[discord] could not fetch referenced message: ${error?.message || error}`);
      return false;
    }
  }

  async onMessage(message) {
    const settings = this.getSettings();
    try {
      if (!(await this.shouldReply(message, settings))) return;

      const cooldownMs = Number(settings.cooldownMs) || 0;
      const last = this.userCooldowns.get(message.author.id) || 0;
      if (Date.now() - last < cooldownMs) return;
      this.userCooldowns.set(message.author.id, Date.now());

      await message.channel.sendTyping();

      const sessionKey = `${message.channel.id}:${message.author.id}`;
      const displayName = message.member?.displayName || message.author.username;
      const isOwner = settings.ownerUserId && message.author.id === String(settings.ownerUserId);
      const cleaned = message.content
        .replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '')
        .trim();
      const prompt = `[${displayName}${isOwner ? ' | OWNER YOU DISLIKE' : ''} | id:${message.author.id}]: ${
        cleaned || '(sent a mention with no extra text)'
      }`;

      const { text, gifUrl } = await this.withModelFallback(settings, (model) => {
        const chat = this.getChat(sessionKey, settings, model);
        return this.runChatTurn(chat, prompt, settings);
      });
      const entry = this.chatSessions.get(sessionKey);
      if (entry) entry.turns += 1;

      const reply = composeReply(text, gifUrl);
      const allowedMentions = {
        repliedUser: true,
        parse: [],
        users: settings.ownerUserId ? [String(settings.ownerUserId)] : [],
      };
      for (const chunk of splitForDiscord(reply)) {
        await message.reply({ content: chunk, allowedMentions });
      }
    } catch (error) {
      this.log(`[discord] message handler failed: ${error?.message || error}`);
      try {
        await message.reply({
          content: isQuotaError(error)
            ? 'free Gemini quota is used up. wait a bit or try another Flash model in Features.'
            : settings.fallbackReply || 'try again, clown.',
          allowedMentions: { parse: [] },
        });
      } catch (replyError) {
        this.log(`[discord] fallback reply failed: ${replyError?.message || replyError}`);
      }
    }
  }

  scheduleIntervalPost() {
    if (this.cronTask) {
      this.cronTask.stop();
      this.cronTask = null;
    }

    const settings = this.getSettings();
    if (!settings.scheduledEnabled) {
      this.log('[cron] interval posts disabled');
      return;
    }

    const minutes = Math.min(59, Math.max(1, Number(settings.scheduleEveryMinutes) || 30));
    const expression = `*/${minutes} * * * *`;

    if (!cron.validate(expression)) {
      this.log(`[cron] invalid schedule: ${expression}`);
      return;
    }

    this.cronTask = cron.schedule(expression, () => this.postIntervalUpdate());
    this.log(`[cron] posting every ${minutes} minute(s)`);
  }

  async postIntervalUpdate() {
    const settings = this.getSettings();
    this.log('[cron] generating interval update…');
    try {
      if (!settings.targetChannelId) {
        this.log('[cron] no target channel ID set');
        return;
      }
      const channel = await this.client.channels.fetch(settings.targetChannelId);
      if (!channel || !channel.isTextBased()) {
        this.log(`[cron] channel ID is not a text channel: ${settings.targetChannelId}`);
        return;
      }

      const ownerPing = settings.ownerUserId ? `<@${settings.ownerUserId}>` : 'the so-called owner';
      const gifSearch = Math.random() < 0.5 ? 'pizza' : 'cat meme';
      const gif = await this.fetchGif(gifSearch, settings);

      const response = await this.withModelFallback(settings, (model) =>
        withRetries(
          () =>
            this.ai.models.generateContent({
              model,
              contents: `Write a unique unsolicited Discord message. Roast ${ownerPing}. Talk about pizza and/or cats. Stay in character. 1–3 sentences. Do not use a GIF tool.`,
              config: {
                systemInstruction: buildSystemInstruction(settings),
                temperature: Math.min(1.4, (Number(settings.temperature) || 1) + 0.15),
                maxOutputTokens: 256,
                ...this.thinkingConfig(settings),
              },
            }),
          'gemini-interval',
          this.log,
        ),
      );

      const thought =
        (response.text || '').trim() ||
        `${ownerPing} still here? embarrassing. i want pizza and a cat.`;
      const allowedMentions = {
        parse: [],
        users: settings.ownerUserId ? [String(settings.ownerUserId)] : [],
      };
      await channel.send({
        content: splitForDiscord(composeReply(thought, gif.ok ? gif.url : null))[0],
        allowedMentions,
      });
      this.log('[cron] interval update posted');
    } catch (error) {
      this.log(`[cron] interval post failed: ${error?.message || error}`);
    }
  }
}

module.exports = { DiscordAiAgent };
