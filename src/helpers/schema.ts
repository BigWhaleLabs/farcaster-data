import 'reflect-metadata'

import UserResolver from 'resolvers/UserResolver.js'
import { buildSchema } from 'type-graphql'

const schema = await buildSchema({
  resolvers: [UserResolver],
  validate: true,
})

export default schema
