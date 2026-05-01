#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const webDir = path.join(rootDir, "web");
const args = process.argv.slice(2);
const instanceArg = args.find((arg) => !arg.startsWith("-"));

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`Usage: pnpm dev:stack [instance-name]

Starts an isolated local Orchid stack in the foreground.

- picks free app and Postgres ports automatically
- creates a compose-isolated Postgres volume by project name
- runs web database migrations
- streams prefixed logs from Postgres and Next.js
`);
  process.exit(0);
}

const instanceId = instanceArg ?? `stack-${randomUUID().slice(0, 8)}`;
const composeProjectName = `orchid-${instanceId}`;
const postgresDb = `orchid_${instanceId.replace(/[^a-zA-Z0-9_]/g, "_")}`;

const prefixLogLine = ({ prefix, line }) => {
  const timestamp = new Date().toISOString().slice(11, 19);
  process.stdout.write(`[${timestamp}] [${prefix}] ${line}\n`);
};

const streamOutputWithPrefix = ({ prefix, stream }) => {
  const lineReader = createInterface({ input: stream });
  lineReader.on("line", (line) => {
    prefixLogLine({ prefix, line });
  });
};

const sleep = ({ milliseconds }) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isPortAvailable = ({ port }) => {
  try {
    execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { stdio: "ignore" });
    return false;
  } catch (error) {
    const unavailable = error && typeof error === "object" && "status" in error ? error.status !== 1 : true;
    return !unavailable;
  }
};

const findAvailablePort = async ({ preferredPort }) => {
  const maxAttempts = 200;
  const portOffsets = Array.from({ length: maxAttempts }, (_, offset) => offset);

  const availablePort = await portOffsets.reduce(
    async (pendingPort, offset) => {
      const resolvedPort = await pendingPort;
      if (resolvedPort !== null) {
        return resolvedPort;
      }

      const candidatePort = preferredPort + offset;
      const available = isPortAvailable({ port: candidatePort });
      return available ? candidatePort : null;
    },
    Promise.resolve(null),
  );

  if (availablePort === null) {
    throw new Error(`No free port found starting at ${preferredPort}`);
  }

  return availablePort;
};

const spawnManagedProcess = ({ command, args, cwd, env, prefix }) => {
  const childProcess = spawn(command, args, {
    cwd,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (childProcess.stdout) {
    streamOutputWithPrefix({ prefix, stream: childProcess.stdout });
  }

  if (childProcess.stderr) {
    streamOutputWithPrefix({ prefix, stream: childProcess.stderr });
  }

  childProcess.on("error", (error) => {
    prefixLogLine({ prefix, line: `process error: ${error.message}` });
  });

  return childProcess;
};

const waitForPostgres = async ({ composeProjectName, postgresDb }) => {
  const readinessAttempts = Array.from({ length: 60 }, (_, index) => index);

  const postgresReady = await readinessAttempts.reduce(
    async (pendingReady, attemptIndex) => {
      const resolvedReady = await pendingReady;
      if (resolvedReady) {
        return true;
      }

      if (attemptIndex > 0) {
        await sleep({ milliseconds: 1000 });
      }

      const readyExitCode = await new Promise((resolve) => {
        const readinessCheck = spawn(
          "docker",
          ["compose", "-p", composeProjectName, "exec", "-T", "db", "pg_isready", "-U", "orchid", "-d", postgresDb],
          { stdio: "ignore" },
        );

        readinessCheck.on("exit", (code) => resolve(code === 0));
        readinessCheck.on("error", () => resolve(false));
      });

      return readyExitCode;
    },
    Promise.resolve(false),
  );

  if (!postgresReady) {
    throw new Error("Postgres did not become ready");
  }
};

const main = async () => {
  const appPort = await findAvailablePort({ preferredPort: 3000 });
  const postgresPort = await findAvailablePort({ preferredPort: 5432 });
  const databaseUrl = `postgresql://orchid:orchid@127.0.0.1:${postgresPort}/${postgresDb}`;
  const sharedEnv = {
    ...process.env,
    PORT: String(appPort),
    POSTGRES_PORT: String(postgresPort),
    POSTGRES_DB: postgresDb,
    DATABASE_URL: databaseUrl,
  };

  prefixLogLine({
    prefix: "stack",
    line: `instance=${instanceId} app=http://127.0.0.1:${appPort} db=${postgresDb} postgres=${postgresPort}`,
  });

  const composeProcess = spawnManagedProcess({
    command: "docker",
    args: ["compose", "-p", composeProjectName, "up", "--remove-orphans"],
    cwd: rootDir,
    env: sharedEnv,
    prefix: "db",
  });

  const cleanupPromises = [];
  const childProcesses = [composeProcess];

  const stopCompose = () =>
    spawn("docker", ["compose", "-p", composeProjectName, "down", "--remove-orphans"], {
      cwd: rootDir,
      env: sharedEnv,
      stdio: "inherit",
    });

  const cleanup = ({ signal, exitCode }) => {
    const existingCleanup = cleanupPromises.at(0);
    if (existingCleanup) {
      return existingCleanup;
    }

    const cleanupPromise = (async () => {
    prefixLogLine({ prefix: "stack", line: `shutting down (${signal ?? `exit ${exitCode}`})` });

    childProcesses
      .filter((childProcess) => childProcess.exitCode === null && !childProcess.killed)
      .forEach((childProcess) => {
        childProcess.kill("SIGTERM");
      });

    const composeDown = stopCompose();
    await new Promise((resolve) => {
      composeDown.on("exit", resolve);
      composeDown.on("error", resolve);
    });

    process.exit(typeof exitCode === "number" ? exitCode : 0);
    })();

    cleanupPromises.push(cleanupPromise);
    return cleanupPromise;
  };

  process.on("SIGINT", () => {
    void cleanup({ signal: "SIGINT", exitCode: 0 });
  });
  process.on("SIGTERM", () => {
    void cleanup({ signal: "SIGTERM", exitCode: 0 });
  });

  composeProcess.on("exit", (code) => {
    void cleanup({ signal: "db-exit", exitCode: code ?? 1 });
  });

  try {
    await waitForPostgres({ composeProjectName, postgresDb });
    prefixLogLine({ prefix: "stack", line: "postgres is ready; running migrations" });

    const migrateExitCode = await new Promise((resolve) => {
      const migrateProcess = spawnManagedProcess({
        command: "pnpm",
        args: ["db:migrate"],
        cwd: webDir,
        env: sharedEnv,
        prefix: "migrate",
      });
      childProcesses.push(migrateProcess);
      migrateProcess.on("exit", (code) => resolve(code ?? 1));
    });

    if (migrateExitCode !== 0) {
      throw new Error(`Migration failed with exit code ${migrateExitCode}`);
    }

    prefixLogLine({ prefix: "stack", line: "starting Next.js dev server" });

    const webProcess = spawnManagedProcess({
      command: "pnpm",
      args: ["dev"],
      cwd: webDir,
      env: sharedEnv,
      prefix: "web",
    });

    childProcesses.push(webProcess);

    webProcess.on("exit", (code) => {
      void cleanup({ signal: "web-exit", exitCode: code ?? 1 });
    });
  } catch (error) {
    prefixLogLine({
      prefix: "stack",
      line: `startup failed: ${error instanceof Error ? error.message : "unknown error"}`,
    });
    await cleanup({ signal: "startup-error", exitCode: 1 });
  }
};

main().catch((error) => {
  prefixLogLine({ prefix: "stack", line: `failed: ${error.message}` });
  process.exit(1);
});
