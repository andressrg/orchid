import { sql, type SQL } from 'drizzle-orm';
import { orchidSession } from './schema';

// Postgres full-text search over `orchid_session.transcript`, backed by the
// STORED generated `transcript_search` tsvector and its GIN index (migration
// 0001). Both call sites — `searchSessions` (queries.ts) and the `/sessions?q=`
// API path (api-app.ts) — share these fragments so matching + ranking stay
// identical.
//
// `websearch_to_tsquery('english', …)` parses Google-style queries (phrases in
// quotes, `or`, leading `-` to negate) and — crucially — never throws on
// malformed input: stray operators are ignored, so a hostile/garbled `q` yields
// an empty tsquery (zero matches) rather than a 500.

// Builds the english-config tsquery once so the match predicate and the rank
// expression reference the same parse.
const transcriptQuery = (query: string): SQL => sql`websearch_to_tsquery('english', ${query})`;

// Match predicate: `orchid_session.transcript_search @@ websearch_to_tsquery(…)`.
// Table-qualified so it composes safely into any `where`.
export const transcriptMatches = (query: string): SQL =>
  sql`${orchidSession.transcriptSearch} @@ ${transcriptQuery(query)}`;

// Relevance score for ordering. Higher = better match. Use with `desc(…)`.
export const transcriptRank = (query: string): SQL<number> =>
  sql<number>`ts_rank(${orchidSession.transcriptSearch}, ${transcriptQuery(query)})`;
