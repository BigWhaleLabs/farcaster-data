# Farcaster Data Service

A Bun-based TypeScript service that synchronizes Farcaster user data and provides a GraphQL API for querying user information.

## Features

- 📅 **Daily Sync**: Automatically fetches all user FIDs from Farcaster Hub and updates user data from Neynar
- 🔍 **Smart Fetching**: GraphQL queries with fallback to hub+Neynar if user not found in database
- 🎧 **Real-time Cast Storage**: Listens to Farcaster Hub and saves all casts to database in real-time
- 🚀 **High Performance**: Built with Bun for fast startup and execution with parallel processing
- 📊 **Rich Data**: Stores comprehensive user profiles and cast data including replies, mentions, and quotes
- 🎯 **Type Safe**: Full TypeScript support with Prisma and TypeGraphQL## Stack

- **Runtime**: Bun
- **Language**: TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **API**: GraphQL with GraphQL Yoga and TypeGraphQL
- **Data Sources**: Farcaster Hub, Neynar API
- **Scheduling**: node-cron for daily sync jobs

## Setup

1. **Install dependencies**:

   ```bash
   bun install
   ```

2. **Configure environment**:

   ```bash
   cp .env.sample .env
   # Edit .env with your database URL and Neynar API key
   ```

3. **Set up database**:

   ```bash
   # Generate Prisma client
   bun prisma generate

   # Create and apply migration
   bun prisma migrate dev --name init
   ```

4. **Test the setup**:

   ```bash
   # Test fetching a specific user (e.g., FID 1)
   bun cli test-user 1

   # Check database stats
   bun cli stats
   ```

5. **Start the server**:
   ```bash
   bun start
   ```

## CLI Tools

The project includes helpful CLI commands:

- `bun cli sync` - Run manual user sync from hub + Neynar
- `bun cli test-user <fid>` - Test fetching a specific user
- `bun cli stats` - Show database statistics

## Environment Variables

- `POSTGRES` - PostgreSQL connection string
- `NEYNAR_API_KEY` - Your Neynar API key
- `FARCASTER_HUB_URL` - Farcaster Hub RPC URL (optional, defaults to public hub)
- `PORT` - Server port (default: 4000)
- `NODE_ENV` - Environment mode (development/production)

## GraphQL Queries

### Get User by FID

```graphql
query GetUser($fid: Float!) {
  getUserByFid(fid: $fid) {
    fid
    username
    displayName
    pfpUrl
    followerCount
    followingCount
    powerBadge
    verifications
    # ... other fields
  }
}
```

### Get User Count

```graphql
query {
  getUserCount
}
```

### Get Recent Users

```graphql
query GetRecentUsers($limit: Float) {
  getRecentUsers(limit: $limit) {
    fid
    username
    displayName
    lastSynced
  }
}
```

### Get Power Badge Users

```graphql
query GetPowerBadgeUsers($limit: Float) {
  getUsersByPowerBadge(hasPowerBadge: true, limit: $limit) {
    fid
    username
    displayName
    followerCount
    powerBadge
  }
}
```

## Cast Queries

### Get Cast by Hash

```graphql
query GetCast($hash: String!) {
  getCastByHash(hash: $hash) {
    hash
    fid
    parentHash
    parentFid
    text
    mentions
    embeds
    timestamp
    user {
      fid
      username
      displayName
      pfpUrl
    }
  }
}
```

### Get Recent Casts

```graphql
query GetRecentCasts($limit: Float) {
  getRecentCasts(limit: $limit) {
    hash
    fid
    text
    timestamp
    user {
      username
      displayName
      pfpUrl
    }
  }
}
```

### Get Casts by User

```graphql
query GetCastsByUser($fid: Float!, $limit: Float) {
  getCastsByFid(fid: $fid, limit: $limit) {
    hash
    text
    mentions
    embeds
    timestamp
    parentHash
  }
}
```

### Get Cast Replies

```graphql
query GetCastReplies($parentHash: String!, $limit: Float) {
  getCastReplies(parentHash: $parentHash, limit: $limit) {
    hash
    fid
    text
    timestamp
    user {
      username
      displayName
    }
  }
}
```

### Get Casts by Mention

```graphql
query GetCastsByMention($fid: Float!, $limit: Float) {
  getCastsByMention(fid: $fid, limit: $limit) {
    hash
    fid
    text
    mentions
    timestamp
    user {
      username
      displayName
    }
  }
}
```

## API Behavior

- **Database First**: Queries check local database first for fast responses
- **Smart Fallback**: If user not found locally, fetches from Farcaster Hub, then Neynar
- **Automatic Caching**: New users are automatically stored in database
- **Daily Updates**: All users refreshed once per day via cron job

## Development

- **Start dev server**: `bun dev` (with file watching)
- **Run linting**: `bun lint`
- **Type check**: `bun build-ts`

## Production

In production mode, the daily sync job runs automatically at 2:00 AM. In development mode, you can manually trigger syncs using the helper functions.

## Database Schema

### User Model

- Farcaster identity (fid, username, custody address)
- Profile data (bio, location, banner, pfp)
- Social metrics (follower/following counts, score)
- Verifications (eth/sol addresses, other platforms)
- Pro subscription status
- Sync metadata (last sync time, source)

### Cast Model

- Unique hash identifier and Farcaster ID (fid)
- Text content with mentions array and embeds JSON
- Parent/reply tracking (parentHash, parentFid)
- Timestamp and user relation
- Real-time ingestion from Farcaster Hub

Built following patterns from the sendusdc-backend project.
