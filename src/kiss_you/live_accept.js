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

      if (channel.type !== 'text' || message.author.bot) return;

      if (/https?:\/\/[\w!?/+\-_~;.,*&@#$%()'[\]]+/.test(message.content))
        this.liveAccepts[channel.id]?.startLive(message)
          .catch(console.error);
    });

    bot.on('messageReactionAdd', (reaction, user) => {
      if (user.bot) return;

      this.liveAccepts[reaction.message.channel.id]
        ?.extensionLive(reaction, user)
          .catch(console.error);
    });
  }

  static COLOR_LIVE_FAILD = 0xffcd60;
  static COLOR_LIVE_FULL  = 0xffcd61;

  static EMOJI_EXTENSION = '🆕';

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
    this.config = Config.read(guild.id);

    this.channel = this.initAccept();
    this.parent = this.channel?.parent;

    this.channels = this.initChannels();
    this.liveChannels
      = this.channels.map((channel, n) => new LiveChannel(this, channel, n));

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
   * Strat live.
   * @param {Discord.Message} message - Trigger message.
   */
  async startLive(message) {
    const liveConfig = this.config.liveChannel;
    const member = this.guild.member(member.author);

    const roleIDs = member.roles.cache.keyArray();
    const allowRole
      = roleIDs.find(roleID => liveConfig.allowRoles.includes(roleID));

    if (liveConfig.allowRoles.length && !allowRole) return;

    const maxLive = this.config.liveChannel.maxLive;
    let stillChannel = this.liveChannels.find(live => !live.living);

    if (!stillChannel) {
      if (this.liveChannels.length < maxLive) stillChannel = await this.addChannel();
      else {
        const embed = new Discord.MessageEmbed({ color: LiveAccept.COLOR_LIVE_FULL });

        embed.title = '⚠️ 実況チャンネルに空きがありません';
        embed.footer = { text: '管理者は下のリアクションで一時的にチャンネルを追加できます' };

        const response = await this.channel.send(embed);

        await response.react(LiveAccept.EMOJI_EXTENSION);

        return;
      }
    }

    await stillChannel.open(message);
  }

  /**
   * End live.
   * @param {number} number 
   */
  async endLive(number) {
    if (number <= this.config.liveChannel.minLive) return;

    await this.removeChannel(number);
  }

  /**
   * 
   * @param {Discord.MessageReaction} reaction 
   * @param {Discord.User} user 
   */
  async extensionLive(reaction, user) {
    if (reaction.emoji.name !== LiveAccept.EMOJI_EXTENSION) return;

    const member = this.guild.member(user);
    const roleIDs = member?.roles.cache.keyArray();

    if (!roleIDs) return;

    const adminRoles = this.config.adminRoles;
    const allowRole = roleIDs.find(roleID => adminRoles.includes(roleID));

    if (!allowRole) return;

    await this.addChannel();
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

    let newChannel;

    try {
      newChannel = await this.guild.channels.create(`${baseName}${nextNumber}`, {
        parent: this.parent,
        position: this.nextPosition(),
        topic: liveConfig.topic,
        nsfw: liveConfig.nfsw,
        rateLimitPerUser: liveConfig.rateLimit,
        parent: this.parent
      });
    } catch {
      const embed = new Discord.MessageEmbed({ color: LiveAccept.COLOR_LIVE_FAILD });

      embed.title = '⚠️ 実況チャンネルが作成できません';
      if (this.guild.channels.cache.size >= 500 || this.parent?.children.size >= 50)
        embed.description = 'サーバー、またはカテゴリー内のチャンネルが満杯です。'

      await this.channel.send(embed);
    }

    for (const roleID of liveConfig.restricRoles)
      await newChannel.updateOverwrite(roleID, { 'SEND_MESSAGES': false });

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

  /**
   * Remove live channel.
   * @param {number} number - The index of live channel.
   */
  async removeChannel(number = this.channels.length - 1) {
    const liveChannel = this.liveChannels[number];

    if (liveChannel.living) return;

    this.channels = this.channels.filter((_, n) => n !== number);
    this.liveChannels = this.liveChannels.filter((_, n) => n !== number);

    await liveChannel.channel.delete();
  }
}
