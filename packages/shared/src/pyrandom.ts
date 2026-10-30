// Bit-exact port of the parts of CPython's `random` module the reference simulation uses
// (seed(int), random(), choice()), so the TypeScript sim reproduces scripts/ref/economy_sim.py.
// MT19937, init_by_array seeding, genrand_res53 for random(), rejection sampling for choice().

const N = 624;
const M = 397;

export class PyRandom {
  private mt = new Uint32Array(N);
  private idx = N + 1;

  constructor(seed: number) {
    this.seed(seed);
  }

  seed(seed: number): void {
    if (!Number.isInteger(seed)) throw new RangeError("seed must be an integer");
    let n = BigInt(Math.abs(seed));
    const key: number[] = [];
    do {
      key.push(Number(n & 0xffffffffn));
      n >>= 32n;
    } while (n > 0n);
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]!;
      mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.idx = N;
  }

  private initByArray(key: number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = ((mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = ((mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private genrandUint32(): number {
    const mt = this.mt;
    if (this.idx >= N) {
      let kk = 0;
      for (; kk < N - M; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + M]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      for (; kk < N - 1; kk++) {
        const y = (mt[kk]! & 0x80000000) | (mt[kk + 1]! & 0x7fffffff);
        mt[kk] = mt[kk + (M - N)]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      const y = (mt[N - 1]! & 0x80000000) | (mt[0]! & 0x7fffffff);
      mt[N - 1] = mt[M - 1]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      this.idx = 0;
    }
    let y = mt[this.idx++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random(): float in [0, 1) with 53 bits. */
  random(): number {
    const a = this.genrandUint32() >>> 5;
    const b = this.genrandUint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** random.getrandbits(k) for 1 <= k <= 32. */
  getrandbits(k: number): number {
    if (k < 1 || k > 32) throw new RangeError("k must be in 1..32");
    return this.genrandUint32() >>> (32 - k);
  }

  /** random._randbelow(n) (rejection sampling), as used by random.choice(). */
  randbelow(n: number): number {
    if (n <= 0 || n > 0xffffffff) throw new RangeError("n out of range");
    const k = n.toString(2).length; // int.bit_length()
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  choice<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError("cannot choose from an empty sequence");
    return items[this.randbelow(items.length)]!;
  }
}
