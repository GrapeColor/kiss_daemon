import Discord from 'discord.js';

import LiveAccept from './live_accept.js';

export default class LiveChannel {
  /**
   * Events to enter the client.
   * @param {Discord.Client} bot - Discord.js Client.
   */
  static events(bot) {
    bot.on('messageReactionAdd', (reaction, user) => {
      if (user.bot) return;

      this.liveResponses[reaction.message.id]?.reactionClose(reaction)
        .catch(console.error);
    });

    bot.on('messageReactionRemove', (reaction, user) => {
      if (user.bot) return;

      this.liveResumables[reaction.message.id]?.reactionResume(reaction)
        .catch(console.error);
    });

    bot.on('messageDelete', message => {
      this.liveResponses[message.id]?.close()
        .catch(console.error);

      this.liveTriggers[message.id]?.cancel()
        .catch(console.error);
    });

    bot.on('messageUpdate', (_, message) => {
      this.liveTriggers[message.id]?.edit(message)
        .catch(console.error);
    });
  }

  static LIVE_REGEX
    = /^<LIVE_(CLOSED|OPENED:(?<triggerID>\d+):(?<replicaID>\d+):(?<responseID>\d+))>$/;

  static COLOR_LIVE_OPENED   = 0xed3544;
  static COLOR_LIVE_CLOSED   = 0xe6e7e8;
  static COLOR_LIVE_CANCELED = 0x1587bf;

  /**
   * Triggers of opened live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveTriggers = {};

  /**
   * Responses of opened live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveResponses = {};

  /**
   * Resumable of live channels.
   * @type {Object.<string, LiveChannel>}
   */
  static liveResumables = {};

  /**
   * Initialize live channel.
   * @param {LiveAccept} accept - Live accept.
   * @param {Discord.TextChannel} channel - Live channel.
   */
  constructor(accept, channel) {
    this.accept = accept;
    this.config = accept.config;
    this.channel = channel;

    this.bot = channel.client;

    this.webhook = undefined;

    this.living = false;

    this.trigger  = undefined;
    this.replica  = undefined;
    this.response = undefined;

    this.lastTrigger  = undefined;
    this.lastReplica  = undefined;
    this.lastResponse = undefined;
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

    this.living = !!match.groups.triggerID;

    if (!this.living) return;

    const trigger  = await this.accept.channel.messages.fetch(match.groups.triggerID);
    const replica  = await this.channel.messages.fetch(match.groups.replicaID);
    const response = await this.accept.channel.messages.fetch(match.groups.responseID);

    if (trigger && replica && response)
      this.entryLiving(trigger, replica, response);
    else
      await this.webhook.edit('<LIVE_CLOSED>');
  }

  /**
   * Entry the channel to living.
   * @param {Discord.Message} trigger 
   * @param {Discord.Message} replica 
   * @param {Discord.Message} response 
   */
  entryLiving(trigger, replica, response) {
    delete LiveChannel.liveResumables[this.lastResponse?.id];

    this.trigger  = trigger;
    this.replica  = replica;
    this.response = response;

    LiveChannel.liveTriggers[trigger.id]   = this;
    LiveChannel.liveResponses[response.id] = this;
  }

  /**
   * Entry the channel to resumable.
   */
  entryResumable() {
    this.lastTrigger  = this.trigger;
    this.lastReplica  = this.replica;
    this.lastResponse = this.response;

    LiveChannel.liveResumables[this.lastResponse.id] = this;
  }

  /**
   * Exit the channel from living.
   */
  exitLiving() {
    delete LiveChannel.liveTriggers[this.trigger?.id];
    delete LiveChannel.liveResponses[this.response?.id];

    this.trigger  = undefined;
    this.replica  = undefined;
    this.response = undefined;
  }

  /**
   * Verify if it end.
   * @param {Discord.MessageReaction} reaction 
   */
  async reactionClose(reaction) {
    const emoji = reaction.emoji;
    const closeEmoji = this.config.closeEmoji;

    if ((emoji.id ?? emoji.name) === closeEmoji) await this.close();
  }

  /**
   * Verify if it resume.
   * @param {Discord.MessageReaction} reaction 
   */
  async reactionResume(reaction) {
    if (reaction.count > 0) return;

    const emoji = reaction.emoji;
    const closeEmoji = this.config.closeEmoji;

    if ((emoji.id ?? emoji.name) === closeEmoji) await this.resume();
  }

  /**
   * Open the live channel.
   * @param {Discord.Message} trigger 
   */
  async open(trigger) {
    let replica, response;

    this.living = true;

    try {
      const embed = new Discord.MessageEmbed({
        color: LiveChannel.COLOR_LIVE_OPENED,
        title: '🔴 実況を開始しました'
      });

      await this.channel.send(embed);

      replica = await this.channel.send(trigger.content);

      if (this.config.pinMessage) await replica.pin();

      response = await trigger.channel.send(`🔴 **実況を開始しました** ${this.channel}`);

      await this.webhook.edit({
        name: `<LIVE_OPENED:${trigger.id}:${replica.id}:${response.id}>`
      });
    } catch (error) {
      this.abort();

      throw error;
    }

    this.entryLiving(trigger, replica, response);
  }

  /**
   * Resume the live channel.
   */
  async resume() {
    this.living = true;

    const trigger  = this.lastTrigger;
    const replica  = this.lastReplica;
    const response = this.lastResponse;

    try {
      const embed = new Discord.MessageEmbed({
        color: LiveChannel.COLOR_LIVE_OPENED,
        title: '🔴 実況を再開しました'
      });

      await this.channel.send(embed);

      if (this.config.pinMessage) await replica.pin();

      await response.edit(`🔴 **実況を再開しました** ${this.channel}`);

      await this.webhook.edit({
        name: `<LIVE_OPENED:${trigger.id}:${replica.id}:${response.id}>`
      });
    } catch (error) {
      this.abort();

      throw error;
    }

    this.entryLiving(trigger, replica, response);
  }

  /**
   * Abort the opening of the live channel.
   */
  abort() {
    this.living = false;

    this.webhook?.edit({ name: '<LIVE_CLOSED>' })
      .catch(console.error);

    this.exitLiving();
  }

  /**
   * When the trigger is edited.
   * @param {Discord.Message} message - Edited message.
   */
  edit(message) { return this.replica?.edit(message.content); }

  /**
   * Cancel the live channel.
   */
  async cancel() {
    const embed = new Discord.MessageEmbed({
      color: LiveChannel.COLOR_LIVE_CANCELED,
      title: '↩️ 実況がキャンセルされました'
    });

    this.living = false;

    await Promise.all([
      this.webhook.edit({ name: '<LIVE_CLOSED>' }),
      this.response.delete(),
      this.replica.delete(),
      this.channel.send(embed)
    ]);

    this.exitLiving();
  }

  /**
   * Close the live channel.
   */
  async close() {
    const embed = new Discord.MessageEmbed({
      color: LiveChannel.COLOR_LIVE_CLOSED,
      title: '⚪ 実況が終了しました'
    });

    this.living = false;

    await Promise.all([
      this.webhook.edit({ name: '<LIVE_CLOSED>' }),
      this.replica.unpin(),
      this.channel.send(embed)
    ]);

    if (!this.response.deleted)
      await this.response.edit('⚪ **実況が終了しました**');

    this.exitLiving();

    this.entryResumable();
  }
}
