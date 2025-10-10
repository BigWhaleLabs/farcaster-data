import 'core-js'
import 'reflect-metadata'

import 'dotenv/config'

// Add global error handlers to prevent server crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  // Don't exit in production, just log the error
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1)
  }
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit in production, just log the error
  if (process.env.NODE_ENV !== 'production') {
    process.exit(1)
  }
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

const server = Bun.serve({
  fetch: yoga.fetch,
  port: env.PORT,
})

console.log(`🚀 Farcaster Data server running at http://localhost:${env.PORT}/`)

// Start the daily user sync job
startDailyUserSync()
console.log('📅 Daily user sync job started')

export { server }
