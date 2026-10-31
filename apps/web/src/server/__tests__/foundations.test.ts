import { createCipheriv, randomBytes, verify, createPublicKey } from "node:crypto";
import { describe, expect, it } from "vitest";
import { baseDecode } from "near-api-js";
import { EnvError, decodeEncSecret, loadEnv } from "../env";
import { ERROR_CODES, mapPanic } from "../errors";
import { redact } from "../log";
import { Custody, generateKey, playerKeyFromSeed } from "../near/custody";
import { createPgliteDb } from "../db/pglite";
import { migrate } from "../db/migrate";
import { createRepo } from "../db/repo";
import { checkMode } from "../guards/mode";
import { cronAuthorized } from "../guards/cron";
import { isSameOrigin } from "../guards/origin";
import { sanitizeName } from "../guards/auth";

const goodEnv = (): Record<string, string> => ({
  GAME_MODE: "PLAY", NEAR_NETWORK: "testnet", CARAVAN_CONTRACT_ID: "c.fake", RELAYER_ACCOUNT_ID: "r.fake",
  RELAYER_PRIVATE_KEY: "x", OPERATOR_ACCOUNT_ID: "o.fake", OPERATOR_PRIVATE_KEY: "y",
  KEY_ENC_SECRET: randomBytes(32).toString("hex"), DATABASE_URL: "postgres://fake", AUTH_SECRET: "a", CRON_SECRET: "c",
});

describe("env loader", () => {
  it("loads a complete environment", () => {
    const env = loadEnv(goodEnv());
    expect(env.GAME_MODE).toBe("PLAY");
    expect(env.KEY_ENC_SECRET).toHaveLength(32);
  });
  it("fails fast naming only the variables, never their values", () => {
    const src = goodEnv();
    delete src.DATABASE_URL;
    src.KEY_ENC_SECRET = "short-secret-value-should-not-leak";
    src.GAME_MODE = "NOPE";
    try {
      loadEnv(src);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as Error).message;
      expect(msg).toContain("DATABASE_URL");
      expect(msg).toContain("KEY_ENC_SECRET");
      expect(msg).toContain("GAME_MODE");
      expect(msg).not.toContain("short-secret-value-should-not-leak");
      expect(msg).not.toContain("NOPE");
    }
  });
  it("treats empty strings as missing and accepts hex or base64 secrets", () => {
    const src = goodEnv();
    src.CRON_SECRET = "";
    expect(() => loadEnv(src)).toThrow(/CRON_SECRET/);
    const raw = randomBytes(32);
    expect(decodeEncSecret(raw.toString("hex"))).toHaveLength(32);
    expect(decodeEncSecret(raw.toString("base64"))).toHaveLength(32);
    expect(() => decodeEncSecret("abcd")).toThrow();
  });
});

describe("error mapping", () => {
  it("maps every ErrorCode prefix (except UNAUTHENTICATED, which only the server issues)", () => {
    for (const code of ERROR_CODES) {
      const m = mapPanic(`Smart contract panicked: ${code}: something happened`);
      if (code === "UNAUTHENTICATED") expect(m.code).toBe("INTERNAL");
      else {
        expect(m.code).toBe(code);
        if (code !== "INTERNAL") expect(m.message).toBe("something happened");
      }
    }
  });
  it("recognises natural-language panics from the spec", () => {
    expect(mapPanic("warehouse full").code).toBe("BAD_REQUEST");
    expect(mapPanic("the game is paused").code).toBe("PAUSED");
  });
  it("hides unknown panic text behind INTERNAL", () => {
    const m = mapPanic("wasm trap: secret internals 0xdeadbeef");
    expect(m.code).toBe("INTERNAL");
    expect(m.message).not.toContain("deadbeef");
  });
});

describe("log redaction", () => {
  it("removes keys, bearer tokens, e-mails and account ids", () => {
    const out = redact(
      `key ed25519:${"A".repeat(44)} Bearer abc.def.ghi mail me@example.org acct p1a2b3c4d.relayer.testnet bob.near`,
    );
    expect(out).not.toMatch(/AAAAAAAA|ed25519:3ty|abc\.def|example\.org|p1a2b3c4d|bob\.near/);
    expect(out).toContain("[key]");
    expect(out).toContain("[account]");
  });
});

describe("custody (AES-256-GCM with a test-only key)", () => {
  const secret = new Uint8Array(randomBytes(32));
  const custody = Custody.fromSecret(secret);

  it("round-trips a seed and signs verifiably", async () => {
    const k = generateKey();
    const seedCopy = new Uint8Array(k.seed);
    const enc = custody.encrypt("user-1", k.seed);
    expect(enc.key_version).toBe(1);
    expect(Buffer.from(enc.nonce, "base64")).toHaveLength(12);
    expect(enc.enc_private_key).not.toContain(Buffer.from(seedCopy).toString("base64"));
    expect(custody.decrypt("user-1", enc)).toEqual(seedCopy);

    const msg = new Uint8Array([1, 2, 3, 4]);
    const sig = await custody.withKey("user-1", k.publicKey, enc, async (key) => key.sign(msg));
    const raw = Buffer.from(baseDecode(k.publicKey.replace("ed25519:", "")));
    const pub = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
    expect(verify(null, Buffer.from(msg), pub, Buffer.from(sig))).toBe(true);
  });

  it("uses a fresh nonce for each encryption", () => {
    const seed = generateKey().seed;
    expect(custody.encrypt("u", seed).nonce).not.toBe(custody.encrypt("u", seed).nonce);
  });

  it("rejects tampering, another user's record and a wrong secret", () => {
    const k = generateKey();
    const enc = custody.encrypt("user-1", k.seed);
    const flipped = Buffer.from(enc.enc_private_key, "base64");
    flipped[0] = flipped[0]! ^ 1;
    expect(() => custody.decrypt("user-1", { ...enc, enc_private_key: flipped.toString("base64") })).toThrow();
    expect(() => custody.decrypt("user-2", enc)).toThrow();
    expect(() => Custody.fromSecret(new Uint8Array(randomBytes(32))).decrypt("user-1", enc)).toThrow();
  });

  it("zeroes the decrypted seed after withKey, even when the callback throws", async () => {
    const k = generateKey();
    const enc = custody.encrypt("u", k.seed);
    let captured: Uint8Array | null = null;
    const spy = Object.create(custody) as Custody;
    spy.decrypt = (u, row) => {
      captured = custody.decrypt(u, row);
      return captured;
    };
    await expect(spy.withKey("u", k.publicKey, enc, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(captured).not.toBeNull();
    expect([...(captured as unknown as Uint8Array)].every((b) => b === 0)).toBe(true);
  });

  it("requires a 32-byte secret", () => {
    expect(() => Custody.fromSecret(new Uint8Array(16))).toThrow();
  });

  it("builds a signer that matches the generated public key format", () => {
    const k = generateKey();
    expect(k.publicKey).toMatch(/^ed25519:[1-9A-HJ-NP-Za-km-z]+$/);
    expect(playerKeyFromSeed(k.seed, k.publicKey).publicKey).toBe(k.publicKey);
    // sanity: AES-GCM primitive itself is available in this runtime
    expect(createCipheriv("aes-256-gcm", Buffer.alloc(32), Buffer.alloc(12))).toBeTruthy();
  });
});

describe("database and repository (PGlite)", () => {
  it("migrates once and creates every table of plan 6.4", async () => {
    const db = await createPgliteDb();
    expect((await migrate(db)).length).toBe(1);
    expect(await migrate(db)).toEqual([]);
    const tables = (await db.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public'")).map((r) => r.table_name);
    for (const t of ["users", "custody_keys", "actions", "deposits", "withdrawals", "npc_decisions", "worker_heartbeat", "rate_limits", "flags"]) {
      expect(tables).toContain(t);
    }
    expect(await createRepo(db).getFlag("PAUSE_ALL")).toBe("false");
    await db.close();
  });

  it("claims an account id once and keeps the first key", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const repo = createRepo(db);
    const u = await repo.upsertUser({ id: "u1", provider: "t", subject: "s", email: null, name: "N", now: 1 });
    const again = await repo.upsertUser({ id: "u-other", provider: "t", subject: "s", email: null, name: "N", now: 2 });
    expect(again.id).toBe(u.id);
    const key = { public_key: "ed25519:A", enc_private_key: "e", nonce: "n", key_version: 1 };
    const a = await repo.claimAccount(u.id, "pa.root", key);
    const b = await repo.claimAccount(u.id, "pb.root", { ...key, public_key: "ed25519:B" });
    expect(a.near_account_id).toBe("pa.root");
    expect(b.near_account_id).toBe("pa.root");
    expect((await repo.getCustody(u.id))?.public_key).toBe("ed25519:A");
    await db.close();
  });

  it("counts rate-limit hits per window atomically", async () => {
    const db = await createPgliteDb();
    await migrate(db);
    const repo = createRepo(db);
    expect(await Promise.all([repo.hit("k", 100), repo.hit("k", 100), repo.hit("k", 100)]).then((r) => r.sort())).toEqual([1, 2, 3]);
    expect(await repo.hit("k", 160)).toBe(1);
    await db.close();
  });
});

describe("guards", () => {
  it("mode gating", () => {
    expect(() => checkMode("PLAY", "LIVE_ONLY")).toThrow(/LIVE/);
    expect(() => checkMode("LIVE", "PLAY_ONLY")).toThrow(/PLAY/);
    expect(() => checkMode("LIVE", "LIVE_ONLY")).not.toThrow();
    expect(() => checkMode("PLAY", "ANY")).not.toThrow();
  });
  it("cron bearer check rejects missing, wrong and unconfigured secrets", () => {
    const r = (h?: string) => new Request("http://x/api/cron/tick", { headers: h ? { authorization: h } : {} });
    expect(cronAuthorized(r(), "s3cret")).toBe(false);
    expect(cronAuthorized(r("Bearer nope"), "s3cret")).toBe(false);
    expect(cronAuthorized(r("Basic s3cret"), "s3cret")).toBe(false);
    expect(cronAuthorized(r("Bearer s3cret"), null)).toBe(false);
    expect(cronAuthorized(r("Bearer s3cret"), "s3cret")).toBe(true);
  });
  it("same-origin check", () => {
    const mk = (origin?: string) => new Request("http://game.example/api/trade", { method: "POST", headers: { host: "game.example", ...(origin ? { origin } : {}) } });
    expect(isSameOrigin(mk())).toBe(true);
    expect(isSameOrigin(mk("http://game.example"))).toBe(true);
    expect(isSameOrigin(mk("https://evil.example"))).toBe(false);
    expect(isSameOrigin(mk("not a url"))).toBe(false);
  });
  it("sanitises display names", () => {
    expect(sanitizeName("  <b>Ali\u0000   Baba</b>  ", "x")).toBe("bAli Baba/b");
    expect(sanitizeName("x".repeat(100), "x")).toHaveLength(24);
    expect(sanitizeName("", "subject")).toMatch(/^Caravaneer-[0-9a-f]{4}$/);
  });
});
