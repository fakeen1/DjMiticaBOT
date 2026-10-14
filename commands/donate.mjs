/**
 * @module commands/donate
 * @description Shows the donation link. Dj Mitica is free; donations are voluntary.
 */

import { CommandBuilder } from "../src/commands/index.mjs";
import { EmbedBuilder } from "@fluxerjs/core";
import { getGlobalColor } from "../src/ui/index.mjs";
import { getDonateUrl } from "../src/utils/Donate.mjs";

/** @type {CommandBuilder} @description Command definition for the donate command. */
export const command = new CommandBuilder()
  .setName("donate")
  .setDescription("Support Dj Mitica with a voluntary donation. The bot stays free for everyone.", "commands.donate")
  .addAliases("donation", "tip", "coffee")
  .setCategory("util");

/**
 * Run handler for the donate command.
 * @param {object} msg - The command message wrapper.
 * @returns {void}
 */
export function run(msg) {
  const config = this.client?._djmitica?.config ?? this.config;
  const url = getDonateUrl(config);
  const embed = new EmbedBuilder()
    .setColor(getGlobalColor())
    .setTitle(this.t(msg, "responses.donate.title"))
    .setDescription(url
      ? this.t(msg, "responses.donate.description", { url })
      : this.t(msg, "responses.donate.disabled"));
  msg.reply({ embeds: [embed] }).catch(() => {});
}
