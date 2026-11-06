// near-chain.mjs: the real NEAR adapter used by scripts/setup-testnet.mjs. It is the only module that imports
// near-api-js and the only place that talks to the network. The step code (setup-steps.mjs) only sees the small
// interface below, which the tests replace with an in-memory fake.
//
// API names verified on 2026-11-05 against the installed near-api-js@7.4.0 type definitions
// (apps/web/node_modules/near-api-js/lib/*.d.ts) and these docs:
//   https://docs.near.org/tools/near-api  (JsonRpcProvider({url}), new Account(id, provider, key),
//     Account.createSubAccount / createAccount, deployContract, callFunction, getState/getBalance,
//     KeyPair.fromRandom("ed25519"), keyPair.getPublicKey().toString())
//   https://docs.near.org/protocol/storage/storage-staking  (1E19 yoctoNEAR per byte)
//   https://docs.near.org/protocol/access-keys  (function-call keys: receiver, method names, allowance)
// Details read from the package itself:
//   Account.createSubAccount({accountOrPrefix, publicKey, nearToTransfer}) sends CreateAccount + Transfer + AddKey
//     (full access) to the new account id, signed by the parent account.
//   Account.addFunctionCallAccessKey({publicKey, contractId, methodNames, allowance}), Account.deleteKey(publicKey),
//   Account.addFullAccessKey(publicKey), Account.signAndSendTransaction({receiverId, actions}) (throws on failure),
//   actions.deployContract(bytes), actions.functionCall(method, args, gas, deposit),
//   JsonRpcProvider.viewAccessKeyList({accountId}) -> {keys: [{public_key, access_key: {permission}}]},
//   permission is "FullAccess" or {FunctionCall: {allowance, receiver_id, method_names}},
//   JsonRpcProvider.callFunction({contractId, method, args}) for view calls.
//
// near-api-js is a dependency of apps/web only, so it is resolved from apps/web/package.json (pnpm does not hoist it
// to the repository root).
//
// Interface (all ids are strings; `signer` is a Secret holding a private key; amounts are bigint yoctoNEAR):
//   getAccount(id)            -> null | {total, available, storageUsage, codeHash}
//   listKeys(id)              -> [{publicKey, kind: "full"|"function-call"|"other", receiverId?, methodNames?, allowance?}]
//   createSubAccount({parentId, signer, newAccountId, publicKey, amount}) -> {txHash}
//   addFunctionCallKey({accountId, signer, publicKey, contractId, methodNames, allowance}) -> {txHash}
//   addFullAccessKey({accountId, signer, publicKey}) -> {txHash}
//   deleteKey({accountId, signer, publicKey}) -> {txHash}
//   deployAndInit({accountId, signer, code, initArgs, gas}) -> {txHash}   one transaction: DeployContract + FunctionCall(init)
//   deploy({accountId, signer, code}) -> {txHash}
//   callInit({accountId, signer, initArgs, gas}) -> {txHash}
//   view({contractId, method, args}) -> parsed JSON
// plus `generateKeyPair()` and `publicKeyOf(secret)` (crypto) and the read-only/mutating split in READ_ONLY_METHODS.

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Secret, SetupError } from "./setup-core.mjs";

export const READ_ONLY_METHODS = ["getAccount", "listKeys", "view"];
export const MUTATING_METHODS = ["createSubAccount", "addFunctionCallKey", "addFullAccessKey", "deleteKey", "deployAndInit", "deploy", "callInit"];

export const INIT_GAS = 100n * 10n ** 12n; // 100 Tgas, as in docs/DEPLOY.md

function loadNearApi(repoRoot) {
  const candidates = [join(repoRoot, "apps", "web", "package.json"), join(repoRoot, "package.json")];
  for (const anchor of candidates) {
    try { return createRequire(pathToFileURL(anchor).href)("near-api-js"); } catch { /* try the next anchor */ }
  }
  throw new SetupError("near-api-js is not installed. Run `pnpm install --frozen-lockfile` in the repository root first.", 1);
}

const isMissingAccount = (e) =>
  e?.constructor?.name === "AccountDoesNotExistError" || /does not exist|doesn't exist|UNKNOWN_ACCOUNT/i.test(String(e?.message ?? ""));

export function createCrypto(repoRoot) {
  const near = loadNearApi(repoRoot);
  return {
    generateKeyPair() {
      const kp = near.KeyPair.fromRandom("ed25519");
      return { secret: new Secret(kp.toString()), publicKey: kp.getPublicKey().toString() };
    },
    publicKeyOf(secret) { return near.KeyPair.fromString(secret.reveal()).getPublicKey().toString(); },
  };
}

/** @param {{repoRoot: string, rpcUrl: string}} cfg */
export function createNearChain({ repoRoot, rpcUrl }) {
  const near = loadNearApi(repoRoot);
  const provider = new near.JsonRpcProvider({ url: rpcUrl });
  const acct = (id, signer) => new near.Account(id, provider, signer ? signer.reveal() : undefined);
  const hashOf = (res) => res?.transaction?.hash ?? res?.transaction_outcome?.id ?? "unknown";

  return {
    async getAccount(id) {
      try {
        const s = await acct(id).getState();
        return { total: s.balance.total, available: s.balance.available, storageUsage: s.storageUsage, codeHash: s.codeHash };
      } catch (e) {
        if (isMissingAccount(e)) return null;
        throw e;
      }
    },
    async listKeys(id) {
      let res;
      try { res = await provider.viewAccessKeyList({ accountId: id }); }
      catch (e) { if (isMissingAccount(e)) return []; throw e; }
      return res.keys.map((k) => {
        const p = k.access_key.permission;
        if (p === "FullAccess") return { publicKey: k.public_key, kind: "full" };
        if (p && typeof p === "object" && p.FunctionCall) {
          const fc = p.FunctionCall;
          return {
            publicKey: k.public_key, kind: "function-call", receiverId: fc.receiver_id, methodNames: [...fc.method_names],
            allowance: fc.allowance == null ? null : BigInt(fc.allowance), // NearToken: decimal string of yoctoNEAR
          };
        }
        return { publicKey: k.public_key, kind: "other" };
      });
    },
    async createSubAccount({ parentId, signer, newAccountId, publicKey, amount }) {
      return { txHash: hashOf(await acct(parentId, signer).createSubAccount({ accountOrPrefix: newAccountId, publicKey, nearToTransfer: amount })) };
    },
    async addFunctionCallKey({ accountId, signer, publicKey, contractId, methodNames, allowance }) {
      return { txHash: hashOf(await acct(accountId, signer).addFunctionCallAccessKey({ publicKey, contractId, methodNames, allowance })) };
    },
    async addFullAccessKey({ accountId, signer, publicKey }) {
      return { txHash: hashOf(await acct(accountId, signer).addFullAccessKey(publicKey)) };
    },
    async deleteKey({ accountId, signer, publicKey }) {
      return { txHash: hashOf(await acct(accountId, signer).deleteKey(publicKey)) };
    },
    async deployAndInit({ accountId, signer, code, initArgs, gas = INIT_GAS }) {
      const a = acct(accountId, signer);
      return { txHash: hashOf(await a.signAndSendTransaction({
        receiverId: accountId,
        actions: [near.actions.deployContract(code), near.actions.functionCall("init", initArgs, gas, 0n)],
      })) };
    },
    async deploy({ accountId, signer, code }) {
      return { txHash: hashOf(await acct(accountId, signer).deployContract(code)) };
    },
    async callInit({ accountId, signer, initArgs, gas = INIT_GAS }) {
      return { txHash: hashOf(await acct(accountId, signer).signAndSendTransaction({
        receiverId: accountId, actions: [near.actions.functionCall("init", initArgs, gas, 0n)],
      })) };
    },
    async view({ contractId, method, args = {} }) {
      return provider.callFunction({ contractId, method, args });
    },
  };
}

/** Wrap a chain so that any mutating call throws. Used for every --dry-run (defence in depth). */
export function readOnlyChain(chain) {
  return new Proxy(chain, {
    get(target, prop, receiver) {
      if (MUTATING_METHODS.includes(String(prop))) {
        return async () => { throw new Error(`BUG: mutating call ${String(prop)} attempted in dry-run mode`); };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
