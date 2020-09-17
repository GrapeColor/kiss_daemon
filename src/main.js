import KissDaemon from './kiss_daemon/index.mjs';

const kissDaemon = new KissDaemon();

kissDaemon.login(process.env['KISS_DAEMON_TOKEN'])
  .catch(console.error);
