/* Dj Mitica: panou web (vanilla JS, fara build). */
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

  // imagini care nu se incarca (CSP interzice onerror inline)
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
    if (res.status === 401 && path !== "api/login") { showLogin(); throw new Error("Sesiunea a expirat. Intră din nou."); }
    if (!res.ok) throw new Error(data.error || `Eroare ${res.status}`);
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

  /* -------------------------------------------------------- stare */
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
        try { const s = await api("api/session"); if (!s.authenticated) return showLogin(); } catch (_) {}
        setTimeout(connect, 3000);
      }
    });
    es.addEventListener("state", (ev) => { S.lastSse = Date.now(); applyState(JSON.parse(ev.data)); });
    es.addEventListener("log", (ev) => addLog(JSON.parse(ev.data)));
    es.addEventListener("ping", () => { S.lastSse = Date.now(); });
    loadLogs();
  }

  // rezerva: daca evenimentele live nu ajung (proxy care le blocheaza), cerem starea periodic
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

  /* ------------------------------------------------------- canale */
  function renderGuilds() {
    const st = S.state;
    const players = st.players ?? [];
    const html = (st.guilds ?? []).map((g) => {
      const icon = g.icon ? `<img src="${esc(g.icon)}" alt="" data-fb="remove">` : initials(g.name);
      const vcs = g.voiceChannels.map((c) => {
        const p = players.find((x) => x.channelId === c.id);
        const people = c.listeners.map((u) => `<span class="avatar" title="${esc(u.name)}">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" data-fb="remove">` : ""}${u.avatar ? "" : initials(u.name)}</span>`).join("");
        const btn = p
          ? `<span class="badge">${p.paused ? "Pe pauză" : p.current ? "Cântă" : "Conectat"}</span>`
          : `<button class="btn btn-ghost btn-sm" data-join="${esc(c.id)}" type="button">Intră</button>`;
        return `<div class="vc${p ? " has-player" : ""}${p && p.channelId === currentPlayer()?.channelId ? " active" : ""}" ${p ? `data-select="${esc(c.id)}"` : ""}>
          <div class="vc-name" ${p ? 'role="button" tabindex="0"' : ""}>${ICON.voice}<span>${esc(c.name)}</span></div>${btn}
          ${people ? `<div class="people">${people}</div>` : ""}</div>`;
      }).join("") || `<p class="muted small">Niciun canal de voce.</p>`;
      return `<div class="guild"><div class="guild-head"><span class="guild-icon">${icon}</span><span>${esc(g.name)}</span></div>${vcs}</div>`;
    }).join("") || `<p class="muted">Botul nu este în niciun server.</p>`;
    $("#guilds").innerHTML = html;
  }
  $("#guilds").addEventListener("click", async (e) => {
    const j = e.target.closest("[data-join]");
    if (j) {
      j.disabled = true; j.textContent = "Intră…";
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

  /* --------------------------------------------------------- puntea */
  function renderDeck() {
    if (S.interacting) { S.deckStale = true; return; }
    S.deckStale = false;
    const p = currentPlayer();
    const area = $("#deck-area");
    if (!p) {
      area.innerHTML = `<div class="panel empty">${ICON.disc}<h2>Botul nu e în niciun canal</h2>
        <p>Alege un canal de voce din listă și apasă Intră. Apoi caută o melodie mai jos.</p></div>`;
      return;
    }
    const c = p.current;
    const pl = (path) => `api/player/${p.channelId}/${path}`;
    area.dataset.channel = p.channelId;
    if (!c) {
      area.innerHTML = `<div class="deck">
        <div class="deck-art"><div class="ph">${ICON.disc}</div></div>
        <div class="deck-body">
          <div class="deck-where">${ICON.voice}<span>${esc(p.channelName)} pe ${esc(p.guildName)}</span></div>
          <div><div class="deck-title">Nu cântă nimic</div><div class="deck-artist">Caută o melodie mai jos ca să pornească redarea.</div></div>
          <div class="transport">${chips(p)}<button class="btn btn-ghost btn-sm danger" data-act="leave" type="button">Scoate botul din canal</button></div>
        </div></div>`;
      return;
    }
    const art = c.thumbnail ? `<img src="${esc(c.thumbnail)}" alt="" data-fb="remove">` : "";
    area.innerHTML = `<div class="deck${p.paused ? " paused" : ""}">
      <div class="deck-art"><div class="ph">${ICON.disc}</div>${art}</div>
      <div class="deck-body">
        <div class="deck-where">${ICON.voice}<span>${esc(p.channelName)} pe ${esc(p.guildName)}</span><span class="vu" aria-hidden="true">${"<i></i>".repeat(12)}</span></div>
        <div>
          <div class="deck-title">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a>` : esc(c.title)}</div>
          <div class="deck-artist">${esc(c.author ?? "")}</div>
        </div>
        <div class="progress num">
          <span id="pos">${fmt(p.positionMs)}</span>
          <input id="seek" type="range" min="0" max="${c.durationMs || 1}" value="${p.positionMs}" step="1000" aria-label="Poziție în melodie" ${c.live || !c.durationMs ? "disabled" : ""}>
          <span>${c.live ? "LIVE" : fmt(c.durationMs)}</span>
        </div>
        <div class="transport">
          <button class="icon-btn play" data-act="toggle" type="button" aria-label="${p.paused ? "Pornește" : "Pauză"}" title="${p.paused ? "Pornește" : "Pauză"}">${p.paused ? ICON.play : ICON.pause}</button>
          <button class="icon-btn" data-act="skip" type="button" aria-label="Următoarea melodie" title="Următoarea melodie">${ICON.skip}</button>
          <button class="icon-btn" data-act="stop" type="button" aria-label="Oprește și golește coada" title="Oprește și golește coada">${ICON.stop}</button>
          <div class="vol">${ICON.vol}<input id="vol" type="range" min="0" max="200" step="1" value="${p.volume}" aria-label="Volum"><output id="vol-out" class="num">${p.volume}%</output></div>
        </div>
        <div class="transport">${chips(p)}<button class="btn btn-ghost btn-sm danger" data-act="leave" type="button">Scoate botul din canal</button></div>
      </div></div>`;
    paintRange($("#seek")); paintRange($("#vol"));
  }

  function chips(p) {
    const loop = p.loop.song ? "song" : p.loop.queue ? "queue" : "off";
    return `<div class="chips" role="group" aria-label="Repetare și autoplay">
      <button class="chip" type="button" data-loop="${loop === "song" ? "off" : "song"}" aria-pressed="${loop === "song"}">Repetă melodia</button>
      <button class="chip" type="button" data-loop="${loop === "queue" ? "off" : "queue"}" aria-pressed="${loop === "queue"}">Repetă coada</button>
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
      if (!confirm("Scoți botul din canal? Coada se va pierde.")) return;
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

  // progres + VU decorativ
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

  /* --------------------------------------------------------- coada */
  function renderQueue() {
    const p = currentPlayer();
    const q = $("#queue");
    $("#q-shuffle").disabled = $("#q-clear").disabled = !p || !p.queueTotal;
    if (!p) { q.innerHTML = ""; $("#queue-meta").textContent = ""; return; }
    $("#queue-meta").textContent = p.queueTotal ? `${p.queueTotal} ${p.queueTotal === 1 ? "melodie" : "melodii"}, ${fmtLong(p.queueRemainingMs)}` : "";
    if (!p.queue.length) {
      q.innerHTML = `<li class="queue-empty">Coada e goală. Melodiile adăugate apar aici, în ordinea în care vor cânta.</li>`;
      return;
    }
    const n = p.queue.length;
    q.innerHTML = p.queue.map((t, i) => `
      <li class="q-item" draggable="true" data-i="${i}">
        <span class="q-pos num" title="Trage ca să muți">${i + 1}</span>
        ${t.thumbnail ? `<img class="thumb" src="${esc(t.thumbnail)}" alt="" loading="lazy" data-fb="hide">` : `<span class="thumb"></span>`}
        <div class="t-main"><div class="t-title" title="${esc(t.title)}">${esc(t.title)}</div><div class="t-sub">${esc(t.author ?? "")}</div></div>
        <span class="q-dur num">${t.live ? "LIVE" : fmt(t.durationMs)}</span>
        <div class="q-actions">
          <button class="icon-btn sm" data-q="jump" title="Cântă acum" aria-label="Cântă acum: ${esc(t.title)}">${ICON.jump}</button>
          <button class="icon-btn sm" data-q="up" title="Mută mai sus" aria-label="Mută mai sus" ${i === 0 ? "disabled" : ""}>${ICON.up}</button>
          <button class="icon-btn sm" data-q="down" title="Mută mai jos" aria-label="Mută mai jos" ${i === n - 1 ? "disabled" : ""}>${ICON.down}</button>
          <button class="icon-btn sm" data-q="remove" title="Scoate din coadă" aria-label="Scoate din coadă: ${esc(t.title)}">${ICON.x}</button>
        </div>
      </li>`).join("") + (p.queueTotal > n ? `<li class="q-more">și încă ${p.queueTotal - n} melodii</li>` : "");
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

  $("#q-shuffle").addEventListener("click", () => { const p = currentPlayer(); if (p) act(`api/player/${p.channelId}/shuffle`, {}, "Coada a fost amestecată."); });
  $("#q-clear").addEventListener("click", () => {
    const p = currentPlayer(); if (!p) return;
    if (confirm("Golești coada? Melodia curentă continuă.")) act(`api/player/${p.channelId}/clear`);
  });

  /* -------------------------------------------------------- cautare */
  let lastResults = [];
  $("#search-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = $("#search-q").value.trim();
    const box = $("#search-results");
    if (!q) { box.innerHTML = ""; return; }
    box.innerHTML = `<p class="muted small">Caut „${esc(q)}”…</p>`;
    try {
      const r = await api(`api/search?q=${encodeURIComponent(q)}&provider=${encodeURIComponent($("#search-provider").value)}`);
      lastResults = r.results ?? [];
      if (!lastResults.length) { box.innerHTML = `<p class="muted small">Nu am găsit nimic pentru „${esc(q)}”. Încearcă alt nume sau altă sursă.</p>`; return; }
      const hasPlayer = !!currentPlayer();
      const head = r.playlist ? `<div class="result"><span class="thumb"></span><div class="t-main"><div class="t-title">Playlist: ${esc(r.playlist)}</div><div class="t-sub">${lastResults.length} melodii afișate</div></div>
        <div class="result-actions"><button class="btn btn-sm btn-primary" data-add-url="${esc(q)}" data-mode="end" ${hasPlayer ? "" : "disabled"}>Adaugă tot</button></div></div>` : "";
      box.innerHTML = head + lastResults.map((t, i) => `
        <div class="result">
          ${t.thumbnail ? `<img class="thumb" src="${esc(t.thumbnail)}" alt="" loading="lazy" data-fb="hide">` : `<span class="thumb"></span>`}
          <div class="t-main"><div class="t-title" title="${esc(t.title)}">${esc(t.title)}</div><div class="t-sub">${esc(t.author ?? "")}${t.durationMs ? ", " + fmt(t.durationMs) : ""}</div></div>
          <div class="result-actions">
            <button class="btn btn-sm btn-ghost" data-r="${i}" data-mode="now" ${hasPlayer ? "" : "disabled"} title="Oprește melodia curentă și o pornește pe aceasta">Cântă acum</button>
            <button class="btn btn-sm btn-ghost" data-r="${i}" data-mode="next" ${hasPlayer ? "" : "disabled"}>Următoarea</button>
            <button class="btn btn-sm btn-primary" data-r="${i}" data-mode="end" ${hasPlayer ? "" : "disabled"}>În coadă</button>
          </div>
        </div>`).join("") + (hasPlayer ? "" : `<p class="muted small">Ca să adaugi melodii, întâi pune botul într-un canal de voce.</p>`);
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

  /* --------------------------------------------------------- setari */
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
    const items = [["sec-server", "Server"], ...sections.map((s) => ["sec-" + s.id, s.title]), ["sec-restart", "Repornire"]];
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
        return `<div class="num-field"><input id="${id}" type="number" min="${f.min ?? ""}" max="${f.max ?? ""}" step="${f.step ?? 1}" value="${v ?? ""}" aria-label="${esc(f.label)}"${f.optional ? ' placeholder="implicit"' : ""}>${f.unit ? `<span class="muted">${esc(f.unit)}</span>` : ""}</div>`;
      }
      case "color": return `<div class="color-field"><input id="${id}" type="color" value="${esc(v)}" aria-label="${esc(f.label)}"><span class="num muted">${esc(v)}</span></div>`;
      case "secret": return `<input id="${id}" type="password" autocomplete="new-password" placeholder="${v.isSet ? "Setată, lasă gol ca să rămână" : "Nesetată"}" aria-label="${esc(f.label)}">`;
      case "list": return `<textarea id="${id}" rows="${Math.max(2, Math.min(6, v.length + 1))}" placeholder="${esc(f.itemHint ?? "")}, câte unul pe linie" aria-label="${esc(f.label)}">${esc(v.join("\n"))}</textarea>`;
      default: return `<input id="${id}" type="text" value="${esc(v)}" ${f.maxLength ? `maxlength="${f.maxLength}"` : ""} aria-label="${esc(f.label)}">`;
    }
  }
  const fmtNum = (v, f) => (Number(v) === 0 && f.path?.includes("rossfade")) ? "Oprit" : `${Number(v).toLocaleString("ro-RO")}${f.unit ? " " + f.unit : ""}`;

  let globalFields = [];
  function renderGlobal(sections) {
    renderNav(sections);
    globalFields = [];
    $("#global-settings").innerHTML = sections.map((sec) => {
      const rows = sec.fields.map((f) => {
        const idx = globalFields.push({ ...f, section: sec.id }) - 1;
        const badge = f.live ? "" : ` <span class="tag" title="Se aplică după repornirea botului">după repornire</span>`;
        return rowHtml(f.label, f.help, fieldControl(f, idx), badge);
      }).join("");
      return `<section class="panel" id="sec-${esc(sec.id)}">
        <h2 class="panel-title">${esc(sec.title)}</h2>
        <p class="muted small sec-desc">${esc(sec.desc ?? "")}</p>
        ${rows}
        <div class="row-end"><button class="btn btn-primary" data-save-sec="${esc(sec.id)}" type="button" disabled>Salvează</button></div>
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
      if (r.restart?.length) markRestart(r.restart);
      const y = window.scrollY;
      renderGlobal(r.sections);
      window.scrollTo(0, y);
    } catch (err) { toast(err.message, true); btn.disabled = false; }
  });

  function markRestart(labels) {
    const p = $("#sec-restart .sec-desc");
    p.innerHTML = `Ai schimbat setări care se aplică după repornire: <strong>${labels.map(esc).join(", ")}</strong>. Repornește botul când ești gata.`;
    $("#restart-bot").classList.add("btn-primary");
  }

  $("#restart-bot").addEventListener("click", async () => {
    if (!confirm("Repornești botul? Muzica se oprește câteva secunde și apoi se reia.")) return;
    const btn = $("#restart-bot");
    btn.disabled = true; btn.textContent = "Repornește…";
    try { await api("api/restart", {}); } catch (_) {}
    toast("Botul repornește. Pagina se reconectează singură.");
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
    if (!gid) { box.innerHTML = `<p class="muted">Botul nu este în niciun server.</p>`; return; }
    try {
      const s = (await api("api/settings?guild=" + encodeURIComponent(gid))).server;
      if (!s) { box.innerHTML = `<p class="muted">Setările acestui server nu sunt încă încărcate.</p>`; return; }
      const langOpts = s.locales.map((l) => `<option value="${esc(l)}" ${l === s.locale ? "selected" : ""}>${esc(LANG[l] ?? l)}</option>`).join("");
      const vcOpts = `<option value="">Oprit</option>` + s.voiceChannels.map((c) => `<option value="${esc(c.id)}" ${c.id === s.stay247 ? "selected" : ""}>${esc(c.name)}</option>`).join("");
      box.innerHTML =
        rowHtml("Prefix", "Caracterele cu care încep comenzile în acest server (1–5, fără spații).",
          `<input id="ss-prefix" type="text" maxlength="5" value="${esc(s.prefix)}" aria-label="Prefix" class="short">`) +
        rowHtml("Limba botului", "Limba răspunsurilor botului în acest server.", `<select id="ss-locale" aria-label="Limba">${langOpts}</select>`) +
        rowHtml("Volum implicit", "Volumul cu care pornește botul în acest server (1–200%).",
          `<div class="num-field"><input id="ss-volume" type="number" min="1" max="200" value="${s.volume}" aria-label="Volum implicit"><span class="muted">%</span></div>`) +
        rowHtml("Autoplay pornit implicit", "Când botul intră într-un canal, pornește singur autoplay: la finalul cozii adaugă melodii asemănătoare.", toggle("ss-autoplay", s.autoplay, "Autoplay pornit implicit")) +
        rowHtml("Anunță fiecare melodie", "Trimite un mesaj în chat când începe o melodie nouă.", toggle("ss-ann", s.songAnnouncements, "Anunță fiecare melodie")) +
        rowHtml("Vot pentru skip", "Când sunt mai mulți ascultători, skip-ul cere majoritatea voturilor.", toggle("ss-vote", s.voteSkip, "Vot pentru skip")) +
        rowHtml("Votul începe de la", "Numărul de ascultători de la care skip-ul cere vot (2–50).",
          `<div class="num-field"><input id="ss-thr" type="number" min="2" max="50" value="${s.voteSkipThreshold}" aria-label="Prag vot"><span class="muted">persoane</span></div>`) +
        rowHtml("Canal 24/7", "Botul stă permanent în acest canal și revine singur dacă e deconectat.", `<select id="ss-247" aria-label="Canal 24/7">${vcOpts}</select>`) +
        `<div class="row-end"><button id="save-server" class="btn btn-primary" type="button">Salvează</button></div>`;
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
      const up = (ms) => { const d = Math.floor(ms / 86400000); return (d ? d + " z " : "") + fmt(ms % 86400000); };
      const led = (v) => v === true ? "ok" : v === false ? "bad" : "off";
      const w = s.whisper;
      $("#strips").innerHTML = `
        <div class="strip"><div class="strip-head"><span class="led ok"></span>Bot</div><dl class="kv">
          <dt>Nume</dt><dd>${esc(s.bot.name ?? "-")}</dd>
          <dt>Pornit de</dt><dd>${up(s.bot.uptimeMs)}</dd>
          <dt>Memorie</dt><dd>${mb(s.bot.memory.rss)}</dd>
          <dt>Servere</dt><dd>${s.bot.guilds}</dd>
          <dt>Playere active</dt><dd>${s.bot.players}</dd>
          <dt>Node.js</dt><dd>${esc(s.bot.node)}</dd></dl></div>
        <div class="strip"><div class="strip-head"><span class="led ${led(s.nodelink.connected)}"></span>NodeLink</div><dl class="kv">
          <dt>Stare</dt><dd>${s.nodelink.connected ? "Conectat" : "Deconectat"}</dd>
          <dt>Adresă</dt><dd>${esc(s.nodelink.host ?? "-")}</dd></dl>
          <p class="muted small">Caută și pregătește melodiile pentru redare.</p></div>
        <div class="strip"><div class="strip-head"><span class="led ${w.enabled ? led(w.ok) : "off"}"></span>Comenzi vocale</div><dl class="kv">
          <dt>Stare</dt><dd>${!w.enabled ? "Dezactivate" : w.ok ? "Whisper răspunde" : w.ok === false ? "Whisper nu răspunde" : "Se verifică"}</dd>
          ${w.enabled ? `<dt>Cuvânt de activare</dt><dd>${esc(w.wakeWord)}</dd>` : ""}</dl></div>
        <div class="strip"><div class="strip-head"><span class="led ${s.audio.crossfadeSeconds || s.audio.skipCrossfadeSeconds ? "ok" : "off"}"></span>Crossfade</div><dl class="kv">
          <dt>La final</dt><dd>${s.audio.crossfadeSeconds ? s.audio.crossfadeSeconds + " s" : "Oprit"}</dd>
          <dt>La skip</dt><dd>${s.audio.skipCrossfadeSeconds ? s.audio.skipCrossfadeSeconds + " s" : "Oprit"}</dd></dl></div>`;
    } catch (e) { $("#strips").innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  setInterval(() => { if (S.tab === "status" && !document.hidden) loadStatus(); }, 10000);

  /* --------------------------------------------------------- jurnal */
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
    const t = new Date(l.t).toLocaleTimeString("ro-RO", { hour12: false });
    return `<span class="l-${l.level}"><span class="l-t">${t}</span>${esc(l.text)}</span>\n`;
  };
  function renderLogs() {
    const el = $("#log");
    el.innerHTML = S.logs.filter(logPass).map(logHtml).join("") || `<span class="muted">Nicio linie de afișat.</span>`;
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
      if (s.authenticated) showApp(); else showLogin();
    } catch (_) { showLogin(); }
  })();
})();
