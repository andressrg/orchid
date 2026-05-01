import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

const CONFIG_DIR = path.join(os.homedir(), '.orchid');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  api_url: 'https://www.orchidkeep.com/api',
  web_url: 'https://www.orchidkeep.com',
};

type ConfigKey = keyof typeof DEFAULTS;

const LABELS: Record<ConfigKey, string> = {
  api_url: 'API URL',
  web_url: 'Web UI URL',
};

function readConfig(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, string>) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
}

function mask(value: string): string {
  if (!value || value.length <= 8) return value ? '••••' : '(not set)';
  return value.slice(0, 4) + '••••' + value.slice(-4);
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function runSetup() {
  const existing = readConfig();
  const config = { ...DEFAULTS, ...existing };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  console.error('\n\x1b[35m🌸 Orchid Config\x1b[0m\n');
  console.error('Press Enter to keep the current value.\n');

  for (const key of Object.keys(DEFAULTS) as ConfigKey[]) {
    const current = config[key];
    const display = key.includes('key')
      ? mask(current)
      : current || '(not set)';
    const answer = await prompt(rl, `  ${LABELS[key]} [${display}]: `);
    if (answer.trim()) {
      config[key] = answer.trim();
    }
  }

  rl.close();

  writeConfig(config);
  console.error(`\n\x1b[32m✓\x1b[0m Config saved to ${CONFIG_FILE}\n`);
}

function runShow() {
  const config = { ...DEFAULTS, ...readConfig() };
  console.error(`\n\x1b[35m🌸 Orchid Config\x1b[0m  ${CONFIG_FILE}\n`);
  for (const key of Object.keys(DEFAULTS) as ConfigKey[]) {
    const value = config[key];
    const display = key.includes('key') ? mask(value) : value || '(not set)';
    console.error(`  ${LABELS[key]}: ${display}`);
  }
  console.error('');
}

const VALID_KEYS = Object.keys(DEFAULTS) as ConfigKey[];

function runSet(args: string[]) {
  const [key, ...rest] = args;
  const value = rest.join(' ');

  if (!key || !value) {
    console.error('Usage: orchid config set <key> <value>');
    console.error(`\nValid keys: ${VALID_KEYS.join(', ')}`);
    process.exit(1);
  }

  if (!VALID_KEYS.includes(key as ConfigKey)) {
    console.error(`Unknown key: ${key}`);
    console.error(`Valid keys: ${VALID_KEYS.join(', ')}`);
    process.exit(1);
  }

  const config: Record<string, string> = { ...DEFAULTS, ...readConfig() };
  config[key] = value;
  writeConfig(config);
  console.error(`\x1b[32m✓\x1b[0m Set ${key}`);
}

function runGet(args: string[]) {
  const key = args[0];

  if (!key) {
    console.error('Usage: orchid config get <key>');
    console.error(`\nValid keys: ${VALID_KEYS.join(', ')}`);
    process.exit(1);
  }

  if (!VALID_KEYS.includes(key as ConfigKey)) {
    console.error(`Unknown key: ${key}`);
    process.exit(1);
  }

  const config: Record<string, string> = { ...DEFAULTS, ...readConfig() };
  const value = config[key] || '';
  console.log(value);
}

export async function runConfig(args: string[]) {
  const sub = args[0];

  if (sub === '--help' || sub === '-h') {
    console.log(`orchid config — manage CLI configuration

Usage:
  orchid config                    Interactive setup (creates ~/.orchid/config.json)
  orchid config set <key> <value>  Set a config value
  orchid config get <key>          Get a config value
  orchid config show               Show current configuration
  orchid config path               Print config file path

Keys: ${VALID_KEYS.join(', ')}`);
    return;
  }

  if (sub === 'set') {
    runSet(args.slice(1));
    return;
  }

  if (sub === 'get') {
    runGet(args.slice(1));
    return;
  }

  if (sub === 'show') {
    runShow();
    return;
  }

  if (sub === 'path') {
    console.log(CONFIG_FILE);
    return;
  }

  if (!sub) {
    await runSetup();
    return;
  }

  console.error(`Unknown config subcommand: ${sub}`);
  console.error('Run "orchid config --help" for usage.');
  process.exit(1);
}
