#!/usr/bin/env bun
import backfillCasts from 'jobs/backfillCasts'

console.log('🚀 Starting cast backfill job...')

try {
  const result = await backfillCasts()
  console.log('✅ Backfill completed successfully!')
  console.log('📊 Results:', result)
  process.exit(0)
} catch (error) {
  console.error('❌ Backfill failed:', error)
  process.exit(1)
}
