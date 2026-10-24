// Makes the signing key pair. The private key goes into the Worker as a
// secret (LICENSE_PRIVATE_KEY); the public key goes into the app
// (src/main/license.ts, PUBLIC_KEY). Run once: node make-keypair.mjs
import { generateKeyPairSync } from 'node:crypto'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
console.log('LICENSE_PRIVATE_KEY (keep secret, put in the Worker):')
console.log(privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'))
console.log('\nPUBLIC_KEY (put in the app):')
console.log(publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
