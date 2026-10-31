// In-memory DecisionStore for tests, the dry run and the evaluation. Not used by main.ts.

import type { DecisionRecord, DecisionStore } from "./types.js";

export class MemoryStore implements DecisionStore {
  readonly rows: DecisionRecord[] = [];
  heartbeats: number[] = [];

  async insertDecision(rec: DecisionRecord): Promise<void> {
    this.rows.push(rec);
  }

  async heartbeat(at: number): Promise<void> {
    this.heartbeats.push(at);
  }
}
