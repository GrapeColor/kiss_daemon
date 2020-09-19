import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

const defaultFile
  = fs.readFileSync(
    path.resolve('src/live_duty/assets/default_config.json'), 'utf-8'
  );

import fetch from 'isomorphic-fetch';
import pkgDropbox from 'dropbox';
const { Dropbox } = pkgDropbox;

const dropbox
  = new Dropbox({ accessToken: process.env['DROPBOX_TOKEN'], fetch: fetch });

import Discord from 'discord.js';

import twemojiRegex from 'twemoji-parser/dist/lib/regex.js';
const emojiRegex
  = new RegExp(
    `^${twemojiRegex.default.toString().slice(1, -9)}$|^<a?:\\w+:(\\d+)>$`
  );

/**
 * @typedef {Object} ConfigStruct
 * @property {string} acceptChannel
 * @property {string} liveName
 * @property {string} closeEmoji
 * @property {boolean} pinMessage
 */

export default class Config extends EventEmitter {
  static COLOR_HELP    = 0x1587bf;
  static COLOR_SUCCESS = 0x67b160;
  static COLOR_FAILD   = 0xffcd60;

  /**
   * Configs for all guilds.
   * @type {Object.<string, Config>}
   */
  static configs = {};

  /**
   * Default config.
   */
  static defaultJSON = defaultFile;

  /**
   * Load configs for all guilds.
   */
  static async load() {
    const fileList = await dropbox.filesListFolder({ path: '' });

    for (const metadata of fileList.entries) {
      if (metadata[".tag"] !== 'file') continue;

      const fileMetadata = await dropbox.filesDownload({ path: metadata.path_lower });
      const file = fileMetadata.fileBinary?.toString('utf-8');
      const matchID = fileMetadata.path_lower.match(/\/(\d+)\.json/);

      if (!file || !matchID) continue;

      const guildID = matchID[1];
      this.configs[guildID] = new Config(guildID, JSON.parse(file));
    }
  }

  /**
   * Read guild config.
   * @param {string} guildID - Guild ID.
   */
  static read(guildID) {
    if (!this.configs[guildID])
      this.configs[guildID] = new Config(guildID, JSON.parse(this.defaultJSON));

    return this.configs[guildID].config;
  }

  /**
   * Take guild config.
   * @param {string} guildID - Guild ID.
   */
  static take(guildID) {
    if (!this.configs[guildID])
      this.configs[guildID] = new Config(guildID, JSON.parse(this.defaultJSON));

    return this.configs[guildID];
  }

  /**
   * Events to enter the client.
   * @param {Discord.Client} bot Discord.js Client.
   */
  static events(bot) {
    bot.on('ready', () => {
      this.botMention = bot.user.toString();
      this.botMentionRegex = new RegExp(`^<@!?${bot.user.id}>`);
    });

    bot.on('message', message => {
      const channel = message.channel;

      if (channel.type !== 'text' || message.author.bot || message.author.system)
        return;

      if (this.botMentionRegex.test(message.content))
        this.parseCommand(channel, message);
    });
  }

  /**
   * Parse commands.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   * @param {Discord.Message} message - Event trigger message.
   */
  static parseCommand(channel, message) {
    const guild = channel.guild;

    guild.members.fetch(message.author)
      .then(member => {
        if (member.hasPermission('ADMINISTRATOR'))
          this.configs[guild.id].command(channel, message);
      })
      .catch(console.error);
  }

  /**
   * Initialize the guild config.
   * @param {string} guildID - Guild ID.
   * @param {ConfigStruct} json - The config json data.
   */
  constructor(guildID, json) {
    super();

    this.guildID = guildID;
    this.config = json;
  }

  /**
   * Execute command.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   * @param {Discord.Message} message - Event trigger message.
   */
  command(channel, message) {
    const args = message.content.split(' ').slice(1);

    if (!args[0]) this.sendValues(channel);

    switch (args[0]) {
      case 'set':
        this.setAccept(channel, channel.guild, args.slice(1), true);
        break;
      case 'reset':
        this.setAccept(channel, channel.guild, args.slice(1), false);
        break;
      case 'live-name':
        this.setLiveName(channel, args.slice(1));
        break;
      case 'close-emoji':
        this.setCloseEmoji(channel, channel.guild, args.slice(1));
        break;
      case 'pin-message':
        if (args[1] === 'enable')  this.setPinLink(channel, true);
        if (args[1] === 'disable') this.setPinLink(channel, false);
        break;
    }
  }

  /**
   * Send command help.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   */
  sendValues(channel) {
    const embed = new Discord.MessageEmbed({ color: Config.COLOR_HELP });
    const document
      = 'https://github.com/GrapeColor/live_duty/blob/master/docs/config.md';

    embed.title = '🇶 設定値一覧';
    embed.description = `各設定の変更方法は[ドキュメント](${document})をご覧ください。`;

    embed.addFields([
      {
        name: '実況受付チャンネル',
        value: this.config.acceptChannel
          ? `<#${this.config.acceptChannel}>` : 'なし(機能無効)'
      },
      {
        name: '実況チャンネル名',
        value: `\`\`\`${this.config.liveName}\`\`\``,
      },
      {
        name: '実況終了リアクション絵文字',
        value: channel.guild.emojis.cache.get(this.config.closeEmoji)?.toString()
          || this.config.closeEmoji
      },
      {
        name: '実況リンクピン止め',
        value: this.config.pinMessage ? '```する```' : '```しない```',
        inline: true
      }
    ])

    channel.send(embed)
      .catch(console.error);
  }

  /**
   * Set the channel that accepts live.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   * @param {boolean} set - Enable or Disable.
   */
  setAccept(channel, guild, args, set) {
    let acceptID = '';

    if (set) {
      const matchAccept = args[0]?.match(/^((\d+)|<#(\d+)>)$/);
      acceptID = matchAccept && (matchAccept[2] || matchAccept[3]);
      const accept = guild.channels.cache.get(acceptID);

      if (!accept || accept.type !== 'text') {
        channel?.send('', {
          embed: {
            color: Config.COLOR_FAILD,
            title: '⚠️ 指定したチャンネルが有効な値ではありません',
            description: 'サーバー内のテキストチャンネルを、メンション形式かIDで指定する必要があります。'
          }
        })
          .catch(console.error);

        return;
      }
    }

    this.updateConfig(channel, 'acceptChannel', acceptID)
      .then(success => {
        if (!success) return;

        this.emit('liveAcceptUpdate');

        channel?.send('', {
          embed: {
            color: Config.COLOR_SUCCESS,
            title: `✅ 実況受付チャンネルを${acceptID ? `変更` : '無効に'}しました`,
            description: acceptID ? `<#${acceptID}> で実況チャンネルを開始できます。` : ''
          }
        })
          .catch(console.error);
      })
      .catch(console.error);
  }

  /**
   * Set live channel base name.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  setLiveName(channel, args) {
    if (!args[0]) {
      channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 実況チャンネル名を入力してください'
        }
      })
        .catch(console.error);

      return;
    }

    if (args[0].length > 90) {
      channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 実況チャンネル名は90文字以下で指定してください'
        }
      })
        .catch(console.error);

      return;
    }

    this.updateConfig(channel, 'liveName', args[0])
      .then(success => {
        if (!success) return;

        this.emit('liveNameUpdate');

        channel?.send('', {
          embed: {
            color: Config.COLOR_SUCCESS,
            title: '✅ 実況チャンネル名を設定しました',
            description: `以降 \`${args[0]}～\` が実況チャンネルとして認識されます。`
          }
        })
          .catch(console.error);
      })
      .catch(console.error);
  }

  /**
   * Set emoji for close live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   */
  setCloseEmoji(channel, guild, args) {
    const matchEmoji = args[0]?.match(emojiRegex);

    if (!matchEmoji) {
      channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 絵文字を1文字だけ指定してください'
        }
      })
        .catch(console.error);

      return;
    }

    const emoji = matchEmoji[2] || matchEmoji[0];
    const isGuildEmoji = !!matchEmoji[2];

    if (isGuildEmoji && !guild.emojis.cache.has(emoji)) {
      channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ サーバー内に存在しない絵文字です'
        }
      })
        .catch(console.error);

      return;
    }

    this.updateConfig(channel, 'closeEmoji', emoji)
      .then(success => {
        if (!success) return;

        channel?.send('', {
          embed: {
            color: Config.COLOR_SUCCESS,
            title: '✅ 実況チャンネルを終了させる絵文字を変更しました',
            description: `${matchEmoji[0]} で実況チャンネルを終了できます`
          }
        })
          .catch(console.error);
      })
      .catch(console.error);
  }

  /**
   * Set enable pin link in live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {boolean} enable - enable or disable.
   */
  setPinLink(channel, enable) {
    this.updateConfig(channel, 'pinMessage', enable)
      .then(success => {
        if (!success) return;

        channel?.send('', {
          embed: {
            color: Config.COLOR_SUCCESS,
            title: `✅ 実況チャンネルへの実況リンクピン止めを${enable ? '有効' : '無効'}にしました`
          }
        })
          .catch(console.error);
      })
      .catch(console.error);
  }

  /**
   * Upload config to Dropbox.
   * @param {Discord.TextChannel|null} channel Guils's text channel.
   * @param {string} key1 - Overrite config property.
   * @param {any} value - Overriting value.
   */
  async updateConfig(channel, key1, value) {
    const oldValue = this.config[key1];
    this.config[key1] = value;

    try {
      await dropbox.filesUpload({
        contents: JSON.stringify(this.config),
        path: `/${this.guildID}.json`,
        mode: { '.tag': 'overwrite' },
        autorename: false,
        mute: true,
        strict_conflict: false
      });
    } catch {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 設定値の変更に失敗しました',
          description: '設定データのアップロードに失敗しました。しばらく経ってから、再度お試しください。'
        }
      });

      this.config[key1] = oldValue;

      return false;
    }

    return true;
  }
}
