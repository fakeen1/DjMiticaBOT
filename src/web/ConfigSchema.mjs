/**
 * @module src/web/ConfigSchema
 * @description Global bot settings (config.json) that can be edited from the web panel:
 * description, validation and live application where possible. Connection settings
 * (token, MySQL, NodeLink, Fluxer instance) are intentionally NOT exposed.
 *
 * All texts are in English; Romanian translations live in RO below and are used
 * when the panel language (config.json -> web.language) is "ro".
 */

import { configureAudio, getAudioSettings } from "../music/audio/AudioSettings.mjs";
import { setGlobalColor } from "../ui/Embeds.mjs";

/** Languages the web panel supports. */
export const PANEL_LANGUAGES = ["en", "ro"];

/** @returns {"en"|"ro"} the panel language configured in config.json -> web.language */
export function panelLanguage(config) {
  const l = String(config?.web?.language ?? "en").toLowerCase();
  return PANEL_LANGUAGES.includes(l) ? l : "en";
}

/**
 * Field types: bool | number | text | color | list | secret | select
 * live: true  = applied immediately;  false = after the bot restarts
 * scale: the config value is divided by scale for display (e.g. ms -> s)
 */
export const SECTIONS = [
  {
    id: "general", title: "General",
    desc: "Core bot behaviour, shared by all servers.",
    fields: [
      { path: "prefix", label: "Default prefix", type: "text", maxLength: 5, noSpaces: true, live: false,
        help: "Command prefix for servers that have not set their own." },
      { path: "embedColor", label: "Message color", type: "color", live: true,
        help: "Color of the bar on the left of the bot's messages." },
      { path: "owners", label: "Bot owners", type: "list", itemPattern: "^\\d{5,25}$", itemHint: "User ID", live: true,
        help: "IDs of the users allowed to use the admin commands (eval, reload, debug)." },
      { path: "customStatsFooter", label: "Stats footer text", type: "text", maxLength: 120, live: true, optional: true,
        help: "Shown at the bottom of the stats command. Leave empty to show nothing." },
    ],
  },
  {
    id: "audio", title: "Playback",
    desc: "Transitions between songs and audio sources.",
    fields: [
      { path: "audio.crossfadeSeconds", label: "Crossfade at the end of a song", type: "number", min: 0, max: 15, step: 0.5, unit: "s", live: true,
        help: "The ending song fades out while the next one fades in over it. 0 = hard cut." },
      { path: "audio.skipCrossfadeSeconds", label: "Crossfade on skip", type: "number", min: 0, max: 10, step: 0.5, unit: "s", live: true,
        help: "How long the transition lasts when you skip a song. 0 = stop immediately." },
      { path: "audio.allowLoadstream", label: "Decode on the audio server (loadstream)", type: "bool", live: true,
        help: "Enables audio filters and MP3/AAC formats, processed by NodeLink. Keep it on if you use filters." },
    ],
  },
  {
    id: "voice", title: "Voice commands",
    desc: "The bot listens to the voice channel and runs the commands spoken after the wake word.",
    fields: [
      { path: "voiceCommands.enabled", label: "Voice commands enabled", type: "bool", live: false,
        help: "When disabled, the bot stops listening and shows as deafened again." },
      { path: "voiceCommands.wakeWord", label: "Wake word", type: "text", maxLength: 20, live: true,
        help: "The word spoken before the command, e.g. \u201cdj skip\u201d." },
      { path: "voiceCommands.requireWakeWord", label: "Require the wake word", type: "bool", live: true,
        help: "If off, any phrase that starts with a command name is executed." },
      { path: "voiceCommands.echo", label: "Show the heard command in chat", type: "bool", live: true,
        help: "Posts a message like \u201c\u{1F399}\uFE0F @user: %skip\u201d before the reply." },
      { path: "voiceCommands.energyThreshold", label: "Voice volume threshold", type: "number", min: 100, max: 8000, step: 50, live: true,
        help: "Lower = the bot hears you more easily, but also reacts to noise." },
      { path: "voiceCommands.silenceMs", label: "Pause that ends a phrase", type: "number", min: 300, max: 3000, step: 50, unit: "ms", live: true,
        help: "How much silence means you have finished speaking." },
      { path: "voiceCommands.minSpeechMs", label: "Minimum phrase length", type: "number", min: 100, max: 2000, step: 50, unit: "ms", live: true,
        help: "Shorter sounds (coughs, clicks) are ignored." },
      { path: "voiceCommands.maxSpeechMs", label: "Maximum phrase length", type: "number", scale: 1000, min: 3, max: 30, step: 0.5, unit: "s", live: true,
        help: "Longer phrases are cut and sent to recognition." },
      { path: "voiceCommands.allowedUsers", label: "Only these users", type: "list", itemPattern: "^\\d{5,25}$", itemHint: "User ID", live: true,
        help: "Empty = anyone in the channel can use voice commands." },
      { path: "voiceCommands.whisperUrl", label: "Whisper server address", type: "text", maxLength: 200, live: true,
        help: "Default http://whisper:9000 (the docker-compose container)." },
      { path: "voiceCommands.debug", label: "Verbose log", type: "bool", live: true,
        help: "Logs the voice level and every phrase heard." },
    ],
  },
  {
    id: "timers", title: "Timers",
    desc: "How long the bot waits in various situations.",
    fields: [
      { path: "timers.inactivityTimeout", label: "Leave after inactivity", type: "number", scale: 1000, min: 10, max: 7200, step: 5, unit: "s", live: false,
        help: "The bot leaves the channel if nothing plays for this long (except in 24/7 mode)." },
      { path: "timers.aloneCheckInterval", label: "Check for empty channel every", type: "number", scale: 1000, min: 5, max: 600, step: 5, unit: "s", live: false },
      { path: "timers.aloneCheckDebounce", label: "Empty channel check delay", type: "number", min: 0, max: 10000, step: 100, unit: "ms", live: false },
      { path: "timers.rejoin247Delay", label: "Rejoin the 24/7 channel after", type: "number", min: 500, max: 60000, step: 500, unit: "ms", live: false },
      { path: "timers.leave247RejoinDelay", label: "24/7 rejoin after a forced leave", type: "number", min: 500, max: 60000, step: 500, unit: "ms", live: false },
      { path: "timers.intentionalLeaveTTL", label: "Remember a voluntary leave for", type: "number", min: 1000, max: 120000, step: 1000, unit: "ms", live: false },
    ],
  },
  {
    id: "presence", title: "Bot status",
    desc: "The text shown under the bot's name in the member list.",
    fields: [
      { path: "presenceContents", label: "Status messages", type: "list", itemHint: "Status text", presence: true, live: false,
        help: "If you add several, they rotate." },
      { path: "presenceInterval", label: "Change the message every", type: "number", scale: 1000, min: 10, max: 3600, step: 5, unit: "s", live: false, optional: true },
    ],
  },
  {
    id: "logging", title: "Log",
    desc: "Which categories appear in the bot log (Status tab and docker logs). Errors are always shown.",
    fields: [
      { path: "logging.enabled", label: "Logging enabled", type: "bool", live: true },
      { path: "logging.warn", label: "Warnings", type: "bool", live: true },
      { path: "logging.player", label: "Player", type: "bool", live: true },
      { path: "logging.commands", label: "Commands", type: "bool", live: true },
      { path: "logging.lavalink", label: "NodeLink", type: "bool", live: true },
      { path: "logging.voice", label: "Voice connection", type: "bool", live: true },
      { path: "logging.voiceState", label: "Channel joins and leaves", type: "bool", live: true },
      { path: "logging.voice247", label: "24/7 mode", type: "bool", live: true },
      { path: "logging.inactivity", label: "Inactivity", type: "bool", live: true },
      { path: "logging.aloneCheck", label: "Empty channel check", type: "bool", live: true },
      { path: "logging.guild", label: "Servers", type: "bool", live: true },
      { path: "logging.recovery", label: "Recovery after restart", type: "bool", live: true },
      { path: "logging.settings", label: "Settings", type: "bool", live: true },
      { path: "logging.mediaplayer", label: "Media player", type: "bool", live: true },
    ],
  },
  {
    id: "lastfm", title: "Last.fm",
    desc: "Scrobbling and autoplay recommendations. Get the keys from last.fm/api.",
    fields: [
      { path: "lastfm.apiKey", label: "API key", type: "secret", live: false },
      { path: "lastfm.apiSecret", label: "Shared secret", type: "secret", live: false },
      { path: "lastfm.scrobbleThreshold", label: "Scrobble after listening to", type: "number", scale: 0.01, min: 10, max: 100, step: 5, unit: "%", live: false },
      { path: "lastfm.scrobbleMinMs", label: "Or after at most", type: "number", scale: 1000, min: 30, max: 600, step: 10, unit: "s", live: false },
    ],
  },
  {
    id: "web", title: "Web panel",
    desc: "Access to this page.",
    fields: [
      { path: "web.language", label: "Panel language", type: "select", live: true,
        options: [{ value: "en", label: "English" }, { value: "ro", label: "Română" }],
        help: "Language of this web panel. The bot's chat language is set per server, above." },
      { path: "web.password", label: "Panel password", type: "secret", minLength: 3, live: true,
        help: "After changing it you will have to log in again on other devices." },
      { path: "web.sessionDays", label: "Stay logged in for", type: "number", min: 1, max: 365, step: 1, unit: "days", live: true },
      { path: "web.oauth.enabled", label: "Login with Fluxer", type: "bool", live: true,
        help: "Server managers log in with their Fluxer account and can only control their own servers (where they have Manage Server). Needs the client secret and redirect URI below, and the panel served over HTTPS." },
      { path: "web.oauth.clientSecret", label: "OAuth2 client secret", type: "secret", live: true,
        help: "From the bot's application page on Fluxer (OAuth2 section)." },
      { path: "web.oauth.redirectUri", label: "Redirect URI", type: "text", maxLength: 300, optional: true, live: true,
        help: "The panel address + /api/oauth/callback, e.g. https://your-domain/djmitica/api/oauth/callback. Add the exact same URI in the application's OAuth2 settings." },
      { path: "web.oauth.clientId", label: "Application ID", type: "text", maxLength: 30, optional: true, live: true,
        help: "Leave empty to use the bot's own ID." },
    ],
  },
];

/** Romanian translations (used when web.language = "ro"). */
const RO = {
  sections: {
    general: ["General", "Comportamentul de bază al botului, valabil pentru toate serverele."],
    audio: ["Redare", "Trecerea între melodii și sursele audio."],
    voice: ["Comenzi vocale", "Botul ascultă canalul de voce și execută comenzile spuse după cuvântul de activare."],
    timers: ["Timpi", "Cât așteaptă botul în diverse situații."],
    presence: ["Status-ul botului", "Textul afișat sub numele botului în lista de membri."],
    logging: ["Jurnal", "Ce categorii apar în jurnalul botului (tab-ul Status și docker logs). Erorile apar mereu."],
    lastfm: ["Last.fm", "Scrobbling și recomandări pentru autoplay. Cheile se obțin de pe last.fm/api."],
    web: ["Panoul web", "Accesul la această pagină."],
  },
  // path: [label, help?, itemHint?]
  fields: {
    "prefix": ["Prefix implicit", "Prefixul comenzilor pentru serverele care nu și-au setat unul propriu."],
    "embedColor": ["Culoarea mesajelor", "Culoarea barei din stânga mesajelor trimise de bot."],
    "owners": ["Proprietari ai botului", "ID-urile utilizatorilor care pot folosi comenzile de administrare (eval, reload, debug).", "ID utilizator"],
    "customStatsFooter": ["Text sub statistici", "Apare în subsolul comenzii stats. Lasă gol ca să nu apară nimic."],
    "audio.crossfadeSeconds": ["Crossfade la finalul melodiei", "Melodia care se termină scade, iar următoarea crește peste ea. 0 = trecere bruscă."],
    "audio.skipCrossfadeSeconds": ["Crossfade la skip", "Cât durează trecerea când sari peste o melodie. 0 = oprire imediată."],
    "audio.allowLoadstream": ["Decodare pe serverul audio (loadstream)", "Permite filtre audio și formate MP3/AAC, procesate de NodeLink. Lasă pornit dacă folosești filtre."],
    "voiceCommands.enabled": ["Comenzi vocale pornite", "Când sunt oprite, botul nu mai ascultă canalul și apare din nou ca „deafened”."],
    "voiceCommands.wakeWord": ["Cuvânt de activare", "Cuvântul spus înaintea comenzii, de exemplu „dj skip”."],
    "voiceCommands.requireWakeWord": ["Cere cuvântul de activare", "Dacă e oprit, orice frază care începe cu un nume de comandă e executată."],
    "voiceCommands.echo": ["Arată comanda auzită în chat", "Trimite un mesaj de forma „🎙️ @utilizator: %skip” înainte de răspuns."],
    "voiceCommands.energyThreshold": ["Prag de volum al vocii", "Mai mic = botul te aude mai ușor, dar reacționează și la zgomot."],
    "voiceCommands.silenceMs": ["Pauza care încheie fraza", "Cât timp de liniște înseamnă că ai terminat de vorbit."],
    "voiceCommands.minSpeechMs": ["Durata minimă a unei fraze", "Sunetele mai scurte (tuse, click-uri) sunt ignorate."],
    "voiceCommands.maxSpeechMs": ["Durata maximă a unei fraze", "Frazele mai lungi sunt tăiate și trimise la recunoaștere."],
    "voiceCommands.allowedUsers": ["Doar acești utilizatori", "Gol = oricine din canal poate da comenzi vocale.", "ID utilizator"],
    "voiceCommands.whisperUrl": ["Adresa serverului Whisper", "Implicit http://whisper:9000 (containerul din docker-compose)."],
    "voiceCommands.debug": ["Jurnal detaliat", "Scrie în jurnal nivelul vocii și fiecare frază auzită."],
    "timers.inactivityTimeout": ["Ieșire după inactivitate", "Botul iese din canal dacă nu cântă nimic atâta timp (în afara modului 24/7)."],
    "timers.aloneCheckInterval": ["Verificare canal gol, la fiecare"],
    "timers.aloneCheckDebounce": ["Întârziere verificare canal gol"],
    "timers.rejoin247Delay": ["Revenire în canalul 24/7 după"],
    "timers.leave247RejoinDelay": ["Revenire 24/7 după ieșire forțată"],
    "timers.intentionalLeaveTTL": ["Memorare ieșire voluntară"],
    "presenceContents": ["Mesaje de status", "Dacă pui mai multe, se schimbă pe rând.", "Text status"],
    "presenceInterval": ["Schimbă mesajul la fiecare"],
    "logging.enabled": ["Jurnal pornit"],
    "logging.warn": ["Avertismente"],
    "logging.commands": ["Comenzi"],
    "logging.voice": ["Conexiune de voce"],
    "logging.voiceState": ["Intrări și ieșiri din canale"],
    "logging.voice247": ["Mod 24/7"],
    "logging.inactivity": ["Inactivitate"],
    "logging.aloneCheck": ["Verificare canal gol"],
    "logging.guild": ["Servere"],
    "logging.recovery": ["Recuperare după repornire"],
    "logging.settings": ["Setări"],
    "lastfm.scrobbleThreshold": ["Scrobble după ce s-a ascultat"],
    "lastfm.scrobbleMinMs": ["Sau după cel mult"],
    "web.language": ["Limba panoului", "Limba acestui panou web. Limba botului în chat se alege pe fiecare server, mai sus."],
    "web.password": ["Parola panoului", "După schimbare va trebui să te autentifici din nou pe celelalte dispozitive."],
    "web.sessionDays": ["Rămâi autentificat"],
    "web.oauth.enabled": ["Logare cu Fluxer", "Administratorii de servere se loghează cu contul Fluxer și pot controla doar serverele lor (unde au Manage Server). Are nevoie de client secret și redirect URI de mai jos, iar panoul trebuie servit prin HTTPS."],
    "web.oauth.clientSecret": ["OAuth2 client secret", "Din pagina aplicației botului pe Fluxer (secțiunea OAuth2)."],
    "web.oauth.redirectUri": ["Redirect URI", "Adresa panoului + /api/oauth/callback, de ex. https://domeniul-tau/djmitica/api/oauth/callback. Pune exact aceeași adresă în setările OAuth2 ale aplicației."],
    "web.oauth.clientId": ["Application ID", "Lasă gol ca să se folosească ID-ul botului."],
  },
  units: { days: "zile" },
};

/** Validation messages. */
const MSG = {
  en: {
    unknown: (p) => `Unknown setting: ${p}`,
    number: (n) => `${n}: must be a number.`,
    range: (n, a, b, u) => `${n}: must be between ${a} and ${b}${u ? " " + u : ""}.`,
    empty: (n) => `${n}: cannot be empty.`,
    maxLen: (n, m) => `${n}: at most ${m} characters.`,
    minLen: (n, m) => `${n}: at least ${m} characters.`,
    spaces: (n) => `${n}: cannot contain spaces.`,
    url: (n) => `${n}: must be an http(s) address.`,
    color: (n) => `${n}: invalid color.`,
    choice: (n) => `${n}: invalid choice.`,
    maxItems: (n) => `${n}: at most 50 items.`,
    badItem: (n, x, h) => `${n}: \u201c${x}\u201d is not a valid ${h ?? "item"}.`,
    type: (n) => `${n}: unknown type.`,
  },
  ro: {
    unknown: (p) => `Setare necunoscută: ${p}`,
    number: (n) => `${n}: trebuie să fie un număr.`,
    range: (n, a, b, u) => `${n}: trebuie să fie între ${a} și ${b}${u ? " " + u : ""}.`,
    empty: (n) => `${n}: nu poate fi gol.`,
    maxLen: (n, m) => `${n}: maxim ${m} caractere.`,
    minLen: (n, m) => `${n}: minim ${m} caractere.`,
    spaces: (n) => `${n}: nu poate conține spații.`,
    url: (n) => `${n}: trebuie să fie o adresă http(s).`,
    color: (n) => `${n}: culoare invalidă.`,
    choice: (n) => `${n}: opțiune invalidă.`,
    maxItems: (n) => `${n}: maxim 50 de elemente.`,
    badItem: (n, x, h) => `${n}: „${x}” nu este un ${h ?? "element"} valid.`,
    type: (n) => `${n}: tip necunoscut.`,
  },
};

/** Field texts in the requested language. */
function fieldText(f, lang) {
  const ro = lang === "ro" ? RO.fields[f.path] : null;
  return {
    label: ro?.[0] ?? f.label,
    help: ro ? (ro[1] ?? f.help) : f.help,
    itemHint: ro?.[2] ?? f.itemHint,
    unit: lang === "ro" ? (RO.units[f.unit] ?? f.unit) : f.unit,
  };
}

const FIELDS = new Map(SECTIONS.flatMap((s) => s.fields.map((f) => [f.path, f])));

const DEFAULTS = {
  "voiceCommands.enabled": false, "voiceCommands.wakeWord": "dj", "voiceCommands.requireWakeWord": true,
  "voiceCommands.echo": true, "voiceCommands.energyThreshold": 700, "voiceCommands.silenceMs": 900,
  "voiceCommands.minSpeechMs": 250, "voiceCommands.maxSpeechMs": 12000, "voiceCommands.allowedUsers": [],
  "voiceCommands.whisperUrl": "http://whisper:9000", "voiceCommands.debug": false,
  "timers.inactivityTimeout": 180000, "timers.aloneCheckInterval": 30000, "timers.aloneCheckDebounce": 500,
  "timers.rejoin247Delay": 3000, "timers.leave247RejoinDelay": 5000, "timers.intentionalLeaveTTL": 10000,
  "presenceContents": [], "presenceInterval": 30000, "lastfm.scrobbleThreshold": 0.5, "lastfm.scrobbleMinMs": 240000,
  "web.sessionDays": 30, "web.language": "en", "web.oauth.enabled": false, "embedColor": "0xe9196c", "owners": [], "customStatsFooter": "", "prefix": "%",
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

/** Current value of a field, ready for display. */
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
    case "select": {
      const s = String(v ?? "");
      return f.options?.some((o) => o.value === s) ? s : (f.options?.[0]?.value ?? "");
    }
    case "list":
      if (!Array.isArray(v)) return [];
      return v.map((x) => (typeof x === "object" && x ? String(x.text ?? x.name ?? "") : String(x)));
    default: return v == null ? "" : String(v);
  }
}

/** The whole schema + current values (without secrets), in the panel language. */
export function configView(config, lang = panelLanguage(config)) {
  return SECTIONS.map((s) => {
    const ro = lang === "ro" ? RO.sections[s.id] : null;
    return {
      id: s.id, title: ro?.[0] ?? s.title, desc: ro?.[1] ?? s.desc,
      fields: s.fields.map((f) => {
        const { path, type, min, max, step, live, maxLength, optional, options } = f;
        const { label, help, itemHint, unit } = fieldText(f, lang);
        return { path, label, type, min, max, step, unit, help, live, maxLength, itemHint, optional, options, value: viewValue(config, f) };
      }),
    };
  });
}

/**
 * Validates the changes and turns them into values to write to config.json.
 * @returns {{ updates: Array<[string, any]>, errors: string[] }}
 */
export function validateChanges(config, changes, lang = panelLanguage(config)) {
  const updates = [];
  const errors = [];
  const M = MSG[lang] ?? MSG.en;
  for (const [path, raw] of Object.entries(changes ?? {})) {
    const f = FIELDS.get(path);
    if (!f) { errors.push(M.unknown(path)); continue; }
    const { label: name, itemHint, unit } = fieldText(f, lang);
    switch (f.type) {
      case "bool": updates.push([path, raw === true || raw === "true"]); break;
      case "number": {
        const n = Number(raw);
        if (raw === "" && f.optional) { updates.push([path, null]); break; }
        if (!Number.isFinite(n)) { errors.push(M.number(name)); break; }
        if ((f.min != null && n < f.min) || (f.max != null && n > f.max)) {
          errors.push(M.range(name, f.min, f.max, unit)); break;
        }
        updates.push([path, f.scale ? Math.round(n * f.scale * 1000) / 1000 : n]);
        break;
      }
      case "text": {
        const s = String(raw ?? "").trim();
        if (!s && !f.optional) { errors.push(M.empty(name)); break; }
        if (f.maxLength && s.length > f.maxLength) { errors.push(M.maxLen(name, f.maxLength)); break; }
        if (f.noSpaces && /\s/.test(s)) { errors.push(M.spaces(name)); break; }
        if (path === "voiceCommands.whisperUrl" && !/^https?:\/\/[^\s]+$/i.test(s)) { errors.push(M.url(name)); break; }
        if (path === "web.oauth.redirectUri" && s && !/^https?:\/\/[^\s]+$/i.test(s)) { errors.push(M.url(name)); break; }
        if (path === "web.oauth.clientId" && s && !/^\d{5,25}$/.test(s)) { errors.push(M.number(name)); break; }
        updates.push([path, s]);
        break;
      }
      case "color": {
        const s = String(raw ?? "").trim().replace(/^#/, "");
        if (!/^[0-9a-f]{6}$/i.test(s)) { errors.push(M.color(name)); break; }
        updates.push([path, "0x" + s.toLowerCase()]);
        break;
      }
      case "secret": {
        const s = String(raw ?? "");
        if (!s) break; // empty = unchanged
        if (f.minLength && s.length < f.minLength) { errors.push(M.minLen(name, f.minLength)); break; }
        updates.push([path, s]);
        break;
      }
      case "list": {
        const arr = (Array.isArray(raw) ? raw : []).map((x) => String(x ?? "").trim()).filter(Boolean);
        if (arr.length > 50) { errors.push(M.maxItems(name)); break; }
        if (f.itemPattern) {
          const re = new RegExp(f.itemPattern);
          const bad = arr.find((x) => !re.test(x));
          if (bad) { errors.push(M.badItem(name, bad, itemHint)); break; }
        }
        if (f.presence) {
          // keep emoji/other fields of the existing status messages
          const old = Array.isArray(getPath(config, path)) ? getPath(config, path) : [];
          updates.push([path, arr.map((text, i) => (old[i] && typeof old[i] === "object" ? { ...old[i], text } : text))]);
        } else updates.push([path, arr]);
        break;
      }
      case "select": {
        const s = String(raw ?? "");
        if (!f.options?.some((o) => o.value === s)) { errors.push(M.choice(name)); break; }
        updates.push([path, s]);
        break;
      }
      default: errors.push(M.type(name));
    }
  }
  return { updates, errors };
}

/** Writes the values into a config object (mutating existing objects so live references stay valid). */
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
 * Applies live whatever can be applied without a restart.
 * @returns {string[]} labels of the settings that need a restart
 */
export function applyLive(djmitica, updates, lang = panelLanguage(djmitica.config)) {
  const needRestart = [];
  const touched = new Set(updates.map(([p]) => p));
  for (const p of touched) {
    const f = FIELDS.get(p);
    if (f && !f.live) needRestart.push(fieldText(f, lang).label);
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
