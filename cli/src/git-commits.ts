/**
 * Pure parsing for the deterministic commit↔session backfill.
 *
 * `orchid sync --discover` resolves a session's REAL commits from local git
 * with argv-form git (no shell interpolation):
 *
 *   git -C <dir> log --no-merges \
 *     --pretty=format:%H%x00%cI%x00%s%x00%D \
 *     --since=<start> --until=<end> --author=<email|name>
 *
 * Each line is four NUL-separated (%x00) fields:
 *   %H  full commit SHA
 *   %cI committer date, strict ISO-8601
 *   %s  subject (first line of the message)
 *   %D  ref names (e.g. "HEAD -> main, origin/main") — may be empty
 *
 * These functions are side-effect-free so they can be unit-tested without a
 * real git repo: feed them raw `git log` stdout, get back commit objects.
 */

export interface ResolvedCommit {
  readonly sha: string;
  readonly committed_at: string | null;
  readonly message: string | null;
  readonly branch: string | null;
}

// The NUL byte git emits for %x00. Using NUL (not a space) as the field
// separator so a commit subject containing spaces/commas can never be
// mis-split into the wrong field.
const FIELD_SEPARATOR = '\x00';

// Derive a single branch-ish name from git's %D ref-decoration string, e.g.
//   "HEAD -> feat/x, origin/feat/x, tag: v1" -> "feat/x"
// Strategy: split on commas, strip the "HEAD -> " arrow, drop tag: refs and a
// bare "HEAD", prefer a local branch (no "origin/") over a remote one, and fall
// back to the first remaining ref. Returns null when nothing usable remains.
export const branchFromRefDecoration = (decoration: string): string | null => {
  const refs = decoration
    .split(',')
    .map((ref) => ref.trim())
    .map((ref) =>
      ref.startsWith('HEAD -> ') ? ref.slice('HEAD -> '.length) : ref,
    )
    .filter((ref) => ref !== '' && ref !== 'HEAD' && !ref.startsWith('tag:'));

  const localBranch = refs.find((ref) => !ref.startsWith('origin/'));
  return localBranch ?? refs[0] ?? null;
};

// Parse one `%H%x00%cI%x00%s%x00%D` line into a commit, or null when the line is
// blank or the SHA is missing (defensive — a well-formed git log won't hit it).
export const parseGitLogLine = (line: string): ResolvedCommit | null => {
  if (line.trim() === '') return null;
  const [sha = '', committedAt = '', subject = '', decoration = ''] =
    line.split(FIELD_SEPARATOR);
  const trimmedSha = sha.trim();
  if (trimmedSha === '') return null;

  const message = subject.trim();
  return {
    sha: trimmedSha,
    committed_at: committedAt.trim() === '' ? null : committedAt.trim(),
    message: message === '' ? null : message,
    branch: branchFromRefDecoration(decoration),
  };
};

// Parse full `git log` stdout (the %H%x00%cI%x00%s%x00%D format) into commits,
// dropping blank/garbage lines. Pure: no git, no IO.
export const parseGitLog = (stdout: string): readonly ResolvedCommit[] =>
  stdout
    .split('\n')
    .map(parseGitLogLine)
    .filter((commit): commit is ResolvedCommit => commit !== null);

// The git-log pretty format string the backfill passes to `git log`. Exported so
// the command and any test reference the exact same format.
export const GIT_LOG_PRETTY_FORMAT = 'format:%H%x00%cI%x00%s%x00%D';
