import { runClaude } from "./commands/claude";
import { runData } from "./commands/data";
import { runReview } from "./commands/review";
import { runExplain } from "./commands/explain";
import { runConfig } from "./commands/config";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";
import { runInstall } from "./commands/install";
import { runUninstall } from "./commands/uninstall";
import { runStatus } from "./commands/status";
import { startDaemon } from "./daemon";

const VERSION = "0.2.0";

const HELP = `orchid - capture and query AI coding sessions

Usage:
  orchid <command> [options]

Commands:
  install   Set up background daemon (captures conversations automatically)
  uninstall Remove background daemon
  status    Show daemon status and capture stats
  login     Authenticate with a Personal Access Token
  logout    Remove stored credentials
  claude    Launch Claude Code and sync the conversation
  config    Set up CLI configuration (~/.orchid/config.json)
  data      Query stored sessions (list, show, search, summary)
  review    Conversation-aware code review
  explain   Explain why a commit was made

Options:
  --help      Show this help message
  --version   Show version
`;

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  if (command === "--version" || command === "-v") {
    console.log(VERSION);
    process.exit(0);
  }

  const subArgs = args.slice(1);

  switch (command) {
    case "install":
      runInstall(subArgs);
      break;
    case "uninstall":
      runUninstall();
      break;
    case "status":
      runStatus();
      break;
    case "daemon":
      // Internal: used by LaunchAgent/systemd to run the daemon in foreground
      startDaemon();
      break;
    case "login":
      runLogin().catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "logout":
      runLogout();
      break;
    case "claude":
      runClaude(subArgs);
      break;
    case "config":
      runConfig(subArgs).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "data":
      runData(subArgs);
      break;
    case "review":
      runReview(subArgs).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "explain":
      runExplain(subArgs).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run "orchid --help" for usage.');
      process.exit(1);
  }
}

main();
