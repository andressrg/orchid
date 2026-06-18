# Independent Secret Redaction Analysis for Orchid

Research date: 2026-05-01

## Bottom Line

The existing research is directionally strong: Orchid needs local-first, deterministic redaction before upload, server-side distrust and rescanning, redacted canonical storage, typed placeholders, baselines, and strict downstream hygiene. The main missing piece is not another model choice. The main missing piece is a hard integration plan for Orchid's current data flow, which currently reads the full Claude Code JSONL transcript, uploads it every five seconds, stores it in `orchid_session.transcript`, searches it directly, and sends stored transcript text to AI summary, chat, and decision-extraction endpoints.

That means Orchid's first security milestone should be narrow and measurable:

1. No high-confidence secret leaves the CLI in raw form by default.
2. No transcript is persisted until a server ingestion scan passes.
3. No AI, search, analytics, support, webhook, or export path can read unredacted transcript text.
4. Every redaction has source coordinates, detector provenance, a rule version, and a keyed fingerprint, but not the raw secret.

ML and LLM techniques are useful later, but they should not gate the first version. The first Orchid implementation should ship a fast deterministic scanner with transcript-aware parsing, a small PII recognizer set, typed redaction, a manifest, and a server gate.

## Existing Research Strengths

The existing research is strongest in five areas.

1. It correctly rejects a single-scanner or LLM-only design. The recommended stack of provider regexes, private-key detection, connection-string parsing, context-bound entropy, PII recognizers, optional ML, and background rescans matches how mature systems are evolving. GitHub now uses AI for generic password detection, but still separates AI-generated generic alerts from regular secret scanning alerts and expects additional scrutiny.

2. It treats transcripts as mixed-content records rather than plain prose. Claude Code transcripts can contain JSONL events, Markdown, tool calls, command output, diffs, stack traces, local paths, env dumps, MCP config, and model text. Segmenting into typed spans before scanning is the right foundation.

3. It emphasizes redacted canonical storage. This is the right product boundary for Orchid because existing features search, summarize, chat over, display, and link transcripts. If raw content becomes canonical, every downstream feature becomes a secret handling system.

4. It proposes operational controls that matter in practice: baselines, allowlists, detector versions, HMAC fingerprints, validation states, background rescans, and incident workflows. The comparative study by Basak et al. found false positives often come from generic regexes and poor entropy handling, while false negatives come from weak rulesets, skipped file types, and bad regexes. That supports the research's focus on rule quality and review workflow.

5. It is appropriately skeptical of live validation. TruffleHog, Kingfisher, Titus, and commercial products show that validation can reduce noise, but validation can disclose credentials to third-party APIs, trigger provider audit events, hit rate limits, or have side effects. Orchid should treat validation as an asynchronous, opt-in enrichment, not an upload-path requirement.

## Gaps and Weak Assumptions

### Current Orchid Exposure Is Larger Than The Research States

The research describes the target architecture, but the current code path is raw-by-default:

- `cli/src/sync.ts` reads the entire transcript with `fs.readFileSync` and sends it as `transcript` in a gzip JSON payload.
- `web/app/lib/api-app.ts` upserts that value directly into `orchid_session.transcript`.
- `web/app/lib/schema.ts` has no redaction status, scanner version, or finding table. `orchid_session.transcript` is currently the only transcript content field.
- `GET /api/sessions?q=...` searches `orchid_session.transcript` directly.
- Summary, chat, and decision extraction build prompts from stored transcript text and send them to OpenAI when `OPENAI_API_KEY` is set.

This is not just "needs redaction before upload." It is a systemic data-flow issue. Until redacted canonical storage exists, every new feature that touches transcripts increases the blast radius.

### AI Prompt Boundaries Need Tightening

The current chat endpoint places the whole transcript inside the system message before appending user questions. That treats untrusted transcript content as privileged instruction context. OpenAI's agent safety guidance warns that prompt injection happens when untrusted text enters an AI system and attempts to override instructions, and recommends structured outputs and careful data flow. OWASP gives similar guidance: separate instructions from user data and monitor outputs.

For Orchid, the safe pattern is:

- Put transcript excerpts in a data field or user-message section explicitly marked as untrusted transcript data.
- Never place raw transcript text in system or developer messages.
- Use structured outputs for machine-consumed extraction tasks such as decisions.
- Validate model output before storing it.
- Run AI features only after `redaction_status = passed`.

### MCP and Agent Tooling Are Underweighted

The existing research mentions MCP, but Orchid should elevate it to a first-class threat. Anthropic's Claude Code MCP docs say resources referenced through MCP can be automatically fetched and included as attachments, and that MCP resources can contain text, JSON, or structured data. GitGuardian's 2026 report says MCP configuration files exposed 24,008 unique secrets, with database connection strings and AI/search API keys among the top types.

Orchid should scan:

- `.mcp.json`, `.claude/settings.json`, and Claude Code environment config references when imported into transcript context.
- MCP tool inputs and outputs in JSONL records.
- MCP resource content if a transcript includes it.
- Tool call arguments that look like auth headers, database URLs, cloud credentials, or API tokens.

### Hook-Based Prevention Is Missing

The research focuses on scanning after transcript content exists. Claude Code hooks can run at lifecycle points such as `PreToolUse` and can deny tool execution. Orchid should not rely only on post-hoc transcript redaction. A later phase should offer an optional Claude Code hook that blocks or warns on high-risk commands before they print secrets into the transcript, such as `env`, `printenv`, `cat .env`, `aws configure export-credentials`, `kubectl get secret -o yaml`, or commands containing `Authorization:` values.

This should be optional because hooks can break workflows, but it is valuable for enterprise workspaces that want prevention instead of cleanup.

### Model and Dataset Licensing Need Product Review

Piiranha is a useful token-classification benchmark for PII/password spans, but its model card lists a `cc-by-nc-nd-4.0` license. That is likely unsuitable for Orchid production use without separate permission. GLiNER-style models are promising because runtime labels are flexible, but individual PII-tuned variants need license, data provenance, and evaluation review.

Recommendation: evaluate these models in research only until legal/product approval exists. Do not bake a specific Hugging Face model into the architecture.

### Cloud DLP Is Useful But Misfit For The Default Path

Google Sensitive Data Protection is useful as an enterprise comparator and optional customer-selected backend. It supports built-in and custom infoType detectors, custom dictionaries, regex detectors, and de-identification. But it is a SaaS inspection path: raw transcript content leaves Orchid's environment unless a customer deploys and accepts that architecture. That conflicts with the strongest Orchid product promise.

Default Orchid redaction should be local and self-hosted.

### Incident Guidance Should Use Current NIST Revision

The architecture research cites NIST SP 800-61 Rev. 1. NIST finalized SP 800-61 Rev. 3 on April 3, 2025. Orchid's incident workflow should align with the current Rev. 3 framing around integrating incident response with CSF 2.0 functions, not only the older linear lifecycle.

## Newer Techniques and Tools Worth Considering

### Kingfisher

MongoDB's Kingfisher is now a serious open-source scanner to evaluate. Its repository describes a Rust scanner with 945 built-in rules, 485 with live validation, broad platform targets, baseline management, checksum-aware detection, report viewing, and direct revocation support.

Orchid fit:

- Strong candidate for offline benchmark comparison and server-side deep scans.
- Useful source of rule ideas for AI SaaS tokens, database URLs, CI/CD tokens, and cloud credentials.
- Risky for upload-path use because live validation and revocation are too powerful unless explicitly disabled.
- Integration cost is nontrivial because Orchid is TypeScript/Next.js and Kingfisher is Rust.

### Titus

Praetorian's Titus replaced Nosey Parker as its active high-performance scanner. Titus is Apache-2.0, written in Go, and advertises 487 detection rules, live validation, binary extraction, CLI, Go library, Burp, and Chrome integrations.

Orchid fit:

- Worth evaluating for server/offline scans and as a source of rules.
- Less attractive than a small native scanner for the CLI hot path because binary extraction, browser/proxy features, and validation are outside Orchid's first problem.
- Validation must be disabled by default.

### Generic Secret Detection With AI

GitHub's Copilot secret scanning for generic secrets and Microsoft's Security Copilot Secret Finder both show a clear market direction: context-aware AI can detect unstructured passwords and credentials that regex misses. GitHub's public writeup is also a cautionary note: early LLM prompts failed badly on some repositories, requiring diverse evaluation, prompt/model changes, and ongoing monitoring.

Orchid fit:

- Use AI for offline triage and synthetic fixture generation, not core redaction.
- If used for detection, request extractive spans only, require structured output, and verify returned offsets against the original already-sanitized text.
- Do not send raw high-confidence secrets to remote LLMs. Replace deterministic findings with placeholders before LLM review.

### Context-Aware PII Models

CAPID, accepted to the EACL 2026 Student Research Workshop, argues that relevance-aware local small language models can preserve QA utility while filtering PII before LLM calls. That is highly relevant to Orchid's chat-over-transcript feature: not all local paths, names, dates, branch names, and issue IDs have the same privacy impact.

Orchid fit:

- Good research direction for later utility-preserving PII redaction.
- Not a prerequisite for secret redaction MVP.
- Needs Orchid-specific eval data before production.

### Checksum and Format Intelligence

Provider formats increasingly include prefixes, checksums, and structured components. Kingfisher calls out checksum-aware detection; GitHub and other platforms use validity and metadata checks for supported providers. Orchid should prioritize provider-specific parsers over generic entropy because they reduce false positives and improve user trust.

## Concrete Architecture Recommendations

### 1. Add A Shared Redaction Core

Create a shared redaction module used by both CLI and server. The implementation can start inside existing app folders, but the boundary should be clear enough to later promote into a workspace package.

Core types:

- `TranscriptFragment`: source kind, JSONL line, JSON pointer, raw text, byte offsets, role/tool metadata, and fragment type.
- `RedactionFinding`: detector id, rule version, finding type, confidence, source coordinates, original span offsets, replacement, action, and fingerprints.
- `RedactionManifest`: scanner version, policy version, findings, skipped ranges, errors, and aggregate counts.
- `RedactionPolicy`: severity thresholds, allowed detectors, allowlists, bypass rules, and workspace mode.

The scanner should return redacted text plus a manifest. It should never require raw secret persistence.

### 2. Redact Before Upload In The CLI

The current CLI upload code should be changed so the data sent to `/sessions/:id` is a redacted transcript snapshot and a manifest, not raw JSONL.

Initial local detector set:

- Private keys: PEM, OpenSSH, PGP, PKCS blocks.
- Provider tokens: GitHub, OpenAI, Anthropic, AWS access key IDs and secret-like pairs, Azure, Google service account JSON, Slack, Stripe, npm, PyPI, Vercel, Supabase, Hugging Face, Datadog, Sentry, Linear, Postgres/Redis/MySQL URLs.
- Auth material: `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, bearer/basic headers, JWT-like strings, session cookies.
- Config formats: `.env`, shell assignments, JSON/YAML/TOML sensitive keys, `.npmrc`, `.pypirc`, `.netrc`, `.aws/credentials`, Docker Compose.
- Claude/agent specifics: MCP config, tool inputs, tool output, command strings, local paths, git remotes, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MCP_CLIENT_SECRET`.

CLI policy:

- `critical`: block or auto-redact before upload. Do not upload raw bypassed values.
- `high`: auto-redact by default, allow narrow local false-positive marking.
- `medium`: redact or warn depending on workspace policy.
- `low`: preserve for later review unless it is cheap and syntax-safe to redact.

For performance, start with a full-snapshot scan if transcript sizes are still bounded. Add line-level caching soon after: cache per-line content hash, redacted line, and finding manifest so the five-second sync loop does not rescan an entire long transcript on every tick.

### 3. Add A Server Ingestion Gate

The server must distrust client redaction. In `PUT /sessions/:id`, scan the submitted redacted transcript before persistence.

Server behavior:

- If the server finds unredacted critical or high-confidence secrets, reject with a redacted error payload or quarantine the upload. Do not write the transcript into canonical storage.
- If only medium/low findings remain, apply server redaction and persist with `redaction_status = passed_with_server_redactions`.
- Store finding metadata separately from transcript text.
- Block search, summary, chat, decisions, webhooks, and exports unless the session has passed ingestion redaction.

Recommended schema additions:

- Add redaction status/version fields to `orchid_session`.
- Add a separate `redaction_finding` table with source coordinates, detector metadata, replacement text, action, validation state, user decision, and keyed fingerprints.
- Add a `redaction_rule_version` or scanner package version to every finding.

### 4. Make Redacted Transcript The Only Downstream Input

Downstream systems should only read redacted canonical content:

- Dashboard/session views.
- `GET /api/sessions?q=...` search.
- Summary, chat, and decisions endpoints.
- Commit extraction jobs where feasible. If commit extraction must inspect raw-looking commit output, run it after redaction on sanitized transcript content and preserve commit SHAs because they are not secrets by themselves.
- GitHub webhook comments.
- Logs, traces, analytics, exports, support tooling, and future embedding/vector pipelines.

AI endpoints should be refactored so transcript data is an untrusted data payload, not a system prompt. Decision extraction should use structured outputs and validate results before storage.

### 5. Add Typed Placeholders That Preserve Utility

Use deterministic placeholders scoped to a session or workspace:

```text
sk-proj-...                         -> <OPENAI_API_KEY_1>
postgres://u:p@db.internal/app      -> postgres://<DB_CREDENTIALS_1>@<DB_HOST_1>/<DB_NAME_1>
/Users/andres/Developer/orchid      -> /Users/<LOCAL_USER_1>/Developer/orchid
Authorization: Bearer abc...        -> Authorization: Bearer <AUTH_TOKEN_1>
-----BEGIN PRIVATE KEY-----...      -> <PRIVATE_KEY_BLOCK_1>
```

Use keyed HMAC fingerprints for dedupe. Do not use plain hashes for low-entropy values such as passwords or local usernames.

### 6. Treat Validation As Background Enrichment

Validation should be disabled in local upload and default server ingestion. Later, add a queue for opt-in validation:

- Only high-confidence provider-specific findings.
- Provider allowlist per workspace.
- Rate limits, egress audit, and provider safety review.
- States: `not_supported`, `queued`, `verified`, `invalid`, `unknown`, `failed_to_check`.
- Never mark a finding safe only because validation fails.

Do not add automatic revocation in Orchid's first versions. Revocation is powerful, provider-specific, and can break production systems.

### 7. Build An Orchid-Specific Evaluation Corpus Before ML

The eval corpus should include:

- Positive fixtures: real-format fake provider tokens, private keys, JWTs, DB URLs, cookies, package tokens, MCP config secrets, cloud credential files, tool outputs, logs, HTTP requests, `.env`, stack traces, and pasted shell history.
- Negative fixtures: commit SHAs, UUIDs, hashes, package-lock integrity strings, test fixtures, placeholders, public examples, fake AWS examples, model IDs, local non-secret paths, and already redacted strings.
- Adversarial fixtures: split secrets, zero-width characters, nested code fences, base64 wrappers, JSON-escaped values, truncated tool output, Markdown tables, and prompt-injection text that tells the scanner to ignore secrets.

Metrics should be per class: high-risk secret recall, false positives per 1,000 transcript lines, span boundary correctness, p95 scan time, redaction utility, and prompt-injection resilience for AI review paths.

## Prioritized Implementation Plan

### P0: Stop New Raw Exposure

1. Add a deterministic CLI scanner for the highest-risk classes: private keys, auth headers, provider-prefixed tokens, database URLs, cookies, JWTs, `.env` assignments, and known AI/MCP tokens.
2. Redact before upload and include a manifest in the existing PUT body.
3. Add a server scan before persistence. Reject or quarantine high-confidence misses.
4. Add `redaction_status` and `redaction_version` to sessions.
5. Disable AI summary/chat/decisions for sessions without `redaction_status = passed`.

Success criteria: a transcript containing seeded fake private keys, OpenAI/Anthropic keys, GitHub tokens, AWS keys, DB URLs, and auth headers never persists or reaches OpenAI in raw form.

### P1: Make Findings Operational

1. Add the `redaction_finding` table.
2. Add typed placeholders, HMAC value fingerprints, and occurrence fingerprints.
3. Add scanner fixture tests for Claude JSONL shapes.
4. Add local and workspace allowlists with expiration and reason capture.
5. Add a minimal CLI review output for blocked findings.

Success criteria: users can see what was redacted without raw secret storage, and repeated findings dedupe across transcript lines.

### P2: Cover Downstream Surfaces

1. Refactor search, summary, chat, decisions, and webhook logic to require redacted content.
2. Move transcript text out of system prompts and into untrusted data sections for AI features.
3. Use structured outputs for decision extraction and validate results.
4. Add logs/analytics tests that fail if raw seeded canaries appear in app logs.
5. Add deletion and purge paths for redaction incidents.

Success criteria: seeded canary secrets do not appear in OpenAI requests, logs, webhook comments, search results, or exported records.

### P3: Improve Recall and Review Quality

1. Add parser-aware detectors for JSON/YAML/TOML, URLs, shell commands, HTTP headers, and MCP config.
2. Add bounded decoding for obvious base64/hex/percent-encoded candidates.
3. Evaluate Kingfisher, Titus, Gitleaks, and TruffleHog on the Orchid fixture corpus.
4. Add optional server-side background rescans on rule updates.
5. Add optional validation queue with strict workspace opt-in.

Success criteria: recall improves without unacceptable false positives, and server rescans can find newly supported patterns in historical redacted content.

### P4: Add PII and ML Carefully

1. Add deterministic PII recognizers for emails, local usernames, home directories, internal hostnames, git author emails, phone numbers, and common identifiers.
2. Evaluate Presidio as a local service for prose spans.
3. Evaluate GLiNER and relevance-aware PII approaches on redacted/synthetic fixtures.
4. Use LLM review only for uncertain already-sanitized spans, with structured output and offset validation.

Success criteria: PII recall improves while transcript utility remains high enough for search, review, and AI summaries.

### P5: Enterprise Controls

1. Add workspace policy for severity thresholds, bypass permissions, retention, validation, exports, and AI feature enablement.
2. Add delegated review for broad allowlists and bypasses.
3. Add security audit events for block, redact, bypass, quarantine, validation, restore, export, and purge.
4. Add customer-visible scanner version and redaction summary per transcript.
5. Consider optional reversible tokenization only if a paying enterprise requirement justifies the risk.

Success criteria: enterprise admins can prove what was scanned, what was redacted, what was bypassed, and which downstream systems received only redacted content.

## Risk Register

| Priority | Risk | Impact | Likelihood | Recommendation |
| --- | --- | --- | --- | --- |
| P0 | Raw transcript upload persists secrets before scanning | Critical | High | Redact in CLI and rescan before persistence. Reject/quarantine server misses. |
| P0 | Stored transcripts are sent to AI endpoints | Critical | High | Gate AI endpoints on passed redaction, move transcript data out of system prompts, use structured outputs for extraction. |
| P0 | Search/export/support reads raw canonical transcripts | High | High | Make redacted transcript the only canonical field read by downstream features. |
| P0 | False negatives for provider tokens or private keys | Critical | Medium | Prioritize provider-specific rules, private-key blocks, auth headers, DB URLs, and regression fixtures. |
| P1 | False positives make transcripts unusable | Medium | High | Use confidence levels, typed spans, allowlists, baselines, and detector-specific tests. Do not block low-confidence findings. |
| P1 | HMAC/fingerprint implementation leaks guessable values | High | Medium | Use keyed HMAC with strong server/workspace keys. Never store plain hashes of secrets or passwords. |
| P1 | Redaction breaks JSONL parsing or transcript replay | Medium | Medium | Redact by offsets inside parsed fragments, preserve JSON structure, and test rendering with redacted fixtures. |
| P2 | Prompt injection in transcript manipulates AI features | High | Medium | Treat transcript as untrusted data, separate instructions from data, validate structured outputs, and avoid tools in transcript review flows. |
| P2 | Logs capture raw secrets during errors or debugging | High | Medium | Add canary tests and structured logging rules. Log finding ids and detector ids, not raw values. |
| P3 | Live validation discloses credentials or triggers side effects | High | Medium | Keep validation asynchronous, opt-in, provider-reviewed, rate-limited, and never required for blocking. |
| P3 | Rule bundle update becomes a supply-chain risk | High | Low-Medium | Sign rule bundles, version rules, test before activation, and support rollback. |
| P4 | ML model license or data provenance blocks production use | Medium | Medium | Treat models as research until legal review. Prefer swappable interfaces and local evals. |
| P4 | Background rescan finds historical leaks already indexed elsewhere | Critical | Medium | Add purge/quarantine workflow for primary DB, search, AI summaries, caches, exports, logs, and backups. |
| P5 | Reversible tokenization creates a high-value vault | Critical | Low initially | Do not build restore by default. If required, isolate vault, require step-up auth, keep short retention, and audit every reveal. |

## Evidence and Source Links

### Orchid Current State

- `cli/src/sync.ts`: reads the whole transcript and uploads it as `transcript`.
- `web/app/lib/api-app.ts`: persists `transcript`, searches it, and sends transcript-derived prompts to OpenAI summary/chat/decision endpoints.
- `web/app/lib/schema.ts`: `orchid_session.transcript` is the current transcript storage field; no redaction/finding schema exists.

### Primary and Authoritative Sources

- Anthropic Claude Code hooks: https://code.claude.com/docs/en/hooks
- Anthropic Claude Code MCP: https://code.claude.com/docs/en/mcp
- GitHub responsible detection of generic secrets with Copilot secret scanning: https://docs.github.com/en/code-security/responsible-use/responsible-ai-generic-secrets
- GitHub engineering writeup on AI password detection: https://github.blog/engineering/platform-security/finding-leaked-passwords-with-ai-how-we-built-copilot-secret-scanning/
- Gitleaks repository and docs: https://github.com/gitleaks/gitleaks
- TruffleHog custom detectors: https://docs.trufflesecurity.com/custom-detectors
- Yelp detect-secrets repository: https://github.com/Yelp/detect-secrets
- MongoDB Kingfisher repository: https://github.com/mongodb/kingfisher
- Praetorian Titus repository: https://github.com/praetorian-inc/titus
- Microsoft Presidio supported entities: https://microsoft.github.io/presidio/supported_entities/
- Google Sensitive Data Protection de-identification: https://docs.cloud.google.com/sensitive-data-protection/docs/concepts-de-identification
- OWASP LLM Prompt Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- OpenAI safety in building agents: https://developers.openai.com/api/docs/guides/agent-builder-safety
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- NIST SP 800-61 Rev. 3 announcement: https://www.nist.gov/news-events/news/2025/04/nist-revises-sp-800-61-incident-response-recommendations-and-considerations

### Research Papers and High-Quality Reports

- Basak et al., "A Comparative Study of Software Secrets Reporting by Secret Detection Tools": https://arxiv.org/abs/2307.00714
- Basak et al., "SecretBench: A Dataset of Software Secrets": https://arxiv.org/abs/2303.06729
- GLiNER, NAACL 2024: https://aclanthology.org/2024.naacl-long.300/
- CAPID, context-aware PII detection for QA systems: https://arxiv.org/abs/2602.10074
- Piiranha PII model card: https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information
- GitGuardian State of Secrets Sprawl 2026: https://www.gitguardian.com/state-of-secrets-sprawl-report-2026
- Microsoft Security Copilot Secret Finder: https://techcommunity.microsoft.com/blog/securitycopilotblog/introducing-secret-finder-finding-real-credentials-where-traditional-tools-fail/4500983
