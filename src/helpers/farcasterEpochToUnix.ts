// Convert Farcaster epoch timestamp to Unix timestamp
export default function farcasterEpochToUnix(
  farcasterTimestamp: number
): number {
  // Farcaster epoch started on January 1, 2021 00:00:00 UTC
  const FARCASTER_EPOCH_START = 1609459200000 // January 1, 2021 in Unix milliseconds
  return FARCASTER_EPOCH_START + farcasterTimestamp * 1000
}
