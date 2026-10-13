/**
 * @module commands/invite
 * @description Shows the link that adds this bot to another server, plus the
 * GitHub page for people who want to run their own copy.
 */

import { CommandBuilder } from "../src/commands/index.mjs";
import { EmbedBuilder } from "@fluxerjs/core";
import { getGlobalColor } from "../src/ui/index.mjs";
import { buildInviteUrl } from "../src/utils/Invite.mjs";

/**
 * @type {CommandBuilder}
 * @description Command definition for the invite command.
 */
export const command = new CommandBuilder()
    .setName("invite")
    .setDescription("Get the link to add Dj Mitica to your server.", "commands.invite")
    .addAliases("addbot", "djmitica")
    .setCategory("util");

/**
 * Run handler for the invite command.
 * Sends an embed with this bot's invite link and the GitHub page.
 *
 * @param {object} message - The command message wrapper.
 * @returns {Promise<void>}
 */
export async function run(message) {
    const botUser = this.client?.user;
    const botIcon = botUser?.displayAvatarURL?.() || null;
    const name = botUser?.globalName || botUser?.username || "Dj Mitica";
    const url = buildInviteUrl(this.client?._djmitica ?? { config: this.config, client: this.client });

    const parts = [];
    if (url) parts.push(this.t(message, "responses.invite.addLink", { name, url }));
    parts.push(this.t(message, "responses.invite.description"));

    const embed = new EmbedBuilder()
        .setColor(getGlobalColor())
        .setAuthor({
            name: this.t(message, "responses.invite.title", { name }),
            iconURL: botIcon
        })
        .setDescription(parts.join("\n\n"))
        ;

    await message.reply({
        embeds: [embed]
    }).catch(() => {});
}
