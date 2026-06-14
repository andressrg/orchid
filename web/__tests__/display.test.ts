import { describe, it, expect } from 'vitest';
import { friendlyUserName } from '@/app/lib/display';

// friendlyUserName is display-only: it cleans up existing rows at render time
// (no re-sync). A real name passes through; placeholder/garbage names fall back
// to a title-cased email local-part; nothing usable yields 'Unknown'.
describe('friendlyUserName', () => {
  it('passes a real name through unchanged', () => {
    expect(friendlyUserName('Julian Mazo', 'julian@snappr.com')).toBe('Julian Mazo');
    expect(friendlyUserName('Ada', 'ada@example.com')).toBe('Ada');
  });

  it('falls back to the email local-part for placeholder names', () => {
    expect(friendlyUserName('unconfigured', 'jane.doe@example.com')).toBe('Jane Doe');
    expect(friendlyUserName('unknown', 'sam@example.com')).toBe('Sam');
    expect(friendlyUserName('', 'a_b-c@example.com')).toBe('A B C');
  });

  it('treats a config-key-like name (user.email) as garbage', () => {
    expect(friendlyUserName('user.email', 'real.person@example.com')).toBe('Real Person');
  });

  it('does not treat a normal name with no dot as garbage', () => {
    expect(friendlyUserName('Julian', 'x@example.com')).toBe('Julian');
  });

  it('handles null/undefined name and email', () => {
    expect(friendlyUserName(null, 'pat@example.com')).toBe('Pat');
    expect(friendlyUserName(undefined, undefined)).toBe('Unknown');
    expect(friendlyUserName('unknown', null)).toBe('Unknown');
    expect(friendlyUserName('unknown', '')).toBe('Unknown');
  });
});
