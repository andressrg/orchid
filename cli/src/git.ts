import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface GitMetadata {
  readonly user_name: string;
  readonly user_email: string;
  readonly branch: string;
  readonly git_remotes: readonly string[];
  readonly working_dir: string;
}

export const execGit = (args: readonly string[], cwd?: string): string => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
};

const isGitRepo = (dir: string): boolean =>
  execGit(['rev-parse', '--git-dir'], dir) !== '';

const tryReadDir = (dir: string): readonly fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const collectRemotes = (workingDir: string): readonly string[] => {
  const rootOrigin = isGitRepo(workingDir)
    ? execGit(['remote', 'get-url', 'origin'], workingDir)
    : '';
  const childOrigins = tryReadDir(workingDir)
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules',
    )
    .map((entry) => path.join(workingDir, entry.name))
    .filter(isGitRepo)
    .map((subDir) => execGit(['remote', 'get-url', 'origin'], subDir))
    .filter((origin) => origin.length > 0);

  return [...new Set([...(rootOrigin ? [rootOrigin] : []), ...childOrigins])];
};

export const collectGitMetadata = (workingDir = process.cwd()): GitMetadata => {
  const branch = execGit(['rev-parse', '--abbrev-ref', 'HEAD'], workingDir);
  return {
    user_name: execGit(['config', 'user.name']) || 'unknown',
    user_email: execGit(['config', 'user.email']) || 'unknown',
    branch: !branch || branch === 'HEAD' ? 'detached' : branch,
    git_remotes: collectRemotes(workingDir),
    working_dir: workingDir,
  };
};
