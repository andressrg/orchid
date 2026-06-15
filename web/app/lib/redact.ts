/**
 * Deterministic server-side secret redaction at ingest (Phase T, T-1 + T-2).
 *
 * The TRUST guarantee: "we never store your secrets." Known secret formats are
 * redacted on the WRITE path BEFORE the transcript is persisted, so raw secrets
 * never reach the DB, the tsvector search index, commit extraction, or Claude.
 *
 * Design principles:
 *  - HIGH CONFIDENCE only. Every detector is prefix-anchored and length-bounded
 *    so a real-world secret matches but ordinary prose/code does not. We do NOT
 *    do entropy/base64 scanning here — that would corrupt legitimate content and
 *    is an explicit follow-up (see PR body). Forward protection at ingest is the
 *    simplest thing that meets the guarantee.
 *  - DETERMINISTIC: same input always yields the same output (pure function,
 *    no clocks/randomness).
 *  - IDEMPOTENT: re-running on already-redacted text changes nothing. The
 *    replacement placeholders (`[REDACTED:<type>]`) contain no characters that
 *    any detector matches, so a second pass is a no-op.
 *  - SECRET-FREE FINDINGS: findings carry only `{ type, count }`, never any raw
 *    secret bytes.
 *
 * PERFORMANCE: this runs on every PUT /sessions/:id over potentially large
 * transcripts. Every pattern is LINEAR — single bounded character classes, no
 * nested quantifiers, no overlapping alternations that backtrack. There is no
 * construct like `(a+)+` or `(.*)*`, so worst-case time is O(n) in the transcript
 * length per detector, and O(detectors * n) overall (detectors is a small fixed
 * constant). The private-key block uses a lazy, bounded inner class that cannot
 * catastrophically backtrack.
 */

export interface SecretDetector {
  readonly type: string;
  readonly pattern: RegExp;
  readonly replace?: (m: string, ...g: string[]) => string;
}

export interface RedactionFinding {
  readonly type: string;
  readonly count: number;
}

export interface RedactionResult {
  readonly redacted: string;
  readonly findings: readonly RedactionFinding[];
}

const placeholder = (type: string): string => `[REDACTED:${type}]`;

// Order matters: the private-key block runs FIRST so a PEM body (which contains
// long base64 lines) is removed before narrower key detectors see it. The
// anthropic key runs before the openai key, and the openai pattern carries a
// negative lookahead, so `sk-ant-...` is never also matched as an openai key.
//
// Every pattern is `g`-flagged (global) so `String.replace` walks the whole
// transcript. `[\s\S]` is used instead of `.` where newlines must be crossed so
// behavior is independent of the `s`/dotAll flag.
const DETECTORS: readonly SecretDetector[] = [
  {
    // PEM private-key block (RSA/EC/OPENSSH/DSA/PGP or generic). Lazy inner
    // `[\s\S]*?` is bounded by the literal END line, so it cannot backtrack
    // catastrophically — there is exactly one terminator to find.
    type: 'private_key',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  {
    // JSON Web Token: three base64url segments. Anchored on the `eyJ` header.
    type: 'jwt',
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  {
    type: 'anthropic_key',
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    // OpenAI key. Negative lookahead excludes the anthropic `sk-ant-` prefix so
    // the two never collide; supports the optional `proj-` segment. The body
    // class includes `_` and `-` because modern OpenAI keys (the dominant
    // format today: `sk-proj-…`, `sk-svcacct-…`, `sk-admin-…`) embed both in
    // their bodies. Without them an embedded `-`/`_` would either defeat the
    // `{20,}` quantifier entirely (TOTAL MISS — the whole key survives) or stop
    // the match early and leave the secret tail in cleartext (PARTIAL LEAK).
    // The `(?!ant-)` lookahead still makes anthropic keys win their own detector.
    type: 'openai_key',
    pattern: /sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  },
  {
    type: 'stripe_key',
    pattern: /(?:sk|rk)_live_[A-Za-z0-9]{20,}/g,
  },
  {
    // GitHub personal/OAuth/server/refresh tokens, plus fine-grained PATs.
    type: 'github_token',
    pattern: /gh[posur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}/g,
  },
  {
    type: 'aws_access_key',
    pattern: /(?:AKIA|ASIA)[0-9A-Z]{16}/g,
  },
  {
    type: 'google_api_key',
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
  },
  {
    type: 'slack_token',
    pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/g,
  },
  {
    // Credentialed connection strings. Capture scheme+user (g1) and the
    // password (g2); preserve everything but the password so the URL stays
    // diagnosable while the secret is removed.
    type: 'connection_string',
    pattern:
      /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s/@]+:)([^@\s/]+)(@)/g,
    replace: (_m: string, prefix: string, _password: string, at: string) =>
      `${prefix}${placeholder('connection_password')}${at}`,
  },
];

// Run one detector over the text, returning the new text plus how many matches
// were replaced. Counting happens via a single replace callback (no second scan)
// so the work stays O(n).
const applyDetector = (
  text: string,
  detector: SecretDetector,
): { readonly text: string; readonly count: number } => {
  const counter = { current: 0 };
  const replaced = text.replace(detector.pattern, (...args: readonly string[]) => {
    const next = counter.current + 1;
    // Mutating a local accumulator object inside replace is the one pragmatic
    // exception: regex replace has no functional fold. It never escapes here.
    Object.assign(counter, { current: next });
    return detector.replace
      ? detector.replace(...(args as [string, ...string[]]))
      : placeholder(detector.type);
  });
  return { text: replaced, count: counter.current };
};

/**
 * Redact every known secret format from `text`.
 *
 * Reduces the transcript through the ordered detector list, accumulating both
 * the progressively-redacted text and the per-type findings. Pure, deterministic,
 * and idempotent.
 */
export const redactSecrets = (text: string): RedactionResult =>
  DETECTORS.reduce<RedactionResult>(
    (acc, detector) => {
      const { text: nextText, count } = applyDetector(acc.redacted, detector);
      return {
        redacted: nextText,
        findings: count > 0 ? [...acc.findings, { type: detector.type, count }] : acc.findings,
      };
    },
    { redacted: text, findings: [] },
  );
