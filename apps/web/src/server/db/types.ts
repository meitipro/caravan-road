// Minimal database interface shared by the production driver (pg) and the offline test driver
// (PGlite). Parameters use $1, $2, ... placeholders. Row values come back as the driver returns
// them; the repository layer normalises numbers.

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs several statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
  /** All statements inside fn share one transaction; throwing rolls back. */
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
