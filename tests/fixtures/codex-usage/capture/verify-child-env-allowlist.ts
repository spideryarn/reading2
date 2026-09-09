/**
 * Does the real collector still work under the allowlist, and is CODEX_API_KEY
 * genuinely absent from the child?
 *
 * The first question cannot be answered by a unit test: the fake executor proves
 * what environment we ASK for, not that codex can run in it. This runs the real
 * thing. The second is checked by planting a sentinel value in the parent and
 * asserting it does not survive into the child's environment.
 */
import {
  childEnvironment,
  collectCodexUsage,
} from "../../../../tools/overseer/codex-usage.js";

const planted: NodeJS.ProcessEnv = {
  ...process.env,
  CODEX_API_KEY: "sentinel-must-not-cross",
  OPENROUTER_API_KEY: "sentinel-must-not-cross",
  DATABASE_URL: "postgres://sentinel/must-not-cross",
};

const child = childEnvironment(planted);
const leaked = Object.entries(child).filter(([, v]) => typeof v === "string" && v.includes("sentinel"));
console.log("child env keys:", Object.keys(child).sort().join(", "));
console.log("leaked sentinels:", leaked.length === 0 ? "none" : JSON.stringify(leaked));

const reading = await collectCodexUsage({ env: planted, timeoutMs: 25_000 });
if (reading.kind === "unknown") {
  console.log(`REAL COLLECTOR: unknown — ${reading.why} (retryable=${String(reading.retryable)})`);
} else {
  const codex = reading.buckets.find((b) => b.limitId === "codex");
  const win = codex?.windows.find((w) => w.kind === "value");
  console.log(
    `REAL COLLECTOR: value, account=${String(reading.accountId)}, readAt=${reading.readAt}, ` +
      `buckets=${reading.buckets.map((b) => b.limitId).join("/")}`,
  );
  console.log(
    win === undefined || win.kind !== "value"
      ? "  no usable window on the codex bucket"
      : `  ${win.usedPercent}% of a ${win.windowMinutes}-minute window (slot ${win.slot}), resets ${win.resetsAt}`,
  );
}
