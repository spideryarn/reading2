/**
 * Own one composed fleet server process group.
 *
 * The parent keeps a Node IPC channel open. A disconnect means the parent died
 * without running its cleanup, so this process signals its entire private
 * group (tsx and the real server), waits for it to leave, and removes the
 * temporary environment. This file is plain ESM so it does not itself need a
 * TypeScript loader.
 */
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [root, command, ...args] = process.argv.slice(2);
if (root === undefined || command === undefined) {
  process.stderr.write("fleet child owner needs <temp-root> <command> [args...]\n");
  process.exit(2);
}
const safeRoot = path.resolve(root);
if (path.dirname(safeRoot) !== path.resolve(tmpdir()) || !path.basename(safeRoot).startsWith("fleet-child-server-")) {
  process.stderr.write(`fleet child owner refuses unsafe temp root ${root}\n`);
  process.exit(2);
}

const child = spawn(command, args, { detached: false, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

let shuttingDown = false;
let childExit;
const gone = new Promise((resolve) => {
  childExit = resolve;
});

// `close`, not `exit`: the stdout/stderr pipes have drained before this runs,
// so a fast startup refusal does not lose the line explaining why it refused.
child.once("close", (code, signal) => {
  childExit({ code, signal });
  if (shuttingDown) return;
  removeRoot();
  process.exit(code ?? (signal === null ? 1 : 128));
});
child.once("error", (error) => {
  process.stderr.write(`fleet child owner could not start its server: ${error.message}\n`);
});

function signalOwnGroup(signal) {
  try {
    process.kill(-process.pid, signal);
  } catch {
    // The child may already have taken the group away with it.
  }
}

function removeRoot() {
  try {
    rmSync(safeRoot, { recursive: true, force: true });
  } catch (error) {
    process.stderr.write(
      `fleet child owner could not remove ${safeRoot}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  // This process handles SIGTERM and therefore survives its own group signal;
  // tsx and the server use the default action and leave.
  signalOwnGroup("SIGTERM");
  const result = await Promise.race([
    gone.then(() => "gone"),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), 5_000)),
  ]);
  if (result === "timeout") {
    // SIGKILL includes this owner. Cleanup cannot run, but no listener survives.
    signalOwnGroup("SIGKILL");
    return;
  }
  removeRoot();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.once("disconnect", () => void shutdown());
// These pipes also lose their reader when the parent is killed. Treat EPIPE as
// the same ownership loss instead of letting the wrapper die before its server.
process.stdout.once("error", () => void shutdown());
process.stderr.once("error", () => void shutdown());
// Covers the tiny startup race where the parent died before the disconnect
// listener above was installed.
if (!process.connected) void shutdown();
