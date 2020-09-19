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

      this.liveResponses[reaction.message.id]?.reactionClose(reaction);
    });

    bot.on('messageReactionRemove', (reaction, user) => {
      if (user.bot) return;

      this.liveResumables[reaction.message.id]?.reactionResume(reaction);
    });

    bot.on('messageDelete', message => {
      this.liveResponses[message.id]?.close(true);

      this.liveTriggers[message.id]?.cancel();
    });

    bot.on('messageUpdate', (_, message) => {
      this.liveTriggers[message.id]?.edit(message);
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

    Promise.all([
      this.accept.channel.messages.fetch(match.groups.triggerID),
      this.channel.messages.fetch(match.groups.replicaID),
      this.accept.channel.messages.fetch(match.groups.responseID)
    ])
      .then(([trigger, replica, response]) => {
        this.entryLiving(trigger, replica, response);
      })
      .catch(() => {
        this.living = false;
        this.webhook.edit({ name: '<LIVE_CLOSED>' })
          .catch(console.log);
      });
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
  reactionClose(reaction) {
    const emoji = reaction.emoji;
    const closeEmoji = this.config.closeEmoji;

    if ((emoji.id ?? emoji.name) === closeEmoji) this.close()
  }

  /**
   * Verify if it resume.
   * @param {Discord.MessageReaction} reaction 
   */
  reactionResume(reaction) {
    if (reaction.count > 0) return;

    const emoji = reaction.emoji;
    const closeEmoji = this.config.closeEmoji;

    if ((emoji.id ?? emoji.name) === closeEmoji) this.resume();
  }

  /**
   * Open the live channel.
   * @param {Discord.Message} trigger 
   */
  open(trigger) {
    this.living = true;

    const embed = new Discord.MessageEmbed({
      color: LiveChannel.COLOR_LIVE_OPENED,
      title: '🔴 実況を開始しました'
    });

    Promise.all([
      this.channel.send(embed),
      this.channel.send(trigger.content),
      trigger.channel.send(`🔴 **実況を開始しました** ${this.channel}`)
    ])
      .then(([_, replica, response]) => {
        Promise.all([
          replica.pin(),
          this.webhook.edit({
            name: `<LIVE_OPENED:${trigger.id}:${replica.id}:${response.id}>`
          })
        ])
          .then(() => this.entryLiving(trigger, replica, response))
          .catch(() => this.abort());
      })
      .catch(() => this.abort());
  }

  /**
   * Resume the live channel.
   */
  resume() {
    const trigger  = this.lastTrigger;
    const replica  = this.lastReplica;
    const response = this.lastResponse;

    if (!trigger?.deletable || !replica?.deletable || !response?.deletable) return;

    this.living = true;

    const embed = new Discord.MessageEmbed({
      color: LiveChannel.COLOR_LIVE_OPENED,
      title: '🔴 実況を再開しました'
    });

    Promise.all([
      this.channel.send(embed),
      replica.pin(),
      response.edit(`🔴 **実況を再開しました** ${this.channel}`),
      this.webhook.edit({
        name: `<LIVE_OPENED:${trigger.id}:${replica.id}:${response.id}>`
      })
    ])
      .then(() => this.entryLiving(trigger, replica, response))
      .catch(() => this.abort());
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
  edit(message) {
    this.replica?.edit(message.content)
      .catch(console.error);
  }

  /**
   * Cancel the live channel.
   */
  cancel() {
    const embed = new Discord.MessageEmbed({
      color: LiveChannel.COLOR_LIVE_CANCELED,
      title: '↩️ 実況がキャンセルされました'
    });

    this.living = false;
    delete LiveChannel.liveResponses[this.response.id];

    Promise.all([
      this.webhook.edit({ name: '<LIVE_CLOSED>' }),
      this.response.delete(),
      this.replica?.delete(),
      this.channel.send(embed)
    ])
      .catch(console.error)
      .finally(() => this.exitLiving());
  }

  /**
   * Close the live channel.
   * @param {boolean} force - Forced closure.
   */
  close(force = false) {
    this.living = false;

    const embed = new Discord.MessageEmbed({
      color: LiveChannel.COLOR_LIVE_CLOSED,
      title: '⚪ 実況が終了しました'
    });

    Promise.all([
      this.webhook.edit({ name: '<LIVE_CLOSED>' }),
      this.replica?.unpin(),
      this.channel.send(embed)
    ])
      .catch(console.error)
      .finally(() => {
        if (!force) {
          this.response.edit('⚪ **実況が終了しました**')
            .catch(console.error);

          this.entryResumable();
        }

        this.exitLiving();
      });
  }
}
