import './env'; // must be first, so .env is loaded before config is read
import cfg from './lib/config';
import { app } from './app';

app.listen(cfg.port, '0.0.0.0', () => {
  console.log(`${cfg.businessName} bookings running on port ${cfg.port}`);
  if (!cfg.adminPassword) console.warn('⚠️  ADMIN_PASSWORD is not set – the admin page is disabled.');
  if (!cfg.homePostcode) console.warn('⚠️  HOME_POSTCODE is not set – delivery costs will not be estimated.');
  if (cfg.telegramBotToken && cfg.telegramChatId) console.log('Telegram booking alerts: on');
  else console.warn('⚠️  Telegram alerts are off – set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (see README).');
});
