// Resolve a trustworthy display name for session attribution.
//
// `git config user.name` is unreliable: a repo with botched local config can
// return an empty string or even echo a config-key string like 'user.name' /
// 'user.email'. `git config user.email` is reliably correct, so when the name
// can't be trusted we derive a display name from the email local-part and only
// fall back to a placeholder when both are unusable.

// A botched config commonly yields a bare config key (e.g. 'user.name',
// 'user.email') instead of a real value. Real display names contain spaces,
// capitals, digits, or other punctuation, so a lowercase 'word.word' string is
// almost certainly garbage rather than someone's actual name.
export const looksLikeConfigKey = (s: string): boolean =>
  /^[a-z]+\.[a-z]+$/.test(s.trim());

// Pure function — no I/O. Callers read gitName + gitEmail via their existing
// `git config` calls and route the name through here.
export const resolveUserName = ({
  gitName,
  gitEmail,
}: {
  readonly gitName: string;
  readonly gitEmail: string;
}): string => {
  const name = gitName.trim();
  if (name !== '' && !looksLikeConfigKey(name)) return name;

  const local = (gitEmail.split('@')[0] ?? '').trim();
  if (local !== '') {
    return local
      .replace(/[._-]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return 'unknown';
};
