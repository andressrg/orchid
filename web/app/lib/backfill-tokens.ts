/**
 * One-off backfill for persisted token totals.
 *
 * Existing `orchid_session` rows predate token persistence (input_tokens /
 * output_tokens default to 0). New syncs fill them automatically — the
 * `PUT /sessions/:id` handler recomputes from the transcript when the CLI
 * doesn't send totals — so this only needs to run once over the historical rows
 * that won't be re-synced.
 *
 * Strategy: select rows whose tokens are still zero but that have a transcript,
 * parse each transcript's `usage` with the shared `tokenUsageFromTranscript`,
 * then write every row back in a single batched UPDATE (a VALUES join), never a
 * per-row round trip.
 *
 * Run with:  cd web && npx tsx -e "import('./app/lib/backfill-tokens').then(m => m.backfillTokens())"
 *
 * A pure-SQL backfill isn't possible because the totals live inside the JSONL
 * transcript's per-turn `usage` objects, which Postgres can't aggregate without
 * parsing every line — hence this transcript-parsing path.
 */

import pool from './db';
import { tokenUsageFromTranscript } from './token-usage';

interface BackfillResult {
  readonly scanned: number;
  readonly updated: number;
}

interface SessionTokenUpdate {
  readonly id: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

// Write all computed token totals in a single batched UPDATE via a VALUES join.
const writeTokenTotals = async (updates: readonly SessionTokenUpdate[]): Promise<number> => {
  if (updates.length === 0) return 0;
  const result = await pool.query(
    `UPDATE orchid_session
     SET input_tokens = v.input_tokens, output_tokens = v.output_tokens
     FROM unnest($1::text[], $2::int[], $3::int[]) AS v(id, input_tokens, output_tokens)
     WHERE orchid_session.id = v.id`,
    [
      updates.map((u) => u.id),
      updates.map((u) => u.inputTokens),
      updates.map((u) => u.outputTokens),
    ],
  );
  return result.rowCount ?? 0;
};

export const backfillTokens = async (): Promise<BackfillResult> => {
  const { rows } = await pool.query<{ id: string; transcript: string | null }>(
    `SELECT orchid_session.id, orchid_session.transcript
     FROM orchid_session
     WHERE orchid_session.transcript IS NOT NULL
       AND COALESCE(orchid_session.input_tokens, 0) = 0
       AND COALESCE(orchid_session.output_tokens, 0) = 0`,
  );

  const updates = rows
    .map((row) => {
      const { inputTokens, outputTokens } = tokenUsageFromTranscript(row.transcript ?? '');
      return { id: row.id, inputTokens, outputTokens };
    })
    .filter((u) => u.inputTokens > 0 || u.outputTokens > 0);

  const updated = await writeTokenTotals(updates);
  console.log(`Token backfill: scanned ${rows.length} rows, updated ${updated}.`);
  return { scanned: rows.length, updated };
};
