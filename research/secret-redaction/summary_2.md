# Secret Redaction Learnings for Orchid

Research date: 2026-05-01

## Executive takeaway

Orchid should treat AI coding transcripts as sensitive telemetry by default. The current product value comes from storing, searching, replaying, and summarizing the "why" behind code changes, but those same transcripts can contain raw API keys, private keys, database URLs, auth headers, cookies, `.env` files, cloud credentials, MCP configuration, command output, local paths, customer data, and prompt-injection text.

The central learning is simple: Orchid should not store raw transcripts as canonical data. It should store redacted transcripts as canonical data, with a separate redaction manifest and finding table that preserves detector evidence without preserving the secret.

The right architecture is local-first and layered:

1. Parse Claude Code JSONL into typed fragments.
2. Redact high-confidence secrets locally before upload.
3. Upload only sanitized transcript text plus a manifest.
4. Rescan on the server before persistence.
5. Store only redacted transcript content in the primary product path.
6. Keep search, AI, webhooks, analytics, logs, support tooling, and exports downstream of redacted content.
7. Use ML and LLMs as secondary aids, not as the first defense for known secrets.

## What we learned from the repo

The biggest practical risk is that Orchid's current data flow is raw-by-default:

- `cli/src/sync.ts` reads the full transcript file and uploads it as `transcript`.
- `web/app/lib/api-app.ts` persists `transcript` into `orchid_session.transcript`.
- `web/app/lib/schema.ts` has no redaction status, scanner version, redaction manifest, or finding table.
- `GET /api/sessions?q=...` searches the transcript field directly.
- Summary, chat, and decision extraction endpoints build prompts from stored transcript text and can send that text to OpenAI.

So this is not just "add a scanner." It is a data boundary problem. If raw transcript text is canonical, every feature that reads transcripts becomes part of the secret-handling surface.

The first security goal should be narrow and testable:

- No high-confidence secret leaves the CLI in raw form by default.
- No transcript is persisted until a server ingestion scan passes.
- No AI/search/export/webhook/support path can read unredacted transcript text.
- Every redaction has source coordinates, detector provenance, rule version, confidence, replacement, and keyed fingerprint.
- No raw secret is stored in ordinary DB rows, logs, analytics, or search indexes.

## What we learned about detection

### Deterministic scanning is the first line

Known secrets are best caught with deterministic detectors:

- provider-specific token regexes,
- private-key block detectors,
- connection-string parsers,
- HTTP auth header and cookie parsers,
- JWT structure checks,
- `.env` and config key/value parsing,
- context-bound entropy checks,
- allowlists and baselines.

Good reference systems:

- Gitleaks: configurable regex rules, keywords, entropy, allowlists, baselines, JSON/SARIF output, `stdin` scanning.
- TruffleHog: provider detectors, decoded data handling, verified/unknown states, custom detectors, validation workflows.
- Yelp detect-secrets: operational baseline and audit workflow.
- GitHub Secret Scanning: provider patterns, push protection UX, partner alerts, validity check model.
- Kingfisher and Titus: newer scanner candidates worth evaluating for rule ideas and server-side benchmark comparisons.

The strongest lesson: avoid raw entropy over full transcript text. It creates too many false positives from commit SHAs, UUIDs, hashes, package lock integrity strings, test fixtures, generated IDs, and model/tool identifiers. Entropy is useful only when bounded by context like `token`, `secret`, `password`, `DATABASE_URL`, `Authorization`, `Cookie`, or structured assignment syntax.

### PII/DLP is a separate lane

PII tools catch a different class of sensitive data:

- names,
- emails,
- phone numbers,
- addresses,
- government or financial identifiers,
- local usernames,
- hostnames,
- private repo URLs,
- customer IDs.

They do not reliably catch API keys, private keys, cookies, JWTs, package tokens, or database URLs.

Best fit for Orchid:

- Use Microsoft Presidio-style self-hosted analyzers/anonymizers as the baseline PII approach.
- Add Orchid-specific recognizers for developer text: local paths, git emails, private repo hosts, MCP config, issue tracker URLs, internal hostnames, and project/customer identifiers.
- Treat Google Sensitive Data Protection, Azure PII, and Amazon Comprehend as optional enterprise/comparator paths, not the default inline path, because they send content to SaaS APIs.

### ML helps, but later

Useful model directions:

- token classifiers for span-level PII/password detection,
- Presidio transformer recognizers,
- GLiNER-style runtime-label NER,
- small local classifiers for chunk triage,
- LLM structured-output extractors for ambiguous already-sanitized spans.

But ML should not gate the first implementation. It adds licensing, latency, privacy, and evaluation complexity. Some attractive models also have licenses unsuitable for production use without review.

Use ML after Orchid has:

- deterministic scanners,
- a transcript fixture corpus,
- span-level metrics,
- false-positive baselines,
- redaction manifests,
- downstream gates.

### LLMs are not the core redactor

LLMs are useful for offline review, synthetic fixture generation, ambiguous classification, and policy explanation. They are risky as a primary scanner because:

- transcript text can contain prompt injection,
- remote LLM calls can expose the very data being protected,
- outputs can be nondeterministic,
- span offsets can be wrong,
- direct rewrite redaction can hallucinate or miss boundaries.

If Orchid uses LLMs for redaction-related tasks:

- provide no tools,
- treat transcript content as untrusted data,
- require strict structured output,
- request extractive spans only,
- validate offsets and exact substrings,
- replace deterministic high-confidence secrets with placeholders before LLM review.

Also, the current AI endpoints should not place raw transcript text inside privileged system prompts. Transcript excerpts should be passed as untrusted data and only after redaction passes.

## What we learned about architecture

### Redacted canonical storage is the core decision

The main product boundary should be:

```text
raw transcript exists only locally and ephemerally
  -> local redaction
  -> redacted transcript + manifest upload
  -> server ingestion scan
  -> redacted canonical storage
  -> all product features read only redacted content
```

Downstream systems must never depend on raw transcripts:

- dashboard,
- session viewer,
- search,
- summaries,
- chat,
- decisions,
- commit extraction where feasible,
- webhooks,
- exports,
- logs,
- analytics,
- support tools,
- future embedding/vector stores.

### Shared redaction core

Build one redaction core used by CLI and server. It can start in the existing repo layout, but it should be designed as a shared package boundary.

Core concepts:

```text
TranscriptFragment
  source kind
  JSONL line
  JSON pointer
  raw text
  byte/codepoint offsets
  role/tool metadata
  fragment type

RedactionFinding
  detector id
  rule version
  finding type
  confidence
  source coordinates
  span offsets
  replacement
  action
  fingerprint

RedactionManifest
  scanner version
  policy version
  findings
  skipped ranges
  errors
  aggregate counts

RedactionPolicy
  severity thresholds
  detector enablement
  allowlists
  bypass rules
  workspace mode
```

### Server must distrust the client

Local redaction is necessary but insufficient. The server should rescan uploads before persistence.

Server behavior:

- If critical/high secrets remain, reject or quarantine without persisting canonical transcript text.
- If medium/low findings remain, optionally redact server-side and persist as `passed_with_server_redactions`.
- Store finding metadata separately.
- Block AI/search/export/webhook paths unless `redaction_status = passed`.

Recommended schema additions:

- `orchid_session.redaction_status`
- `orchid_session.redaction_version`
- `orchid_session.redaction_policy_version`
- `redaction_finding` table with detector metadata, source coordinates, replacement, confidence, validation state, user decision, and keyed fingerprints.

### Typed placeholders preserve value

Generic `[REDACTED]` makes transcripts less useful. Orchid should use deterministic, typed placeholders:

```text
sk-proj-...                         -> <OPENAI_API_KEY_1>
postgres://u:p@db.internal/app      -> postgres://<DB_CREDENTIALS_1>@<DB_HOST_1>/<DB_NAME_1>
/Users/andres/Developer/orchid      -> /Users/<LOCAL_USER_1>/Developer/orchid
Authorization: Bearer abc...        -> Authorization: Bearer <AUTH_TOKEN_1>
-----BEGIN PRIVATE KEY-----...      -> <PRIVATE_KEY_BLOCK_1>
```

Use keyed HMAC fingerprints for dedupe. Do not use plain hashes for low-entropy values like passwords or usernames.

### Reversible restore should not be default

Default to irreversible redaction. Reversible tokenization creates a high-value vault and changes the security model. It should only exist if there is a clear enterprise requirement, with:

- separate encrypted vault,
- step-up auth,
- reason capture,
- short retention,
- strict audit logs,
- no restore into AI/search/log/export paths.

Most Orchid workflows need context, not the exact secret.

## What we learned about prevention

Redaction after transcript creation is not enough for mature enterprise use.

Claude Code hooks are an opportunity for optional prevention. Orchid can eventually offer hooks that warn or block commands likely to dump secrets into transcripts:

- `env`
- `printenv`
- `cat .env`
- `cat ~/.aws/credentials`
- `kubectl get secret -o yaml`
- commands with `Authorization:` headers
- commands that print cookies, private keys, or cloud credentials

This should be opt-in. Hooks can break workflows, but they are valuable for teams that want prevention rather than cleanup.

MCP should also be first-class in the threat model:

- `.mcp.json`
- `.claude/settings.json`
- MCP tool inputs and outputs
- MCP resources included in transcript context
- MCP client secrets and database URLs

MCP config leaks are increasingly common, and Orchid is likely to ingest that context through coding sessions.

## Prioritized implementation plan

### P0: Stop new raw exposure

Build the minimum system that prevents obvious secrets from persisting.

1. Add deterministic CLI scanning for:
   - private keys,
   - auth headers,
   - cookies,
   - provider-prefixed tokens,
   - AI provider keys,
   - database URLs,
   - JWTs,
   - `.env` assignments,
   - MCP-related secrets.
2. Redact before upload.
3. Include a manifest in the existing session upload body.
4. Add server ingestion scan before persistence.
5. Add `redaction_status` and `redaction_version`.
6. Gate AI summary/chat/decisions/search on passed redaction.

Success criteria:

- seeded fake OpenAI, Anthropic, GitHub, AWS, private key, DB URL, JWT, auth header, and cookie values never persist raw and never reach OpenAI requests.

### P1: Make findings operational

1. Add `redaction_finding`.
2. Add typed placeholders.
3. Add HMAC value fingerprints and occurrence fingerprints.
4. Add scanner tests for Claude JSONL shapes.
5. Add local/workspace allowlists with reason and expiration.
6. Add a clear CLI blocked-upload review output.

Success criteria:

- users can see what was redacted without Orchid storing raw values.
- repeated findings dedupe across transcript lines and sessions.

### P2: Lock down downstream surfaces

1. Refactor search, summary, chat, decisions, webhooks, exports, and future embeddings to read only redacted content.
2. Move transcript data out of system prompts.
3. Use structured outputs for decision extraction.
4. Add canary tests that fail if seeded secrets appear in logs, OpenAI requests, webhooks, search results, or exports.
5. Add purge/quarantine workflow for post-upload findings.

Success criteria:

- no downstream path sees raw seeded canaries.

### P3: Improve recall and quality

1. Add parser-aware detection for JSON/YAML/TOML, URLs, shell, HTTP headers, and MCP config.
2. Add bounded decoding for base64, hex, URL-encoded, and JSON-escaped candidates.
3. Benchmark Gitleaks, TruffleHog, Kingfisher, Titus, and Orchid's native scanner on the same fixture corpus.
4. Add background rescans when detector rules update.
5. Add opt-in validation queue for provider tokens.

Success criteria:

- high-risk secret recall improves without making false positives intolerable.

### P4: Add PII and ML

1. Add deterministic PII recognizers for email, phone, local usernames, home directories, internal hostnames, git author emails, and customer/project identifiers.
2. Evaluate Presidio for prose spans.
3. Evaluate GLiNER and context-aware PII approaches on synthetic/redacted fixtures.
4. Use LLM review only for uncertain already-sanitized spans.

Success criteria:

- PII recall improves while transcript utility remains good enough for review, search, and summaries.

### P5: Enterprise controls

1. Workspace policies for severity thresholds, bypass permissions, retention, validation, exports, and AI feature enablement.
2. Delegated review for broad allowlists and bypasses.
3. Audit events for block, redact, bypass, quarantine, validate, restore, export, and purge.
4. Customer-visible scanner version and redaction summary per transcript.
5. Optional reversible tokenization only if a customer requirement justifies the risk.

Success criteria:

- admins can prove what was scanned, redacted, bypassed, validated, and exposed downstream.

## Risk register

| Priority | Risk | Why it matters | Mitigation |
| --- | --- | --- | --- |
| P0 | Raw transcript upload persists secrets | Current path uploads and stores raw transcript text | CLI redaction plus server ingestion scan |
| P0 | AI endpoints receive raw secrets | Current summary/chat/decisions can send transcript text to OpenAI | Gate on redaction, pass transcript as untrusted data, use structured outputs |
| P0 | Search/export/support reads raw transcripts | Raw canonical data spreads to every feature | Redacted canonical storage only |
| P0 | High-confidence false negatives | A missed private key or token is a serious incident | Provider rules, private-key detectors, fixtures, background rescans |
| P1 | False positives make Orchid unusable | Over-redaction destroys transcript utility | Typed spans, confidence levels, allowlists, baselines |
| P1 | Fingerprints leak guessable values | Plain hashes can be brute-forced | Keyed HMAC, no plain hashes |
| P1 | Redaction breaks JSONL/transcript rendering | Bad redaction can corrupt replay | Fragment-aware offset redaction, rendering tests |
| P2 | Prompt injection manipulates AI features | Transcript text is untrusted input | Separate instructions/data, structured outputs, no tools |
| P2 | Logs capture secrets during errors | Debug logs often bypass product controls | Canary tests, structured logging, no raw values |
| P3 | Validation leaks credentials or has side effects | Provider calls can disclose or exercise live secrets | Async opt-in validation only |
| P3 | Rule bundle update supply-chain risk | Scanner rules become security-critical code | Signed bundles, versioning, rollback |
| P4 | ML model license blocks use | Some useful models are non-commercial | Legal review, swappable interfaces |
| P4 | Historical leaks already reached indexes | Late detection means copies may exist elsewhere | Quarantine and purge workflow |
| P5 | Restore vault becomes high-value target | Reversible tokenization stores the thing we want to avoid storing | Avoid by default, isolate if required |

## Product decisions to make

1. Is Orchid's promise "raw high-confidence secrets never leave the machine" or just "we try to redact before storage"?
2. Can users bypass critical findings, or must critical findings always redact/exclude?
3. Is reversible restore out of scope for v1?
4. Should validation happen from Orchid servers, user machines, or not by default?
5. Should detector rules ship with CLI releases, signed remote bundles, or both?
6. Which AI features should be disabled until redaction passes?
7. What retention policy applies to redaction findings and manifests?

## Recommended v1 stance

For the first implementation, choose the simpler and safer stance:

- Raw high-confidence secrets should not leave the user's machine.
- Critical findings cannot be uploaded raw.
- Redacted transcript is canonical.
- No reversible restore.
- No live validation by default.
- LLMs are not part of the upload-path scanner.
- AI features require `redaction_status = passed`.
- All downstream features read redacted content only.

This gives Orchid a defensible security boundary without blocking later enterprise features.

## Source documents in this PR

- [Deterministic Secret Scanning](./deterministic-secret-scanning.md)
- [PII and DLP Redaction](./pii-dlp-redaction.md)
- [ML and LLM Models](./ml-llm-models.md)
- [Orchid Redaction Architecture](./orchid-architecture.md)
- [Summary](./summary.md)
- [Independent Analysis](./analysis.md)

## Key sources

- GitHub supported secret scanning patterns: https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns
- GitHub responsible AI generic secret detection: https://docs.github.com/en/code-security/responsible-use/responsible-ai-generic-secrets
- GitHub engineering writeup on AI password detection: https://github.blog/engineering/platform-security/finding-leaked-passwords-with-ai-how-we-built-copilot-secret-scanning/
- Gitleaks: https://github.com/gitleaks/gitleaks
- TruffleHog: https://github.com/trufflesecurity/trufflehog
- Yelp detect-secrets: https://github.com/Yelp/detect-secrets
- MongoDB Kingfisher: https://github.com/mongodb/kingfisher
- Praetorian Titus: https://github.com/praetorian-inc/titus
- Microsoft Presidio: https://microsoft.github.io/presidio/
- Google Sensitive Data Protection de-identification: https://docs.cloud.google.com/sensitive-data-protection/docs/concepts-de-identification
- Anthropic Claude Code hooks: https://code.claude.com/docs/en/hooks
- Anthropic Claude Code MCP: https://code.claude.com/docs/en/mcp
- OWASP LLM Prompt Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- OpenAI agent safety guidance: https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Comparative study of secret detection tools: https://arxiv.org/abs/2307.00714
- SecretBench: https://arxiv.org/abs/2303.06729
- GLiNER NAACL 2024: https://aclanthology.org/2024.naacl-long.300/
- CAPID context-aware PII detection: https://arxiv.org/abs/2602.10074
- NIST SP 800-61 Rev. 3 announcement: https://www.nist.gov/news-events/news/2025/04/nist-revises-sp-800-61-incident-response-recommendations-and-considerations
