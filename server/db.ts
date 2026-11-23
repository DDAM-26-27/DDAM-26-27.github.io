import postgres from 'postgres';

export type Sql = postgres.Sql;
export type Tx = postgres.TransactionSql;
/** Either a pool or a transaction. */
export type Db = Sql | Tx;

export function createSql(url: string, opts: { max?: number } = {}): Sql {
  return postgres(url, {
    max: opts.max ?? 5,
    // Required for Supabase's transaction pooler (pgbouncer-style, port 6543).
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: {
      // Keep DATE as 'YYYY-MM-DD' strings to avoid time-zone shifts.
      date: { to: 1082, from: [1082], serialize: (x: string) => x, parse: (x: string) => x },
    },
  });
}
