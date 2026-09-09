/**
 * Spike: drive `codex app-server` from Node, the way stage 2 will have to.
 *
 * The point is one asymmetry worth knowing before delegating the stage. Every
 * other codex invocation in this repo goes through `scripts/run-codex.ts`, whose
 * central guarantee is that **fd 0 must reach EOF** — a pipe that never closes
 * wedges `codex exec` forever. `codex app-server` is the exact opposite: it is a
 * bidirectional JSON-RPC peer, so stdin must STAY OPEN for the life of the call
 * and closing it early would end the session before the reply arrives.
 *
 * Also checks the two things a collector has to get right regardless: a hard
 * timeout that kills the whole process group, and that a reply is matched by its
 * own id rather than by arrival order.
 */
import { spawn } from "node:child_process";

type Reply = { id?: number; result?: unknown; error?: { code: number; message: string } };

async function readRateLimits(timeoutMs: number): Promise<Reply> {
  const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "ignore"],
    detached: true, // its own process group, so the timeout can kill any helpers too
  });

  return await new Promise<Reply>((resolve, reject) => {
    let buffered = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        /* already gone */
      }
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`no reply within ${timeoutMs}ms`))),
      timeoutMs,
    );

    const send = (o: unknown) => child.stdin.write(`${JSON.stringify(o)}\n`);

    child.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        let parsed: Reply;
        try {
          parsed = JSON.parse(line) as Reply;
        } catch {
          continue; // notifications and anything unparseable are not our reply
        }
        if (parsed.id === 1) {
          send({ jsonrpc: "2.0", method: "initialized", params: {} });
          send({ jsonrpc: "2.0", id: 2, method: "account/rateLimits/read", params: {} });
        } else if (parsed.id === 2) {
          finish(() => resolve(parsed));
        }
      }
    });

    child.on("error", (e) => finish(() => reject(e)));
    child.on("exit", (code) =>
      finish(() => reject(new Error(`app-server exited (${String(code)}) before replying`))),
    );

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "overseer", version: "0.0.1", title: "overseer" } },
    });
    // NOTE: stdin is deliberately NOT ended here.
  });
}

const started = Date.now();
const reply = await readRateLimits(20_000);
const took = Date.now() - started;

if (reply.error) {
  console.log(`unknown arm: ${reply.error.code} ${reply.error.message}`);
} else {
  const r = reply.result as {
    accountId?: string | null;
    rateLimits?: { primary?: { usedPercent?: number; windowDurationMins?: number; resetsAt?: number } };
  };
  const p = r.rateLimits?.primary;
  console.log(
    `value arm in ${took}ms: ${String(p?.usedPercent)}% of a ${String(p?.windowDurationMins)}-minute window, ` +
      `resets ${p?.resetsAt === undefined ? "?" : new Date(p.resetsAt * 1000).toISOString()}`,
  );
}
