import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { looksLikeConfigKey, resolveUserName } from '../src/git-identity';

// `git config user.name` is unreliable — empty or a botched config that echoes a
// config-key string ('user.name', 'user.email'). These tests pin the resolver's
// behaviour: trust a real name, otherwise derive a display name from the email
// local-part, and only fall back to 'unknown' when both are unusable.

describe('looksLikeConfigKey', () => {
  it('flags bare config-key strings', () => {
    assert.equal(looksLikeConfigKey('user.email'), true);
    assert.equal(looksLikeConfigKey('user.name'), true);
    assert.equal(looksLikeConfigKey('  user.name  '), true);
  });

  it('does not flag real names', () => {
    assert.equal(looksLikeConfigKey('Julian Kmazo'), false); // has a space
    assert.equal(looksLikeConfigKey('octocat'), false); // single token, no dot
    assert.equal(looksLikeConfigKey(''), false);
    assert.equal(looksLikeConfigKey('A.b'), false); // a capital → not a config key
  });
});

describe('resolveUserName', () => {
  it('passes a real configured name through unchanged', () => {
    assert.equal(
      resolveUserName({
        gitName: 'Julian Kmazo',
        gitEmail: 'julian.kmazo@gmail.com',
      }),
      'Julian Kmazo',
    );
  });

  it('rejects a config-key name and derives from the email local-part', () => {
    assert.equal(
      resolveUserName({
        gitName: 'user.email',
        gitEmail: 'julian.kmazo@gmail.com',
      }),
      'Julian Kmazo',
    );
  });

  it('derives from the email local-part when the name is empty', () => {
    assert.equal(
      resolveUserName({ gitName: '', gitEmail: 'julian.kmazo@gmail.com' }),
      'Julian Kmazo',
    );
  });

  it('derives from the email local-part when the name is whitespace', () => {
    assert.equal(
      resolveUserName({ gitName: '   ', gitEmail: 'jane_doe@example.com' }),
      'Jane Doe',
    );
  });

  it('handles single-token email local-parts', () => {
    assert.equal(
      resolveUserName({ gitName: '', gitEmail: 'octocat@github.com' }),
      'Octocat',
    );
  });

  it('falls back to "unknown" when name and email are both empty', () => {
    assert.equal(resolveUserName({ gitName: '', gitEmail: '' }), 'unknown');
  });

  it('falls back to "unknown" when name is a config key and email is empty', () => {
    assert.equal(
      resolveUserName({ gitName: 'user.name', gitEmail: '' }),
      'unknown',
    );
  });

  it('trims surrounding whitespace from a real name', () => {
    assert.equal(
      resolveUserName({ gitName: '  Ada Lovelace  ', gitEmail: '' }),
      'Ada Lovelace',
    );
  });
});
