import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { getDaemonPid, PID_FILE } from "../daemon";
import { PLIST_PATH, SYSTEMD_SERVICE, WIN_TASK_NAME } from "./install";

function uninstallMacOS(): void {
  try {
    execSync(`launchctl unload ${PLIST_PATH} 2>/dev/null`, { stdio: "pipe" });
    console.log("  Unloaded LaunchAgent");
  } catch {
    // Not loaded
  }

  try {
    fs.unlinkSync(PLIST_PATH);
    console.log(`  Removed ${PLIST_PATH}`);
  } catch {
    // Doesn't exist
  }
}

function uninstallLinux(): void {
  try {
    execSync("systemctl --user stop orchid-daemon 2>/dev/null", {
      stdio: "pipe",
    });
    execSync("systemctl --user disable orchid-daemon 2>/dev/null", {
      stdio: "pipe",
    });
    console.log("  Stopped systemd service");
  } catch {
    // Not running
  }

  try {
    fs.unlinkSync(SYSTEMD_SERVICE);
    execSync("systemctl --user daemon-reload");
    console.log(`  Removed ${SYSTEMD_SERVICE}`);
  } catch {
    // Doesn't exist
  }
}

function uninstallWindows(): void {
  try {
    execSync(`schtasks /End /TN "${WIN_TASK_NAME}" 2>nul`, { stdio: "pipe" });
  } catch {
    // Not running
  }

  try {
    execSync(`schtasks /Delete /TN "${WIN_TASK_NAME}" /F 2>nul`, {
      stdio: "pipe",
    });
    console.log("  Removed Windows Scheduled Task");
  } catch {
    // Doesn't exist
  }

  const xmlPath = path.join(os.homedir(), ".orchid", "orchid-task.xml");
  try {
    fs.unlinkSync(xmlPath);
  } catch {
    // Doesn't exist
  }
}

export function runUninstall(): void {
  console.log("Uninstalling Orchid background daemon...\n");

  const pid = getDaemonPid();
  if (pid) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`  Stopped daemon (PID ${pid})`);
    } catch {
      // Already dead
    }
  }

  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    // ignore
  }

  const platform = os.platform();
  if (platform === "darwin") {
    uninstallMacOS();
  } else if (platform === "linux") {
    uninstallLinux();
  } else if (platform === "win32") {
    uninstallWindows();
  }

  console.log(
    "\n  Orchid daemon removed. Conversations will no longer be captured automatically."
  );
  console.log(
    '  You can still use "orchid claude" to capture individual sessions.\n'
  );
}
