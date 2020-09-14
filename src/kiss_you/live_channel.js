import Discord from 'discord.js';

import LiveAccept from './live_accept.js';

export default class LiveChannel {
  static LIVING_REGEX = /<LIVE:(\d+):(\d+)>/;

  /**
   * Entried live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveChannels = {}

  /**
   * Initialize live channel.
   * @param {LiveAccept} accept - Live accept.
   * @param {Discord.TextChannel} channel - Live channel.
   * @param {number} number - Live channel number.
   */
  constructor(accept, channel, number) {
    this.accept = accept;
    this.channel = channel;
    this.number = number;

    const matchLiving = channel.topic?.match(LiveChannel.LIVING_REGEX);
    this.living = !!matchLiving;
    this.triggerID = this.living ? matchLiving[1] : undefined;
    this.replicaID = this.living ? matchLiving[1] : undefined;

    if (this.triggerID) this.accept.channel.messages.fetch(this.triggerID)
      .then(message => this.trigger = message)
      .catch(this.trigger = undefined);

    if (this.replicaID) this.channel.messages.fetch(this.replicaID)
      .then(message => this.replica = message)
      .catch(this.replica = undefined);

    LiveChannel.liveChannels[channel.id] = this;
  }

  async open(message) {
    const liveConfig = this.accept.config.liveChannel;

    this.living = true;

    try {
      this.replica = await this.channel.send(message);

      if (liveConfig.pinLink) await this.replica.pin({ reason: 'Opne live' });
      for (const roleID of liveConfig.restricRoles) {
        await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': true }, 'Open live');
      }
      if (liveConfig.liveBadge) await this.channel.setName(`🔴${this.channel.name}`);

      await this.channel.setTopic(
        `${this.channel.topic}\n<LIVE:${message.id}:${this.replica.id}>`
      );
    } catch(error) {
      this.living = false;
      throw error;
    }
  }

  /**
   * Convert channel mention.
   */
  toString() { return this.channel.toString(); }
}
