# Transcript Size Limits

## Problem

Vercel serverless functions have a 4.5 MB request body limit. The CLI syncs the full transcript on every PUT to `/api/sessions/:id`. Long coding sessions (1,000+ turns with heavy code/diffs) can exceed this limit.

## Current behavior

- CLI reads the entire `.jsonl` transcript file and sends it as a JSON string every 5 seconds
- The old Express server had `express.json({ limit: "10mb" })` — Vercel has no such override
- Database column is `text` (unlimited) — the DB is not the bottleneck

## Decided: Phase 1 — Compression (implemented)

Gzip the request body on the CLI side. Vercel decompresses automatically. Text compresses ~5-10x, so 4.5 MB compressed holds ~20-40 MB of raw transcript.

- Minimal code change
- No server-side changes, no infrastructure changes
- Buys significant headroom immediately

## Future: Phase 2 — Incremental sync OR S3 staging

Two options for when compression is no longer enough:

### Option A: Incremental sync

CLI tracks a byte offset. Each sync sends only new JSONL lines. Server appends instead of replacing.

- Fixes root cause — each payload is tiny regardless of session length
- Also eliminates bandwidth waste of re-uploading everything
- More complex: offset tracking, append endpoint, re-sync fallback

### Option B: S3 as staging area

CLI uploads transcript to S3 via presigned URL, pings API with the S3 key. Vercel fetches from S3 and writes to DB. Transcript stays in postgres — search/chat/summary unchanged.

- No size limit at all
- Adds S3 dependency (bucket, IAM, presigned URLs)
- S3 lifecycle rules handle orphan cleanup automatically
- Vercel function duration becomes the constraint instead of body size
