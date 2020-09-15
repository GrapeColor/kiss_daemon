import { Client, Intents, Message } from 'discord.js';

import Config from './config.js';
import LiveAccept from './live_accept.js';
import LiveChannel from './live_channel.js';

export default class KissYou {
  constructor() {
    this.bot = new Client({
      ws: { intents: Intents.NON_PRIVILEGED },
      partials: ['USER', 'CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'REACTION']
    });

    this.bot.on('ready', () => {
      this.bot.user?.setActivity('塞いでやるよ俺のこの唇でな', { type: 'PLAYING' });
    });

    this.bot.on('message', message => {
      if (message.channel.type !== 'dm' || message.author.bot) return;

      message.channel.send(
        'うるせぇDMだな、塞いでやるよ俺のこの唇でな(っ◝💋◜c)'
        + 'ぶちゅちゅちゅるちゅるちゅちゅ💗💗💗'
        + 'とぅるちゅるちゅるぶっちゅちゅちゅ💗💗💗💗💗💗'
        +'(っ◝💋◜c)んーっまっ💗んま💗っ💗💗んまっ💗💗んーっ( っ`-´c)💗'
      )
        .catch(console.error);
    });

    Config.events(this.bot);
    LiveAccept.events(this.bot);
    LiveChannel.events(this.bot);
  }

  /**
   * KissYou login to discord.
   * @param {string} token - Discord client token.
   */
  async login(token) {
    await Config.load();
    console.info('Loaded config files.');

    await this.bot.login(token);
    console.info('Logged in to Discord.');
  }
}
