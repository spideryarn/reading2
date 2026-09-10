/**
 * Subprocess fixture for the fleet child owner's parent-death contract.
 * The test kills this process without cleanup; the child must notice that its
 * ownership pipe closed and stop itself.
 *
 * It prints its own pid so the test can check it is killing THIS process —
 * the one holding the owner's IPC pipe — and not a launcher above it.
 *
 * It says ready only once the server has gone QUIET. The owner has a second
 * detector: an EPIPE when it next forwards a server line to this dead process.
 * Killed mid-startup, the server's next log line trips that within about half a
 * second, and the test stayed green with the disconnect handler deleted. Once
 * it is quiet (every loop is an hour away), nothing writes after the kill and
 * only the IPC disconnect can close the listener in the test's window.
 */
import { startFleetChild } from "./fleet-child-server.js";

const child = await startFleetChild();
const QUIET_MS = 1_500;
const giveUpAt = Date.now() + 30_000;
let seen = child.output().length;
let changedAt = Date.now();
while (Date.now() - changedAt < QUIET_MS) {
  if (Date.now() > giveUpAt) {
    process.stderr.write(`fleet-orphan-parent: the server never went quiet for ${QUIET_MS}ms:\n${child.output()}\n`);
    await child.stop();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 100));
  const now = child.output().length;
  if (now !== seen) {
    seen = now;
    changedAt = Date.now();
  }
}
process.stdout.write(`fleet-orphan-parent port=${child.port} owner=${child.ownerPid} pid=${process.pid}\n`);
await new Promise(() => {});
