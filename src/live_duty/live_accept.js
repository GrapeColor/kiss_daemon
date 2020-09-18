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
        this.liveAccepts[channel.id]?.startLive(message)
          .catch(console.error);
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

    this.liveChannels = this.initChannels()
      .map(channel => new LiveChannel(this, channel));

    Promise.all(this.liveChannels.map(live => live.checkLiving()))
      .catch(console.error);

    this.configTake.on('liveAcceptUpdate', () => this.updateAccept()
      .catch(console.error));

    this.configTake.on('liveNameUpdate', () => this.updateChannels()
      .catch(console.error));
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
  async updateAccept() {
    if (this.channel) delete LiveAccept.liveAccepts[this.channel.id];

    this.channel = this.initAccept();

    await this.updateChannels();
  }

  /**
   * Initialize list of live channel.
   * @returns {Discord.TextChannel[]}
   */
  initChannels() {
    if (!this.channel) return [];

    const liveRegex = new RegExp(`^${this.config.liveName}\\d{1,3}$`);
    const channels = this.guild.channels.cache;

    return channels
      .filter(channel => channel.type === 'text' && liveRegex.test(channel.name))
      .sort((channelA, channelB) => channelA.position - channelB.position)
      .array();
  }

  /**
   * Update list of live channel.
   */
  async updateChannels() {
    await Promise.all(this.liveChannels.map(live => live.webhook.delete()));

    this.liveChannels = this.initChannels()
      .map(channel => new LiveChannel(this, channel));

    await Promise.all(this.liveChannels.map(live => live.checkLiving()));
  }

  /**
   * Strat live.
   * @param {Discord.Message} message - Trigger message.
   */
  async startLive(message) {
    const stillChannel = this.liveChannels.find(live => !live.living);

    if (stillChannel)
      await stillChannel.open(message);
    else {
      const response = await this.channel.send('🈵 **実況チャンネルに空きがありません**');

      this.bot.setTimeout(() => response.delete()
        .catch(console.error), 60000);
    }
  }
}
