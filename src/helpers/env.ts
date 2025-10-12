import { cleanEnv, port, str } from 'envalid'

const env = cleanEnv(process.env, {
  POSTGRES: str({ desc: 'PostgreSQL connection string' }),
  NEYNAR_API_KEY: str({ desc: 'Neynar API key for Farcaster data' }),
  FARCASTER_HUB_URL: str({
    desc: 'Farcaster Hub RPC URL',
  }),
  TELEGRAM_BOT_TOKEN: str({
    desc: 'Telegram bot token for notifications',
  }),
  PORT: port({ default: 4000, desc: 'Server port' }),
  NODE_ENV: str({
    choices: ['development', 'production', 'test'],
    default: 'development',
  }),
})

export default env
