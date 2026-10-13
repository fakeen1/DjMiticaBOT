/**
 * @module src/web/ConfigSchema
 * @description Setarile globale ale botului (config.json) editabile din panoul web:
 * descriere, validare si aplicare "pe loc" acolo unde se poate. Setarile de
 * conexiune (token, MySQL, NodeLink, instanta Fluxer) NU sunt expuse intentionat.
 */

import { configureAudio, getAudioSettings } from "../music/audio/AudioSettings.mjs";
import { setGlobalColor } from "../ui/Embeds.mjs";

/**
 * Tipuri de camp: bool | number | text | color | list | secret | select
 * live: true  = se aplica imediat;  false = dupa repornirea botului
 * scale: valoarea din config se imparte la scale pentru afisare (ex. ms -> s)
 */
export const SECTIONS = [
  {
    id: "general", title: "General",
    desc: "Comportamentul de bază al botului, valabil pentru toate serverele.",
    fields: [
      { path: "prefix", label: "Prefix implicit", type: "text", maxLength: 5, noSpaces: true, live: false,
        help: "Prefixul comenzilor pentru serverele care nu și-au setat unul propriu." },
      { path: "embedColor", label: "Culoarea mesajelor", type: "color", live: true,
        help: "Culoarea barei din stânga mesajelor trimise de bot." },
      { path: "owners", label: "Proprietari ai botului", type: "list", itemPattern: "^\\d{5,25}$", itemHint: "ID utilizator", live: true,
        help: "ID-urile utilizatorilor care pot folosi comenzile de administrare (eval, reload, debug)." },
      { path: "customStatsFooter", label: "Text sub statistici", type: "text", maxLength: 120, live: true, optional: true,
        help: "Apare în subsolul comenzii stats. Lasă gol ca să nu apară nimic." },
    ],
  },
  {
    id: "audio", title: "Redare",
    desc: "Trecerea între melodii și sursele audio.",
    fields: [
      { path: "audio.crossfadeSeconds", label: "Crossfade la finalul melodiei", type: "number", min: 0, max: 15, step: 0.5, unit: "s", live: true,
        help: "Melodia care se termină scade, iar următoarea crește peste ea. 0 = trecere bruscă." },
      { path: "audio.skipCrossfadeSeconds", label: "Crossfade la skip", type: "number", min: 0, max: 10, step: 0.5, unit: "s", live: true,
        help: "Cât durează trecerea când sari peste o melodie. 0 = oprire imediată." },
      { path: "audio.allowLoadstream", label: "Decodare pe serverul audio (loadstream)", type: "bool", live: true,
        help: "Permite filtre audio și formate MP3/AAC, procesate de NodeLink. Lasă pornit dacă folosești filtre." },
    ],
  },
  {
    id: "voice", title: "Comenzi vocale",
    desc: "Botul ascultă canalul de voce și execută comenzile spuse după cuvântul de activare.",
    fields: [
      { path: "voiceCommands.enabled", label: "Comenzi vocale pornite", type: "bool", live: false,
        help: "Când sunt oprite, botul nu mai ascultă canalul și apare din nou ca „deafened”." },
      { path: "voiceCommands.wakeWord", label: "Cuvânt de activare", type: "text", maxLength: 20, live: true,
        help: "Cuvântul spus înaintea comenzii, de exemplu „dj skip”." },
      { path: "voiceCommands.requireWakeWord", label: "Cere cuvântul de activare", type: "bool", live: true,
        help: "Dacă e oprit, orice frază care începe cu un nume de comandă e executată." },
      { path: "voiceCommands.echo", label: "Arată comanda auzită în chat", type: "bool", live: true,
        help: "Trimite un mesaj de forma „🎙️ @utilizator: %skip” înainte de răspuns." },
      { path: "voiceCommands.energyThreshold", label: "Prag de volum al vocii", type: "number", min: 100, max: 8000, step: 50, live: true,
        help: "Mai mic = botul te aude mai ușor, dar reacționează și la zgomot." },
      { path: "voiceCommands.silenceMs", label: "Pauza care încheie fraza", type: "number", min: 300, max: 3000, step: 50, unit: "ms", live: true,
        help: "Cât timp de liniște înseamnă că ai terminat de vorbit." },
      { path: "voiceCommands.minSpeechMs", label: "Durata minimă a unei fraze", type: "number", min: 100, max: 2000, step: 50, unit: "ms", live: true,
        help: "Sunetele mai scurte (tuse, click-uri) sunt ignorate." },
      { path: "voiceCommands.maxSpeechMs", label: "Durata maximă a unei fraze", type: "number", scale: 1000, min: 3, max: 30, step: 0.5, unit: "s", live: true,
        help: "Frazele mai lungi sunt tăiate și trimise la recunoaștere." },
      { path: "voiceCommands.allowedUsers", label: "Doar acești utilizatori", type: "list", itemPattern: "^\\d{5,25}$", itemHint: "ID utilizator", live: true,
        help: "Gol = oricine din canal poate da comenzi vocale." },
      { path: "voiceCommands.whisperUrl", label: "Adresa serverului Whisper", type: "text", maxLength: 200, live: true,
        help: "Implicit http://whisper:9000 (containerul din docker-compose)." },
      { path: "voiceCommands.debug", label: "Jurnal detaliat", type: "bool", live: true,
        help: "Scrie în jurnal nivelul vocii și fiecare frază auzită." },
    ],
  },
  {
    id: "timers", title: "Timpi",
    desc: "Cât așteaptă botul în diverse situații.",
    fields: [
      { path: "timers.inactivityTimeout", label: "Ieșire după inactivitate", type: "number", scale: 1000, min: 10, max: 7200, step: 5, unit: "s", live: false,
        help: "Botul iese din canal dacă nu cântă nimic atâta timp (în afara modului 24/7)." },
      { path: "timers.aloneCheckInterval", label: "Verificare canal gol, la fiecare", type: "number", scale: 1000, min: 5, max: 600, step: 5, unit: "s", live: false },
      { path: "timers.aloneCheckDebounce", label: "Întârziere verificare canal gol", type: "number", min: 0, max: 10000, step: 100, unit: "ms", live: false },
      { path: "timers.rejoin247Delay", label: "Revenire în canalul 24/7 după", type: "number", min: 500, max: 60000, step: 500, unit: "ms", live: false },
      { path: "timers.leave247RejoinDelay", label: "Revenire 24/7 după ieșire forțată", type: "number", min: 500, max: 60000, step: 500, unit: "ms", live: false },
      { path: "timers.intentionalLeaveTTL", label: "Memorare ieșire voluntară", type: "number", min: 1000, max: 120000, step: 1000, unit: "ms", live: false },
    ],
  },
  {
    id: "presence", title: "Status-ul botului",
    desc: "Textul afișat sub numele botului în lista de membri.",
    fields: [
      { path: "presenceContents", label: "Mesaje de status", type: "list", itemHint: "Text status", presence: true, live: false,
        help: "Dacă pui mai multe, se schimbă pe rând." },
      { path: "presenceInterval", label: "Schimbă mesajul la fiecare", type: "number", scale: 1000, min: 10, max: 3600, step: 5, unit: "s", live: false, optional: true },
    ],
  },
  {
    id: "logging", title: "Jurnal",
    desc: "Ce categorii apar în jurnalul botului (tab-ul Status și docker logs). Erorile apar mereu.",
    fields: [
      { path: "logging.enabled", label: "Jurnal pornit", type: "bool", live: true },
      { path: "logging.warn", label: "Avertismente", type: "bool", live: true },
      { path: "logging.player", label: "Player", type: "bool", live: true },
      { path: "logging.commands", label: "Comenzi", type: "bool", live: true },
      { path: "logging.lavalink", label: "NodeLink", type: "bool", live: true },
      { path: "logging.voice", label: "Conexiune de voce", type: "bool", live: true },
      { path: "logging.voiceState", label: "Intrări și ieșiri din canale", type: "bool", live: true },
      { path: "logging.voice247", label: "Mod 24/7", type: "bool", live: true },
      { path: "logging.inactivity", label: "Inactivitate", type: "bool", live: true },
      { path: "logging.aloneCheck", label: "Verificare canal gol", type: "bool", live: true },
      { path: "logging.guild", label: "Servere", type: "bool", live: true },
      { path: "logging.recovery", label: "Recuperare după repornire", type: "bool", live: true },
      { path: "logging.settings", label: "Setări", type: "bool", live: true },
      { path: "logging.mediaplayer", label: "Media player", type: "bool", live: true },
    ],
  },
  {
    id: "lastfm", title: "Last.fm",
    desc: "Scrobbling și recomandări pentru autoplay. Cheile se obțin de pe last.fm/api.",
    fields: [
      { path: "lastfm.apiKey", label: "API key", type: "secret", live: false },
      { path: "lastfm.apiSecret", label: "Shared secret", type: "secret", live: false },
      { path: "lastfm.scrobbleThreshold", label: "Scrobble după ce s-a ascultat", type: "number", scale: 0.01, min: 10, max: 100, step: 5, unit: "%", live: false },
      { path: "lastfm.scrobbleMinMs", label: "Sau după cel mult", type: "number", scale: 1000, min: 30, max: 600, step: 10, unit: "s", live: false },
    ],
  },
  {
    id: "web", title: "Panoul web",
    desc: "Accesul la această pagină.",
    fields: [
      { path: "web.password", label: "Parola panoului", type: "secret", minLength: 3, live: true,
        help: "După schimbare va trebui să te autentifici din nou." },
      { path: "web.sessionDays", label: "Rămâi autentificat", type: "number", min: 1, max: 365, step: 1, unit: "zile", live: true },
    ],
  },
];

const FIELDS = new Map(SECTIONS.flatMap((s) => s.fields.map((f) => [f.path, f])));

const DEFAULTS = {
  "voiceCommands.enabled": false, "voiceCommands.wakeWord": "dj", "voiceCommands.requireWakeWord": true,
  "voiceCommands.echo": true, "voiceCommands.energyThreshold": 700, "voiceCommands.silenceMs": 900,
  "voiceCommands.minSpeechMs": 250, "voiceCommands.maxSpeechMs": 12000, "voiceCommands.allowedUsers": [],
  "voiceCommands.whisperUrl": "http://whisper:9000", "voiceCommands.debug": false,
  "timers.inactivityTimeout": 180000, "timers.aloneCheckInterval": 30000, "timers.aloneCheckDebounce": 500,
  "timers.rejoin247Delay": 3000, "timers.leave247RejoinDelay": 5000, "timers.intentionalLeaveTTL": 10000,
  "presenceContents": [], "presenceInterval": 30000, "lastfm.scrobbleThreshold": 0.5, "lastfm.scrobbleMinMs": 240000,
  "web.sessionDays": 30, "embedColor": "0xe9196c", "owners": [], "customStatsFooter": "", "prefix": "%",
  "audio.crossfadeSeconds": 0, "audio.skipCrossfadeSeconds": 0, "audio.allowLoadstream": false,
  "logging.enabled": true,
};

function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== "object") o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys.at(-1)] = value;
}

function colorToHex(v) {
  const s = String(v ?? "").trim().replace(/^#|^0x/i, "");
  return /^[0-9a-f]{6}$/i.test(s) ? "#" + s.toLowerCase() : "#e9196c";
}

/** Valoarea curenta a unui camp, gata de afisat. */
function viewValue(config, f) {
  let v = getPath(config, f.path);
  if (v === undefined) v = DEFAULTS[f.path];
  if (f.path.startsWith("logging.") && v === undefined) v = f.path === "logging.warn" ? true : false;
  if (f.path.startsWith("audio.")) {
    const a = getAudioSettings();
    const k = f.path.slice(6);
    if (k in a) v = a[k];
  }
  switch (f.type) {
    case "secret": return { isSet: !!(v && String(v).length && !/^your_|^paste/i.test(String(v))) };
    case "color": return colorToHex(v);
    case "bool": return v === true || v === "true";
    case "number": {
      const n = Number(v ?? 0);
      return f.scale ? Math.round((n / f.scale) * 100) / 100 : n;
    }
    case "list":
      if (!Array.isArray(v)) return [];
      return v.map((x) => (typeof x === "object" && x ? String(x.text ?? x.name ?? "") : String(x)));
    default: return v == null ? "" : String(v);
  }
}

/** Toata schema + valorile curente (fara secrete). */
export function configView(config) {
  return SECTIONS.map((s) => ({
    id: s.id, title: s.title, desc: s.desc,
    fields: s.fields.map((f) => {
      const { path, label, type, min, max, step, unit, help, live, maxLength, itemHint, optional } = f;
      return { path, label, type, min, max, step, unit, help, live, maxLength, itemHint, optional, value: viewValue(config, f) };
    }),
  }));
}

/**
 * Valideaza modificarile si le transforma in valori de scris in config.json.
 * @returns {{ updates: Array<[string, any]>, errors: string[] }}
 */
export function validateChanges(config, changes) {
  const updates = [];
  const errors = [];
  for (const [path, raw] of Object.entries(changes ?? {})) {
    const f = FIELDS.get(path);
    if (!f) { errors.push(`Setare necunoscută: ${path}`); continue; }
    const name = f.label;
    switch (f.type) {
      case "bool": updates.push([path, raw === true || raw === "true"]); break;
      case "number": {
        const n = Number(raw);
        if (raw === "" && f.optional) { updates.push([path, null]); break; }
        if (!Number.isFinite(n)) { errors.push(`${name}: trebuie să fie un număr.`); break; }
        if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) {
          errors.push(`${name}: trebuie să fie între ${f.min} și ${f.max}${f.unit ? " " + f.unit : ""}.`); break;
        }
        updates.push([path, f.scale ? Math.round(n * f.scale * 1000) / 1000 : n]);
        break;
      }
      case "text": {
        const s = String(raw ?? "").trim();
        if (!s && !f.optional) { errors.push(`${name}: nu poate fi gol.`); break; }
        if (f.maxLength && s.length > f.maxLength) { errors.push(`${name}: maxim ${f.maxLength} caractere.`); break; }
        if (f.noSpaces && /\s/.test(s)) { errors.push(`${name}: nu poate conține spații.`); break; }
        if (path === "voiceCommands.whisperUrl" && !/^https?:\/\/[^\s]+$/i.test(s)) { errors.push(`${name}: trebuie să fie o adresă http(s).`); break; }
        updates.push([path, s]);
        break;
      }
      case "color": {
        const s = String(raw ?? "").trim().replace(/^#/, "");
        if (!/^[0-9a-f]{6}$/i.test(s)) { errors.push(`${name}: culoare invalidă.`); break; }
        updates.push([path, "0x" + s.toLowerCase()]);
        break;
      }
      case "secret": {
        const s = String(raw ?? "");
        if (!s) break; // gol = neschimbat
        if (f.minLength && s.length < f.minLength) { errors.push(`${name}: minim ${f.minLength} caractere.`); break; }
        updates.push([path, s]);
        break;
      }
      case "list": {
        const arr = (Array.isArray(raw) ? raw : []).map((x) => String(x ?? "").trim()).filter(Boolean);
        if (arr.length > 50) { errors.push(`${name}: maxim 50 de elemente.`); break; }
        if (f.itemPattern) {
          const re = new RegExp(f.itemPattern);
          const bad = arr.find((x) => !re.test(x));
          if (bad) { errors.push(`${name}: „${bad}” nu este un ${f.itemHint ?? "element"} valid.`); break; }
        }
        if (f.presence) {
          // pastreaza emoji/alte campuri ale mesajelor de status existente
          const old = Array.isArray(getPath(config, path)) ? getPath(config, path) : [];
          updates.push([path, arr.map((text, i) => (old[i] && typeof old[i] === "object" ? { ...old[i], text } : text))]);
        } else updates.push([path, arr]);
        break;
      }
      default: errors.push(`${name}: tip necunoscut.`);
    }
  }
  return { updates, errors };
}

/** Scrie valorile intr-un obiect de config (mutand obiectele existente, ca referintele vii sa ramana valide). */
export function applyToConfig(config, updates) {
  for (const [path, value] of updates) {
    if (value === null) {
      const keys = path.split(".");
      const parent = keys.length > 1 ? getPath(config, keys.slice(0, -1).join(".")) : config;
      if (parent) delete parent[keys.at(-1)];
    } else setPath(config, path, value);
  }
}

/**
 * Aplica pe loc ce se poate aplica fara repornire.
 * @returns {string[]} etichetele setarilor care cer repornire
 */
export function applyLive(djmitica, updates) {
  const needRestart = [];
  const touched = new Set(updates.map(([p]) => p));
  for (const p of touched) {
    const f = FIELDS.get(p);
    if (f && !f.live) needRestart.push(f.label);
  }
  if ([...touched].some((p) => p.startsWith("audio."))) {
    const a = djmitica.config.audio ?? {};
    configureAudio({ allowLoadstream: a.allowLoadstream, crossfadeSeconds: a.crossfadeSeconds, skipCrossfadeSeconds: a.skipCrossfadeSeconds });
  }
  if (touched.has("embedColor")) { try { setGlobalColor(djmitica.config.embedColor); } catch (_) {} }
  if (touched.has("owners") && djmitica.handler) djmitica.handler.owners = [...(djmitica.config.owners ?? [])];
  if ([...touched].some((p) => p.startsWith("voiceCommands.")) && djmitica.voiceCommands?.cfg) {
    for (const p of touched) {
      if (!p.startsWith("voiceCommands.") || p === "voiceCommands.enabled") continue;
      const k = p.slice("voiceCommands.".length);
      djmitica.voiceCommands.cfg[k] = djmitica.config.voiceCommands?.[k];
    }
  }
  if ([...touched].some((p) => p.startsWith("web.")) && djmitica.web?.cfg) {
    if (touched.has("web.password")) djmitica.web.cfg.password = djmitica.config.web.password;
    if (touched.has("web.sessionDays")) djmitica.web.cfg.sessionDays = djmitica.config.web.sessionDays;
  }
  return needRestart;
}
