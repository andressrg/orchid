import * as readline from "readline";
import { getApiUrl, writeConfigFile } from "../config";

export async function runLogin(): Promise<void> {
  const apiUrl = getApiUrl();

  console.log("Paste your Personal Access Token.");
  console.log(`Generate one at: ${apiUrl.replace(/\/api$/, "")}/settings/tokens\n`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const token = await new Promise<string>((resolve) => {
    rl.question("Token: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });

  if (!token) {
    console.error("No token provided.");
    process.exit(1);
  }

  if (!token.startsWith("orc_")) {
    console.error("Invalid token format. Tokens start with 'orc_'.");
    process.exit(1);
  }

  // Validate the token
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
}
