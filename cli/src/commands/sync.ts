import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';
import { gzipSync } from 'zlib';
import { getConfig, getAuthHeaders, tryGetConfig } from '../config';
import {
  parseGitLog,
  GIT_LOG_PRETTY_FORMAT,
  type ResolvedCommit,
} from '../git-commits';
import {
  type LocalSession,
  type ProjectGroup,
  displayFileSize,
  displayTokenCount,
  displayShortDate,
  padRight,
  padLeft,
  truncate,
  projectKeyToName,
  tryParseJson,
  extractMessageText,
  sumTokensFromUsage,
  tokenUsageFromTranscriptText,
  groupSessionsByProject,
  markSessionsSynced,
  markGroupSessionsSynced,
  clamp,
  computeScrollOffset,
  parseKeypress,
} from '../sync-utils';
import { resolveUserName } from '../git-identity';

// ── Types ──────────────────────────────────────────────────────────────────

interface SyncResult {
  readonly synced: number;
  readonly failed: number;
  readonly skipped: number;
  readonly syncedIds: ReadonlySet<string>;
}

interface SessionIndexEntry {
  readonly sessionId: string;
  readonly fullPath: string;
  readonly firstPrompt?: string;
  readonly summary?: string;
  readonly messageCount?: number;
  readonly created?: string;
  readonly modified?: string;
  readonly gitBranch?: string;
  readonly projectPath?: string;
}

interface SessionIndex {
  readonly version: number;
  readonly entries: readonly SessionIndexEntry[];
  readonly originalPath?: string;
}

// ── ANSI helpers ───────────────────────────────────────────────────────────

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const extractMetadataFromJsonl = (
  filePath: string,
): Omit<
  LocalSession,
  'filePath' | 'fileSize' | 'projectKey' | 'projectName' | 'synced'
> | null => {
  const fd = (() => {
    try {
      return fs.openSync(filePath, 'r');
    } catch {
      return null;
    }
  })();
  if (fd === null) return null;

  const buf = Buffer.alloc(32 * 1024);
  const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);

  const parsed = buf
    .toString('utf-8', 0, bytesRead)
    .split('\n')
    .filter((l) => l.trim())
    .map(tryParseJson)
    .filter((obj): obj is Record<string, unknown> => obj !== null);

  const meta = parsed.reduce<{
    sessionId: string;
    cwd: string;
    gitBranch: string;
    firstTimestamp: string;
    messageCount: number;
    totalTokens: number;
    firstUserMessage: string;
  }>(
    (acc, obj) => {
      const isUserMsg = obj.type === 'user' || obj.type === 'human';
      const userText =
        isUserMsg && !acc.firstUserMessage
          ? extractMessageText(
              (obj as Record<string, unknown>).message
                ? (
                    (obj as Record<string, unknown>).message as Record<
                      string,
                      unknown
                    >
                  ).content
                : obj.content,
            )
          : '';
      return {
        sessionId: acc.sessionId || (obj.sessionId as string) || '',
        cwd: acc.cwd || (obj.cwd as string) || '',
        gitBranch: acc.gitBranch || (obj.gitBranch as string) || '',
        firstTimestamp: acc.firstTimestamp || (obj.timestamp as string) || '',
        messageCount:
          acc.messageCount + (isUserMsg || obj.type === 'assistant' ? 1 : 0),
        totalTokens: acc.totalTokens + sumTokensFromUsage(obj),
        firstUserMessage: acc.firstUserMessage || userText,
      };
    },
    {
      sessionId: '',
      cwd: '',
      gitBranch: '',
      firstTimestamp: '',
      messageCount: 0,
      totalTokens: 0,
      firstUserMessage: '',
    },
  );

  const sessionId = meta.sessionId || path.basename(filePath, '.jsonl');
  const fileSize = fs.statSync(filePath).size;
  const estimatedMessages =
    meta.messageCount > 0 && bytesRead > 0
      ? Math.round((meta.messageCount / bytesRead) * fileSize)
      : meta.messageCount;
  const estimatedTokens =
    meta.totalTokens > 0 && bytesRead > 0
      ? Math.round((meta.totalTokens / bytesRead) * fileSize)
      : meta.totalTokens;
  const lastTimestamp = (() => {
    try {
      return fs.statSync(filePath).mtime.toISOString();
    } catch {
      return meta.firstTimestamp;
    }
  })();
  const summary = meta.firstUserMessage
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    sessionId,
    cwd: meta.cwd || 'unknown',
    gitBranch: meta.gitBranch || 'unknown',
    firstTimestamp: meta.firstTimestamp || new Date().toISOString(),
    lastTimestamp:
      lastTimestamp || meta.firstTimestamp || new Date().toISOString(),
    messageCount: estimatedMessages,
    totalTokens: estimatedTokens,
    summary,
  };
};

const readSessionIndex = (indexPath: string): SessionIndex | null => {
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as SessionIndex;
  } catch {
    return null;
  }
};

const indexEntryToSession = (
  entry: SessionIndexEntry,
  projectKey: string,
  projectName: string,
  synced: boolean,
): LocalSession => ({
  filePath: fs.existsSync(entry.fullPath) ? entry.fullPath : null,
  sessionId: entry.sessionId,
  projectKey,
  projectName,
  cwd: entry.projectPath || 'unknown',
  gitBranch: entry.gitBranch || 'unknown',
  firstTimestamp: entry.created || new Date().toISOString(),
  lastTimestamp: entry.modified || entry.created || new Date().toISOString(),
  fileSize:
    entry.fullPath && fs.existsSync(entry.fullPath)
      ? (() => {
          try {
            return fs.statSync(entry.fullPath).size;
          } catch {
            return 0;
          }
        })()
      : 0,
  messageCount: entry.messageCount || 0,
  totalTokens: 0,
  summary:
    entry.summary ||
    entry.firstPrompt
      ?.replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim() ||
    '',
  synced,
});

const tryReadDir = (dir: string): fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const tryStatSize = (filePath: string): number | null => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return null;
  }
};

const discoverLocalSessions = (
  syncedIds: ReadonlySet<string>,
): readonly LocalSession[] => {
  const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(claudeProjectsDir)) return [];

  return tryReadDir(claudeProjectsDir)
    .filter((e) => e.isDirectory())
    .flatMap((projEntry) => {
      const projPath = path.join(claudeProjectsDir, projEntry.name);
      const projectName = projectKeyToName(projEntry.name);

      const jsonlSessions = tryReadDir(projPath)
        .filter((e) => e.isFile() && e.name.endsWith('.jsonl'))
        .map((entry) => {
          const filePath = path.join(projPath, entry.name);
          const fileSize = tryStatSize(filePath);
          if (fileSize === null || fileSize < 100) return null;
          const meta = extractMetadataFromJsonl(filePath);
          if (!meta) return null;
          return {
            ...meta,
            filePath,
            fileSize,
            projectKey: projEntry.name,
            projectName,
            synced: syncedIds.has(meta.sessionId),
          } as LocalSession;
        })
        .filter((s): s is LocalSession => s !== null);

      const jsonlSessionIds = new Set(jsonlSessions.map((s) => s.sessionId));
      const indexPath = path.join(projPath, 'sessions-index.json');
      const index = readSessionIndex(indexPath);
      const indexSessions = (index?.entries || [])
        .filter((e) => !jsonlSessionIds.has(e.sessionId))
        .map((e) =>
          indexEntryToSession(
            e,
            projEntry.name,
            projectName,
            syncedIds.has(e.sessionId),
          ),
        );

      return [...jsonlSessions, ...indexSessions];
    })
    .sort(
      (a, b) =>
        new Date(b.lastTimestamp).getTime() -
        new Date(a.lastTimestamp).getTime(),
    );
};

// ── Server interaction ─────────────────────────────────────────────────────

const fetchSyncedSessionIds = async (): Promise<Set<string>> => {
  const config = tryGetConfig();
  if (!config) return new Set();
  try {
    const url = `${config.apiUrl.replace(/\/$/, '')}/sessions`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!res.ok) return new Set();
    const sessions = (await res.json()) as Array<{ id: string }>;
    return new Set(sessions.map((s) => s.id));
  } catch {
    return new Set();
  }
};

const execGit = (args: string, dir?: string): string => {
  try {
    return execSync(`git ${args}`, {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
};

const collectGitMetadataForDir = (cwd: string) => {
  const origin = fs.existsSync(cwd)
    ? execGit('remote get-url origin', cwd)
    : '';
  const gitName = execGit('config user.name', cwd);
  const gitEmail = execGit('config user.email', cwd);
  return {
    user_name: resolveUserName({ gitName, gitEmail }),
    user_email: gitEmail || 'unknown',
    git_remotes: origin ? [origin] : [],
  };
};

const syncSessionToServer = async (
  session: LocalSession,
): Promise<'synced' | 'skipped'> => {
  if (!session.filePath) return 'skipped';
  const { apiUrl } = getConfig();
  const transcript = (() => {
    try {
      return fs.readFileSync(session.filePath, 'utf-8');
    } catch (err) {
      throw new Error(
        `Cannot read ${session.filePath}: ${(err as Error).message}`,
      );
    }
  })();
  const gitMeta = collectGitMetadataForDir(session.cwd);
  const url = `${apiUrl.replace(/\/$/, '')}/sessions/${session.sessionId}`;
  // Parse the full transcript for exact token totals here (the TUI's
  // session.totalTokens is extrapolated from a 32KB sample, so it isn't
  // accurate enough to persist).
  const { inputTokens, outputTokens } =
    tokenUsageFromTranscriptText(transcript);
  const json = JSON.stringify({
    user_name: gitMeta.user_name,
    user_email: gitMeta.user_email,
    working_dir: session.cwd,
    git_remotes: gitMeta.git_remotes,
    branch: session.gitBranch,
    tool: 'claude-code',
    transcript,
    status: 'done',
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  });
  const compressed = gzipSync(Buffer.from(json, 'utf-8'));
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      ...getAuthHeaders(),
    },
    body: compressed,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} returned ${res.status}: ${text}`);
  }
  return 'synced';
};

const syncSessions = async (
  sessions: readonly LocalSession[],
): Promise<SyncResult> => {
  const syncable = sessions.filter((s) => s.filePath !== null && !s.synced);
  const skippedCount = sessions.length - syncable.length;

  if (skippedCount > 0 && syncable.length === 0) {
    const archivedCount = sessions.filter((s) => s.filePath === null).length;
    const alreadySynced = sessions.filter((s) => s.synced).length;
    const reasons = [
      ...(archivedCount > 0 ? [`${archivedCount} archived`] : []),
      ...(alreadySynced > 0 ? [`${alreadySynced} already synced`] : []),
    ].join(', ');
    console.log(`  ${dim(`Nothing to sync (${reasons}).`)}\n`);
    return {
      synced: 0,
      failed: 0,
      skipped: skippedCount,
      syncedIds: new Set(),
    };
  }

  if (skippedCount > 0) {
    console.log(
      `  ${dim(`Skipping ${skippedCount} sessions (archived or already synced)`)}`,
    );
  }

  const total = syncable.length;
  const successIds: string[] = [];
  const result = await syncable.reduce<
    Promise<{ synced: number; failed: number }>
  >(
    async (accPromise, session, i) => {
      const acc = await accPromise;
      const label = session.summary
        ? truncate(session.summary, 30)
        : session.sessionId.slice(0, 12);
      process.stdout.write(
        `  ${dim(`[${i + 1}/${total}]`)} Syncing ${label}… `,
      );
      try {
        await syncSessionToServer(session);
        successIds.push(session.sessionId);
        process.stdout.write(
          `${green('✓')} ${dim(displayFileSize(session.fileSize))}\n`,
        );
        return { synced: acc.synced + 1, failed: acc.failed };
      } catch (err) {
        process.stdout.write(`${red('✗')} ${dim((err as Error).message)}\n`);
        return { synced: acc.synced, failed: acc.failed + 1 };
      }
    },
    Promise.resolve({ synced: 0, failed: 0 }),
  );

  console.log(
    result.failed === 0
      ? `\n  ${green('Done!')} ${bold(String(result.synced))} sessions synced.\n`
      : `\n  ${yellow('Done.')} ${bold(String(result.synced))} synced, ${red(String(result.failed))} failed.\n`,
  );
  return { ...result, skipped: skippedCount, syncedIds: new Set(successIds) };
};

// ── Vim-style Interactive TUI ──────────────────────────────────────────────

interface ListState {
  readonly cursor: number;
  readonly selected: ReadonlySet<number>;
  readonly scroll: number;
}

type ListAction =
  | { type: 'enter'; index: number }
  | { type: 'sync'; indices: readonly number[] }
  | { type: 'back' }
  | { type: 'quit' };

const interactiveList = <T>(config: {
  readonly items: readonly T[];
  readonly renderRow: (
    item: T,
    index: number,
    active: boolean,
    selected: boolean,
  ) => string;
  readonly headerLines: readonly string[];
  readonly footerLine: (selectedCount: number, total: number) => string;
  readonly selectable: boolean;
  readonly isItemSelectable?: (item: T, index: number) => boolean;
}): Promise<ListAction> =>
  new Promise((resolve) => {
    // Reserve space for: header lines + scroll indicator (1) + blank (1) + footer (1)
    const overhead = config.headerLines.length + 3;
    const maxVisible = clamp(
      (process.stdout.rows || 24) - overhead,
      5,
      config.items.length,
    );
    const total = config.items.length;

    const stateRef: [ListState] = [
      { cursor: 0, selected: new Set(), scroll: 0 },
    ];
    const renderedRef: [number] = [0];

    const render = () => {
      const state = stateRef[0];
      const scroll = computeScrollOffset({
        cursor: state.cursor,
        scroll: state.scroll,
        maxVisible,
        total,
      });
      stateRef[0] = { ...state, scroll };

      const visibleItems = config.items.slice(scroll, scroll + maxVisible);
      const lines = [
        ...config.headerLines,
        ...visibleItems.map((item, i) => {
          const globalIdx = scroll + i;
          const active = globalIdx === state.cursor;
          const isSelected = state.selected.has(globalIdx);
          return config.renderRow(item, globalIdx, active, isSelected);
        }),
        ...(total > maxVisible
          ? [
              `    ${dim(`↕ ${scroll + 1}–${Math.min(scroll + maxVisible, total)} of ${total}`)}`,
            ]
          : []),
        '',
        config.footerLine(state.selected.size, total),
      ];

      const moveUp = renderedRef[0] > 0 ? `\x1b[${renderedRef[0]}A` : '';
      const output =
        moveUp + lines.map((line) => `\x1b[2K${line}`).join('\n') + '\n';
      const extraClears =
        renderedRef[0] > lines.length
          ? Array.from(
              { length: renderedRef[0] - lines.length },
              () => '\x1b[2K\n',
            ).join('')
          : '';
      process.stdout.write(output + extraClears);
      renderedRef[0] = lines.length;
    };

    const cleanup = () => {
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
      process.stdin.removeAllListeners('data');
      process.stdout.write(SHOW_CURSOR);
    };

    const onKey = (buf: Buffer) => {
      const key = parseKeypress(buf);
      const state = stateRef[0];

      if (key === 'ctrl-c') {
        cleanup();
        process.exit(0);
      }

      if (key === 'up') {
        stateRef[0] = {
          ...state,
          cursor: clamp(state.cursor - 1, 0, total - 1),
        };
        render();
      } else if (key === 'down') {
        stateRef[0] = {
          ...state,
          cursor: clamp(state.cursor + 1, 0, total - 1),
        };
        render();
      } else if (key === 'top') {
        stateRef[0] = { ...state, cursor: 0, scroll: 0 };
        render();
      } else if (key === 'bottom') {
        stateRef[0] = { ...state, cursor: total - 1 };
        render();
      } else if (key === 'space' && config.selectable) {
        const canSelect =
          !config.isItemSelectable ||
          config.isItemSelectable(config.items[state.cursor], state.cursor);
        if (canSelect) {
          const next = new Set(state.selected);
          if (next.has(state.cursor)) {
            next.delete(state.cursor);
          } else {
            next.add(state.cursor);
          }
          stateRef[0] = { ...state, selected: next };
        }
        render();
      } else if (key === 'select-all' && config.selectable) {
        const selectableIndices = Array.from(
          { length: total },
          (_, i) => i,
        ).filter(
          (i) =>
            !config.isItemSelectable ||
            config.isItemSelectable(config.items[i], i),
        );
        const allSelected = selectableIndices.every((i) =>
          state.selected.has(i),
        );
        const next = allSelected
          ? new Set<number>()
          : new Set(selectableIndices);
        stateRef[0] = { ...state, selected: next };
        render();
      } else if (key === 'enter') {
        cleanup();
        resolve({ type: 'enter', index: state.cursor });
      } else if (key === 'sync') {
        cleanup();
        const indices =
          state.selected.size > 0
            ? Array.from(state.selected).sort((a, b) => a - b)
            : Array.from({ length: total }, (_, i) => i);
        resolve({ type: 'sync', indices });
      } else if (key === 'back') {
        cleanup();
        resolve({ type: 'back' });
      }
    };

    process.stdout.write(HIDE_CURSOR);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', onKey);
    render();
  });

// ── View renderers ─────────────────────────────────────────────────────────

const renderProjectRow = (
  g: ProjectGroup,
  _idx: number,
  active: boolean,
  _selected: boolean,
): string => {
  const pointer = active ? cyan('▸') : ' ';
  const dateRange = `${displayShortDate(g.earliest)} – ${displayShortDate(g.latest)}`;
  const paddedName = padRight(g.projectName, 34);
  const name = active ? bold(paddedName) : paddedName;
  const content = `  ${pointer} ${name}${padLeft(String(g.sessions.length), 8)}${padLeft(displayFileSize(g.totalSize), 12)}  ${dim(dateRange)}`;
  return active ? `\x1b[48;5;236m${content}\x1b[0m` : content;
};

const renderSessionRow = (
  s: LocalSession,
  _idx: number,
  active: boolean,
  selected: boolean,
): string => {
  const pointer = active ? cyan('▸') : ' ';
  const status = s.synced ? green(' ✓ ') : selected ? green('[✓]') : dim('[ ]');
  const rawLabel = s.summary
    ? truncate(s.summary, 34)
    : s.sessionId.slice(0, 12) + '…';
  const paddedLabel = padRight(rawLabel, 36);
  const label = s.synced
    ? dim(paddedLabel)
    : !s.summary
      ? dim(paddedLabel)
      : paddedLabel;
  const branch = padRight(s.gitBranch.slice(0, 14), 16);
  const date = padRight(displayShortDate(s.lastTimestamp), 8);
  const msgs = padLeft(String(s.messageCount), 5);
  const tokens = padLeft(displayTokenCount(s.totalTokens), 7);
  const archived = s.filePath === null && !s.synced ? dim(' ✱') : '';
  const content = `  ${pointer} ${status} ${label}${branch}${date}${msgs}${tokens}${archived}`;
  return s.synced
    ? active
      ? `\x1b[48;5;236m${dim(content)}\x1b[0m`
      : dim(content)
    : active
      ? `\x1b[48;5;236m${content}\x1b[0m`
      : content;
};

// ── Main flows ─────────────────────────────────────────────────────────────

const browseProject = async (group: ProjectGroup): Promise<ProjectGroup> => {
  const syncableCount = group.sessions.filter(
    (s) => s.filePath !== null && !s.synced,
  ).length;
  const syncedCount = group.sessions.filter((s) => s.synced).length;
  const subtitle = [
    `${group.sessions.length} sessions`,
    ...(syncableCount > 0 ? [`${syncableCount} syncable`] : []),
    ...(syncedCount > 0 ? [`${syncedCount} synced`] : []),
  ].join(', ');

  const action = await interactiveList({
    items: group.sessions,
    renderRow: renderSessionRow,
    headerLines: [
      '',
      `  ${bold(group.projectName)} ${dim(`— ${subtitle}`)}`,
      '',
      `  ${dim('    ')}${dim(padRight('SUMMARY', 40))}${dim(padRight('BRANCH', 16))}${dim(padRight('DATE', 8))}${dim(padLeft('MSGS', 5))}${dim(padLeft('TOKENS', 7))}`,
      `  ${dim('─'.repeat(82))}`,
    ],
    footerLine: (sel, _total) => {
      const selLabel = sel > 0 ? ` (${sel} selected)` : '';
      return `  ${dim('j/k')} navigate  ${dim('space')} select  ${dim('a')} toggle all  ${dim('s')} sync${selLabel}  ${dim('esc')} back`;
    },
    selectable: true,
    isItemSelectable: (s) => !s.synced && s.filePath !== null,
  });

  if (action.type === 'back') return group;

  if (action.type === 'enter' || action.type === 'sync') {
    const toSync =
      action.type === 'sync'
        ? action.indices.map((i) => group.sessions[i])
        : [group.sessions[action.index]];
    console.log();
    const result = await syncSessions(toSync);
    const updated = markGroupSessionsSynced({
      group,
      syncedIds: result.syncedIds,
    });
    return browseProject(updated);
  }

  return group;
};

const runDiscoverLoop = async (
  groups: readonly ProjectGroup[],
): Promise<void> => {
  const allSessions = groups.flatMap((g) => g.sessions);
  const syncableCount = allSessions.filter(
    (s) => s.filePath !== null && !s.synced,
  ).length;

  const action = await interactiveList({
    items: groups,
    renderRow: renderProjectRow,
    headerLines: [
      '',
      `  ${magenta('orchid sync')} ${dim('— discover local Claude Code sessions')}`,
      '',
      `  ${bold(String(allSessions.length))} sessions across ${bold(String(groups.length))} projects ${dim(`(${syncableCount} syncable)`)}`,
      '',
      `  ${dim(' ')}${dim(padRight('PROJECT', 36))}${dim(padLeft('SESSIONS', 8))}${dim(padLeft('SIZE', 12))}  ${dim('DATE RANGE')}`,
      `  ${dim('─'.repeat(82))}`,
    ],
    footerLine: (_sel, _total) =>
      `  ${dim('j/k')} navigate  ${dim('↵')} browse  ${dim('s')} sync all  ${dim('q')} quit`,
    selectable: false,
  });

  if (action.type === 'back' || action.type === 'quit') return;

  if (action.type === 'enter') {
    const updated = await browseProject(groups[action.index]);
    const updatedGroups = groups.map((g, i) =>
      i === action.index ? updated : g,
    );
    return runDiscoverLoop(updatedGroups);
  }

  if (action.type === 'sync') {
    console.log();
    const result = await syncSessions(allSessions);
    const updatedGroups = groups.map((g) =>
      markGroupSessionsSynced({ group: g, syncedIds: result.syncedIds }),
    );
    return runDiscoverLoop(updatedGroups);
  }
};

const runDiscover = async (): Promise<void> => {
  console.log();
  console.log(
    `  ${magenta('orchid sync')} ${dim('— discover local Claude Code sessions')}`,
  );
  console.log();
  process.stdout.write(`  ${dim('Scanning ~/.claude/projects…')}`);

  process.stdout.write(
    `\r  ${dim('Checking server for already-synced sessions…')}              `,
  );
  const syncedIds = await fetchSyncedSessionIds();
  process.stdout.write(
    `\r  ${dim(`${syncedIds.size} sessions already synced on server.`)}              \n`,
  );

  const allSessions = discoverLocalSessions(syncedIds);
  console.log(`  ${dim(`Found ${allSessions.length} local sessions.`)}`);

  if (allSessions.length === 0) {
    console.log(
      `\n  ${dim('No Claude Code sessions found in ~/.claude/projects/')}`,
    );
    return;
  }

  const groups = groupSessionsByProject(allSessions);
  await runDiscoverLoop(groups);
};

// ── Deterministic commit backfill (orchid sync --discover) ───────────────────
//
// Transcript-regex linking is lossy: a commit only links if its SHA was echoed
// in the conversation. This resolves a session's REAL commits straight from
// local git (the session's working_dir), then POSTs them to
// `POST /sessions/:id/commits`. Idempotent on the server, so re-running links 0.

// argv-form git (no shell string) — same safety posture as hooks.ts/review.ts:
// every arg is a discrete element, so a working_dir / author / branch can never
// inject a shell command. Returns null on any failure (non-git dir, missing
// git, bad revspec) so the caller can skip gracefully.
const execGitArgs = (args: readonly string[]): string | null => {
  try {
    return execFileSync('git', [...args], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
};

const isGitRepo = (dir: string): boolean =>
  fs.existsSync(dir) &&
  execGitArgs(['-C', dir, 'rev-parse', '--git-dir']) !== null;

// A small buffer past the session's last activity so a commit made moments after
// the final transcript line is still captured by --until.
const UNTIL_BUFFER_MS = 5 * 60 * 1000;

// Resolve a session's commits from its working_dir using the NUL-delimited
// pretty format. Bounded to the session's lifespan (--since/--until) and the
// session author (--author matches name OR email substring), so we attribute
// only the commits this session plausibly produced. No-merges keeps merge
// commits out. Returns [] for a non-repo / no matches.
const resolveSessionCommits = (params: {
  readonly workingDir: string;
  readonly since: string;
  readonly until: string;
  readonly author: string;
}): readonly ResolvedCommit[] => {
  if (!isGitRepo(params.workingDir)) return [];

  const stdout = execGitArgs([
    '-C',
    params.workingDir,
    'log',
    '--no-merges',
    `--pretty=${GIT_LOG_PRETTY_FORMAT}`,
    `--since=${params.since}`,
    `--until=${params.until}`,
    `--author=${params.author}`,
  ]);
  if (stdout === null) return [];
  return parseGitLog(stdout);
};

// The git author identity to filter on: prefer the repo's configured email,
// fall back to user.name. Empty when git can't tell us (then we don't filter by
// author — better to over-link within the time window than miss everything).
const gitAuthorForDir = (dir: string): string => {
  const email = execGitArgs(['-C', dir, 'config', 'user.email'])?.trim() ?? '';
  if (email !== '') return email;
  return execGitArgs(['-C', dir, 'config', 'user.name'])?.trim() ?? '';
};

// POST one session's resolved commits to the ingest endpoint; returns the number
// the server actually linked (idempotent: a re-post returns 0).
const postSessionCommits = async (params: {
  readonly sessionId: string;
  readonly commits: readonly ResolvedCommit[];
}): Promise<number> => {
  const { apiUrl } = getConfig();
  const url = `${apiUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(params.sessionId)}/commits`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ commits: params.commits }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${url} returned ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { linked?: number };
  return typeof data.linked === 'number' ? data.linked : 0;
};

interface BackfillTotals {
  readonly linked: number;
  readonly sessions: number;
}

// Backfill commits for every discovered session whose working_dir is a local git
// repo. Sequential awaited reduce (functional; no for/forEach, no mutation) so
// the output stays readable and we don't hammer the server. Skips non-repo / no-
// match sessions silently; never throws on a per-session failure.
const backfillSessionCommits = async (
  sessions: readonly LocalSession[],
): Promise<BackfillTotals> =>
  sessions.reduce<Promise<BackfillTotals>>(
    async (accPromise, session) => {
      const acc = await accPromise;
      if (!isGitRepo(session.cwd)) return acc;

      const commits = resolveSessionCommits({
        workingDir: session.cwd,
        since: session.firstTimestamp,
        until: new Date(
          new Date(session.lastTimestamp).getTime() + UNTIL_BUFFER_MS,
        ).toISOString(),
        author: gitAuthorForDir(session.cwd),
      });
      if (commits.length === 0) return acc;

      const label = session.summary
        ? truncate(session.summary, 30)
        : session.sessionId.slice(0, 12);
      try {
        const linked = await postSessionCommits({
          sessionId: session.sessionId,
          commits,
        });
        console.log(
          `  ${green('✓')} ${label} ${dim(`— linked ${linked}/${commits.length} commit${commits.length === 1 ? '' : 's'}`)}`,
        );
        return { linked: acc.linked + linked, sessions: acc.sessions + 1 };
      } catch (err) {
        console.log(`  ${red('✗')} ${label} ${dim((err as Error).message)}`);
        return acc;
      }
    },
    Promise.resolve({ linked: 0, sessions: 0 }),
  );

const runCommitBackfill = async (): Promise<void> => {
  console.log();
  console.log(
    `  ${magenta('orchid sync --discover')} ${dim('— backfill commit↔session links from local git')}`,
  );
  console.log();

  const allSessions = discoverLocalSessions(new Set());
  console.log(`  ${dim(`Found ${allSessions.length} local sessions.`)}`);

  if (allSessions.length === 0) {
    console.log(
      `\n  ${dim('No Claude Code sessions found in ~/.claude/projects/')}`,
    );
    return;
  }

  const totals = await backfillSessionCommits(allSessions);

  console.log(
    `\n  ${green('Done!')} linked ${bold(String(totals.linked))} commit${totals.linked === 1 ? '' : 's'} across ${bold(String(totals.sessions))} session${totals.sessions === 1 ? '' : 's'}.\n`,
  );
};

// ── Single file sync ───────────────────────────────────────────────────────

const syncFile = async (filePath: string): Promise<void> => {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    console.error(`${red('Error:')} File not found: ${resolved}`);
    process.exit(1);
  }
  if (!resolved.endsWith('.jsonl')) {
    console.error(`${red('Error:')} Expected a .jsonl file`);
    process.exit(1);
  }

  const fileSize = fs.statSync(resolved).size;
  const meta = extractMetadataFromJsonl(resolved);
  if (!meta) {
    console.error(`${red('Error:')} Could not parse metadata from ${resolved}`);
    process.exit(1);
  }

  const projectKey = path.basename(path.dirname(resolved));
  const session: LocalSession = {
    ...meta,
    filePath: resolved,
    fileSize,
    projectKey,
    projectName: projectKeyToName(projectKey),
    synced: false,
  };

  console.log(
    `\n  ${magenta('orchid sync')} ${dim('— syncing single session')}\n`,
  );
  console.log(`  Session:  ${session.sessionId}`);
  console.log(`  Summary:  ${session.summary || dim('(no summary)')}`);
  console.log(`  Branch:   ${session.gitBranch}`);
  console.log(`  Size:     ${displayFileSize(session.fileSize)}`);
  console.log(`  Tokens:   ${displayTokenCount(session.totalTokens)}\n`);

  process.stdout.write(`  Syncing… `);
  try {
    await syncSessionToServer(session);
    console.log(`${green('✓')} Done!\n`);
  } catch (err) {
    console.log(`${red('✗')} ${(err as Error).message}`);
    process.exit(1);
  }
};

// ── Entry point ────────────────────────────────────────────────────────────

export const runSync = (args: string[]): void => {
  const flag = args[0];

  if (flag === '--help' || flag === '-h') {
    console.log(`orchid sync - sync past Claude Code conversations

Usage:
  orchid sync                     Discover and sync unsynced local sessions (interactive)
  orchid sync --discover          Backfill commit↔session links from local git
  orchid sync <file.jsonl>        Sync a single transcript file

Options:
  --discover    Resolve each session's real git commits and link them on the server
  --help        Show this help message`);
    return;
  }

  // Deterministic commit backfill: resolve each session's commits from local git
  // and POST them to the server. Non-interactive (safe to run in a script/loop).
  if (flag === '--discover') {
    runCommitBackfill().catch((err) => {
      console.error(`\n${red('Error:')} ${err.message}`);
      process.exit(1);
    });
    return;
  }

  if (!flag) {
    runDiscover().catch((err) => {
      process.stdout.write(SHOW_CURSOR);
      console.error(`\n${red('Error:')} ${err.message}`);
      process.exit(1);
    });
    return;
  }

  syncFile(flag).catch((err) => {
    console.error(`\n${red('Error:')} ${err.message}`);
    process.exit(1);
  });
};
