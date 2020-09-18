import { Client, Intents } from 'discord.js';

import Config from './config.js';
import LiveAccept from './live_accept.js';
import LiveChannel from './live_channel.js';

export default class LiveDuty {
  constructor() {
    this.bot = new Client({
      ws: { intents: Intents.NON_PRIVILEGED },
      partials: ['USER', 'CHANNEL', 'GUILD_MEMBER', 'MESSAGE', 'REACTION']
    });

    this.bot.on('ready', () => {
      this.bot.user.setActivity('URLを貼って実況スタート', { type: 'PLAYING' })
        .catch(console.error);
    });

    Config.events(this.bot);
    LiveAccept.events(this.bot);
    LiveChannel.events(this.bot);
  }

  /**
   * Live Duty login to discord.
   * @param {string} token - Discord client token.
   */
  async login(token) {
    await Config.load();
    console.info('Loaded config files.');

    await this.bot.login(token);
    console.info('Logged in to Discord.');
  }
}
