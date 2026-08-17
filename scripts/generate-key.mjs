#!/usr/bin/env node
/**
 * Generates the signing key that pins an unpacked extension to a stable extension ID.
 *
 * Why this is needed: a Google OAuth client of type "Chrome Extension" is bound to
 * one specific extension ID. Chrome derives an unpacked extension's ID from its
 * install path, so it changes between machines and after a re-install, which would
 * break sign-in every time. Embedding a public key in the manifest fixes the ID.
 *
 * Usage:  npm run keygen
 *
 * Writes key.pem (git-ignored, never commit it) and prints the two values you need:
 * the extension ID for the Google Cloud console, and the base64 public key for .env.
 */

import { generateKeyPairSync, createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const KEY_PATH = resolve(process.cwd(), 'key.pem');

if (existsSync(KEY_PATH) && !process.argv.includes('--force')) {
  console.error(
    `key.pem already exists at ${KEY_PATH}.\n` +
      'Re-running would change your extension ID and break the OAuth client bound to it.\n' +
      'Pass --force if you really want a new key.',
  );
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(KEY_PATH, privateKey, { mode: 0o600 });

const base64Key = publicKey.toString('base64');

/*
 * Chrome's extension ID is the first 16 bytes of the SHA-256 of the DER public key,
 * with each nibble mapped onto 'a' through 'p' instead of '0' through 'f'.
 */
const digest = createHash('sha256').update(publicKey).digest();
const extensionId = [...digest.subarray(0, 16)]
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('')
  .split('')
  .map((nibble) => String.fromCharCode(97 + parseInt(nibble, 16)))
  .join('');

console.log(`
Wrote key.pem (keep it private; it is git-ignored).

  Extension ID   ${extensionId}

Add this line to your .env:

  SNAPDOCK_EXTENSION_KEY=${base64Key}

Then create an OAuth client in Google Cloud with:

  Application type   Chrome Extension
  Item ID            ${extensionId}

and put its client ID in SNAPDOCK_GOOGLE_CLIENT_ID. See docs/GOOGLE_OAUTH_SETUP.md.
`);
