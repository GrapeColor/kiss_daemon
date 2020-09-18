import LiveDuty from './live_duty/index.mjs';

const liveDuty = new LiveDuty();

liveDuty.login(process.env['LIVE_DUTY_TOKEN'])
  .catch(console.error);
