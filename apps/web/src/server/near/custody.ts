// Custodial key handling: ed25519 key generation and AES-256-GCM encryption at rest.
//
// - The 32-byte ed25519 seed is encrypted with KEY_ENC_SECRET (32 bytes), a fresh random 12-byte
//   nonce per key, and AAD = "<user_id>:<key_version>" so a ciphertext cannot be moved to another user.
// - Decrypted seeds live in a Uint8Array that withKey() zeroes after use. (A KeyObject made from the
//   seed is handed to OpenSSL and cannot be wiped from JS; this is best effort and documented in
//   docs/SERVER.md.)
// - Nothing here logs or returns key material except encrypt()/generate() results to the caller.

import { createCipheriv, createDecipheriv, createPrivateKey, generateKeyPairSync, randomBytes, sign as edSign } from "node:crypto";
import { baseEncode } from "near-api-js";
import type { PlayerKey } from "../contract/types";

export const KEY_VERSION = 1;
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface EncryptedKey {
  enc_private_key: string; // base64(ciphertext || 16-byte tag)
  nonce: string; // base64(12 bytes)
  key_version: number;
}

export interface GeneratedKey {
  publicKey: string; // "ed25519:<base58>"
  seed: Uint8Array; // 32 bytes; caller must encrypt and zero it
}

export function publicKeyString(rawPublicKey: Uint8Array): string {
  return `ed25519:${baseEncode(rawPublicKey)}`;
}

export function generateKey(): GeneratedKey {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = privateKey.export({ format: "jwk" });
  const pubJwk = publicKey.export({ format: "jwk" });
  const seed = new Uint8Array(Buffer.from(jwk.d as string, "base64url"));
  const pub = Buffer.from(pubJwk.x as string, "base64url");
  return { publicKey: publicKeyString(pub), seed };
}

export function playerKeyFromSeed(seed: Uint8Array, publicKey: string): PlayerKey {
  const der = Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]);
  const keyObject = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  der.fill(0);
  return { publicKey, sign: (message) => new Uint8Array(edSign(null, Buffer.from(message), keyObject)) };
}

export class Custody {
  constructor(
    private readonly secrets: ReadonlyMap<number, Uint8Array>,
    private readonly current: number = KEY_VERSION,
  ) {
    for (const [v, s] of secrets) if (s.length !== 32) throw new Error(`encryption secret v${v} must be 32 bytes`);
    if (!secrets.has(current)) throw new Error("no encryption secret for the current key version");
  }

  static fromSecret(secret: Uint8Array): Custody {
    return new Custody(new Map([[KEY_VERSION, secret]]));
  }

  private secretFor(version: number): Buffer {
    const s = this.secrets.get(version);
    if (!s) throw new Error(`no encryption secret for key version ${version}`);
    return Buffer.from(s);
  }

  encrypt(userId: string, seed: Uint8Array): EncryptedKey {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.secretFor(this.current), nonce);
    cipher.setAAD(Buffer.from(`${userId}:${this.current}`));
    const ct = Buffer.concat([cipher.update(Buffer.from(seed)), cipher.final(), cipher.getAuthTag()]);
    return { enc_private_key: ct.toString("base64"), nonce: nonce.toString("base64"), key_version: this.current };
  }

  decrypt(userId: string, row: EncryptedKey): Uint8Array {
    const raw = Buffer.from(row.enc_private_key, "base64");
    if (raw.length < 17) throw new Error("corrupt custody record");
    const decipher = createDecipheriv("aes-256-gcm", this.secretFor(row.key_version), Buffer.from(row.nonce, "base64"));
    decipher.setAAD(Buffer.from(`${userId}:${row.key_version}`));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    const pt = Buffer.concat([decipher.update(raw.subarray(0, raw.length - 16)), decipher.final()]);
    const out = new Uint8Array(pt);
    pt.fill(0);
    return out;
  }

  /** Decrypts, builds a signer, runs fn, and zeroes the seed in every case. */
  async withKey<T>(userId: string, publicKey: string, row: EncryptedKey, fn: (key: PlayerKey) => Promise<T>): Promise<T> {
    const seed = this.decrypt(userId, row);
    try {
      return await fn(playerKeyFromSeed(seed, publicKey));
    } finally {
      seed.fill(0);
    }
  }
}
