import { UserDataType } from '@farcaster/hub-nodejs'
import { User } from '@generated/type-graphql'
import hubClient from 'helpers/hubClient'
import { getNeynarUser } from 'helpers/neynarClient'
import { neynarUserToPrismaUser } from 'helpers/userSync'
import type Context from 'models/Context'
import { Arg, Ctx, Query, Resolver } from 'type-graphql'

@Resolver()
export default class UserResolver {
  @Query(() => User, { nullable: true })
  async getUserByFid(
    @Ctx() { prisma }: Context,
    @Arg('fid') fid: number
  ): Promise<User | null> {
    // First, try to get user from database
    let user = await prisma.user.findUnique({
      where: { fid },
    })

    if (user) {
      return user
    }

    // If not found in database, try to fetch from Farcaster Hub first
    try {
      // Check if user exists by trying to get their username
      const hubResult = await hubClient.getUserData({
        fid,
        userDataType: UserDataType.USERNAME,
      })

      if (hubResult.isErr()) {
        console.log(`User ${fid} not found in Farcaster hub`)
        return null
      }

      // User exists in hub, now get detailed data from Neynar
      const neynarUser = await getNeynarUser(fid)

      if (!neynarUser) {
        console.log(`User ${fid} found in hub but not in Neynar`)
        return null
      }

      // Save user to database and return
      const userData = neynarUserToPrismaUser(neynarUser)

      user = await prisma.user.create({
        data: userData,
      })

      console.log(`Created new user ${fid} from Neynar data`)
      return user
    } catch (error) {
      console.error(`Error fetching user ${fid} from external sources:`, error)
      return null
    }
  }

  @Query(() => Number)
  async getUserCount(@Ctx() { prisma }: Context): Promise<number> {
    return prisma.user.count()
  }
}
