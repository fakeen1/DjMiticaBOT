/**
 * @module src/web/WebServer
 * @description Interfata web proprie a botului Dj Mitica: server HTTP fara dependente
 * externe, servit direct din procesul botului.
 *
 *  - Login cu parola (config.json -> web.password), sesiune in cookie semnat HMAC.
 *  - Limitare incercari de login (anti brute-force), protectie CSRF (SameSite + header).
 *  - API JSON: stare, player (pauza/skip/volum/seek/loop/autoplay/coada), cautare,
 *    intrare/iesire din canal, setari audio si de server, status, loguri.
 *  - Evenimente live (Server-Sent Events): stare player + loguri.
 *  - Frontend static din src/web/public (cai relative => merge si sub /djmitica/ in spatele
 *    unui reverse proxy).
 *
 * Config (config.json -> web):
 *   { "enabled": true, "port": 8080, "password": "...", "sessionSecret": "(generat)",
 *     "trustProxy": true, "sessionDays": 30 }
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { logger } from "../core/Logger.mjs";
import { cleanId, Utils } from "../utils/Utils.mjs";
import { configureAudio, getAudioSettings } from "../music/audio/AudioSettings.mjs";
import { PROVIDERS, PROVIDER_NAMES } from "../music/providers.mjs";
import { configView, validateChanges, applyToConfig, applyLive } from "./ConfigSchema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.resolve("config.json");
const COOKIE = "djmitica_web";
const MAX_BODY = 64 * 1024;
const LOG_MAX = 1500;
const QUEUE_LIMIT = 300;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/* ----------------------------------------------------------------- loguri */

const ANSI = /\x1b\[[0-9;]*m/g;
function redact(s) {
  return s
    .replace(/(token=)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .replace(/("?(?:password|token|secret|apiKey)"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1***")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "eyJ***");
}

/** Captureaza tot ce scrie botul in consola, ca sa-l arate in pagina. */
class LogBuffer {
  lines = [];
  seq = 0;
  listeners = new Set();

  install() {
    if (globalThis.__djmiticaLogBuffer) return globalThis.__djmiticaLogBuffer;
    globalThis.__djmiticaLogBuffer = this;
    for (const level of ["log", "info", "warn", "error", "debug"]) {
      const orig = console[level].bind(console);
      console[level] = (...args) => {
        orig(...args);
        try { this.push(level, args); } catch (_) { /* nu bloca logarea */ }
      };
    }
    return this;
  }

  push(level, args) {
    let text = args.map((a) => {
      if (typeof a === "string") return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ").replace(ANSI, "");
    if (!text.trim()) return;
    if (text.length > 2000) text = text.slice(0, 2000) + "…";
    const lv = level === "error" ? "error" : level === "warn" ? "warn" : "info";
    const entry = { id: ++this.seq, t: Date.now(), level: lv, text: redact(text) };
    this.lines.push(entry);
    if (this.lines.length > LOG_MAX) this.lines.splice(0, this.lines.length - LOG_MAX);
    for (const fn of this.listeners) fn(entry);
  }

  since(id = 0, limit = 400) {
    const out = this.lines.filter((l) => l.id > id);
    return out.slice(-limit);
  }
}

// Captura logurilor porneste odata cu incarcarea modulului (prinde si pornirea botului).
const LOGS = new LogBuffer().install();

/* ------------------------------------------------------------- utilitare */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readJsonFile(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function trackDurationMs(t) {
  if (!t) return 0;
  if (typeof t._durationMs === "number" && t._durationMs > 0) return t._durationMs;
  if (typeof t.duration === "number") return t.duration;
  if (t.duration?.seconds != null) return Number(t.duration.seconds) * 1000;
  return 0;
}

function serializeTrack(t) {
  if (!t) return null;
  const isRadio = t.type === "radio";
  return {
    title: t.title ?? "Necunoscut",
    author: t.author?.name ?? t.artist ?? null,
    url: isRadio ? (t.author?.url ?? null) : (t.spotifyUrl || t.url || null),
    thumbnail: t.thumbnail ?? (t.videoId ? `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg` : null),
    durationMs: isRadio || t.isLive ? 0 : trackDurationMs(t),
    live: !!(t.isLive || isRadio || t.type === "livestream"),
    type: t.type ?? null,
    source: t.sourceName ?? null,
  };
}

function listValues(store) {
  if (!store) return [];
  if (typeof store.values === "function") return [...store.values()];
  if (Array.isArray(store)) return store;
  return Object.values(store);
}

/* ------------------------------------------------------------------ server */

export class WebServer {
  /** @param {import('../core/Bot.mjs').DjMitica} djmitica */
  constructor(djmitica) {
    this.djmitica = djmitica;
    this.cfg = { enabled: false, port: 8080, trustProxy: true, sessionDays: 30, ...(djmitica.config?.web ?? {}) };
    this.logs = LOGS;
    this.sse = new Set();
    this.loginFails = new Map(); // ip -> {count, until}
    this.startedAt = Date.now();
    this._lastStateJson = "";
    this._whisper = { ok: null, checkedAt: 0, ms: null };
    this.server = null;
  }

  get client() { return this.djmitica.client; }
  get players() { return this.djmitica.players; }

  /* ------------------------------------------------------------ pornire */

  start() {
    if (this.cfg.enabled === false || !this.djmitica.config?.web) {
      logger.info("[Web] Interfata web dezactivata (config.json -> web.enabled).");
      return this;
    }
    this._ensureSecrets();
    if (!this.cfg.password) {
      logger.warn("[Web] Nu este setata o parola (config.json -> web.password). Interfata web NU porneste.");
      return this;
    }
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((e) => {
        logger.warn("[Web] Eroare request:", e?.message);
        if (!res.headersSent) this._json(res, 500, { error: "Eroare internă" });
        else try { res.end(); } catch (_) {}
      });
    });
    this.server.on("error", (e) => logger.error("[Web] Server error:", e?.message));
    const port = Number(this.cfg.port) || 8080;
    this.server.listen(port, "0.0.0.0", () => logger.info(`[Web] Interfata web porneste pe portul ${port}.`));

    this.logs.listeners.add((entry) => this._broadcast("log", entry));
    this._tick = setInterval(() => this._pushState(), 1000);
    this._tick.unref?.();
    this._ping = setInterval(() => { for (const c of this.sse) { try { c.res.write("event: ping\ndata: 1\n\n"); } catch (_) {} } }, 10000);
    this._ping.unref?.();
    return this;
  }

  _ensureSecrets() {
    if (this.cfg.sessionSecret && String(this.cfg.sessionSecret).length >= 32) return;
    this.cfg.sessionSecret = crypto.randomBytes(32).toString("hex");
    this._saveConfig((c) => { c.web = { ...(c.web ?? {}), sessionSecret: this.cfg.sessionSecret }; });
  }

  _saveConfig(mutator) {
    try {
      const c = readJsonFile(CONFIG_PATH);
      if (!c) throw new Error("config.json nu poate fi citit");
      mutator(c);
      mutator(this.djmitica.config);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2) + "\n");
      return true;
    } catch (e) {
      logger.warn("[Web] Nu pot salva config.json:", e?.message);
      try { mutator(this.djmitica.config); } catch (_) {}
      return false;
    }
  }

  /* --------------------------------------------------------- securitate */

  _ip(req) {
    if (this.cfg.trustProxy) {
      const xf = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      if (xf) return xf;
    }
    return req.socket.remoteAddress ?? "?";
  }

  _sign(payload) {
    const key = crypto.createHash("sha256").update(String(this.cfg.sessionSecret) + "|" + String(this.cfg.password)).digest();
    return crypto.createHmac("sha256", key).update(payload).digest("base64url");
  }

  _makeSession() {
    const exp = Date.now() + (Number(this.cfg.sessionDays) || 30) * 86400_000;
    const payload = `${exp}.${crypto.randomBytes(9).toString("base64url")}`;
    return `${payload}.${this._sign(payload)}`;
  }

  _validSession(req) {
    const raw = String(req.headers.cookie ?? "").split(";").map((s) => s.trim()).find((s) => s.startsWith(COOKIE + "="));
    if (!raw) return false;
    const tok = decodeURIComponent(raw.slice(COOKIE.length + 1));
    const i = tok.lastIndexOf(".");
    if (i < 0) return false;
    const payload = tok.slice(0, i), sig = tok.slice(i + 1);
    const good = this._sign(payload);
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
    return Number(payload.split(".")[0]) > Date.now();
  }

  _cookieAttrs(req) {
    const prefix = String(req.headers["x-forwarded-prefix"] ?? "").replace(/[^A-Za-z0-9/_-]/g, "") || "/";
    const secure = String(req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
    return `; Path=${prefix}; HttpOnly; SameSite=Strict${secure}`;
  }

  _checkPassword(given) {
    const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
    const b = crypto.createHash("sha256").update(String(this.cfg.password)).digest();
    return crypto.timingSafeEqual(a, b);
  }

  /* -------------------------------------------------------------- HTTP */

  _headers(extra = {}) {
    return {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
      ...extra,
    };
  }

  _json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, this._headers({ "Content-Type": "application/json; charset=utf-8" }));
    res.end(body);
  }

  async _body(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on("data", (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error("Body prea mare")); req.destroy(); return; }
        chunks.push(c);
      });
      req.on("end", () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { resolve({}); }
      });
      req.on("error", reject);
    });
  }

  _serveStatic(req, res, pathname) {
    let rel = pathname === "/" ? "/index.html" : pathname;
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, "");
    const file = path.join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) {
        // SPA: orice ruta necunoscuta -> index.html
        if (!path.extname(rel)) return this._serveStatic(req, res, "/");
        res.writeHead(404, this._headers({ "Content-Type": "text/plain" }));
        return res.end("Not found");
      }
      const ext = path.extname(file);
      const csp = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
                  "font-src 'self' https://fonts.gstatic.com; connect-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
      res.writeHead(200, this._headers({
        "Content-Type": MIME[ext] ?? "application/octet-stream",
        "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
        ...(ext === ".html" ? { "Content-Security-Policy": csp } : {}),
      }));
      res.end(data);
    });
  }

  async _handle(req, res) {
    const url = new URL(req.url, "http://x");
    const p = url.pathname.replace(/\/{2,}/g, "/");
    if (!p.startsWith("/api/")) return this._serveStatic(req, res, p);

    const method = req.method ?? "GET";

    // --- autentificare
    if (p === "/api/login" && method === "POST") return this._login(req, res);
    if (p === "/api/logout" && method === "POST") {
      res.writeHead(200, this._headers({ "Set-Cookie": `${COOKIE}=; Max-Age=0${this._cookieAttrs(req)}`, "Content-Type": "application/json" }));
      return res.end("{}");
    }
    if (p === "/api/session") return this._json(res, 200, { authenticated: this._validSession(req) });

    if (!this._validSession(req)) return this._json(res, 401, { error: "Neautentificat" });
    if (method !== "GET" && req.headers["x-requested-with"] !== "djmitica-web") {
      return this._json(res, 403, { error: "Cerere respinsă (CSRF)" });
    }

    // --- rute
    if (p === "/api/events" && method === "GET") return this._events(req, res);
    if (p === "/api/state" && method === "GET") return this._json(res, 200, this.state());
    if (p === "/api/status" && method === "GET") return this._json(res, 200, await this.status());
    if (p === "/api/logs" && method === "GET") return this._json(res, 200, { lines: this.logs.since(Number(url.searchParams.get("since") ?? 0)) });
    if (p === "/api/search" && method === "GET") return this._search(res, url.searchParams);
    if (p === "/api/settings" && method === "GET") return this._json(res, 200, this.settings(url.searchParams.get("guild")));
    if (p === "/api/settings" && method === "POST") return await this._saveSettings(res, await this._body(req));
    if (p === "/api/join" && method === "POST") return this._join(res, await this._body(req));
    if (p === "/api/config" && method === "GET") return this._json(res, 200, { sections: configView(this.djmitica.config) });
    if (p === "/api/config" && method === "POST") return this._saveGlobal(req, res, await this._body(req));
    if (p === "/api/restart" && method === "POST") return this._restart(res);

    const m = p.match(/^\/api\/player\/(\d+)\/([a-z]+)$/);
    if (m && method === "POST") return this._playerAction(res, m[1], m[2], await this._body(req));

    return this._json(res, 404, { error: "Rută necunoscută" });
  }

  async _login(req, res) {
    const ip = this._ip(req);
    const now = Date.now();
    const f = this.loginFails.get(ip);
    if (f && f.until > now) {
      return this._json(res, 429, { error: `Prea multe încercări. Mai încearcă peste ${Math.ceil((f.until - now) / 60000)} min.` });
    }
    const body = await this._body(req);
    await sleep(300 + Math.random() * 200);
    if (!this._checkPassword(body.password)) {
      const rec = f && f.until > now - 15 * 60_000 ? f : { count: 0, until: 0 };
      rec.count++;
      if (rec.count >= 5) { rec.until = now + 15 * 60_000; rec.count = 0; }
      this.loginFails.set(ip, rec);
      logger.warn(`[Web] Parola gresita de la ${ip}`);
      return this._json(res, 401, { error: "Parolă greșită" });
    }
    this.loginFails.delete(ip);
    const tok = this._makeSession();
    const maxAge = (Number(this.cfg.sessionDays) || 30) * 86400;
    res.writeHead(200, this._headers({
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE}=${encodeURIComponent(tok)}; Max-Age=${maxAge}${this._cookieAttrs(req)}`,
    }));
    res.end(JSON.stringify({ ok: true }));
    logger.info(`[Web] Autentificare reusita de la ${ip}`);
  }

  /* ------------------------------------------------------------ live (SSE) */

  _events(req, res) {
    res.writeHead(200, this._headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    }));
    res.write("retry: 3000\n\n");
    const client = { res };
    this.sse.add(client);
    const state = JSON.stringify(this.state());
    res.write(`event: state\ndata: ${state}\n\n`);
    req.on("close", () => this.sse.delete(client));
  }

  _broadcast(event, data) {
    if (!this.sse.size) return;
    const msg = `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
    for (const c of this.sse) { try { c.res.write(msg); } catch (_) {} }
  }

  _pushState() {
    if (!this.sse.size) return;
    let json;
    try { json = JSON.stringify(this.state()); } catch (e) { return; }
    // pozitia curge in browser; trimitem doar cand se schimba altceva
    const key = json.replace(/"positionMs":\d+/g, "").replace(/"now":\d+/, "");
    if (key === this._lastStateJson) return;
    this._lastStateJson = key;
    this._broadcast("state", json);
  }

  /* ---------------------------------------------------------------- stare */

  _mediaBase() {
    const inst = this.djmitica.config?.["fluxer.js"]?.instance;
    return (inst?.media ?? "").replace(/\/+$/, "") || null;
  }

  _avatar(user) {
    if (!user) return null;
    const base = this._mediaBase();
    if (user.avatar && base) return `${base}/avatars/${user.id}/${user.avatar}.webp?size=64`;
    return null;
  }

  _userInfo(guild, userId) {
    const member = guild?.members?.get?.(userId);
    const user = member?.user ?? this.client.users?.get?.(userId);
    return {
      id: String(userId),
      name: member?.nick ?? user?.globalName ?? user?.displayName ?? user?.username ?? "Utilizator",
      avatar: this._avatar(user),
    };
  }

  _playerList() {
    const out = [];
    const seen = new Set();
    for (const [chId, p] of this.players?.playerMap ?? []) {
      if (!p || p._destroyed || seen.has(p)) continue;
      seen.add(p);
      out.push([cleanId(p._channelId ?? chId), p]);
    }
    return out;
  }

  serializePlayer(channelId, p) {
    const guildId = cleanId(p._guildId);
    const guild = this.client.guilds?.get?.(guildId);
    const channel = this.client.channels?.get?.(channelId);
    const cur = p.queue?.getCurrent?.() ?? null;
    let pos = 0;
    if (cur && p.startedPlaying) {
      pos = (p._paused && p._pausedAt ? p._pausedAt : Date.now()) - p.startedPlaying;
      const d = trackDurationMs(cur);
      if (d > 0) pos = Math.min(pos, d);
      pos = Math.max(0, pos);
    }
    const data = p.queue?.data ?? [];
    let remaining = 0;
    for (const t of data) remaining += trackDurationMs(t);
    const humans = this.djmitica.voiceCache?.getHumansInChannel?.(guildId, channelId) ?? [];
    const text = p.textChannel?.channel ?? p.textChannel;
    return {
      channelId,
      guildId,
      channelName: channel?.name ?? "Canal de voce",
      guildName: guild?.name ?? "Server",
      textChannel: text?.id ? { id: text.id, name: text.name ?? null } : null,
      connected: !!p._voiceConn,
      current: serializeTrack(cur),
      positionMs: Math.round(pos),
      paused: !!p._paused,
      volume: Math.round((p.preferredVolume ?? 1) * 100),
      loop: { song: !!p.queue?.songLoop, queue: !!p.queue?.loop },
      autoplay: !!p._autoplay,
      filter: typeof p.activeFilter === "string" ? p.activeFilter : (p.activeFilter?.name ?? null),
      queue: data.slice(0, QUEUE_LIMIT).map(serializeTrack),
      queueTotal: data.length,
      queueRemainingMs: remaining,
      listeners: humans.map((id) => this._userInfo(guild, id)),
    };
  }

  state() {
    const guilds = [];
    for (const g of listValues(this.client.guilds)) {
      const chans = listValues(g.channels);
      const voice = chans.filter((c) => c?.type === 2).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const textCh = chans.filter((c) => c?.type === 0 || c?.type === 5).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const base = this._mediaBase();
      guilds.push({
        id: String(g.id),
        name: g.name ?? "Server",
        icon: g.icon && base ? `${base}/icons/${g.id}/${g.icon}.webp?size=64` : null,
        voiceChannels: voice.map((c) => ({
          id: String(c.id),
          name: c.name ?? "voice",
          listeners: (this.djmitica.voiceCache?.getHumansInChannel?.(cleanId(g.id), cleanId(c.id)) ?? []).map((id) => this._userInfo(g, id)),
        })),
        textChannels: textCh.map((c) => ({ id: String(c.id), name: c.name ?? "text" })),
      });
    }
    const me = this.client.user;
    return {
      bot: me ? { id: String(me.id), name: me.globalName ?? me.username ?? "Dj Mitica", avatar: this._avatar(me) } : null,
      now: Date.now(),
      guilds,
      players: this._playerList().map(([id, p]) => this.serializePlayer(id, p)),
      providers: ["ytm", "yt", "sc", "sp", "dz", "am", "bc"].filter((k) => PROVIDERS[k]).map((k) => ({ id: k, label: PROVIDER_NAMES[k] })),
    };
  }

  /* --------------------------------------------------------------- status */

  async _whisperStatus() {
    const vc = this.djmitica.config?.voiceCommands;
    if (!vc || vc.enabled === false) return { enabled: false };
    const url = vc.whisperUrl ?? "http://whisper:9000";
    if (Date.now() - this._whisper.checkedAt > 30_000) {
      this._whisper.checkedAt = Date.now();
      const t0 = Date.now();
      try {
        const ctl = AbortSignal.timeout(3000);
        const r = await fetch(new URL("/docs", url), { signal: ctl });
        this._whisper.ok = r.ok;
      } catch { this._whisper.ok = false; }
      this._whisper.ms = Date.now() - t0;
    }
    return { enabled: true, url, ok: this._whisper.ok, ms: this._whisper.ms, wakeWord: vc.wakeWord ?? "dj" };
  }

  async status() {
    const mem = process.memoryUsage();
    const lav = this.djmitica.lavalink;
    const info = lav?.getNodeLinkInfo?.();
    return {
      bot: {
        name: this.client.user?.username ?? null,
        id: this.client.user?.id ?? null,
        uptimeMs: Math.round(process.uptime() * 1000),
        node: process.version,
        memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
        ping: this.client.ws?.ping ?? this.client.ping ?? null,
        guilds: listValues(this.client.guilds).length,
        players: this._playerList().length,
        commit: this.djmitica.comHash ?? null,
      },
      nodelink: { connected: !!lav?.hasConnectedNode?.(), host: info ? `${info.host}:${info.port}` : null, session: info?.sessionId ?? null },
      whisper: await this._whisperStatus(),
      audio: getAudioSettings(),
      web: { sessions: this.sse.size },
    };
  }

  /* -------------------------------------------------------------- setari */

  settings(guildId) {
    const audio = getAudioSettings();
    const out = {
      audio: {
        crossfadeSeconds: audio.crossfadeSeconds ?? 0,
        skipCrossfadeSeconds: audio.skipCrossfadeSeconds ?? 0,
      },
      server: null,
    };
    const gid = cleanId(guildId ?? "");
    if (gid) {
      const s = this.djmitica.settingsMgr?.getServer?.(gid);
      if (s) {
        const guild = this.client.guilds?.get?.(gid);
        const raw247 = s.get("stay_247");
        const ch247 = !raw247 || raw247 === "none" ? "" : String(Array.isArray(raw247) ? (raw247[0] ?? "") : raw247);
        const locales = [...(this.djmitica.locale?.availableLocales?.() ?? ["en"])];
        out.server = {
          guildId: gid,
          prefix: String(s.get("prefix") ?? this.djmitica.config?.prefix ?? "%"),
          locale: String(s.get("locale") ?? "en"),
          locales,
          stay247: cleanId(ch247),
          voiceChannels: listValues(guild?.channels).filter((c) => c?.type === 2).map((c) => ({ id: String(c.id), name: c.name ?? "voice" })),
          volume: Number(s.get("volume") ?? 100),
          songAnnouncements: !["false", "0", "no", "off"].includes(String(s.get("songAnnouncements") ?? true).toLowerCase()),
          voteSkip: !["false", "0", "no", "off"].includes(String(s.get("voteSkip") ?? true).toLowerCase()),
          autoplay: ["true", "1", "yes", "on"].includes(String(s.get("autoplay") ?? false).toLowerCase()),
          voteSkipThreshold: Number(s.get("voteSkipThreshold") ?? 3),
        };
      }
    }
    return out;
  }

  async _set247(set, guildId, channelId) {
    const mod = await import("../../commands/settings/channels247.mjs");
    const current = mod.get247Channels(set);
    if (!channelId) {
      for (const id of current) await mod.disable247(this.djmitica, set, guildId, id);
      return;
    }
    if (current.has(channelId) && current.size === 1) return;
    for (const id of current) if (id !== channelId) await mod.disable247(this.djmitica, set, guildId, id);
    const ch = this.client.channels?.get?.(channelId);
    if (!ch || ch.type !== 2) throw new Error("canal de voce necunoscut");
    mod.save247Channels(set, new Set([channelId]));
    if (!this._findPlayer(channelId)) {
      try { await this.djmitica._spawnPlayer?.(guildId, channelId); } catch (_) {}
    }
  }

  async _saveGlobal(req, res, body) {
    const { updates, errors } = validateChanges(this.djmitica.config, body.changes);
    if (errors.length) return this._json(res, 400, { error: errors.join(" ") });
    if (!updates.length) return this._json(res, 200, { ok: true, message: "Nicio modificare.", restart: [] });
    const saved = this._saveConfig((c) => applyToConfig(c, updates));
    const restart = applyLive(this.djmitica, updates);
    const headers = { "Content-Type": "application/json" };
    if (updates.some(([p]) => p === "web.password")) {
      // pastreaza autentificarea curenta dupa schimbarea parolei
      const maxAge = (Number(this.cfg.sessionDays) || 30) * 86400;
      headers["Set-Cookie"] = `${COOKIE}=${encodeURIComponent(this._makeSession())}; Max-Age=${maxAge}${this._cookieAttrs(req)}`;
    }
    logger.info(`[Web] Setari globale modificate: ${updates.map(([p]) => p).join(", ")}`);
    const message = (saved ? "Setările au fost salvate." : "Setările s-au aplicat, dar nu au putut fi scrise în config.json.") +
      (restart.length ? " Unele intră în vigoare după repornirea botului." : "");
    res.writeHead(200, this._headers(headers));
    res.end(JSON.stringify({ ok: true, message, restart, sections: configView(this.djmitica.config) }));
  }

  _restart(res) {
    logger.warn("[Web] Repornire cerută din panoul web.");
    this._json(res, 200, { ok: true, message: "Botul repornește…" });
    setTimeout(() => process.exit(0), 800);
  }

  async _saveSettings(res, body) {
    const msgs = [];
    if (body.audio && typeof body.audio === "object") {
      const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) * 2) / 2));
      const cur = getAudioSettings();
      const next = {
        allowLoadstream: cur.allowLoadstream,
        crossfadeSeconds: body.audio.crossfadeSeconds != null ? clamp(body.audio.crossfadeSeconds, 15) : cur.crossfadeSeconds,
        skipCrossfadeSeconds: body.audio.skipCrossfadeSeconds != null ? clamp(body.audio.skipCrossfadeSeconds, 10) : cur.skipCrossfadeSeconds,
      };
      if (Number.isNaN(next.crossfadeSeconds) || Number.isNaN(next.skipCrossfadeSeconds)) {
        return this._json(res, 400, { error: "Valori invalide" });
      }
      configureAudio(next);
      const saved = this._saveConfig((c) => {
        c.audio = { ...(c.audio ?? {}), crossfadeSeconds: next.crossfadeSeconds, skipCrossfadeSeconds: next.skipCrossfadeSeconds };
      });
      msgs.push(saved ? "Setările audio au fost salvate." : "Setările audio s-au aplicat, dar nu au putut fi salvate în config.json.");
    }
    if (body.server && typeof body.server === "object") {
      const gid = cleanId(body.server.guildId ?? "");
      const s = gid ? this.djmitica.settingsMgr?.getServer?.(gid) : null;
      if (!s) return this._json(res, 404, { error: "Server necunoscut" });
      const b = body.server;
      if (b.volume != null) {
        const v = Math.round(Number(b.volume));
        if (!(v >= 1 && v <= 200)) return this._json(res, 400, { error: "Volumul implicit trebuie să fie între 1 și 200" });
        s.set("volume", v);
      }
      if (b.songAnnouncements != null) s.set("songAnnouncements", !!b.songAnnouncements);
      if (b.voteSkip != null) s.set("voteSkip", !!b.voteSkip);
      if (b.autoplay != null) s.set("autoplay", !!b.autoplay);
      if (b.voteSkipThreshold != null) {
        const v = Math.round(Number(b.voteSkipThreshold));
        if (!(v >= 2 && v <= 50)) return this._json(res, 400, { error: "Pragul de vot trebuie să fie între 2 și 50" });
        s.set("voteSkipThreshold", v);
      }
      if (b.prefix != null) {
        const pfx = String(b.prefix).trim();
        if (!pfx || pfx.length > 5 || /\s/.test(pfx)) return this._json(res, 400, { error: "Prefixul trebuie să aibă 1–5 caractere, fără spații" });
        s.set("prefix", pfx);
      }
      if (b.locale != null) {
        const loc = String(b.locale);
        const avail = this.djmitica.locale?.availableLocales?.() ?? new Set(["en"]);
        if (!avail.has(loc)) return this._json(res, 400, { error: "Limbă necunoscută" });
        s.set("locale", loc);
        try { this.djmitica.locale?.invalidateCache?.(gid); } catch (_) {}
      }
      if (b.stay247 != null) {
        try { await this._set247(s, gid, cleanId(String(b.stay247))); }
        catch (e) { return this._json(res, 500, { error: "Nu am putut schimba modul 24/7: " + (e?.message ?? e) }); }
      }
      msgs.push("Setările serverului au fost salvate.");
    }
    logger.info("[Web] Setari modificate din interfata web.");
    return this._json(res, 200, { ok: true, message: msgs.join(" "), settings: this.settings(body.server?.guildId) });
  }

  /* --------------------------------------------------------------- cautare */

  async _search(res, params) {
    const q = String(params.get("q") ?? "").trim();
    const provider = PROVIDERS[params.get("provider")] ? params.get("provider") : "ytm";
    if (!q) return this._json(res, 200, { results: [] });
    if (q.length > 300) return this._json(res, 400, { error: "Căutare prea lungă" });
    const lav = this.djmitica.lavalink;
    if (!lav) return this._json(res, 503, { error: "Nodul audio nu e pregătit" });
    try {
      await lav.waitForNode({ timeoutMs: 8000 });
      const isUrl = Utils.isValidUrl(q);
      const result = isUrl ? await lav.search(q) : await lav.search(q, { source: PROVIDERS[provider].prefix });
      const anyPlayer = this._playerList()[0]?.[1];
      const conv = (t) => {
        if (anyPlayer?._lcTrackToVideo) return anyPlayer._lcTrackToVideo(t);
        const i = t?.info ?? {};
        return { title: i.title, url: i.uri, thumbnail: i.artworkUrl, _durationMs: i.length, author: { name: i.author }, videoId: i.identifier, isLive: i.isLive };
      };
      const tracks = (result?.tracks ?? []).slice(0, 15).map(conv).filter(Boolean).map(serializeTrack);
      return this._json(res, 200, { results: tracks, playlist: result?.loadType === "playlist" ? (result?.playlistInfo?.name ?? "Playlist") : null });
    } catch (e) {
      return this._json(res, 502, { error: "Căutarea a eșuat: " + (e?.message ?? e) });
    }
  }

  /* ------------------------------------------------------------- canale */

  _findPlayer(channelId) {
    const id = cleanId(channelId);
    const direct = this.players?.playerMap?.get(id);
    if (direct && !direct._destroyed) return direct;
    for (const [, p] of this._playerList()) if (cleanId(p._channelId) === id) return p;
    return null;
  }

  _pickTextChannel(guild, preferId) {
    const isText = (c) => c && (c.type === 0 || c.type === 5);
    if (preferId) {
      const c = this.client.channels?.get?.(cleanId(preferId));
      if (isText(c)) return c;
    }
    const saved = this.djmitica.settingsMgr?.getServer?.(cleanId(guild?.id))?.get?.("announcementChannelId");
    if (saved) {
      const c = this.client.channels?.get?.(cleanId(saved));
      if (isText(c)) return c;
    }
    if (guild?.systemChannelId) {
      const c = guild.channels?.get?.(guild.systemChannelId);
      if (isText(c)) return c;
    }
    return listValues(guild?.channels).find(isText) ?? null;
  }

  async _join(res, body) {
    const channelId = cleanId(body.channelId ?? "");
    if (!channelId) return this._json(res, 400, { error: "Lipsește canalul" });
    if (this._findPlayer(channelId)) return this._json(res, 200, { ok: true, message: "Botul este deja în acest canal." });
    const channel = this.client.channels?.get?.(channelId) ?? await this.client.channels?.fetch?.(channelId).catch(() => null);
    if (!channel || channel.type !== 2) return this._json(res, 404, { error: "Canalul de voce nu a fost găsit" });
    const guild = this.client.guilds?.get?.(cleanId(channel.guildId));
    const text = this._pickTextChannel(guild, body.textChannelId);
    let lastMsg = null;
    const fakeMsg = {
      channel: text ?? channel,
      message: { guildId: channel.guildId },
      author: this.client.user,
      reply: async (m) => { lastMsg = m; return { edit: async (x) => { lastMsg = x; }, catch: () => {} }; },
    };
    const p = await this.players.initPlayer(fakeMsg, channelId);
    if (!p) {
      const txt = typeof lastMsg === "string" ? lastMsg : "Nu am putut intra în canal.";
      return this._json(res, 500, { error: txt.replace(/[*`<>#]/g, "") });
    }
    logger.info(`[Web] Botul a intrat in canalul ${channel.name ?? channelId} din interfata web.`);
    return this._json(res, 200, { ok: true, message: `Am intrat în ${channel.name ?? "canal"}.` });
  }

  async _leave(p) {
    const r = this.djmitica;
    const activeChannelId = cleanId(p._channelId);
    const homeChannelId = cleanId(p._home247Channel) || activeChannelId;
    let was247 = false;
    try {
      const raw = r.settingsMgr?.getServer?.(cleanId(p._guildId))?.get?.("stay_247");
      was247 = !!raw && raw !== "none" &&
        (Array.isArray(raw) ? raw : [raw]).map((id) => cleanId(id)).some((id) => id === activeChannelId || id === homeChannelId);
    } catch (_) {}
    const rejoinDelay = r.config?.timers?.rejoin247Delay ?? 3000;
    r.markIntentionalLeave?.(activeChannelId, was247 ? rejoinDelay + 1000 : null);
    this.players.playerMap.delete(activeChannelId);
    this.players._unindexPlayer?.(p._guildId, activeChannelId);
    if (homeChannelId !== activeChannelId) this.players.playerMap.delete(homeChannelId);
    const pending = this.players._pendingScrobbleTimers?.get(activeChannelId);
    if (pending) { clearTimeout(pending.timer); this.players._pendingScrobbleTimers.delete(activeChannelId); }
    await p.leave().catch(() => {});
    p.destroy();
  }

  /* -------------------------------------------------------------- player */

  async _playerAction(res, channelId, action, body) {
    const p = this._findPlayer(channelId);
    if (!p) return this._json(res, 404, { error: "Botul nu este în acest canal" });
    const RO = [
      [/^Paused$/i, "Pauză."], [/^Resumed$/i, "Redarea continuă."], [/^Skipped$/i, "Am trecut la următoarea melodie."],
      [/^Already paused!?$/i, "Este deja pe pauză."], [/^Not paused!?$/i, "Nu este pe pauză."],
      [/^There's nothing playing.*$/i, "Nu cântă nimic acum."], [/^Shuffled queue$/i, "Coada a fost amestecată."],
      [/^There is nothing to shuffle.*$/i, "Coada e goală."],
      [/^Volume (?:changed|set) to (\d+)%.*$/i, "Volum: $1%."],
      [/^Moved (.+) from position \d+ to (\d+)\.$/i, "Am mutat „$1” pe poziția $2."],
      [/^Successfully removed (.+) from the queue\.$/i, "Am scos „$1” din coadă."],
      [/^Position (\d+) out of range.*$/i, "Poziția $1 nu există în coadă."],
    ];
    const clean = (s) => {
      let t = String(s ?? "").replace(/:[a-z_]+:/g, "").replace(/[*`]/g, "").trim();
      for (const [re, ro] of RO) if (re.test(t)) { t = t.replace(re, ro); break; }
      return t;
    };
    const ok = (message) => { this._lastStateJson = ""; setTimeout(() => this._pushState(), 50); return this._json(res, 200, { ok: true, message: clean(message) }); };
    const fail = (code, error) => this._json(res, code, { error });
    const hasCurrent = !!p.queue?.getCurrent?.();

    switch (action) {
      case "pause": return ok(p.pause());
      case "resume": return ok(p.resume());
      case "toggle": return ok(p._paused ? p.resume() : p.pause());
      case "skip": return ok(p.skip());
      case "stop": {
        p.clear();
        if (hasCurrent) p.skip();
        return ok("Redarea a fost oprită și coada golită.");
      }
      case "volume": {
        const v = Math.round(Number(body.value));
        if (!(v >= 0 && v <= 200)) return fail(400, "Volumul trebuie să fie între 0 și 200");
        return ok(p.setVolume(v / 100));
      }
      case "seek": {
        if (!hasCurrent) return fail(400, "Nu cântă nimic");
        const ms = Math.max(0, Math.round(Number(body.ms)));
        const d = trackDurationMs(p.queue.getCurrent());
        if (!Number.isFinite(ms) || (d && ms >= d)) return fail(400, "Poziție invalidă");
        const done = await p.seekToPosition(ms);
        return done === false ? fail(500, "Nu am putut sări la poziția aleasă") : ok("Poziție schimbată.");
      }
      case "loop": {
        const mode = String(body.mode ?? "off");
        p.queue.setSongLoop(mode === "song");
        p.queue.setLoop(mode === "queue");
        return ok(mode === "song" ? "Repetă melodia" : mode === "queue" ? "Repetă coada" : "Repetarea e oprită");
      }
      case "autoplay": {
        const want = !!body.enabled;
        try {
          const mod = await import("../../commands/autoplay.mjs");
          p._autoplay = want;
          if (want) {
            p._autoplayHistory = p._autoplayHistory ?? [];
            mod.attachAutoplay(p, this.djmitica);
            if (!p.queue.getCurrent() && p.queue.isEmpty() && p._lastPlayedTrack) p._autoplayHandler?.().catch(() => {});
          } else {
            mod.detachAutoplay(p);
            p._autoplayHistory = [];
            p._autoplayMixPools?.clear?.();
          }
          return ok(want ? "Autoplay pornit" : "Autoplay oprit");
        } catch (e) {
          return fail(500, "Autoplay indisponibil: " + e?.message);
        }
      }
      case "shuffle": return ok(p.shuffle());
      case "clear": p.clear(); return ok("Coada a fost golită.");
      case "remove": {
        const i = Math.round(Number(body.index));
        if (!(i >= 0 && i < p.queue.size())) return fail(400, "Poziție invalidă");
        return ok(p.remove(i));
      }
      case "move": {
        const from = Math.round(Number(body.from)), to = Math.round(Number(body.to));
        const n = p.queue.size();
        if (!(from >= 0 && from < n && to >= 0 && to < n)) return fail(400, "Poziție invalidă");
        if (from === to) return ok("Nicio schimbare.");
        return ok(p.move(from + 1, to + 1));
      }
      case "jump": {
        const i = Math.round(Number(body.index));
        if (!(i >= 0 && i < p.queue.size())) return fail(400, "Poziție invalidă");
        if (!hasCurrent) {
          p.queue.data.splice(0, i);
          p.playNext().catch(() => {});
          return ok("Pornesc melodia aleasă.");
        }
        return ok(p.skipTo(i + 1));
      }
      case "add": {
        const query = String(body.query ?? "").trim();
        if (!query) return fail(400, "Lipsește melodia");
        if (query.length > 500) return fail(400, "Text prea lung");
        if (/^(javascript|data|vbscript|file):/i.test(query)) return fail(400, "Adresă invalidă");
        const mode = body.mode === "next" || body.mode === "now" ? body.mode : "end";
        const provider = PROVIDERS[body.provider] ? body.provider : undefined;
        const emitter = p.play(query, mode !== "end", provider);
        const message = await new Promise((resolve) => {
          let last = "Se cauta...";
          const t = setTimeout(() => resolve(last), 20000);
          emitter?.on?.("message", (m) => {
            last = typeof m === "string" ? m : (m?.embedText ?? last);
            if (!/^Searching|^Se cauta|Retrying|trying \*\*/i.test(last)) { clearTimeout(t); resolve(last); }
          });
          if (!emitter?.on) { clearTimeout(t); resolve("Adăugat."); }
        });
        if (mode === "now" && hasCurrent && /Successfully added/i.test(message)) p.skip();
        return ok(clean(message).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
          .replace(/^Successfully added (\d+) songs to the queue\./i, "Am adăugat $1 melodii în coadă.")
          .replace(/^Successfully added (.+) to the queue\./i, "Am adăugat: $1"));
      }
      case "leave": {
        await this._leave(p);
        return ok("Botul a ieșit din canal.");
      }
      default:
        return fail(404, "Acțiune necunoscută");
    }
  }
}
