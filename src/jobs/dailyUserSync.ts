import { getAllFidsFromHub, syncUsersFromNeynar } from 'helpers/userSync'
import * as cron from 'node-cron'

// Run daily at 2:00 AM
export function startDailyUserSync() {
  console.log('Scheduling daily user sync job for 2:00 AM...')

  cron.schedule('0 2 * * *', async () => {
    console.log('Starting scheduled daily user sync...')

    try {
      // Fetch all FIDs from hub
      const fids = await getAllFidsFromHub()
      console.log(`Found ${fids.length} FIDs in Farcaster hub`)

      // Sync users from Neynar
      const result = await syncUsersFromNeynar(fids)

      console.log('Daily user sync completed:', result)
    } catch (error) {
      console.error('Daily user sync failed:', error)
    }
  })

  console.log('Daily user sync job scheduled')
}

// Manual sync function for testing/manual triggers
export async function runManualSync() {
  console.log('Running manual user sync...')

  try {
    const fids = await getAllFidsFromHub()
    console.log(`Found ${fids.length} FIDs in Farcaster hub`)

    const result = await syncUsersFromNeynar(fids)
    console.log('Manual user sync completed:', result)

    return result
  } catch (error) {
    console.error('Manual user sync failed:', error)
    throw error
  }
}
