/**
 * @module src/utils/Media
 * @description Where server icons and avatars are served from: the configured Fluxer
 * instance's media address, or the official CDN (cdn.fluxer.app).
 */

/** @param {object} config - config.json @returns {string} base URL without a trailing slash */
export function mediaBase(config) {
  const m = config?.["fluxer.js"]?.instance?.media;
  return String(m || "https://cdn.fluxer.app").replace(/\/+$/, "");
}

/** @returns {string|null} icon URL of a server, or null when it has none */
export function guildIconUrl(config, guild) {
  return guild?.icon ? `${mediaBase(config)}/icons/${guild.id}/${guild.icon}.webp` : null;
}
