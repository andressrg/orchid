import { mkdtemp, mkdir, writeFile, copyFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../scripts/migrate';

// Dedicated scratch DB — never `orchid_test` (the shared suite DB) and never prod.
const SCRATCH_DB = 'orchid_migtest';
const ADMIN_URL = 'postgresql://orchid:orchid@localhost:5432/orchid';
const SCRATCH_URL = `postgresql://orchid:orchid@localhost:5432/${SCRATCH_DB}`;

// Same key the migrator uses, so a second client's `pg_advisory_lock` genuinely
// contends with the migrator's `pg_try_advisory_lock` (orphaned-lock simulation).
const ADVISORY_LOCK_KEY = 7264193055;
// The migrator's lock budget is shortened to ~3s for the lock-contention tests via
// MIGRATE_LOCK_BUDGET_MS in vitest.config — see the env block there. Asserting it
// here keeps the test honest if that ever drifts.
const SHORT_LOCK_BUDGET_MS = Number(process.env.MIGRATE_LOCK_BUDGET_MS ?? 3_000);

// Open a session that holds the advisory lock until released, simulating a build
// that died (or is mid-flight) still owning the lock. Returns a release fn that
// unlocks and tears down the holding connection.
async function holdAdvisoryLock(): Promise<{ release: () => Promise<void> }> {
  const pool = new Pool({ connectionString: SCRATCH_URL });
  const client = await pool.connect();
  await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  return {
    release: async () => {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      client.release();
      await pool.end();
    },
  };
}

// Seed the scratch DB so its ledger already records the given tags as applied,
// WITHOUT running their SQL — mimics a DB that is already migrated up to those tags.
async function seedLedger({ tags }: { tags: readonly string[] }): Promise<void> {
  await withScratch(async (pool) => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS orchid_schema_migrations (
         tag text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    // Also provision the schema-presence table so the migrator's baseline check
    // sees a non-fresh DB (it never runs anyway once every tag is in the ledger).
    await pool.query(`CREATE TABLE IF NOT EXISTS orchid_session (id text PRIMARY KEY)`);
    const placeholders = tags.map((_, index) => `($${index + 1})`).join(', ');
    await pool.query(
      `INSERT INTO orchid_schema_migrations (tag) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
      [...tags],
    );
  });
}

const REAL_DRIZZLE_DIR = resolve(process.cwd(), 'drizzle');

// The real, committed migration tags in journal order — read at runtime so this
// test never needs editing when a migration is added. `trackedTags` returns them
// sorted, so keep a sorted copy for ledger assertions.
type JournalEntry = { readonly idx: number; readonly tag: string };
async function realJournalTags(): Promise<readonly string[]> {
  const raw = await readFile(join(REAL_DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(raw) as { entries: readonly JournalEntry[] };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
}
const sorted = (tags: readonly string[]): readonly string[] => [...tags].sort();

const adminPool = new Pool({ connectionString: ADMIN_URL });

// Recreate the scratch DB from scratch — guarantees an empty, isolated database
// for each scenario without touching any other agent's DB or prod.
async function resetScratchDb(): Promise<void> {
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [SCRATCH_DB],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await adminPool.query(`CREATE DATABASE ${SCRATCH_DB}`);
}

async function withScratch<T>(run: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = new Pool({ connectionString: SCRATCH_URL });
  try {
    return await run(pool);
  } finally {
    await pool.end();
  }
}

async function tableExists({ pool, table }: { pool: Pool; table: string }): Promise<boolean> {
  const result = await pool.query<{ table_name: string | null }>(
    `SELECT to_regclass($1) AS table_name`,
    [`public.${table}`],
  );
  return result.rows[0]?.table_name != null;
}

async function trackedTags({ pool }: { pool: Pool }): Promise<readonly string[]> {
  const result = await pool.query<{ tag: string }>(
    `SELECT orchid_schema_migrations.tag FROM orchid_schema_migrations ORDER BY orchid_schema_migrations.tag`,
  );
  return result.rows.map((row) => row.tag);
}

beforeAll(async () => {
  await resetScratchDb();
});

beforeEach(async () => {
  await resetScratchDb();
});

afterAll(async () => {
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [SCRATCH_DB],
  );
  await adminPool.query(`DROP DATABASE IF EXISTS ${SCRATCH_DB}`);
  await adminPool.end();
});

describe('migrate (build-time runner)', () => {
  it('fresh DB: applies every committed migration from scratch and tracks them', async () => {
    const expected = await realJournalTags();
    const result = await migrate({ databaseUrl: SCRATCH_URL });

    expect(result.baselined).toBe(false);
    expect(result.applied).toEqual(expected);

    await withScratch(async (pool) => {
      expect(await tableExists({ pool, table: 'orchid_session' })).toBe(true);
      expect(await tableExists({ pool, table: 'session_commits' })).toBe(true);
      expect(await trackedTags({ pool })).toEqual(sorted(expected));
    });
  });

  it('re-run with nothing pending is a no-op', async () => {
    const expected = await realJournalTags();
    await migrate({ databaseUrl: SCRATCH_URL });
    const second = await migrate({ databaseUrl: SCRATCH_URL });

    expect(second.baselined).toBe(false);
    expect(second.applied).toEqual([]);

    await withScratch(async (pool) => {
      expect(await trackedTags({ pool })).toEqual(sorted(expected));
    });
  });

  it('simulated prod drift: baselines existing schema without replaying SQL, then applies a later migration', async () => {
    // 1. Build the drifted state: full schema present, but no tracking table.
    //    Apply 0000 + 0001, then DROP the ledger to mimic a prod DB built by
    //    `drizzle push` that never had a migration ledger.
    await migrate({ databaseUrl: SCRATCH_URL });
    await withScratch(async (pool) => {
      await pool.query('DROP TABLE orchid_schema_migrations');
      expect(await tableExists({ pool, table: 'orchid_schema_migrations' })).toBe(false);
      // Schema is still fully present.
      expect(await tableExists({ pool, table: 'orchid_session' })).toBe(true);
      expect(await tableExists({ pool, table: 'session_commits' })).toBe(true);
    });

    // 2. First deploy of the runner against the drifted DB: it must BASELINE —
    //    record both tags as applied WITHOUT replaying their CREATE TABLE SQL
    //    (which would error on the already-existing tables). The fact that this
    //    call resolves (rather than throwing "relation already exists") proves
    //    no SQL was replayed.
    const realTags = await realJournalTags();
    const baseline = await migrate({ databaseUrl: SCRATCH_URL });
    expect(baseline.baselined).toBe(true);
    expect(baseline.applied).toEqual([]);
    await withScratch(async (pool) => {
      expect(await trackedTags({ pool })).toEqual(sorted(realTags));
    });

    // 3. A later migration ships. Use a temp drizzle fixture that mirrors every
    //    real (already-baselined) migration plus one throwaway probe that sorts
    //    last. Only the probe is pending, so only its SQL runs.
    const probeTag = 'zzzz_throwaway_probe';
    const fixtureDir = await mkdtemp(join(tmpdir(), 'orchid-migtest-'));
    try {
      await mkdir(join(fixtureDir, 'meta'), { recursive: true });
      await Promise.all(
        realTags.map((tag) =>
          copyFile(join(REAL_DRIZZLE_DIR, `${tag}.sql`), join(fixtureDir, `${tag}.sql`)),
        ),
      );
      await writeFile(
        join(fixtureDir, `${probeTag}.sql`),
        'CREATE TABLE "migtest_probe" (\n\t"id" text PRIMARY KEY NOT NULL\n);',
        'utf8',
      );
      await writeFile(
        join(fixtureDir, 'meta', '_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'postgresql',
          entries: [
            ...realTags.map((tag, idx) => ({
              idx,
              version: '7',
              when: idx + 1,
              tag,
              breakpoints: true,
            })),
            {
              idx: realTags.length,
              version: '7',
              when: realTags.length + 1,
              tag: probeTag,
              breakpoints: true,
            },
          ],
        }),
        'utf8',
      );

      const later = await migrate({ databaseUrl: SCRATCH_URL, drizzleDir: fixtureDir });
      expect(later.baselined).toBe(false);
      expect(later.applied).toEqual([probeTag]);

      await withScratch(async (pool) => {
        expect(await tableExists({ pool, table: 'migtest_probe' })).toBe(true);
        expect(await trackedTags({ pool })).toEqual(sorted([...realTags, probeTag]));
      });
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('failing migration rolls back and rejects (build would fail)', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'orchid-migtest-bad-'));
    try {
      await mkdir(join(fixtureDir, 'meta'), { recursive: true });
      await writeFile(
        join(fixtureDir, '0000_bad.sql'),
        'CREATE TABLE "migtest_ok" ("id" text PRIMARY KEY);--> statement-breakpoint\nTHIS IS NOT SQL;',
        'utf8',
      );
      await writeFile(
        join(fixtureDir, 'meta', '_journal.json'),
        JSON.stringify({
          version: '7',
          dialect: 'postgresql',
          entries: [{ idx: 0, version: '7', when: 1, tag: '0000_bad', breakpoints: true }],
        }),
        'utf8',
      );

      await expect(migrate({ databaseUrl: SCRATCH_URL, drizzleDir: fixtureDir })).rejects.toThrow(
        /0000_bad/,
      );

      // The whole migration rolled back: neither the table nor the ledger row exist.
      await withScratch(async (pool) => {
        expect(await tableExists({ pool, table: 'migtest_ok' })).toBe(false);
        expect(await trackedTags({ pool })).toEqual([]);
      });
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it('lock held by another session + NO pending: gives up after the budget and proceeds (exit 0)', async () => {
    // Ledger already has every real journal tag → nothing pending. Hold the
    // advisory lock from a second session to simulate an orphaned lock from a
    // dead build. The migrator must NOT hang: it polls try-lock up to the
    // shortened budget, never gets it, sees no pending work, warns, and returns
    // success without ever applying SQL.
    const realTags = await realJournalTags();
    await seedLedger({ tags: realTags });

    const { release } = await holdAdvisoryLock();
    try {
      const startedAt = Date.now();
      const result = await migrate({ databaseUrl: SCRATCH_URL });
      const elapsed = Date.now() - startedAt;

      expect(result.baselined).toBe(false);
      expect(result.applied).toEqual([]);
      // Proved it actually waited the budget (the lock was never free) but did
      // not hang far beyond it.
      expect(elapsed).toBeGreaterThanOrEqual(SHORT_LOCK_BUDGET_MS - 500);
      expect(elapsed).toBeLessThan(SHORT_LOCK_BUDGET_MS + 5_000);

      // Ledger unchanged — it proceeded without touching anything.
      await withScratch(async (pool) => {
        expect(await trackedTags({ pool })).toEqual(sorted(realTags));
      });
    } finally {
      await release();
    }
  });

  it('lock held by another session + migrations PENDING: gives up after the budget and FAILS the build', async () => {
    // Ledger is missing the last real migration → it IS pending. With the lock
    // held by another session, the migrator must give up after the budget and
    // throw (exit non-zero) rather than hang or deploy un-migrated code.
    const realTags = await realJournalTags();
    const allButLast = realTags.slice(0, -1);
    await seedLedger({ tags: allButLast });

    const { release } = await holdAdvisoryLock();
    try {
      const startedAt = Date.now();
      await expect(migrate({ databaseUrl: SCRATCH_URL })).rejects.toThrow(
        /Could not acquire migrate lock/,
      );
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(SHORT_LOCK_BUDGET_MS - 500);

      // Nothing was applied while the lock was contended — ledger unchanged.
      await withScratch(async (pool) => {
        expect(await trackedTags({ pool })).toEqual(sorted(allButLast));
      });
    } finally {
      await release();
    }
  });
});
