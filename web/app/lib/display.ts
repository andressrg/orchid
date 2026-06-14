// Display-only helpers for rendering session metadata. None of these affect
// ownership or scoping (that is keyed on user_id); they only make existing rows
// read nicely at render time, with no re-sync needed.

// Returns a friendly name for a session's user. Falls back to a title-cased
// email local-part when `user_name` is missing or a placeholder/garbage value
// ('unconfigured', 'unknown', or a config-key-like 'user.email'). When neither a
// usable name nor an email is available, returns 'Unknown'.
export const friendlyUserName = (
  name: string | null | undefined,
  email: string | null | undefined,
): string => {
  const n = (name ?? '').trim();
  const bad = n === '' || n === 'unconfigured' || n === 'unknown' || /^[a-z]+\.[a-z]+$/.test(n);
  if (!bad) return n;
  const local = (email ?? '').split('@')[0] ?? '';
  return local ? local.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Unknown';
};
