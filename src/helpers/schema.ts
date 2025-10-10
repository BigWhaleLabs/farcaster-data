import 'reflect-metadata'
import CastResolver from 'resolvers/CastResolver.js'
import UserResolver from 'resolvers/UserResolver.js'
import { buildSchema } from 'type-graphql'

const schema = await buildSchema({
  resolvers: [UserResolver, CastResolver],
  validate: true,
})

export default schema
