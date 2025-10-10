-- CreateTable
CREATE TABLE "users" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fid" INTEGER NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "custodyAddress" TEXT,
    "pfpUrl" TEXT,
    "bioText" TEXT,
    "locationCity" TEXT,
    "locationState" TEXT,
    "locationStateCode" TEXT,
    "locationCountry" TEXT,
    "locationCountryCode" TEXT,
    "bannerUrl" TEXT,
    "followerCount" INTEGER,
    "followingCount" INTEGER,
    "score" DOUBLE PRECISION,
    "neynarUserScore" DOUBLE PRECISION,
    "powerBadge" BOOLEAN NOT NULL DEFAULT false,
    "verifications" TEXT[],
    "ethAddresses" TEXT[],
    "solAddresses" TEXT[],
    "primaryEthAddress" TEXT,
    "primarySolAddress" TEXT,
    "verifiedAccounts" JSONB,
    "proStatus" TEXT,
    "proSubscribedAt" TIMESTAMP(3),
    "proExpiresAt" TIMESTAMP(3),
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncSource" TEXT NOT NULL DEFAULT 'neynar',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("fid")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_fid_key" ON "users"("fid");
