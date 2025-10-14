import type { CastAddMessage } from '@farcaster/hub-nodejs'
import { MessageType } from '@farcaster/hub-nodejs'
import { uint8ArrayToHex } from 'helpers/bufferUtils'
import farcasterEpochToUnix from 'helpers/farcasterEpochToUnix'
import hubClient from 'helpers/hubClient'
import minNeynar from 'helpers/minNeynar'
import prismaClient from 'helpers/prismaClient'
import {
  sendBackfillCompletionNotification,
  sendBackfillErrorNotification,
} from 'helpers/telegramNotifier'

// Configuration constants
const USERS_BATCH_SIZE = 500
const CASTS_BATCH_SIZE = 10000
const DELAY_BETWEEN_BATCHES = 1000 // 1 second delay between user batches

export default async function backfillCasts() {
  console.log('[BACKFILL_CASTS] 🚀 Starting cast backfill process')
  console.log(
    `[BACKFILL_CASTS] 📊 Target Neynar score range: ${minNeynar} to 1`
  )

  // First, get the total count of eligible users for progress tracking
  const totalUsers = await prismaClient.user.count({
    where: {
      AND: [
        { isActive: true },
        {
          score: {
            gte: minNeynar,
            // lt: 0.5,
          },
        },
      ],
    },
  })

  console.log(`[BACKFILL_CASTS] 📈 Total eligible users: ${totalUsers}`)

  let processedUsers = 0
  let totalCastsBackfilled = 0
  let totalErrors = 0

  try {
    // Get users in batches with minimum neynar score
    let offset = 0
    let hasMoreUsers = true

    while (hasMoreUsers) {
      console.log(
        `[BACKFILL_CASTS] 👥 Fetching users batch at offset ${offset}`
      )

      const users = await prismaClient.user.findMany({
        where: {
          AND: [
            { isActive: true },
            {
              score: {
                gte: minNeynar,
                // lt: 0.5,
              },
            },
          ],
        },
        select: {
          fid: true,
          username: true,
          score: true,
        },
        orderBy: [{ score: 'desc' }, { fid: 'asc' }],
        take: USERS_BATCH_SIZE,
        skip: offset,
      })

      if (users.length === 0) {
        hasMoreUsers = false
        break
      }

      const currentProgress = Math.round((processedUsers / totalUsers) * 100)
      console.log(
        `[BACKFILL_CASTS] 📋 Processing ${users.length} users (${processedUsers + 1}-${processedUsers + users.length}) - ${currentProgress}% complete`
      )

      // Process users in parallel with rate limiting
      const userPromises = users.map((user, index) =>
        processUserCasts(user, index, totalUsers, processedUsers + index + 1)
      )

      const results = await Promise.allSettled(userPromises)

      // Count successful vs failed results
      let batchCasts = 0
      let batchErrors = 0

      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          batchCasts += result.value
        } else {
          batchErrors++
          console.error(
            `[BACKFILL_CASTS] ❌ Failed to process user ${users[index].fid}:`,
            result.reason
          )
        }
      })

      processedUsers += users.length
      totalCastsBackfilled += batchCasts
      totalErrors += batchErrors

      const completionPercent = Math.round((processedUsers / totalUsers) * 100)
      console.log(
        `[BACKFILL_CASTS] 📈 Batch complete: ${batchCasts} casts, ${batchErrors} errors`
      )
      console.log(
        `[BACKFILL_CASTS] 📊 Progress: ${processedUsers}/${totalUsers} users (${completionPercent}%), ${totalCastsBackfilled} casts, ${totalErrors} errors`
      )

      offset += USERS_BATCH_SIZE

      // Add delay between batches to avoid overwhelming the hub
      if (hasMoreUsers) {
        console.log(
          `[BACKFILL_CASTS] ⏸️ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch`
        )
      }
    }

    console.log('[BACKFILL_CASTS] ✅ Backfill process completed - 100% done!')
    console.log(`[BACKFILL_CASTS] 📊 Final stats:`)
    console.log(`  - Users processed: ${processedUsers}/${totalUsers} (100%)`)
    console.log(`  - Casts backfilled: ${totalCastsBackfilled}`)
    console.log(`  - Errors: ${totalErrors}`)

    // Send Telegram notification for successful completion
    await sendBackfillCompletionNotification({
      usersProcessed: processedUsers,
      castsBackfilled: totalCastsBackfilled,
    })

    return {
      usersProcessed: processedUsers,
      castsBackfilled: totalCastsBackfilled,
      errors: totalErrors,
    }
  } catch (error) {
    console.error('[BACKFILL_CASTS] ❌ Fatal error in backfill process:', error)

    // Send Telegram notification for error
    await sendBackfillErrorNotification(error)

    throw error
  }
}

async function processUserCasts(
  user: {
    fid: number
    username: string | null
    score: number | null
  },
  batchIndex: number,
  totalUsers: number,
  currentUserIndex: number
): Promise<number> {
  const { fid, username } = user
  let castsProcessed = 0
  let pageToken: Uint8Array | undefined

  console.log(
    `[BACKFILL_CASTS] 👤 Processing casts for ${username || `FID ${fid}`} (score: ${user.score})`
  )

  try {
    let hasMoreCasts = true
    let pageCount = 0

    while (hasMoreCasts) {
      pageCount++

      try {
        const castsResult = await hubClient.getCastsByFid({
          fid,
          pageSize: CASTS_BATCH_SIZE,
          pageToken,
        })

        if (castsResult.isErr()) {
          console.error(
            `[BACKFILL_CASTS] ❌ Failed to fetch casts for FID ${fid}:`,
            castsResult.error
          )
          break
        }

        const { messages, nextPageToken } = castsResult.value

        const progressPercent = Math.round(
          (currentUserIndex / totalUsers) * 100
        )
        console.log(
          `[BACKFILL_CASTS] 📄 Page ${pageCount} for ${username || `FID ${fid}`}: ${messages.length} casts (User ${currentUserIndex}/${totalUsers} - ${progressPercent}%)`
        )

        if (messages.length === 0) {
          hasMoreCasts = false
          break
        }

        // Process casts from this page
        for (const message of messages) {
          try {
            const processed = await processCastMessage(
              message as CastAddMessage
            )
            if (processed) {
              castsProcessed++
            }
          } catch (error) {
            console.error(
              `[BACKFILL_CASTS] ❌ Error processing individual cast for FID ${fid}:`,
              error
            )
          }
        }

        // Check if there are more pages
        if (nextPageToken && nextPageToken.length > 0) {
          pageToken = nextPageToken
        } else {
          hasMoreCasts = false
        }
      } catch (error) {
        console.error(
          `[BACKFILL_CASTS] ❌ Error fetching page ${pageCount} for FID ${fid}:`,
          error
        )
        break
      }
    }

    console.log(
      `[BACKFILL_CASTS] ✅ Completed ${username || `FID ${fid}`}: ${castsProcessed} casts processed in ${pageCount} pages`
    )

    return castsProcessed
  } catch (error) {
    console.error(
      `[BACKFILL_CASTS] ❌ Error processing casts for FID ${fid}:`,
      error
    )
    throw error
  }
}

async function processCastMessage(message: CastAddMessage): Promise<boolean> {
  if (!message.data?.castAddBody?.text || !message.data?.fid || !message.hash) {
    return false
  }

  const castAddBody = message.data.castAddBody
  const fid = message.data.fid
  const hash = uint8ArrayToHex(message.hash)

  try {
    // Check if cast already exists
    const existingCast = await prismaClient.cast.findUnique({
      where: { hash },
    })

    if (existingCast) {
      return false // Skip existing casts
    }

    // Determine cast type
    const isReply = !!(
      castAddBody.parentCastId?.fid && castAddBody.parentCastId.hash
    )
    const isQuoteCast =
      castAddBody.embeds?.some(
        (embed: any) => embed.castId?.fid && embed.castId?.hash
      ) || false
    const isMention = (castAddBody.mentions?.length || 0) > 0

    // Create the cast record
    await prismaClient.cast.create({
      data: {
        hash,
        fid,
        text: castAddBody.text,
        originalText: castAddBody.text,
        mentions: castAddBody.mentions || [],
        mentionsPositions: castAddBody.mentionsPositions || [],
        timestamp: new Date(farcasterEpochToUnix(message.data.timestamp || 0)),
        messageType: MessageType[message.data.type || 0],
        parentCastFid: castAddBody.parentCastId?.fid || null,
        parentCastHash: castAddBody.parentCastId?.hash
          ? uint8ArrayToHex(castAddBody.parentCastId.hash)
          : null,
        embeds: castAddBody.embeds
          ? JSON.parse(JSON.stringify(castAddBody.embeds))
          : null,
        processedBy: 'backfill-job',
        isReply,
        isQuoteCast,
        isMention,
      },
    })

    return true
  } catch (error) {
    console.error(`[BACKFILL_CASTS] ❌ Error saving cast ${hash}:`, error)
    return false
  }
}

// Function to backfill casts for a specific user (useful for testing)
export async function backfillCastsForUser(fid: number): Promise<number> {
  const user = await prismaClient.user.findUnique({
    where: { fid },
    select: {
      fid: true,
      username: true,
      score: true,
    },
  })

  if (!user) {
    throw new Error(`User with FID ${fid} not found`)
  }

  return processUserCasts(user, 0, 1, 1)
}
