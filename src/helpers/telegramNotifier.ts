import { Bot } from 'grammy'
import env from 'helpers/env'

const NOTIFICATION_CHAT_ID = '76104711'

let bot = new Bot(env.TELEGRAM_BOT_TOKEN)

export async function sendTelegramNotification(message: string): Promise<void> {
  if (!bot || !env.TELEGRAM_BOT_TOKEN) {
    console.log('[TELEGRAM] Bot token not configured, skipping notification')
    console.log(`[TELEGRAM] Message: ${message}`)
    return
  }

  try {
    await bot.api.sendMessage(NOTIFICATION_CHAT_ID, message, {
      parse_mode: 'Markdown',
    })
    console.log('[TELEGRAM] ✅ Notification sent successfully')
  } catch (error) {
    console.error('[TELEGRAM] ❌ Failed to send notification:', error)
  }
}

export async function sendBackfillCompletionNotification(stats: {
  usersProcessed: number
  castsBackfilled: number
}): Promise<void> {
  const message = `🗄️ *Farcaster Cast Backfill Complete*

✅ *Users processed:* ${stats.usersProcessed.toLocaleString()}
📄 *Casts backfilled:* ${stats.castsBackfilled.toLocaleString()}`

  await sendTelegramNotification(message)
}

export async function sendBackfillErrorNotification(error: any): Promise<void> {
  const errorMessage = error?.message || String(error)

  const message = `❌ *Farcaster Cast Backfill Failed*

🚨 *Error:* ${errorMessage}`

  await sendTelegramNotification(message)
}
