import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_FILE = path.join(os.homedir(), ".orchid", "config.json");

function readConfigFile(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function writeConfigFile(updates: Record<string, string>): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const existing = readConfigFile();
  const merged = { ...existing, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n", {
    mode: 0o600,
  });
}

// Returns apiUrl only — does not require token. Used by `orchid login`.
export function getApiUrl(): string {
  const file = readConfigFile();
  const apiUrl = process.env.ORCHID_API_URL || file.api_url;

  if (!apiUrl) {
    console.error(
      'Error: ORCHID_API_URL not set. Run "orchid config" to set up.'
    );
    process.exit(1);
  }

  return apiUrl;
}

// Returns full config including token. Exits if not authenticated.
export function getConfig() {
  const apiUrl = getApiUrl();
  const file = readConfigFile();
  const token = process.env.ORCHID_TOKEN || file.token;

  if (!token) {
    console.error(
      'Error: Not authenticated. Run "orchid login" to set up.'
    );
    process.exit(1);
  }

  const webUrl = process.env.ORCHID_WEB_URL || file.web_url || apiUrl.replace(/\/api$/, "");
  return { apiUrl, token, webUrl };
}

export function getAuthHeaders(): Record<string, string> {
  const { token } = getConfig();
  return { Authorization: `Bearer ${token}` };
}

/** Returns config or null if not authenticated (no process.exit). */
export function tryGetConfig(): { apiUrl: string; token: string; webUrl: string } | null {
  const file = readConfigFile();
  const apiUrl = process.env.ORCHID_API_URL || file.api_url;
  const token = process.env.ORCHID_TOKEN || file.token;
  if (!apiUrl || !token) return null;
  const webUrl = process.env.ORCHID_WEB_URL || file.web_url || apiUrl.replace(/\/api$/, "");
  return { apiUrl, token, webUrl };
}
