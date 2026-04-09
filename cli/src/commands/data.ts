import * as path from "path";
import { getConfig, getAuthHeaders } from "../config";

function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) + "..." : id;
}

interface Session {
  id: string;
  user_name: string;
  user_email: string;
  working_dir: string;
  git_remotes: string[];
  branch: string;
  tool: string;
  started_at: string;
  updated_at: string;
  status: string;
  transcript?: string;
  message_count?: number;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function truncateDir(dir: string): string {
  return path.basename(dir);
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

async function fetchSessions(query?: string): Promise<Session[]> {
  const { apiUrl } = getConfig();
  let url = `${apiUrl.replace(/\/$/, "")}/sessions`;
  if (query) {
    url += `?q=${encodeURIComponent(query)}`;
  }
  const res = await fetch(url, {
    headers: { ...getAuthHeaders() },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} returned ${res.status}: ${text}`);
  }
  return (await res.json()) as Session[];
}

function printTable(sessions: Session[]): void {
  if (sessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  // Compute column widths from the data
  const idWidth = Math.max(4, ...sessions.map((s) => s.id.length));
  const userWidth = Math.max(4, ...sessions.map((s) => (s.user_name || "unknown").length));
  const dirWidth = Math.max(3, ...sessions.map((s) => truncateDir(s.working_dir || "").length));

  const header = [
    padRight("ID", idWidth),
    padRight("USER", userWidth),
    padRight("DIR", dirWidth),
    padRight("TIME", 10),
    padRight("MESSAGES", 12),
    padRight("STATUS", 8),
  ].join("  ");

  console.log(header);
  console.log("─".repeat(header.length));

  for (const s of sessions) {
    const msgCount = s.message_count != null && s.message_count > 0
      ? String(s.message_count)
      : s.transcript
        ? String(s.transcript.split("\n").filter((l) => l.trim()).length)
        : "—";

    const row = [
      padRight(s.id, idWidth),
      padRight(s.user_name || "unknown", userWidth),
      padRight(truncateDir(s.working_dir || ""), dirWidth),
      padRight(timeAgo(s.updated_at || s.started_at), 10),
      padRight(msgCount, 12),
      padRight(s.status || "unknown", 8),
    ].join("  ");

    console.log(row);
  }
}

async function fetchSession(sessionId: string): Promise<Session> {
  const { apiUrl } = getConfig();
  const url = `${apiUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}`;
  const res = await fetch(url, {
    headers: { ...getAuthHeaders() },
  });
  if (res.status === 404) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${url} returned ${res.status}: ${text}`);
  }
  return (await res.json()) as Session;
}

interface JsonlMessage {
  type?: string;
  role?: string;
  message?: { role?: string; content?: unknown };
  content?: unknown;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: { type?: string; text?: string }) => {
        if (typeof block === "string") return block;
        if (block && block.type === "text" && typeof block.text === "string") return block.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

interface Turn {
  role: string;
  text: string;
}

function parseTranscriptTurns(transcript: string): Turn[] {
  const turns: Turn[] = [];
  const lines = transcript.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as JsonlMessage;

      // Claude Code JSONL format: messages have a type and role, or a message object
      let role: string | undefined;
      let text = "";

      if (obj.type === "human" || obj.role === "human" || obj.role === "user") {
        role = "user";
        text = extractTextContent(obj.content || (obj.message && obj.message.content));
      } else if (obj.type === "assistant" || obj.role === "assistant") {
        role = "assistant";
        text = extractTextContent(obj.content || (obj.message && obj.message.content));
      } else if (obj.message) {
        role = obj.message.role || "unknown";
        text = extractTextContent(obj.message.content);
      }

      if (role && text) {
        turns.push({ role, text });
      }
    } catch {
      // skip non-JSON lines
    }
  }

  return turns;
}

async function dataList(): Promise<void> {
  const sessions = await fetchSessions();
  printTable(sessions);
}

async function dataShow(args: string[]): Promise<void> {
  const sessionId = args.find((a) => !a.startsWith("-"));
  if (!sessionId) {
    console.error("Usage: orchid data show <session_id> [--turns|--summary]");
    process.exit(1);
  }

  const flags = args.filter((a) => a.startsWith("-"));
  const showTurns = flags.includes("--turns");
  const showSummary = flags.includes("--summary");

  const session = await fetchSession(sessionId);

  if (showSummary) {
    // Print metadata header
    console.log(`Session: ${session.id}`);
    console.log(`User: ${session.user_name || "unknown"} <${session.user_email || "unknown"}>`);
    console.log(`Branch: ${session.branch || "unknown"}`);
    console.log(`Dir: ${session.working_dir || "unknown"}`);
    console.log(`Status: ${session.status || "unknown"}`);
    console.log(`Started: ${session.started_at || "unknown"}`);
    console.log(`Updated: ${session.updated_at || "unknown"}`);
    console.log("");

    if (session.transcript) {
      const turns = parseTranscriptTurns(session.transcript);
      const firstUser = turns.find((t) => t.role === "user");
      const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

      if (firstUser) {
        console.log("--- First user message ---");
        console.log(firstUser.text);
        console.log("");
      }
      if (lastAssistant) {
        console.log("--- Last assistant message ---");
        console.log(lastAssistant.text);
      }
      if (!firstUser && !lastAssistant) {
        console.log("(no parseable messages in transcript)");
      }
    } else {
      console.log("(no transcript available)");
    }
    return;
  }

  if (showTurns) {
    if (!session.transcript) {
      console.log("(no transcript available)");
      return;
    }
    const turns = parseTranscriptTurns(session.transcript);
    if (turns.length === 0) {
      console.log("(no parseable messages in transcript)");
      return;
    }
    for (const turn of turns) {
      console.log(`[${turn.role}]`);
      console.log(turn.text);
      console.log("");
    }
    return;
  }

  // Default: raw transcript
  if (session.transcript) {
    process.stdout.write(session.transcript);
  } else {
    console.log("(no transcript available)");
  }
}

function extractMatchContext(transcript: string, query: string): string {
  const lowerTranscript = transcript.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lowerTranscript.indexOf(lowerQuery);
  if (idx === -1) return "";

  const contextRadius = 60;
  const start = Math.max(0, idx - contextRadius);
  const end = Math.min(transcript.length, idx + query.length + contextRadius);

  let snippet = transcript.slice(start, end).replace(/\n/g, " ").replace(/\s+/g, " ");
  if (start > 0) snippet = "..." + snippet;
  if (end < transcript.length) snippet = snippet + "...";
  return snippet;
}

async function dataSearch(args: string[]): Promise<void> {
  const query = args.filter((a) => !a.startsWith("-")).join(" ");
  if (!query) {
    console.error("Usage: orchid data search <query>");
    process.exit(1);
  }

  const sessions = await fetchSessions(query);

  if (sessions.length === 0) {
    console.log(`No sessions matching "${query}"`);
    return;
  }

  for (const s of sessions) {
    let context = "";
    try {
      const full = await fetchSession(s.id);
      if (full.transcript) {
        context = extractMatchContext(full.transcript, query);
      }
    } catch {
      // skip context if fetch fails
    }

    console.log(
      `${s.id}  ${padRight(s.user_name || "unknown", 16)}  ${padRight(timeAgo(s.updated_at || s.started_at), 10)}`
    );
    if (context) {
      console.log(`  ${context}`);
    }
    console.log("");
  }
}

async function dataSummary(args: string[]): Promise<void> {
  const sessionId = args.find((a) => !a.startsWith("-"));
  if (!sessionId) {
    console.error("Usage: orchid data summary <session_id>");
    process.exit(1);
  }

  const { apiUrl } = getConfig();
  const url = `${apiUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId)}/summary`;

  console.log(`\x1b[35m🌸 Generating AI summary...\x1b[0m\n`);

  try {
    const res = await fetch(url, {
      headers: { ...getAuthHeaders() },
    });

    if (res.status === 503) {
      console.error("\x1b[33mAI summaries not available (server needs OPENAI_API_KEY)\x1b[0m");
      return;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    const data = (await res.json()) as { summary: string };
    console.log(data.summary);
    console.log();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function dataDecisions(args: string[]): Promise<void> {
  const repo = args.find((a) => !a.startsWith("-"));
  const { apiUrl, webUrl } = getConfig();
  const url = repo
    ? `${apiUrl.replace(/\/$/, "")}/decisions?repo=${encodeURIComponent(repo)}`
    : `${apiUrl.replace(/\/$/, "")}/decisions`;

  console.log(`\x1b[35m🧠 Extracting architectural decisions${repo ? ` for "${repo}"` : ""}...\x1b[0m\n`);

  const res = await fetch(url, { headers: { ...getAuthHeaders() } });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

  const data = (await res.json()) as {
    decisions: Array<{
      title: string;
      decision: string;
      alternatives: string[];
      reason: string;
      session_id: string;
      turn_index: number;
    }>;
    sessions_analyzed: number;
  };

  if (data.decisions.length === 0) {
    console.log(`No architectural decisions found${repo ? ` for "${repo}"` : ""}.`);
    return;
  }

  console.log(`Found \x1b[1m${data.decisions.length}\x1b[0m decisions across ${data.sessions_analyzed} sessions\n`);
  console.log("━".repeat(60));

  for (const d of data.decisions) {
    console.log(`\n\x1b[32m✅ ${d.title}\x1b[0m`);
    console.log(`   \x1b[1mDecision:\x1b[0m ${d.decision}`);
    if (d.reason) console.log(`   \x1b[2mWhy:\x1b[0m ${d.reason}`);
    if (d.alternatives?.length > 0) {
      console.log(`   \x1b[2mAlternatives:\x1b[0m ${d.alternatives.join(", ")}`);
    }
    const base = (webUrl || apiUrl).replace(/\/$/, "").replace(/:3000$/, "");
    const link = `${base}/sessions/${encodeURIComponent(d.session_id)}?turn=${d.turn_index + 1}`;
    console.log(`   \x1b[36m→ ${link}\x1b[0m  \x1b[2m(turn ${d.turn_index + 1} in session ${d.session_id.slice(0, 8)}…)\x1b[0m`);
  }
  console.log();
}

async function dataAsk(args: string[]): Promise<void> {
  const sessionId = args.find((a) => !a.startsWith("-"));
  if (!sessionId) {
    console.error("Usage: orchid data ask <session_id> <question>");
    console.error('       orchid data ask <session_id>   (interactive mode)');
    process.exit(1);
  }

  const questionParts = args.slice(1).filter((a) => !a.startsWith("-"));
  const question = questionParts.join(" ");

  const { apiUrl } = getConfig();
  const history: Array<{ role: string; content: string }> = [];

  async function askQuestion(q: string): Promise<string> {
    const url = `${apiUrl.replace(/\/$/, "")}/sessions/${encodeURIComponent(sessionId!)}/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...getAuthHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question: q, history }),
    });

    if (res.status === 503) {
      throw new Error("Chat not available (server needs OPENAI_API_KEY)");
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status}: ${text}`);
    }

    const data = (await res.json()) as { answer: string };
    return data.answer;
  }

  if (question) {
    // Single question mode
    console.log(`\x1b[35m🌸 Asking about session ${shortId(sessionId)}...\x1b[0m\n`);
    const answer = await askQuestion(question);
    console.log(answer);
    console.log();
    return;
  }

  // Interactive mode
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\x1b[35m🌸 Orchid Chat — Session ${shortId(sessionId)}\x1b[0m`);
  console.log(`\x1b[90mAsk questions about this conversation. Type "exit" to quit.\x1b[0m\n`);

  const prompt = () => {
    rl.question("\x1b[36m❯ \x1b[0m", async (input) => {
      const trimmed = input.trim();
      if (!trimmed || trimmed === "exit" || trimmed === "quit") {
        rl.close();
        return;
      }

      try {
        history.push({ role: "user", content: trimmed });
        process.stdout.write("\x1b[90mThinking...\x1b[0m\r");
        const answer = await askQuestion(trimmed);
        process.stdout.write("             \r"); // clear "Thinking..."
        console.log(`\n\x1b[35m🌸\x1b[0m ${answer}\n`);
        history.push({ role: "assistant", content: answer });
      } catch (err) {
        console.error(`\x1b[31mError: ${(err as Error).message}\x1b[0m`);
      }

      prompt();
    });
  };

  prompt();
}

interface SessionCommitResult {
  session_id: string;
  commit_sha: string;
  branch: string;
  remote: string;
  message: string;
  committed_at: string;
  user_name: string;
  user_email: string;
  status: string;
  started_at: string;
  updated_at: string;
  working_dir: string;
  tool: string;
}

async function dataSessionsFor(args: string[]): Promise<void> {
  const raw = args.filter((a) => !a.startsWith("-")).join(",");
  const shas = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (shas.length === 0) {
    console.error("Usage: orchid data sessions-for <sha1>,<sha2>,<sha3>");
    console.error("\nFind which AI sessions produced one or more commits.");
    console.error("Separate multiple SHAs with commas.");
    process.exit(1);
  }

  const { apiUrl, webUrl } = getConfig();
  const base = apiUrl.replace(/\/$/, "");
  const url = `${base}/commits/sessions?shas=${shas.map(encodeURIComponent).join(",")}`;

  const res = await fetch(url, { headers: { ...getAuthHeaders() } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }

  const data = (await res.json()) as { sessions: SessionCommitResult[] };

  if (data.sessions.length === 0) {
    console.log(`No sessions found for ${shas.length === 1 ? `commit ${shas[0]}` : `${shas.length} commits`}`);
    return;
  }

  // Deduplicate sessions (multiple commits can map to the same session)
  const seen = new Set<string>();
  const unique = data.sessions.filter((s) => {
    if (seen.has(s.session_id)) return false;
    seen.add(s.session_id);
    return true;
  });

  const label = shas.length === 1 ? `commit ${shas[0].slice(0, 8)}` : `${shas.length} commits`;
  console.log(`\x1b[35m🌸 ${unique.length} session${unique.length > 1 ? "s" : ""} for ${label}\x1b[0m\n`);

  const webBase = (webUrl || apiUrl).replace(/\/$/, "").replace(/:3000$/, "");
  for (const s of unique) {
    // Find which of the queried commits belong to this session
    const matchedCommits = data.sessions
      .filter((r) => r.session_id === s.session_id)
      .map((r) => `${r.commit_sha.slice(0, 8)} ${r.message || ""}`.trim());

    console.log(`\x1b[1m${s.session_id}\x1b[0m`);
    console.log(`  \x1b[90mUser:\x1b[0m ${s.user_name || "unknown"}`);
    console.log(`  \x1b[90mBranch:\x1b[0m ${s.branch || "unknown"}`);
    console.log(`  \x1b[90mStatus:\x1b[0m ${s.status} | Started: ${timeAgo(s.started_at)}`);
    matchedCommits.forEach((c) => console.log(`  \x1b[90mCommit:\x1b[0m ${c}`));
    console.log(`  \x1b[34m${webBase}/sessions/${encodeURIComponent(s.session_id)}\x1b[0m`);
    console.log();
  }
}

export function runData(args: string[]): void {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    console.log(`orchid data - query stored sessions

Usage:
  orchid data <command>

Commands:
  list            List all stored sessions
  show            Show a session transcript
  search          Search across sessions
  sessions-for    Find sessions that produced a commit
  summary         AI-generated session summary
  decisions       AI-extracted architectural decision log
  ask             Ask questions about a session's conversation`);
    return;
  }

  switch (subcommand) {
    case "list":
      dataList().catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "show":
      dataShow(args.slice(1)).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "search":
      dataSearch(args.slice(1)).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "sessions-for":
      dataSessionsFor(args.slice(1)).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "summary":
      dataSummary(args.slice(1)).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "decisions":
      dataDecisions(args.slice(1)).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    case "ask":
      dataAsk(args.slice(1)).catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      });
      break;
    default:
      console.error(`Unknown data command: ${subcommand}`);
      console.error('Run "orchid data --help" for usage.');
      process.exit(1);
  }
}
