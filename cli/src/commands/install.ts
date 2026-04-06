import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";
import { getDaemonPid } from "../daemon";

export const PLIST_LABEL = "com.orchid.daemon";
export const PLIST_PATH = path.join(
  os.homedir(),
  "Library",
  "LaunchAgents",
  `${PLIST_LABEL}.plist`
);
const SYSTEMD_DIR = path.join(os.homedir(), ".config", "systemd", "user");
export const SYSTEMD_SERVICE = path.join(SYSTEMD_DIR, "orchid-daemon.service");

function getNodePath(): string {
  try {
    return execSync("which node", { encoding: "utf-8" }).trim();
  } catch {
    return "node";
  }
}

function getDaemonScriptPath(): string {
  return path.resolve(__dirname, "daemon-entry.js");
}

function getMacOSPlist(): string {
  const nodePath = getNodePath();
  const scriptPath = getDaemonScriptPath();
  const logDir = path.join(os.homedir(), ".orchid");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logDir}/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${logDir}/daemon.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
  </dict>
</dict>
</plist>`;
}

function getLinuxUnit(): string {
  const nodePath = getNodePath();
  const scriptPath = getDaemonScriptPath();

  return `[Unit]
Description=Orchid Daemon - AI conversation capture
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${scriptPath}
Restart=on-failure
RestartSec=5
Environment=PATH=${process.env.PATH}

[Install]
WantedBy=default.target
`;
}

function installMacOS(autoRun: boolean): void {
  const logDir = path.join(os.homedir(), ".orchid");

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const plist = getMacOSPlist();

  const launchAgentsDir = path.dirname(PLIST_PATH);
  if (!fs.existsSync(launchAgentsDir)) {
    fs.mkdirSync(launchAgentsDir, { recursive: true });
  }

  fs.writeFileSync(PLIST_PATH, plist);
  console.log(`  Created ${PLIST_PATH}`);

  if (autoRun) {
    try {
      execSync(`launchctl unload ${PLIST_PATH} 2>/dev/null`, { stdio: "pipe" });
    } catch {
      // Not loaded yet
    }
    execSync(`launchctl load ${PLIST_PATH}`);
    console.log("  Loaded LaunchAgent");
  } else {
    console.log("\n  To start the daemon, run:\n");
    console.log(`    launchctl load ${PLIST_PATH}\n`);
    console.log("  Or let orchid do it for you:\n");
    console.log("    orchid install --run\n");
  }
}

function installLinux(autoRun: boolean): void {
  const unit = getLinuxUnit();

  if (!fs.existsSync(SYSTEMD_DIR)) {
    fs.mkdirSync(SYSTEMD_DIR, { recursive: true });
  }

  fs.writeFileSync(SYSTEMD_SERVICE, unit);
  console.log(`  Created ${SYSTEMD_SERVICE}`);

  if (autoRun) {
    execSync("systemctl --user daemon-reload");
    execSync("systemctl --user enable orchid-daemon");
    execSync("systemctl --user start orchid-daemon");
    console.log("  Started systemd service");
  } else {
    console.log("\n  To start the daemon, run:\n");
    console.log("    systemctl --user daemon-reload");
    console.log("    systemctl --user enable orchid-daemon");
    console.log("    systemctl --user start orchid-daemon\n");
    console.log("  Or let orchid do it for you:\n");
    console.log("    orchid install --run\n");
  }
}

export function runInstall(args: string[] = []): void {
  const autoRun = args.includes("--run");

  const existing = getDaemonPid();
  if (existing) {
    console.log(`Orchid daemon is already running (PID ${existing}).`);
    console.log(`Run "orchid uninstall" first to reinstall.`);
    return;
  }

  console.log("Installing Orchid background daemon...\n");

  const platform = os.platform();

  if (platform === "darwin") {
    installMacOS(autoRun);
  } else if (platform === "linux") {
    installLinux(autoRun);
  } else {
    console.error(`Unsupported platform: ${platform}`);
    console.error(`You can run the daemon manually: orchid daemon`);
    process.exit(1);
  }

  console.log(
    "  Orchid captures conversations automatically once the daemon is running."
  );
  console.log('  Just use "claude" normally.\n');
  console.log("  Commands:");
  console.log("    orchid status      Show daemon status and capture stats");
  console.log("    orchid uninstall   Stop and remove the background daemon");
  console.log("    orchid data list   See captured sessions\n");
}
