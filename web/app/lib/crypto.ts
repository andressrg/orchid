import { randomBytes, createHash } from 'crypto';

const TOKEN_PREFIX = 'orc_';

export function generateToken(): { token: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString('hex');
  const token = `${TOKEN_PREFIX}${raw}`;
  const hash = hashToken(token);
  const prefix = token.slice(0, 12);
  return { token, hash, prefix };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
