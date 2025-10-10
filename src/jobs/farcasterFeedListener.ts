import {
  getInsecureHubRpcClient,
  HubEvent,
  HubEventType,
  Message,
  MessageType,
} from '@farcaster/hub-nodejs'
import { uint8ArrayToHex } from 'helpers/bufferUtils'
import farcasterEpochToUnix from 'helpers/farcasterEpochToUnix'
import { getNeynarUser } from 'helpers/neynarClient'
import prismaClient from 'helpers/prismaClient'
import { neynarUserToPrismaUser } from 'helpers/userSync'

const hubRpcEndpoint =
  process.env.FARCASTER_HUB_URL || 'nemes.farcaster.xyz:2283'
let isRunning = false
let restartCount = 0
const RESTART_DELAY_MS = 5000 // 5 seconds

// Helper function to reconstruct cast text with actual usernames
async function reconstructCastText(
  originalText: string,
  mentions?: number[],
  mentionsPositions?: number[]
): Promise<string> {
  if (
    !mentions ||
    !mentionsPositions ||
    mentions.length === 0 ||
    mentionsPositions.length === 0
  ) {
    return originalText
  }

  // Mentions and positions should have the same length
  if (mentions.length !== mentionsPositions.length) {
    console.warn(
      '[FARCASTER_FEED] ⚠️ Mentions and positions arrays have different lengths'
    )
    return originalText
  }

  // Create an array of mention info with positions, sorted by position (descending for insertion)
  const mentionInfos = mentions
    .map((fid, index) => ({
      fid,
      position: mentionsPositions[index],
    }))
    .sort((a, b) => b.position - a.position)

  let reconstructedText = originalText

  // Process mentions in reverse order to maintain correct positions during insertion
  for (const mentionInfo of mentionInfos) {
    try {
      // Fetch username for this FID from our database first, then fallback to hub
      let username: string | undefined

      try {
        const user = await prismaClient.user.findUnique({
          where: { fid: mentionInfo.fid },
          select: { username: true },
        })
        username = user?.username || undefined
      } catch (error) {
        console.warn(
          `Failed to get username from database for FID ${mentionInfo.fid}:`,
          error
        )
      }

      if (!username) {
        // Fallback to hub API
        try {
          const response = await fetch(
            `http://${hubRpcEndpoint.replace(':2283', ':2281')}/v1/userNameProofsByFid?fid=${mentionInfo.fid}`
          )
          const data = await response.json()
          username = data?.proofs?.[0]?.name
        } catch (error) {
          console.warn(
            `Failed to fetch username from hub for FID ${mentionInfo.fid}:`,
            error
          )
        }
      }

      if (username) {
        // Insert @username at the specified position
        const before = reconstructedText.slice(0, mentionInfo.position)
        const after = reconstructedText.slice(mentionInfo.position)
        reconstructedText = `${before}@${username}${after}`
      } else {
        // Fallback to @fid if username not found
        const before = reconstructedText.slice(0, mentionInfo.position)
        const after = reconstructedText.slice(mentionInfo.position)
        reconstructedText = `${before}@${mentionInfo.fid}${after}`
      }
    } catch (error) {
      console.warn(
        `[FARCASTER_FEED] ⚠️ Failed to fetch username for FID ${mentionInfo.fid}:`,
        error
      )
      // Fallback to @fid if fetch fails
      const before = reconstructedText.slice(0, mentionInfo.position)
      const after = reconstructedText.slice(mentionInfo.position)
      reconstructedText = `${before}@${mentionInfo.fid}${after}`
    }
  }

  return reconstructedText
}

export default function startFarcasterFeedInput() {
  if (isRunning) {
    console.log('[FARCASTER_FEED] 🔄 Listener already running, skipping start')
    return
  }

  console.log('[FARCASTER_FEED] 🚀 Starting Farcaster feed listener')
  startListener()
}

async function startListener() {
  isRunning = true
  const client = getInsecureHubRpcClient(hubRpcEndpoint)

  try {
    client.$.waitForReady(Date.now() + 10000, async (e) => {
      if (e) {
        console.error(
          `[FARCASTER_FEED] ❌ Failed to connect to gRPC server:`,
          e
        )
        scheduleRestart()
        return
      }

      console.log(`[FARCASTER_FEED] ✅ Connected to ${hubRpcEndpoint}`)

      try {
        const subscribeResult = await client.subscribe({
          eventTypes: [HubEventType.MERGE_MESSAGE],
        })

        if (subscribeResult.isOk()) {
          const stream = subscribeResult.value
          console.log('[FARCASTER_FEED] 🎧 Successfully subscribed to events')

          for await (const event of stream) {
            try {
              await processEvent(event)
            } catch (error) {
              console.error(
                '[FARCASTER_FEED] ❌ Error processing individual event:',
                error
              )
              // Continue processing other events even if one fails
            }
          }
        } else {
          console.error(
            '[FARCASTER_FEED] ❌ Failed to subscribe to events:',
            subscribeResult.error
          )
          scheduleRestart()
        }
      } catch (error) {
        console.error('[FARCASTER_FEED] ❌ Stream error:', error)
        scheduleRestart()
      } finally {
        try {
          client.close()
        } catch (closeError) {
          console.error('[FARCASTER_FEED] ❌ Error closing client:', closeError)
        }
        isRunning = false
      }
    })
  } catch (error) {
    console.error(
      '[FARCASTER_FEED] ❌ Unexpected error in startListener:',
      error
    )
    scheduleRestart()
  }
}

function scheduleRestart() {
  isRunning = false
  restartCount++

  console.log(
    `[FARCASTER_FEED] 🔄 Scheduling restart attempt ${restartCount} in ${RESTART_DELAY_MS}ms`
  )

  setTimeout(() => {
    console.log(
      `[FARCASTER_FEED] 🔄 Restarting listener (attempt ${restartCount})`
    )
    startListener()
  }, RESTART_DELAY_MS)
}

async function processEvent(event: unknown) {
  const hubEvent = event as HubEvent

  // Handle the actual structure: mergeMessageBody.message
  if (!hubEvent.mergeMessageBody?.message) {
    return
  }

  const message = hubEvent.mergeMessageBody.message

  // Only handle cast add messages
  if (message.data?.type !== MessageType.CAST_ADD) {
    return
  }

  const castAddBody = message.data.castAddBody
  if (!castAddBody?.text || !message.data?.fid || !message.hash) {
    return
  }

  const text = castAddBody.text
  const fid = message.data.fid

  // Skip if message is too old (older than 24 hours)
  if (
    farcasterEpochToUnix(message.data?.timestamp || 0) <
    Date.now() - 1000 * 60 * 60 * 24
  ) {
    return
  }

  // Process the cast - save to database
  await saveCastToDatabase(message)
}

async function saveCastToDatabase(message: Message) {
  if (!message.data?.castAddBody?.text || !message.data?.fid || !message.hash) {
    return
  }

  const castAddBody = message.data.castAddBody
  const originalText = castAddBody.text
  const fid = message.data.fid
  const hash = uint8ArrayToHex(message.hash)

  try {
    // Check if cast already exists
    const existingCast = await prismaClient.cast.findUnique({
      where: { hash },
    })

    if (existingCast) {
      console.log(`[FARCASTER_FEED] 📝 Cast ${hash} already exists, skipping`)
      return
    }

    // Ensure user exists in database
    await ensureUserExists(fid)

    // Reconstruct text with actual usernames from mentions
    const text = await reconstructCastText(
      originalText,
      castAddBody.mentions,
      castAddBody.mentionsPositions
    )

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
    const cast = await prismaClient.cast.create({
      data: {
        hash,
        fid,
        text,
        originalText,
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
        processedBy: 'farcaster-feed-listener',
        isReply,
        isQuoteCast,
        isMention,
      },
    })

    console.log(
      `[FARCASTER_FEED] ✅ Saved cast ${hash.substring(0, 8)}... by FID ${fid}: "${text.substring(0, 50)}..."${isReply ? ' [REPLY]' : ''}${isQuoteCast ? ' [QUOTE]' : ''}${isMention ? ' [MENTION]' : ''}`
    )
  } catch (error) {
    console.error(`[FARCASTER_FEED] ❌ Error saving cast ${hash}:`, error)
  }
}

async function ensureUserExists(fid: number) {
  try {
    // Check if user already exists
    const existingUser = await prismaClient.user.findUnique({
      where: { fid },
    })

    if (existingUser) {
      return existingUser
    }

    // User doesn't exist, fetch from Neynar and create
    console.log(`[FARCASTER_FEED] 👤 Creating new user for FID ${fid}`)

    const neynarUser = await getNeynarUser(fid)
    if (neynarUser) {
      const userData = neynarUserToPrismaUser(neynarUser)
      const user = await prismaClient.user.create({
        data: userData,
      })

      console.log(`[FARCASTER_FEED] ✅ Created user ${user.username || fid}`)
      return user
    } else {
      // Create minimal user if Neynar data not available
      const user = await prismaClient.user.create({
        data: {
          fid,
          lastSynced: new Date(),
          syncSource: 'hub-listener',
          isActive: true,
        },
      })

      console.log(`[FARCASTER_FEED] ✅ Created minimal user for FID ${fid}`)
      return user
    }
  } catch (error) {
    console.error(
      `[FARCASTER_FEED] ❌ Error ensuring user exists for FID ${fid}:`,
      error
    )
    throw error
  }
}
