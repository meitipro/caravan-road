# Spec changelog

## spec-v1.1 (2026-10-31)

Adopted from the contract implementation (`contracts/caravan/DECISIONS.md`, independently audited) to resolve OPEN_QUESTIONS #6, #8, #11, #12 and #4:

- **Ambush loss (#6):** each cargo good loses `floor(30% x qty)` (section 2.4 text). Appendix B's `q * 7000 // 10000` (ceil loss) is superseded for the contract; the TypeScript sim `packages/shared/src/sim.ts` still reproduces Appendix B exactly and is a reference, not the contract.
- **World tick order (#11):** production/consumption, rebalancing, recycling, then merchant-driven `ship` (section 2.8 text).
- **House-caravan gap test (#12):** integer test `(hi - lo) x 10000 >= 5000 x target`.
- **Stall fee (#8):** paid by the seller (plan 5.3), 2% rounded up, minimum 1 fils; `limit_total` bounds the price.
- **Faucet (#4):** allowed when net worth is under 5,000 fils, 1 hour cooldown (the shared mock uses 60 s for demos).
- **Section 2.9 numbers with the contract rules** (reference sim re-run, seed 7, 240 ticks): 2 bots 61 trips / median 6,714 fils / 26 broke; 5 bots 132 / 933 / 44; 10 bots 344 / 958 / 74; money conserved in all. The Appendix B figures (64/5,944/23, 177/1,088/43, 342/1,099/86) remain what `pnpm sim` prints.
- **Added safety rules (audit):** minimum withdrawal 1,000 fils and one open withdrawal per player; `set_policy` moves spread/bias at most 300 bp per change, once per tick; merchant `ship` only to a destination below target stock, paying at most 25% of its treasury per tick; only the owner can unpause.
