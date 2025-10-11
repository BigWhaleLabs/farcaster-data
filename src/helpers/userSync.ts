import hubClient from 'helpers/hubClient'
import { getNeynarUsers, type NeynarUser } from 'helpers/neynarClient'
import prismaClient from 'helpers/prismaClient'

export async function getAllFidsFromHub(): Promise<number[]> {
  try {
    const fids = []
    let cursor: Uint8Array | undefined = undefined
    // Get FIDs from the hub - shardId 0 contains all FIDs
    console.log('Fetching all FIDs from Farcaster hub...')
    for (const shardId of [1, 2]) {
      do {
        const result = await hubClient.getFids({
          pageToken: cursor,
          shardId,
        })
        console.log(
          `Fetched ${result.isOk() ? result.value.fids.length : 0} FIDs from hub, total so far: ${fids.length}`
        )
        if (result.isErr()) {
          throw new Error(`Hub error: ${result.error.message}`)
        }
        fids.push(...result.value.fids)
        cursor = result.value.nextPageToken
      } while (!!cursor)
    }

    return fids
  } catch (error) {
    console.error('Error fetching FIDs from hub:', error)
    throw error
  }
}

export function neynarUserToPrismaUser(neynarUser: NeynarUser) {
  return {
    fid: neynarUser.fid,
    username: neynarUser.username,
    displayName: neynarUser.display_name,
    custodyAddress: neynarUser.custody_address,
    pfpUrl: neynarUser.pfp_url,
    bioText: neynarUser.profile?.bio?.text,
    locationCity: neynarUser.profile?.location?.address?.city,
    locationState: neynarUser.profile?.location?.address?.state,
    locationStateCode: neynarUser.profile?.location?.address?.state_code,
    locationCountry: neynarUser.profile?.location?.address?.country,
    locationCountryCode: neynarUser.profile?.location?.address?.country_code,
    bannerUrl: neynarUser.profile?.banner?.url,
    followerCount: neynarUser.follower_count,
    followingCount: neynarUser.following_count,
    score: neynarUser.score,
    powerBadge: neynarUser.power_badge,
    verifications: neynarUser.verifications || [],
    ethAddresses: neynarUser.verified_addresses?.eth_addresses || [],
    solAddresses: neynarUser.verified_addresses?.sol_addresses || [],
    primaryEthAddress: neynarUser.verified_addresses?.primary?.eth_address,
    primarySolAddress: neynarUser.verified_addresses?.primary?.sol_address,
    verifiedAccounts: neynarUser.verified_accounts || [],
    proStatus: neynarUser.pro?.status,
    proSubscribedAt: neynarUser.pro?.subscribed_at
      ? new Date(neynarUser.pro.subscribed_at)
      : null,
    proExpiresAt: neynarUser.pro?.expires_at
      ? new Date(neynarUser.pro.expires_at)
      : null,
    lastSynced: new Date(),
    syncSource: 'neynar' as const,
    isActive: true,
  }
}

export async function syncUsersFromNeynar(fids: number[]) {
  console.log(`Starting sync of ${fids.length} users from Neynar...`)

  // Process in chunks of 100 (Neynar's limit) with rate limiting
  // Target: 80% of 600 RPM = 480 RPM = 8 RPS
  const chunkSize = 100
  const parallelBatches = 8 // 8 parallel requests per batch = 8 RPS
  const batchDelayMs = 1000 // 1 second delay to maintain 8 RPS
  let processed = 0
  let successful = 0
  let errors = 0

  // Split FIDs into chunks of 100
  const chunks = []
  for (let i = 0; i < fids.length; i += chunkSize) {
    chunks.push(fids.slice(i, i + chunkSize))
  }

  console.log(
    `Processing ${chunks.length} chunks with ${parallelBatches} parallel requests`
  )

  // Process chunks in batches of 100 parallel requests
  for (
    let batchStart = 0;
    batchStart < chunks.length;
    batchStart += parallelBatches
  ) {
    const batchEnd = Math.min(batchStart + parallelBatches, chunks.length)
    const currentBatch = chunks.slice(batchStart, batchEnd)

    console.log(
      `Processing batch ${Math.floor(batchStart / parallelBatches) + 1}/${Math.ceil(chunks.length / parallelBatches)} (${currentBatch.length} parallel requests)`
    )

    // Process all chunks in this batch in parallel
    const batchPromises = currentBatch.map(async (chunk, index) => {
      const chunkIndex = batchStart + index
      try {
        const neynarUsers = await getNeynarUsers(chunk)

        // Process users in this chunk
        const chunkResults = await Promise.allSettled(
          neynarUsers.map(async (neynarUser) => {
            const userData = neynarUserToPrismaUser(neynarUser)

            return prismaClient.user.upsert({
              where: { fid: neynarUser.fid },
              update: {
                ...userData,
                updatedAt: new Date(),
              },
              create: userData,
            })
          })
        )

        // Count results for this chunk
        let chunkSuccessful = 0
        let chunkErrors = 0

        chunkResults.forEach((result, userIndex) => {
          if (result.status === 'fulfilled') {
            chunkSuccessful++
          } else {
            chunkErrors++
            console.error(
              `Error upserting user ${neynarUsers[userIndex]?.fid}:`,
              result.reason
            )
          }
        })

        return {
          processed: chunk.length,
          successful: chunkSuccessful,
          errors: chunkErrors,
          chunkIndex,
        }
      } catch (error) {
        console.error(`Error processing chunk ${chunkIndex}:`, error)
        return {
          processed: chunk.length,
          successful: 0,
          errors: chunk.length,
          chunkIndex,
        }
      }
    })

    // Wait for all chunks in this batch to complete
    const batchResults = await Promise.allSettled(batchPromises)

    // Aggregate results from this batch
    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        processed += result.value.processed
        successful += result.value.successful
        errors += result.value.errors
      } else {
        console.error('Batch promise failed:', result.reason)
        errors += chunkSize // Assume full chunk failed
      }
    })

    console.log(
      `Batch completed: ${processed}/${fids.length} FIDs processed (${successful} successful, ${errors} errors)`
    )

    // Rate limiting: delay between batches to maintain 8 RPS (80% of 10 RPS limit)
    if (batchEnd < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs))
    }
  }

  console.log(
    `User sync completed: ${successful} successful, ${errors} errors out of ${processed} total`
  )
  return { successful, errors, processed }
}
