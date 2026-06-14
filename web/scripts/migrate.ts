import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { argv, cwd, env } from 'node:process';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';

// Build-time migrator for Orchid.
//
// drizzle-kit produces flat SQL files in `web/drizzle/NNNN_name.sql` (statements
// separated by `--> statement-breakpoint`) ordered by `web/drizzle/meta/_journal.json`.
// This runner applies any journal tag not yet recorded in our own tracking table,
// each migration in a single transaction, serialized across concurrent deploys by
// a Postgres advisory lock. It is idempotent: when nothing is pending it is a no-op.
//
// The drift problem it solves: prod Neon already has the full schema (applied
// historically via `drizzle push`) but most likely has no migration-tracking table.
// On the first run against such a DB we BASELINE — record the already-satisfied
// migrations as applied WITHOUT replaying their SQL — so we never try to recreate
// tables that already exist. See `maybeBaseline` for the exact rule.

const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

// A single arbitrary 64-bit key so concurrent migrators (e.g. two racing deploys)
// serialize instead of clobbering each other. Released in `finally` and also
// automatically when the session connection closes — so there is no stuck lock.
// UNCHANGED: every deploy must contend on the same key for serialization to work.
const ADVISORY_LOCK_KEY = 7264193055;

// Lock acquisition is bounded and self-healing — it never blocks forever.
//
// History: an unconditional blocking `pg_advisory_lock` hung a build indefinitely
// when a prior build died while holding the (session-level) lock and its Neon
// pooler connection lingered — orphaning the lock so every later build hung in
// "Building" forever. We now poll `pg_try_advisory_lock` (non-blocking, returns a
// bool) on a fixed interval up to a total budget; if the budget expires we decide
// by pending work rather than hang (see `migrate`).
//
// Overridable via env so tests can shorten the budget without waiting the full 90s.
const LOCK_BUDGET_MS = Number(env.MIGRATE_LOCK_BUDGET_MS ?? 90_000);
const LOCK_RETRY_INTERVAL_MS = Number(env.MIGRATE_LOCK_RETRY_MS ?? 2_000);

// Caps so neither a stray blocking statement nor a network stall to Neon can hang a
// build forever. `statement_timeout` bounds every single statement on the session;
// the connect timeout bounds acquiring the pooled connection itself.
const STATEMENT_TIMEOUT = env.MIGRATE_STATEMENT_TIMEOUT ?? '120s';
const CONNECT_TIMEOUT_MS = Number(env.MIGRATE_CONNECT_TIMEOUT_MS ?? 15_000);

// Tracking table for applied migrations. Distinct from drizzle-kit's own
// `__drizzle_migrations` (which we never write to) so the two never collide.
const MIGRATIONS_TABLE = 'orchid_schema_migrations';

// A table that exists in prod iff the schema was already provisioned. Used to
// distinguish a drifted DB (schema present, no ledger -> baseline) from a fresh
// DB (no schema -> run everything).
const SCHEMA_PRESENCE_TABLE = 'public.orchid_session';

type JournalEntry = {
  readonly idx: number;
  readonly tag: string;
};

type Journal = {
  readonly entries: readonly JournalEntry[];
};

const log = ({ message }: { message: string }): void => console.log(`[migrate] ${message}`);

const defaultDrizzleDir = (): string => resolve(cwd(), 'drizzle');

// Ordered migration tags, lowest idx first = chronological run order.
async function readJournalTags({
  drizzleDir,
}: {
  drizzleDir: string;
}): Promise<{ tags: readonly string[] }> {
  const raw = await readFile(resolve(drizzleDir, 'meta', '_journal.json'), 'utf8');
  const journal = JSON.parse(raw) as Journal;
  const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
  return { tags: ordered.map((entry) => entry.tag) };
}

// Split a drizzle-kit migration file into individual statements, dropping the
// breakpoint markers and any blank fragments.
function splitStatements({ sql }: { sql: string }): readonly string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function ensureMigrationsTable({ client }: { client: PoolClient }): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      tag         text         PRIMARY KEY,
      applied_at  timestamptz  NOT NULL DEFAULT now()
    )
  `);
}

async function readAppliedTags({
  client,
}: {
  client: PoolClient;
}): Promise<{ applied: ReadonlySet<string> }> {
  const result = await client.query<{ tag: string }>(
    `SELECT ${MIGRATIONS_TABLE}.tag FROM ${MIGRATIONS_TABLE}`,
  );
  return { applied: new Set(result.rows.map((row) => row.tag)) };
}

async function schemaAlreadyExists({
  client,
}: {
  client: PoolClient;
}): Promise<{ exists: boolean }> {
  const result = await client.query<{ table_name: string | null }>(
    `SELECT to_regclass('${SCHEMA_PRESENCE_TABLE}') AS table_name`,
  );
  return { exists: result.rows[0]?.table_name != null };
}

async function recordTags({
  client,
  tags,
}: {
  client: PoolClient;
  tags: readonly string[];
}): Promise<void> {
  // Single INSERT with multiple VALUES, never a per-row loop.
  const placeholders = tags.map((_, index) => `($${index + 1})`).join(', ');
  await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (tag) VALUES ${placeholders}`, [...tags]);
}

// One-time cutover shim for the drifted prod DB. If our ledger is EMPTY (first
// run) AND the schema already exists, the migrations on disk are already
// satisfied — record them all as applied WITHOUT replaying their SQL, so we
// never try to recreate existing tables. On a FRESH DB (no schema) this is a
// no-op and every migration runs normally from empty. Safe to leave in place
// forever: it only fires when the ledger is empty.
async function maybeBaseline({
  client,
  tags,
}: {
  client: PoolClient;
  tags: readonly string[];
}): Promise<{ baselined: boolean }> {
  const { applied } = await readAppliedTags({ client });
  if (applied.size > 0) return { baselined: false };

  const { exists } = await schemaAlreadyExists({ client });
  if (!exists) {
    log({ message: 'Fresh database (no existing schema) — applying all migrations from scratch.' });
    return { baselined: false };
  }

  if (tags.length === 0) return { baselined: false };

  await recordTags({ client, tags: [...tags] });
  log({
    message: `Drift detected: schema already present, ledger empty. Baselined ${tags.length} migration(s) as applied WITHOUT replaying SQL: ${tags.join(', ')}`,
  });
  return { baselined: true };
}

// Apply a single migration's statements in one transaction, then record the tag
// in the same transaction so the ledger and schema can never diverge. On any
// error, roll back this migration and rethrow to fail the build.
async function applyMigration({
  client,
  drizzleDir,
  tag,
}: {
  client: PoolClient;
  drizzleDir: string;
  tag: string;
}): Promise<void> {
  const sql = await readFile(resolve(drizzleDir, `${tag}.sql`), 'utf8');
  const statements = splitStatements({ sql });

  await client.query('BEGIN');
  try {
    // Sequential awaited statements inside one transaction: a reduce over a
    // resolved promise keeps it functional (no for/forEach, no mutation).
    await statements.reduce(
      (previous, statement) => previous.then(() => client.query(statement).then(() => undefined)),
      Promise.resolve(),
    );
    await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (tag) VALUES ($1)`, [tag]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(
      `Migration '${tag}' failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

// Journal tags not yet recorded in the ledger, in run order. Read-only: it never
// touches the lock, so it is safe to call when the lock is held by someone else
// (the budget-expired path uses it to decide fail-vs-proceed). Ensures the ledger
// table exists first so a fresh DB reports every tag as pending rather than erroring.
async function computePending({
  client,
  drizzleDir,
}: {
  client: PoolClient;
  drizzleDir: string;
}): Promise<{ pending: readonly string[] }> {
  await ensureMigrationsTable({ client });
  const { tags } = await readJournalTags({ drizzleDir });
  const { applied } = await readAppliedTags({ client });
  return { pending: tags.filter((tag) => !applied.has(tag)) };
}

async function applyPending({
  client,
  drizzleDir,
}: {
  client: PoolClient;
  drizzleDir: string;
}): Promise<{ applied: readonly string[]; baselined: boolean }> {
  await ensureMigrationsTable({ client });
  const { tags } = await readJournalTags({ drizzleDir });
  const { baselined } = await maybeBaseline({ client, tags });

  const { applied } = await readAppliedTags({ client });
  const pending = tags.filter((tag) => !applied.has(tag));
  if (pending.length === 0) {
    log({ message: 'Already up to date — nothing to apply.' });
    return { applied: [], baselined };
  }

  // Sequential awaited transactions: reduce over a resolved promise.
  await pending.reduce((previous, tag) => {
    return previous.then(() => {
      log({ message: `Applying ${tag}` });
      return applyMigration({ client, drizzleDir, tag });
    });
  }, Promise.resolve());

  log({ message: `Applied ${pending.length} migration(s): ${pending.join(', ')}` });
  return { applied: pending, baselined };
}

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

// Reject if `pool.connect()` does not resolve within `CONNECT_TIMEOUT_MS`, so a
// network stall to Neon cannot hang the build at the connection step. The losing
// connect promise is detached; the pool is torn down by the caller's cleanup.
async function connectWithTimeout({ pool }: { pool: Pool }): Promise<PoolClient> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Timed out acquiring a DB connection after ${CONNECT_TIMEOUT_MS}ms`)),
      CONNECT_TIMEOUT_MS,
    ),
  );
  return Promise.race([pool.connect(), timeout]);
}

// Bounded, non-blocking lock acquisition. Polls `pg_try_advisory_lock` (returns a
// bool, never blocks) every `LOCK_RETRY_INTERVAL_MS` until the lock is taken or the
// `deadline` passes. Recursion-with-accumulator (the elapsed deadline) keeps it
// functional — no mutable retry counter, no blocking server-side wait.
async function tryAcquireLockUntil({
  client,
  deadline,
}: {
  client: PoolClient;
  deadline: number;
}): Promise<{ acquired: boolean }> {
  const result = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked',
    [ADVISORY_LOCK_KEY],
  );
  if (result.rows[0]?.locked === true) return { acquired: true };
  if (Date.now() + LOCK_RETRY_INTERVAL_MS >= deadline) return { acquired: false };
  await sleep(LOCK_RETRY_INTERVAL_MS);
  return tryAcquireLockUntil({ client, deadline });
}

export async function migrate({
  databaseUrl,
  drizzleDir = defaultDrizzleDir(),
}: {
  databaseUrl: string;
  drizzleDir?: string;
}): Promise<{ applied: readonly string[]; baselined: boolean }> {
  // A session client (Pool.connect) — required for advisory locks + multi-statement
  // transactions. The plain `pg` driver works for Neon's direct connection string
  // (the prod/preview DATABASE_URL) and for the local Docker Postgres alike.
  const pool = new Pool({ connectionString: databaseUrl });
  // `connectWithTimeout` can reject (network stall) before we hold a client; in
  // that case there is nothing to release, so just tear down the pool and rethrow.
  const client = await connectWithTimeout({ pool }).catch(async (error) => {
    await pool.end();
    throw error;
  });

  // Acquire the lock without ever blocking: poll try-lock up to the budget. The
  // result is the accumulator the `finally` reads to decide whether WE hold the
  // lock and must unlock it.
  const acquireLock = async (): Promise<{ acquired: boolean }> => {
    // Cap every statement on this session so no single call — including a stray
    // blocking one — can hang a build forever.
    await client.query(`SET statement_timeout = '${STATEMENT_TIMEOUT}'`);
    return tryAcquireLockUntil({ client, deadline: Date.now() + LOCK_BUDGET_MS });
  };

  const { acquired } = await acquireLock().catch(async (error) => {
    client.release();
    await pool.end();
    throw error;
  });

  try {
    if (acquired) {
      // Hold the lock — proceed exactly as before: ensure table, baseline, apply.
      return await applyPending({ client, drizzleDir });
    }

    // Budget expired without the lock — someone else holds it, or a dead build
    // orphaned it. Decide by pending work instead of hanging. `computePending`
    // is read-only and does NOT need the lock.
    const { pending } = await computePending({ client, drizzleDir });
    if (pending.length === 0) {
      log({
        message: `WARNING: could not acquire migrate lock within ${LOCK_BUDGET_MS}ms; no migrations pending, proceeding without it. Schema is already up to date — nothing to do.`,
      });
      return { applied: [], baselined: false };
    }

    throw new Error(
      `Could not acquire migrate lock within ${LOCK_BUDGET_MS}ms and ${pending.length} migration(s) are pending (${pending.join(', ')}); failing the build rather than deploying un-migrated code. The lock may be orphaned by a dead build — once its connection is reaped the next deploy will proceed.`,
    );
  } finally {
    // Only unlock if WE acquired it — never release another session's lock.
    if (acquired) await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    client.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  const databaseUrl = env.DATABASE_URL;

  // Build resilience: a missing DATABASE_URL at build time must not brick the
  // deploy. Skip with a clear warning and exit 0 rather than failing the build.
  if (databaseUrl == null || databaseUrl.length === 0) {
    log({
      message:
        'WARNING: DATABASE_URL is not set — skipping migrations (no-op). Set it in the build env to enable auto-migrate.',
    });
    return;
  }

  await migrate({ databaseUrl });
}

// Only run as a CLI when invoked directly (`tsx scripts/migrate.ts`), not when
// imported (e.g. by the test suite, which calls `migrate(...)`).
const isEntrypoint = argv[1] != null && resolve(argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[migrate] Failed:', error);
      process.exit(1);
    });
}
