import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'child_process';
import { gzipSync } from 'zlib';
import { tryGetConfig } from '../config';
import { resolveUserName } from '../git-identity';

// -- ANSI helpers -----------------------------------------------------------

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

// -- JSON-compatible types --------------------------------------------------

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue | undefined };
export type HookCollection = { readonly [key: string]: JsonValue | undefined };

// -- Paths ------------------------------------------------------------------

const pathInHome = (segments: readonly string[]): string =>
  path.join(os.homedir(), ...segments);

const claudeSettingsPath = (): string =>
  pathInHome(['.claude', 'settings.json']);

const orchidDir = (): string => pathInHome(['.orchid']);

const orchidHooksDir = (): string => path.join(orchidDir(), 'hooks');

const orchidHooksLauncherPath = (): string =>
  path.join(orchidHooksDir(), 'orchid-hook');

const orchidHooksConfigPath = (): string =>
  path.join(orchidDir(), 'hooks-config.json');

const claudeProjectsDir = (): string => pathInHome(['.claude', 'projects']);

const expandHomePath = (filePath: string): string =>
  filePath.startsWith('~/')
    ? path.join(os.homedir(), filePath.slice(2))
    : filePath;

// -- Small IO helpers -------------------------------------------------------

const ensureDir = (dir: string): void => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const tryReadFile = (filePath: string): string | null => {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
};

const tryReadDir = (dir: string): readonly fs.Dirent[] => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const tryRemoveFile = (filePath: string): void => {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // noop
  }
};

const parseJsonObject = (text: string): JsonObject => {
  try {
    return text.trim() ? (JSON.parse(text) as JsonObject) : {};
  } catch {
    return {};
  }
};

const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const jsonArrayFromValue = (
  value: JsonValue | undefined,
): readonly JsonValue[] => (Array.isArray(value) ? value : []);

const stringFromJsonObject = (
  object: JsonObject,
  key: string,
): string | null => (typeof object[key] === 'string' ? object[key] : null);

const readSettings = (): JsonObject =>
  tryReadFile(claudeSettingsPath()) === null
    ? {}
    : parseJsonObject(tryReadFile(claudeSettingsPath()) || '');

const writeSettings = (settings: JsonObject): void => {
  const settingsPath = claudeSettingsPath();
  ensureDir(path.dirname(settingsPath));
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
};

const objectWithoutKey = (object: JsonObject, removedKey: string): JsonObject =>
  Object.fromEntries(
    Object.entries(object).filter(([key]) => key !== removedKey),
  );

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

// -- Orchid hooks config ----------------------------------------------------

export type HookMode = 'auto' | 'prompt';

interface OrchidHooksConfig {
  readonly installed: boolean;
  readonly mode: HookMode;
}

const isHookMode = (value: string | null): value is HookMode =>
  value === 'auto' || value === 'prompt';

const readHooksConfig = (): OrchidHooksConfig | null => {
  const parsed = tryReadFile(orchidHooksConfigPath());
  if (parsed === null) return null;

  const config = parseJsonObject(parsed);
  const mode = stringFromJsonObject(config, 'mode');

  return config.installed === true && isHookMode(mode)
    ? { installed: true, mode }
    : null;
};

const writeHooksConfig = (config: OrchidHooksConfig): void => {
  ensureDir(orchidDir());
  fs.writeFileSync(
    orchidHooksConfigPath(),
    `${JSON.stringify(config, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
};

const removeHooksConfig = (): void => {
  tryRemoveFile(orchidHooksConfigPath());
};

const currentCliEntrypointPath = (): string =>
  fs.realpathSync(process.argv[1] || path.join(__dirname, '..', 'main.js'));

const hookLauncherContents = (): string =>
  [
    '#!/bin/sh',
    `exec ${shellQuote(process.execPath)} ${shellQuote(currentCliEntrypointPath())} hooks "$@"`,
    '',
  ].join('\n');

const writeHookLauncher = (): void => {
  ensureDir(orchidHooksDir());
  fs.writeFileSync(orchidHooksLauncherPath(), hookLauncherContents(), {
    mode: 0o700,
  });
  fs.chmodSync(orchidHooksLauncherPath(), 0o700);
};

const removeHookLauncher = (): void => {
  tryRemoveFile(orchidHooksLauncherPath());
};

// -- Hook definitions -------------------------------------------------------

export const ORCHID_HOOK_EVENTS = [
  'SessionStart',
  'Stop',
  'SessionEnd',
] as const;
type OrchidHookEvent = (typeof ORCHID_HOOK_EVENTS)[number];

const ORCHID_COMMAND_PREFIX = 'orchid hooks _on-';
const ORCHID_HOOK_LAUNCHER_NAME = 'orchid-hook';
const ORCHID_HOOK_SUBCOMMANDS = ['_on-start', '_on-stop', '_on-end'] as const;

const hookCommand = (
  subcommand: (typeof ORCHID_HOOK_SUBCOMMANDS)[number],
): string => `${shellQuote(orchidHooksLauncherPath())} ${subcommand}`;

export const buildHookEntries = (): HookCollection => ({
  SessionStart: [
    {
      matcher: 'startup|resume|clear|compact',
      hooks: [
        {
          type: 'command',
          command: hookCommand('_on-start'),
          timeout: 10,
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: 'command',
          command: hookCommand('_on-stop'),
          timeout: 30,
        },
      ],
    },
  ],
  SessionEnd: [
    {
      hooks: [
        {
          type: 'command',
          command: hookCommand('_on-end'),
          timeout: 30,
        },
      ],
    },
  ],
});

const isOrchidHookEvent = (event: string): event is OrchidHookEvent =>
  ORCHID_HOOK_EVENTS.includes(event as OrchidHookEvent);

const commandUsesOrchidHookLauncher = (command: string): boolean =>
  command.includes(ORCHID_HOOK_LAUNCHER_NAME) &&
  ORCHID_HOOK_SUBCOMMANDS.some((subcommand) =>
    command.endsWith(` ${subcommand}`),
  );

export const isOrchidHookEntry = (entry: JsonValue): boolean =>
  isJsonObject(entry) &&
  jsonArrayFromValue(entry.hooks)
    .filter(isJsonObject)
    .some((hook) => {
      const command = stringFromJsonObject(hook, 'command');
      return (
        command !== null &&
        (command.startsWith(ORCHID_COMMAND_PREFIX) ||
          commandUsesOrchidHookLauncher(command))
      );
    });

export const mergeHooks = (
  existing: HookCollection,
  orchid: HookCollection,
): HookCollection => ({
  ...Object.fromEntries(
    Object.entries(existing).filter(([key]) => !isOrchidHookEvent(key)),
  ),
  ...Object.fromEntries(
    ORCHID_HOOK_EVENTS.flatMap((event) => {
      const existingEntries = jsonArrayFromValue(existing[event]).filter(
        (entry) => !isOrchidHookEntry(entry),
      );
      const orchidEntries = jsonArrayFromValue(orchid[event]);
      const merged = [...existingEntries, ...orchidEntries];
      return merged.length > 0 ? [[event, merged] as const] : [];
    }),
  ),
});

export const removeOrchidHooks = (existing: HookCollection): HookCollection =>
  Object.fromEntries(
    Object.entries(existing).flatMap(([key, value]) => {
      if (!isOrchidHookEvent(key)) return [[key, value] as const];

      const filtered = jsonArrayFromValue(value).filter(
        (entry) => !isOrchidHookEntry(entry),
      );
      return filtered.length > 0 ? [[key, filtered] as const] : [];
    }),
  );

export const buildSettingsWithInstalledHooks = (
  settings: JsonObject,
): JsonObject => ({
  ...settings,
  hooks: mergeHooks(
    isJsonObject(settings.hooks) ? settings.hooks : {},
    buildHookEntries(),
  ),
});

export const buildSettingsWithoutOrchidHooks = (
  settings: JsonObject,
): JsonObject => {
  const cleaned = removeOrchidHooks(
    isJsonObject(settings.hooks) ? settings.hooks : {},
  );
  return Object.keys(cleaned).length > 0
    ? { ...settings, hooks: cleaned }
    : objectWithoutKey(settings, 'hooks');
};

// -- Install/uninstall/status ----------------------------------------------

const installHooks = (mode: HookMode): void => {
  const config = tryGetConfig();
  if (!config) {
    console.error(red('Error: Not authenticated.'));
    console.error(`Run ${cyan('orchid login')} first.\n`);
    process.exit(1);
  }

  const hooksConfig = readHooksConfig();

  const modeAlreadyInstalled =
    hooksConfig?.installed && hooksConfig.mode === mode;

  if (hooksConfig?.installed && !modeAlreadyInstalled) {
    console.log(
      `${yellow('->')} Updating hook mode from ${bold(hooksConfig.mode)} to ${bold(mode)}`,
    );
  }

  writeHookLauncher();
  writeSettings(buildSettingsWithInstalledHooks(readSettings()));
  writeHooksConfig({ installed: true, mode });

  console.log('');
  console.log(
    modeAlreadyInstalled
      ? `  ${green('OK')} Orchid hooks refreshed in Claude Code`
      : `  ${green('OK')} Orchid hooks installed into Claude Code`,
  );
  console.log('');
  console.log(`  ${dim('Mode:')}    ${bold(mode)}`);
  console.log(`  ${dim('Config:')}  ${dim(claudeSettingsPath())}`);
  console.log('');
  console.log(
    mode === 'auto'
      ? '  Every conversation will be synced automatically.'
      : '  Claude will ask if you want to sync at the start of each conversation.',
  );
  console.log(`  View synced conversations at ${cyan(config.webUrl)}`);
  console.log('');
};

const uninstallHooks = (): void => {
  const hooksConfig = readHooksConfig();

  if (!hooksConfig?.installed) {
    console.log(`${dim('Orchid hooks are not installed.')}`);
    return;
  }

  writeSettings(buildSettingsWithoutOrchidHooks(readSettings()));
  removeHooksConfig();
  removeHookLauncher();
  cleanupStateFiles();

  console.log('');
  console.log(`  ${green('OK')} Orchid hooks removed from Claude Code`);
  console.log('');
};

const showStatus = (): void => {
  const hooksConfig = readHooksConfig();

  console.log('');

  if (hooksConfig?.installed) {
    console.log(`  ${green('*')} Orchid hooks are ${green('installed')}`);
    console.log(`  ${dim('Mode:')}    ${bold(hooksConfig.mode)}`);
    console.log(`  ${dim('Config:')}  ${dim(claudeSettingsPath())}`);

    const config = tryGetConfig();
    console.log(
      config
        ? `  ${dim('Auth:')}    ${green('authenticated')}\n  ${dim('Server:')}  ${dim(config.apiUrl)}`
        : `  ${dim('Auth:')}    ${red('not authenticated')} - run ${cyan('orchid login')}`,
    );

    const activeSessions = listActiveHookSessions();
    if (activeSessions.length > 0) {
      console.log(
        `  ${dim('Active:')}  ${bold(String(activeSessions.length))} session(s) syncing`,
      );
    }
  } else {
    console.log(`  ${dim('o')} Orchid hooks are ${dim('not installed')}`);
    console.log(`  Run ${cyan('orchid hooks install')} to set up.`);
  }

  console.log('');
};

// -- State files ------------------------------------------------------------

interface HookSessionState {
  readonly sessionId: string;
  readonly cwd: string;
  readonly transcriptPath: string | null;
  readonly enabled: boolean;
  readonly startedAt: string;
}

const stateFilePath = (sessionId: string): string =>
  path.join(orchidHooksDir(), `${sessionId}.json`);

const hookSessionStateFromJson = (
  value: JsonObject,
): HookSessionState | null => {
  const sessionId = stringFromJsonObject(value, 'sessionId');
  const cwd = stringFromJsonObject(value, 'cwd');
  const transcriptPath = stringFromJsonObject(value, 'transcriptPath');
  const startedAt = stringFromJsonObject(value, 'startedAt');

  return sessionId !== null &&
    cwd !== null &&
    startedAt !== null &&
    typeof value.enabled === 'boolean'
    ? {
        sessionId,
        cwd,
        transcriptPath,
        enabled: value.enabled,
        startedAt,
      }
    : null;
};

const readSessionState = (sessionId: string): HookSessionState | null => {
  const parsed = tryReadFile(stateFilePath(sessionId));
  return parsed === null
    ? null
    : hookSessionStateFromJson(parseJsonObject(parsed));
};

const writeSessionState = (state: HookSessionState): void => {
  ensureDir(orchidHooksDir());
  fs.writeFileSync(
    stateFilePath(state.sessionId),
    `${JSON.stringify(state, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
};

const removeSessionState = (sessionId: string): void => {
  tryRemoveFile(stateFilePath(sessionId));
};

const listActiveHookSessions = (): readonly HookSessionState[] =>
  tryReadDir(orchidHooksDir())
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => tryReadFile(path.join(orchidHooksDir(), entry.name)))
    .filter((contents): contents is string => contents !== null)
    .map((contents) => hookSessionStateFromJson(parseJsonObject(contents)))
    .filter((state): state is HookSessionState => state !== null);

const cleanupStateFiles = (): void => {
  tryReadDir(orchidHooksDir())
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(orchidHooksDir(), entry.name))
    .map(tryRemoveFile);
};

// -- Git metadata -----------------------------------------------------------

interface GitMetadata {
  readonly user_name: string;
  readonly user_email: string;
  readonly branch: string;
  readonly git_remotes: readonly string[];
  readonly working_dir: string;
}

const execGit = (args: readonly string[], cwd?: string): string => {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

const isGitRepo = (dir: string): boolean =>
  execGit(['rev-parse', '--git-dir'], dir) !== '';

const gitOriginForDir = (dir: string): string | null => {
  const origin = isGitRepo(dir)
    ? execGit(['remote', 'get-url', 'origin'], dir)
    : '';
  return origin === '' ? null : origin;
};

const collectRemotes = (cwd: string): readonly string[] => {
  const directRemote = fs.existsSync(cwd) ? gitOriginForDir(cwd) : null;
  const subdirRemotes = tryReadDir(cwd)
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.name.startsWith('.') &&
        entry.name !== 'node_modules',
    )
    .map((entry) => gitOriginForDir(path.join(cwd, entry.name)))
    .filter((remote): remote is string => remote !== null);

  return [directRemote, ...subdirRemotes]
    .filter((remote): remote is string => remote !== null)
    .reduce<
      readonly string[]
    >((remotes, remote) => (remotes.includes(remote) ? remotes : [...remotes, remote]), []);
};

const collectGitMetadata = (cwd: string): GitMetadata => {
  const branch = fs.existsSync(cwd)
    ? execGit(['rev-parse', '--abbrev-ref', 'HEAD'], cwd)
    : '';

  const gitName = execGit(['config', 'user.name'], cwd);
  const gitEmail = execGit(['config', 'user.email'], cwd);

  return {
    user_name: resolveUserName({ gitName, gitEmail }),
    user_email: gitEmail || 'unconfigured',
    branch: branch !== '' && branch !== 'HEAD' ? branch : 'detached',
    git_remotes: collectRemotes(cwd),
    working_dir: cwd,
  };
};

// -- Claude hook input ------------------------------------------------------

interface ClaudeHookInput {
  readonly sessionId: string;
  readonly transcriptPath: string | null;
  readonly cwd: string;
}

export const claudeHookInputFromJson = (
  input: JsonObject,
  fallbackCwd: string,
): ClaudeHookInput => ({
  sessionId: stringFromJsonObject(input, 'session_id') || '',
  transcriptPath: stringFromJsonObject(input, 'transcript_path'),
  cwd: stringFromJsonObject(input, 'cwd') || fallbackCwd,
});

const readStdinJson = (): JsonObject =>
  process.stdin.isTTY ? {} : parseJsonObject(fs.readFileSync(0, 'utf-8'));

export const resolveTranscriptPath = (params: {
  readonly sessionId: string;
  readonly transcriptPath: string | null;
}): string | null => {
  const preferredPath =
    params.transcriptPath === null
      ? null
      : expandHomePath(params.transcriptPath);

  if (preferredPath !== null && fs.existsSync(preferredPath))
    return preferredPath;

  return (
    tryReadDir(claudeProjectsDir())
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        path.join(claudeProjectsDir(), entry.name, `${params.sessionId}.jsonl`),
      )
      .find((candidate) => fs.existsSync(candidate)) || null
  );
};

const stateForHookInput = (params: {
  readonly input: ClaudeHookInput;
  readonly mode: HookMode;
  readonly startedAt: string;
}): HookSessionState => ({
  sessionId: params.input.sessionId,
  cwd: params.input.cwd,
  transcriptPath:
    params.input.transcriptPath === null
      ? null
      : expandHomePath(params.input.transcriptPath),
  enabled: params.mode === 'auto',
  startedAt: params.startedAt,
});

// -- Sync helper ------------------------------------------------------------

const syncTranscript = async (params: {
  readonly sessionId: string;
  readonly transcriptPath: string;
  readonly cwd: string;
  readonly status: 'active' | 'done';
}): Promise<void> => {
  const config = tryGetConfig();
  if (!config) return;

  const transcript = tryReadFile(params.transcriptPath);
  if (transcript === null) return;

  const gitMeta = collectGitMetadata(params.cwd);
  const url = `${config.apiUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(params.sessionId)}`;
  const body = gzipSync(
    Buffer.from(
      JSON.stringify({
        user_name: gitMeta.user_name,
        user_email: gitMeta.user_email,
        working_dir: gitMeta.working_dir,
        git_remotes: gitMeta.git_remotes,
        branch: gitMeta.branch,
        tool: 'claude-code',
        transcript,
        status: params.status,
      }),
      'utf-8',
    ),
  );

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      Authorization: `Bearer ${config.token}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} returned ${res.status}: ${text}`);
  }
};

const syncEnabledStateForInput = (
  input: ClaudeHookInput,
): HookSessionState | null => {
  const existingState = readSessionState(input.sessionId);
  if (existingState !== null)
    return existingState.enabled ? existingState : null;

  const hooksConfig = readHooksConfig();
  return hooksConfig?.installed
    ? stateForHookInput({
        input,
        mode: hooksConfig.mode,
        startedAt: new Date().toISOString(),
      })
    : null;
};

const updateStateTranscriptPath = (
  state: HookSessionState,
  transcriptPath: string,
): void => {
  if (state.transcriptPath !== transcriptPath) {
    writeSessionState({ ...state, transcriptPath });
  }
};

// -- Hook event handlers ----------------------------------------------------

export const sessionStartOutputForMode = (params: {
  readonly mode: HookMode;
  readonly sessionId: string;
  readonly webUrl: string;
}): JsonObject => ({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext:
      params.mode === 'auto'
        ? `Orchid is syncing this conversation. View it live at ${params.webUrl}/sessions/${params.sessionId}.`
        : [
            'Orchid sync is available for this conversation.',
            `If the user wants to sync, run: orchid hooks _enable-sync ${params.sessionId}.`,
            `The conversation can then be viewed at ${params.webUrl}/sessions/${params.sessionId}.`,
            'Briefly mention that Orchid sync is available; do not be pushy about it.',
          ].join(' '),
  },
});

const handleOnStart = (): void => {
  const config = tryGetConfig();
  if (!config) process.exit(0);

  const input = claudeHookInputFromJson(readStdinJson(), process.cwd());
  if (input.sessionId === '') process.exit(0);

  const mode = readHooksConfig()?.mode ?? 'auto';
  writeSessionState(
    stateForHookInput({ input, mode, startedAt: new Date().toISOString() }),
  );
  process.stdout.write(
    `${JSON.stringify(
      sessionStartOutputForMode({
        mode,
        sessionId: input.sessionId,
        webUrl: config.webUrl,
      }),
    )}\n`,
  );
};

const handleOnStop = async (): Promise<void> => {
  const input = claudeHookInputFromJson(readStdinJson(), process.cwd());
  if (input.sessionId === '') process.exit(0);

  const state = syncEnabledStateForInput(input);
  if (state === null) process.exit(0);

  const transcriptPath = resolveTranscriptPath({
    sessionId: input.sessionId,
    transcriptPath: state.transcriptPath || input.transcriptPath,
  });
  if (transcriptPath === null) process.exit(0);

  updateStateTranscriptPath(state, transcriptPath);

  try {
    await syncTranscript({
      sessionId: input.sessionId,
      transcriptPath,
      cwd: input.cwd,
      status: 'active',
    });
  } catch {
    // Silent failure: Claude hooks should never interrupt the conversation.
  }
};

const handleOnEnd = async (): Promise<void> => {
  const config = tryGetConfig();
  if (!config) process.exit(0);

  const input = claudeHookInputFromJson(readStdinJson(), process.cwd());
  if (input.sessionId === '') process.exit(0);

  const state = syncEnabledStateForInput(input);
  const transcriptPath = resolveTranscriptPath({
    sessionId: input.sessionId,
    transcriptPath: state?.transcriptPath || input.transcriptPath,
  });

  if (state !== null && transcriptPath !== null) {
    try {
      await syncTranscript({
        sessionId: input.sessionId,
        transcriptPath,
        cwd: input.cwd,
        status: 'done',
      });
      process.stderr.write(
        `Orchid: conversation synced -> ${config.webUrl}/sessions/${input.sessionId}\n`,
      );
    } catch (err) {
      process.stderr.write(`Orchid: sync failed - ${(err as Error).message}\n`);
    }
  } else if (transcriptPath !== null) {
    process.stderr.write(
      'Orchid: This conversation was not synced. Run orchid sync --discover to sync it later.\n',
    );
  }

  removeSessionState(input.sessionId);
};

const handleEnableSync = async (
  sessionId: string | undefined,
): Promise<void> => {
  if (!sessionId) {
    console.error('Usage: orchid hooks _enable-sync <session-id>');
    process.exit(1);
  }

  const config = tryGetConfig();
  if (!config) {
    console.error(red('Not authenticated. Run orchid login first.'));
    process.exit(1);
  }

  const state = readSessionState(sessionId);
  writeSessionState(
    state === null
      ? {
          sessionId,
          cwd: process.cwd(),
          transcriptPath: null,
          enabled: true,
          startedAt: new Date().toISOString(),
        }
      : { ...state, enabled: true },
  );

  console.log(`${green('OK')} Orchid sync enabled for this conversation.`);
  console.log(`${dim('View it at:')} ${config.webUrl}/sessions/${sessionId}`);
};

// -- CLI entry point --------------------------------------------------------

const HOOKS_HELP = `orchid hooks - manage Claude Code integration

Usage:
  orchid hooks install [--mode auto|prompt]  Install hooks into Claude Code
  orchid hooks uninstall                     Remove hooks from Claude Code
  orchid hooks status                        Show hook installation status

Modes:
  auto     Sync every conversation automatically ${dim('(default)')}
  prompt   Claude asks at the start of each conversation

Examples:
  orchid hooks install               Install with auto-sync
  orchid hooks install --mode prompt Install with prompt mode
  orchid hooks uninstall             Remove all Orchid hooks
`;

const hookModeFromArgs = (args: readonly string[]): HookMode | null => {
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx === -1 ? 'auto' : args[modeIdx + 1] || '';
  return isHookMode(mode) ? mode : null;
};

export const runHooks = async (args: readonly string[]): Promise<void> => {
  const subcommand = args[0];

  switch (subcommand) {
    case 'install': {
      const mode = hookModeFromArgs(args);
      if (mode === null) {
        console.error(`Invalid mode. Use "auto" or "prompt".`);
        process.exit(1);
      }
      installHooks(mode);
      break;
    }
    case 'uninstall':
      uninstallHooks();
      break;
    case 'status':
      showStatus();
      break;
    case '_on-start':
      handleOnStart();
      break;
    case '_on-stop':
      await handleOnStop();
      break;
    case '_on-end':
      await handleOnEnd();
      break;
    case '_enable-sync':
      await handleEnableSync(args[1]);
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(HOOKS_HELP);
      break;
    default:
      console.error(`Unknown hooks subcommand: ${subcommand}`);
      console.error('Run "orchid hooks --help" for usage.');
      process.exit(1);
  }
};
