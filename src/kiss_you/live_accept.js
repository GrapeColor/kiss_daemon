import Discord from 'discord.js';

import Config from './config.js';
import LiveChannel from './live_channel.js'

import _ from 'lodash';

export default class LiveAccept {
  /**
   * Events to enter the client.
   * @param {Discord.Client} bot Discord.js Client.
   */
  static events(bot) {
    bot.on('ready', () => {
      this.loadLiveChannels(bot);
    });

    bot.on('message', message => {
      const channel = message.channel;

      if (channel.type !== 'text' || message.author.bot) return;

      if (!this.liveAccepts[channel.id]) return;

      if (/https?:\/\/[\w!?/+\-_~;.,*&@#$%()'[\]]+/.test(message.content))
        this.acceptLive(channel, message);
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
    const guilds = bot.guilds.cache.array();

    for (const guild of guilds) {
      const config = Config.read(guild.id);
      const acceptID = config.liveChannel.acceptChannel;

      if (!acceptID) continue;

      const accept = guild.channels.cache.get(acceptID);

      if (!accept) continue;

      new LiveAccept(accept, config);
    }
  }

  /**
   * Generate live channel.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   * @param {Discord.Message} message - Event trigger message.
   */
  static acceptLive(channel, message) {
    const guild = channel.guild;
    this.liveConfig = Config.read(guild.id).liveChannel;

    const member = channel.guild.members.resolve(message.author);
    const roles = member.roles.cache
      .filter(role => this.liveConfig.allowRoles.includes(role.id));

    if (liveConfig.allowRoles.length && !roles.size) return;

    this.liveAccepts[guild.id].startLive(message);
  }

  /**
   * Initialize live channels.
   * @param {Discord.TextChannel} accept Start live channel.
   * @param {Config} config - Config of live channel.
   */
  constructor(accept, config) {
    this.channel = accept;
    this.parent = accept.parent;
    this.guild = accept.guild;
    this.config = config;

    this.channels = this.initChannels();
    this.liveChannels = this.channels.map(channel => new LiveChannel(channel));

    LiveAccept.liveAccepts[this.guild.id] = this;

    config.on('liveNameUpdate', () => this.updateChannels()
      .catch(console.error));
  }

  /**
   * Initialize list of live channel.
   */
  initChannels() {
    const liveRegex = new RegExp(`(🔴)?${this.config.liveChannel.liveName}\d{1,3}`);
    const guildChannels = this.guild.channels.cache;

    return (this.parent?.children || guildChannels)
      .filter(channel => channel.type === 'text' && liveRegex.test(channel.name))
      .array();
  }

  /**
   * Update list of live channel.
   */
  async updateChannels() {
    const liveChannels = this.initChannels();
    const liveSize = liveChannels.length;

    await this.config.setMinLive(null, [`${liveSize}`]);
    await this.config.setMaxLive(null, [`0`]);

    return liveChannels;
  }

  /**
   * Strat live.
   * @param {Discord.Message} message - Trigger message.
   */
  async startLive(message) {
    const maxLive = this.config.liveChannel.maxLive
    let stillChannel = this.liveChannels.find(live => !live.living);

    if (!stillChannel && this.liveChannels.length >= maxLive) {
      message.channel.send('', {
        embed: {
          title: '⚠️ 実況チャンネルに空きがありません'
        }
      });
    }
  }

  async addChannel() {
    const baseName = this.config.liveChannel.liveName;
    const nextNumber = this.liveChannels.length + 1;
    const liveConfig = this.config.liveChannel;

    const newChannel = this.guild.channels.create(`${baseName}${nextNumber}`, {
      position: this.channels.slice(-1)[0],
      permissionOverwrites: this.restrictOverrites(),
      topic: liveConfig.defaultTopic,
      nsfw: liveConfig.defaultNSFW,
      rateLimitPerUser: liveConfig.defaultRateLimit,
      parent: this.parent,
      reason: 'To increase the number of live channels.'
    });
  }

  /**
   * Get restrict overrites in live channel.
   * @returns {Discord.OverwriteData[]}
   */
  restrictOverrites() {
    const guildRoles = this.guild.roles.cache;

    return _(this.config.liveChannel.restricRoles).map(roleID => {
      if (!guildRoles.has(roleID)) return;

      return { id: roleID, deny: 'SEND_MESSAGES', type: 'role' };
    }).compact().value();
  }
}
