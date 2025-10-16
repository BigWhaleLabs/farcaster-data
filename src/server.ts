import 'core-js'
import 'reflect-metadata'

import 'dotenv/config'

// Add global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
})

// Handle BigInt serialization for GraphQL
declare global {
  interface BigInt {
    toJSON(): string
  }
}

BigInt.prototype.toJSON = function () {
  return this.toString()
}

import env from 'helpers/env'
import yoga from 'helpers/yoga'
import { startDailyUserSync } from 'jobs/dailyUserSync'
import startFarcasterFeedListener from 'jobs/farcasterFeedListener'

import backfillCasts from 'jobs/backfillCasts'

const server = Bun.serve({
  fetch: yoga.fetch,
  port: env.PORT,
})

console.log(`🚀 Farcaster Data server running at http://localhost:${env.PORT}/`)

// Start the daily user sync job
startDailyUserSync()
console.log('📅 Daily user sync job started')

// Start the Farcaster feed listener to save all casts
startFarcasterFeedListener()
console.log('🎧 Farcaster feed listener started')

// Start the backfill job in parallel (non-blocking)
backfillCasts()
  .then(() => {
    console.log('🗄️ Backfill job completed')
  })
  .catch((err) => {
    console.error('🗄️ Backfill job error:', err)
  })

export { server }
