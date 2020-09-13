import KissYou from './kiss_you/index.mjs';

const kissYou = new KissYou();

kissYou.login(process.env['KISS_YOU_TOKEN'])
  .catch(console.error);
