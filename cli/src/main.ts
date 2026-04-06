import { runClaude } from "./commands/claude";
import { runData } from "./commands/data";
import { runSync } from "./commands/sync";
import { runReview } from "./commands/review";
import { runExplain } from "./commands/explain";
import { runConfig } from "./commands/config";
import { runLogin } from "./commands/login";
import { runLogout } from "./commands/logout";

const VERSION = "0.1.0";

const HELP = `orchid - capture and query AI coding sessions

Usage:
  orchid <command> [options]

Commands:
  login     Authenticate with a Personal Access Token
  logout    Remove stored credentials
  claude    Launch Claude Code and sync the conversation
  sync      Sync past conversations (--discover to scan all)
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
    case "sync":
      runSync(subArgs);
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
