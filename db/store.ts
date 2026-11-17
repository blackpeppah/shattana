import { PGlite } from '@electric-sql/pglite';
import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

type Query = <T extends Record<string, unknown> = Record<string, unknown>>(sql: string, args?: unknown[]) => Promise<T[]>;
const runtime = globalThis as typeof globalThis & { shattanaPool?: Pool; shattanaLocal?: Promise<PGlite> };

export async function transact<T>(write: boolean, work: (query: Query) => Promise<T>) {
  if (!process.env.DATABASE_URL) {
    if (process.env.VERCEL) throw new Error('DATABASE_URL is required on Vercel');
    runtime.shattanaLocal ??= (async () => {
      const db = new PGlite('.shattana-db');
      await db.exec(await readFile(join(process.cwd(), 'db/schema.sql'), 'utf8'));
      return db;
    })();
    return (await runtime.shattanaLocal).transaction(tx => work(async (sql, args) => (await tx.query(sql, args)).rows as never));
  }
  runtime.shattanaPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await runtime.shattanaPool.connect();
  try {
    await client.query('begin');
    if (write) await client.query('select pg_advisory_xact_lock(714928315)');
    const result = await work(async (sql, args) => (await client.query(sql, args)).rows as never);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
