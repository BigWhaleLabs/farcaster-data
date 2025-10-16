import { Bot } from 'grammy'
import env from 'helpers/env'
import minNeynar from 'helpers/minNeynar'

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

export async function sendBackfillStartNotification(
  totalUsers: number
): Promise<void> {
  const message = `🚀 *Farcaster Cast Backfill Started*

📊 *Total users to process:* ${totalUsers.toLocaleString()}
📦 *Batch size:* 50 users
📈 *Score range:* ${minNeynar} and above (inclusive)
*Started:* ${new Date().toISOString()}

_Progress updates will be sent after each batch..._`

  await sendTelegramNotification(message)
}

export async function sendBackfillProgressNotification(stats: {
  processedUsers: number
  totalUsers: number
  totalCastsBackfilled: number
  totalErrors: number
  batchNumber: number
  errorMessages?: Record<string, number>
  failedUserCount?: number
}): Promise<void> {
  const completionPercent = Math.round(
    (stats.processedUsers / stats.totalUsers) * 100
  )

  // Build error breakdown if there are errors
  let errorBreakdown = ''
  if (stats.totalErrors > 0 && stats.errorMessages) {
    const errorEntries = Object.entries(stats.errorMessages)
      .sort(([, a], [, b]) => b - a) // Sort by count, descending
      .slice(0, 5) // Top 5 errors
      .map(([msg, count]) => {
        // Truncate long error messages
        const shortMsg = msg.length > 50 ? msg.substring(0, 47) + '...' : msg
        return `  • ${shortMsg}: ${count}x`
      })
      .join('\n')

    if (errorEntries) {
      errorBreakdown = `\n\n*Error breakdown:*\n${errorEntries}`
    }
  }

  const message = `📊 *Backfill Progress - Batch ${stats.batchNumber}*

⏳ *Progress:* ${stats.processedUsers.toLocaleString()}/${stats.totalUsers.toLocaleString()} users (${completionPercent}%)
📄 *Total casts:* ${stats.totalCastsBackfilled.toLocaleString()}
${stats.totalErrors > 0 ? `⚠️ *Errors:* ${stats.totalErrors}` : '✅ *No errors so far*'}
${stats.failedUserCount ? `🚫 *Permanently failed:* ${stats.failedUserCount} users (skipped in future batches)` : ''}
📈 *Score:* ${minNeynar}+ (inclusive)${errorBreakdown}`

  await sendTelegramNotification(message)
}

export async function sendBackfillErrorNotification(error: any): Promise<void> {
  const errorMessage = error?.message || String(error)

  const message = `❌ *Farcaster Cast Backfill Failed*

🚨 *Error:* ${errorMessage}
📈 *Score range:* ${minNeynar}+ (inclusive)`

  await sendTelegramNotification(message)
}
