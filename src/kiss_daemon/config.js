import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

const defaultFile
  = fs.readFileSync(
    path.resolve('src/kiss_daemon/assets/default_config.json'), 'utf-8'
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
 * @typedef {Object} ConfigProperty
 * @property {string[]} adminRoles
 * @property {LiveChannelProperty} liveChannel
 */

/**
 * @typedef {Object} LiveChannelProperty
 * @property {string} acceptChannel
 * @property {string[]} allowRoles
 * @property {string[]} restricRoles
 * @property {string} liveName
 * @property {string} closeEmoji
 * @property {string} topic
 * @property {number} minLive
 * @property {number} maxLive
 * @property {number} autoClose
 * @property {number} rateLimit
 * @property {boolean} onlySelf
 * @property {boolean} pinLink
 * @property {boolean} nfsw
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
   * @type {ConfigProperty}
   */
  static defaultConfigJSON = Object.freeze(JSON.parse(defaultFile));

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
      this.configs[guildID] = new Config(guildID, this.defaultConfigJSON);

    return this.configs[guildID].config;
  }

  /**
   * Take guild config.
   * @param {string} guildID - Guild ID.
   */
  static take(guildID) {
    if (!this.configs[guildID])
      this.configs[guildID] = new Config(guildID, this.defaultConfigJSON);

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

      if (channel.type !== 'text' || message.author.bot) return;

      if (this.botMentionRegex.test(message.content))
        this.parseCommand(channel, message)
          .catch(console.error);
    });
  }

  /**
   * Parse commands.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   * @param {Discord.Message} message - Event trigger message.
   */
  static async parseCommand(channel, message) {
    const guild = channel.guild;
    const adminRoles = Config.read(guild.id).adminRoles;

    const member = await channel.guild.members.fetch(message.author);
    const roles = member.roles.cache.filter(role => adminRoles.includes(role.id));

    if (!member.hasPermission('ADMINISTRATOR') && !roles.size) return;

    await this.configs[guild.id].command(channel, message);
  }

  /**
   * Initialize the guild config.
   * @param {string} guildID - Guild ID.
   * @param {ConfigProperty} json - The config json data.
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
  async command(channel, message) {
    const args = message.content.split(' ').slice(1);

    if (!args[0]) await this.sendValues(channel);

    switch(args[0]) {
      case 'admin':
        if (args[1] === 'add')
          await this.setAdminRoles(channel, channel.guild, args.slice(2), true);
        if (args[1] === 'remove')
          await this.setAdminRoles(channel, channel.guild, args.slice(2), false);
        break;
      case 'live':
        await this.commandLive(channel, args.slice(1));
        break;
    }
  }

  /**
   * Send command help.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   */
  async sendValues(channel) {
    const embed = new Discord.MessageEmbed({ color: Config.COLOR_HELP });

    embed.title = '🇶 設定値一覧';
    embed.description = '各設定の変更方法は[ドキュメント]()をご覧ください。';

    embed.addFields([
      {
        name: '管理者ロール',
        value: this.config.adminRoles.map(id => `<@&${id}>`).join('\n') || '```なし```'
      },
      {
        name: '===========================================================',
        value: '🔴 **実況チャンネル機能の設定値**'
      },
      {
        name: '実況受付チャンネル',
        value: this.config.liveChannel.acceptChannel
          ? `<#${this.config.liveChannel.acceptChannel}>` : '```なし(機能無効)```',
        inline: true
      },
      {
        name: '実況チャンネル名',
        value: `\`\`\`${this.config.liveChannel.liveName}\`\`\``,
        inline: true
      },
      {
        name: 'トピック',
        value: `\`\`\`${this.config.liveChannel.topic || '(未設定)'}\`\`\``
      },
      {
        name: 'レート制限(秒)',
        value: `\`\`\`${this.config.liveChannel.rateLimit}\`\`\``,
        inline: true
      },
      {
        name: 'NSFW',
        value: this.config.liveChannel.nfsw ? '```有効```' : '```無効```',
        inline: true
      },
      {
        name: '実況開始可能ロール',
        value: this.config.liveChannel.allowRoles.map(id => `<@&${id}>`).join('\n')
          || '```制限なし```'
      },
      {
        name: '実況チャンネル下限',
        value: `\`\`\`${this.config.liveChannel.minLive}\`\`\``,
        inline: true
      },
      {
        name: '実況チャンネル上限',
        value: `\`\`\`${this.config.liveChannel.maxLive}\`\`\``,
        inline: true
      },
      {
        name: '実況終了リアクション絵文字',
        value: channel.guild.emojis.cache.get(this.config.liveChannel.closeEmoji)?.toString()
          || this.config.liveChannel.closeEmoji,
        inline: true
      },
      {
        name: '実況終了を本人に限定',
        value: this.config.liveChannel.onlySelf ? '```する```' : '```しない```',
        inline: true
      },
      {
        name: '実況終了後の発言無効ロール',
        value: this.config.liveChannel.restricRoles.map(id => `<@&${id}>`).join('\n')
          || '```なし```'
      },
      {
        name: '実況自動終了時間(分)',
        value: `\`\`\`${this.config.liveChannel.autoClose || 'なし(機能無効)'}\`\`\``,
        inline: true
      },
      {
        name: '実況リンクピン止め',
        value: this.config.liveChannel.pinLink ? '```する```' : '```しない```',
        inline: true
      }
    ])

    await channel.send(embed);
  }

  /**
   * Set admin roles.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   * @param {boolean} add - add or remove.
   */
  async setAdminRoles(channel, guild, args, add) {
    const roles = this.config.adminRoles;
    const guildRoles = guild.roles.cache;
    const setRoles = args.map(arg => arg.match(/^((\d+)|<@&(\d+)>)$/))
      .map(arg => arg && (arg[2] || arg[3]))
      .filter(roleID => guildRoles.has(roleID)
        && (add && !roles.includes(roleID) || !add && roles.includes(roleID)));

    if (add) {
      roles.push(...setRoles);
    } else {
      roles = roles.filter(roleID => !setRoles.includes(roleID));
    }

    if (await this.updateConfig(channel, 'adminRoles', null, roles))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ ロールが${add ? '追加' : '削除'}されました`,
          description: '設定コマンドを実行できるロール:\n'
            + this.config.adminRoles.map(id => `<@&${id}>`).join(' ')
        }
      });
  }

  /**
   * Change live config.
   * @param {Discord.TextChannel} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async commandLive(channel, args) {
    switch (args[0]) {
      case 'set':
        await this.setAccept(channel, channel.guild, args.slice(2), true);
        break;
      case 'remove':
        await this.setAccept(channel, channel.guild, args.slice(2), false);
        break;
      case 'allow':
        if (args[1] === 'add')
          await this.setAllowRoles(channel, channel.guild, args.slice(2), true);
        if (args[1] === 'remove')
          await this.setAllowRoles(channel, channel.guild, args.slice(2), false);
        break;
      case 'restric':
        if (args[1] === 'add')
          await this.setRestricRoles(channel, channel.guild, args.slice(2), true);
        if (args[1] === 'remove')
          await this.setRestricRoles(channel, channel.guild, args.slice(2), false);
        break;
      case 'name':
        await this.setLiveName(channel, args.slice(1));
        break;
      case 'close-emoji':
        await this.setCloseEmoji(channel, channel.guild, args.slice(1));
        break;
      case 'topic':
        await this.setTopic(channel, args.slice(1));
        break;
      case 'min':
        await this.setMinLive(channel, args.slice(1));
        break;
      case 'max':
        await this.setMaxLive(channel, args.slice(1));
        break;
      case 'auto-close':
        await this.setAutoClose(channel, args.slice(1));
        break;
      case 'rate-limit':
        await this.setRateLimit(channel, args.slice(1));
        break;
      case 'only-self':
        if (args[1] === 'enable')  await this.setOnlySelf(channel, true);
        if (args[1] === 'disable') await this.setOnlySelf(channel, false);
        break;
      case 'pin-massage':
        if (args[1] === 'enable')  await this.setPinLink(channel, true);
        if (args[1] === 'disable') await this.setPinLink(channel, false);
        break;
      case 'nsfw':
        if (args[1] === 'enable')  await this.setNSFW(channel, true);
        if (args[1] === 'disable') await this.setNSFW(channel, false);
    }
  }

  /**
   * Set the channel that accepts live.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   * @param {boolean} set - Enable or Disable.
   */
  async setAccept(channel, guild, args, set) {
    let acceptID = '';

    if (set) {
      const matchAccept = args[0]?.match(/^((\d+)|<#(\d+)>)$/);
      acceptID = matchAccept && (matchAccept[2] || matchAccept[3]);
      const accept = guild.channels.cache.get(acceptID);
  
      if (!accept || accept.type !== 'text') {
        await channel?.send('', {
          embed: {
            color: Config.COLOR_FAILD,
            title: '⚠️ 指定したチャンネルが有効な値ではありません',
            description: 'サーバー内のテキストチャンネルを、メンション形式かIDで指定する必要があります。'
          }
        });
  
        return;
      }
    }

    if (await this.updateConfig(channel, 'liveChannel', 'acceptChannel', acceptID)) {
      this.emit('liveAcceptUpdate');

      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 実況受付チャンネルを${acceptID ? `変更` : '無効に'}しました`,
          description: acceptID ? `<#${acceptID}> で実況チャンネルを開始できます。` : ''
        }
      });
    }
  }

  /**
   * Set roles that are allowed to create live channels.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   * @param {boolean} add - add or remove.
   */
  async setAllowRoles(channel, guild, args, add) {
    const roles = this.config.liveChannel.allowRoles;
    const guildRoles = guild.roles.cache;
    const setRoles = args.map(arg => arg.match(/^((\d+)|<@&(\d+)>)$/))
      .map(arg => arg && (arg[2] || arg[3]))
      .filter(roleID => guildRoles.has(roleID)
        && (add && !roles.includes(roleID) || !add && roles.includes(roleID)));

    if (add) {
      roles.push(...setRoles);
    } else {
      roles = roles.filter(roleID => !setRoles.includes(roleID));
    }

    if (await this.updateConfig(channel, 'liveChannel', 'allowRoles', roles))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ ロールが${add ? '追加' : '削除'}されました`,
          description: '実況チャンネルを開始できるロール:\n'
            + this.config.liveChannel.allowRoles.map(id => `<@&${id}>`).join(' ')
        }
      });
  }

  /**
   * Set roles that are restric messages.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   * @param {boolean} add - add or remove.
   */
  async setRestricRoles(channel, guild, args, add) {
    const roles = this.config.liveChannel.restricRoles;
    const guildRoles = guild.roles.cache;
    const setRoles = args.map(arg => arg.match(/^((\d+)|<@&(\d+)>)$/))
      .map(arg => arg && (arg[2] || arg[3]))
      .filter(roleID => guildRoles.has(roleID)
        && (add && !roles.includes(roleID) || !add && roles.includes(roleID)));

    if (add) {
      roles.push(...setRoles);
    } else {
      roles = roles.filter(roleID => !setRoles.includes(roleID));
    }

    if (await this.updateConfig(channel, 'liveChannel', 'restricRoles', roles))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ ロールが${add ? '追加' : '削除'}されました`,
          description: '終了した実況チャンネルでメッセージ送信が無効化されるロール:\n'
            + this.config.liveChannel.restricRoles.map(id => `<@&${id}>`).join(' ')
        }
      });
  }

  /**
   * Set live channel base name.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async setLiveName(channel, args) {
    if (!args[0]) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 実況チャンネル名を入力してください'
        }
      });

      return;
    }

    if (args[0].length > 90) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 実況チャンネル名は90文字以下で指定してください'
        }
      });

      return;
    }

    if (await this.updateConfig(channel, 'liveChannel', 'liveName', args[0])) {
      this.emit('liveNameUpdate');

      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: '✅ 実況チャンネル名を設定しました',
          description: `以降 \`${args[0]}～\` が実況チャンネルとして認識されます。`
        }
      });
    }
  }

  /**
   * Set emoji for close live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {Discord.Guild} guild - Discord guild.
   * @param {string[]} args - Parsed command arguments.
   */
  async setCloseEmoji(channel, guild, args) {
    const matchEmoji = args[0]?.match(emojiRegex);

    if (!matchEmoji) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 絵文字を1文字だけ指定してください'
        }
      });

      return;
    }

    const emoji = matchEmoji[2] || matchEmoji[0];
    const isGuildEmoji = !!matchEmoji[2];

    if (isGuildEmoji && !guild.emojis.cache.has(emoji)) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ サーバー内に存在しない絵文字です'
        }
      });

      return;
    }

    if (await this.updateConfig(channel, 'liveChannel', 'closeEmoji', emoji))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: '✅ 実況チャンネルを終了させる絵文字を変更しました',
          description: `${matchEmoji[0]} で実況チャンネルを終了できます`
        }
      });
  }

  /**
   * Set default topic of live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async setTopic(channel, args) {
    const topic = args.join(' ');

    if (topic.length > 900) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ デフォルトトピックの文字数は900文字いかにしてください'
        }
      });

      return;
    }

    if (await this.updateConfig(channel, 'liveChannel', 'topic', topic))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 実況チャンネルのデフォルトトピックを設定しました`
        }
      });
  }

  /**
   * Set minimum number of channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async setMinLive(channel, args) {
    if (!/^\d+$/.test(args[0])) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 下限数を半角数字の正数で入力してください'
        }
      });

      return;
    }

    const min = Number(args[0]);

    if (min > this.config.liveChannel.maxLive)
      await this.setMaxLive(null, [`${min}`]);

    if (await this.updateConfig(channel, 'liveChannel', 'minLive', min)) {
      this.emit('liveMinUpdate');

      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 実況チャンネル数の上限値と下限値を ${min} に設定しました`
        }
      });
    }
  }

  /**
   * Set maximum number of channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async setMaxLive(channel, args) {
    if (!/^\d+$/.test(args[0])) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 上限数を半角数字の正数で入力してください'
        }
      });

      return;
    }

    const max = Number(args[0]);
    const min = this.config.liveChannel.minLive;

    if (max < min) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: `⚠️ 実況チャンネル数の下限値 ${min} 以上を入力してください`
        }
      });

      return;
    }

    if (await this.updateConfig(channel, 'liveChannel', 'maxLive', max))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 実況チャンネル数の上限値を ${max} に設定しました`
        }
      });
  }

  /**
   * Set auto close for live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async setAutoClose(channel, args) {
    if (!/^\d+$/.test(args[0])) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 設定時間(分)を半角数字の正数で入力してください',
          description: '`0` 以下の数を入力すると、機能が無効になります。'
        }
      });

      return;
    }

    const limit = Number(args[0]);

    if (await this.updateConfig(channel, 'liveChannel', 'autoClose', limit))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 自動終了${limit ? `時間を ${limit} 分に設定` : '機能を無効に'}しました`
        }
      });
  }

  /**
   * Set default rate limit of live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {string[]} args - Parsed command arguments.
   */
  async setRateLimit(channel, args) {
    if (!/^\d+$/.test(args[0])) {
      await channel?.send('', {
        embed: {
          color: Config.COLOR_FAILD,
          title: '⚠️ 設定時間(秒)を半角数字の正数で入力してください'
        }
      });

      return;
    }

    const limit = Number(args[0]);

    if (await this.updateConfig(channel, 'liveChannel', 'rateLimit', limit))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ デフォルトレート制限${limit ? `を ${limit} 秒に設定` : 'を無効に'}しました`
        }
      });
  }

  /**
   * Set so that only the person can close the live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {boolean} enable - enable or disable.
   */
  async setOnlySelf(channel, enable) {
    if (await this.updateConfig(channel, 'liveChannel', 'onlySelf', enable))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 実況チャンネルの終了を本人に限定を${enable ? '有効' : '無効'}にしました`
        }
      });
  }

  /**
   * Set enable pin link in live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {boolean} enable - enable or disable.
   */
  async setPinLink(channel, enable) {
    if (await this.updateConfig(channel, 'liveChannel', 'pinLink', enable))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ 実況チャンネルへの実況リンクピン止めを${enable ? '有効' : '無効'}にしました`
        }
      });
  }

  /**
   * Set enable NSFW in live channel.
   * @param {Discord.TextChannel|null} channel - Guils's text channel.
   * @param {boolean} enable - enable or disable.
   */
  async setNSFW(channel, enable) {
    if (await this.updateConfig(channel, 'liveChannel', 'nfsw', enable))
      await channel?.send('', {
        embed: {
          color: Config.COLOR_SUCCESS,
          title: `✅ デフォルトNSFWを${enable ? '有効' : '無効'}にしました`
        }
      });
  }

  /**
   * Upload config to Dropbox.
   * @param {Discord.TextChannel|null} channel Guils's text channel.
   * @param {string} key1 - Overrite config property.
   * @param {string|null} key2 - Overrite config property.
   * @param {any} value - Overriting value.
   */
  async updateConfig(channel, key1, key2, value) {
    let oldValue;

    if (key2) {
      oldValue = this.config[key1][key2];
      this.config[key1][key2] = value;
    } else {
      oldValue = this.config[key1];
      this.config[key1] = value;
    }

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

      key2 ? this.config[key1][key2] = oldValue : this.config[key1] = oldValue;

      return false;
    }

    return true;
  }
}
