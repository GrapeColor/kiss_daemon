import Discord from 'discord.js';

import LiveAccept from './live_accept.js';

export default class LiveChannel {
  /**
   * Events to enter the client.
   * @param {Discord.Client} bot Discord.js Client.
   */
  static events(bot) {
    bot.on('messageReactionAdd', (reaction, user) => {

    });
  }

  static LIVE_REGEX = /^<LIVE_(CLOSED|OPENED:(\d+):(\d+))>$/;

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
      this.replica = await this.channel.send(message);

      await this.webhook.edit({
        name: `<LIVE_OPENED:${this.trigger.id}:${this.replica.id}>`
      });

      if (liveConfig.pinLink) await this.replica.pin();

      for (const roleID of liveConfig.restricRoles)
        await this.channel.updateOverwrite(roleID, { 'SEND_MESSAGES': true });
    } catch (error) {
      this.close()
        .catch(console.error);

      throw error;
    }

    this.response = await message.channel.send('', {
      embed: {
        color: 0xed3544,
        title: '🔴 実況を開始しました',
        description: `実況はこちら➡️ ${stillChannel}`,
        footer: {
          text: `実況が終わったら${liveConfig.onlySelf ? ` ${member.displayName} さんが` : ''}`
            + '下のリアクションをクリック'
        }
      }
    });

    await this.response.react(liveConfig.closeEmoji);
  }

  async close() {
    const liveConfig = this.config.liveChannel;

    await this.response.edit('', {
      embed: {
        color: 0x30373d,
        title: '⚫実況が終了しました',
        description: `実況時間: ${this.calcLiveTime()}`
      }
    })

    await this.response.reactions.removeAll();
    this.response = undefined;

    if (liveConfig.autoDelete) await this.trigger.delete();
    this.trigger = undefined;

    await this.replica.unpin();
    this.replica = undefined;

    await this.webhook.edit({ name: '<LIVE_CLOSED>' });

    this.living = false;
  }

  calcLiveTime() {
    const time = Date.now() - this.response.createdTimestamp;
    const day  = Math.floor(time / 1000 / 60 / 60 / 24 + 1);
    const hour = Math.floor(time / 1000 / 60 / 60 % 24);
    const min  = Math.floor(time / 1000 / 60 % 60);

    return `${day ? `${day}日` : ''}${hour ? `${hour}時間` : ''}${min ? `${min}分`: ''}`;
  }

  /**
   * Convert channel mention.
   */
  toString() { return this.channel.toString(); }
}
