import type { CastAddMessage } from '@farcaster/hub-nodejs'
import { MessageType } from '@farcaster/hub-nodejs'
import { uint8ArrayToHex } from 'helpers/bufferUtils'
import farcasterEpochToUnix from 'helpers/farcasterEpochToUnix'
import hubClient from 'helpers/hubClient'
import prismaClient from 'helpers/prismaClient'
import {
  sendBackfillCompletionNotification,
  sendBackfillErrorNotification,
  sendBackfillProgressNotification,
  sendBackfillStartNotification,
} from 'helpers/telegramNotifier'
import { withTimeoutAndRetry } from 'helpers/timeout'

// Configuration constants
const USERS_BATCH_SIZE = 50 // Reduced for better progress tracking
const CASTS_BATCH_SIZE = 1000
const DELAY_BETWEEN_BATCHES = 1000 // 1 second delay between user batches
const USER_PROCESSING_TIMEOUT = 30000 // 30 seconds timeout per user (reduced from 60s)
const HUB_REQUEST_TIMEOUT = 15000 // 15 seconds timeout per hub request (reduced from 30s)
const BACKFILL_JOB_NAME = 'cast-backfill'

export default async function backfillCasts() {
  console.log('[BACKFILL_CASTS] 🚀 Starting cast backfill process')

  // First, get the total count of eligible users for progress tracking
  const totalUsers = await prismaClient.user.count({
    where: {
      AND: [
        { isActive: true },
        {
          score: {
            gte: 0.11,
            lt: 0.21,
          },
        },
      ],
    },
  })

  console.log(`[BACKFILL_CASTS] 📈 Total eligible users: ${totalUsers}`)

  // Check if we have existing progress to resume from
  let progressRecord = await prismaClient.backfillProgress.findUnique({
    where: { jobName: BACKFILL_JOB_NAME },
  })

  let offset = 0
  let processedUsers = 0
  let totalCastsBackfilled = 0
  let totalErrors = 0
  let batchNumber = 0
  let failedUserFids = new Set<number>()

  if (progressRecord && progressRecord.status === 'running') {
    // Resume from saved progress
    offset = progressRecord.offset
    processedUsers = progressRecord.processedUsers
    totalCastsBackfilled = progressRecord.castsBackfilled
    totalErrors = progressRecord.errorCount
    batchNumber = progressRecord.lastBatchNumber

    // Restore failed user FIDs from JSON
    if (progressRecord.failedUserFids) {
      const fids = progressRecord.failedUserFids as number[]
      failedUserFids = new Set(fids)
    }

    console.log('[BACKFILL_CASTS] 🔄 Resuming from previous progress:')
    console.log(`  - Offset: ${offset}`)
    console.log(`  - Processed users: ${processedUsers}/${totalUsers}`)
    console.log(`  - Casts backfilled: ${totalCastsBackfilled}`)
    console.log(`  - Errors: ${totalErrors}`)
    console.log(`  - Failed users: ${failedUserFids.size}`)
    console.log(`  - Last batch: ${batchNumber}`)
  } else {
    // Create new progress record
    progressRecord = await prismaClient.backfillProgress.upsert({
      where: { jobName: BACKFILL_JOB_NAME },
      create: {
        jobName: BACKFILL_JOB_NAME,
        totalUsers,
        status: 'running',
      },
      update: {
        totalUsers,
        status: 'running',
        startedAt: new Date(),
        completedAt: null,
        offset: 0,
        processedUsers: 0,
        castsBackfilled: 0,
        errorCount: 0,
        lastBatchNumber: 0,
        failedUserFids: [],
      },
    })
    console.log('[BACKFILL_CASTS] 🆕 Starting new backfill job')
  }

  // Send start notification
  await sendBackfillStartNotification(totalUsers)

  const errorMessages = new Map<string, number>() // Track error messages and their counts

  try {
    // Get users in batches with minimum neynar score
    let hasMoreUsers = true

    while (hasMoreUsers) {
      batchNumber++
      // console.log(
      //   `[BACKFILL_CASTS] 👥 Fetching users batch #${batchNumber} at offset ${offset}`
      // )

      try {
        const users = await prismaClient.user.findMany({
          where: {
            AND: [
              { isActive: true },
              {
                score: {
                  gte: 0.11,
                  lt: 0.21,
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

        // Filter out users that have already failed
        const usersToProcess = users.filter(
          (user) => !failedUserFids.has(user.fid)
        )

        if (usersToProcess.length === 0) {
          // console.log(
          //   `[BACKFILL_CASTS] ⏭️ Skipping batch - all users have previously failed`
          // )
          offset += USERS_BATCH_SIZE
          continue
        }

        // console.log(
        //   `[BACKFILL_CASTS] 👥 Processing ${usersToProcess.length} users (${users.length - usersToProcess.length} skipped as previously failed)`
        // )

        const currentProgress = Math.round((processedUsers / totalUsers) * 100)
        // console.log(
        //   `[BACKFILL_CASTS] 📋 Processing ${usersToProcess.length} users (${processedUsers + 1}-${processedUsers + usersToProcess.length}) - ${currentProgress}% complete`
        // )

        // Process users in parallel with rate limiting, timeouts, and retries
        const userPromises = usersToProcess.map((user, index) =>
          withTimeoutAndRetry(
            () =>
              processUserCasts(
                user,
                index,
                totalUsers,
                processedUsers + index + 1
              ),
            USER_PROCESSING_TIMEOUT,
            10, // max retries (increased to 10)
            2000, // 2 second delay between retries
            `Processing user ${user.fid}`
          )
            .then((castsCount) => ({ castsCount, error: null }))
            .catch((error) => {
              const errorMessage = error.message || String(error)
              console.error(
                `[BACKFILL_CASTS] ⏱️ Failed after 10 retries for user ${user.fid}:`,
                errorMessage
              )
              return { castsCount: -1, error: errorMessage } // Return error message
            })
        )

        const results = await Promise.all(userPromises)

        // Count casts and errors - track error messages
        let batchCasts = 0
        let batchErrors = 0

        results.forEach((result, index) => {
          if (result.castsCount === -1 && result.error) {
            // Failed after all retries - count as error and track FID
            const failedUser = usersToProcess[index]
            batchErrors++
            failedUserFids.add(failedUser.fid)
            // Track error message count (limit map size to prevent memory issues)
            if (errorMessages.size < 1000) {
              const count = errorMessages.get(result.error) || 0
              errorMessages.set(result.error, count + 1)
            }
          } else if (result.castsCount >= 0) {
            // Successfully processed (could be 0 casts for a user with no casts)
            batchCasts += result.castsCount
          }
        })

        processedUsers += users.length
        totalCastsBackfilled += batchCasts
        totalErrors += batchErrors

        const completionPercent = Math.round(
          (processedUsers / totalUsers) * 100
        )
        // console.log(
        //   `[BACKFILL_CASTS] 📈 Batch complete: ${batchCasts} casts, ${batchErrors} errors`
        // )
        // console.log(
        //   `[BACKFILL_CASTS] 📊 Progress: ${processedUsers}/${totalUsers} users (${completionPercent}%), ${totalCastsBackfilled} casts, ${totalErrors} errors, ${failedUserFids.size} permanently failed`
        // )

        // Send Telegram progress notification after each batch
        await sendBackfillProgressNotification({
          processedUsers,
          totalUsers,
          totalCastsBackfilled,
          totalErrors,
          batchNumber,
          errorMessages: Object.fromEntries(errorMessages),
          failedUserCount: failedUserFids.size,
        })

        // Save progress to database for resume capability
        await prismaClient.backfillProgress.update({
          where: { jobName: BACKFILL_JOB_NAME },
          data: {
            offset,
            processedUsers,
            castsBackfilled: totalCastsBackfilled,
            errorCount: totalErrors,
            lastBatchNumber: batchNumber,
            failedUserFids: Array.from(failedUserFids),
            lastProgressAt: new Date(),
          },
        })

        offset += USERS_BATCH_SIZE

        // Add delay between batches to avoid overwhelming the hub
        if (hasMoreUsers) {
          // console.log(
          //   `[BACKFILL_CASTS] ⏸️ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch`
          // )
          await new Promise((resolve) =>
            setTimeout(resolve, DELAY_BETWEEN_BATCHES)
          )
        }
      } catch (batchError) {
        console.error(
          `[BACKFILL_CASTS] ❌ Error processing batch #${batchNumber}:`,
          batchError
        )
        totalErrors++

        // Continue to next batch despite error
        offset += USERS_BATCH_SIZE

        // Add delay before retry
        await new Promise((resolve) =>
          setTimeout(resolve, DELAY_BETWEEN_BATCHES * 2)
        )
      }
    }

    console.log('[BACKFILL_CASTS] ✅ Backfill process completed - 100% done!')
    console.log(`[BACKFILL_CASTS] 📊 Final stats:`)
    console.log(`  - Users processed: ${processedUsers}/${totalUsers} (100%)`)
    console.log(`  - Casts backfilled: ${totalCastsBackfilled}`)
    console.log(`  - Errors: ${totalErrors}`)

    // Mark job as completed in database
    await prismaClient.backfillProgress.update({
      where: { jobName: BACKFILL_JOB_NAME },
      data: {
        status: 'completed',
        completedAt: new Date(),
        processedUsers,
        castsBackfilled: totalCastsBackfilled,
        errorCount: totalErrors,
      },
    })

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

    // Mark job as failed in database
    await prismaClient.backfillProgress.update({
      where: { jobName: BACKFILL_JOB_NAME },
      data: {
        status: 'failed',
      },
    })

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

  // console.log(
  //   `[BACKFILL_CASTS] 👤 Processing casts for ${username || `FID ${fid}`} (score: ${user.score})`
  // )

  try {
    let hasMoreCasts = true
    let pageCount = 0

    while (hasMoreCasts) {
      pageCount++

      try {
        const castsResult = await withTimeoutAndRetry(
          () =>
            hubClient.getCastsByFid({
              fid,
              pageSize: CASTS_BATCH_SIZE,
              pageToken,
            }),
          HUB_REQUEST_TIMEOUT,
          10, // max retries (increased to 10)
          1000, // delay between retries
          `Hub request for FID ${fid}`
        )

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
        // console.log(
        //   `[BACKFILL_CASTS] 📄 Page ${pageCount} for ${username || `FID ${fid}`}: ${messages.length} casts (User ${currentUserIndex}/${totalUsers} - ${progressPercent}%)`
        // )

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

    // console.log(
    //   `[BACKFILL_CASTS] ✅ Completed ${username || `FID ${fid}`}: ${castsProcessed} casts processed in ${pageCount} pages`
    // )

    return castsProcessed
  } catch (error) {
    console.error(
      `[BACKFILL_CASTS] ❌ Error processing casts for FID ${fid}:`,
      error
    )
    throw error
  }
}

// Helper function to safely serialize embeds data
function safeSerializeEmbeds(embeds: any): any {
  if (!embeds) return null

  try {
    // Convert to JSON string and back to sanitize
    const jsonStr = JSON.stringify(embeds)
    return JSON.parse(jsonStr)
  } catch (error) {
    // If serialization fails, try to clean the data
    console.warn(
      '[BACKFILL_CASTS] ⚠️ Failed to serialize embeds, attempting cleanup'
    )
    try {
      // Convert to string and remove any problematic characters
      const cleanStr = JSON.stringify(embeds).replace(
        /[\x00-\x1F\x7F-\x9F]/g,
        ''
      )
      return JSON.parse(cleanStr)
    } catch {
      // If all else fails, return null to skip embeds
      console.warn('[BACKFILL_CASTS] ⚠️ Could not clean embeds, skipping')
      return null
    }
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

    // Safely serialize embeds
    const embedsData = safeSerializeEmbeds(castAddBody.embeds)

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
        embeds: embedsData,
        processedBy: 'backfill-job',
        isReply,
        isQuoteCast,
        isMention,
      },
    })

    return true
  } catch (error) {
    // Only log if it's not a known parsing error
    const errorMsg = error instanceof Error ? error.message : String(error)
    if (
      !errorMsg.includes('unexpected end of hex escape') &&
      !errorMsg.includes('InvalidArg')
    ) {
      console.error(`[BACKFILL_CASTS] ❌ Error saving cast ${hash}:`, error)
    }
    // Always return false to skip problematic casts
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
