interface NeynarUserDehydrated {
  object: 'user_dehydrated'
  fid: number
  username: string
  display_name: string
  pfp_url: string
  custody_address: string
  score: number
}

interface NeynarChannel {
  id: string
  name: string
  object: 'channel_dehydrated'
  image_url: string
  viewer_context: {
    following: boolean
    role: string
  }
}

interface NeynarUser {
  object: 'user'
  fid: number
  username: string
  display_name: string
  custody_address: string
  pro: {
    status: string
    subscribed_at: string
    expires_at: string
  }
  pfp_url: string
  profile: {
    bio: {
      text: string
      mentioned_profiles: NeynarUserDehydrated[]
      mentioned_profiles_ranges: Array<{
        start: number
        end: number
      }>
      mentioned_channels: NeynarChannel[]
      mentioned_channels_ranges: Array<{
        start: number
        end: number
      }>
    }
    location: {
      latitude: number
      longitude: number
      address: {
        city: string
        state: string
        state_code: string
        country: string
        country_code: string
      }
      radius: number
    }
    banner: {
      url: string
    }
  }
  follower_count: number
  following_count: number
  verifications: string[]
  auth_addresses: Array<{
    address: string
    app: NeynarUserDehydrated
  }>
  verified_addresses: {
    eth_addresses: string[]
    sol_addresses: string[]
    primary: {
      eth_address: string
      sol_address: string
    }
  }
  verified_accounts: Array<{
    platform: string
    username: string
  }>
  power_badge: boolean
  experimental: {
    deprecation_notice: string
    neynar_user_score: number
  }
  viewer_context: {
    following: boolean
    followed_by: boolean
    blocking: boolean
    blocked_by: boolean
  }
  score: number
}

export { type NeynarUser, type NeynarUserDehydrated }

// Get users by fids (up to 100 at a time)
export async function getNeynarUsers(fids: number[]): Promise<NeynarUser[]> {
  const apiKey = process.env.NEYNAR_API_KEY
  if (!apiKey) {
    throw new Error('NEYNAR_API_KEY environment variable is required')
  }

  const url = `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fids.join(',')}`
  const options = {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-neynar-experimental': 'true',
      'x-api-key': apiKey,
    },
  }

  try {
    const response = await fetch(url, options)
    if (!response.ok) {
      throw new Error(
        `Neynar API error: ${response.status} ${response.statusText}`
      )
    }

    const data = (await response.json()) as { users: NeynarUser[] }
    return data.users || []
  } catch (error) {
    console.error('Error fetching Neynar users:', error)
    throw error
  }
}

// Get single user by fid
export async function getNeynarUser(fid: number): Promise<NeynarUser | null> {
  const users = await getNeynarUsers([fid])
  return users.length > 0 ? users[0] : null
}
