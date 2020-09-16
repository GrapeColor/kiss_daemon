import Discord from 'discord.js';

import LiveAccept from './live_accept.js';

export default class LiveChannel {
  /**
   * Events to enter the client.
   * @param {Discord.Client} bot Discord.js Client.
   */
  static events(bot) {
    bot.on('messageReactionAdd', (reaction, user) => {
      if (user.bot) return;

      this.liveResponses[reaction.message.id]?.reactionBranching(reaction, user)
        .catch(console.error);
    });

    bot.on('messageDelete', message => {
      this.liveTriggers[message.id]?.cancel()
        .catch(console.error);
    });

    bot.on('messageUpdate', (_, message) => {
      this.liveTriggers[message.id]?.edit(message)
        .catch(console.error);
    });

    bot.setInterval(() => this.checkTimeout(), 60000);
  }

  static LIVE_REGEX = /^<LIVE_(CLOSED|OPENED:(\d+):(\d+):(\d+))>$/;

  static COLOR_LIVE_OPENED   = 0xed3544;
  static COLOR_LIVE_CLOSED   = 0xe6e7e8;
  static COLOR_LIVE_CANCELED = 0xffcd60;
  static COLOR_LIVE_ABORTED  = 0xffcd60;
  static COLOR_LIVE_ALERT    = 0x9867c6;

  /**
   * Triggers of open live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveTriggers = {};

  /**
   * Responses of open live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveResponses = {};

  /**
   * Check timeout lives.
   */
  static checkTimeout() {
    for (const live of Object.values(this.liveTriggers)) {
      live.autoClose()
        .catch(console.log);
    }
  }

  /**
   * Initialize live channel.
   * @param {LiveAccept} accept - Live accept.
   * @param {Discord.TextChannel} channel - Live channel.
   * @param {number} number - Index of live channel.
   */
  constructor(accept, channel, number) {
    this.accept = accept;
    this.config = accept.config;
    this.channel = channel;
    this.guild = channel.guild;
    this.number = number;

    this.bot = channel.client;

    this.webhook = undefined;

    this.living = false;

    this.trigger  = undefined;
    this.replica  = undefined;
    this.response = undefined;

    this.checkLiving()
      .catch(console.error);
  }

  /**
   * Whether this live channel is living.
   */
  async checkLiving() {
    const webhooks = await this.channel.fetchWebhooks();
    let webhook = webhooks.find(webhook =>
      webhook.owner.id === this.bot.user.id
        && LiveChannel.LIVE_REGEX.test(webhook.name)
    );

    if (!webhook) webhook = await this.channel.createWebhook('<LIVE_CLOSED>');
    
    this.webhook = webhook;

    const match = webhook.name.match(LiveChannel.LIVE_REGEX);

    this.living = !!match[2];

    if (!this.living) return;

    const trigger  = await this.accept.channel.messages.fetch(match[2]);
    const replica  = await this.channel.messages.fetch(match[3]);
    const response = await this.accept.channel.messages.fetch(match[4]);

    if (!trigger || !replica || !response) return;

    this.entryLiving(trigger, replica, response);
  }

  /**
   * Entry the channel to living.
   * @param {Discord.Message} trigger 
   * @param {Discord.Message} replica 
   * @param {Discord.Message} response 
   */
  entryLiving(trigger, replica, response) {
    this.living = true;

    this.trigger  = trigger;
    this.replica  = replica;
    this.response = response;

    LiveChannel.liveTriggers[trigger.id]   = this;
    LiveChannel.liveResponses[response.id] = this;
  }

  /**
   * Exit the channel from living.
   */
  exitLiving() {
    delete LiveChannel.liveTriggers[this.trigger.id];
    delete LiveChannel.liveResponses[this.response.id];

    this.trigger  = undefined;
    this.replica  = undefined;
    this.response = undefined;

    this.living = false;
  }

  /**
   * Branch processing of reaction event.
   * @param {Discord.MessageReaction} reaction 
   * @param {Discord.User} user 
   */
  async reactionBranching(reaction, user) {
    const emoji = reaction.emoji;

    const liveConfig = this.config.liveChannel;
    const closeEmoji = liveConfig.closeEmoji;

    if ((emoji.id ?? emoji.name) === closeEmoji) {
      if ((liveConfig.onlySelf && user.id !== this.trigger.author.id)
        && !this.isAllowUser(user)) return;

      await this.close();
    }
  }

  /**
   * Is the user allowed to operate?
   * @param {Discord.User} user 
   */
  isAllowUser(user) {
    const member = this.guild.member(user);
    const permissions = this.accept.channel.permissionsFor(member);

    if (permissions.has('MANAGE_CHANNELS')) return true;

    const roles = member.roles.cache;
    let hasAdminRole = false;

    for (const roleID of this.config.adminRoles) {
      hasAdminRole =  roles.has(roleID) ? true : false;

      if (hasAdminRole) break;
    }

    return hasAdminRole;
  }

  /**
   * Open the live channel.
   * @param {Discord.Message} trigger 
   */
  async open(trigger) {
    const liveConfig = this.config.liveChannel;
    const member = this.guild.member(trigger.author);

    let replica, response;

    this.living = true;

    try {
      for (const roleID of liveConfig.restricRoles)
        await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': true });

      const embed = new Discord.MessageEmbed({ color: LiveChannel.COLOR_LIVE_OPENED });

      embed.title = '🔴 実況を開始しました';

      await this.channel.send(embed);

      replica = await this.channel.send(trigger);

      if (liveConfig.pinLink) await replica.pin();

      response = await trigger.channel.send(
        embed.setDescription(`実況はこちら ➡️ ${this.channel}`)
          .setFooter(
            `実況が終わったら${liveConfig.onlySelf ? ` ${member.displayName} さんが` : ''}`
              + '下のリアクションをクリック'
          )
      );

      await this.webhook.edit({
        name: `<LIVE_OPENED:${trigger.id}:${replica.id}:${response.id}>`
      });
  
      await response.react(liveConfig.closeEmoji);
    } catch (error) {
      this.abort(trigger);

      throw error;
    }

    this.entryLiving(trigger, replica, response);
  }

  /**
   * Abort the opening of the live channel.
   * @param {Discord.Message} message - Event trigger message.
   */
  abort(message) {
    this.webhook.edit({ name: '<LIVE_CLOSED>' })
      .catch(console.error);

    try {
      for (const roleID of this.config.liveChannel.restricRoles)
        this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': false });
    } catch (error) {
      console.error(error);
    }

    const embed = new Discord.MessageEmbed({ color: LiveChannel.COLOR_LIVE_ABORTED });

    embed.title = '⚠️ 実況の開始に失敗しました';

    message.channel.send(embed)
      .catch(console.error);

    this.exitLiving();
  }

  /**
   * When the trigger is edited.
   */
  async edit(message) { await this.replica.edit(message); }

  /**
   * Cancel the live channel.
   */
  async cancel() {
    await this.response.reactions.removeAll();

    await this.webhook.edit({ name: '<LIVE_CLOSED>' });

    for (const roleID of this.config.liveChannel.restricRoles)
      await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': false });

    await this.replica.unpin();

    const embed = new Discord.MessageEmbed({ color: LiveChannel.COLOR_LIVE_CANCELED });

    embed.title = '🚫 実況がキャンセルされました';

    await this.channel.send(embed);
    await this.response.edit(embed);

    this.exitLiving();
  }

  /**
   * Close the live channel.
   * @param {number} autoClose - Is auto..
   */
  async close(autoClose = 0) {
    await this.response.reactions.removeAll();

    await this.webhook.edit({ name: '<LIVE_CLOSED>' });

    for (const roleID of this.config.liveChannel.restricRoles)
      await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': false });

    await this.replica.unpin();

    const liveTerm = this.calcLiveTime();

    const embed = new Discord.MessageEmbed({ color: LiveChannel.COLOR_LIVE_CLOSED });

    embed.title = '⚪ 実況が終了しました';
    embed.description = '';

    if (autoClose)
      embed.description += `実況チャンネルで ${autoClose} 分以上メッセージ送信がないため、`
        + '自動で実況が終了しました。\n';

    embed.description += `実況時間: ${liveTerm}`;

    await this.channel.send(embed);
    await this.response.edit(embed);

    this.exitLiving();

    await this.accept.endLive(this.number);
  }

  calcLiveTime() {
    const time = Date.now() - this.response.createdTimestamp;
    const day  = Math.floor(time / 1000 / 60 / 60 / 24);
    const hour = Math.floor(time / 1000 / 60 / 60 % 24);
    const min  = Math.floor(time / 1000 / 60 % 60);
    const sec  = Math.floor(time / 1000);

    if (time < 60000) return `${sec}秒`;

    return `${day ? `${day}日` : ''}${hour ? `${hour}時間` : ''}${min ? `${min}分`: ''}`;
  }

  async autoClose() {
    const autoClose = this.config.liveChannel.autoClose;

    if (!autoClose) return;

    const lastSendTime = this.channel.lastMessage.createdTimestamp;
    const time = (Date.now() - lastSendTime) / 1000 / 60;

    if (time > autoClose){
      this.close(autoClose);
      return;
    }

    if (Math.floor(time) === 5) {
      const embed = new Discord.MessageEmbed({ color: LiveChannel.COLOR_LIVE_ALERT });

      embed.title = '⏲️ あと5分で自動で実況が終了します';
      embed.description = '5分以内にメッセージの送信がない場合は、自動で実況が終了します。';

      await this.channel.send(embed);
    }
  }

  /**
   * Convert channel mention.
   */
  toString() { return this.channel.toString(); }
}
