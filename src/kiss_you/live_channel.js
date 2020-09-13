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
   * @param {LiveAccept} accept Live accept.
   * @param {Discord.TextChannel} channel Live channel.
   */
  constructor(accept, channel) {
    this.accept = accept;
    this.channel = channel;

    const matchLiving = channel.topic.match(LiveChannel.LIVING_REGEX);
    this.living = !!matchLiving;
    this.triggerID = this.living ? matchLiving[1] : undefined;
    this.copyID = this.living ? matchLiving[1] : undefined;

    if (this.triggerID) this.accept.channel.messages.fetch(this.triggerID)
      .then(message => this.trigger = message)
      .catch(this.trigger = undefined);

    if (this.copyID) this.channel.messages.fetch(this.copyID)
      .then(message => this.copy = message)
      .catch(this.copy = undefined);

    LiveChannel.liveChannels[channel.id] = this;
  }
}
