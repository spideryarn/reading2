import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseMessageBody } from "../tools/fleet/routes-steer.js";
import { steerMessageBody } from "../tools/fleet/web/src/steer-client.js";
import { parseRow } from "../tools/fleet/web/src/types.js";

import { overseerTarget, readTellAnswer, splitStatus, tellPostCommand } from "../scripts/gjd-remote-tell.js";

const NOW = "2026-10-09T22:43:28.580Z";

function snapshot(rows: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { schema: 1, error: null, collectedAt: "2026-10-09T22:42:33.630Z", servedAt: NOW, rows, ...extra };
}

const overseer = {
  id: "$2514",
  name: "Overseer",
  paneId: "%2517",
  panePid: 4039570,
  claudeSessionId: "606cb12a-ffc5-4df4-af3a-7dc881135b5f",
  status: { kind: "working" },
  role: { kind: "overseer" },
};
const peer = { ...overseer, id: "$6150", name: "peer", paneId: "%9", role: { kind: "none" } };

function hasTerminalControl(text: string): boolean {
  return [...text].some((c) => {
    const code = c.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

describe("overseerTarget", () => {
  it("builds the steer body from the row holding the claim, as speaker greg", () => {
    const t = overseerTarget(snapshot([peer, overseer]), "hello");
    expect(t).toEqual({
      ok: true,
      name: "Overseer",
      body: {
        paneId: "%2517",
        sessionId: "$2514",
        claudeSessionId: "606cb12a-ffc5-4df4-af3a-7dc881135b5f",
        panePid: 4039570,
        status: { kind: "working" },
        text: "hello",
        speaker: "greg",
      },
    });
    if (!t.ok) throw new Error("expected a target");
    expect(parseMessageBody(t.body)).toEqual({
      ok: true,
      value: {
        target: { paneId: overseer.paneId, sessionId: overseer.id, claudeSessionId: overseer.claudeSessionId, panePid: overseer.panePid },
        text: "hello", declaredStatus: overseer.status, speaker: "greg",
      },
    });
  });

  it("posts the same raw status and identity as the dashboard card", () => {
    const row = { ...overseer, status: { kind: "unknown", cause: "agents-unavailable", why: "not measured", extra: "preserve me" } };
    const t = overseerTarget(snapshot([row]), "hello");
    const webRow = parseRow(row, { kind: "known", ms: 0 });
    if (!t.ok || webRow === null) throw new Error("expected a target");
    expect(t.body).toEqual(steerMessageBody(webRow, "hello"));
    expect(t.body.status).toBe(row.status);
    expect(parseMessageBody(t.body)).toMatchObject({ ok: true, value: { declaredStatus: { kind: "unknown", cause: "client-declared", why: "not measured" } } });
  });

  it("refuses when nobody holds the claim", () => {
    const t = overseerTarget(snapshot([peer]), "hello");
    expect(t.ok).toBe(false);
  });

  it("refuses a contested claim rather than picking one", () => {
    const t = overseerTarget(snapshot([overseer, { ...peer, role: { kind: "overseer" } }]), "hello");
    expect(t).toMatchObject({ ok: false });
    if (!t.ok) expect(t.why).toMatch(/2 sessions/);
  });

  it("refuses a snapshot whose last collection failed", () => {
    expect(overseerTarget(snapshot([overseer], { error: "tmux died" }), "hello").ok).toBe(false);
  });

  it("measures age against the box's servedAt, not the laptop's clock", () => {
    // Collected 55s before it was served: fresh by the box's clock, however far
    // the laptop's clock has drifted.
    expect(overseerTarget(snapshot([overseer]), "hello").ok).toBe(true);
    const stale = snapshot([overseer], { servedAt: "2026-10-09T23:42:33.630Z" });
    expect(overseerTarget(stale, "hello").ok).toBe(false);
  });

  it("escapes control characters in a session name it prints", () => {
    const t = overseerTarget(snapshot([overseer, { ...peer, name: "a\u001b[2Jb", role: { kind: "overseer" } }]), "x");
    if (t.ok) throw new Error("expected a refusal");
    expect(t.why).not.toContain("\u001b");
  });

  it("escapes collection and role errors, which also come from the box", () => {
    for (const s of [
      snapshot([overseer], { error: "bad\u001b[2J\rcollection" }),
      snapshot([{ ...overseer, role: { kind: "cannot-tell", why: "bad\u009b2J\nrole" } }]),
    ]) {
      const t = overseerTarget(s, "hello");
      if (t.ok) throw new Error("expected a refusal");
      expect(hasTerminalControl(t.why)).toBe(false);
    }
  });
});

describe("readTellAnswer", () => {
  it("reads the route's message acknowledgement as sent without returning its text", () => {
    expect(readTellAnswer(200, JSON.stringify({
      ok: true, op: "message",
      verified: { paneId: overseer.paneId, sessionId: overseer.id, panePid: overseer.panePid, claudePid: 4039571 },
      sent: [["send-keys", "-t", overseer.paneId, "-l", "--", "secret-message"], ["send-keys", "-t", overseer.paneId, "Enter"]],
    }))).toEqual({ ok: true });
  });

  it("passes the server's refusal through, and says nothing arrived only when the server says none", () => {
    const none = readTellAnswer(409, JSON.stringify({ ok: false, code: "input-not-empty", why: "the box has text", delivery: "none" }));
    expect(none).toEqual({ ok: false, why: "input-not-empty: the box has text", textMayBeInTheBox: false });
    const partial = readTellAnswer(500, JSON.stringify({ ok: false, code: "send-partial", why: "half", delivery: "partial" }));
    expect(partial).toMatchObject({ ok: false, textMayBeInTheBox: true });
    const absent = readTellAnswer(403, JSON.stringify({ ok: false, code: "forbidden-origin", why: "no" }));
    expect(absent).toMatchObject({ ok: false, textMayBeInTheBox: true });
  });

  it("does not read a non-JSON body as a success", () => {
    expect(readTellAnswer(502, "Bad Gateway")).toMatchObject({ ok: false });
  });

  it("requires HTTP 200 and a message acknowledgement before saying sent", () => {
    for (const [status, body] of [
      [500, { ok: true, op: "message" }],
      [0, { ok: true, op: "message" }],
      [200, { ok: true }],
      [200, { ok: true, op: "answer" }],
      [200, { ok: true, op: "message", sent: [] }],
      [200, { ok: true, op: "message", sent: [[]] }],
      [200, { ok: true, op: "message", sent: [[42]] }],
    ] as const) {
      expect(readTellAnswer(status, JSON.stringify(body))).toMatchObject({ ok: false, textMayBeInTheBox: true });
    }
  });

  it("escapes server codes and reasons for a terminal", () => {
    const a = readTellAnswer(409, JSON.stringify({ ok: false, code: "bad\u001b[2J", why: "pane\rforged\n\u009b2J", delivery: "none" }));
    if (a.ok) throw new Error("expected a refusal");
    expect(hasTerminalControl(a.why)).toBe(false);
    expect(a.why).toContain("forged");
  });

  it("does not print a non-JSON response that may echo the message", () => {
    const a = readTellAnswer(502, "<html>secret message\u001b[2J</html>");
    if (a.ok) throw new Error("expected a refusal");
    expect(a.why).not.toContain("secret message");
    expect(a.why).not.toContain("\u001b");
  });

  it("does not take delivery:none from a malformed acknowledgement as proof", () => {
    expect(readTellAnswer(200, '{"ok":true,"delivery":"none"}')).toMatchObject({ ok: false, textMayBeInTheBox: true });
  });
});

describe("splitStatus", () => {
  it("splits curl's trailing status line off the body", () => {
    expect(splitStatus('{"ok":true}\n200')).toEqual({ httpStatus: 200, body: '{"ok":true}' });
  });

  it("gives status 0 and an empty body when there is no status line", () => {
    expect(splitStatus("")).toEqual({ httpStatus: 0, body: "" });
  });

  it("refuses missing, malformed and non-HTTP status trailers", () => {
    for (const raw of ['{"ok":true}', "200", '{}\n2e2', '{}\n 200', '{}\n000', '{}\n200\n\n']) {
      expect(splitStatus(raw).httpStatus).toBe(0);
    }
  });
});

describe("tell-overseer arguments", () => {
  function run(...args: string[]) {
    const logDir = mkdtempSync(path.join(tmpdir(), "gjd-tell-test-"));
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/gjd-remote.ts", "tell-overseer", ...args], {
        encoding: "utf8", env: { ...process.env, NO_COLOR: "1", GJD_REMOTE_LOG_DIR: logDir },
      });
      const log = readFileSync(path.join(logDir, "gjd-remote.ndjson"), "utf8");
      expect(log).not.toContain("secret-message");
      expect(log).not.toContain("hello");
      return result;
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  }

  it("does not echo dash-leading message text in a parser error", () => {
    const result = run("--secret-message");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage:");
    expect(result.stderr).not.toContain("secret-message");
  });

  it("refuses -p together with text after the command, rather than picking one", () => {
    const result = run("-p", "hello", "world");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("usage:");
  });

  it("refuses -p - with an empty stdin before reaching for the box", () => {
    const logDir = mkdtempSync(path.join(tmpdir(), "gjd-tell-test-"));
    try {
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/gjd-remote.ts", "tell-overseer", "-p", "-"], {
        input: "\n", encoding: "utf8", env: { ...process.env, NO_COLOR: "1", GJD_REMOTE_LOG_DIR: logDir },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("nothing on stdin");
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });

  it("escapes an invalid port before printing it", () => {
    const result = run("hello", "--port", "\u001b[2J");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("port number");
    expect(result.stderr).not.toContain("\u001b");
  });
});

describe("tellPostCommand", () => {
  it("survives the remote shell with curl's write-out intact and text only on stdin", () => {
    const text = "secret ' \" $USER $(printf injected) `printf injected` * ?";
    const input = JSON.stringify({ text });
    const command = tellPostCommand(8787);
    // ssh passes its final argument to a remote shell. The stand-in curl shows
    // its actual argv after that shell has interpreted the command.
    const r = spawnSync("/bin/sh", ["-c", `curl() { printf '<%s>\\n' "$@"; printf 'STDIN:'; cat; }; ${command}`], { input, encoding: "utf8" });
    expect(r.status).toBe(0);
    const [argv, body] = r.stdout.split("STDIN:");
    expect(argv).toContain("<-w>\n<\\n%{http_code}>\n");
    expect(argv).toContain("<origin: http://127.0.0.1:8787>");
    expect(argv).toContain("<--data-binary>\n<@->");
    expect(argv).toMatch(/^<--disable>\n<--noproxy>\n<\*>/);
    expect(argv).not.toContain("secret");
    expect(body).toBe(input);
  });
});
