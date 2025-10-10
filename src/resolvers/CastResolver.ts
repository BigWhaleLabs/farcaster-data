import { Cast } from '@generated/type-graphql'
import type Context from 'models/Context'
import 'reflect-metadata'
import { Arg, Ctx, Int, Query, Resolver } from 'type-graphql'

@Resolver()
export default class CastResolver {
  @Query(() => Cast, { nullable: true })
  async getCastByHash(
    @Ctx() { prisma }: Context,
    @Arg('hash') hash: string
  ): Promise<Cast | null> {
    return prisma.cast.findUnique({
      where: { hash },
      include: { author: true },
    })
  }

  @Query(() => [Cast])
  async getCastsByFid(
    @Ctx() { prisma }: Context,
    @Arg('fid', () => Int) fid: number,
    @Arg('limit', () => Int, { defaultValue: 20 }) limit: number
  ): Promise<Cast[]> {
    return prisma.cast.findMany({
      where: { fid },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100),
      include: { author: true },
    })
  }

  @Query(() => [Cast])
  async getRecentCasts(
    @Ctx() { prisma }: Context,
    @Arg('limit', () => Int, { defaultValue: 50 }) limit: number
  ): Promise<Cast[]> {
    return prisma.cast.findMany({
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100),
      include: { author: true },
    })
  }

  @Query(() => [Cast])
  async getCastReplies(
    @Ctx() { prisma }: Context,
    @Arg('parentCastHash') parentCastHash: string,
    @Arg('limit', () => Int, { defaultValue: 20 }) limit: number
  ): Promise<Cast[]> {
    return prisma.cast.findMany({
      where: {
        parentCastHash,
        isReply: true,
      },
      orderBy: { timestamp: 'asc' },
      take: Math.min(limit, 100),
      include: { author: true },
    })
  }

  @Query(() => [Cast])
  async getCastsByMention(
    @Ctx() { prisma }: Context,
    @Arg('mentionedFid', () => Int) mentionedFid: number,
    @Arg('limit', () => Int, { defaultValue: 20 }) limit: number
  ): Promise<Cast[]> {
    return prisma.cast.findMany({
      where: {
        mentions: {
          has: mentionedFid,
        },
        isMention: true,
      },
      orderBy: { timestamp: 'desc' },
      take: Math.min(limit, 100),
      include: { author: true },
    })
  }

  @Query(() => Int)
  async getCastCount(@Ctx() { prisma }: Context): Promise<number> {
    return prisma.cast.count()
  }

  @Query(() => Int)
  async getCastCountByFid(
    @Ctx() { prisma }: Context,
    @Arg('fid', () => Int) fid: number
  ): Promise<number> {
    return prisma.cast.count({
      where: { fid },
    })
  }
}
