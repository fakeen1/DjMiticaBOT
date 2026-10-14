/**
 * @module src/utils/Donate
 * @description Donation link shown by %donate and in the web panel.
 *
 * Dj Mitica is free; donations are voluntary and unlock nothing.
 * Optional config.json -> donate:
 *   { "url": "https://revolut.me/...", "enabled": true }
 * Set "enabled": false to hide the command's link and the panel button.
 */

/** Default: the Dj Mitica developer's Revolut page. */
export const DEFAULT_DONATE_URL = "https://revolut.me/cristiz7ac";

/** @returns {string|null} the donation link, or null when donations are turned off. */
export function getDonateUrl(config) {
  const d = config?.donate ?? {};
  if (d.enabled === false) return null;
  const url = String(d.url ?? "").trim();
  return /^https?:\/\//i.test(url) ? url : DEFAULT_DONATE_URL;
}
