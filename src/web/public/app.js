/* Dj Mitica: web control panel (vanilla JS, no build step). */
"use strict";

(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const fmt = (ms) => {
    if (!ms || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
  };
  const fmtLong = (ms) => {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  };
  const initials = (n) => esc(String(n ?? "?").trim().slice(0, 1).toUpperCase() || "?");

  /* ---------------------------------------------------------- i18n */
  // English by default; Romanian when config.json -> web.language = "ro" (Settings -> Web panel).
  const I18N = {
    en: {
      "login.intro": "Enter the panel password to control the bot.", "login.password": "Password", "login.submit": "Open the panel",
      "top.live": "Live connection", "top.sections": "Sections", "top.logout": "Log out",
      "tab.player": "Player", "tab.settings": "Settings", "tab.status": "Status",
      "rail.title": "Voice channels",
      "add.title": "Add music", "add.placeholder": "Song name, artist or YouTube / Spotify link", "add.search": "Search", "add.source": "Source",
      "queue.title": "Queue", "queue.shuffle": "Shuffle", "queue.clear": "Clear",
      "set.sections": "Settings sections", "set.serverTitle": "Server settings", "set.serverDesc": "Applies only to the selected server and takes effect immediately.",
      "set.restartTitle": "Restart", "set.restartDesc": "Settings marked “after restart” only apply once the bot starts again. A restart takes 10–20 seconds and the music resumes on its own.",
      "set.restartBtn": "Restart the bot",
      "set.footer": "The bot token, database and NodeLink connection can only be changed in <code>docker/config.json</code>. A mistake there would stop the bot, including this panel.",
      "log.title": "Log", "log.filter": "Filter", "log.filterAria": "Filter the log", "log.level": "Level", "log.all": "All",
      "log.warn": "Warnings and errors", "log.error": "Errors only", "log.follow": "Follow", "log.aria": "Bot log", "log.none": "No lines to show.",
      "err.expired": "Your session has expired. Please log in again.", "err.code": "Error {0}",
      "unknown": "Unknown",
      "g.paused": "Paused", "g.playing": "Playing", "g.connected": "Connected", "g.join": "Join", "g.joining": "Joining…",
      "g.noVoice": "No voice channels.", "g.noServers": "The bot is not in any server yet.", "g.inviteHint": "Add it to a server with its invite link:",
      "inv.add": "Add to a server", "inv.copy": "Copy link", "inv.copied": "Invite link copied.", "inv.label": "Invite link",
      "d.emptyTitle": "The bot is not in a channel", "d.emptyText": "Pick a voice channel from the list and press Join. Then search for a song below.",
      "d.on": "{0} on {1}", "d.nothing": "Nothing playing", "d.nothingHint": "Search for a song below to start playback.",
      "d.leave": "Remove the bot from the channel", "d.seek": "Position in the song", "d.play": "Play", "d.pause": "Pause",
      "d.next": "Next song", "d.stop": "Stop and clear the queue", "d.volume": "Volume",
      "d.chips": "Repeat and autoplay", "d.loopSong": "Repeat song", "d.loopQueue": "Repeat queue",
      "d.leaveConfirm": "Remove the bot from the channel? The queue will be lost.",
      "q.songs": (n) => `${n} ${n === 1 ? "song" : "songs"}`, "q.empty": "The queue is empty. Added songs appear here, in the order they will play.",
      "q.drag": "Drag to move", "q.playNow": "Play now", "q.up": "Move up", "q.down": "Move down", "q.remove": "Remove from queue",
      "q.more": (n) => `and ${n} more songs`, "q.shuffled": "The queue was shuffled.", "q.clearConfirm": "Clear the queue? The current song keeps playing.",
      "s.searching": "Searching for “{0}”…", "s.none": "Nothing found for “{0}”. Try another name or source.",
      "s.playlist": "Playlist: {0}", "s.shown": "{0} songs shown", "s.addAll": "Add all",
      "s.nowTitle": "Stops the current song and starts this one", "s.now": "Play now", "s.next": "Next", "s.queue": "Queue it",
      "s.needPlayer": "To add songs, first put the bot in a voice channel.",
      "c.default": "default", "c.secretSet": "Set, leave empty to keep it", "c.secretUnset": "Not set", "c.onePerLine": "one per line",
      "c.off": "Off", "c.afterRestart": "after restart", "c.afterRestartTitle": "Applies after the bot restarts", "c.save": "Save",
      "nav.server": "Server", "nav.restart": "Restart",
      "r.changed": "You changed settings that apply after a restart: <strong>{0}</strong>. Restart the bot when you are ready.",
      "r.confirm": "Restart the bot? The music stops for a few seconds and then resumes.", "r.restarting": "Restarting…",
      "r.toast": "The bot is restarting. The page will reconnect on its own.",
      "ss.noServer": "The bot is not in any server.", "ss.notLoaded": "This server's settings are not loaded yet.",
      "ss.prefix": "Prefix", "ss.prefixHelp": "The characters commands start with in this server (1–5, no spaces).",
      "ss.lang": "Bot language", "ss.langHelp": "Language of the bot's replies in this server.",
      "ss.vol": "Default volume", "ss.volHelp": "The volume the bot starts with in this server (1–200%).",
      "ss.ap": "Autoplay on by default", "ss.apHelp": "When the bot joins a channel, autoplay starts on its own: at the end of the queue it adds similar songs.",
      "ss.ann": "Announce every song", "ss.annHelp": "Posts a message in chat when a new song starts.",
      "ss.vote": "Vote to skip", "ss.voteHelp": "With several listeners, skipping needs a majority vote.",
      "ss.thr": "Voting starts at", "ss.thrHelp": "Number of listeners from which skipping needs a vote (2–50).", "ss.thrAria": "Vote threshold", "ss.people": "people",
      "ss.247": "24/7 channel", "ss.247Help": "The bot stays in this channel permanently and rejoins on its own if disconnected.",
      "st.name": "Name", "st.uptime": "Uptime", "st.memory": "Memory", "st.servers": "Servers", "st.players": "Active players",
      "st.state": "State", "st.connected": "Connected", "st.disconnected": "Disconnected", "st.address": "Address",
      "st.nodelinkHelp": "Searches and prepares songs for playback.", "st.voice": "Voice commands", "st.disabled": "Disabled",
      "st.wOk": "Whisper is responding", "st.wBad": "Whisper is not responding", "st.wCheck": "Checking", "st.wake": "Wake word",
      "st.atEnd": "At the end", "st.onSkip": "On skip", "st.days": "d",
    },
    ro: {
      "login.intro": "Introdu parola panoului ca să controlezi botul.", "login.password": "Parolă", "login.submit": "Intră în panou",
      "top.live": "Conectare live", "top.sections": "Secțiuni", "top.logout": "Ieși",
      "tab.player": "Player", "tab.settings": "Setări", "tab.status": "Status",
      "rail.title": "Canale de voce",
      "add.title": "Adaugă muzică", "add.placeholder": "Nume melodie, artist sau link YouTube / Spotify", "add.search": "Caută", "add.source": "Sursă",
      "queue.title": "Coada", "queue.shuffle": "Amestecă", "queue.clear": "Golește",
      "set.sections": "Secțiuni de setări", "set.serverTitle": "Setările serverului", "set.serverDesc": "Se aplică doar serverului ales și intră în vigoare imediat.",
      "set.restartTitle": "Repornire", "set.restartDesc": "Setările marcate „după repornire” se aplică doar după ce botul pornește din nou. Repornirea durează 10–20 de secunde, iar muzica se reia singură.",
      "set.restartBtn": "Repornește botul",
      "set.footer": "Tokenul botului, baza de date și conexiunea la NodeLink se schimbă doar din <code>docker/config.json</code>. O greșeală acolo ar opri botul, inclusiv acest panou.",
      "log.title": "Jurnal", "log.filter": "Filtrează", "log.filterAria": "Filtrează jurnalul", "log.level": "Nivel", "log.all": "Toate",
      "log.warn": "Avertismente și erori", "log.error": "Doar erori", "log.follow": "Urmărește", "log.aria": "Jurnalul botului", "log.none": "Nicio linie de afișat.",
      "err.expired": "Sesiunea a expirat. Intră din nou.", "err.code": "Eroare {0}",
      "unknown": "Necunoscut",
      "g.paused": "Pe pauză", "g.playing": "Cântă", "g.connected": "Conectat", "g.join": "Intră", "g.joining": "Intră…",
      "g.noVoice": "Niciun canal de voce.", "g.noServers": "Botul nu este încă în niciun server.", "g.inviteHint": "Adaugă-l pe un server cu linkul de invitație:",
      "inv.add": "Adaugă pe un server", "inv.copy": "Copiază linkul", "inv.copied": "Linkul de invitație a fost copiat.", "inv.label": "Link de invitație",
      "d.emptyTitle": "Botul nu e în niciun canal", "d.emptyText": "Alege un canal de voce din listă și apasă Intră. Apoi caută o melodie mai jos.",
      "d.on": "{0} pe {1}", "d.nothing": "Nu cântă nimic", "d.nothingHint": "Caută o melodie mai jos ca să pornească redarea.",
      "d.leave": "Scoate botul din canal", "d.seek": "Poziție în melodie", "d.play": "Pornește", "d.pause": "Pauză",
      "d.next": "Următoarea melodie", "d.stop": "Oprește și golește coada", "d.volume": "Volum",
      "d.chips": "Repetare și autoplay", "d.loopSong": "Repetă melodia", "d.loopQueue": "Repetă coada",
      "d.leaveConfirm": "Scoți botul din canal? Coada se va pierde.",
      "q.songs": (n) => `${n} ${n === 1 ? "melodie" : "melodii"}`, "q.empty": "Coada e goală. Melodiile adăugate apar aici, în ordinea în care vor cânta.",
      "q.drag": "Trage ca să muți", "q.playNow": "Cântă acum", "q.up": "Mută mai sus", "q.down": "Mută mai jos", "q.remove": "Scoate din coadă",
      "q.more": (n) => `și încă ${n} melodii`, "q.shuffled": "Coada a fost amestecată.", "q.clearConfirm": "Golești coada? Melodia curentă continuă.",
      "s.searching": "Caut „{0}”…", "s.none": "Nu am găsit nimic pentru „{0}”. Încearcă alt nume sau altă sursă.",
      "s.playlist": "Playlist: {0}", "s.shown": "{0} melodii afișate", "s.addAll": "Adaugă tot",
      "s.nowTitle": "Oprește melodia curentă și o pornește pe aceasta", "s.now": "Cântă acum", "s.next": "Următoarea", "s.queue": "În coadă",
      "s.needPlayer": "Ca să adaugi melodii, întâi pune botul într-un canal de voce.",
      "c.default": "implicit", "c.secretSet": "Setată, lasă gol ca să rămână", "c.secretUnset": "Nesetată", "c.onePerLine": "câte unul pe linie",
      "c.off": "Oprit", "c.afterRestart": "după repornire", "c.afterRestartTitle": "Se aplică după repornirea botului", "c.save": "Salvează",
      "nav.server": "Server", "nav.restart": "Repornire",
      "r.changed": "Ai schimbat setări care se aplică după repornire: <strong>{0}</strong>. Repornește botul când ești gata.",
      "r.confirm": "Repornești botul? Muzica se oprește câteva secunde și apoi se reia.", "r.restarting": "Repornește…",
      "r.toast": "Botul repornește. Pagina se reconectează singură.",
      "ss.noServer": "Botul nu este în niciun server.", "ss.notLoaded": "Setările acestui server nu sunt încă încărcate.",
      "ss.prefix": "Prefix", "ss.prefixHelp": "Caracterele cu care încep comenzile în acest server (1–5, fără spații).",
      "ss.lang": "Limba botului", "ss.langHelp": "Limba răspunsurilor botului în acest server.",
      "ss.vol": "Volum implicit", "ss.volHelp": "Volumul cu care pornește botul în acest server (1–200%).",
      "ss.ap": "Autoplay pornit implicit", "ss.apHelp": "Când botul intră într-un canal, pornește singur autoplay: la finalul cozii adaugă melodii asemănătoare.",
      "ss.ann": "Anunță fiecare melodie", "ss.annHelp": "Trimite un mesaj în chat când începe o melodie nouă.",
      "ss.vote": "Vot pentru skip", "ss.voteHelp": "Când sunt mai mulți ascultători, skip-ul cere majoritatea voturilor.",
      "ss.thr": "Votul începe de la", "ss.thrHelp": "Numărul de ascultători de la care skip-ul cere vot (2–50).", "ss.thrAria": "Prag vot", "ss.people": "persoane",
      "ss.247": "Canal 24/7", "ss.247Help": "Botul stă permanent în acest canal și revine singur dacă e deconectat.",
      "st.name": "Nume", "st.uptime": "Pornit de", "st.memory": "Memorie", "st.servers": "Servere", "st.players": "Playere active",
      "st.state": "Stare", "st.connected": "Conectat", "st.disconnected": "Deconectat", "st.address": "Adresă",
      "st.nodelinkHelp": "Caută și pregătește melodiile pentru redare.", "st.voice": "Comenzi vocale", "st.disabled": "Dezactivate",
      "st.wOk": "Whisper răspunde", "st.wBad": "Whisper nu răspunde", "st.wCheck": "Se verifică", "st.wake": "Cuvânt de activare",
      "st.atEnd": "La final", "st.onSkip": "La skip", "st.days": "z",
    },
  };
  let LANG_UI = "en";
  try { if (localStorage.getItem("djmitica.lang") === "ro") LANG_UI = "ro"; } catch (_) {}
  const LOCALE = () => (LANG_UI === "ro" ? "ro-RO" : "en-GB");
  /** Translate a key; {0}, {1}… are replaced by the extra arguments. */
  function T(key, ...args) {
    const v = I18N[LANG_UI]?.[key] ?? I18N.en[key] ?? key;
    if (typeof v === "function") return v(...args);
    return args.length ? v.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)] ?? "") : v;
  }
  /** Translate the static page texts (data-i18n attributes). */
  function applyI18n() {
    document.documentElement.lang = LANG_UI;
    $$("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
    $$("[data-i18n-html]").forEach((el) => { el.innerHTML = T(el.dataset.i18nHtml); });
    $$("[data-i18n-placeholder]").forEach((el) => { el.placeholder = T(el.dataset.i18nPlaceholder); });
    $$("[data-i18n-aria]").forEach((el) => { el.setAttribute("aria-label", T(el.dataset.i18nAria)); });
    $$("[data-i18n-title]").forEach((el) => { el.title = T(el.dataset.i18nTitle); });
  }
  function setLanguage(lang) {
    const l = lang === "ro" ? "ro" : "en";
    try { localStorage.setItem("djmitica.lang", l); } catch (_) {}
    if (l === LANG_UI) return false;
    LANG_UI = l;
    applyI18n();
    return true;
  }
  applyI18n();
  const title = (t) => t?.title || T("unknown");

  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 6.3v11.4a1 1 0 0 0 1.53.85L15 13.2V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.8L6.53 5.45A1 1 0 0 0 5 6.3z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    vol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6"/></svg>',
    disc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3a9 9 0 0 1 9 9" opacity=".5"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 14l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 10l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
    jump: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9 6.5v11a1 1 0 0 0 1.5.86l9-5.5a1 1 0 0 0 0-1.72l-9-5.5A1 1 0 0 0 9 6.5z"/><rect x="4" y="6" width="2.5" height="12" rx="1"/></svg>',
  };

  // images that fail to load (the CSP forbids inline onerror)
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fb) return;
    if (img.dataset.fb === "remove") img.remove(); else img.style.visibility = "hidden";
  }, true);

  /* ------------------------------------------------------------ API */
  async function api(path, body, method) {
    const opts = { method: method ?? (body ? "POST" : "GET"), headers: { "X-Requested-With": "djmitica-web" }, credentials: "same-origin" };
    if (body) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
    const res = await fetch(path, opts);
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (res.status === 401 && path !== "api/login") { showLogin(); throw new Error(T("err.expired")); }
    if (!res.ok) throw new Error(data.error || T("err.code", res.status));
    return data;
  }

  function toast(msg, isErr = false) {
    if (!msg) return;
    const el = document.createElement("div");
    el.className = "toast" + (isErr ? " err" : "");
    el.textContent = msg;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), isErr ? 6000 : 3500);
  }

  async function act(path, body, okMsg) {
    try {
      const r = await api(path, body ?? {});
      toast(okMsg ?? r.message);
      return r;
    } catch (e) { toast(e.message, true); return null; }
  }

  /* -------------------------------------------------------- state */
  const S = {
    state: null,
    receivedAt: 0,
    selected: localStorage.getItem("djmitica.sel") || null, // channelId
    tab: "player",
    dragging: false,
    seeking: false,
    interacting: false,
    volTimer: null,
    logs: [],
    lastLogId: 0,
    es: null,
  };

  const currentPlayer = () => {
    const ps = S.state?.players ?? [];
    return ps.find((p) => p.channelId === S.selected) ?? ps[0] ?? null;
  };

  /* -------------------------------------------------------- login */
  function showLogin() {
    S.es?.close(); S.es = null;
    $("#app").hidden = true;
    $("#login").hidden = false;
    setTimeout(() => $("#login-pass").focus(), 50);
  }
  async function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    connect();
    loadSettings();
  }
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter ?? $("#login-form button");
    btn.disabled = true;
    $("#login-error").textContent = "";
    try {
      await api("api/login", { password: $("#login-pass").value });
      $("#login-pass").value = "";
      showApp();
    } catch (err) {
      $("#login-error").textContent = err.message;
    } finally { btn.disabled = false; }
  });
  $("#logout").addEventListener("click", async () => {
    try { await api("api/logout", {}); } catch (_) {}
    showLogin();
  });

  /* ---------------------------------------------------------- tabs */
  function setTab(t) {
    S.tab = t;
    $$(".tab").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    for (const v of ["player", "settings", "status"]) $("#tab-" + v).hidden = v !== t;
    if (t === "status") { loadStatus(); renderLogs(true); }
    if (t === "settings") loadSettings();
    history.replaceState(null, "", "#" + t);
  }
  $$(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));

  /* ----------------------------------------------------------- live */
  function connect() {
    S.es?.close();
    const es = new EventSource("api/events");
    S.es = es;
    es.addEventListener("open", () => $("#live-dot").classList.add("on"));
    es.addEventListener("error", async () => {
      $("#live-dot").classList.remove("on");
      if (es.readyState === EventSource.CLOSED) {
        try { const s = await api("api/session"); if (s.language && setLanguage(s.language)) loadSettings(); if (!s.authenticated) return showLogin(); } catch (_) {}
        setTimeout(connect, 3000);
      }
    });
    es.addEventListener("state", (ev) => { S.lastSse = Date.now(); applyState(JSON.parse(ev.data)); });
    es.addEventListener("log", (ev) => addLog(JSON.parse(ev.data)));
    es.addEventListener("ping", () => { S.lastSse = Date.now(); });
    loadLogs();
  }

  // fallback: if live events don't arrive (a proxy blocking them), poll the state
  setInterval(async () => {
    if ($("#app").hidden || document.hidden) return;
    if (S.es && S.es.readyState === EventSource.OPEN && Date.now() - (S.lastSse ?? 0) < 25000) return;
    try { applyState(await api("api/state")); } catch (_) {}
  }, 4000);

  function applyState(st) {
    S.state = st;
    S.receivedAt = Date.now();
    if (st.bot) {
      $("#bot-name").textContent = st.bot.name;
      if (st.bot.avatar) $("#bot-avatar").src = st.bot.avatar;
    }
    const ps = st.players ?? [];
    if (!ps.find((p) => p.channelId === S.selected)) S.selected = ps[0]?.channelId ?? null;
    if (!$("#search-provider").options.length) {
      $("#search-provider").innerHTML = (st.providers ?? []).map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join("");
    }
    $("#tab-player").classList.toggle("no-player", !ps.length);
    renderGuilds();
    renderDeck();
    if (!S.dragging) renderQueue();
    fillGuildSelect();
  }

  /* ----------------------------------------------------- channels */
  function renderGuilds() {
    const st = S.state;
    const players = st.players ?? [];
    const html = (st.guilds ?? []).map((g) => {
      const icon = g.icon ? `<img src="${esc(g.icon)}" alt="" data-fb="remove">` : initials(g.name);
      const vcs = g.voiceChannels.map((c) => {
        const p = players.find((x) => x.channelId === c.id);
        const people = c.listeners.map((u) => `<span class="avatar" title="${esc(u.name)}">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" data-fb="remove">` : ""}${u.avatar ? "" : initials(u.name)}</span>`).join("");
        const btn = p
          ? `<span class="badge">${p.paused ? T("g.paused") : p.current ? T("g.playing") : T("g.connected")}</span>`
          : `<button class="btn btn-ghost btn-sm" data-join="${esc(c.id)}" type="button">${T("g.join")}</button>`;
        return `<div class="vc${p ? " has-player" : ""}${p && p.channelId === currentPlayer()?.channelId ? " active" : ""}" ${p ? `data-select="${esc(c.id)}"` : ""}>
          <div class="vc-name" ${p ? 'role="button" tabindex="0"' : ""}>${ICON.voice}<span>${esc(c.name)}</span></div>${btn}
          ${people ? `<div class="people">${people}</div>` : ""}</div>`;
      }).join("") || `<p class="muted small">${T("g.noVoice")}</p>`;
      return `<div class="guild"><div class="guild-head"><span class="guild-icon">${icon}</span><span>${esc(g.name)}</span></div>${vcs}</div>`;
    }).join("") || `<p class="muted">${T("g.noServers")}</p>${st.bot?.invite ? `<p class="muted small">${T("g.inviteHint")}</p>${inviteButtons(st.bot.invite)}` : ""}`;
    $("#guilds").innerHTML = html;
  }
  $("#guilds").addEventListener("click", async (e) => {
    const j = e.target.closest("[data-join]");
    if (j) {
      j.disabled = true; j.textContent = T("g.joining");
      const r = await act("api/join", { channelId: j.dataset.join });
      if (r) { S.selected = j.dataset.join; localStorage.setItem("djmitica.sel", S.selected); }
      j.disabled = false;
      return;
    }
    const s = e.target.closest("[data-select]");
    if (s) { S.selected = s.dataset.select; localStorage.setItem("djmitica.sel", S.selected); renderAll(); }
  });
  $("#guilds").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-select]")) { e.preventDefault(); e.target.click(); }
  });

  function renderAll() { renderGuilds(); renderDeck(); renderQueue(); }

  /* -------------------------------------------------------- invite */
  const inviteButtons = (url) => `<div class="invite-row">
      <a class="btn btn-primary btn-sm" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${T("inv.add")}</a>
      <button class="btn btn-ghost btn-sm" type="button" data-copy-invite="${esc(url)}">${T("inv.copy")}</button></div>`;
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-copy-invite]"); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copyInvite); toast(T("inv.copied")); }
    catch (_) { window.prompt(T("inv.label"), b.dataset.copyInvite); }
  });

  /* ----------------------------------------------------------- deck */
  function renderDeck() {
    if (S.interacting) { S.deckStale = true; return; }
    S.deckStale = false;
    const p = currentPlayer();
    const area = $("#deck-area");
    if (!p) {
      area.innerHTML = `<div class="panel empty">${ICON.disc}<h2>${T("d.emptyTitle")}</h2>
        <p>${T("d.emptyText")}</p></div>`;
      return;
    }
    const c = p.current;
    const pl = (path) => `api/player/${p.channelId}/${path}`;
    area.dataset.channel = p.channelId;
    if (!c) {
      area.innerHTML = `<div class="deck">
        <div class="deck-art"><div class="ph">${ICON.disc}</div></div>
        <div class="deck-body">
          <div class="deck-where">${ICON.voice}<span>${esc(T("d.on", p.channelName, p.guildName))}</span></div>
          <div><div class="deck-title">${T("d.nothing")}</div><div class="deck-artist">${T("d.nothingHint")}</div></div>
          <div class="transport">${chips(p)}<button class="btn btn-ghost btn-sm danger" data-act="leave" type="button">${T("d.leave")}</button></div>
        </div></div>`;
      return;
    }
    const art = c.thumbnail ? `<img src="${esc(c.thumbnail)}" alt="" data-fb="remove">` : "";
    area.innerHTML = `<div class="deck${p.paused ? " paused" : ""}">
      <div class="deck-art"><div class="ph">${ICON.disc}</div>${art}</div>
      <div class="deck-body">
        <div class="deck-where">${ICON.voice}<span>${esc(T("d.on", p.channelName, p.guildName))}</span><span class="vu" aria-hidden="true">${"<i></i>".repeat(12)}</span></div>
        <div>
          <div class="deck-title">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(title(c))}</a>` : esc(title(c))}</div>
          <div class="deck-artist">${esc(c.author ?? "")}</div>
        </div>
        <div class="progress num">
          <span id="pos">${fmt(p.positionMs)}</span>
          <input id="seek" type="range" min="0" max="${c.durationMs || 1}" value="${p.positionMs}" step="1000" aria-label="${T("d.seek")}" ${c.live || !c.durationMs ? "disabled" : ""}>
          <span>${c.live ? "LIVE" : fmt(c.durationMs)}</span>
        </div>
        <div class="transport">
          <button class="icon-btn play" data-act="toggle" type="button" aria-label="${p.paused ? T("d.play") : T("d.pause")}" title="${p.paused ? T("d.play") : T("d.pause")}">${p.paused ? ICON.play : ICON.pause}</button>
          <button class="icon-btn" data-act="skip" type="button" aria-label="${T("d.next")}" title="${T("d.next")}">${ICON.skip}</button>
          <button class="icon-btn" data-act="stop" type="button" aria-label="${T("d.stop")}" title="${T("d.stop")}">${ICON.stop}</button>
          <div class="vol">${ICON.vol}<input id="vol" type="range" min="0" max="200" step="1" value="${p.volume}" aria-label="${T("d.volume")}"><output id="vol-out" class="num">${p.volume}%</output></div>
        </div>
        <div class="transport">${chips(p)}<button class="btn btn-ghost btn-sm danger" data-act="leave" type="button">${T("d.leave")}</button></div>
      </div></div>`;
    paintRange($("#seek")); paintRange($("#vol"));
  }

  function chips(p) {
    const loop = p.loop.song ? "song" : p.loop.queue ? "queue" : "off";
    return `<div class="chips" role="group" aria-label="${T("d.chips")}">
      <button class="chip" type="button" data-loop="${loop === "song" ? "off" : "song"}" aria-pressed="${loop === "song"}">${T("d.loopSong")}</button>
      <button class="chip" type="button" data-loop="${loop === "queue" ? "off" : "queue"}" aria-pressed="${loop === "queue"}">${T("d.loopQueue")}</button>
      <button class="chip" type="button" data-autoplay="${!p.autoplay}" aria-pressed="${p.autoplay}">Autoplay</button>
    </div>`;
  }

  function paintRange(r) {
    if (!r) return;
    const pct = ((r.value - r.min) / ((r.max - r.min) || 1)) * 100;
    r.style.setProperty("--fill", pct + "%");
  }

  $("#deck-area").addEventListener("click", async (e) => {
    const ch = $("#deck-area").dataset.channel;
    if (!ch) return;
    const b = e.target.closest("button");
    if (!b) return;
    const base = `api/player/${ch}/`;
    if (b.dataset.act === "leave") {
      if (!confirm(T("d.leaveConfirm"))) return;
      return act(base + "leave");
    }
    if (b.dataset.act) return act(base + b.dataset.act, {}, b.dataset.act === "toggle" || b.dataset.act === "skip" ? "" : undefined);
    if (b.dataset.loop) return act(base + "loop", { mode: b.dataset.loop });
    if (b.dataset.autoplay) return act(base + "autoplay", { enabled: b.dataset.autoplay === "true" });
  });
  $("#deck-area").addEventListener("input", (e) => {
    const ch = $("#deck-area").dataset.channel;
    if (e.target.id === "vol") {
      paintRange(e.target);
      $("#vol-out").textContent = e.target.value + "%";
      clearTimeout(S.volTimer);
      const v = Number(e.target.value);
      S.volTimer = setTimeout(() => act(`api/player/${ch}/volume`, { value: v }, ""), 250);
    }
    if (e.target.id === "seek") {
      S.seeking = true;
      paintRange(e.target);
      $("#pos").textContent = fmt(Number(e.target.value));
    }
  });
  $("#deck-area").addEventListener("pointerdown", (e) => {
    if (e.target.type === "range") S.interacting = true;
  });
  window.addEventListener("pointerup", () => {
    if (!S.interacting) return;
    setTimeout(() => { S.interacting = false; if (S.deckStale) renderDeck(); }, 400);
  });
  $("#deck-area").addEventListener("change", async (e) => {
    if (e.target.id === "seek") {
      const ch = $("#deck-area").dataset.channel;
      await act(`api/player/${ch}/seek`, { ms: Number(e.target.value) }, "");
      S.seeking = false;
    }
  });

  // progress + decorative VU meter
  setInterval(() => {
    const p = currentPlayer();
    const c = p?.current;
    if (!c || S.seeking) return;
    let pos = p.positionMs + (p.paused ? 0 : Date.now() - S.receivedAt);
    if (c.durationMs) pos = Math.min(pos, c.durationMs);
    const seek = $("#seek");
    if (seek && document.activeElement !== seek) { seek.value = pos; paintRange(seek); }
    const posEl = $("#pos");
    if (posEl) posEl.textContent = fmt(pos);
  }, 250);
  if (!reduceMotion) {
    let level = 0;
    setInterval(() => {
      const p = currentPlayer();
      const leds = $$(".vu i");
      if (!leds.length || !p?.current || p.paused) return;
      level = Math.max(3, Math.min(12, level + Math.round((Math.random() - 0.45) * 5)));
      leds.forEach((l, i) => { l.className = i < level ? "on" + (i >= 10 ? " peak" : i >= 7 ? " hot" : "") : ""; });
    }, 110);
  }

  /* --------------------------------------------------------- queue */
  function renderQueue() {
    const p = currentPlayer();
    const q = $("#queue");
    $("#q-shuffle").disabled = $("#q-clear").disabled = !p || !p.queueTotal;
    if (!p) { q.innerHTML = ""; $("#queue-meta").textContent = ""; return; }
    $("#queue-meta").textContent = p.queueTotal ? `${T("q.songs", p.queueTotal)}, ${fmtLong(p.queueRemainingMs)}` : "";
    if (!p.queue.length) {
      q.innerHTML = `<li class="queue-empty">${T("q.empty")}</li>`;
      return;
    }
    const n = p.queue.length;
    q.innerHTML = p.queue.map((t, i) => `
      <li class="q-item" draggable="true" data-i="${i}">
        <span class="q-pos num" title="${T("q.drag")}">${i + 1}</span>
        ${t.thumbnail ? `<img class="thumb" src="${esc(t.thumbnail)}" alt="" loading="lazy" data-fb="hide">` : `<span class="thumb"></span>`}
        <div class="t-main"><div class="t-title" title="${esc(title(t))}">${esc(title(t))}</div><div class="t-sub">${esc(t.author ?? "")}</div></div>
        <span class="q-dur num">${t.live ? "LIVE" : fmt(t.durationMs)}</span>
        <div class="q-actions">
          <button class="icon-btn sm" data-q="jump" title="${T("q.playNow")}" aria-label="${T("q.playNow")}: ${esc(title(t))}">${ICON.jump}</button>
          <button class="icon-btn sm" data-q="up" title="${T("q.up")}" aria-label="${T("q.up")}" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
          <button class="icon-btn sm" data-q="down" title="${T("q.down")}" aria-label="${T("q.down")}" ${i === n - 1 ? "disabled" : ""}>${ICON.down}</button>
          <button class="icon-btn sm" data-q="remove" title="${T("q.remove")}" aria-label="${T("q.remove")}: ${esc(title(t))}">${ICON.x}</button>
        </div>
      </li>`).join("") + (p.queueTotal > n ? `<li class="q-more">${T("q.more", p.queueTotal - n)}</li>` : "");
  }

  $("#queue").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    const p = currentPlayer();
    if (!b || !p) return;
    const i = Number(b.closest(".q-item").dataset.i);
    const base = `api/player/${p.channelId}/`;
    if (b.dataset.q === "remove") act(base + "remove", { index: i });
    if (b.dataset.q === "up") act(base + "move", { from: i, to: i - 1 }, "");
    if (b.dataset.q === "down") act(base + "move", { from: i, to: i + 1 }, "");
    if (b.dataset.q === "jump") act(base + "jump", { index: i });
  });

  // drag & drop
  let dragFrom = null;
  $("#queue").addEventListener("dragstart", (e) => {
    const li = e.target.closest(".q-item"); if (!li) return;
    dragFrom = Number(li.dataset.i); S.dragging = true;
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragFrom));
  });
  $("#queue").addEventListener("dragover", (e) => {
    const li = e.target.closest(".q-item"); if (!li || dragFrom === null) return;
    e.preventDefault();
    $$(".q-item").forEach((x) => x.classList.remove("drop-before", "drop-after"));
    const r = li.getBoundingClientRect();
    li.classList.add(e.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
  });
  $("#queue").addEventListener("drop", (e) => {
    const li = e.target.closest(".q-item"); const p = currentPlayer();
    if (!li || dragFrom === null || !p) return;
    e.preventDefault();
    let to = Number(li.dataset.i);
    const after = li.classList.contains("drop-after");
    if (after) to += 1;
    if (to > dragFrom) to -= 1;
    const from = dragFrom;
    endDrag();
    if (to !== from) act(`api/player/${p.channelId}/move`, { from, to }, "");
  });
  const endDrag = () => {
    dragFrom = null; S.dragging = false;
    $$(".q-item").forEach((x) => x.classList.remove("dragging", "drop-before", "drop-after"));
  };
  $("#queue").addEventListener("dragend", () => { endDrag(); renderQueue(); });

  $("#q-shuffle").addEventListener("click", () => { const p = currentPlayer(); if (p) act(`api/player/${p.channelId}/shuffle`, {}, T("q.shuffled")); });
  $("#q-clear").addEventListener("click", () => {
    const p = currentPlayer(); if (!p) return;
    if (confirm(T("q.clearConfirm"))) act(`api/player/${p.channelId}/clear`);
  });

  /* -------------------------------------------------------- search */
  let lastResults = [];
  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#search-q").value.trim();
    const box = $("#search-results");
    if (!q) { box.innerHTML = ""; return; }
    box.innerHTML = `<p class="muted small">${esc(T("s.searching", q))}</p>`;
    try {
      const r = await api(`api/search?q=${encodeURIComponent(q)}&provider=${encodeURIComponent($("#search-provider").value)}`);
      lastResults = r.results ?? [];
      if (!lastResults.length) { box.innerHTML = `<p class="muted small">${esc(T("s.none", q))}</p>`; return; }
      const hasPlayer = !!currentPlayer();
      const head = r.playlist ? `<div class="result"><span class="thumb"></span><div class="t-main"><div class="t-title">${esc(T("s.playlist", r.playlist))}</div><div class="t-sub">${T("s.shown", lastResults.length)}</div></div>
        <div class="result-actions"><button class="btn btn-sm btn-primary" data-add-url="${esc(q)}" data-mode="end" ${hasPlayer ? "" : "disabled"}>${T("s.addAll")}</button></div></div>` : "";
      box.innerHTML = head + lastResults.map((t, i) => `
        <div class="result">
          ${t.thumbnail ? `<img class="thumb" src="${esc(t.thumbnail)}" alt="" loading="lazy" data-fb="hide">` : `<span class="thumb"></span>`}
          <div class="t-main"><div class="t-title" title="${esc(title(t))}">${esc(title(t))}</div><div class="t-sub">${esc(t.author ?? "")}${t.durationMs ? ", " + fmt(t.durationMs) : ""}</div></div>
          <div class="result-actions">
            <button class="btn btn-sm btn-ghost" data-r="${i}" data-mode="now" ${hasPlayer ? "" : "disabled"} title="${T("s.nowTitle")}">${T("s.now")}</button>
            <button class="btn btn-sm btn-ghost" data-r="${i}" data-mode="next" ${hasPlayer ? "" : "disabled"}>${T("s.next")}</button>
            <button class="btn btn-sm btn-primary" data-r="${i}" data-mode="end" ${hasPlayer ? "" : "disabled"}>${T("s.queue")}</button>
          </div>
        </div>`).join("") + (hasPlayer ? "" : `<p class="muted small">${T("s.needPlayer")}</p>`);
    } catch (err) {
      box.innerHTML = `<p class="form-error">${esc(err.message)}</p>`;
    }
  });
  $("#search-results").addEventListener("click", async (e) => {
    const b = e.target.closest("button"); const p = currentPlayer();
    if (!b || !p) return;
    const query = b.dataset.addUrl ?? lastResults[Number(b.dataset.r)]?.url;
    if (!query) return;
    b.disabled = true;
    await act(`api/player/${p.channelId}/add`, { query, mode: b.dataset.mode, provider: $("#search-provider").value });
    b.disabled = false;
  });

  /* ------------------------------------------------------- settings */
  function fillGuildSelect() {
    const sel = $("#settings-guild");
    const gs = S.state?.guilds ?? [];
    const key = gs.map((g) => g.id + g.name).join("|");
    if (sel.dataset.key === key) return;
    const prev = sel.value;
    sel.dataset.key = key;
    sel.innerHTML = gs.map((g) => `<option value="${esc(g.id)}">${esc(g.name)}</option>`).join("");
    if (prev && gs.some((g) => g.id === prev)) sel.value = prev;
    if (S.tab === "settings") loadServerSettings();
  }

  const LANG = { en: "English", "de-DE": "Deutsch", "pt-BR": "Português (Brasil)", tr: "Türkçe", "ar-SA": "العربية", ckb: "کوردی", ro: "Română" };
  const rowHtml = (label, help, control, extra = "") => `
    <div class="setting">
      <div class="sw-text"><span>${esc(label)}${extra}</span>${help ? `<span>${esc(help)}</span>` : ""}</div>
      <div class="setting-ctl">${control}</div>
    </div>`;
  const toggle = (id, on, label) => `<label class="toggle"><input id="${id}" type="checkbox" ${on ? "checked" : ""} aria-label="${esc(label)}"><span></span></label>`;

  async function loadSettings() {
    loadServerSettings();
    try {
      const r = await api("api/config");
      renderGlobal(r.sections);
    } catch (e) { $("#global-settings").innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }

  function renderNav(sections) {
    const items = [["sec-server", T("nav.server")], ...sections.map((s) => ["sec-" + s.id, s.title]), ["sec-restart", T("nav.restart")]];
    $("#settings-nav").innerHTML = items.map(([id, t]) => `<a href="#${id}" data-goto="${id}">${esc(t)}</a>`).join("");
  }
  $("#settings-nav").addEventListener("click", (e) => {
    const a = e.target.closest("[data-goto]"); if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.goto)?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  });

  function fieldControl(f, idx) {
    const id = "cfg-" + idx;
    const v = f.value;
    switch (f.type) {
      case "bool": return toggle(id, v, f.label);
      case "number": {
        const range = (f.max - f.min) / (f.step || 1);
        if (range <= 60) {
          return `<div class="slider-field"><input id="${id}" type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" aria-label="${esc(f.label)}"><output for="${id}" class="num">${fmtNum(v, f)}</output></div>`;
        }
        return `<div class="num-field"><input id="${id}" type="number" min="${f.min ?? ""}" max="${f.max ?? ""}" step="${f.step ?? 1}" value="${v ?? ""}" aria-label="${esc(f.label)}"${f.optional ? ` placeholder="${T("c.default")}"` : ""}>${f.unit ? `<span class="muted">${esc(f.unit)}</span>` : ""}</div>`;
      }
      case "color": return `<div class="color-field"><input id="${id}" type="color" value="${esc(v)}" aria-label="${esc(f.label)}"><span class="num muted">${esc(v)}</span></div>`;
      case "secret": return `<input id="${id}" type="password" autocomplete="new-password" placeholder="${v.isSet ? T("c.secretSet") : T("c.secretUnset")}" aria-label="${esc(f.label)}">`;
      case "select": return `<select id="${id}" aria-label="${esc(f.label)}">${(f.options ?? []).map((o) => `<option value="${esc(o.value)}" ${o.value === v ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
      case "list": return `<textarea id="${id}" rows="${Math.max(2, Math.min(6, v.length + 1))}" placeholder="${esc(f.itemHint ?? "")}, ${T("c.onePerLine")}" aria-label="${esc(f.label)}">${esc(v.join("\n"))}</textarea>`;
      default: return `<input id="${id}" type="text" value="${esc(v)}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ""} aria-label="${esc(f.label)}">`;
    }
  }
  const fmtNum = (v, f) => (Number(v) === 0 && f.path?.includes("rossfade")) ? T("c.off") : `${Number(v).toLocaleString(LOCALE())}${f.unit ? " " + f.unit : ""}`;

  let globalFields = [];
  function renderGlobal(sections) {
    renderNav(sections);
    globalFields = [];
    $("#global-settings").innerHTML = sections.map((sec) => {
      const rows = sec.fields.map((f) => {
        const idx = globalFields.push({ ...f, section: sec.id }) - 1;
        const badge = f.live ? "" : ` <span class="tag" title="${T("c.afterRestartTitle")}">${T("c.afterRestart")}</span>`;
        return rowHtml(f.label, f.help, fieldControl(f, idx), badge);
      }).join("");
      return `<section class="panel" id="sec-${esc(sec.id)}">
        <h2 class="panel-title">${esc(sec.title)}</h2>
        <p class="muted small sec-desc">${esc(sec.desc ?? "")}</p>
        ${rows}
        <div class="row-end"><button class="btn btn-primary" data-save-sec="${esc(sec.id)}" type="button" disabled>${T("c.save")}</button></div>
      </section>`;
    }).join("");
  }

  const readField = (f, idx) => {
    const el = $("#cfg-" + idx);
    if (!el) return undefined;
    switch (f.type) {
      case "bool": return el.checked;
      case "number": return el.value === "" ? "" : Number(el.value);
      case "list": return el.value.split("\n").map((x) => x.trim()).filter(Boolean);
      default: return el.value;
    }
  };
  const sameVal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = (f, idx) => {
    const v = readField(f, idx);
    if (f.type === "secret") return !!v;
    return !sameVal(v, f.value);
  };

  $("#global-settings").addEventListener("input", (e) => {
    const m = e.target.id?.match(/^cfg-(\d+)$/); if (!m) return;
    const idx = Number(m[1]); const f = globalFields[idx];
    if (e.target.type === "range") { paintRange(e.target); e.target.nextElementSibling.textContent = fmtNum(e.target.value, f); }
    if (e.target.type === "color") e.target.nextElementSibling.textContent = e.target.value;
    const btn = $(`[data-save-sec="${f.section}"]`);
    btn.disabled = !globalFields.some((g, i) => g.section === f.section && isDirty(g, i));
  });
  $("#global-settings").addEventListener("change", (e) => e.target.dispatchEvent(new Event("input", { bubbles: true })));
  $("#global-settings").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-save-sec]"); if (!btn) return;
    const changes = {};
    globalFields.forEach((f, i) => { if (f.section === btn.dataset.saveSec && isDirty(f, i)) changes[f.path] = readField(f, i); });
    if (!Object.keys(changes).length) return;
    btn.disabled = true;
    try {
      const r = await api("api/config", { changes });
      toast(r.message);
      if (r.language && setLanguage(r.language)) { if (S.state) renderAll(); loadServerSettings(); if (S.tab === "status") { loadStatus(); renderLogs(); } }
      if (r.restart?.length) markRestart(r.restart);
      const y = window.scrollY;
      renderGlobal(r.sections);
      window.scrollTo(0, y);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  function markRestart(labels) {
    const p = $("#sec-restart .sec-desc");
    p.innerHTML = T("r.changed", labels.map(esc).join(", "));
    $("#restart-bot").classList.add("btn-primary");
  }

  $("#restart-bot").addEventListener("click", async () => {
    if (!confirm(T("r.confirm"))) return;
    const btn = $("#restart-bot");
    btn.disabled = true; btn.textContent = T("r.restarting");
    try { await api("api/restart", {}); } catch (_) {}
    toast(T("r.toast"));
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 4000));
    while (Date.now() - t0 < 120000) {
      try { const s = await api("api/session"); if (s) break; } catch (_) {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    location.reload();
  });

  async function loadServerSettings() {
    const gid = $("#settings-guild").value;
    const box = $("#server-settings");
    if (!gid) { box.innerHTML = `<p class="muted">${T("ss.noServer")}</p>`; return; }
    try {
      const s = (await api("api/settings?guild=" + encodeURIComponent(gid))).server;
      if (!s) { box.innerHTML = `<p class="muted">${T("ss.notLoaded")}</p>`; return; }
      const langOpts = s.locales.map((l) => `<option value="${esc(l)}" ${l === s.locale ? "selected" : ""}>${esc(LANG[l] ?? l)}</option>`).join("");
      const vcOpts = `<option value="">${T("c.off")}</option>` + s.voiceChannels.map((c) => `<option value="${esc(c.id)}" ${c.id === s.stay247 ? "selected" : ""}>${esc(c.name)}</option>`).join("");
      box.innerHTML =
        rowHtml(T("ss.prefix"), T("ss.prefixHelp"),
          `<input id="ss-prefix" type="text" maxlength="5" value="${esc(s.prefix)}" aria-label="${T("ss.prefix")}" class="short">`) +
        rowHtml(T("ss.lang"), T("ss.langHelp"), `<select id="ss-locale" aria-label="${T("ss.lang")}">${langOpts}</select>`) +
        rowHtml(T("ss.vol"), T("ss.volHelp"),
          `<div class="num-field"><input id="ss-volume" type="number" min="1" max="200" value="${s.volume}" aria-label="${T("ss.vol")}"><span class="muted">%</span></div>`) +
        rowHtml(T("ss.ap"), T("ss.apHelp"), toggle("ss-autoplay", s.autoplay, T("ss.ap"))) +
        rowHtml(T("ss.ann"), T("ss.annHelp"), toggle("ss-ann", s.songAnnouncements, T("ss.ann"))) +
        rowHtml(T("ss.vote"), T("ss.voteHelp"), toggle("ss-vote", s.voteSkip, T("ss.vote"))) +
        rowHtml(T("ss.thr"), T("ss.thrHelp"),
          `<div class="num-field"><input id="ss-thr" type="number" min="2" max="50" value="${s.voteSkipThreshold}" aria-label="${T("ss.thrAria")}"><span class="muted">${T("ss.people")}</span></div>`) +
        rowHtml(T("ss.247"), T("ss.247Help"), `<select id="ss-247" aria-label="${T("ss.247")}">${vcOpts}</select>`) +
        `<div class="row-end"><button id="save-server" class="btn btn-primary" type="button">${T("c.save")}</button></div>`;
      $("#save-server").addEventListener("click", async () => {
        const server = {
          guildId: gid,
          prefix: $("#ss-prefix").value.trim(),
          locale: $("#ss-locale").value,
          volume: Number($("#ss-volume").value),
          songAnnouncements: $("#ss-ann").checked,
          autoplay: $("#ss-autoplay").checked,
          voteSkip: $("#ss-vote").checked,
          voteSkipThreshold: Number($("#ss-thr").value),
        };
        if ($("#ss-247").value !== s.stay247) server.stay247 = $("#ss-247").value;
        const r = await act("api/settings", { server });
        if (r) loadServerSettings();
      });
    } catch (e) { box.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  $("#settings-guild").addEventListener("change", loadServerSettings);

  /* --------------------------------------------------------- status */
  async function loadStatus() {
    try {
      const s = await api("api/status");
      const mb = (b) => `${Math.round(b / 1048576)} MB`;
      const up = (ms) => { const d = Math.floor(ms / 86400000); return (d ? d + " " + T("st.days") + " " : "") + fmt(ms % 86400000); };
      const led = (v) => v === true ? "ok" : v === false ? "bad" : "off";
      const w = s.whisper;
      $("#strips").innerHTML = `
        <div class="strip"><div class="strip-head"><span class="led ok"></span>Bot</div><dl class="kv">
          <dt>${T("st.name")}</dt><dd>${esc(s.bot.name ?? "-")}</dd>
          <dt>${T("st.uptime")}</dt><dd>${up(s.bot.uptimeMs)}</dd>
          <dt>${T("st.memory")}</dt><dd>${mb(s.bot.memory.rss)}</dd>
          <dt>${T("st.servers")}</dt><dd>${s.bot.guilds}</dd>
          <dt>${T("st.players")}</dt><dd>${s.bot.players}</dd>
          <dt>Node.js</dt><dd>${esc(s.bot.node)}</dd></dl>${s.bot.invite ? inviteButtons(s.bot.invite) : ""}</div>
        <div class="strip"><div class="strip-head"><span class="led ${led(s.nodelink.connected)}"></span>NodeLink</div><dl class="kv">
          <dt>${T("st.state")}</dt><dd>${s.nodelink.connected ? T("st.connected") : T("st.disconnected")}</dd>
          <dt>${T("st.address")}</dt><dd>${esc(s.nodelink.host ?? "-")}</dd></dl>
          <p class="muted small">${T("st.nodelinkHelp")}</p></div>
        <div class="strip"><div class="strip-head"><span class="led ${w.enabled ? led(w.ok) : "off"}"></span>${T("st.voice")}</div><dl class="kv">
          <dt>${T("st.state")}</dt><dd>${!w.enabled ? T("st.disabled") : w.ok ? T("st.wOk") : w.ok === false ? T("st.wBad") : T("st.wCheck")}</dd>
          ${w.enabled ? `<dt>${T("st.wake")}</dt><dd>${esc(w.wakeWord)}</dd>` : ""}</dl></div>
        <div class="strip"><div class="strip-head"><span class="led ${s.audio.crossfadeSeconds || s.audio.skipCrossfadeSeconds ? "ok" : "off"}"></span>Crossfade</div><dl class="kv">
          <dt>${T("st.atEnd")}</dt><dd>${s.audio.crossfadeSeconds ? s.audio.crossfadeSeconds + " s" : T("c.off")}</dd>
          <dt>${T("st.onSkip")}</dt><dd>${s.audio.skipCrossfadeSeconds ? s.audio.skipCrossfadeSeconds + " s" : T("c.off")}</dd></dl></div>`;
    } catch (e) { $("#strips").innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  setInterval(() => { if (S.tab === "status" && !document.hidden) loadStatus(); }, 10000);

  /* ------------------------------------------------------------ log */
  async function loadLogs() {
    try {
      const r = await api("api/logs?since=" + S.lastLogId);
      for (const l of r.lines) addLog(l, true);
      renderLogs(true);
    } catch (_) {}
  }
  function addLog(l, batch = false) {
    if (l.id <= S.lastLogId) return;
    S.lastLogId = l.id;
    S.logs.push(l);
    if (S.logs.length > 1500) S.logs.splice(0, S.logs.length - 1500);
    if (!batch && S.tab === "status") appendLogLine(l);
  }
  const logPass = (l) => {
    const lv = $("#log-level").value, f = $("#log-filter").value.trim().toLowerCase();
    if (lv === "warn" && l.level === "info") return false;
    if (lv === "error" && l.level !== "error") return false;
    if (f && !l.text.toLowerCase().includes(f)) return false;
    return true;
  };
  const logHtml = (l) => {
    const t = new Date(l.t).toLocaleTimeString(LOCALE(), { hour12: false });
    return `<span class="l-${l.level}"><span class="l-t">${t}</span>${esc(l.text)}</span>\n`;
  };
  function renderLogs() {
    const el = $("#log");
    el.innerHTML = S.logs.filter(logPass).map(logHtml).join("") || `<span class="muted">${T("log.none")}</span>`;
    if ($("#log-follow").checked) el.scrollTop = el.scrollHeight;
  }
  function appendLogLine(l) {
    if (!logPass(l)) return;
    const el = $("#log");
    if (el.firstElementChild?.classList.contains("muted")) el.innerHTML = "";
    el.insertAdjacentHTML("beforeend", logHtml(l));
    while (el.childElementCount > 1500) el.firstElementChild.remove();
    if ($("#log-follow").checked) el.scrollTop = el.scrollHeight;
  }
  $("#log-filter").addEventListener("input", renderLogs);
  $("#log-level").addEventListener("change", renderLogs);

  /* ---------------------------------------------------------- start */
  (async () => {
    const h = location.hash.slice(1);
    if (["player", "settings", "status"].includes(h)) setTab(h);
    try {
      const s = await api("api/session");
      if (s.language) setLanguage(s.language);
      if (s.authenticated) showApp(); else showLogin();
    } catch (_) { showLogin(); }
  })();
})();
