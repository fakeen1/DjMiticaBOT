/**
 * @module src/music/audio/Crossfade
 * @description Crossfading audio player for LiveKit connections (@fluxerjs/voice).
 *
 * Replaces the voice library's conn.play()/conn.stop() with its own mixer:
 *  - a SINGLE published audio track ("output"), reused from one track to the next;
 *  - every song is a "voice" (WebM demuxer + Opus decoder) with its own gain;
 *  - a loop (pump) takes 10 ms from every voice, mixes them and sends them to the track.
 * This way the old song can fade out while the new one fades in, without the old
 * pipeline being able to stop/close the new song.
 *
 * API used by the rest of the bot:
 *  - installCrossfade(conn)      called by FluxerAudioBridge before play
 *  - conn.__xfArm(ms)            starts a fade-out on the current song; the next stop()
 *                                no longer cuts it, it lets it fade out over the next one
 *  - conn.__xfKeepSids           the output track must not be unpublished by the bridge
 *  - crossfadeFor(durationMs)    how much crossfade applies at the natural end of a song
 *
 * If the audio modules cannot be loaded, nothing is installed and the bot works as before.
 */

import { Readable } from "node:stream";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { logger } from "../../core/Logger.mjs";
import { getCrossfadeMs } from "./AudioSettings.mjs";

const SAMPLE_RATE = 48000;
const CHANNELS = 1;
const FRAME = 480;      // 10 ms
const FRAME_MS = 10;

let deps = null;
try {
  const rtc = await import("@livekit/rtc-node");
  const od = await import("opus-decoder");
  const prismMod = await import("prism-media");
  const prism = prismMod.default ?? prismMod;
  deps = {
    AudioSource: rtc.AudioSource,
    AudioFrame: rtc.AudioFrame,
    LocalAudioTrack: rtc.LocalAudioTrack,
    TrackPublishOptions: rtc.TrackPublishOptions,
    TrackSource: rtc.TrackSource,
    OpusDecoder: od.OpusDecoder ?? od.default?.OpusDecoder,
    WebmDemuxer: prism.opus?.WebmDemuxer ?? prismMod.opus?.WebmDemuxer,
  };
  if (Object.values(deps).some((x) => !x)) throw new Error("module incomplete");
} catch (e) {
  logger.warn("[Crossfade] Disabled — cannot load the audio modules:", e?.message);
  deps = null;
}

/** For tests: inject fake modules. */
export function __setDeps(d) { deps = d; }

/** Crossfade duration used for a song of the given length (0 = none). */
export function crossfadeFor(durationMs) {
  const ms = getCrossfadeMs();
  if (!deps || !ms || !durationMs || durationMs < ms * 3) return 0;
  return ms;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------------------- voice */

class Voice {
  constructor(conn, name) {
    this.conn = conn;
    this.name = name;
    this.packets = [];
    this.pcm = [];          // Float32Array[]
    this.pcmOff = 0;        // offset in pcm[0]
    this.pcmLen = 0;
    this.ended = false;     // the source has ended
    this.dead = false;
    this.gain = { mode: "none", frames: 0, dur: 1 };
    this.input = null;
    this.demuxer = null;
    this.decoder = null;
  }

  async open(input) {
    this.input = input;
    this.decoder = new deps.OpusDecoder({ sampleRate: SAMPLE_RATE, channels: CHANNELS });
    await this.decoder.ready;
    const demuxer = new deps.WebmDemuxer();
    this.demuxer = demuxer;
    demuxer.on("data", (pkt) => { if (!this.dead && pkt?.length >= 2) this.packets.push(pkt); });
    demuxer.on("end", () => { this.ended = true; });
    demuxer.on("error", (err) => {
      this.ended = true;
      if (!this.dead && this.conn.__xfMixer?.master === this) this.conn.emit?.("error", err);
    });
    input.on?.("error", () => { this.ended = true; });
    input.pipe(demuxer);
  }

  /** Decodes until at least n samples are buffered (or packets run out). */
  fill(n) {
    while (this.pcmLen < n && this.packets.length) {
      const pkt = this.packets.shift();
      try {
        const r = this.decoder.decodeFrame(pkt);
        const ch = r?.channelData?.[0];
        if (ch?.length) { this.pcm.push(ch); this.pcmLen += ch.length; }
      } catch (_) { /* corrupt packet */ }
    }
  }

  /** true when there is nothing left to play */
  get drained() { return this.ended && !this.packets.length && this.pcmLen === 0; }

  /** Adds the next FRAME samples (x gain) into out. @returns {boolean} whether it contributed */
  mixInto(out, extraGain) {
    this.fill(FRAME);
    if (this.pcmLen < FRAME && !this.ended) return false; // waiting for data (network)
    if (this.pcmLen === 0) return false;
    const g = this.nextGain() * extraGain;
    let i = 0;
    while (i < FRAME && this.pcm.length) {
      const chunk = this.pcm[0];
      const take = Math.min(FRAME - i, chunk.length - this.pcmOff);
      if (g > 0) for (let k = 0; k < take; k++) out[i + k] += chunk[this.pcmOff + k] * g;
      i += take; this.pcmOff += take; this.pcmLen -= take;
      if (this.pcmOff >= chunk.length) { this.pcm.shift(); this.pcmOff = 0; }
    }
    return true;
  }

  nextGain() {
    const st = this.gain;
    if (st.mode === "none") return 1;
    const t = Math.min(1, st.frames / st.dur);
    st.frames++;
    if (st.mode === "in") {
      if (t >= 1) st.mode = "none";
      return Math.sin(t * Math.PI / 2);
    }
    return Math.cos(t * Math.PI / 2);
  }

  get fadedOut() { return this.gain.mode === "out" && this.gain.frames >= this.gain.dur; }

  /** How much audio is left to play (ms) once the source is fully downloaded; otherwise null. */
  remainingMs() {
    if (!this.ended) return null;
    return this.packets.length * 20 + this.pcmLen / (SAMPLE_RATE / 1000);
  }

  /** Starts a fade-out now, over the given duration. */
  fadeOut(ms) {
    if (this.gain.mode === "out") return;
    this.gain = { mode: "out", frames: 0, dur: Math.max(1, ms / FRAME_MS) };
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.packets.length = 0;
    this.pcm.length = 0; this.pcmLen = 0;
    try { this.input?.unpipe?.(this.demuxer); } catch (_) {}
    try { this.input?.destroy?.(); } catch (_) {}
    try { this.demuxer?.destroy?.(); } catch (_) {}
    try { this.decoder?.free?.(); } catch (_) {}
  }
}

/* ---------------------------------------------------------------- mixer */

async function openInput(urlOrStream) {
  if (typeof urlOrStream !== "string") return urlOrStream;
  const spec = urlOrStream.trim();
  const lower = spec.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) {
    const res = await fetch(spec);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!res.body) throw new Error("No response body");
    return Readable.fromWeb(res.body);
  }
  if (lower.startsWith("file:")) return createReadStream(fileURLToPath(new URL(spec)));
  return createReadStream(spec);
}

/**
 * Installs the crossfading player on a LiveKit connection (once).
 * @param {object} conn - LiveKitRtcConnection
 */
export function installCrossfade(conn) {
  if (!deps || !conn || conn.__xfInstalled) return;
  if (typeof conn.play !== "function" || typeof conn.stop !== "function" || !("audioSource" in conn)) return;
  const proto = Object.getPrototypeOf(conn);
  conn.__xfInstalled = true;

  const m = {
    source: null, track: null, sid: null, room: null,
    voices: [], master: null,
    running: false,
    armedUntil: 0, armMs: 0,
    pendingUntil: 0, fadeInNextMs: 0,
    gen: 0,
  };
  conn.__xfMixer = m;
  conn.__xfKeepSids = new Set();

  const closeOutput = () => {
    const lp = m.room?.localParticipant;
    if (m.sid && lp?.unpublishTrack && m.room === conn.room) {
      Promise.resolve(lp.unpublishTrack(m.sid, true)).catch(() => {});
    }
    Promise.resolve(m.track?.close?.()).catch(() => {});
    Promise.resolve(m.source?.close?.()).catch(() => {});
    if (m.sid) conn.__xfKeepSids.delete(m.sid);
    m.source = null; m.track = null; m.sid = null; m.room = null;
  };

  const ensureOutput = async () => {
    if (m.source && m.room === conn.room && conn.room?.isConnected) return true;
    if (m.source) closeOutput();
    const room = conn.room;
    if (!room?.isConnected) return false;
    const source = new deps.AudioSource(SAMPLE_RATE, CHANNELS);
    const track = deps.LocalAudioTrack.createAudioTrack("audio", source);
    const opts = new deps.TrackPublishOptions();
    opts.source = deps.TrackSource.SOURCE_MICROPHONE;
    const pub = await room.localParticipant.publishTrack(track, opts);
    m.source = source; m.track = track; m.room = room;
    m.sid = pub?.sid ?? null;
    if (!m.sid) {
      try {
        for (const [sid, p] of room.localParticipant.trackPublications?.entries?.() ?? []) {
          if (p?.track === track) { m.sid = sid; break; }
        }
      } catch (_) {}
    }
    if (m.sid) conn.__xfKeepSids.add(m.sid);
    conn.audioSource = source;
    conn.audioTrack = track;
    return true;
  };

  const updatePlaying = () => {
    conn._playing = !!(m.master && !m.master.dead);
  };

  const removeVoice = (v) => {
    const i = m.voices.indexOf(v);
    if (i !== -1) m.voices.splice(i, 1);
    if (m.master === v) m.master = null;
    v.destroy();
    updatePlaying();
  };

  const pump = async () => {
    if (m.running) return;
    m.running = true;
    try {
      while (m.voices.length) {
        if (!m.source || !conn.room?.isConnected || m.room !== conn.room) break;
        const mix = new Float32Array(FRAME);
        const vol = (conn._volume ?? 100) / 100;
        let any = false;
        for (const v of [...m.voices]) {
          if (v.dead) { removeVoice(v); continue; }
          if (v.endArmed && v.gain.mode !== "out") {
            const rem = v.remainingMs();
            if (rem !== null && rem <= 900) v.fadeOut(Math.max(100, rem));
          }
          if (v.mixInto(mix, vol)) any = true;
          if (v.fadedOut || v.drained) removeVoice(v);
        }
        if (!any) { await sleep(FRAME_MS); continue; }
        const out = new Int16Array(FRAME);
        for (let i = 0; i < FRAME; i++) {
          const s = Math.round(mix[i] * 32767);
          out[i] = s > 32767 ? 32767 : s < -32768 ? -32768 : s;
        }
        const frame = new deps.AudioFrame(out, SAMPLE_RATE, CHANNELS, FRAME);
        try {
          if (m.source.queuedDuration > 500) await m.source.waitForPlayout();
          await m.source.captureFrame(frame);
        } catch (e) {
          logger.warn("[Crossfade] captureFrame:", e?.message);
          await sleep(FRAME_MS);
        }
      }
    } finally {
      m.running = false;
      updatePlaying();
    }
  };

  const hardStop = () => {
    for (const v of [...m.voices]) v.destroy();
    m.voices.length = 0;
    m.master = null;
    m.armedUntil = 0; m.pendingUntil = 0; m.fadeInNextMs = 0; m.armedVoice = null;
    updatePlaying();
  };

  /**
   * Arms a fade-out on the current song; the next stop() no longer cuts it abruptly.
   * mode "skip": the current song starts fading out immediately.
   * mode "end":  the current song plays normally until the next one actually starts,
   *              then fades out over the remaining time (max ms). If no next song
   *              comes, it ends naturally with a very short fade at the end.
   */
  conn.__xfArm = (ms, mode = "skip") => {
    const v = m.master;
    if (!v || v.dead) return;
    m.armMs = ms;
    m.armMode = mode;
    m.armedVoice = v;
    if (mode === "end") {
      v.endArmed = true;
      m.armedUntil = Date.now() + 120_000;
      logger.player(`[Crossfade] end of song: waiting for the next one (max ${ms} ms crossfade)`);
    } else {
      v.fadeOut(ms);
      m.armedUntil = Date.now() + ms + 5000;
      logger.player(`[Crossfade] fade-out ${ms} ms (skip)`);
    }
  };

  conn.play = async function (urlOrStream) {
    const gen = ++m.gen;
    const transition = m.pendingUntil > Date.now() && m.voices.length > 0;
    m.pendingUntil = 0;
    if (!transition) hardStop();
    try { conn.stopVideo?.(); } catch (_) {}

    if (!conn.room?.isConnected) {
      conn.emit?.("error", new Error("LiveKit: not connected"));
      return;
    }
    let input;
    try {
      input = await openInput(urlOrStream);
    } catch (e) {
      conn.emit?.("error", e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (gen !== m.gen) { try { input?.destroy?.(); } catch (_) {} return; }

    const name = typeof urlOrStream === "string" ? "url" : "stream";
    const v = new Voice(conn, name);
    try {
      await v.open(input);
      if (!(await ensureOutput())) throw new Error("LiveKit: not connected");
    } catch (e) {
      v.destroy();
      conn.emit?.("error", e instanceof Error ? e : new Error(String(e)));
      return;
    }
    if (gen !== m.gen) { v.destroy(); return; }

    if (transition && m.fadeInNextMs > 0) {
      let fadeMs = m.fadeInNextMs;
      for (const o of m.voices) {
        if (o.waitFade) {
          const rem = o.remainingMs();
          const f = Math.max(300, Math.min(o.waitFade, rem ?? o.waitFade));
          o.fadeOut(f);
          o.waitFade = 0;
          fadeMs = Math.max(1500, f);
          logger.player(`[Crossfade] transition: old song fades out in ${Math.round(f)} ms, new one fades in over ${Math.round(fadeMs)} ms`);
        }
      }
      v.gain = { mode: "in", frames: 0, dur: Math.max(1, fadeMs / FRAME_MS) };
    }
    m.fadeInNextMs = 0;
    m.voices.push(v);
    m.master = v;
    updatePlaying();
    pump().catch((e) => logger.warn("[Crossfade] pump:", e?.message));
  };

  conn.stop = function () {
    const armed = m.armedUntil > Date.now() && m.armedVoice === m.master;
    m.armedUntil = 0;
    if (armed && m.master && !m.master.dead && !m.master.drained) {
      // the current song keeps playing; the next one will fade in over it
      const v = m.master;
      m.master = null;
      m.armedVoice = null;
      m.fadeInNextMs = m.armMs || 3000;
      conn._playing = false;
      if (m.armMode === "end") {
        // starts fading only when the next one starts (or at its own natural end)
        v.waitFade = m.armMs || 3000;
        const rem = v.remainingMs();
        m.pendingUntil = Date.now() + Math.max(8000, (rem ?? 15000) + 2000);
        logger.player(`[Crossfade] old song keeps playing (${rem === null ? "?" : Math.round(rem / 1000) + " s left"}) until the next one starts`);
      } else {
        m.pendingUntil = Date.now() + 8000;
        const left = Math.max(0, (v.gain.dur - v.gain.frames) * FRAME_MS);
        logger.player(`[Crossfade] old song fades out in ~${Math.round(left)} ms, the next one fades in`);
      }
      return;
    }
    // between a "skip with fade" and the next song starting: don't cut the fade
    if (m.pendingUntil > Date.now()) { conn._playing = false; return; }
    hardStop();
    try { conn.stopVideo?.(); } catch (_) {}
  };

  const origDisconnect = conn.disconnect;
  if (typeof origDisconnect === "function") {
    conn.disconnect = function (...args) {
      hardStop();
      closeOutput();
      return proto.disconnect.apply(conn, args);
    };
  }

  logger.player("[Crossfade] mixer player installed on connection");
}
