/**
 * @module src/web/History
 * @description Recently played songs per server, shown in the web panel's History tab
 * (with play / next / queue buttons). Stored in storage/history.json, newest first,
 * one entry per song (playing it again moves it to the top and counts the plays).
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "../core/Logger.mjs";
import { cleanId } from "../utils/Utils.mjs";

const FILE = path.resolve("storage/history.json");
const MAX_PER_GUILD = 100;

function durationMs(t) {
  if (typeof t?._durationMs === "number" && t._durationMs > 0) return t._durationMs;
  if (typeof t?.duration === "number") return t.duration;
  if (t?.duration?.seconds != null) return Number(t.duration.seconds) * 1000;
  return 0;
}

export class History {
  constructor() {
    /** @type {Record<string, object[]>} */
    this.data = {};
    this.dirty = false;
    try { this.data = JSON.parse(fs.readFileSync(FILE, "utf8")) ?? {}; } catch { this.data = {}; }
    this._timer = setInterval(() => this.save(), 30_000);
    this._timer.unref?.();
  }

  /** Record that a song started playing on a server. */
  add(guildId, t) {
    const gid = cleanId(String(guildId ?? ""));
    if (!gid || !t) return;
    const isRadio = t.type === "radio";
    const play = isRadio ? (t.url || t.author?.url) : (t.spotifyUrl || t.url);
    if (!play) return;
    const list = (this.data[gid] ??= []);
    const old = list.findIndex((e) => e.play === play);
    let plays = 1;
    if (old !== -1) {
      plays = (list[old].plays ?? 1) + (Date.now() - list[old].at > 60_000 ? 1 : 0); // radio reconnects don't count
      list.splice(old, 1);
    }
    list.unshift({
      title: t.title ?? null,
      author: t.author?.name ?? t.artist ?? null,
      url: isRadio ? (t.author?.url ?? null) : (t.spotifyUrl || t.url || null),
      play,
      thumbnail: t.thumbnail ?? (t.videoId ? `https://i.ytimg.com/vi/${t.videoId}/hqdefault.jpg` : null),
      durationMs: isRadio || t.isLive ? 0 : durationMs(t),
      live: !!(t.isLive || isRadio || t.type === "livestream"),
      at: Date.now(),
      plays,
    });
    if (list.length > MAX_PER_GUILD) list.length = MAX_PER_GUILD;
    this.dirty = true;
  }

  list(guildId) {
    return [...(this.data[cleanId(String(guildId ?? ""))] ?? [])];
  }

  clear(guildId) {
    const gid = cleanId(String(guildId ?? ""));
    if (this.data[gid]) { delete this.data[gid]; this.dirty = true; this.save(); }
  }

  save() {
    if (!this.dirty) return;
    try {
      fs.writeFileSync(FILE, JSON.stringify(this.data));
      this.dirty = false;
    } catch (e) { logger.warn("[History] Cannot save storage/history.json:", e?.message); }
  }
}
