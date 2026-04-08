import { getApiUrl, writeConfigFile } from "../config";

const readHidden = (prompt: string): Promise<string> =>
  new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");

    const chunks: string[] = [];

    const onData = (ch: string) => {
      // Enter
      if (ch === "\r" || ch === "\n") {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(chunks.join(""));
        return;
      }
      // Ctrl+C
      if (ch === "\x03") {
        process.stdin.setRawMode?.(false);
        process.stdout.write("\n");
        process.exit(1);
      }
      // Backspace
      if (ch === "\x7f" || ch === "\b") {
        if (chunks.length > 0) {
          chunks.pop();
          process.stdout.write("\b \b");
        }
        return;
      }
      // Paste or regular char — mask each character
      [...ch].forEach((c) => {
        chunks.push(c);
        process.stdout.write("•");
      });
    };

    process.stdin.on("data", onData);
  });

export const runLogin = async (): Promise<void> => {
  const apiUrl = getApiUrl();

  console.log("Paste your Personal Access Token.");
  console.log(`Generate one at: ${apiUrl.replace(/\/api$/, "")}/settings/tokens\n`);

  const token = (await readHidden("Token: ")).trim();

  if (!token) {
    console.error("No token provided.");
    process.exit(1);
  }

  if (!token.startsWith("orc_")) {
    console.error("Invalid token format. Tokens start with 'orc_'.");
    process.exit(1);
  }

  process.stderr.write("Validating token...\n");
  const res = await fetch(`${apiUrl.replace(/\/$/, "")}/tokens/validate`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.error("Invalid or expired token.");
    process.exit(1);
  }

  writeConfigFile({ token });
  console.log("Logged in successfully.");
};
