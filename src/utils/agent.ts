import { AutoAcceptCredential, CredentialsModule, DidsModule, InitConfig, KeyDidRegistrar, KeyDidResolver, ProofsModule, V2CredentialProtocol, V2ProofProtocol, WebDidResolver } from '@aries-framework/core'

import {
  Agent,
  ConnectionInvitationMessage,
  HttpOutboundTransport,
  LogLevel,
  JsonLdCredentialFormatService,
} from '@aries-framework/core'
import { agentDependencies, HttpInboundTransport, IndySdkPostgresStorageConfig, IndySdkPostgresWalletScheme, loadIndySdkPostgresPlugin } from '@aries-framework/node'
import path from 'path'

import { TsLogger } from './logger'
import { BCOVRIN_TEST_GENESIS } from './util'
import { AnonCredsCredentialFormatService, AnonCredsModule, LegacyIndyCredentialFormatService, LegacyIndyProofFormatService, V1CredentialProtocol, V1ProofProtocol } from '@aries-framework/anoncreds'
import { TenantsModule } from '@aries-framework/tenants'
import { randomUUID } from 'crypto'
import { AskarModule } from '@aries-framework/askar'
import { ariesAskar } from '@hyperledger/aries-askar-nodejs'
import { IndyVdrAnonCredsRegistry, IndyVdrModule, IndyVdrPoolConfig } from '@aries-framework/indy-vdr'
import { indyVdr } from '@hyperledger/indy-vdr-nodejs'
import { BbsModule } from '@aries-framework/bbs-signatures'

export const setupAgent = async ({
  name,
  publicDidSeed,
  endpoints,
  port,
}: {
  name: string
  publicDidSeed: string
  endpoints: string[]
  port: number
}) => {
  const logger = new TsLogger(LogLevel.debug)

  const storageConfig = {
    type: 'postgres_storage',
    config: {
      url: '10.100.194.194:5432',
      wallet_scheme: IndySdkPostgresWalletScheme.DatabasePerWallet,
    },
    credentials: {
      account: 'postgres',
      password: 'Password1',
      admin_account: 'postgres',
      admin_password: 'Password1',
    },
  }

  // loadIndySdkPostgresPlugin(storageConfig.config, storageConfig.credentials)

  const config: InitConfig = {
    label: name,
    endpoints: endpoints,
    walletConfig: {
      id: name,
      key: name,
      storage: storageConfig,
    },
    logger: logger,
  }

  const legacyIndyCredentialFormat = new LegacyIndyCredentialFormatService()
  const legacyIndyProofFormat = new LegacyIndyProofFormatService()
  const agent = new Agent({
    config: config,
    modules: {
      indyVdr: new IndyVdrModule({
        indyVdr,
        networks: [
          {
            isProduction: false,
            indyNamespace: 'bcovrin:test',
            genesisTransactions: BCOVRIN_TEST_GENESIS,
            connectOnStartup: true,
          },
        ]
      }),
      askar: new AskarModule({
        ariesAskar,
      }),

      anoncreds: new AnonCredsModule({
        registries: [new IndyVdrAnonCredsRegistry()],
      }),
      dids: new DidsModule({
        registrars: [new KeyDidRegistrar()],
        resolvers: [new KeyDidResolver(), new WebDidResolver()],
      }),
      proofs: new ProofsModule({
        proofProtocols: [
          new V1ProofProtocol({
            indyProofFormat: legacyIndyProofFormat,
          }),
        ],
      }),
      credentials: new CredentialsModule({
        autoAcceptCredentials: AutoAcceptCredential.ContentApproved,
        credentialProtocols: [
          new V1CredentialProtocol({
            indyCredentialFormat: legacyIndyCredentialFormat,
          }),
          new V2CredentialProtocol({
            credentialFormats:[
            legacyIndyCredentialFormat,
            new AnonCredsCredentialFormatService(),
            new JsonLdCredentialFormatService()
            ]
          })
        ],
      }),
      tenants: new TenantsModule(),
      // bbs: new BbsModule()
    },
    dependencies: agentDependencies,
  })

  const httpInbound = new HttpInboundTransport({
    port: port,
  })

  agent.registerInboundTransport(httpInbound)

  agent.registerOutboundTransport(new HttpOutboundTransport())

  httpInbound.app.get('/invitation', async (req, res) => {
    if (typeof req.query.d_m === 'string') {
      const invitation = await ConnectionInvitationMessage.fromUrl(req.url.replace('d_m=', 'c_i='))
      res.send(invitation.toJSON())
    }
    if (typeof req.query.c_i === 'string') {
      const invitation = await ConnectionInvitationMessage.fromUrl(req.url)
      res.send(invitation.toJSON())
    } else {
      const { outOfBandInvitation } = await agent.oob.createInvitation()

      res.send(outOfBandInvitation.toUrl({ domain: endpoints + '/invitation' }))
    }
  })

  await agent.initialize()

  return agent
}

