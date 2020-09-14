import Discord from 'discord.js';

import Config from './config.js';
import LiveChannel from './live_channel.js';

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
    for (const guild of bot.guilds.cache.array()) new LiveAccept(guild);
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
    const allowRoles = member.roles.cache
      .filter(role => this.liveConfig.allowRoles.includes(role.id));

    if (this.liveConfig.allowRoles.length && !allowRoles.size) return;

    this.liveAccepts[guild.id].startLive(message)
      .catch(console.error);
  }

  /**
   * Initialize live channels.
   * @param {Discord.Guild} guild Start live channel.
   */
  constructor(guild) {
    this.guild = guild;
    this.config = Config.read(guild.id);

    this.channel = this.initAccept();
    this.parent = this.channel?.parent;

    this.channels = this.initChannels();
    this.liveChannels = this.channels.map(channel => new LiveChannel(this, channel));

    this.config.on('liveAcceptUpdate', () => this.updateAccept()
      .catch(console.error));

    this.config.on('liveNameUpdate', () => this.updateChannels()
      .catch(console.error));

    this.config.on('liveMinUpdate', () => this.fillChannels()
      .catch(console.error));
  }

  /**
   * Initialize accept channel.
   * @returns {Discord.TextChannel|undefined}
   */
  initAccept() {
    const channelID = this.config.liveChannel.acceptChannel;

    if (!channelID) return undefined;

    const channel = this.guild.channels.cache
      .filter(channel => channel.type === 'text')
      .get(channelID);

    if (!channel) return undefined;

    LiveAccept.liveAccepts[channel.id] = this;

    return channel;
  }

  /**
   * Update accept
   */
  async updateAccept() {
    if (this.channel) delete LiveAccept.liveAccepts[this.channel.id];

    this.channel = this.initAccept();
    this.parent = this.channel?.parent;

    await this.updateChannels();
  }

  /**
   * Initialize list of live channel.
   */
  initChannels() {
    if (!this.channel) return [];

    const liveRegex = new RegExp(`(🔴)?${this.config.liveChannel.liveName}\d{1,3}`);
    const channels = this.parent?.children || this.guild.channels.cache

    return channels
      .filter(channel => channel.type === 'text' && liveRegex.test(channel.name))
      .sort((channelA, channelB) => channelA.position - channelB.position)
      .array();
  }

  /**
   * Update list of live channel.
   */
  async updateChannels() {
    this.channels = this.initChannels();
    this.liveChannels = this.channels.map(channel => new LiveChannel(this, channel));

    await this.config.setMinLive(null, [`${this.channels.length}`]);
    await this.config.setMaxLive(null, [`${this.channels.length}`]);
  }

  /**
   * Strat live.
   * @param {Discord.Message} message - Trigger message.
   */
  async startLive(message) {
    if (!this.channel) return;

    const maxLive = this.config.liveChannel.maxLive;
    let stillChannel = this.liveChannels.find(live => !live.living);

    if (!stillChannel) {
      if (this.liveChannels.length < maxLive) stillChannel = await this.addChannel();
      else {
        const response = await this.channel.send('', {
          embed: {
            color: 0xffcd61,
            title: '⚠️ 実況チャンネルに空きがありません'
          }
        });

        await response.react('🆕');

        return;
      }
    }

    await stillChannel.open(message);

    const response = await this.channel.send('', {
      embed: {
        color: 0xed3544,
        title: '🔴 実況を開始しました',
        description: `${stillChannel}`
      }
    });

    await response.react(this.config.liveChannel.closeEmoji);
  }

  async fillChannels() {
    if (!this.channel) return;

    const minLive = this.config.liveChannel.minLive;

    if (minLive <= this.channels.length) return;

    for (const _ of [...Array(minLive - this.channels.length)]) {
      await this.addChannel();
    }
  }

  /**
   * Add live channel.
   */
  async addChannel() {
    const baseName = this.config.liveChannel.liveName;
    const nextNumber = this.liveChannels.length + 1;
    const liveConfig = this.config.liveChannel;

    const newChannel = await this.guild.channels.create(`${baseName}${nextNumber}`, {
      parent: this.parent,
      position: this.nextPosition(),
      topic: liveConfig.topic,
      nsfw: liveConfig.nfsw,
      rateLimitPerUser: liveConfig.rateLimit,
      parent: this.parent,
      reason: 'To increase the number of live channels.'
    });

    for (const roleID of liveConfig.restricRoles) {
      await newChannel.updateOverwrite(roleID, { 'SEND_MESSAGES': false }, 'Create live');
    }

    const liveChannel = new LiveChannel(this, newChannel);

    this.channels.push(newChannel);
    this.liveChannels.push(liveChannel);

    return liveChannel;
  }

  /**
   * Calculate the position of the channel to add.
   */
  nextPosition() {
    const size = (this.parent ? this.parent.children.size : this.guild.channels.cache.size);
    const position = (this.channels.slice(-1)[0]?.position || this.channel.position) + 2;

    return size < position ? 0 : position;
  }
}
