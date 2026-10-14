/**
 * @module src/utils/Invite
 * @description Builds the link that adds this bot to a Fluxer server
 * (`<webapp>/oauth2/authorize?client_id=…&scope=bot&permissions=…`).
 *
 * Every self-hosted copy gets a link for its own bot: the client ID defaults to
 * the bot's own application / user ID and the host to the configured Fluxer
 * instance (or web.fluxer.app).
 *
 * Optional config.json -> invite:
 *   {
 *     "url": "",          // full custom link; overrides everything below
 *     "clientId": "",     // application ID, if it differs from the bot's user ID
 *     "permissions": ""   // permission bitfield; default = what the bot needs
 *   }
 */

import { PermissionFlags } from "@fluxerjs/core";
import { REQUIRED_BOT_PERMISSIONS } from "../ui/Permissions.mjs";

/** Discord-compatible bit values, used if the library does not expose a flag. */
const FALLBACK_BITS = {
  AddReactions: 1n << 6n, ViewChannel: 1n << 10n, SendMessages: 1n << 11n, ManageMessages: 1n << 13n,
  EmbedLinks: 1n << 14n, AttachFiles: 1n << 15n, ReadMessageHistory: 1n << 16n, Connect: 1n << 20n, Speak: 1n << 21n,
};

/** @returns {string} Permission bitfield covering everything in REQUIRED_BOT_PERMISSIONS. */
export function requiredPermissionBits() {
  let bits = 0n;
  for (const key of REQUIRED_BOT_PERMISSIONS.keys()) {
    let v = PermissionFlags?.[key];
    try { v = v != null ? BigInt(v) : FALLBACK_BITS[key]; } catch { v = FALLBACK_BITS[key]; }
    if (v != null) bits |= v;
  }
  return bits.toString();
}

/**
 * @param {object} bot - The DjMitica instance (needs .config and .client).
 * @returns {string|null} The invite link, or null when the bot is not logged in yet.
 */
export function buildInviteUrl(bot) {
  const cfg = bot?.config?.invite ?? {};
  if (typeof cfg.url === "string" && /^https?:\/\//i.test(cfg.url.trim())) return cfg.url.trim();
  const clientId = String(cfg.clientId || bot?.client?.application?.id || bot?.client?.user?.id || "").trim();
  if (!/^\d{5,25}$/.test(clientId)) return null;
  const inst = bot?.config?.["fluxer.js"]?.instance ?? {};
  const base = String(inst.webapp || "https://web.fluxer.app").replace(/\/+$/, "");
  const perms = /^\d+$/.test(String(cfg.permissions ?? "")) ? String(cfg.permissions) : requiredPermissionBits();
  return `${base}/oauth2/authorize?client_id=${clientId}&scope=bot&permissions=${perms}`;
}
