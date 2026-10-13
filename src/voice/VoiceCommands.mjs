/**
 * @module src/voice/VoiceCommands
 * @description Comenzi vocale pentru Dj Mitica.
 *
 * Botul asculta (prin LiveKit) vocea fiecarui participant din canalul de voce
 * in care se afla, detecteaza cand cineva vorbeste (VAD simplu pe energie),
 * trimite fraza la un server Whisper (container "whisper" din docker-compose)
 * si, daca textul incepe cu cuvantul de activare ("dj"), executa comanda
 * exact ca si cum utilizatorul ar fi scris-o in chat:
 *
 *     "DJ, skip"                   -> %skip
 *     "DJ play despacito"          -> %play despacito
 *     "DJ volume fifty"            -> %volume 50
 *
 * Configurare in config.json (toate optionale):
 *   "voiceCommands": {
 *     "enabled": true,
 *     "whisperUrl": "http://whisper:9000",
 *     "language": "en",
 *     "wakeWord": "dj",
 *     "requireWakeWord": true,
 *     "echo": true,               // posteaza "🎙️ @user: %comanda" in chat
 *     "allowedUsers": [],         // gol = toata lumea
 *     "blockedCommands": [...],   // comenzi care NU se pot da vocal
 *     "energyThreshold": 700,     // sensibilitate VAD (mai mic = mai sensibil)
 *     "silenceMs": 900,           // cat tacere inseamna "am terminat fraza"
 *     "minSpeechMs": 400,
 *     "maxSpeechMs": 12000,
 *     "debug": false
 *   }
 */

import { getVoiceManager } from "@fluxerjs/voice";
import { logger } from "../core/Logger.mjs";
import { Message } from "../ui/Wrappers.mjs";
import { cleanId } from "../utils/Utils.mjs";

const TAG = "[VoiceCmd]";
const IN_RATE = 48000;
const OUT_RATE = 16000;

const DEFAULTS = {
  enabled: true,
  whisperUrl: "http://whisper:9000",
  language: "en",
  wakeWord: "dj",
  requireWakeWord: true,
  echo: true,
  allowedUsers: [],
  blockedCommands: ["eval", "reload", "debug", "logtest", "test", "servers", "settings", "forceleave"],
  energyThreshold: 700,
  silenceMs: 900,
  minSpeechMs: 250,
  maxSpeechMs: 12000,
  preRollMs: 300,
  requestTimeoutMs: 20000,
  debug: false,
};

/** Cuvinte auzite gresit des de Whisper -> numele real al comenzii. */
const HOMOPHONES = {
  paws: "pause", pours: "pause", pose: "pause", pauses: "pause", paused: "pause",
  skipped: "skip", skips: "skip", skipping: "skip",
  resumed: "resume", resumes: "resume",
  played: "play", plays: "play", playing: "play",
  leaves: "leave", leaving: "leave", leave: "leave",
  shuffled: "shuffle", shuffles: "shuffle",
  looped: "loop", loops: "loop", loupe: "loop",
  cleared: "clear", clears: "clear",
  joined: "join", joins: "join",
  volumes: "volume",
  pray: "play", plate: "play", place: "play", people: "play", clay: "play", blay: "play", plait: "play",
  skeep: "skip", script: "skip", skit: "skip", kip: "skip",
  posts: "pause", paused: "pause", pass: "pause",
};

/**
 * Cum aude Whisper des unele cuvinte de activare. Cheia = cuvantul de activare
 * (normalizat), valoarea = variante acceptate in plus fata de potrivirea aproximativa.
 */
const WAKE_VARIANTS = {
  dj: ["dj", "deejay", "djay", "dejay", "dijay", "teejay", "djs", "dee", "deej"],
  mitica: ["mitica", "mitika", "metica", "meteca", "mitikah", "mitica's", "meticka", "mitikka"],
  djmitica: ["djmitica", "djmitika", "deejaymitica", "deejaymitika", "djmetica"],
};

/** Comenzi la care argumentele "fifty" / "two" se transforma in cifre. */
const NUMERIC_COMMANDS = new Set(["volume", "remove", "move", "seek", "volumedefault", "skip"]);

const WAKE_PREFIXES = new Set(["hey", "hi", "ok", "okay", "yo", "hello", "please"]);

/* ------------------------------------------------------------------ utils */

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

function norm(word) {
  return String(word ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "one hundred fifty" -> "150", "fifty percent" -> "50". Lasa restul neschimbat. */
function wordsToNumbers(tokens) {
  const out = [];
  let acc = null;
  const flush = () => { if (acc !== null) { out.push(String(acc)); acc = null; } };
  for (const t of tokens) {
    const w = norm(t);
    if (w === "percent" || w === "per" || w === "cent" || (w === "and" && acc !== null)) continue;
    if (acc === null && (w === "to" || w === "at")) continue;
    if (/^\d+$/.test(w)) { flush(); out.push(w); continue; }
    if (w in SMALL) { acc = (acc ?? 0) + SMALL[w]; continue; }
    if (w in TENS) { acc = (acc ?? 0) + TENS[w]; continue; }
    if (w === "hundred") { acc = (acc ?? 1) * 100; continue; }
    flush();
    out.push(t);
  }
  flush();
  return out;
}

/** PCM int16 48 kHz mono -> WAV 16 kHz mono. */
function toWav16k(chunks, totalSamples) {
  const pcm48 = new Int16Array(totalSamples);
  let off = 0;
  for (const c of chunks) { pcm48.set(c, off); off += c.length; }
  const outLen = Math.floor(totalSamples / 3);
  const buf = Buffer.alloc(44 + outLen * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + outLen * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(OUT_RATE, 24); buf.writeUInt32LE(OUT_RATE * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(outLen * 2, 40);
  for (let i = 0; i < outLen; i++) {
    const s = (pcm48[i * 3] + pcm48[i * 3 + 1] + pcm48[i * 3 + 2]) / 3;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s))), 44 + i * 2);
  }
  return buf;
}

function rms(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/* ---------------------------------------------------------------- service */

export class VoiceCommands {
  /** @param {import('../core/Bot.mjs').DjMitica} djmitica */
  constructor(djmitica) {
    this.djmitica = djmitica;
    this.cfg = { ...DEFAULTS, ...(djmitica.config?.voiceCommands ?? {}) };
    this.enabled = this.cfg.enabled !== false && !!djmitica.config?.voiceCommands;
    /** @type {WeakSet<object>} conexiuni la care am pus listener de audioFrame */
    this._conns = new WeakSet();
    /** @type {WeakSet<object>} camere LiveKit la care am pus listener de track */
    this._rooms = new WeakSet();
    /** @type {Map<string, object>} participantId -> stare VAD */
    this._speakers = new Map();
    /** @type {Map<string, number>} userId -> pana cand asteptam comanda dupa cuvantul de activare spus singur */
    this._armed = new Map();
    this._queue = Promise.resolve();
    this._queued = 0;
    this._timer = null;
    // Botul trebuie sa NU fie "deafened" ca sa primeasca audio.
    globalThis.__djmiticaVoiceCommands = this.enabled;
  }

  get client() { return this.djmitica.client; }

  dbg(...a) { if (this.cfg.debug) logger.info(TAG, ...a); }

  start() {
    if (!this.enabled) {
      logger.info(TAG, "Dezactivat (lipseste/enabled=false in config.voiceCommands).");
      return this;
    }
    logger.info(TAG, `Activ. Whisper: ${this.cfg.whisperUrl} | wake word: "${this.cfg.wakeWord}" (obligatoriu: ${this.cfg.requireWakeWord})`);
    this._timer = setInterval(() => this._scan(), 1000);
    this._timer.unref?.();
    return this;
  }

  /** Cauta conexiuni LiveKit noi (sau camere reconectate) si se ataseaza la ele. */
  _scan() {
    let vm;
    try { vm = getVoiceManager(this.client); } catch { return; }
    const conns = vm?.connections;
    if (!conns) return;
    for (const conn of conns.values()) {
      try { this._attach(conn); } catch (e) { logger.warn(TAG, "attach error:", e?.message); }
    }
  }

  _attach(conn) {
    if (typeof conn?.subscribeParticipantTrack !== "function") return; // doar LiveKit
    if (!this._conns.has(conn)) {
      this._conns.add(conn);
      conn.on("audioFrame", (f) => this._onFrame(conn, f));
      this.dbg("atasat la conexiunea canalului", conn.channel?.id);
    }
    const room = conn.room;
    if (!room) return;
    if (!this._rooms.has(room)) {
      this._rooms.add(room);
      room.on("trackSubscribed", (track, _pub, participant) => this._sub(conn, participant, track));
      room.on("participantDisconnected", (participant) => this._speakers.delete(participant?.identity));
    }
    // Biblioteca de voce sterge abonamentele de ascultare la fiecare stop()
    // (skip / melodie noua), asa ca verificam mereu si ne reabonam.
    for (const participant of room.remoteParticipants?.values?.() ?? []) {
      if (conn.receiveSubscriptions?.has?.(participant.identity)) continue;
      for (const pub of participant.trackPublications?.values?.() ?? []) {
        if (pub.track && conn.isAudioTrack?.(pub.track)) { this._sub(conn, participant, pub.track); break; }
      }
    }
  }

  _sub(conn, participant, track) {
    try {
      if (!conn.isAudioTrack?.(track)) return;
      conn.subscribeParticipantTrack(participant, track, { autoSubscribe: true });
      this.dbg("ascult pe", participant?.identity);
    } catch (e) { logger.warn(TAG, "subscribe error:", e?.message); }
  }

  /* ------------------------------------------------------------- VAD */

  _onFrame(conn, f) {
    const id = f.participantId;
    if (!id || !f.samples?.length) return;
    let st = this._speakers.get(id);
    if (!st) {
      st = { speaking: false, chunks: [], samples: 0, pre: [], preSamples: 0, silentMs: 0, speechMs: 0,
             diagAt: Date.now(), diagFrames: 0, diagPeak: 0 };
      this._speakers.set(id, st);
      logger.info(TAG, `primesc audio de la ${id} (rate=${f.sampleRate}, ch=${f.channels}, ${f.samples.length} samples/frame)`);
    }
    const frameMs = (f.samples.length / (f.sampleRate || IN_RATE)) * 1000;
    const level = rms(f.samples);
    const loud = level >= this.cfg.energyThreshold;

    // diagnostic: nivelul maxim al vocii la fiecare 3 secunde (doar cu debug)
    st.diagFrames++; if (level > st.diagPeak) st.diagPeak = level;
    if (this.cfg.debug && Date.now() - st.diagAt >= 3000) {
      if (st.diagPeak >= 50) this.dbg(`nivel ${id}: max=${Math.round(st.diagPeak)} (prag=${this.cfg.energyThreshold}), cadre=${st.diagFrames}`);
      st.diagAt = Date.now(); st.diagFrames = 0; st.diagPeak = 0;
    }
    const copy = Int16Array.from(f.samples);

    if (!st.speaking) {
      st.pre.push(copy); st.preSamples += copy.length;
      const maxPre = (this.cfg.preRollMs / 1000) * IN_RATE;
      while (st.preSamples > maxPre && st.pre.length > 1) st.preSamples -= st.pre.shift().length;
      if (!loud) return;
      st.speaking = true;
      st.chunks = st.pre; st.samples = st.preSamples;
      st.pre = []; st.preSamples = 0; st.silentMs = 0; st.speechMs = 0;
      this.dbg(`incepe fraza (${id})`);
      return;
    }

    st.chunks.push(copy); st.samples += copy.length;
    if (loud) { st.speechMs += frameMs; st.silentMs = 0; } else st.silentMs += frameMs;

    const totalMs = (st.samples / IN_RATE) * 1000;
    if (st.silentMs >= this.cfg.silenceMs || totalMs >= this.cfg.maxSpeechMs) {
      const chunks = st.chunks, samples = st.samples, speechMs = st.speechMs;
      st.speaking = false; st.chunks = []; st.samples = 0; st.silentMs = 0; st.speechMs = 0;
      this.dbg(`sfarsit fraza (${id}): ${Math.round(totalMs)} ms total, ${Math.round(speechMs)} ms voce`);
      if (speechMs < this.cfg.minSpeechMs) { this.dbg("prea scurta, ignor"); return; }
      this._enqueue(conn, id, chunks, samples);
    }
  }

  _enqueue(conn, participantId, chunks, samples) {
    if (this._queued >= 4) { this.dbg("coada plina, ignor fraza"); return; }
    this._queued++;
    this._queue = this._queue
      .then(() => this._handleUtterance(conn, participantId, chunks, samples))
      .catch((e) => logger.warn(TAG, "eroare:", e?.message))
      .finally(() => { this._queued--; });
  }

  /* ------------------------------------------------------ transcriere */

  _prompt() {
    const names = (this.djmitica.handler?.commands ?? []).map((c) => c.name).filter(Boolean).slice(0, 40);
    const w = this.cfg.wakeWord;
    return `${w} play, ${w} skip, ${w} pause, ${w} resume, ${w} volume 50. Commands: ${names.join(", ")}.`;
  }

  async _transcribe(wav) {
    const url = new URL("/asr", this.cfg.whisperUrl);
    url.searchParams.set("task", "transcribe");
    url.searchParams.set("output", "json");
    url.searchParams.set("encode", "true");
    url.searchParams.set("vad_filter", "true");
    if (this.cfg.language) url.searchParams.set("language", this.cfg.language);
    url.searchParams.set("initial_prompt", this._prompt());
    const form = new FormData();
    form.append("audio_file", new Blob([wav], { type: "audio/wav" }), "speech.wav");
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.cfg.requestTimeoutMs);
    try {
      const res = await fetch(url, { method: "POST", body: form, signal: ctl.signal });
      if (!res.ok) throw new Error(`Whisper HTTP ${res.status}`);
      const body = (await res.text()).trim();
      try {
        const j = JSON.parse(body);
        if (j && typeof j === "object") return String(j.text ?? "").trim();
      } catch { /* nu e JSON -> e text simplu */ }
      return body;
    } finally { clearTimeout(t); }
  }

  async _handleUtterance(conn, participantId, chunks, samples) {
    const userId = cleanId(String(participantId).match(/\d{15,22}/)?.[0] ?? participantId);
    if (!userId || userId === cleanId(this.client.user?.id)) return;
    if (this.cfg.allowedUsers?.length && !this.cfg.allowedUsers.map(cleanId).includes(userId)) return;

    const t0 = Date.now();
    this.dbg(`trimit ${Math.round(samples / IN_RATE * 1000)} ms audio la Whisper...`);
    let text;
    try {
      text = await this._transcribe(toWav16k(chunks, samples));
    } catch (e) {
      logger.warn(TAG, "Whisper indisponibil:", e?.name === "AbortError" ? "timeout" : e?.message);
      return;
    }
    this.dbg(`(${Date.now() - t0} ms) ${participantId}: "${text}"`);
    if (!text) return;

    const armed = (this._armed.get(userId) ?? 0) > Date.now();
    const parsed = this._parse(text, armed);
    if (parsed?.wakeOnly) {
      this._armed.set(userId, Date.now() + (this.cfg.armedMs ?? 6000));
      this.dbg(`am auzit "${this.cfg.wakeWord}", astept comanda de la ${userId}...`);
      return;
    }
    this._armed.delete(userId);
    if (!parsed) return;
    logger.info(TAG, `${userId} a spus "${text}" -> ${parsed.command} ${parsed.args.join(" ")}`.trim());
    await this._execute(conn, userId, parsed);
  }

  /* -------------------------------------------------------- parsare */

  _isWake(word) {
    const w = norm(word), target = norm(this.cfg.wakeWord);
    if (!w || !target) return false;
    if (w === target) return true;
    if (WAKE_VARIANTS[target]?.includes(w)) return true;
    return w.length >= 4 && levenshtein(w, target) <= (target.length >= 5 ? 2 : 1);
  }

  /** @returns {{command: string, args: string[]}|null} */
  _parse(text, armed = false) {
    let tokens = String(text).replace(/[“”"]/g, " ").split(/\s+/)
      .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}%']+$/gu, ""))
      .filter(Boolean);
    if (!tokens.length) return null;

    // cuvantul de activare (in primele ~4 cuvinte; accepta si "re mix", "we mix")
    let start = -1;
    for (let i = 0; i < Math.min(tokens.length, 4); i++) {
      if (WAKE_PREFIXES.has(norm(tokens[i])) && start === -1) continue;
      if (this._isWake(tokens[i])) { start = i + 1; break; }
      if (i + 1 < tokens.length && this._isWake(tokens[i] + tokens[i + 1])) { start = i + 2; break; }
    }
    if (start === -1) {
      if (this.cfg.requireWakeWord && !armed) return null;
      start = 0;
    }
    tokens = tokens.slice(start);
    if (!tokens.length) return armed ? null : { wakeOnly: true };

    const names = this.djmitica.handler?.commandNames ?? [];
    let cmdWord = norm(tokens[0]);
    let command = null;
    if (names.includes(cmdWord)) command = cmdWord;
    else if (HOMOPHONES[cmdWord] && names.includes(HOMOPHONES[cmdWord])) command = HOMOPHONES[cmdWord];
    else if (cmdWord.length >= 4) {
      const close = names.filter((n) => n.length >= 4 && levenshtein(n, cmdWord) <= 1);
      if (close.length === 1) command = close[0];
    }
    if (!command) { this.dbg(`comanda necunoscuta: "${tokens[0]}"`); return null; }

    const real = this.djmitica.handler.commands.find((c) => c.aliases?.includes(command));
    if (real && this.cfg.blockedCommands?.includes(real.name)) {
      this.dbg(`comanda blocata vocal: ${real.name}`);
      return null;
    }

    let args = tokens.slice(1);
    if (NUMERIC_COMMANDS.has(real?.name ?? command)) {
      args = wordsToNumbers(args).map((a) => a.replace(/%$/, ""));
    }
    return { command, args };
  }

  /* ------------------------------------------------------ executie */

  _textChannelFor(conn) {
    const voiceId = cleanId(conn.channel?.id);
    const guildId = cleanId(conn.channel?.guildId);
    const players = this.djmitica.players;
    const p = players?.playerMap?.get(voiceId) ?? players?.getPlayerByChannelId?.(voiceId);
    let ch = p?.textChannel?.channel ?? p?.textChannel ?? null;
    if (ch && typeof ch !== "object") ch = this.client.channels.get(cleanId(ch));
    if (!ch?.id) {
      const id = this.djmitica.settingsMgr?.getServer?.(guildId)?.get?.("announcementChannelId");
      if (id) ch = this.client.channels.get(cleanId(id));
    }
    return ch?.id ? ch : null;
  }

  async _resolveUser(userId, guild) {
    const c = this.client;
    let user = c.users?.get?.(userId) ?? null;
    if (!user) { try { user = await c.users?.fetch?.(userId); } catch { /* ignore */ } }
    let member = guild?.members?.get?.(userId) ?? null;
    if (!member) { try { member = await guild?.fetchMember?.(userId); } catch { /* ignore */ } }
    if (!user) user = member?.user ?? { id: userId, username: "voice-user", bot: false };
    return { user, member };
  }

  async _execute(conn, userId, { command, args }) {
    const textChannel = this._textChannelFor(conn);
    if (!textChannel) { logger.warn(TAG, "Nu gasesc canalul text pentru raspuns; ignor comanda."); return; }

    const guildId = cleanId(conn.channel?.guildId ?? textChannel.guildId);
    const guild = this.client.guilds?.get?.(guildId) ?? textChannel.guild ?? null;
    const { user, member } = await this._resolveUser(userId, guild);

    const handler = this.djmitica.handler;
    const prefix = handler.getPrefix(guildId);
    const content = `${prefix}${command}${args.length ? " " + args.join(" ") : ""}`;

    const send = (opts) => (typeof textChannel.send === "function")
      ? textChannel.send(opts)
      : this.client.channels.send(textChannel.id, opts);

    // Mesaj "fals" care arata ca si cum utilizatorul a scris comanda in canalul text.
    const raw = {
      id: `voice-${Date.now()}`,
      content,
      author: user,
      member,
      channelId: textChannel.id,
      channel: textChannel,
      guildId,
      guild,
      client: this.client,
      attachments: new Map(),
      mentions: { users: new Map(), members: new Map(), roles: new Map(), channels: new Map() },
      createdTimestamp: Date.now(),
      isVoiceCommand: true,
      reply: (opts) => send(opts),
      react: async () => {},
      delete: async () => {},
      edit: async () => {},
    };
    const msg = new Message(raw, this.djmitica.messages);

    if (this.cfg.echo) {
      this.djmitica.messages.sendMessage(textChannel, `🎙️ <@${userId}>: \`${content}\``).catch(() => {});
    }
    try {
      await handler.messageHandler(msg);
    } catch (e) {
      logger.warn(TAG, "Comanda vocala a esuat:", e?.message);
    }
  }
}
