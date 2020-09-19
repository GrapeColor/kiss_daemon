import Discord from 'discord.js';

import Config from './config.js';
import LiveChannel from './live_channel.js';

export default class LiveAccept {
  /**
   * Events to enter the client.
   * @param {Discord.Client} bot Discord.js Client.
   */
  static events(bot) {
    bot.on('ready', () => this.loadLiveChannels(bot) );

    bot.on('message', message => {
      const channel = message.channel;

      if (channel.type !== 'text' || message.author.bot || message.author.system)
        return;

      if (/https?:\/\/[\w!?/+\-_~;.,*&@#$%()'[\]]+/.test(message.content))
        this.liveAccepts[channel.id]?.startLive(message);
    });
  }

  /**
   * Entried live accepts.
   * @type {Object.<string, LiveAccept>}
   */
  static liveAccepts = {};

  /**
   * Load live channels.
   * @param {Discord.Client} bot 
   */
  static loadLiveChannels(bot) {
    for (const guild of bot.guilds.cache.array()) new LiveAccept(guild);
  }

  /**
   * Initialize live channels.
   * @param {Discord.Guild} guild Start live channel.
   */
  constructor(guild) {
    this.guild = guild;
    this.configTake = Config.take(guild.id);
    this.config = this.configTake.config;

    this.bot = guild.client;

    this.channel = this.initAccept();

    this.liveChannels = undefined;
    this.initChannels();

    this.configTake.on('liveAcceptUpdate', () => this.updateAccept());
    this.configTake.on('liveNameUpdate', () => this.updateChannels());
  }

  /**
   * Initialize accept channel.
   * @returns {Discord.TextChannel}
   */
  initAccept() {
    const channelID = this.config.acceptChannel;

    if (!channelID) return;

    const channel = this.guild.channels.cache
      .filter(channel => channel.type === 'text')
      .get(channelID);

    if (!channel) return;

    LiveAccept.liveAccepts[channelID] = this;

    return channel;
  }

  /**
   * Update accept
   */
  updateAccept() {
    if (this.channel) delete LiveAccept.liveAccepts[this.channel.id];

    this.channel = this.initAccept();

    this.updateChannels();
  }

  /**
   * Initialize list of live channel.
   */
  initChannels() {
    if (!this.channel) return;

    const liveRegex = new RegExp(`^${this.config.liveName}\\d{1,3}$`);
    const channels = this.guild.channels.cache;

    this.liveChannels = channels
      .filter(channel => channel.type === 'text' && liveRegex.test(channel.name))
      .sort((channelA, channelB) => channelA.position - channelB.position)
      .array()
      .map(channel => new LiveChannel(this, channel));

    Promise.all(this.liveChannels.map(live => live.checkLiving()))
      .catch(console.error);
  }

  /**
   * Update list of live channel.
   */
  updateChannels() {
    Promise.all(this.liveChannels.map(live => live.webhook.delete()))
      .catch(console.error)
      .finally(() => this.initChannels());
  }

  /**
   * Strat live.
   * @param {Discord.Message} message - Trigger message.
   */
  startLive(message) {
    const stillChannel = this.liveChannels.find(live => !live.living);

    if (stillChannel) stillChannel.open(message);
    else this.channel.send('🈵 **実況チャンネルに空きがありません**')
      .then(response => {
        this.bot.setTimeout(() => {
          response.delete()
            .catch(console.error);
        }, 60000);
      });
  }
}
