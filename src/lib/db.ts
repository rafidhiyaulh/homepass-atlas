import 'server-only'
import postgres from 'postgres'

// One small pool per server instance, through Supabase's transaction pooler (so no prepared statements).
// The login role `atlas_app` owns nothing: every query runs inside a transaction that first switches to
// `atlas_user` (row-level security on the verified JWT claims) or `atlas_worker` (queue functions only).
const globalForSql = globalThis as unknown as { atlasSql?: postgres.Sql }
export const sql =
  globalForSql.atlasSql ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false,
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
    types: { bigint: postgres.BigInt },
    transform: { value: { from: (v: unknown) => (typeof v === 'bigint' ? Number(v) : v) } },
  })
if (process.env.NODE_ENV !== 'production') globalForSql.atlasSql = sql

export type Tx = postgres.TransactionSql
export type Claims = { sub: string; email?: string }

export function asUser<T>(claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    const jwt = JSON.stringify({ sub: claims.sub, email: claims.email ?? null, role: 'authenticated' })
    await tx`select set_config('request.jwt.claims', ${jwt}, true), set_config('search_path', 'atlas, extensions, public', true)`
    await tx`set local role atlas_user`
    return fn(tx)
  }) as Promise<T>
}

export function asWorker<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql.begin(async tx => {
    await tx`select set_config('search_path', 'atlas, extensions, public', true)`
    await tx`set local role atlas_worker`
    return fn(tx)
  }) as Promise<T>
}
