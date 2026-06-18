# ML and LLM Models for Secret and Sensitive Transcript Redaction

## Executive Bullets

- Orchid should use a hybrid regex plus ML pipeline, not a single model. Regex/provider detectors are best for high-confidence API keys, private keys, connection strings, and token formats; ML adds coverage for generic passwords, free-form PII, informal developer chat, and context-dependent snippets.
- Treat developer and AI transcripts as untrusted content. If an LLM is used to classify or redact transcript text, isolate it from tools, force structured output, and never allow transcript instructions to control the scanner.
- For local synchronous scanning, the strongest practical baseline is deterministic secret scanning plus a compact token classifier such as Piiranha or a GLiNER PII model. Use an LLM only for ambiguous spans, policy classification, and batch/offline review.
- GLiNER-style general NER is attractive because Orchid can define entity labels at runtime, including project-specific labels like "API credential", "session token", "customer identifier", "private endpoint", and "internal incident detail". It is less reliable than regex for exact provider secrets.
- Fine-tuned encoder token classifiers remain the best latency/quality tradeoff for PII spans. They are cheaper, easier to run locally, and safer than sending raw transcripts to external LLMs.
- LLM-as-judge can improve recall on hard cases, but it introduces prompt-injection, cost, latency, privacy, and nondeterminism risks. Use it behind a conservative first-pass scanner and require evidence spans, confidence, and machine-validated offsets.
- Evaluation must be Orchid-specific. Public PII and secret benchmarks are useful, but transcripts contain pasted shell output, code blocks, stack traces, agent tool logs, MCP config, test credentials, placeholders, and partial tokens that are underrepresented in standard datasets.

## Model and Technique Taxonomy

### 1. Deterministic Secret Detectors

Examples: Gitleaks, TruffleHog, GitHub Secret Scanning, GitGuardian-style engines, custom provider patterns, entropy checks, keyword windows, and optional online validation.

Strengths:

- Very high precision for known token formats such as AWS keys, GitHub tokens, OpenAI keys, Stripe keys, SSH private keys, JWTs, database URLs, OAuth client secrets, and PEM blocks.
- Fast enough to run inline on every transcript chunk.
- Easy to explain in a product UI and easy to tune by provider, file type, and confidence.
- Verification can reduce false positives when safe validation APIs exist.

Weaknesses:

- Generic passwords and custom credentials often have no stable prefix or grammar.
- Entropy-only detections produce false positives on hashes, UUIDs, generated IDs, compressed data, test fixtures, and minified code.
- Conversation context matters. A string that is harmless in code may be a password when preceded by "use this password:".

Relevant sources:

- TruffleHog documents regex, entropy, excluded word lists, and verification-oriented custom detectors: https://github.com/trufflesecurity/trufflehog
- GitHub documents AI-powered generic secret detection for unstructured passwords in Copilot secret scanning: https://docs.github.com/en/code-security/responsible-use/responsible-ai-generic-secrets
- GitHub's engineering writeup describes production lessons for generic password detection beyond regex: https://github.blog/engineering/platform-security/finding-leaked-passwords-with-ai-how-we-built-copilot-secret-scanning/
- GitGuardian's 2025 report emphasizes that generic credentials are a growing blind spot for conventional scanning: https://www.gitguardian.com/state-of-secrets-sprawl-report-2025

### 2. Token Classification and NER Models

Examples: DeBERTa/BERT/RoBERTa token classifiers, multilingual PII detectors, Presidio transformer recognizers, Piiranha, fine-tuned Hugging Face models on AI4Privacy or Gretel datasets.

These models label tokens or spans directly, usually with BIO tags such as `B-EMAIL`, `I-PHONE_NUMBER`, `B-PASSWORD`, or `B-USERNAME`. They are a natural fit for redaction because the output is span-like.

Strengths:

- Good latency and cost profile. Encoder models can run locally on CPU or small GPU.
- More stable than generative LLMs for offset extraction.
- Strong fit for PII: names, emails, addresses, phone numbers, SSNs, dates of birth, usernames, account numbers, and passwords.
- Can be fine-tuned on Orchid transcript examples without teaching a generative model to reproduce secrets.

Weaknesses:

- Label set is fixed unless retrained.
- Context windows are limited. Piiranha, for example, notes a 256-token context limit and recommends splitting longer text.
- Boundary errors are common around code, Markdown, shell output, JSON, and partial tokens.
- Public PII datasets may overrepresent synthetic documents and underrepresent messy developer transcripts.

Candidate models and frameworks:

- Piiranha v1: a fine-tuned mDeBERTa-v3-base model for 17 PII types across six languages. The model card reports strong token detection metrics and highlights passwords, emails, phone numbers, and usernames: https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information
- Microsoft Presidio: a production-oriented PII framework with rule recognizers, context scoring, anonymizers, and external transformer recognizers: https://microsoft.github.io/presidio/samples/python/transformers_recognizer/
- Hugging Face's Presidio Hub experiment shows a practical pattern for scanning datasets with Presidio and reporting PII findings: https://huggingface.co/blog/presidio-pii-detection
- AI4Privacy PII datasets provide supervised data for PII masking and token classification experiments: https://ai4privacy.com/datasets/pii-masking-2m-european/

### 3. GLiNER-Style General NER

GLiNER is a compact bidirectional transformer NER model that can identify arbitrary entity types supplied as natural language labels at runtime. The NAACL 2024 paper positions it between fixed-label NER models and large generative LLMs: more flexible than classic NER, cheaper and more parallelizable than token-generating LLMs.

Strengths:

- Runtime labels are valuable for Orchid. A scanner can ask for `api key`, `password`, `access token`, `private key`, `database credential`, `personal name`, `email address`, `phone number`, `internal hostname`, `customer id`, or product-specific labels without retraining.
- Smaller and more local-friendly than LLM extraction.
- Useful as a second-pass recognizer for text that deterministic scanners did not classify.

Weaknesses:

- Entity-label wording affects results; Orchid will need prompt/label calibration.
- Not a replacement for provider-specific secret scanners.
- Public GLiNER PII variants may have licensing, coverage, or calibration issues that need review before production use.

Relevant sources:

- GLiNER NAACL 2024 paper: https://aclanthology.org/2024.naacl-long.300/
- GLiNER arXiv preprint: https://arxiv.org/abs/2311.08526
- Example GLiNER PII model card with 60+ privacy categories: https://huggingface.co/knowledgator/gliner-pii-small-v1.0
- Gretel's GLiNER PII/PHI model family and dataset references are useful candidates for comparison: https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1

### 4. Small Local Classifiers and Embedding-Based Rerankers

Examples: MiniLM/TinyBERT/ModernBERT-style binary classifiers, small DeBERTa classifiers, local prompt-injection classifiers, embedding similarity against known sensitive-pattern examples, and lightweight rerankers.

Use these for:

- Binary "sensitive or not" classification at chunk level.
- Triage before running expensive LLM review.
- Prompt-injection detection on transcript chunks before an LLM sees them.
- Distinguishing real credentials from placeholders, examples, hashes, and generated IDs.

Strengths:

- Low latency and local deployment.
- Easy to evaluate with binary metrics and threshold curves.
- Can be trained on Orchid-specific false positives.

Weaknesses:

- A chunk-level decision is not enough for redaction; it must be paired with span extraction.
- Classifiers often learn source-specific artifacts and fail on new providers or formatting.
- They can hide errors behind a single confidence score unless paired with evidence spans.

### 5. LLM-as-Judge, Classifier, or Redactor

Examples: GPT-4.1/4o-class models, Claude, Gemini, Llama, Qwen, Mistral, or local small LLMs used to classify sensitive spans, explain redaction decisions, or normalize findings into a schema.

Best uses:

- Ambiguous snippets where regex and token classifiers disagree.
- Policy classification: "is this safe to store?", "should this be blocked, masked, or allowed?", "is this a production credential or a placeholder?"
- Offline review, batch labeling, synthetic test generation, and active-learning workflows.
- Redaction plan generation, not direct unchecked text rewriting.

Required guardrails:

- Use structured outputs with a strict schema for `findings`, `span_text`, `start_offset`, `end_offset`, `type`, `confidence`, `reason`, and `recommended_action`.
- Validate every returned span against the original text. Reject findings whose offsets do not match exact substrings.
- Give the model no external tools and no secrets beyond the chunk under inspection.
- Wrap transcript text as data, not instructions. Treat code blocks, Markdown, tool output, and comments as hostile input.
- Prefer extractive output over rewritten full transcripts to reduce accidental leakage or hallucinated redactions.

Relevant sources:

- OpenAI Structured Outputs allow outputs to match a supplied JSON schema with `strict: true`: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI's Structured Outputs launch post describes schema adherence and production use cases: https://openai.com/index/introducing-structured-outputs-in-the-api/
- OWASP ranks prompt injection as a top LLM application risk and recommends defense in depth for untrusted inputs: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- StruQ proposes separating trusted instructions from untrusted data with structured queries: https://arxiv.org/abs/2402.06363
- "How Not to Detect Prompt Injections with an LLM" is relevant cautionary reading for overtrusting LLM-based injection classifiers: https://arxiv.org/abs/2507.05630

### 6. Hybrid Regex + ML Pipelines

This is the production pattern Orchid should prefer.

Pipeline shape:

1. Normalize transcript chunks without destroying offsets: preserve raw text, build a normalized shadow string for detection, and keep offset maps.
2. Run deterministic detectors first: provider regexes, private key block detectors, URLs with credentials, dotenv patterns, connection strings, JWTs, and entropy plus keyword context.
3. Run PII token classifier over remaining text and over a context window around deterministic hits.
4. Run GLiNER or a small local classifier for generic labels and ambiguous conversational snippets.
5. Merge overlapping spans with precedence rules: verified/provider secret > private key > password > PII > internal sensitive snippet.
6. Optionally use LLM review only for uncertain spans, batch mode, or user-triggered "explain/redact more" flows.
7. Redact by spans in code, not by asking a model to rewrite the transcript.

## Comparison Table

| Approach | Best fit | Latency | Privacy | Strengths | Main tradeoffs | Orchid recommendation |
|---|---:|---:|---:|---|---|---|
| Provider regex and checksums | Known API keys, private keys, tokens | Very low | Local | High precision, explainable, deterministic | Misses generic and unknown secrets | Mandatory first pass |
| Entropy plus keyword windows | Generic tokens, random strings near secret words | Very low | Local | Broad catch-all for opaque values | High false positives on hashes and IDs | Use with strict context and suppression rules |
| TruffleHog/Gitleaks-style scanners | Code blocks, repos, shell logs, config snippets | Low | Local | Mature detector libraries, custom rules, optional verification | Built for code more than transcripts | Reuse detector ideas or embed where licensing fits |
| Presidio rule + transformer recognizers | PII in natural language | Low-medium | Local possible | Practical framework, anonymization support, custom recognizers | Requires tuning for developer text | Strong baseline framework |
| Piiranha-style token classifier | PII and passwords in multilingual text | Low-medium | Local | Span output, compact, good fit for inline redaction | Fixed labels, limited context | Evaluate as local PII model |
| GLiNER PII/general NER | Custom entity labels and flexible sensitive snippets | Medium | Local possible | Runtime labels, cheaper than LLMs | Label calibration and confidence tuning | Evaluate as second-pass recognizer |
| Small binary classifier | Sensitive/not-sensitive chunk triage | Very low-low | Local | Cheap gating and false-positive reduction | Does not provide spans | Useful adjunct, not sufficient alone |
| LLM structured extractor | Ambiguous snippets, policy decisions, explanations | Medium-high | Depends on provider | Flexible, strong semantic reasoning | Prompt injection, cost, nondeterminism, privacy | Limited fallback/review path |
| LLM direct redactor | Full transcript rewriting | High | Depends on provider | Simple prototype | Offset loss, hallucination, leakage risk | Avoid for core redaction |
| Online secret verification | Validity/risk confirmation | Medium-high | External calls | Reduces false positives and helps severity | Can create audit/noise risk; unsafe for some providers | Optional, provider-specific, background only |

## Recommended Orchid Approach

### Product Goal

Orchid should optimize for safe local pre-storage and pre-display redaction of developer/AI transcripts. The scanner should prefer recall for high-risk secrets while keeping false positives manageable through confidence, explanations, and user-visible controls.

### Architecture

1. Local synchronous scan on every transcript chunk:
   - Provider token regexes and private-key detectors.
   - URL, dotenv, JSON/YAML/TOML, shell assignment, HTTP header, and stack trace patterns.
   - Entropy only when paired with nearby context terms such as `token`, `secret`, `password`, `apikey`, `authorization`, `bearer`, `client_secret`, `DATABASE_URL`, or `OPENAI_API_KEY`.

2. Local ML span detection:
   - Evaluate Piiranha or a comparable DeBERTa token classifier for PII/password spans.
   - Evaluate GLiNER with Orchid-specific labels for flexible sensitive snippets.
   - Keep models behind an interface that returns exact spans and confidence; do not couple redaction logic to one model.

3. Span merger and policy engine:
   - Canonical finding types: `api_key`, `private_key`, `password`, `session_token`, `connection_string`, `personal_identifier`, `contact_info`, `financial_identifier`, `internal_endpoint`, `customer_data`, `prompt_injection`, `unknown_sensitive`.
   - Store raw findings with detector provenance, confidence, span offsets, redaction action, and whether the match is exact, inferred, or validated.
   - Redaction actions: `mask_full`, `mask_middle`, `hash_reference`, `block_storage`, `allow_with_warning`.

4. LLM fallback only for low-confidence or high-value cases:
   - Use strict structured outputs.
   - Request extractive spans only.
   - Disable tools.
   - Validate offsets and span text before trusting output.
   - Do not send raw high-confidence secrets to a third-party LLM. Replace deterministic secret values with stable placeholders before LLM review when possible.

5. Background improvement loop:
   - Collect user corrections and false-positive suppressions.
   - Build an Orchid-specific eval corpus from synthetic transcripts, real redacted examples, and seeded canary secrets.
   - Fine-tune or threshold local models only after the eval set is stable.

### Initial Model Shortlist

- Deterministic baseline: TruffleHog/Gitleaks-inspired detectors plus Orchid custom transcript patterns.
- PII token classifier: Piiranha v1 and one Presidio-compatible transformer recognizer.
- Flexible NER: GLiNER base plus a PII-tuned GLiNER variant.
- Optional LLM review: a strong structured-output model for offline evaluation and difficult cases, not the default inline redactor.

### Why Not LLM-Only?

An LLM-only scanner is slower, harder to test, more expensive, vulnerable to prompt injection, and may leak the very material it is supposed to classify. It also returns spans less reliably than token classifiers unless heavily constrained and validated. LLMs are useful as an escalation layer, labeler, and reviewer, but not as the foundation.

## Evaluation Plan

### Datasets and Benchmarks

Use public datasets for broad coverage:

- SecretBench for software secrets: https://arxiv.org/abs/2303.06729
- AI4Privacy PII masking datasets: https://ai4privacy.com/datasets/pii-masking-2m-european/
- Piiranha model/dataset references for multilingual PII and passwords: https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information
- Gretel PII masking data for synthetic PII/PHI patterns: https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1

Build an Orchid-specific eval set:

- AI assistant transcripts with pasted `.env`, shell commands, stack traces, HTTP requests, JSON payloads, YAML configs, MCP configs, package manager logs, and CI logs.
- Positive examples: real-format fake keys, provider tokens, private keys, JWTs, database URLs, passwords, emails, phone numbers, customer IDs, internal hostnames, and support snippets.
- Negative examples: placeholders, docs examples, hashes, UUIDs, checksums, public keys, package-lock integrity hashes, test fixtures, lorem ipsum, generated IDs, and redacted values.
- Adversarial examples: split secrets across lines, Markdown tables, zero-width characters, base64 wrappers, quoted tool output, "ignore previous instructions" text, and nested code fences.

### Metrics

- Span-level precision, recall, and F1 with exact and overlap matching.
- Entity-level recall for high-risk classes: private keys, provider API keys, passwords, connection strings, and session tokens.
- False positives per 1,000 transcript lines.
- Redaction boundary quality: no leaked prefix/suffix beyond policy, no broken Markdown/code rendering where avoidable.
- Latency p50/p95/p99 per chunk on target local hardware.
- Cost per 1,000 transcript chunks for any remote LLM fallback.
- Stability under prompt-injection text: LLM fallback must keep schema validity and extractive behavior.

### Test Protocol

1. Start with deterministic scanners and measure high-risk secret recall.
2. Add PII token classifier and measure incremental recall and false positives.
3. Add GLiNER and test custom labels, especially generic credentials and internal snippets.
4. Add LLM fallback on only uncertain examples and measure marginal value versus cost and latency.
5. Run ablations by transcript source: chat, code block, terminal output, agent tool log, generated patch, config file.
6. Maintain a regression suite of previously missed secrets and false positives.

## Risks and Open Questions

- Prompt injection against the scanner: untrusted transcripts may contain instructions to ignore policies, reveal system prompts, or output invalid JSON. Mitigation: data/instruction separation, no tools, strict schemas, span validation, and no LLM-only decisions for high-risk material.
- Privacy and compliance: sending raw transcripts to remote LLMs may be unacceptable. Mitigation: local-first scanning, placeholder substitution before LLM review, and explicit deployment controls.
- False positives in developer text: hashes, UUIDs, test tokens, public examples, and generated IDs are common. Mitigation: provenance, context windows, allowlists, and user correction feedback.
- False negatives for partial or transformed secrets: transcripts may include split tokens, screenshots converted to OCR, base64, or tool output truncation. Mitigation: normalization passes, chunk overlap, and canary tests.
- Offset drift: Unicode, Markdown normalization, and chunking can break span redaction. Mitigation: immutable raw text, offset maps, and exact substring validation.
- Model licensing: some useful Hugging Face models and datasets may not allow commercial use. Mitigation: review licenses before shipping and keep model adapters swappable.
- Dataset mismatch: public PII datasets do not fully represent AI agent transcripts. Mitigation: build Orchid-specific eval data before choosing thresholds.
- Online verification safety: verifying secrets can create provider audit events or accidentally exercise live credentials. Mitigation: background-only verification, provider-specific safe methods, rate limits, and customer opt-in.
- User trust: over-redaction can make transcripts useless; under-redaction can be catastrophic. Mitigation: severity levels, reversible local masking for authorized users, and clear detector provenance.

## Source Links

- GLiNER NAACL 2024: https://aclanthology.org/2024.naacl-long.300/
- GLiNER arXiv: https://arxiv.org/abs/2311.08526
- GLiNER multi-task arXiv: https://arxiv.org/abs/2406.12925
- Knowledgator GLiNER PII model: https://huggingface.co/knowledgator/gliner-pii-small-v1.0
- Piiranha PII token classifier: https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information
- Microsoft Presidio transformer recognizer sample: https://microsoft.github.io/presidio/samples/python/transformers_recognizer/
- Hugging Face Presidio PII detection blog: https://huggingface.co/blog/presidio-pii-detection
- AI4Privacy datasets: https://ai4privacy.com/datasets/pii-masking-2m-european/
- Gretel PII masking dataset: https://huggingface.co/datasets/gretelai/gretel-pii-masking-en-v1
- SecretBench paper: https://arxiv.org/abs/2303.06729
- TruffleHog repository and detector docs: https://github.com/trufflesecurity/trufflehog
- GitHub responsible AI generic secret detection docs: https://docs.github.com/en/code-security/responsible-use/responsible-ai-generic-secrets
- GitHub Copilot secret scanning engineering writeup: https://github.blog/engineering/platform-security/finding-leaked-passwords-with-ai-how-we-built-copilot-secret-scanning/
- GitGuardian State of Secrets Sprawl 2025: https://www.gitguardian.com/state-of-secrets-sprawl-report-2025
- GitGuardian State of Secrets Sprawl 2026: https://www.gitguardian.com/state-of-secrets-sprawl-report-2026
- Microsoft Security Copilot Secret Finder announcement: https://techcommunity.microsoft.com/t5/microsoft-security-copilot-blog/introducing-agentic-secret-finder-finding-real-credentials-where/ba-p/4500983
- OpenAI Structured Outputs docs: https://platform.openai.com/docs/guides/structured-outputs
- OpenAI Structured Outputs launch post: https://openai.com/index/introducing-structured-outputs-in-the-api/
- OWASP LLM01 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP Prompt Injection Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html
- StruQ structured queries paper: https://arxiv.org/abs/2402.06363
- How Not to Detect Prompt Injections with an LLM: https://arxiv.org/abs/2507.05630
- SecretLoc LLM-based hardcoded secret detection in Android apps: https://arxiv.org/abs/2510.18601
