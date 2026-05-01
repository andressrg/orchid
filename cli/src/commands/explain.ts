import { execSync } from 'child_process';
import { getConfig, getAuthHeaders } from '../config';

interface Session {
  id: string;
  user_name: string;
  branch: string;
  started_at: string;
  updated_at: string;
  status: string;
  transcript?: string;
}

function execGit(args: string): string {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

export async function runExplain(args: string[]): Promise<void> {
  const sha = args.find((a) => !a.startsWith('-'));

  if (!sha) {
    console.log(`orchid explain - understand why a commit was made

Usage:
  orchid explain <commit-sha>

Looks at the commit, finds conversations that happened around the same
time on the same branch, and explains the reasoning behind the changes.

Environment:
  OPENAI_API_KEY   For AI-powered explanations (optional)
`);
    return;
  }

  // Get commit info
  const commitMsg = execGit(`log -1 --format="%s" ${sha}`);
  const commitDate = execGit(`log -1 --format="%aI" ${sha}`);
  const commitAuthor = execGit(`log -1 --format="%an" ${sha}`);
  const commitBranch = execGit(
    `branch --contains ${sha} --format="%(refname:short)"`,
  ).split('\n')[0];
  const diffStat = execGit(`diff --stat ${sha}~1..${sha}`);

  if (!commitMsg) {
    console.error(`\x1b[31mCommit not found: ${sha}\x1b[0m`);
    process.exit(1);
  }

  console.log(`\x1b[35m🌸 Orchid Explain\x1b[0m`);
  console.log(`\x1b[90m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\x1b[0m`);
  console.log(`\x1b[1mCommit: ${sha.slice(0, 8)}\x1b[0m — ${commitMsg}`);
  console.log(
    `\x1b[90mAuthor: ${commitAuthor} | Date: ${commitDate} | Branch: ${commitBranch}\x1b[0m`,
  );
  if (diffStat) {
    console.log(`\x1b[90m${diffStat}\x1b[0m`);
  }
  console.log();

  // Search for related sessions
  const { apiUrl } = getConfig();
  console.log(`\x1b[90mSearching for related conversations...\x1b[0m`);

  let sessions: Session[] = [];
  try {
    // Search by branch name and commit message keywords
    const searchTerms = [
      commitBranch,
      ...commitMsg.split(/\s+/).filter((w: string) => w.length > 4),
    ].slice(0, 3);

    for (const term of searchTerms) {
      if (!term) continue;
      const res = await fetch(
        `${apiUrl.replace(/\/$/, '')}/sessions?q=${encodeURIComponent(term)}`,
        { headers: { ...getAuthHeaders() } },
      );
      if (res.ok) {
        const results = (await res.json()) as Session[];
        for (const s of results) {
          if (!sessions.find((e) => e.id === s.id)) {
            sessions.push(s);
          }
        }
      }
    }
  } catch (err) {
    console.error(
      `\x1b[31mError searching sessions: ${(err as Error).message}\x1b[0m`,
    );
    return;
  }

  if (sessions.length === 0) {
    console.log(`\x1b[33mNo related conversations found.\x1b[0m`);
    return;
  }

  console.log(
    `\x1b[32mFound ${sessions.length} related conversation${sessions.length > 1 ? 's' : ''}\x1b[0m\n`,
  );

  // Fetch transcripts
  for (const s of sessions.slice(0, 2)) {
    try {
      const res = await fetch(
        `${apiUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(s.id)}`,
        { headers: { ...getAuthHeaders() } },
      );
      if (res.ok) {
        const full = (await res.json()) as Session;
        console.log(`\x1b[1m  Session: ${full.id}\x1b[0m`);
        console.log(
          `\x1b[90m  By ${full.user_name} on ${full.branch}\x1b[0m\n`,
        );

        // Show first 2 turns as context
        if (full.transcript) {
          const lines = full.transcript.split('\n').filter((l) => l.trim());
          let shown = 0;
          for (const line of lines) {
            if (shown >= 4) break;
            try {
              const obj = JSON.parse(line);
              const text = typeof obj.content === 'string' ? obj.content : '';
              if (text) {
                const role =
                  obj.type === 'human' || obj.role === 'user'
                    ? '\x1b[35m  Developer\x1b[0m'
                    : '\x1b[34m  Claude\x1b[0m';
                const snippet =
                  text.length > 150 ? text.slice(0, 150) + '...' : text;
                console.log(`  ${role}: ${snippet.replace(/\n/g, ' ')}\n`);
                shown++;
              }
            } catch {
              // skip
            }
          }
        }
      }
    } catch {
      // skip
    }
  }

  // AI explanation if available
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && sessions.length > 0) {
    console.log(`\x1b[35m🤖 AI Explanation\x1b[0m`);
    console.log(
      `\x1b[90mAnalyzing commit in context of conversations...\x1b[0m\n`,
    );

    try {
      const sessionContext = sessions
        .slice(0, 2)
        .map((s) => `Session ${s.id} by ${s.user_name} on branch ${s.branch}`)
        .join('; ');

      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content:
                  'You are explaining why a git commit was made, based on AI conversation context. Be concise (2-3 sentences). Explain the motivation and key decisions.',
              },
              {
                role: 'user',
                content: `Commit: "${commitMsg}" by ${commitAuthor}\nFiles changed:\n${diffStat}\n\nRelated conversations: ${sessionContext}`,
              },
            ],
            max_tokens: 200,
            temperature: 0.3,
          }),
        },
      );

      if (response.ok) {
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const explanation = data.choices?.[0]?.message?.content;
        if (explanation) {
          console.log(explanation);
        }
      }
    } catch {
      // skip AI explanation
    }
  }

  console.log(`\n\x1b[90m━━━ End of Orchid Explain ━━━\x1b[0m`);
}
