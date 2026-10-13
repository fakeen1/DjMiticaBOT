/** @module src/music/audio/AudioSettings @description Audio subsystem settings, merged from the config.json `audio` section at startup (see Bot.mjs). Keeps the streaming core free of direct config dependencies — the bridge, player mixins and tests read the effective settings via {@link getAudioSettings}. */

/** @type {object} @description Effective audio settings (merged from config.json -> audio). */
const _settings = {
  /** @type {boolean} @description Whether the legacy /v4/loadstream route may be used (server-side seek, filters, MP3/AAC decode). Disabled by default: playback runs on /v4/trackstream only. */
  allowLoadstream: false,
  /** @type {number} @description Crossfade between tracks at the natural end, in seconds (0 = off). */
  crossfadeSeconds: 0,
  /** @type {number} @description Crossfade on skip, in seconds (0 = stop immediately). */
  skipCrossfadeSeconds: 0,
};

/**
 * Merge the config.json `audio` section into the effective settings.
 * @param {object|null} [section] - config.json -> audio
 * @param {boolean|string} [section.allowLoadstream] - Opt into the NodeLink
 *   /v4/loadstream route. Accepts true / "true"; anything else keeps it off.
 */
export function configureAudio(section = null) {
  const raw = section?.allowLoadstream;
  _settings.allowLoadstream = raw === true || raw === "true";
  const xf = Number(section?.crossfadeSeconds ?? 0);
  _settings.crossfadeSeconds = Number.isFinite(xf) ? Math.max(0, Math.min(15, xf)) : 0;
  const sxf = Number(section?.skipCrossfadeSeconds ?? 0);
  _settings.skipCrossfadeSeconds = Number.isFinite(sxf) ? Math.max(0, Math.min(10, sxf)) : 0;
}

/** @returns {number} Skip crossfade duration in milliseconds (0 = off). */
export function getSkipCrossfadeMs() {
  return Math.round((_settings.skipCrossfadeSeconds || 0) * 1000);
}

/** @returns {number} End-of-track crossfade duration in milliseconds (0 = off). */
export function getCrossfadeMs() {
  return Math.round((_settings.crossfadeSeconds || 0) * 1000);
}

/**
 * @returns {object} A snapshot of the effective audio settings.
 */
export function getAudioSettings() {
  return { ..._settings };
}

/**
 * @returns {boolean} Whether the /v4/loadstream route is enabled. When false
 * the bot never calls /v4/loadstream: playback and seeking run entirely on
 * /v4/trackstream plus in-process WebM/Ogg handling.
 */
export function isLoadstreamEnabled() {
  return _settings.allowLoadstream === true;
}

export default { configureAudio, getAudioSettings, isLoadstreamEnabled, getCrossfadeMs, getSkipCrossfadeMs };
