import { getInsecureHubRpcClient } from '@farcaster/hub-nodejs'
import env from 'helpers/env'

const hubClient = getInsecureHubRpcClient(env.FARCASTER_HUB_URL)

export default hubClient
