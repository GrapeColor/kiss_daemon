import Discord from 'discord.js';

import LiveAccept from './live_accept.js';

export default class LiveChannel {
  static LIVE_REGEX = /^<LIVE_(CLOSED|OPENED:(\d+):(\d+):(\d+))>$/;

  /**
   * Entried live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveChannels = {};

  /**
   * Initialize live channel.
   * @param {LiveAccept} accept - Live accept.
   * @param {Discord.TextChannel} channel - Live channel.
   */
  constructor(accept, channel) {
    this.accept = accept;
    this.config = accept.config;
    this.channel = channel;
    this.guild = channel.guild;

    this.bot = channel.client;

    this.living = false;
    this.webhook = undefined;

    this.trigger = undefined;
    this.response = undefined;
    this.replica = undefined;

    this.checkLiving()
      .catch(console.error);

    LiveChannel.liveChannels[channel.id] = this;
  }

  /**
   * Whether this live channel is living.
   */
  async checkLiving() {
    const webhooks = await this.channel.fetchWebhooks();
    let webhook = webhooks.find(webhook => {
      return webhook.owner.id === this.bot.user.id
        && LiveChannel.LIVE_REGEX.test(webhook.name);
    });

    if (!webhook) webhook = await this.channel.createWebhook('<LIVE_CLOSED>');
    
    this.webhook = webhook;

    const match = webhook.name.match(LiveChannel.LIVE_REGEX);

    this.living = !!match[2];

    if (!this.living) return;

    this.trigger = await this.accept.channel.messages.fetch(match[2]);
    this.replica = await this.channel.messages.fetch(match[3]);
    this.response = await this.accept.channel.messages.fetch(match[4]);
  }

  /**
   * Open the live channel.
   * @param {Discord.Message} message 
   */
  async open(message) {
    const liveConfig = this.config.liveChannel;
    const member = this.guild.member(message.author);

    this.living = true;
    this.trigger = message;

    try {
      for (const roleID of liveConfig.restricRoles)
        await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': true });

      await this.channel.send('', {
        embed: {
          color: LiveAccept.COLOR_LIVE_OPENED,
          title: '🔴 実況を開始しました'
        }
      });

      this.replica = await this.channel.send(message);
      if (liveConfig.pinLink) await this.replica.pin();

      this.response = await message.channel.send('', {
        embed: {
          color: LiveAccept.COLOR_LIVE_OPENED,
          title: '🔴 実況を開始しました',
          description: `実況はこちら ➡️ ${this.channel}`,
          footer: {
            text: `実況が終わったら${liveConfig.onlySelf ? ` ${member.displayName} さんが` : ''}`
              + '下のリアクションをクリック'
          }
        }
      });

      await this.webhook.edit({
        name: `<LIVE_OPENED:${this.trigger.id}:${this.replica.id}:${this.response.id}>`
      });
  
      await this.response.react(liveConfig.closeEmoji);
    } catch (error) {
      this.close()
        .catch(console.error);

      throw error;
    }
  }

  /**
   * Close the live channel.
   */
  async close() {
    const liveConfig = this.config.liveChannel;

    await this.response.reactions.removeAll();

    for (const roleID of liveConfig.restricRoles)
      await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': false });

    if (liveConfig.autoDelete) await this.trigger.delete();

    await this.replica.unpin();

    const liveTerm = this.calcLiveTerm();

    await this.channel.send('', {
      embed: {
        color: LiveAccept.COLOR_LIVE_CLOSED,
        title: '⚪ 実況が終了しました',
        description: `実況時間: ${liveTerm}`
      }
    });

    await this.response.edit('', {
      embed: {
        color: LiveAccept.COLOR_LIVE_CLOSED,
        title: '⚪ 実況が終了しました',
        description: `実況時間: ${liveTerm}`
      }
    })

    this.trigger = undefined;
    this.replica = undefined;
    this.response = undefined;

    await this.webhook.edit({ name: '<LIVE_CLOSED>' });

    this.living = false;
  }

  /**
   * Cancel the live channel.
   */
  async cancel() {
    await this.response.reactions.removeAll();

    for (const roleID of liveConfig.restricRoles)
      await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': false });

    await this.replica.unpin();

    await this.channel.send('', {
      embed: {
        color: LiveAccept.COLOR_LIVE_CANCEL,
        title: '🗑️ 実況がキャンセルされました'
      }
    });

    await this.response.edit('', {
      embed: {
        color: LiveAccept.COLOR_LIVE_CANCEL,
        title: '🗑️ 実況がキャンセルされました'
      }
    })

    this.trigger = undefined;
    this.replica = undefined;
    this.response = undefined;

    await this.webhook.edit({ name: '<LIVE_CLOSED>' });

    this.living = false;
  }

  calcLiveTerm() {
    const time = Date.now() - this.response.createdTimestamp;
    const day  = Math.floor(time / 1000 / 60 / 60 / 24);
    const hour = Math.floor(time / 1000 / 60 / 60 % 24);
    const min  = Math.floor(time / 1000 / 60 % 60);
    const sec  = Math.floor(time / 1000);

    if (!(day + hour + min)) return `${sec}秒`;

    return `${day ? `${day}日` : ''}${hour ? `${hour}時間` : ''}${min ? `${min}分`: ''}`;
  }

  /**
   * Convert channel mention.
   */
  toString() { return this.channel.toString(); }
}
