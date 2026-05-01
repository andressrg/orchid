# Deterministic Secret Scanning for Orchid

## Executive Bullets

- Orchid should treat secret scanning as a deterministic risk-reduction layer, not a guarantee. The best current tools combine provider-specific regexes, entropy, keyword context, allowlists, baselines, deduplication, and sometimes live credential validation.
- For pre-upload CLI scanning, favor fast local checks over network validation: provider regexes, private-key and connection-string patterns, JSONL-aware context, entropy only when bounded by keywords or known assignment shapes, and a user-controlled allowlist/baseline.
- For server-side background scanning, run deeper detectors asynchronously: full transcript text, git metadata, historical batches, deduplication by keyed hash/fingerprint, optional live validation only for high-confidence provider tokens, and no raw-secret persistence.
- GitHub Secret Scanning is useful platform context but not enough for Orchid data. It scans GitHub surfaces and supported patterns; Orchid receives Claude Code JSONL transcripts and git metadata before or outside GitHub.
- Gitleaks is the best fit to borrow from for Orchid's first local engine: configurable regex rules, entropy thresholds, keywords for pre-filtering, allowlists, baselines, redacted output, git/file/stdin modes, and SARIF/JSON reporting.
- TruffleHog is the best reference for deeper background verification workflows: verified/unknown result states, many provider detectors, custom regex detectors, optional verification, decoded data handling, and credential analysis.
- Yelp detect-secrets is the best reference for operational workflow: create a baseline for existing findings, block only new findings, audit the baseline, and tune plugins and filters for local signal-to-noise.
- Main risk: raw Claude transcripts can contain secrets in arbitrary prose, terminal output, code blocks, env files, stack traces, and git diffs. False positives must not block normal uploads too often, but false negatives can leak credentials to Orchid.

## Techniques

### Provider-Specific Regex and Structured Patterns

Regex is the highest-signal deterministic technique when the provider has a stable token format: GitHub tokens, AWS access key IDs, Slack tokens, Stripe keys, OpenAI keys, private keys, database URLs, basic/bearer auth headers, and cloud connection strings. GitHub's supported-pattern docs distinguish provider tokens, non-provider patterns, push protection support, partner/user alerts, and validity checks, which reflects the modern pattern-scanning model used by platforms.

Strengths:

- Fast enough for CLI pre-upload scanning.
- Predictable, explainable, and easy to test with fixtures.
- High precision for tokens with prefixes, checksums, fixed lengths, or paired key-id/key-secret structures.
- Easy to redact by captured secret group instead of whole line.

Weaknesses:

- Misses custom or legacy token formats.
- Provider formats change, so rule updates are operationally required.
- Generic regexes such as "api_key = ..." cause false positives unless paired with entropy, context, or allowlists.
- Regex engines and syntax differ. Gitleaks and TruffleHog use Go regular expressions for custom rules, which matters for lookarounds and portability.

Orchid fit:

- Use as the first-pass scanner for JSONL `message.content`, tool outputs, shell commands, git remotes, commit messages, diffs, and file paths.
- Maintain provider-specific rules in versioned config and ship rule updates independently if possible.
- Capture only secret substrings and return redacted findings with stable fingerprints.

### Entropy Heuristics

Entropy finds random-looking strings that do not match known providers. Gitleaks rules can set Shannon entropy on a captured group, and detect-secrets ships base64 and hex high-entropy plugins with configurable thresholds. TruffleHog custom detectors also support entropy filters.

Strengths:

- Finds opaque tokens, random passwords, session IDs, and custom API keys.
- Useful for transcripts where a user may paste `.env` values, terminal output, or generated credentials.

Weaknesses:

- High false-positive risk from hashes, UUIDs, lockfiles, compressed/base64 data, model IDs, file digests, commit SHAs, and test fixtures.
- Low-entropy real passwords, human phrases, and short tokens are missed.
- Academic comparison work found false positives commonly came from generic regexes and ineffective entropy calculation.

Orchid fit:

- Do not run raw entropy over entire transcripts as a blocking CLI rule.
- Use entropy only inside bounded contexts: assignment lines with secret-like keys, HTTP auth headers, dotenv/YAML/TOML/JSON values, CLI flags such as `--token`, and detected credential fields.
- Suppress common non-secrets in Orchid's domain: git commit SHAs, tree/blob IDs, package hashes, UUIDs, trace IDs, timestamps, model IDs, and known Claude session identifiers.

### Keyword and Context Signals

Keyword detectors look for secret-related names such as `password`, `token`, `api_key`, `secret`, `authorization`, `private_key`, and `credential`. detect-secrets explicitly separates regex, entropy, and keyword detectors, noting that keyword detection catches values that do not look random but needs tuning.

Strengths:

- Finds non-random secrets such as `password = "hunter2"` or internal tokens.
- Works well on structured JSONL, shell history, `.env`, config files, and pasted snippets.
- Cheap pre-filter before more expensive regexes.

Weaknesses:

- Very noisy in documentation, tests, examples, and security research text.
- Keywords alone cannot identify the secret substring reliably.
- Can miss secrets copied without labels.

Orchid fit:

- Score context around candidates: key name, file path, JSON field, shell command, surrounding words, and whether the candidate appears in a command output or user-authored note.
- Treat "secret-looking key plus literal value" differently from explanatory prose.
- For CLI blocking, require a known provider pattern or a context-plus-entropy threshold. For server background scanning, keep lower-confidence keyword findings for review or silent redaction suggestions.

### Allowlists, Baselines, and Suppression

Operational secret scanning needs suppression. Gitleaks supports global and rule-specific allowlists by commits, paths, stopwords, regexes, and target rules; it also supports baselines so old findings can be ignored. detect-secrets is designed around creating a `.secrets.baseline`, blocking new findings, and auditing the baseline to label real versus false positives.

Strengths:

- Makes scanning deployable in noisy real repositories and transcript stores.
- Lets Orchid avoid re-alerting for already reviewed false positives.
- Enables "block new high-confidence secrets" without solving historical cleanup first.

Weaknesses:

- Bad allowlists can hide real secrets.
- Baselines can normalize existing leaks if review is skipped.
- Inline allowlist comments are less applicable to immutable JSONL transcript data.

Orchid fit:

- Use a per-workspace or per-user baseline keyed by non-reversible fingerprints, detector ID, source kind, and normalized location.
- Allowlist by detector, file path, transcript source, stable value fingerprint, and known test/example markers.
- Avoid storing raw candidate values in allowlists; use keyed HMAC fingerprints so the server can dedupe without preserving the secret.

### Live Credential Validation

Validation checks whether a detected credential is active. GitHub supports validity checks for some provider tokens and notes that non-provider patterns do not support push protection or validity checks. TruffleHog emphasizes verified findings, supports `--results=verified,unknown`, can verify provider secrets, and supports custom detector verification via webhook. Semgrep Secrets and other commercial platforms also use validators.

Strengths:

- Strongly reduces false positives for supported providers.
- Helps prioritize active credentials over dead examples.
- Can attach useful metadata such as account or permissions when provider APIs support safe introspection.

Weaknesses:

- Network calls can be slow, flaky, rate-limited, and privacy-sensitive.
- Validation may transmit secrets or secret-derived data to third-party APIs.
- Some validation calls can have side effects or create audit logs.
- Unsupported tokens remain unknown; "not verified" does not mean safe.

Orchid fit:

- Do not validate live credentials in the pre-upload hot path unless the user explicitly opts in.
- Server-side validation should be asynchronous, provider-specific, rate-limited, auditable, and limited to high-confidence findings.
- Store validation status as `verified`, `invalid`, `unknown`, or `not_supported`; never downgrade a high-confidence finding to safe solely because validation failed.

### Decoding and Container Awareness

Modern scanners inspect more than plain text. Gitleaks supports recursive decoding depth and archive depth options. TruffleHog scans git, filesystem paths, cloud buckets, Docker images, CI systems, GitHub issues/PRs, and decoded representations.

Strengths:

- Catches base64-wrapped secrets, archived files, generated artifacts, and hidden history.
- Important for Claude Code transcripts because command output may include encoded env files or serialized JSON.

Weaknesses:

- Recursive decoding can be CPU-expensive and can expand untrusted input.
- More decoding increases false positives and parsing complexity.

Orchid fit:

- CLI: small bounded decoding for obvious base64 values near secret keywords.
- Server: bounded background decoding with byte limits, recursion limits, archive limits, and timeouts.

### Deduplication and Redaction

TruffleHog documents fingerprinting and redacted secret transmission for deduplication. Gitleaks reports fingerprints and supports redacting output. Deduplication is essential because one leaked token can appear across many transcript lines, diffs, and retries.

Strengths:

- Reduces alert fatigue.
- Lets Orchid show "same secret seen in N places" without storing the raw token.
- Supports baselines and regression detection.

Weaknesses:

- Fingerprints must be keyed or otherwise resistant to offline guessing for low-entropy secrets.
- Location-sensitive fingerprints can break when transcript storage or line mapping changes.

Orchid fit:

- Compute `secret_fingerprint = HMAC(server_or_device_key, normalized_secret)`.
- Store redacted display forms such as prefix/suffix only when safe and useful.
- Separate value fingerprint from occurrence fingerprint so one secret across many events dedupes cleanly.

## Tool Comparison

| Tool/platform | Core approach | Strengths | Weaknesses | Fit for Orchid CLI | Fit for Orchid server |
| --- | --- | --- | --- | --- | --- |
| GitHub Secret Scanning | Provider and non-provider patterns, custom patterns, push protection, partner alerts, validity checks for supported tokens | Strong ecosystem coverage, push-time blocking, provider partnerships, supported validity checks | GitHub-surface specific, paid/private repo constraints, non-provider patterns noisier, limited to supported/custom patterns | Reference behavior, not directly embeddable for transcript upload | Useful downstream control if Orchid data reaches GitHub |
| Gitleaks | Regex rules, captured secret groups, entropy, keywords, allowlists, baselines, git/dir/stdin modes, JSON/SARIF output | Fast, configurable, good local workflow, good model for baselines and allowlists | Rule maintenance required, no broad built-in live validation, entropy/generic rules can be noisy | Strong reference and possible engine/config inspiration | Good batch scanner for stored text and git metadata |
| TruffleHog | Provider detectors, verification, decoded data, git/filesystem/cloud/CI sources, custom regex detectors | Strong verification workflow, verified/unknown states, broad source coverage, useful background depth | Heavier than a small embedded CLI scanner, network validation complexity, AGPL licensing constraints for direct embedding | Better as optional external scan than embedded hot path | Strong reference for async verification and deep scans |
| Yelp detect-secrets | Plugins for regex, entropy, keyword detection; filters; baseline and audit workflow; pre-commit hook | Excellent enterprise suppression workflow, auditable baseline, easy tuning | Python dependency, less focused on live validation and broad source types than TruffleHog | Strong model for "block only new findings" and local baselines | Useful model for analyst review and baseline lifecycle |
| Semgrep Secrets | Rules plus semantic analysis, entropy, validators, custom validators | Good context-aware direction and validation concept | Commercial/platform dependency for secrets product; less suitable as Orchid's embedded deterministic core | Reference for context-aware ranking | Reference for validators and rule management |
| GitLab Secret Detection | Platform-integrated secret detection using centrally managed Gitleaks-derived rules | Good example of platformizing rules and CI/background scans | GitLab-specific surface and operational model | Reference only | Reference for centralized rule updates |
| AWS git-secrets | Git hooks with prohibited and allowed regex patterns, AWS-focused provider patterns | Simple and fast, good for AWS-specific pre-commit protection | Narrow coverage, regex-only style, not enough for arbitrary transcripts | Useful fallback idea for tiny local rules | Limited |
| Nosey Parker | Rust scanner for textual data and git history with regex rules, grouping/deduplication, SARIF support | Performance-oriented, good deduplication emphasis, scans arbitrary text and history | Smaller ecosystem than Gitleaks/TruffleHog; validation not the main focus | Worth evaluating for high-throughput local scanning | Worth evaluating for large background corpus scans |

## Recommended Orchid Approach

### 1. Build a Small Native Scanner for the Upload Path

Pre-upload scanning should run locally before transcript upload and finish within the CLI interaction budget. It should scan only data about to be uploaded, not full repository history.

Recommended local pipeline:

1. Parse JSONL structurally and extract bounded text fields from user messages, assistant messages, tool calls, tool output, git commit messages, git diff snippets, environment-looking blocks, and command strings.
2. Run provider-specific regex detectors first.
3. Run private-key, connection-string, HTTP auth header, dotenv, JSON/YAML/TOML assignment, and CLI-flag detectors.
4. Run entropy only when a keyword or assignment context is present.
5. Apply allowlists and a local baseline by HMAC fingerprint, detector ID, source kind, and normalized path/session location.
6. Redact high-confidence matches before upload or block upload with a clear local remediation prompt, depending on product policy.

Recommended confidence levels:

- `critical`: private keys, provider-prefixed API tokens, connection strings with credentials, HTTP authorization headers.
- `high`: keyword/assignment plus high entropy, known provider key ID plus nearby secret pair, dotenv secret fields.
- `medium`: generic high entropy with weak context, suspicious command output, unknown token-like strings.
- `low`: keyword-only findings and documentation-like examples.

Only `critical` and selected `high` findings should block pre-upload by default. `medium` should redact or warn depending on user settings. `low` should be server-side telemetry/review only, with no raw value storage.

### 2. Add Server-Side Background Scanning

Server scanning can trade latency for recall. It should run after ingestion and after any redaction already performed locally.

Recommended server jobs:

- Batch scan new transcript chunks and git metadata.
- Re-scan historical data when rules change.
- Deduplicate by secret fingerprint and occurrence fingerprint.
- Maintain per-workspace baselines and reviewed false-positive decisions.
- Queue optional provider validation for high-confidence supported tokens.
- Produce operational metrics: findings by detector, false-positive rate, validation status, mean scan time, skipped bytes, and top allowlist rules.

### 3. Keep Rule Data Separable and Testable

Use a versioned rule format inspired by Gitleaks:

- `id`, `description`, `regex`, `secretGroup`, `keywords`, `entropy`, `paths`, `sourceKinds`, `allowlists`, `tags`, `severity`.
- Include tests with true positives, false positives, and Orchid-specific fixtures from JSONL transcripts and git metadata.
- Track rule version on every finding so old decisions remain explainable.

### 4. Treat Validation as a Background Enrichment

Credential validation should be opt-in or policy-controlled. Orchid should document what leaves the system, which providers are contacted, and what is stored. Validation failures should produce `unknown` when caused by network or rate-limit issues.

### 5. Minimize Secret Retention

Recommended storage:

- Raw secret: never stored after detection.
- Redacted display: optional prefix/suffix, only when useful.
- Fingerprint: keyed HMAC of normalized secret.
- Context: source type, transcript/session ID, line/message offset, detector ID, rule version, confidence, validation status.
- Evidence: short redacted snippet, with the matched value removed.

## Risks and Open Questions

- Product policy: should Orchid block uploads with high-confidence secrets, redact automatically, or ask the user each time?
- Privacy: live validation may disclose credentials to providers or create audit events. Orchid needs a clear default and user/admin controls.
- Local keying: if CLI-side HMAC fingerprints are useful before upload, Orchid needs a device or workspace key strategy that supports dedupe without exposing raw secrets.
- Rule updates: provider token formats change. Orchid needs a secure update channel or frequent app releases for detector rules.
- Transcript semantics: Claude Code JSONL may include nested JSON strings, terminal control characters, diffs, and tool output. The scanner needs canonical extraction rules and byte limits.
- Performance: entropy and decoding can be expensive on large outputs. Use per-field byte caps, streaming scans, early exits for critical findings, and async background rescans.
- False-positive review: baselines reduce noise but can hide real leaks. Orchid should require review metadata for broad allowlists and expose stale allowlists.
- Validation safety: some provider APIs have side effects or rate limits. Each validator needs a safety review before enablement.
- Legal/compliance: storing even redacted snippets or metadata around secrets may be sensitive for enterprise customers.

## Source Links

- GitHub Docs, "Supported secret scanning patterns": https://docs.github.com/en/code-security/reference/secret-security/supported-secret-scanning-patterns
- GitHub Docs, "Secret scanning": https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning
- GitHub Secret Protection product page: https://github.com/security/advanced-security/secret-protection
- Gitleaks README and configuration docs: https://github.com/gitleaks/gitleaks
- TruffleHog README: https://github.com/trufflesecurity/trufflehog
- TruffleHog custom detectors documentation: https://docs.trufflesecurity.com/custom-detectors
- TruffleHog detector-specific verification documentation: https://docs-next.trufflesecurity.com/docs/configuration/detector-specific-verification/
- Yelp detect-secrets README: https://github.com/Yelp/detect-secrets
- Semgrep Secrets validators documentation: https://semgrep.dev/docs/semgrep-secrets/validators
- Semgrep Secrets overview: https://semgrep.dev/docs/semgrep-secrets/conceptual-overview
- GitLab secret push protection documentation: https://docs.gitlab.com/user/application_security/secret_detection/secret_push_protection/
- GitLab secret detection architecture note: https://handbook.gitlab.com/handbook/engineering/architecture/design-documents/secret_detection/
- AWS Labs git-secrets README: https://github.com/awslabs/git-secrets
- Nosey Parker README: https://github.com/praetorian-inc/noseyparker
- Praetorian Nosey Parker announcement: https://www.praetorian.com/newsroom/open-sources-nosey-parker/
- Basak, Cox, Reaves, Williams, "A Comparative Study of Software Secrets Reporting by Secret Detection Tools", ESEM 2023: https://arxiv.org/abs/2307.00714
