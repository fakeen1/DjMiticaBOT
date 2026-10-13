import { logger } from "../core/Logger.mjs";

let warned = false;

/**
 * Send a player announcement. "Now playing" announcements (payload.nowPlaying)
 * edit the previous now-playing message in the same channel instead of
 * posting a new one; falls back to a new message if editing is impossible.
 */
export function sendAnnouncement(player, ch, payload) {
  const { nowPlaying, ...clean } = payload;
  if (!nowPlaying) return ch.send(clean);

  const sendNew = async () => {
    const sent = await ch.send(clean);
    if (sent && typeof sent.edit === "function") {
      player._lastNowPlaying = { msg: sent, chId: ch.id };
    } else {
      player._lastNowPlaying = null;
      if (!warned) {
        warned = true;
        logger.warn("[NowPlaying] sent message has no edit(); editing disabled");
      }
    }
    return sent;
  };

  const last = player._lastNowPlaying;
  if (last && last.chId === ch.id) {
    return Promise.resolve()
      .then(() => last.msg.edit({ embeds: clean.embeds }))
      .catch((err) => {
        logger.warn("[NowPlaying] edit failed, sending a new message:", err?.message ?? err);
        return sendNew();
      });
  }
  return sendNew();
}