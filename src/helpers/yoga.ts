import { createYoga, type YogaInitialContext } from 'graphql-yoga'
import prismaClient from 'helpers/prismaClient.js'
import schema from 'helpers/schema'

const yoga = createYoga({
  batching: true,
  context: async ({ request }: YogaInitialContext) => {
    return { prisma: prismaClient }
  },
  graphqlEndpoint: '/',
  landingPage: false,
  schema,
})

export default yoga
