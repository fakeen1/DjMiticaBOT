/**
 * @module src/web/WebServer
 * @description Dj Mitica's own web control panel: an HTTP server with no external
 * dependencies, served straight from the bot process.
 *
 *  - Password login (config.json -> web.password), session in an HMAC-signed cookie.
 *  - Login attempt limiting (anti brute-force), CSRF protection (SameSite + header).
 *  - JSON API: state, player (pause/skip/volume/seek/loop/autoplay/queue), search,
 *    join/leave channel, audio and server settings, status, logs.
 *  - Live events (Server-Sent Events): player state + logs.
 *  - Static frontend from src/web/public (relative paths => also works under /djmitica/
 *    behind a reverse proxy).
 *  - Panel language: English by default, Romanian with web.language = "ro"
 *    (changeable from the panel: Settings -> Web panel).
 *  - Optional "Login with Fluxer" (OAuth2, config.json -> web.oauth): server managers
 *    log in with their Fluxer account and only see / control the servers where they
 *    have Manage Server. The password login and the bot owners keep full access.
 *
 * Config (config.json -> web):
 *   { "enabled": true, "port": 8080, "password": "...", "sessionSecret": "(generated)",
 *     "trustProxy": true, "sessionDays": 30, "language": "en",
 *     "oauth": { "enabled": false, "clientId": "", "clientSecret": "", "redirectUri": "" } }
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
import { configView, validateChanges, applyToConfig, applyLive, panelLanguage } from "./ConfigSchema.mjs";
import { buildInviteUrl } from "../utils/Invite.mjs";
import { getDonateUrl } from "../utils/Donate.mjs";
import { iterateVoiceStates, resolveIsBotUser } from "../voice/VoiceStateResolver.mjs";
import { mediaBase } from "../utils/Media.mjs";
import { PermissionFlags } from "@fluxerjs/core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const CONFIG_PATH = path.resolve("config.json");
const COOKIE = "djmitica_web";
const OAUTH_COOKIE = "djmitica_oauth";
const ALLOWED_TTL = 60_000;
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

/* ------------------------------------------------------------------- logs */

const ANSI = /\x1b\[[0-9;]*m/g;
function redact(s) {
  return s
    .replace(/(token=)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .replace(/("?(?:password|token|secret|apiKey)"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1***")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "eyJ***");
}

/** Captures everything the bot writes to the console, to show it in the page. */
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
        try { this.push(level, args); } catch (_) { /* never block logging */ }
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

// Log capture starts when the module is loaded (so it also catches the bot's startup).
const LOGS = new LogBuffer().install();

/* --------------------------------------------------------------- helpers */

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
    title: t.title ?? null,
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

/* ---------------------------------------------------------------- texts */

/** Server-side messages of the panel (English default, Romanian with web.language = "ro"). */
const TXT = {
  en: {
    internal: "Internal error", unauth: "Not logged in", csrf: "Request rejected (CSRF)", route: "Unknown route",
    tooMany: (m) => `Too many attempts. Try again in ${m} min.`, wrongPass: "Wrong password",
    voiceChannel: "Voice channel", user: "User",
    noChanges: "No changes.", saved: "Settings saved.", savedNotWritten: "Settings applied, but they could not be written to config.json.",
    restartNote: " Some of them take effect after the bot restarts.", restarting: "The bot is restarting…",
    audioSaved: "Audio settings saved.", audioNotWritten: "Audio settings applied, but they could not be saved to config.json.",
    invalid: "Invalid values", unknownServer: "Unknown server", volRange: "The default volume must be between 1 and 200",
    voteRange: "The vote threshold must be between 2 and 50", prefixBad: "The prefix must be 1–5 characters, without spaces",
    unknownLang: "Unknown language", fail247: "Could not change 24/7 mode: ", serverSaved: "Server settings saved.",
    searchLong: "Search text too long", nodeNotReady: "The audio node is not ready", searchFailed: "Search failed: ",
    noChannel: "Missing channel", alreadyIn: "The bot is already in this channel.", channelNotFound: "Voice channel not found",
    joinFailed: "Could not join the channel.", joined: (n) => `Joined ${n}.`, channel: "channel",
    notInChannel: "The bot is not in this channel", stopped: "Playback stopped and queue cleared.",
    volRange2: "Volume must be between 0 and 200", nothing: "Nothing is playing", badPos: "Invalid position",
    seekFailed: "Could not seek to the chosen position", seeked: "Position changed.",
    loopSong: "Repeating the song", loopQueue: "Repeating the queue", loopOff: "Repeat is off",
    apOn: "Autoplay on", apOff: "Autoplay off", apNA: "Autoplay unavailable: ", cleared: "Queue cleared.",
    noChange: "No change.", startingPicked: "Starting the chosen song.", missingSong: "Missing song",
    textLong: "Text too long", badAddr: "Invalid address", added: "Added.", left: "The bot left the channel.",
    action: "Unknown action", forbidden: "Only the bot owner can do this.", historyCleared: "History cleared.", notYours: "You don't manage this server.",
  },
  ro: {
    internal: "Eroare internă", unauth: "Neautentificat", csrf: "Cerere respinsă (CSRF)", route: "Rută necunoscută",
    tooMany: (m) => `Prea multe încercări. Mai încearcă peste ${m} min.`, wrongPass: "Parolă greșită",
    voiceChannel: "Canal de voce", user: "Utilizator",
    noChanges: "Nicio modificare.", saved: "Setările au fost salvate.", savedNotWritten: "Setările s-au aplicat, dar nu au putut fi scrise în config.json.",
    restartNote: " Unele intră în vigoare după repornirea botului.", restarting: "Botul repornește…",
    audioSaved: "Setările audio au fost salvate.", audioNotWritten: "Setările audio s-au aplicat, dar nu au putut fi salvate în config.json.",
    invalid: "Valori invalide", unknownServer: "Server necunoscut", volRange: "Volumul implicit trebuie să fie între 1 și 200",
    voteRange: "Pragul de vot trebuie să fie între 2 și 50", prefixBad: "Prefixul trebuie să aibă 1–5 caractere, fără spații",
    unknownLang: "Limbă necunoscută", fail247: "Nu am putut schimba modul 24/7: ", serverSaved: "Setările serverului au fost salvate.",
    searchLong: "Căutare prea lungă", nodeNotReady: "Nodul audio nu e pregătit", searchFailed: "Căutarea a eșuat: ",
    noChannel: "Lipsește canalul", alreadyIn: "Botul este deja în acest canal.", channelNotFound: "Canalul de voce nu a fost găsit",
    joinFailed: "Nu am putut intra în canal.", joined: (n) => `Am intrat în ${n}.`, channel: "canal",
    notInChannel: "Botul nu este în acest canal", stopped: "Redarea a fost oprită și coada golită.",
    volRange2: "Volumul trebuie să fie între 0 și 200", nothing: "Nu cântă nimic", badPos: "Poziție invalidă",
    seekFailed: "Nu am putut sări la poziția aleasă", seeked: "Poziție schimbată.",
    loopSong: "Repetă melodia", loopQueue: "Repetă coada", loopOff: "Repetarea e oprită",
    apOn: "Autoplay pornit", apOff: "Autoplay oprit", apNA: "Autoplay indisponibil: ", cleared: "Coada a fost golită.",
    noChange: "Nicio schimbare.", startingPicked: "Pornesc melodia aleasă.", missingSong: "Lipsește melodia",
    textLong: "Text prea lung", badAddr: "Adresă invalidă", added: "Adăugat.", left: "Botul a ieșit din canal.",
    action: "Acțiune necunoscută", forbidden: "Doar proprietarul botului poate face asta.", historyCleared: "Istoricul a fost șters.", notYours: "Nu administrezi acest server.",
  },
};

/** Romanian versions of the bot's own (English) player replies, shown as toasts. */
const PLAYER_RO = [
  [/^Paused$/i, "Pauză."], [/^Resumed$/i, "Redarea continuă."], [/^Skipped$/i, "Am trecut la următoarea melodie."],
  [/^Already paused!?$/i, "Este deja pe pauză."], [/^Not paused!?$/i, "Nu este pe pauză."],
  [/^There's nothing playing.*$/i, "Nu cântă nimic acum."], [/^Shuffled queue$/i, "Coada a fost amestecată."],
  [/^There is nothing to shuffle.*$/i, "Coada e goală."],
  [/^Volume (?:changed|set) to (\d+)%.*$/i, "Volum: $1%."],
  [/^Moved (.+) from position \d+ to (\d+)\.$/i, "Am mutat „$1” pe poziția $2."],
  [/^Successfully removed (.+) from the queue\.$/i, "Am scos „$1” din coadă."],
  [/^Position (\d+) out of range.*$/i, "Poziția $1 nu există în coadă."],
  [/^Successfully added (\d+) songs to the queue\.$/i, "Am adăugat $1 melodii în coadă."],
  [/^Successfully added (.+) to the queue\.$/i, "Am adăugat: $1"],
];

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

  /** Current panel language ("en" | "ro"). */
  get lang() { return panelLanguage(this.djmitica.config); }

  /** Panel message in the current language. */
  t(key, ...args) {
    const v = (TXT[this.lang] ?? TXT.en)[key] ?? TXT.en[key] ?? key;
    return typeof v === "function" ? v(...args) : v;
  }

  /* ---------------------------------------------------------------- start */

  start() {
    if (this.cfg.enabled === false || !this.djmitica.config?.web) {
      logger.info("[Web] Web panel disabled (config.json -> web.enabled).");
      return this;
    }
    this._ensureSecrets();
    if (!this.cfg.password && !this._oauthEnabled()) {
      logger.warn("[Web] No password set (config.json -> web.password) and Fluxer login is off. The web panel will NOT start.");
      return this;
    }
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((e) => {
        logger.warn("[Web] Request error:", e?.message);
        if (!res.headersSent) this._json(res, 500, { error: this.t("internal") });
        else try { res.end(); } catch (_) {}
      });
    });
    this.server.on("error", (e) => logger.error("[Web] Server error:", e?.message));
    const port = Number(this.cfg.port) || 8080;
    this.server.listen(port, "0.0.0.0", () => logger.info(`[Web] Web panel listening on port ${port}.`));

    this.logs.listeners.add((entry) => this._broadcast("log", entry, true));
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
      if (!c) throw new Error("cannot read config.json");
      mutator(c);
      mutator(this.djmitica.config);
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2) + "\n");
      return true;
    } catch (e) {
      logger.warn("[Web] Cannot save config.json:", e?.message);
      try { mutator(this.djmitica.config); } catch (_) {}
      return false;
    }
  }

  /* ------------------------------------------------------------- security */

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

  /**
   * Create a signed session token.
   * @param {{id: string, name: string, avatar: string|null}|null} user - Fluxer user, or null for the password (owner) login.
   */
  _makeSession(user = null) {
    const exp = Date.now() + (Number(this.cfg.sessionDays) || 30) * 86400_000;
    const data = { e: exp, r: crypto.randomBytes(6).toString("base64url") };
    if (user) Object.assign(data, { u: String(user.id), nm: String(user.name ?? "").slice(0, 64), av: user.avatar ?? null });
    const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
    return `${payload}.${this._sign(payload)}`;
  }

  _cookie(req, name) {
    const raw = String(req.headers.cookie ?? "").split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
    return raw ? decodeURIComponent(raw.slice(name.length + 1)) : null;
  }

  /** @returns {{exp: number, uid: string|null, name?: string, avatar?: string|null}|null} the session, or null. */
  _session(req) {
    const tok = this._cookie(req, COOKIE);
    if (!tok) return null;
    const i = tok.lastIndexOf(".");
    if (i < 0) return null;
    const payload = tok.slice(0, i), sig = tok.slice(i + 1);
    const good = this._sign(payload);
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    if (/^\d+\.[\w-]+$/.test(payload)) {
      // sessions created before Fluxer login existed (password login)
      const exp = Number(payload.split(".")[0]);
      return exp > Date.now() ? { exp, uid: null } : null;
    }
    try {
      const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      if (!(Number(d.e) > Date.now())) return null;
      return { exp: Number(d.e), uid: d.u ? String(d.u) : null, name: d.nm, avatar: d.av ?? null };
    } catch { return null; }
  }

  _validSession(req) { return !!this._session(req); }

  /** Password login, or a Fluxer user listed in config.json -> owners. */
  _isAdmin(sess) {
    if (!sess) return false;
    if (!sess.uid) return true;
    return (this.djmitica.config?.owners ?? []).map(String).includes(sess.uid);
  }

  /**
   * Guild IDs this session may see and control: null = all (admin), otherwise the
   * servers where the user is the owner or has Manage Server / Administrator.
   * @returns {Promise<Set<string>|null>}
   */
  async _allowedGuilds(sess) {
    if (this._isAdmin(sess)) return null;
    const cache = (this._allowedCache ??= new Map());
    const hit = cache.get(sess.uid);
    if (hit && Date.now() - hit.at < ALLOWED_TTL) return hit.set;
    const set = new Set();
    const MANAGE = PermissionFlags?.ManageGuild ?? (1n << 5n);
    const ADMIN = PermissionFlags?.Administrator ?? (1n << 3n);
    for (const g of listValues(this.client.guilds)) {
      try {
        const gid = String(g.id);
        if (String(g.ownerId ?? g.owner_id ?? "") === sess.uid) { set.add(gid); continue; }
        let member = g.members?.get?.(sess.uid) ?? null;
        if (!member) {
          member = typeof g.fetchMember === "function" ? await g.fetchMember(sess.uid).catch(() => null)
            : typeof g.members?.fetch === "function" ? await g.members.fetch(sess.uid).catch(() => null) : null;
        }
        const perms = member?.permissions;
        if (perms?.has?.(ADMIN) || perms?.has?.(MANAGE)) set.add(gid);
      } catch (_) { /* skip this guild */ }
    }
    cache.set(sess.uid, { set, at: Date.now() });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return set;
  }

  /** Remove the guilds (and their players) the session may not see. */
  _filterState(st, allowed) {
    if (!allowed) return st;
    return {
      ...st,
      guilds: st.guilds.filter((g) => allowed.has(g.id)),
      players: st.players.filter((p) => allowed.has(String(p.guildId))),
    };
  }

  /* --------------------------------------------------------- Fluxer login */

  _oauthCfg() { return this.djmitica.config?.web?.oauth ?? {}; }

  _oauthClientId() {
    const o = this._oauthCfg();
    return String(o.clientId || this.client?.application?.id || this.client?.user?.id || "").trim();
  }

  _oauthEnabled() {
    const o = this._oauthCfg();
    return o.enabled === true && !!o.clientSecret && /^https?:\/\//i.test(String(o.redirectUri ?? "")) && !!this._oauthClientId();
  }

  _fluxerWebBase() {
    const inst = this.djmitica.config?.["fluxer.js"]?.instance ?? {};
    return String(this._oauthCfg().webBase || inst.webapp || "https://web.fluxer.app").replace(/\/+$/, "");
  }

  _fluxerApiBase() {
    const inst = this.djmitica.config?.["fluxer.js"]?.instance ?? {};
    return String(this._oauthCfg().apiBase || inst.api || "https://api.fluxer.app").replace(/\/+$/, "");
  }

  /** Redirects the browser to Fluxer's authorization page. */
  _oauthLogin(req, res) {
    if (!this._oauthEnabled()) { res.writeHead(302, this._headers({ Location: "../../?login=disabled" })); return res.end(); }
    const state = crypto.randomBytes(16).toString("base64url");
    const q = new URLSearchParams({
      response_type: "code", client_id: this._oauthClientId(), redirect_uri: this._oauthCfg().redirectUri,
      scope: "identify", state,
    });
    const lax = this._cookieAttrs(req).replace("SameSite=Strict", "SameSite=Lax");
    res.writeHead(302, this._headers({
      Location: `${this._fluxerWebBase()}/oauth2/authorize?${q}`,
      "Set-Cookie": `${OAUTH_COOKIE}=${state}; Max-Age=600${lax}`,
    }));
    res.end();
  }

  async _fluxerFetch(paths, init) {
    let last = null;
    for (const p of paths) {
      try {
        const r = await fetch(this._fluxerApiBase() + p, { ...init, signal: AbortSignal.timeout(10_000) });
        if (r.ok) return await r.json();
        last = `HTTP ${r.status} on ${p}`;
        if (r.status !== 404 && r.status !== 405) break;
      } catch (e) { last = e?.message ?? String(e); }
    }
    throw new Error(last ?? "request failed");
  }

  /** Fluxer sends the user back here with ?code&state. */
  async _oauthCallback(req, res, url) {
    const back = (q) => { res.writeHead(302, this._headers({ Location: "../../" + (q ? "?login=" + q : ""), "Set-Cookie": `${OAUTH_COOKIE}=; Max-Age=0${this._cookieAttrs(req).replace("SameSite=Strict", "SameSite=Lax")}` })); res.end(); };
    if (!this._oauthEnabled()) return back("disabled");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expected = this._cookie(req, OAUTH_COOKIE);
    if (!code || !state || !expected || state.length !== expected.length ||
        !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
      if (url.searchParams.get("error")) return back("cancelled");
      logger.warn("[Web] Fluxer login: invalid state (expired or not started from this panel).");
      return back("failed");
    }
    const o = this._oauthCfg();
    try {
      const clientId = this._oauthClientId();
      const tok = await this._fluxerFetch(["/v1/oauth2/token", "/oauth2/token"], {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: "Basic " + Buffer.from(`${clientId}:${o.clientSecret}`).toString("base64"),
        },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: o.redirectUri, client_id: clientId, client_secret: o.clientSecret }),
      });
      if (!tok?.access_token) throw new Error("no access_token in the token response");
      const me = await this._fluxerFetch(["/v1/users/@me", "/users/@me"], {
        headers: { Authorization: `${tok.token_type || "Bearer"} ${tok.access_token}` },
      });
      if (!me?.id) throw new Error("no user id in /users/@me");
      const user = { id: String(me.id), name: me.global_name ?? me.globalName ?? me.username ?? "User", avatar: this._avatar(me) };
      const maxAge = (Number(this.cfg.sessionDays) || 30) * 86400;
      res.writeHead(302, this._headers({
        Location: "../../",
        "Set-Cookie": [
          `${COOKIE}=${encodeURIComponent(this._makeSession(user))}; Max-Age=${maxAge}${this._cookieAttrs(req)}`,
          `${OAUTH_COOKIE}=; Max-Age=0${this._cookieAttrs(req).replace("SameSite=Strict", "SameSite=Lax")}`,
        ],
      }));
      res.end();
      logger.info(`[Web] Fluxer login: ${user.name} (${user.id})${this._isAdmin({ uid: user.id }) ? " [owner]" : ""}`);
    } catch (e) {
      logger.warn("[Web] Fluxer login failed:", e?.message);
      return back("failed");
    }
  }

  _cookieAttrs(req) {
    const prefix = String(req.headers["x-forwarded-prefix"] ?? "").replace(/[^A-Za-z0-9/_-]/g, "") || "/";
    const secure = String(req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
    return `; Path=${prefix}; HttpOnly; SameSite=Strict${secure}`;
  }

  _checkPassword(given) {
    if (!this.cfg.password) return false;
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
        if (size > MAX_BODY) { reject(new Error("Body too large")); req.destroy(); return; }
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
        // SPA: any unknown route -> index.html
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

    // --- authentication
    if (p === "/api/login" && method === "POST") return this._login(req, res);
    if (p === "/api/logout" && method === "POST") {
      res.writeHead(200, this._headers({ "Set-Cookie": `${COOKIE}=; Max-Age=0${this._cookieAttrs(req)}`, "Content-Type": "application/json" }));
      return res.end("{}");
    }
    if (p === "/api/oauth/login" && method === "GET") return this._oauthLogin(req, res);
    if (p === "/api/oauth/callback" && method === "GET") return this._oauthCallback(req, res, url);
    const sess = this._session(req);
    if (p === "/api/session") {
      return this._json(res, 200, {
        authenticated: !!sess, admin: this._isAdmin(sess), language: this.lang,
        user: sess?.uid ? { id: sess.uid, name: sess.name ?? null, avatar: sess.avatar ?? null } : null,
        oauth: this._oauthEnabled(), password: !!this.cfg.password, donate: getDonateUrl(this.djmitica.config),
      });
    }

    if (!sess) return this._json(res, 401, { error: this.t("unauth") });
    if (method !== "GET" && req.headers["x-requested-with"] !== "djmitica-web") {
      return this._json(res, 403, { error: this.t("csrf") });
    }
    const admin = this._isAdmin(sess);
    const allowed = await this._allowedGuilds(sess);
    const ownerOnly = () => this._json(res, 403, { error: this.t("forbidden") });

    // --- routes
    if (p === "/api/events" && method === "GET") return this._events(req, res, sess, allowed);
    if (p === "/api/state" && method === "GET") return this._json(res, 200, this._filterState(this.state(), allowed));
    if (p === "/api/search" && method === "GET") return this._search(res, url.searchParams);
    if (p === "/api/history" && (method === "GET" || method === "DELETE")) {
      const gid = cleanId(url.searchParams.get("guild") ?? "");
      if (!gid) return this._json(res, 400, { error: this.t("unknownServer") });
      if (allowed && !allowed.has(gid)) return this._json(res, 403, { error: this.t("notYours") });
      if (method === "DELETE") {
        this.djmitica.history?.clear(gid);
        return this._json(res, 200, { ok: true, message: this.t("historyCleared") });
      }
      return this._json(res, 200, { guildId: gid, entries: this.djmitica.history?.list(gid) ?? [] });
    }
    if (p === "/api/settings" && method === "GET") {
      const gid = cleanId(url.searchParams.get("guild") ?? "");
      if (allowed && gid && !allowed.has(gid)) return this._json(res, 403, { error: this.t("notYours") });
      return this._json(res, 200, this.settings(gid));
    }
    if (p === "/api/settings" && method === "POST") {
      const body = await this._body(req);
      if (!admin && body.audio) return ownerOnly();
      if (allowed && body.server && !allowed.has(cleanId(body.server.guildId ?? ""))) return this._json(res, 403, { error: this.t("notYours") });
      return await this._saveSettings(res, body);
    }
    if (p === "/api/join" && method === "POST") return this._join(res, await this._body(req), allowed);

    const m = p.match(/^\/api\/player\/(\d+)\/([a-z]+)$/);
    if (m && method === "POST") {
      if (allowed) {
        const pl = this._findPlayer(m[1]);
        if (pl && !allowed.has(cleanId(pl._guildId))) return this._json(res, 403, { error: this.t("notYours") });
      }
      return this._playerAction(res, m[1], m[2], await this._body(req));
    }

    // --- owner only
    const ownerRoutes = ["/api/status", "/api/logs", "/api/config", "/api/restart"];
    if (ownerRoutes.includes(p) && !admin) return ownerOnly();
    if (p === "/api/status" && method === "GET") return this._json(res, 200, await this.status());
    if (p === "/api/logs" && method === "GET") return this._json(res, 200, { lines: this.logs.since(Number(url.searchParams.get("since") ?? 0)) });
    if (p === "/api/config" && method === "GET") return this._json(res, 200, { sections: configView(this.djmitica.config) });
    if (p === "/api/config" && method === "POST") return this._saveGlobal(req, res, await this._body(req));
    if (p === "/api/restart" && method === "POST") return this._restart(res);

    return this._json(res, 404, { error: this.t("route") });
  }

  async _login(req, res) {
    const ip = this._ip(req);
    const now = Date.now();
    const f = this.loginFails.get(ip);
    if (f && f.until > now) {
      return this._json(res, 429, { error: this.t("tooMany", Math.ceil((f.until - now) / 60000)) });
    }
    const body = await this._body(req);
    await sleep(300 + Math.random() * 200);
    if (!this._checkPassword(body.password)) {
      const rec = f && f.until > now - 15 * 60_000 ? f : { count: 0, until: 0 };
      rec.count++;
      if (rec.count >= 5) { rec.until = now + 15 * 60_000; rec.count = 0; }
      this.loginFails.set(ip, rec);
      logger.warn(`[Web] Wrong password from ${ip}`);
      return this._json(res, 401, { error: this.t("wrongPass") });
    }
    this.loginFails.delete(ip);
    const tok = this._makeSession();
    const maxAge = (Number(this.cfg.sessionDays) || 30) * 86400;
    res.writeHead(200, this._headers({
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE}=${encodeURIComponent(tok)}; Max-Age=${maxAge}${this._cookieAttrs(req)}`,
    }));
    res.end(JSON.stringify({ ok: true }));
    logger.info(`[Web] Successful login from ${ip}`);
  }

  /* ------------------------------------------------------------ live (SSE) */

  _events(req, res, sess, allowed) {
    res.writeHead(200, this._headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    }));
    res.write("retry: 3000\n\n");
    const client = { res, sess, allowed, admin: this._isAdmin(sess), allowedAt: Date.now(), lastKey: "" };
    this.sse.add(client);
    const state = JSON.stringify(this._filterState(this.state(), allowed));
    res.write(`event: state\ndata: ${state}\n\n`);
    req.on("close", () => this.sse.delete(client));
  }

  /** @param {boolean} [adminOnly] - only send to owner sessions (logs). */
  _broadcast(event, data, adminOnly = false) {
    if (!this.sse.size) return;
    const msg = `event: ${event}\ndata: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
    for (const c of this.sse) {
      if (adminOnly && !c.admin) continue;
      try { c.res.write(msg); } catch (_) {}
    }
  }

  /** Make the next tick send the state to every client, even if nothing changed. */
  _forcePush() {
    for (const c of this.sse) c.lastKey = "";
  }

  _pushState() {
    if (!this.sse.size) return;
    let st;
    try { st = this.state(); } catch (e) { return; }
    const cache = new Map();
    for (const c of this.sse) {
      if (!c.admin && Date.now() - c.allowedAt > ALLOWED_TTL) {
        c.allowedAt = Date.now();
        this._allowedGuilds(c.sess).then((a) => { c.allowed = a; c.lastKey = ""; }).catch(() => {});
      }
      const ck = c.allowed ? [...c.allowed].sort().join(",") : "*";
      let json = cache.get(ck);
      if (!json) { json = JSON.stringify(this._filterState(st, c.allowed)); cache.set(ck, json); }
      // the position advances in the browser; only push when something else changes
      const key = json.replace(/"positionMs":\d+/g, "").replace(/"now":\d+/, "");
      if (key === c.lastKey) continue;
      c.lastKey = key;
      try { c.res.write(`event: state\ndata: ${json}\n\n`); } catch (_) {}
    }
  }

  /* ---------------------------------------------------------------- state */

  _mediaBase() {
    return mediaBase(this.djmitica.config); // instance media, or cdn.fluxer.app for the official Fluxer
  }

  _avatar(user) {
    if (!user) return null;
    const base = this._mediaBase();
    if (user.avatar && base) return `${base}/avatars/${user.id}/${user.avatar}.webp?size=64`;
    return null;
  }

  /**
   * People (not bots) in a voice channel. The voice-state cache can miss someone
   * (joined while the bot was restarting, a lost gateway event), so it is merged with
   * the guild's own voice states and, when the bot is in that channel, the LiveKit
   * room participants.
   */
  _listenerIds(guild, channelId) {
    const gid = cleanId(String(guild?.id ?? "")), cid = cleanId(String(channelId ?? ""));
    if (!gid || !cid) return [];
    const botId = String(this.client.user?.id ?? "");
    const ids = new Set(this.djmitica.voiceCache?.getHumansInChannel?.(gid, cid) ?? []);
    try {
      // fluxer.js versions differ: voice_states or voiceStates
      const src = guild?.voice_states ? guild : guild?.voiceStates ? { ...guild, voice_states: guild.voiceStates, members: guild.members } : null;
      for (const vs of iterateVoiceStates(src, { client: this.client, botId })) {
        if (cleanId(vs.channelId) === cid && !vs.isBot) ids.add(cleanId(vs.userId));
      }
    } catch (_) {}
    try {
      const room = this._findPlayer(cid)?.connection?.room;
      if (room?.isConnected && room.remoteParticipants) {
        for (const [, part] of room.remoteParticipants) {
          const uid = String(part?.identity ?? "").match(/\d{15,22}/)?.[0] ?? "";
          if (uid && uid !== botId && !resolveIsBotUser({ userId: uid, guild, client: this.client, botId })) ids.add(uid);
        }
      }
    } catch (_) {}
    ids.delete(botId);
    ids.delete("");
    return [...ids];
  }

  _userInfo(guild, userId) {
    const member = guild?.members?.get?.(userId);
    let user = member?.user ?? this.client.users?.get?.(userId);
    if (!user) {
      // Not in the cache (e.g. joined while the bot was restarting): fetch it once in the
      // background; the name shows up with the next panel update.
      this._fetchedUsers ??= new Map();
      const hit = this._fetchedUsers.get(String(userId));
      if (hit && hit !== "pending") user = hit;
      else if (!hit && typeof this.client.users?.fetch === "function") {
        this._fetchedUsers.set(String(userId), "pending");
        this.client.users.fetch(String(userId)).then((u) => { if (u) this._fetchedUsers.set(String(userId), u); })
          .catch(() => setTimeout(() => this._fetchedUsers.delete(String(userId)), 60_000));
        if (this._fetchedUsers.size > 2000) this._fetchedUsers.clear();
      }
    }
    return {
      id: String(userId),
      name: member?.nick ?? user?.globalName ?? user?.displayName ?? user?.username ?? this.t("user"),
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
    const humans = this._listenerIds(guild, channelId);
    const text = p.textChannel?.channel ?? p.textChannel;
    return {
      channelId,
      guildId,
      channelName: channel?.name ?? this.t("voiceChannel"),
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
          listeners: this._listenerIds(g, c.id).map((id) => this._userInfo(g, id)),
        })),
        textChannels: textCh.map((c) => ({ id: String(c.id), name: c.name ?? "text" })),
      });
    }
    const me = this.client.user;
    return {
      bot: me ? { id: String(me.id), name: me.globalName ?? me.username ?? "Dj Mitica", avatar: this._avatar(me), invite: buildInviteUrl(this.djmitica), donate: getDonateUrl(this.djmitica.config) } : null,
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
        invite: buildInviteUrl(this.djmitica),
      },
      nodelink: { connected: !!lav?.hasConnectedNode?.(), host: info ? `${info.host}:${info.port}` : null, session: info?.sessionId ?? null },
      whisper: await this._whisperStatus(),
      audio: getAudioSettings(),
      web: { sessions: this.sse.size },
    };
  }

  /* ------------------------------------------------------------ settings */

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
    if (!ch || ch.type !== 2) throw new Error("unknown voice channel");
    mod.save247Channels(set, new Set([channelId]));
    if (!this._findPlayer(channelId)) {
      try { await this.djmitica._spawnPlayer?.(guildId, channelId); } catch (_) {}
    }
  }

  async _saveGlobal(req, res, body) {
    const { updates, errors } = validateChanges(this.djmitica.config, body.changes);
    if (errors.length) return this._json(res, 400, { error: errors.join(" ") });
    if (!updates.length) return this._json(res, 200, { ok: true, message: this.t("noChanges"), restart: [] });
    const saved = this._saveConfig((c) => applyToConfig(c, updates));
    const restart = applyLive(this.djmitica, updates);
    const headers = { "Content-Type": "application/json" };
    if (updates.some(([p]) => p === "web.password")) {
      // keep the current login after the password changes
      const maxAge = (Number(this.cfg.sessionDays) || 30) * 86400;
      headers["Set-Cookie"] = `${COOKIE}=${encodeURIComponent(this._makeSession())}; Max-Age=${maxAge}${this._cookieAttrs(req)}`;
    }
    logger.info(`[Web] Global settings changed: ${updates.map(([p]) => p).join(", ")}`);
    const message = this.t(saved ? "saved" : "savedNotWritten") + (restart.length ? this.t("restartNote") : "");
    res.writeHead(200, this._headers(headers));
    res.end(JSON.stringify({ ok: true, message, restart, language: this.lang, sections: configView(this.djmitica.config) }));
  }

  _restart(res) {
    logger.warn("[Web] Restart requested from the web panel.");
    this._json(res, 200, { ok: true, message: this.t("restarting") });
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
        return this._json(res, 400, { error: this.t("invalid") });
      }
      configureAudio(next);
      const saved = this._saveConfig((c) => {
        c.audio = { ...(c.audio ?? {}), crossfadeSeconds: next.crossfadeSeconds, skipCrossfadeSeconds: next.skipCrossfadeSeconds };
      });
      msgs.push(this.t(saved ? "audioSaved" : "audioNotWritten"));
    }
    if (body.server && typeof body.server === "object") {
      const gid = cleanId(body.server.guildId ?? "");
      const s = gid ? this.djmitica.settingsMgr?.getServer?.(gid) : null;
      if (!s) return this._json(res, 404, { error: this.t("unknownServer") });
      const b = body.server;
      if (b.volume != null) {
        const v = Math.round(Number(b.volume));
        if (!(v >= 1 && v <= 200)) return this._json(res, 400, { error: this.t("volRange") });
        s.set("volume", v);
      }
      if (b.songAnnouncements != null) s.set("songAnnouncements", !!b.songAnnouncements);
      if (b.voteSkip != null) s.set("voteSkip", !!b.voteSkip);
      if (b.autoplay != null) s.set("autoplay", !!b.autoplay);
      if (b.voteSkipThreshold != null) {
        const v = Math.round(Number(b.voteSkipThreshold));
        if (!(v >= 2 && v <= 50)) return this._json(res, 400, { error: this.t("voteRange") });
        s.set("voteSkipThreshold", v);
      }
      if (b.prefix != null) {
        const pfx = String(b.prefix).trim();
        if (!pfx || pfx.length > 5 || /\s/.test(pfx)) return this._json(res, 400, { error: this.t("prefixBad") });
        s.set("prefix", pfx);
      }
      if (b.locale != null) {
        const loc = String(b.locale);
        const avail = this.djmitica.locale?.availableLocales?.() ?? new Set(["en"]);
        if (!avail.has(loc)) return this._json(res, 400, { error: this.t("unknownLang") });
        s.set("locale", loc);
        try { this.djmitica.locale?.invalidateCache?.(gid); } catch (_) {}
      }
      if (b.stay247 != null) {
        try { await this._set247(s, gid, cleanId(String(b.stay247))); }
        catch (e) { return this._json(res, 500, { error: this.t("fail247") + (e?.message ?? e) }); }
      }
      msgs.push(this.t("serverSaved"));
    }
    logger.info("[Web] Settings changed from the web panel.");
    return this._json(res, 200, { ok: true, message: msgs.join(" "), settings: this.settings(body.server?.guildId) });
  }

  /* --------------------------------------------------------------- search */

  async _search(res, params) {
    const q = String(params.get("q") ?? "").trim();
    const provider = PROVIDERS[params.get("provider")] ? params.get("provider") : "ytm";
    if (!q) return this._json(res, 200, { results: [] });
    if (q.length > 300) return this._json(res, 400, { error: this.t("searchLong") });
    const lav = this.djmitica.lavalink;
    if (!lav) return this._json(res, 503, { error: this.t("nodeNotReady") });
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
      return this._json(res, 502, { error: this.t("searchFailed") + (e?.message ?? e) });
    }
  }

  /* ------------------------------------------------------------- channels */

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

  async _join(res, body, allowed = null) {
    const channelId = cleanId(body.channelId ?? "");
    if (!channelId) return this._json(res, 400, { error: this.t("noChannel") });
    if (allowed) {
      const ch = this.client.channels?.get?.(channelId);
      if (!ch || !allowed.has(cleanId(ch.guildId))) return this._json(res, 403, { error: this.t("notYours") });
    }
    if (this._findPlayer(channelId)) return this._json(res, 200, { ok: true, message: this.t("alreadyIn") });
    const channel = this.client.channels?.get?.(channelId) ?? await this.client.channels?.fetch?.(channelId).catch(() => null);
    if (!channel || channel.type !== 2) return this._json(res, 404, { error: this.t("channelNotFound") });
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
      const txt = typeof lastMsg === "string" ? lastMsg : this.t("joinFailed");
      return this._json(res, 500, { error: txt.replace(/[*`<>#]/g, "") });
    }
    logger.info(`[Web] Bot joined channel ${channel.name ?? channelId} from the web panel.`);
    return this._json(res, 200, { ok: true, message: this.t("joined", channel.name ?? this.t("channel")) });
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
    if (!p) return this._json(res, 404, { error: this.t("notInChannel") });
    const clean = (s) => {
      let t = String(s ?? "").replace(/:[a-z_]+:/g, "").replace(/[*`]/g, "").trim();
      t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
      if (this.lang === "ro") for (const [re, ro] of PLAYER_RO) if (re.test(t)) { t = t.replace(re, ro); break; }
      return t;
    };
    const ok = (message) => { this._forcePush(); setTimeout(() => this._pushState(), 50); return this._json(res, 200, { ok: true, message: clean(message) }); };
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
        return ok(this.t("stopped"));
      }
      case "volume": {
        const v = Math.round(Number(body.value));
        if (!(v >= 0 && v <= 200)) return fail(400, this.t("volRange2"));
        return ok(p.setVolume(v / 100));
      }
      case "seek": {
        if (!hasCurrent) return fail(400, this.t("nothing"));
        const ms = Math.max(0, Math.round(Number(body.ms)));
        const d = trackDurationMs(p.queue.getCurrent());
        if (!Number.isFinite(ms) || (d && ms >= d)) return fail(400, this.t("badPos"));
        const done = await p.seekToPosition(ms);
        return done === false ? fail(500, this.t("seekFailed")) : ok(this.t("seeked"));
      }
      case "loop": {
        const mode = String(body.mode ?? "off");
        p.queue.setSongLoop(mode === "song");
        p.queue.setLoop(mode === "queue");
        return ok(this.t(mode === "song" ? "loopSong" : mode === "queue" ? "loopQueue" : "loopOff"));
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
          return ok(this.t(want ? "apOn" : "apOff"));
        } catch (e) {
          return fail(500, this.t("apNA") + e?.message);
        }
      }
      case "shuffle": return ok(p.shuffle());
      case "clear": p.clear(); return ok(this.t("cleared"));
      case "remove": {
        const i = Math.round(Number(body.index));
        if (!(i >= 0 && i < p.queue.size())) return fail(400, this.t("badPos"));
        return ok(p.remove(i));
      }
      case "move": {
        const from = Math.round(Number(body.from)), to = Math.round(Number(body.to));
        const n = p.queue.size();
        if (!(from >= 0 && from < n && to >= 0 && to < n)) return fail(400, this.t("badPos"));
        if (from === to) return ok(this.t("noChange"));
        return ok(p.move(from + 1, to + 1));
      }
      case "jump": {
        const i = Math.round(Number(body.index));
        if (!(i >= 0 && i < p.queue.size())) return fail(400, this.t("badPos"));
        if (!hasCurrent) {
          p.queue.data.splice(0, i);
          p.playNext().catch(() => {});
          return ok(this.t("startingPicked"));
        }
        return ok(p.skipTo(i + 1));
      }
      case "add": {
        const query = String(body.query ?? "").trim();
        if (!query) return fail(400, this.t("missingSong"));
        if (query.length > 500) return fail(400, this.t("textLong"));
        if (/^(javascript|data|vbscript|file):/i.test(query)) return fail(400, this.t("badAddr"));
        const mode = body.mode === "next" || body.mode === "now" ? body.mode : "end";
        const provider = PROVIDERS[body.provider] ? body.provider : undefined;
        const emitter = p.play(query, mode !== "end", provider);
        const message = await new Promise((resolve) => {
          let last = "Searching...";
          const t = setTimeout(() => resolve(last), 20000);
          emitter?.on?.("message", (m) => {
            last = typeof m === "string" ? m : (m?.embedText ?? last);
            if (!/^Searching|^Caut|Retrying|trying \*\*/i.test(last)) { clearTimeout(t); resolve(last); }
          });
          if (!emitter?.on) { clearTimeout(t); resolve(this.t("added")); }
        });
        if (mode === "now" && hasCurrent && /Successfully added|Am adăugat/i.test(message)) p.skip();
        return ok(message);
      }
      case "leave": {
        await this._leave(p);
        return ok(this.t("left"));
      }
      default:
        return fail(404, this.t("action"));
    }
  }
}
