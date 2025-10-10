import hubClient from 'helpers/hubClient'
import { getNeynarUsers, type NeynarUser } from 'helpers/neynarClient'
import prismaClient from 'helpers/prismaClient'

export async function getAllFidsFromHub(): Promise<number[]> {
  try {
    // Get FIDs from the hub - shardId 0 contains all FIDs
    const result = await hubClient.getFids({ shardId: 0 })
    if (result.isErr()) {
      throw new Error(`Hub error: ${result.error.message}`)
    }

    return result.value.fids
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
    neynarUserScore: neynarUser.experimental?.neynar_user_score,
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

  // Process in chunks of 100 (Neynar's limit)
  const chunkSize = 100
  let processed = 0
  let successful = 0
  let errors = 0

  for (let i = 0; i < fids.length; i += chunkSize) {
    const chunk = fids.slice(i, i + chunkSize)

    try {
      const neynarUsers = await getNeynarUsers(chunk)

      // Upsert users to database
      for (const neynarUser of neynarUsers) {
        try {
          const userData = neynarUserToPrismaUser(neynarUser)

          await prismaClient.user.upsert({
            where: { fid: neynarUser.fid },
            update: {
              ...userData,
              updatedAt: new Date(),
            },
            create: userData,
          })

          successful++
        } catch (error) {
          console.error(`Error upserting user ${neynarUser.fid}:`, error)
          errors++
        }
      }

      processed += chunk.length
      console.log(
        `Processed ${processed}/${fids.length} FIDs (${successful} successful, ${errors} errors)`
      )

      // Add small delay between API calls to be respectful
      if (i + chunkSize < fids.length) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    } catch (error) {
      console.error(`Error processing chunk starting at index ${i}:`, error)
      errors += chunk.length
      processed += chunk.length
    }
  }

  console.log(
    `User sync completed: ${successful} successful, ${errors} errors out of ${processed} total`
  )
  return { successful, errors, processed }
}
