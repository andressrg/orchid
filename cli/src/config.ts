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

export function getConfig() {
  const file = readConfigFile();

  const apiUrl = process.env.ORCHID_API_URL || file.api_url;
  const apiKey = process.env.ORCHID_API_KEY || file.api_key;
  const token = process.env.ORCHID_TOKEN || file.token;

  if (!apiUrl) {
    console.error(
      'Error: ORCHID_API_URL not set. Run "orchid config" to set up.'
    );
    process.exit(1);
  }

  if (!token && !apiKey) {
    console.error(
      'Error: Not authenticated. Run "orchid login" to set up.'
    );
    process.exit(1);
  }

  if (apiKey && !token) {
    process.stderr.write(
      "[orchid] Warning: Using legacy API key. Run 'orchid login' to switch to personal access tokens.\n"
    );
  }

  const webUrl = process.env.ORCHID_WEB_URL || file.web_url || apiUrl.replace(/:3000$/, "");
  return { apiUrl, apiKey, token, webUrl };
}

export function getAuthHeaders(): Record<string, string> {
  const { token, apiKey } = getConfig();
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  if (apiKey) {
    return { "X-API-Key": apiKey };
  }
  return {};
}
