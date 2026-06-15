import { describe, it, expect } from 'vitest';
import { redactSecrets } from '@/app/lib/redact';

// Build secret-SHAPED fixtures at runtime from a prefix + an obviously-fake
// body. This keeps the literal source free of anything a credential scanner
// (e.g. GitHub push protection) would treat as a real leaked key, while the
// assembled string still exercises each detector's pattern. The bodies are
// uppercase "EXAMPLE/FAKE" filler, never a high-entropy or checksum-valid value.
const fakeBody = (length: number): string =>
  'EXAMPLEFAKE0NOTAREALSECRET'.repeat(8).slice(0, length);
const secretShaped = (prefix: string, bodyLength: number): string =>
  `${prefix}${fakeBody(bodyLength)}`;

// redactSecrets is the deterministic server-side ingest scrubber (Phase T,
// T-1/T-2). The contract that matters:
//  - Every known secret format is replaced by `[REDACTED:<type>]` and the raw
//    secret bytes are GONE from the output.
//  - High-confidence only: ordinary prose/code/URLs/SHAs pass through unchanged
//    (no false positives that would corrupt real content).
//  - Deterministic + idempotent: redact(redact(x)) === redact(x).
//  - Findings carry only { type, count } — never any raw secret.

// A realistic-but-fake private key body (base64-ish; not a real key).
const PRIVATE_KEY = [
  '-----BEGIN RSA PRIVATE KEY-----',
  'MIIEowIBAAKCAQEA3Tz2mr7SZiAMfQyuvBjM9Oi9w8fV2bQ4Xa1zXyZ9aBcDeFg',
  'hIjKlMnOpQrStUvWxYz0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJ',
  '-----END RSA PRIVATE KEY-----',
].join('\n');

describe('redactSecrets — per-detector replacement and raw-secret removal', () => {
  it('private_key: PEM block is removed', () => {
    const { redacted, findings } = redactSecrets(`before\n${PRIVATE_KEY}\nafter`);
    expect(redacted).toContain('[REDACTED:private_key]');
    expect(redacted).not.toContain('BEGIN RSA PRIVATE KEY');
    expect(redacted).not.toContain('MIIEowIBAAKCAQEA');
    expect(redacted.startsWith('before')).toBe(true);
    expect(redacted.endsWith('after')).toBe(true);
    expect(findings).toContainEqual({ type: 'private_key', count: 1 });
  });

  it('private_key: OPENSSH variant block is removed', () => {
    const key = [
      '-----BEGIN OPENSSH PRIVATE KEY-----',
      'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz',
      '-----END OPENSSH PRIVATE KEY-----',
    ].join('\n');
    const { redacted } = redactSecrets(key);
    expect(redacted).toBe('[REDACTED:private_key]');
  });

  it('jwt: token is replaced and raw value absent', () => {
    // Assembled at runtime from base64url-shaped fake segments so the literal
    // source isn't a scannable JWT, while still matching the three-segment shape.
    const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJleGFtcGxlIn0', 'c2lnbmF0dXJlX2Zha2U'].join(
      '.',
    );
    const { redacted, findings } = redactSecrets(`token: ${jwt}`);
    expect(redacted).toBe('token: [REDACTED:jwt]');
    expect(redacted).not.toContain(jwt);
    expect(findings).toContainEqual({ type: 'jwt', count: 1 });
  });

  it('anthropic_key: sk-ant- key is replaced and raw value absent', () => {
    const key = secretShaped('sk-ant-api03-', 40);
    const { redacted, findings } = redactSecrets(`ANTHROPIC_API_KEY=${key}`);
    expect(redacted).toBe('ANTHROPIC_API_KEY=[REDACTED:anthropic_key]');
    expect(redacted).not.toContain(key);
    expect(findings).toContainEqual({ type: 'anthropic_key', count: 1 });
  });

  it('openai_key: sk- key is replaced, and an anthropic key is NOT mislabeled openai', () => {
    const openai = secretShaped('sk-proj-', 40);
    const { redacted, findings } = redactSecrets(`OPENAI_API_KEY=${openai}`);
    expect(redacted).toBe('OPENAI_API_KEY=[REDACTED:openai_key]');
    expect(redacted).not.toContain(openai);
    expect(findings).toContainEqual({ type: 'openai_key', count: 1 });

    // An anthropic key must be redacted as anthropic, never as openai.
    const anthropic = secretShaped('sk-ant-api03-', 30);
    const r2 = redactSecrets(anthropic);
    expect(r2.redacted).toBe('[REDACTED:anthropic_key]');
    expect(r2.findings.some((f) => f.type === 'openai_key')).toBe(false);
  });

  it('openai_key: modern key whose body contains - and _ is FULLY redacted (no leak)', () => {
    // Real modern OpenAI keys (`sk-proj-…`, `sk-svcacct-…`, `sk-admin-…`) embed
    // both `-` and `_` in their bodies — the prior `[A-Za-z0-9]`-only body class
    // missed them. We assemble a fake key from the ACTUAL OpenAI alphabet:
    //  - `-` and `_` appear within the FIRST 20 body chars (the TOTAL-MISS case:
    //    a body class without them never satisfies `{20,}`, so the whole key
    //    survives), and
    //  - a distinctive tail (the PARTIAL-LEAK case: a too-narrow class stops the
    //    match early and leaves the tail in cleartext).
    const tail = 'TheSecretTail_must-not-survive_XYZ';
    const key = `sk-proj-aB3_Cd2-eF4_gH5-${tail}`;
    const { redacted, findings } = redactSecrets(`OPENAI_API_KEY=${key}`);

    // Whole key is replaced — placeholder only, nothing of the key remains.
    expect(redacted).toBe('OPENAI_API_KEY=[REDACTED:openai_key]');
    expect(redacted).not.toContain(key);
    // No portion of the body — neither the early mixed segment nor the tail —
    // survives in cleartext anywhere in the output.
    expect(redacted).not.toContain(tail);
    expect(redacted).not.toContain('aB3_Cd2-');
    expect(redacted).not.toContain('sk-proj-');
    expect(findings).toContainEqual({ type: 'openai_key', count: 1 });

    // The service-account variant shares the same body alphabet.
    const svc = 'sk-svcacct-Q1_w2-E3_r4-T5_y6-AnotherFakeTail_z';
    const r2 = redactSecrets(svc);
    expect(r2.redacted).toBe('[REDACTED:openai_key]');
    expect(r2.redacted).not.toContain('AnotherFakeTail');
  });

  it('stripe_key: live secret/restricted key is replaced', () => {
    const sk = secretShaped('sk_live_', 30);
    const rk = secretShaped('rk_live_', 30);
    const { redacted, findings } = redactSecrets(`${sk} and ${rk}`);
    expect(redacted).toBe('[REDACTED:stripe_key] and [REDACTED:stripe_key]');
    expect(redacted).not.toContain(sk);
    expect(redacted).not.toContain(rk);
    expect(findings).toContainEqual({ type: 'stripe_key', count: 2 });
  });

  it('github_token: classic token and fine-grained PAT are replaced', () => {
    const ghp = `ghp_${'A'.repeat(36)}`;
    const pat = `github_pat_${'B'.repeat(22)}_${'c'.repeat(20)}`;
    const { redacted, findings } = redactSecrets(`${ghp}\n${pat}`);
    expect(redacted).toBe('[REDACTED:github_token]\n[REDACTED:github_token]');
    expect(redacted).not.toContain(ghp);
    expect(redacted).not.toContain(pat);
    expect(findings).toContainEqual({ type: 'github_token', count: 2 });
  });

  it('aws_access_key: AKIA/ASIA key is replaced', () => {
    const akia = 'AKIAIOSFODNN7EXAMPLE';
    const { redacted, findings } = redactSecrets(`aws_access_key_id = ${akia}`);
    expect(redacted).toBe('aws_access_key_id = [REDACTED:aws_access_key]');
    expect(redacted).not.toContain(akia);
    expect(findings).toContainEqual({ type: 'aws_access_key', count: 1 });
  });

  it('google_api_key: AIza key is replaced', () => {
    const key = `AIza${'Sy'.repeat(2)}${'D'.repeat(31)}`;
    const { redacted, findings } = redactSecrets(key);
    expect(redacted).toBe('[REDACTED:google_api_key]');
    expect(redacted).not.toContain(key);
    expect(findings).toContainEqual({ type: 'google_api_key', count: 1 });
  });

  it('slack_token: xox token is replaced', () => {
    // Assembled at runtime from obviously-fake parts so the literal source never
    // contains a real-looking Slack token (avoids tripping secret scanners),
    // while still matching the `xox[baprs]-...` detector shape.
    const token = ['xoxb', 'EXAMPLEFAKE', 'NOTAREALTOKEN', 'placeholderonly'].join('-');
    const { redacted, findings } = redactSecrets(`SLACK_BOT_TOKEN=${token}`);
    expect(redacted).toBe('SLACK_BOT_TOKEN=[REDACTED:slack_token]');
    expect(redacted).not.toContain(token);
    expect(findings).toContainEqual({ type: 'slack_token', count: 1 });
  });

  it('connection_string: only the password is redacted; scheme+user preserved', () => {
    const conn = 'postgres://appuser:s3cr3tP%40ss@db.internal:5432/orchid';
    const { redacted, findings } = redactSecrets(`DATABASE_URL=${conn}`);
    expect(redacted).toBe(
      'DATABASE_URL=postgres://appuser:[REDACTED:connection_password]@db.internal:5432/orchid',
    );
    expect(redacted).not.toContain('s3cr3tP%40ss');
    expect(redacted).toContain('postgres://appuser:');
    expect(redacted).toContain('@db.internal:5432/orchid');
    expect(findings).toContainEqual({ type: 'connection_string', count: 1 });
  });

  it('connection_string: covers mysql/mongodb+srv/redis/amqp schemes', () => {
    const lines = [
      'mysql://root:rootpw@127.0.0.1:3306/app',
      'mongodb+srv://svc:mongoPW@cluster0.mongodb.net/db',
      'redis://default:redisSecret@cache:6379',
      'amqp://guest:rabbitPW@broker:5672',
    ].join('\n');
    const { redacted } = redactSecrets(lines);
    expect(redacted).not.toContain('rootpw');
    expect(redacted).not.toContain('mongoPW');
    expect(redacted).not.toContain('redisSecret');
    expect(redacted).not.toContain('rabbitPW');
    expect(redacted.match(/\[REDACTED:connection_password\]/g)?.length).toBe(4);
    expect(redacted).toContain('mysql://root:');
    expect(redacted).toContain('mongodb+srv://svc:');
  });
});

describe('redactSecrets — false-positive safety (MUST pass through unchanged)', () => {
  const passthroughCases: readonly { readonly label: string; readonly text: string }[] = [
    { label: 'bare sk- prefix', text: 'sk-' },
    { label: 'short token sk-abc', text: 'sk-abc' },
    { label: '40-char git SHA', text: 'a'.repeat(40) },
    { label: 'real git SHA hex', text: 'de4db33fcafef00dba5eba11deadbeefca5cade1' },
    { label: 'normal github clone URL', text: 'https://github.com/org/repo.git' },
    { label: 'postgres URL without credentials', text: 'postgres://db.internal:5432/orchid' },
    { label: 'postgres URL host-only', text: 'postgres://localhost/orchid' },
    { label: 'a UUID', text: '550e8400-e29b-41d4-a716-446655440000' },
    { label: 'prose containing the word key', text: 'The API key is stored in the vault.' },
    { label: 'AKIA-looking lowercase word', text: 'akiaisnotakey' },
  ];

  passthroughCases.map(({ label, text }) =>
    it(`leaves unchanged: ${label}`, () => {
      const { redacted, findings } = redactSecrets(text);
      expect(redacted).toBe(text);
      expect(findings).toEqual([]);
    }),
  );
});

describe('redactSecrets — determinism, idempotency, findings, edge cases', () => {
  const anthropicKey = secretShaped('sk-ant-api03-', 40);
  const openaiKey = secretShaped('sk-proj-', 40);
  const multiSecret = [
    `export ANTHROPIC_API_KEY=${anthropicKey}`,
    `export OPENAI_API_KEY=${openaiKey}`,
    'DATABASE_URL=postgres://appuser:s3cr3tpass@db:5432/app',
    `GH=ghp_${'A'.repeat(36)}`,
    'plain text line with no secrets',
  ].join('\n');

  it('idempotent: redacting twice equals redacting once', () => {
    const once = redactSecrets(multiSecret).redacted;
    const twice = redactSecrets(once).redacted;
    expect(twice).toBe(once);
  });

  it('deterministic: same input yields identical output across runs', () => {
    expect(redactSecrets(multiSecret).redacted).toBe(redactSecrets(multiSecret).redacted);
  });

  it('multi-secret snippet: every secret redacted with correct finding counts', () => {
    const { redacted, findings } = redactSecrets(multiSecret);
    expect(redacted).not.toContain(anthropicKey);
    expect(redacted).not.toContain(openaiKey);
    expect(redacted).not.toContain('s3cr3tpass');
    expect(redacted).not.toContain('ghp_AAAA');
    expect(redacted).toContain('plain text line with no secrets');

    const byType = Object.fromEntries(findings.map((f) => [f.type, f.count]));
    expect(byType.anthropic_key).toBe(1);
    expect(byType.openai_key).toBe(1);
    expect(byType.connection_string).toBe(1);
    expect(byType.github_token).toBe(1);
  });

  it('findings never contain raw secret bytes (only type + count)', () => {
    const { findings } = redactSecrets(multiSecret);
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('s3cr3tpass');
    expect(serialized).not.toContain('sk-ant');
    expect(findings.every((f) => Object.keys(f).sort().join(',') === 'count,type')).toBe(true);
  });

  it('empty string: no findings, unchanged', () => {
    const { redacted, findings } = redactSecrets('');
    expect(redacted).toBe('');
    expect(findings).toEqual([]);
  });

  it('secret-free transcript: passes through with no findings', () => {
    const text = '{"role":"user","content":"hello"}\n{"role":"assistant","content":"hi"}';
    const { redacted, findings } = redactSecrets(text);
    expect(redacted).toBe(text);
    expect(findings).toEqual([]);
  });

  it('performance: redacts a large transcript well under budget (no catastrophic backtracking)', () => {
    const big = `${'lorem ipsum dolor sit amet '.repeat(50_000)}${secretShaped('sk-ant-api03-', 40)}`;
    const start = performance.now();
    const { redacted } = redactSecrets(big);
    const elapsed = performance.now() - start;
    expect(redacted).toContain('[REDACTED:anthropic_key]');
    expect(elapsed).toBeLessThan(1000);
  });
});
