# Secret Redaction Architecture for Orchid

## Executive bullets

- Orchid should treat Claude Code transcripts as hostile, high-value telemetry: useful for search and replay, but likely to contain command output, environment variables, tool arguments, copied `.env` files, API responses, and local paths.
- The safest default is "secrets never arrive": run deterministic, local pre-upload redaction before any transcript leaves the machine, then repeat scanning at server ingestion and in background rescans.
- Store redacted transcript content as the canonical product record. If restore is required, use reversible tokenization only for explicitly selected fields, backed by a per-user encrypted vault and short restoration windows.
- Model the product after GitHub push protection: block risky uploads, show exact findings locally, allow narrowly scoped bypass with reason, and create an auditable server-side alert when a bypassed or missed secret is detected later.
- Use layered detection: provider-specific regexes, entropy rules, keyword/context rules, structured JSON field rules, and optional validity checks using least-intrusive provider calls where available.
- Keep search, embeddings, analytics, logs, exports, and support tooling downstream of the redacted canonical record. Never build indexes from raw transcripts.
- If a secret is detected after upload, assume compromise until proven otherwise: quarantine affected records, notify the user, provide rotation guidance, purge downstream copies, and record the incident lifecycle.

## Data-flow proposal

### 1. Local transcript collector

Claude Code sessions are commonly represented as local JSONL transcript files under `~/.claude/projects/`, according to Anthropic's Claude Code data documentation and community tooling that reads those files directly ([Anthropic data usage](https://docs.anthropic.com/en/docs/claude-code/data-usage), [Claude Code settings](https://docs.anthropic.com/en/docs/claude-code/settings), [example transcript discussion](https://fazm.ai/blog/claude-code-previous-sessions-jsonl-transcripts)). Orchid should parse transcript JSONL locally and preserve record boundaries so redaction can target message content, tool inputs, tool outputs, file paths, command output, and metadata separately.

Recommended collector behavior:

- Read transcript records in a streaming pipeline to avoid loading large sessions into memory.
- Normalize each event into `transcript_event`, `content_fragment`, and `source_location` records before scanning.
- Attach source coordinates: session id, JSONL line number, JSON pointer path, character offsets, detector id, confidence, and redaction action.
- Treat all raw bytes as ephemeral. Raw content exists only in process memory during scan unless the user chooses local-only restore storage.

### 2. Client-side pre-upload redaction

Before upload, Orchid should run the strongest scanner locally and replace detected secrets with typed placeholders:

```text
[REDACTED_SECRET:aws_access_key_id:det_01HF...]
[REDACTED_SECRET:generic_high_entropy_token:det_01HG...]
[REDACTED_SECRET:private_key_block:det_01HH...]
```

The detector stack should combine:

- Provider-specific patterns for common services, following the same principle as GitHub secret scanning's partner patterns ([GitHub partner program](https://docs.github.com/code-security/secret-scanning/secret-scanning-partner-program)).
- Generic high-entropy matching for unknown tokens, like common secret scanners use alongside regex and contextual validation ([GitGuardian detection overview](https://www.gitguardian.com/solutions/secrets-detection)).
- Structured transcript rules for risky fields: `tool_use.input.command`, `tool_result.content`, shell output, environment dumps, HTTP headers, `.npmrc`, `.pypirc`, `.netrc`, SSH/private key blocks, cloud credential files, and database URLs.
- Context keywords near candidates: `api_key`, `token`, `secret`, `password`, `authorization`, `bearer`, `private_key`, `client_secret`, `session`, `cookie`.
- Allowlist support for test fixtures, public examples, known fake tokens, and user-owned benign patterns.

Client-side upload policy should have three modes:

- `block`: default for high-confidence secrets and private keys. Upload cannot continue until the user redacts, excludes, or bypasses.
- `warn`: medium-confidence findings can upload after user confirmation and reason capture.
- `silent-redact`: low-risk structured values can be automatically replaced, with a local diff available.

This mirrors GitHub push protection's core product pattern: detect before content reaches the server, block the operation, provide immediate feedback, and support controlled bypasses for false positives or intentional values ([GitHub push protection](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection), [working with push protection](https://docs.github.com/code-security/secret-scanning/working-with-secret-scanning-and-push-protection)).

### 3. Upload package

Upload only the sanitized transcript plus a redaction manifest:

```json
{
  "transcriptId": "tr_...",
  "scannerVersion": "2026.05.01",
  "events": "redacted-jsonl-or-batch",
  "redactions": [
    {
      "redactionId": "det_...",
      "detector": "aws_access_key_id",
      "confidence": "high",
      "source": {
        "sessionId": "ses_...",
        "line": 127,
        "jsonPointer": "/message/content/0/text",
        "start": 418,
        "end": 438
      },
      "replacement": "[REDACTED_SECRET:aws_access_key_id:det_...]",
      "action": "irreversible_redaction"
    }
  ]
}
```

Do not upload raw secret values, raw hash digests of full secrets, or reversible tokens by default. If deduplication is necessary, use keyed HMAC fingerprints with a service-held key so a database leak cannot be brute-forced against known token formats.

### 4. Server-side ingestion scanning

The server must distrust client claims and rescan every uploaded fragment before persistence:

- Reject or quarantine uploads where server scanning finds unredacted high-confidence secrets.
- Compare server findings with the client manifest to detect scanner drift or client tampering.
- Persist only redacted content to the primary transcript store, search index, embedding pipeline, support tooling, and analytics events.
- Write redaction metadata and scanner versions to a separate table for audit and future rescans.
- Run provider validity checks only when the detector supports a least-intrusive verification path and the user/workspace policy allows it. GitGuardian documents validity states such as `valid`, `invalid`, `failed to check`, and `cannot check`; Orchid can adopt the state model without relying on any one vendor ([GitGuardian validity checks](https://docs.gitguardian.com/secrets-detection/customize-detection/validity-checks), [GitGuardian FAQ](https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/frequently_asked_questions)).

### 5. Storage model

Use three storage classes:

- `redacted_transcripts`: canonical product data, encrypted at rest, queryable, retained according to workspace policy.
- `redaction_findings`: metadata-only records with detector id, location, confidence, action, scanner version, user decision, and incident links.
- `secret_restore_vault`: optional, disabled by default. Stores original values only when a user explicitly chooses reversible tokenization for restore workflows.

Encrypted storage controls:

- Envelope encryption with per-workspace data encryption keys and KMS-managed key encryption keys.
- Separate keys for transcript content, redaction metadata, and restore vault data.
- Rotation policy based on key exposure, staff access changes, cryptoperiod limits, and customer offboarding, consistent with OWASP and NIST key-management guidance ([OWASP Cryptographic Storage](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html), [NIST SP 800-57 Part 1 Rev. 5](https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final)).
- Cryptographic deletion by destroying per-workspace or per-record DEKs when hard deletion is requested and backups age out.

### 6. Secret vault references

For users who want transcript fidelity without storing secrets, Orchid should support vault references:

```text
export STRIPE_API_KEY=[VAULT_REF:1password:item/abc/field/api_key]
curl -H "Authorization: Bearer [VAULT_REF:op://team/service/token]"
```

Product behavior:

- Store the vault reference, not the secret value.
- Show provider, item label, field label, and access status when available.
- Let users reconnect their local vault integration to render or copy the secret outside Orchid's servers.
- Never dereference vault references in server-side jobs, search indexing, support views, or exports.

This aligns with OWASP's recommendation to centralize and standardize secret storage, access control, auditing, rotation, and lifecycle management rather than scattering secrets through application data ([OWASP Secrets Management](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)).

## Irreversible redaction vs reversible tokenization

### Irreversible redaction

Use irreversible redaction as the default for:

- API keys, access tokens, refresh tokens, cookies, session ids, private keys, OAuth client secrets, SSH keys, database URLs with passwords, and cloud credential files.
- Any secret detected in command output or model text where Orchid cannot prove the user intentionally wanted restore capability.
- All content entering search, embeddings, analytics, support tooling, and logs.

Benefits:

- Lowest breach impact because Orchid never has the original value after upload.
- Simpler deletion and incident response.
- Easier to reason about for users and enterprise buyers.

Costs:

- Redacted transcript replay cannot show exact original commands or outputs.
- False positives may remove useful debugging context unless placeholders preserve type and location.

### Reversible tokenization

Offer reversible tokenization only as an explicit workspace feature for narrow use cases:

- A user wants local restore in their desktop client.
- An enterprise workspace wants short-lived restore for regulated audit workflows.
- A transcript import needs temporary review before permanent redaction.

Implementation requirements:

- Use cryptographic tokenization with a dedicated vault and per-tenant keys. Google Sensitive Data Protection describes reversible tokenization as pseudonymization where re-identification requires both token and cryptographic key; its docs recommend deterministic AES-SIV for reversible cryptographic de-identification ([Google de-identify and re-identify](https://docs.cloud.google.com/sensitive-data-protection/docs/inspect-sensitive-text-de-identify), [Google transformations reference](https://cloud.google.com/sensitive-data-protection/docs/transformations-reference)).
- Keep detokenization out of normal product APIs. Require step-up authentication, role permission, reason, time-limited access, and audit event.
- Never send restored values to AI models, embeddings, logs, analytics, or webhooks.
- Automatically expire restore material and convert to irreversible redaction after a configurable period.

PCI tokenization guidance distinguishes reversible and irreversible tokens and treats the tokenization system itself as sensitive infrastructure ([PCI Tokenization Product Security Guidelines](https://www.pcisecuritystandards.org/documents/Tokenization_Product_Security_Guidelines.pdf)). Orchid should apply the same mental model: if it can restore a secret, that vault is in scope for the highest security tier.

## User override and restore workflows

### Pre-upload review

When the local scanner finds secrets, show a transcript diff grouped by severity:

- High confidence: blocked by default. Actions: redact, exclude event, replace with vault reference, or request bypass.
- Medium confidence: warn by default. Actions: redact, mark as false positive, add local allowlist, or upload with reason.
- Low confidence: auto-redact or mark for review based on workspace policy.

The UI should show detector type, surrounding context, file/session location, and the exact replacement. For actual secret text, reveal only a short masked prefix/suffix locally, never in server-rendered pages.

### Bypass

Bypass must be rare and accountable:

- Require reason: false positive, test credential, public sample, already revoked, business-required.
- Require scope: this finding only, this detector for this transcript, or local allowlist pattern.
- Require expiration for allowlists.
- Sync only metadata to the server, not raw secret values.
- For enterprise workspaces, allow delegated bypass review similar to GitHub's delegated bypass pattern ([GitHub push protection](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection)).

### Restore

Restore is only available for reversible-tokenized values:

- Default restore location is local client memory, not the web app.
- Require step-up authentication and workspace permission.
- Show a restore banner in the transcript and audit trail.
- Restore one value at a time, with copy timeout and clipboard clearing where the platform permits.
- Disable restore for secrets marked compromised, expired, or deleted.

## Implementation phases

### Phase 0: Policy and threat model

- Define secret classes, severities, storage destinations, and incident severity levels.
- Decide default workspace policy: block high confidence, warn medium, auto-redact low.
- Define "no raw secret leaves device" as the default product guarantee.
- Write test fixtures for common transcript leak shapes: `.env`, shell `printenv`, cloud credential files, HTTP auth headers, private keys, package manager tokens, and database URLs.

### Phase 1: Local scanner and redacted upload

- Build streaming JSONL parser and fragment scanner.
- Add provider-specific detectors, entropy detector, private-key detector, URL credential detector, and structured Claude transcript rules.
- Generate redaction manifests with source coordinates.
- Upload only sanitized transcript batches and manifests.
- Add local review UI, bypass reasons, and local allowlists.

### Phase 2: Server ingestion gate

- Rescan uploads before persistence.
- Quarantine mismatches and high-confidence misses.
- Persist only redacted canonical records.
- Add scanner-version tracking and finding lifecycle states.
- Block downstream indexing until ingestion scan passes.

### Phase 3: Background rescans and downstream hygiene

- Rescan historical redacted transcripts when detector rules update.
- Scan object storage, exports, debug logs, analytics payload samples, and search/embedding queues.
- Add sampled storage discovery jobs similar to AWS Macie's continuous sensitive data discovery model for S3 estates ([Amazon Macie automated discovery](https://docs.aws.amazon.com/macie/latest/user/discovery-asdd.html)).
- Add alert routing for newly discovered secrets and scanner drift.

### Phase 4: Vault references and optional tokenization

- Add vault-reference placeholders and local vault integrations.
- Add optional restore vault with strict workspace opt-in.
- Implement detokenization controls, short retention windows, and cryptographic deletion.
- Run security review focused on vault isolation, key management, and audit integrity.

### Phase 5: Enterprise controls

- Workspace policies for detector severity, bypass approval, retention, and export controls.
- SIEM/webhook events for secret findings, bypasses, restores, quarantines, and deletions.
- Admin reporting: mean time to detect, mean time to rotate, bypass rate, false positive rate, scanner coverage, and unresolved incident count.

## UX and product choices

- Make privacy visible without adding friction: each transcript should show "redacted before upload" status, scanner version, and finding count.
- Prefer typed placeholders over generic `[REDACTED]` so transcripts remain useful for debugging and search.
- Preserve enough local context for user decisions, but never display full server-side secret values.
- Give users a "safe import" path: dry-run scan, review findings, then upload.
- Treat secret detection as collaborative rather than punitive. Users need fast fixes: redact all, exclude all command outputs, replace with vault refs, or bypass selected findings.
- Build GitHub-style push protection analogies into language: "Upload blocked because Orchid found credentials" is clearer than "validation failed."
- For false positives, make allowlists local-first and narrow. Global/workspace allowlists should require admin permission and expiration.
- For historical incidents, show a remediation checklist: rotate/revoke, mark rotated, request purge, export audit, close incident.

## Operational controls

### Audit trails

Record security-relevant events separately from application logs:

- Local scan completed, with scanner version and aggregate counts.
- Upload blocked, bypassed, quarantined, or accepted.
- Finding created, confirmed, marked false positive, marked rotated, or closed.
- Restore vault write, read, detokenize, deny, expire, or delete.
- Admin policy changes, allowlist changes, key rotations, export requests, and deletion requests.

OWASP logging guidance says logs should not directly record access tokens, passwords, database connection strings, encryption keys, or other primary secrets; sensitive values should be removed, masked, sanitized, hashed, or encrypted, and logs need tamper and unauthorized-access protection ([OWASP Logging](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)). Orchid audit records should therefore contain finding ids, detector ids, and HMAC fingerprints only when needed, never raw values.

### Retention and deletion

- Default transcript retention should be workspace-configurable, with shorter defaults for raw-adjacent metadata.
- Redaction findings can outlive transcript text only as metadata needed for audit and abuse prevention.
- Restore vault values should have the shortest retention: hours or days, not months.
- Deletion must cover canonical storage, object storage, search indexes, embedding/vector stores, caches, exports, analytics payloads, support snapshots, and backups after backup retention expires.
- Use cryptographic deletion for encrypted blobs where immediate physical deletion is impractical.

### Background rescans

Background rescans are required because detector coverage changes over time:

- Trigger on detector rule updates, newly supported provider patterns, incident intelligence, customer request, or anomalous bypass rates.
- Rescan canonical redacted content, not raw content. This catches missed secrets that survived earlier redaction.
- Rescan downstream stores and queues to verify that no raw-like content escaped the ingestion boundary.
- Use findings to improve client detector packages and force client updates when high-risk detectors change.

### Incident response

If Orchid detects a likely secret after upload:

1. Quarantine affected transcript fragments and pause downstream processing.
2. Create a security finding with severity, detector, location, scanner version, and status.
3. Notify the user or workspace admins with masked evidence and rotation guidance.
4. If validity checks are allowed and safe, classify as valid, invalid, failed to check, cannot check, or unknown.
5. Purge or re-redact affected copies in primary storage, search, embeddings, caches, exports, support snapshots, analytics, and logs.
6. Ask the user to rotate or revoke the secret. For provider-integrated detectors, link to provider-specific remediation docs.
7. Record containment, eradication, recovery, and post-incident review. NIST SP 800-61 frames incident handling around preparation, detection and analysis, containment/eradication/recovery, and post-incident activity ([NIST SP 800-61 Rev. 1](https://csrc.nist.gov/pubs/sp/800/61/r1/final)).
8. Feed the missed pattern into local and server detector updates, then rescan impacted workspaces.

Severity guidance:

- `critical`: private key, cloud root/admin token, active OAuth refresh token, production database URL, or secret confirmed valid.
- `high`: high-confidence provider token with unknown validity, SSH key, signing key, package publishing token.
- `medium`: generic high-entropy credential with strong context or test-looking provider token.
- `low`: low-confidence candidate, public example, already-redacted value, or expired token evidence.

## Risks and open questions

- Detection is probabilistic. Regex, entropy, and context rules will miss unknown formats and create false positives.
- Validity checks can reduce noise but may create privacy, network, provider-rate-limit, and liability concerns. Orchid needs per-workspace policy and a "do not verify" mode.
- Reversible tokenization materially expands risk. It should remain opt-in, isolated, and time-limited.
- HMAC fingerprints help deduplicate incidents but may still be sensitive if implemented with weak keys or exposed through logs.
- Embeddings can memorize or expose sensitive strings if raw content reaches them. The architecture depends on making redacted canonical content the only input to embedding jobs.
- Support workflows are a common bypass around product controls. Support tools must see the same redacted records as users unless explicit break-glass is approved and audited.
- Backups complicate deletion promises. Product copy should distinguish immediate logical deletion, cryptographic deletion, and physical backup expiry.
- Local restore workflows require platform-specific clipboard, filesystem, and keychain behavior.
- Enterprise customers may demand bring-your-own-key or region-specific processing; this affects KMS, backups, support access, and scanner deployment.
- Orchid needs a policy for user-uploaded transcripts that already contain another person's secrets, especially in shared workspaces.

## Source links

- Anthropic Claude Code data usage: https://docs.anthropic.com/en/docs/claude-code/data-usage
- Anthropic Claude Code settings: https://docs.anthropic.com/en/docs/claude-code/settings
- Claude Code JSONL transcript discussion: https://fazm.ai/blog/claude-code-previous-sessions-jsonl-transcripts
- GitHub push protection: https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection
- GitHub working with secret scanning and push protection: https://docs.github.com/code-security/secret-scanning/working-with-secret-scanning-and-push-protection
- GitHub secret scanning partner program: https://docs.github.com/code-security/secret-scanning/secret-scanning-partner-program
- GitGuardian validity checks: https://docs.gitguardian.com/secrets-detection/customize-detection/validity-checks
- GitGuardian secrets detection overview: https://www.gitguardian.com/solutions/secrets-detection
- GitGuardian FAQ on validation: https://docs.gitguardian.com/secrets-detection/secrets-detection-engine/frequently_asked_questions
- OWASP Secrets Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Cryptographic Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- NIST SP 800-57 Part 1 Rev. 5: https://csrc.nist.gov/pubs/sp/800/57/pt1/r5/final
- NIST SP 800-61 Rev. 1: https://csrc.nist.gov/pubs/sp/800/61/r1/final
- Google Sensitive Data Protection de-identify/re-identify: https://docs.cloud.google.com/sensitive-data-protection/docs/inspect-sensitive-text-de-identify
- Google Sensitive Data Protection transformations: https://cloud.google.com/sensitive-data-protection/docs/transformations-reference
- Amazon Macie automated sensitive data discovery: https://docs.aws.amazon.com/macie/latest/user/discovery-asdd.html
- PCI Tokenization Product Security Guidelines: https://www.pcisecuritystandards.org/documents/Tokenization_Product_Security_Guidelines.pdf
