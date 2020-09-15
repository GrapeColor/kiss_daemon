import Discord, { ReactionEmoji } from 'discord.js';

import Config from './config.js';
import LiveChannel from './live_channel.js';

import _ from 'lodash';

export default class LiveAccept {
  static COLOR_LIVE_OPENED = 0xed3544;
  static COLOR_LIVE_CLOSED = 0xe6e7e8;
  static COLOR_LIVE_CANCEL = 0x64757e;

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

    bot.on('messageReactionAdd', (reaction, user) => {
      if (user.bot) return;

      if (reaction.message.author.id === bot.user.id && reaction.me)
        this.liveAccepts[reaction.message.channel.id].reactionAdd(reaction, user)
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

    this.liveAccepts[channel.id].startLive(message)
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

    LiveAccept.liveAccepts[channelID] = this;

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

    const liveRegex = new RegExp(`^${this.config.liveChannel.liveName}\\d{1,3}`);
    const channels = this.parent?.children || this.guild.channels.cache;

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
   * Handle additional reaction event.
   * @param {Discord.MessageReaction} reaction 
   * @param {Discord.User} user 
   */
  async reactionAdd(reaction, user) {
    const emoji = reaction.emoji;
    const closeEmoji = this.config.liveChannel.closeEmoji;

    if (emoji.name === closeEmoji || emoji.id === closeEmoji)
      await this.endLive(reaction, user);
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
            title: '⚠️ 実況チャンネルに空きがありません',
            footer: {
              text: '管理者は下のリアクションで一時的にチャンネルを追加できます'
            }
          }
        });

        await response.react('☑️');

        return;
      }
    }

    await stillChannel.open(message);
  }

  /**
   * End live.
   * @param {Discord.MessageReaction} reaction - Event trigger reaction. 
   * @param {Discord.User} user Event trigger user.
   */
  async endLive(reaction, user) {
    const liveChannel = this.liveChannels
      .find(live => live.response.id === reaction.message.id);

    if (!liveChannel) return;

    const onlySelf = this.config.liveChannel.onlySelf;

    if ((onlySelf && user.id !== liveChannel.trigger?.author.id)
      && !this.isAllowUser(user)) return;

    await liveChannel.close();
  }

  /**
   * Is the user allowed to operate?
   * @param {Discord.User} user 
   */
  isAllowUser(user) {
    const member = this.guild.member(user);
    const permissions = this.channel.permissionsFor(member);

    if (permissions.has('MANAGE_CHANNELS')) return true;

    const roles = member.roles.cache;
    let hasAdminRole = false;

    for (const roleID of this.config.adminRoles) {
      hasAdminRole =  roles.has(roleID) ? true : false;

      if (hasAdminRole) break;
    }

    return hasAdminRole;
  }

  async fillChannels() {
    if (!this.channel) return;

    const minLive = this.config.liveChannel.minLive;

    if (minLive > this.channels.length)
      for (const _ of [...Array(minLive - this.channels.length)])
        await this.addChannel();
    else
      for (const _ of [...Array(this.channels.length - minLive)])
        await this.removeChannel();
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

    for (const roleID of liveConfig.restricRoles)
      await newChannel.updateOverwrite(roleID, { 'SEND_MESSAGES': false }, 'Create live');

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
    const nextPosition = (this.channels.slice(-1)[0]?.position || this.channel.position) + 2;

    return size < nextPosition ? 0 : nextPosition;
  }

  async removeChannel(number = this.channels.length - 1) {
    const liveChannel = this.liveChannels[number];

    if (liveChannel.living) return;

    this.channels = this.channels.filter((_, n) => n !== number);
    this.liveChannels = this.liveChannels.filter((_, n) => n !== number);

    await liveChannel.channel.delete('Delete unnecessary the live channel');
  }
}
