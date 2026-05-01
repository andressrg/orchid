# Secret Redaction Research Summary for Orchid

Research date: 2026-05-01

## Bottom line

Orchid should not try to solve this with a single model or a single scanner. The strongest architecture is a local-first, layered redaction pipeline:

1. Parse Claude Code JSONL into typed fragments.
2. Detect and redact secrets locally before upload.
3. Upload only redacted transcript text plus a redaction manifest.
4. Rescan at server ingestion before persistence.
5. Store redacted transcripts as the canonical product record.
6. Run background rescans when detector rules or models improve.
7. Use ML/LLMs only as secondary classifiers or review tools, never as the primary control for known secrets.

The product promise should be: high-confidence secrets never intentionally leave the user's machine in raw form.

## Recommended system design

### 1. Segment before scanning

Claude Code transcripts are mixed data: prose, Markdown, code blocks, shell commands, tool output, JSON payloads, `.env` snippets, stack traces, local paths, git metadata, and logs. The scanner should first split each JSONL event into typed spans:

| Span type | Examples | Primary scanner |
| --- | --- | --- |
| Prose | user messages, assistant explanations | PII NER, Presidio, GLiNER |
| Code/config | `.env`, YAML, JSON, TOML, source strings | deterministic secret scanner |
| Terminal/log output | headers, cookies, stack traces, command output | structured rules plus secret scanner |
| URLs/headers | `Authorization`, `Cookie`, query params | parser plus fixed detectors |
| Metadata | user email, cwd, branch, git remote | structured redaction policy |

This preserves offsets and lets Orchid redact values without breaking transcript replay more than necessary.

### 2. Use deterministic detection as the first line

Start with provider-specific regexes, private-key block detection, connection-string parsing, auth-header parsing, JWT structure checks, and high-entropy detection only when there is strong context.

Best references:

- Gitleaks for configurable rules, entropy, keywords, baselines, allowlists, JSON/SARIF output, and `stdin` scanning.
- TruffleHog for verified/unknown secret states, custom detectors, decoders, and async validation.
- detect-secrets for baseline and audit workflow.
- GitHub Secret Scanning for platform patterns, push-protection UX, and validity-check concepts.

Default blocking policy:

| Severity | Examples | Default action |
| --- | --- | --- |
| Critical | private keys, provider API tokens, DB URLs with passwords, auth headers | block upload or redact before upload |
| High | secret-looking assignments, key plus high entropy, credential files | redact before upload; allow narrow local bypass |
| Medium | generic high-entropy values, suspicious logs | warn or redact depending on workspace policy |
| Low | keyword-only findings, likely examples | do not block; include in review telemetry |

### 3. Add PII/DLP detection after secret detection

PII tools are useful, but they are not secret scanners. They catch emails, names, phone numbers, addresses, IDs, and natural-language privacy risks. They do not reliably catch API keys, private keys, JWTs, package tokens, cookies, or database URLs.

Recommended baseline:

- Use Microsoft Presidio-style analyzers and anonymizers as the self-hosted default for PII.
- Add Orchid-specific recognizers for local filesystem usernames, git author emails, private repo hosts, customer IDs, internal hostnames, and issue tracker URLs.
- Evaluate Google Cloud Sensitive Data Protection as an optional enterprise/batch validator, not the default inline path.
- Use Amazon Comprehend PII or Azure PII redaction as external comparators in benchmarks, not as hard dependencies.

Replacement style should preserve utility:

```text
andres@example.com                 -> <EMAIL_1>
/Users/andres/Developer/orchid     -> /Users/<LOCAL_USER_1>/Developer/orchid
postgres://u:p@db.internal/app     -> postgres://<DB_CREDENTIALS_1>@<DB_HOST_1>/<DB_NAME_1>
sk-proj-...                        -> <OPENAI_API_KEY_1>
-----BEGIN PRIVATE KEY-----...     -> <PRIVATE_KEY_BLOCK_1>
```

### 4. Use ML and LLMs carefully

Recent useful model directions:

- Token classifiers such as Piiranha-style DeBERTa models for span-level PII and password detection.
- Presidio transformer recognizers for local NER integration.
- GLiNER-style general NER for runtime labels such as `api credential`, `customer identifier`, `internal hostname`, and `access token`.
- Small local classifiers for chunk triage and false-positive reduction.
- LLM structured-output extractors only for ambiguous, already-preprocessed spans or offline review.

Do not use an LLM as the core redactor. It is slower, harder to test, vulnerable to prompt injection from the transcript text, and may require sending raw sensitive content to another provider. If Orchid uses an LLM, it should:

- receive no tools,
- receive transcript text as untrusted data,
- return only structured findings with offsets,
- have every returned span validated against the source text,
- avoid receiving raw high-confidence secrets whenever deterministic placeholders can be substituted first.

### 5. Canonical storage should be redacted

Store redacted transcripts as the source of truth. Downstream systems should only see redacted content:

- search indexes,
- embeddings,
- analytics,
- support tooling,
- exports,
- GitHub webhook comments,
- AI summaries and chat,
- logs and traces.

Store secret metadata separately:

```text
detector_id
rule_version
finding_type
confidence
session_id
jsonl_line
json_pointer
start_offset
end_offset
replacement
hmac_fingerprint
user_action
validation_state
```

Never store raw secret values in ordinary database rows, logs, analytics, or search indexes. If dedupe is needed, use a keyed HMAC over a normalized secret value, not a plain hash.

### 6. Treat reversible restore as an exception

Default to irreversible redaction. Reversible tokenization should only exist for explicit enterprise or local workflows, with a separate encrypted restore vault, step-up authentication, short retention, reason capture, and audit logging.

Most Orchid product value does not require raw secret restoration. Typed placeholders preserve enough context for review, search, and agent handoff.

## Implementation roadmap

### Phase 1: Local redaction MVP

- Add a streaming Claude JSONL fragment parser.
- Add deterministic secret detectors for private keys, provider tokens, `.env` assignments, auth headers, cookies, database URLs, and high-entropy values near secret keywords.
- Add typed placeholders and a redaction manifest.
- Add CLI upload policy: block critical findings, redact high findings, warn on medium findings.
- Add fixtures for pasted `.env`, `printenv`, HTTP request dumps, stack traces, JWTs, package tokens, and database URLs.

### Phase 2: Server ingestion gate

- Rescan every upload before persistence.
- Quarantine if the server finds unredacted critical/high secrets.
- Persist only redacted content to `orchid_session.transcript`.
- Store redaction metadata in a separate table.
- Block search/indexing/AI summaries until ingestion scan passes.

### Phase 3: PII and transcript-aware recognition

- Add Presidio-compatible PII detection for prose spans.
- Add custom recognizers for developer identity, local paths, git remotes, internal hosts, customer IDs, and support data.
- Add syntax-preserving replacements for code/config/log spans.
- Add allowlists and baselines keyed by HMAC fingerprints.

### Phase 4: Background rescans and validation

- Re-run scans when detector rules update.
- Add async validation only for supported high-confidence provider tokens and only when workspace policy allows it.
- Track `verified`, `invalid`, `unknown`, `not_supported`, and `failed_to_check`.
- Add incident workflow: quarantine, notify, rotate guidance, purge downstream copies, close finding.

### Phase 5: ML evaluation

- Build an Orchid-specific benchmark corpus from synthetic transcripts.
- Evaluate Piiranha-style token classification, Presidio transformers, and GLiNER.
- Add LLM review only for uncertain spans after deterministic and local ML passes.
- Measure span recall, false positives per 1,000 transcript lines, p95 latency, and downstream utility after redaction.

## Proposed first technical architecture

```text
Claude JSONL file
  -> streaming parser
  -> typed fragment extraction
  -> deterministic secret scanner
  -> PII/NER scanner
  -> overlap resolver
  -> policy engine
  -> redacted JSONL + manifest
  -> upload
  -> server ingestion scan
  -> redacted canonical storage
  -> search / AI / UI / exports
```

Key engineering constraints:

- The upload-path scanner must be local and fast.
- Rule updates must be versioned and testable.
- Redaction must be offset-based, not model-rewritten text.
- Server-side scans must distrust the client.
- No downstream system should read raw transcripts.

## Open questions

- Should local upload ever be allowed to bypass critical secrets, or should critical findings always require redaction/exclusion?
- Should Orchid support reversible restore at all, or keep the product promise simpler: raw secrets are never stored?
- How should detector rules ship: CLI release, remote signed rule bundle, or both?
- What is the minimum acceptable p95 latency for redacting an active transcript chunk?
- Which entity types are workspace-configurable versus globally enforced?
- Should validation contact providers from Orchid servers, from the user's machine, or not at all by default?
- How much local context can the UI show around a finding without increasing leak risk?

## Source reports

- [Deterministic Secret Scanning](./deterministic-secret-scanning.md)
- [PII and DLP Redaction](./pii-dlp-redaction.md)
- [ML and LLM Models](./ml-llm-models.md)
- [Orchid Redaction Architecture](./orchid-architecture.md)

## Key external sources

- GitHub supported secret scanning patterns: https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns
- GitHub push protection: https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection
- Gitleaks: https://github.com/gitleaks/gitleaks
- TruffleHog: https://github.com/trufflesecurity/trufflehog
- Yelp detect-secrets: https://github.com/Yelp/detect-secrets
- Microsoft Presidio: https://microsoft.github.io/presidio/
- Google Cloud Sensitive Data Protection de-identification: https://docs.cloud.google.com/sensitive-data-protection/docs/concepts-de-identification
- Amazon Comprehend PII redaction: https://docs.aws.amazon.com/comprehend/latest/dg/redact-api-pii.html
- Azure AI Language document PII redaction: https://learn.microsoft.com/en-us/azure/ai-services/language-service/personally-identifiable-information/document-based-pii-overview
- GLiNER NAACL 2024: https://aclanthology.org/2024.naacl-long.300/
- CAPID context-aware PII detection paper: https://arxiv.org/abs/2602.10074
- Comparative study of secret detection tools: https://arxiv.org/abs/2307.00714
- OpenAI agent safety guidance on prompt injection and structured outputs: https://developers.openai.com/api/docs/guides/agent-builder-safety
