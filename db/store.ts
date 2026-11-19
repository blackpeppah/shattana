import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
const runtime = globalThis as typeof globalThis & {
  shattanaPool?: Pool;
  shattanaLocal?: Promise<PGlite>;
  shattanaSchema?: { sql: string; ready: Promise<void> };
};

async function localDatabase() {
  runtime.shattanaLocal ??= PGlite.create('.shattana-db');
  const db = await runtime.shattanaLocal;
  if (!runtime.shattanaSchema || process.env.NODE_ENV === 'development') {
    const sql = await readFile(join(process.cwd(), 'db/schema.sql'), 'utf8');
    const previous = runtime.shattanaSchema;
    if (previous?.sql !== sql) {
      const ready = (previous?.ready.catch(() => undefined) ?? Promise.resolve())
        .then(() => db.transaction(async tx => { await tx.exec(sql); }))
        .catch(error => {
          if (runtime.shattanaSchema?.ready === ready) delete runtime.shattanaSchema;
          throw error;
        });
      runtime.shattanaSchema = { sql, ready };
    }
  }
  await runtime.shattanaSchema?.ready;
  return db;
}

export async function transact<T>(write: boolean, work: (query: Query) => Promise<T>) {
  if (!process.env.DATABASE_URL) {
    if (process.env.VERCEL) throw new Error('DATABASE_URL is required on Vercel');
    return (await localDatabase()).transaction(tx => work(async (sql, args) => (await tx.query(sql, args)).rows as never));
  }
  runtime.shattanaPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
  const client = await runtime.shattanaPool.connect();
  let discard = false;
  try {
    await client.query(write ? 'begin' : 'begin isolation level repeatable read read only');
    await client.query("set local statement_timeout = '5s'");
    if (write) await client.query('select pg_advisory_xact_lock(714928315)');
    const result = await work(async (sql, args) => (await client.query(sql, args)).rows as never);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
