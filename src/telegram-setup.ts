/**
 * Telegram Bot Setup Script
 *
 * Run this to verify your Telegram bot token is valid.
 * Usage: npm run setup:telegram
 *
 * To get a bot token:
 * 1. Open Telegram and search for @BotFather
 * 2. Send /newbot and follow the prompts
 * 3. Copy the token and set TELEGRAM_BOT_TOKEN in your .env file
 */
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(
    '╔══════════════════════════════════════════════════════════════╗',
  );
  console.error(
    '║  ERROR: TELEGRAM_BOT_TOKEN environment variable not set      ║',
  );
  console.error(
    '╟──────────────────────────────────────────────────────────────╢',
  );
  console.error(
    '║  To fix:                                                     ║',
  );
  console.error(
    '║  1. Open Telegram and message @BotFather                     ║',
  );
  console.error(
    '║  2. Send /newbot and follow the prompts                      ║',
  );
  console.error(
    '║  3. Copy the token and create .env file:                     ║',
  );
  console.error(
    '║     echo "TELEGRAM_BOT_TOKEN=your_token_here" > .env         ║',
  );
  console.error(
    '║  4. Run this script again                                    ║',
  );
  console.error(
    '╚══════════════════════════════════════════════════════════════╝',
  );
  process.exit(1);
}

console.log('Verifying Telegram bot token...\n');

const bot = new TelegramBot(token, { polling: false });

bot
  .getMe()
  .then((me) => {
    console.log(
      '╔══════════════════════════════════════════════════════════════╗',
    );
    console.log(
      '║  ✓ Bot token is valid!                                       ║',
    );
    console.log(
      '╟──────────────────────────────────────────────────────────────╢',
    );
    console.log(`║  Bot Username: @${me.username?.padEnd(43)}║`);
    console.log(`║  Bot ID: ${me.id.toString().padEnd(50)}║`);
    console.log(
      '╟──────────────────────────────────────────────────────────────╢',
    );
    console.log(
      '║  Next steps:                                                 ║',
    );
    console.log(
      '║  1. Add the bot to your Telegram group                       ║',
    );
    console.log(
      '║  2. Make it an admin (so it can read messages)               ║',
    );
    console.log(
      '║  3. Run: npm run dev                                         ║',
    );
    console.log(
      '║  4. Send @Andy hello in your group                           ║',
    );
    console.log(
      '╚══════════════════════════════════════════════════════════════╝',
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error(
      '╔══════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  ✗ Invalid bot token                                         ║',
    );
    console.error(
      '╟──────────────────────────────────────────────────────────────╢',
    );
    console.error(`║  Error: ${err.message.slice(0, 50).padEnd(50)}║`);
    console.error(
      '╟──────────────────────────────────────────────────────────────╢',
    );
    console.error(
      '║  Please check your token and try again.                      ║',
    );
    console.error(
      '║  Get a new token from @BotFather if needed.                  ║',
    );
    console.error(
      '╚══════════════════════════════════════════════════════════════╝',
    );
    process.exit(1);
  });
