/**
 * @module commands/player
 * @description Create an interactive player control panel with live progress, reaction controls,
 * and embedded lyrics viewer. The panel embed construction, display constants and the lyrics
 * viewer live in commands/player/; run() below owns the session lifecycle (player event wiring
 * and the control-reaction dispatcher).
 *
 * LOCAL PATCH (always-on panel):
 *  - the panel never expires from inactivity and its reactions are never removed; it lives until
 *    someone presses the close button or the bot leaves voice / the player is destroyed;
 *  - the panel is always re-posted as the LAST message of the channel: after any new message
 *    (once the chat is quiet for SETTLE_MS) and when a new track starts. The old panel is deleted;
 *  - if the panel can no longer be edited (e.g. somebody deleted it) it is re-posted;
 *  - if re-posting fails, the old panel simply keeps working.
 */

import { CommandBuilder } from "../src/commands/index.mjs";
import { Events } from "@fluxerjs/core";
import { Utils } from "../src/utils/Utils.mjs";
import { getGlobalColor } from "../src/ui/index.mjs";
import { logger } from "../src/core/Logger.mjs";
import { CONTROLS, buildPlayerEmbed, openLyricsViewer, clearLyricsReactions } from "./player/index.mjs";

/** @type {CommandBuilder} @description Command definition for the player command. */
export const command = new CommandBuilder()
    .setName("player")
    .setDescription("Create an interactive player control panel with live progress", "commands.player")
    .setCategory("music");

/** Chat must be quiet for this long (ms) before the panel is moved to the bottom. */
const SETTLE_MS = 2500;
/** Minimum time (ms) between two panel moves — protects against API rate limits in busy chats. */
const MIN_MOVE_GAP_MS = 6000;
/** In a never-quiet chat, the move is forced after waiting this long (ms). */
const MAX_DEFER_MS = 15000;

/**
 * @private
 * Get the message id of a wrapped message (or raw message) as a string.
 * @param {object} wrapped
 * @returns {string}
 */
const idOf = (wrapped) => String(wrapped?.message?.id ?? wrapped?.id ?? "");

/**
 * @private
 * Delete a wrapped message, trying the raw message first and the wrapper second.
 * @param {object} wrapped - Wrapped message (has .message and maybe .delete).
 * @returns {Promise<boolean>} True if the message was deleted.
 */
async function deleteWrapped(wrapped) {
  if (!wrapped) return false;
  try {
    await wrapped.message.delete();
    return true;
  } catch (e1) {
    try {
      await wrapped.delete();
      return true;
    } catch (e2) {
      logger.warn("[Player] Could not delete message:", e2?.message ?? e1?.message);
      return false;
    }
  }
}

/**
 * @async
 * Run handler for the player command.
 * Creates an interactive embed panel with playback controls, progress bar,
 * volume display, and an embedded lyrics viewer.
 * @param {object} msg - The command message wrapper.
 * @returns {Promise<void>}
 */
export async function run(msg) {
  const player = await this.getPlayer(msg, false, false, false);
  if (!player) return;

  const timeout = Math.max(60_000, this.config?.timers?.playerSessionTimeout ?? this.config?.playerAFKTimeout ?? 300000);
  const controlsLayout = [
    [CONTROLS.prev, CONTROLS.play, CONTROLS.pause, CONTROLS.stop, CONTROLS.next],
    [CONTROLS.loop, CONTROLS.shuffle, CONTROLS.volDown, CONTROLS.volUp, CONTROLS.lyrics],
    [CONTROLS.filter, CONTROLS.close]
  ];

  const allControls = controlsLayout.flat();
  const controlEmojis = allControls.map(c => c.emoji);
  const channelId = String(msg.message?.channelId ?? msg.channel?.id ?? "");

  /** The "Session expires in Xm of inactivity" text — hidden, because the panel never expires. */
  const expiryText = (() => {
    try {
      return this.t(msg, "responses.player.sessionExpires", { minutes: Math.ceil(timeout / 60000) }) || "";
    } catch (_) {
      return "";
    }
  })();

  /**
   * @private
   * Build the panel embed without the (now meaningless) session-expiry line.
   * Best effort: if the embed shape is unexpected the line is simply left in place.
   * @param {object} [state={}]
   * @returns {object} The embed.
   */
  const build = (state = {}) => {
    const embed = buildPlayerEmbed(this, msg, player, timeout, state);
    if (!expiryText) return embed;
    try {
      const desc = embed?.data?.description ?? embed?.description;
      if (typeof desc === "string" && desc.includes(expiryText)) {
        const cleaned = desc.split("\n").filter(line => !line.includes(expiryText)).join("\n").trimEnd();
        if (typeof embed.setDescription === "function") embed.setDescription(cleaned);
        else if (embed.data) embed.data.description = cleaned;
      }
    } catch (_) { /* leave the embed untouched */ }
    return embed;
  };

  /**
   * @private
   * Add every control reaction to a wrapped panel message.
   * @param {object} target - Wrapped message with a .message property.
   * @returns {Promise<void>}
   */
  const addReactions = async (target) => {
    for (const row of controlsLayout) {
      for (const control of row) {
        try {
          await target.message.react(control.emoji);
          await Utils.sleep(50);
        } catch(e) { logger.warn("[Player] Error:", e?.message); }
      }
    }
  };

  let message = await msg.reply({ embeds: [build()] });
  if (!message?.message) return;

  /** Ids of messages that belong to this panel session (panels + lyrics viewer) — never trigger a move. */
  const ownIds = new Set([idOf(message)]);

  await addReactions(message);

  let updateInterval;
  let lastState = {};
  let unobserve = null;
  let moving = false;
  let seenDuringMove = [];
  let moveTimer = null;
  let moveQueuedAt = 0;
  let moveReason = null;
  let lastMovedAt = Date.now();
  let editFailures = 0;
  let _sessionClosed = false;

  /** @private @type {object} Shared lyrics-viewer session state (cleaned up by closeSession). */
  const lyrics = { activeLyricsMsg: null, unobserve: null, emojiTimeout: null };

  /**
   * @private
   * Remove all control reactions from a panel message (defaults to the current panel).
   * @param {object} [target=message]
   * @returns {Promise<void>}
   */
  const clearReactions = async (target = message) => {
    try {
      await target.message.removeAllReactions();
    } catch (e) {
      for (const emoji of controlEmojis) {
        try {
          await target.message.removeReaction(emoji);
        } catch(e) { logger.warn("[Player] Error:", e?.message); }
      }
    }
  };

  /**
   * @private
   * Schedule a re-post of the panel at the bottom of the channel (debounced).
   * @param {"track"|"message"|"recover"} reason - "track" also removes the previous track's lyrics viewer.
   * @returns {void}
   */
  const scheduleMove = (reason) => {
    if (_sessionClosed) return;
    if (reason === "track" || !moveReason) moveReason = reason;

    if (moveTimer) {
      if (Date.now() - moveQueuedAt >= MAX_DEFER_MS) return; // waited long enough, let it fire
      clearTimeout(moveTimer);
    } else {
      moveQueuedAt = Date.now();
    }

    const wait = Math.max(SETTLE_MS, MIN_MOVE_GAP_MS - (Date.now() - lastMovedAt));
    moveTimer = setTimeout(() => {
      moveTimer = null;
      const why = moveReason;
      moveReason = null;
      movePanel(why);
    }, wait);
  };

  /**
   * @private
   * Rebuild and edit the player panel embed with updated state.
   * @param {object} [extra={}] - Additional state data to merge (e.g. status message).
   * @returns {void}
   */
  const refresh = (extra = {}) => {
    const embed = build(extra);
    message.edit({ embeds: [embed] })
        .then(() => { editFailures = 0; })
        .catch(() => {
          // The panel can no longer be edited (deleted?) — post a fresh one instead of going silent.
          if (++editFailures >= 3) {
            editFailures = 0;
            scheduleMove("recover");
          }
        });
    lastState = extra;
  };

  /**
   * @private
   * @async
   * Tear down the entire player session: clear timers, remove listeners,
   * clean up reactions, and edit the embed to show the closed state.
   * @param {string} [reason="timeout"] - The reason for closing ("user", "disconnected").
   * @returns {Promise<void>}
   */
  const closeSession = async (reason = "timeout") => {
    if (_sessionClosed) return;
    _sessionClosed = true;

    clearTimeout(moveTimer);
    moveTimer = null;
    clearInterval(updateInterval);
    unobserve?.();

    try { (this.client?.off ?? this.client?.removeListener)?.call(this.client, Events.MessageCreate, onChannelMessage); } catch (_) {}

    player.off("startplay", onStartPlay);
    player.off("playback",  onPlayback);
    player.off("stopplay",  onStopPlay);
    player.off("queue",     onQueue);
    player.off("volume",    onVolume);
    player.off("filter",    onFilter);
    player.off("autoleave", onAutoLeave);
    player.off("leave",     onAutoLeave);

    if (lyrics.unobserve) {
      lyrics.unobserve();
      clearTimeout(lyrics.emojiTimeout);
    }
    if (lyrics.activeLyricsMsg) {
      await clearLyricsReactions(lyrics.activeLyricsMsg);
    }

    await clearReactions();

    const closedEmbed = build({
      message: this.t(msg, "responses.player.sessionClosed", { reason: reason !== "timeout" ? ` • ${reason}` : "" })
    });
    closedEmbed.setColor(getGlobalColor());
    closedEmbed.setFooter({ text: this.t(msg, "responses._common.sessionEnded") });
    closedEmbed.setTitle(this.t(msg, "responses.player.inactiveTitle"));

    await message.edit({
      embeds: [closedEmbed],
      content: reason === "user" ? this.t(msg, "responses.player.closedByUser") : undefined
    }).catch(() => {});
  };

  /**
   * @private
   * @async
   * Re-post the panel at the bottom of the channel and remove the old one. The new panel is
   * posted first, so if posting fails the existing panel stays in place and keeps working.
   * A "track" move also removes the lyrics viewer (it belongs to the previous track).
   * @param {"track"|"message"|"recover"} reason
   * @returns {Promise<void>}
   */
  const movePanel = async (reason) => {
    if (moving || _sessionClosed) return;
    moving = true;
    seenDuringMove = [];
    try {
      const old = message;
      const oldUnobserve = unobserve;

      const fresh = await msg.reply({ embeds: [build(lastState)] });
      if (!fresh?.message) return;
      ownIds.add(idOf(fresh));

      if (_sessionClosed) {
        await deleteWrapped(fresh);
        return;
      }

      oldUnobserve?.();
      message = fresh;
      editFailures = 0;
      lastMovedAt = Date.now();

      if (!(await deleteWrapped(old))) await clearReactions(old);

      if (reason === "track") {
        if (lyrics.unobserve) {
          try { lyrics.unobserve(); } catch (_) {}
        }
        clearTimeout(lyrics.emojiTimeout);
        if (lyrics.activeLyricsMsg) {
          if (!(await deleteWrapped(lyrics.activeLyricsMsg))) await clearLyricsReactions(lyrics.activeLyricsMsg);
        }
        lyrics.unobserve = null;
        lyrics.activeLyricsMsg = null;
      }

      unobserve = message.onReaction(controlEmojis, handleReaction);
      await addReactions(message);
    } catch (e) {
      logger.warn("[Player] Failed to move panel:", e?.message ?? e);
    } finally {
      moving = false;
      // Messages from other people that arrived while we were busy: the panel is not last again.
      const lyricsId = idOf(lyrics.activeLyricsMsg);
      if (!_sessionClosed && seenDuringMove.some(id => !ownIds.has(id) && id !== lyricsId)) {
        scheduleMove("message");
      }
      seenDuringMove = [];
    }
  };

  /**
   * @private
   * Gateway listener: any new message in the panel's channel (except our own) pushes the panel down.
   * @param {object} m - Raw message.
   * @returns {void}
   */
  const onChannelMessage = (m) => {
    try {
      if (_sessionClosed || !m || String(m.channelId) !== channelId) return;
      const id = String(m.id);
      if (ownIds.has(id) || id === idOf(lyrics.activeLyricsMsg)) return;
      if (moving) {
        seenDuringMove.push(id);
        return;
      }
      scheduleMove("message");
    } catch (e) {
      logger.warn("[Player] Message listener error:", e?.message);
    }
  };

  updateInterval = setInterval(() => {
    if (player._destroyed || player.leaving) {
      closeSession("disconnected");
      return;
    }
    if (!player.paused && player.queue.getCurrent()) {
      refresh(lastState);
    }
  }, this.config?.timers?.playerUpdateInterval ?? 5000);

  const onStartPlay  = ()       => {
    refresh({ message: this.t(msg, "responses.player.startedPlaying") });
    scheduleMove("track");
  };
  const onPlayback   = (playing) => refresh({ message: playing ? this.t(msg, "responses.player.resumed") : this.t(msg, "responses.player.pausedState") });
  const onStopPlay   = ()       => refresh({ message: this.t(msg, "responses.player.stopped") });
  const onQueue      = (e)      => {
    if (e.type === "shuffle") refresh({ message: this.t(msg, "responses.player.shuffled") });
    if (e.type === "add") refresh({ message: this.t(msg, "responses.player.added", { title: Utils.truncate(e.data.data.title, 30) }) });
  };
  const onVolume     = (v)      => refresh({ message: this.t(msg, "responses.player.volumeChanged", { volume: Math.round(v * 100) }) });
  const onFilter     = (f)      => {
    if (!f) {
      refresh({ message: this.t(msg, "responses.player.filtersCleared") });
    } else if (f.label.includes("+")) {
      refresh({ message: this.t(msg, "responses.player.filterStackedApplied", { label: f.label }) });
    } else {
      refresh({ message: this.t(msg, "responses.player.filterApplied", { emoji: f.emoji ?? "🎛️", label: f.label }) });
    }
  };
  const onAutoLeave  = ()       => closeSession("disconnected");

  player.on("startplay",  onStartPlay);
  player.on("playback",   onPlayback);
  player.on("stopplay",   onStopPlay);
  player.on("queue",      onQueue);
  player.on("volume",     onVolume);
  player.on("filter",     onFilter);
  player.on("autoleave",  onAutoLeave);
  player.on("leave",      onAutoLeave);

  /**
   * @private
   * @async
   * Control-reaction dispatcher, shared by the original panel and every re-posted one.
   * @param {object} e - Reaction event.
   * @returns {Promise<void>}
   */
  const handleReaction = async (e) => {
    const control = allControls.find(c => c.emoji === e.emoji_id);
    if (!control) return;

    let reply = "";
    let shouldUpdate = true;

    try {
      switch (control.action) {
        case "previous":
          reply = this.t(msg, "responses.player.previousNotAvailable");
          break;

        case "resume":
          if (player.paused) {
            reply = player.resume();
          } else if (!player.queue.getCurrent() && !player.queue.isEmpty()) {
            player.playNext().catch(() => {});
            reply = this.t(msg, "responses.player.startingPlayback");
          } else {
            reply = this.t(msg, "responses.player.alreadyPlaying");
          }
          break;

        case "pause":
          reply = player.pause();
          break;

        case "stop": {
          const hadCurrent = !!player.queue.getCurrent();
          player._lastPlayedTrack = player.queue.getCurrent() ?? player._lastPlayedTrack;
          player.queue.reset();
          player._activeTrackOpt = null;
          player._clearTrackEndTimer?.();
          player._bridgeStop?.();
          player._paused = false;
          player._pausedAt = null;
          if (hadCurrent) {
            player.emit("stopplay");
            if (!player._is247Enabled?.()) player._startInactivityTimer?.();
          }
          reply = this.t(msg, "responses.player.stoppedCleared");
          break;
        }

        case "skip":
          reply = player.skip();
          break;

        case "loop": {
          const currentLoop = player.queue.loop;
          const currentSongLoop = player.queue.songLoop;
          if (!currentLoop && !currentSongLoop) {
            player.queue.setSongLoop(true);
            reply = this.t(msg, "responses.player.songLoopEnabled");
          } else if (currentSongLoop) {
            player.queue.setSongLoop(false);
            player.queue.setLoop(true);
            reply = this.t(msg, "responses.player.queueLoopEnabled");
          } else {
            player.queue.setLoop(false);
            reply = this.t(msg, "responses.player.loopDisabled");
          }
          break;
        }

        case "shuffle":
          reply = player.shuffle();
          break;

        case "voldown": {
          const newVolDown = Utils.clamp((player.preferredVolume ?? 1) - 0.1, 0, 1);
          reply = player.setVolume(newVolDown);
          break;
        }

        case "volup": {
          const newVolUp = Utils.clamp((player.preferredVolume ?? 1) + 0.1, 0, 1);
          reply = player.setVolume(newVolUp);
          break;
        }

        case "filter":
          reply = this.t(msg, "responses.player.openingFilterPicker");
          shouldUpdate = true;
          try {
            const { run: runFilter } = await import("./filter.mjs");
            await runFilter.call(this, msg);
          } catch (err) {
            reply = this.t(msg, "responses.player.filterError", { error: Utils.truncate(err.message, 50) });
          }
          break;

        case "lyrics":
          reply = await openLyricsViewer(this, msg, player, refresh, lyrics);
          shouldUpdate = true;
          break;

        case "close":
          await closeSession("user");
          return;
      }
    } catch (err) {
      reply = this.t(msg, "responses.player.errorGeneric", { error: err.message });
    }

    if (shouldUpdate) refresh({ message: reply });
  };

  unobserve = message.onReaction(controlEmojis, handleReaction);

  try {
    this.client.on(Events.MessageCreate, onChannelMessage);
  } catch (e) {
    logger.warn("[Player] Could not listen for channel messages — panel will only move on new tracks:", e?.message);
  }
}
