-- CreateTable
CREATE TABLE "casts" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "hash" TEXT NOT NULL,
    "fid" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "mentions" INTEGER[],
    "mentionsPositions" INTEGER[],
    "timestamp" TIMESTAMP(3) NOT NULL,
    "messageType" TEXT NOT NULL,
    "parentCastFid" INTEGER,
    "parentCastHash" TEXT,
    "embeds" JSONB,
    "processedBy" TEXT,
    "isReply" BOOLEAN NOT NULL DEFAULT false,
    "isQuoteCast" BOOLEAN NOT NULL DEFAULT false,
    "isMention" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "casts_pkey" PRIMARY KEY ("hash")
);

-- CreateIndex
CREATE INDEX "casts_fid_idx" ON "casts"("fid");

-- CreateIndex
CREATE INDEX "casts_timestamp_idx" ON "casts"("timestamp");

-- CreateIndex
CREATE INDEX "casts_parentCastFid_parentCastHash_idx" ON "casts"("parentCastFid", "parentCastHash");

-- AddForeignKey
ALTER TABLE "casts" ADD CONSTRAINT "casts_fid_fkey" FOREIGN KEY ("fid") REFERENCES "users"("fid") ON DELETE RESTRICT ON UPDATE CASCADE;
