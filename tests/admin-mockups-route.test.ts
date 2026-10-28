/**
 * **`/api/admin/mockups`, one mockup, and one of its images**, end to end
 * through `handleApi` — plan 261028b, Stage 3. The directory is a temporary
 * one, reached the way production reaches the real one: from `process.cwd()`
 * (GPT Sol's plan review, F1), which is spied on here.
 *
 * What this pins: the namespace gate refuses a non-administrator on all three
 * before anything is read; the list leaves a bad file out rather than failing;
 * an absent directory is an empty list; the image answer's headers are an
 * exact set; and the URL can name only a mockup id and an index (F2).
 *
 * No database.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Verifier } from "../src/auth.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const { handleApi } = await import("../src/routes.js");

const acceptSomebodyElse: Verifier = async () => ({
  ok: true,
  claims: { sub: randomUUID(), email: "somebody-else@example.test", role: "authenticated", is_anonymous: false },
});

interface Sent {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
}

async function request(urlPath: string, options: { method?: string; verify?: Verifier } = {}): Promise<Sent> {
  const req = Object.assign((async function* () {})(), {
    method: options.method ?? "GET",
    url: urlPath,
    headers: AUTHED_HEADERS,
  }) as unknown as IncomingMessage;
  const headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let status = 0;
  const res = {
    get statusCode() {
      return status;
    },
    set statusCode(v: number) {
      status = v;
    },
    writableEnded: false,
    destroyed: false,
    setHeader(name: string, value: unknown) {
      headers[name.toLowerCase()] = String(value);
    },
    flushHeaders() {},
    on() {},
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk as never));
      return true;
    },
    end(chunk?: string | Buffer) {
      if (chunk) chunks.push(Buffer.from(chunk as never));
      (this as { writableEnded: boolean }).writableEnded = true;
    },
  } as unknown as ServerResponse;
  await handleApi(req, res, options.verify ?? acceptAny);
  return { status, headers, body: Buffer.concat(chunks) };
}

const json = (sent: Sent) => JSON.parse(sent.body.toString("utf8")) as Record<string, unknown>;

const ID = "m-k3m9qt";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xe2, 0x82, 0xac]);

function mockup(id: string, made: string, body: string): string {
  return `---\nid: ${id}\ntitle: Mockup ${id}\nmade: ${made}\nquestion: q-cgpett\nreport: none\n---\n${body}\n`;
}

let root = "";
let dir = "";
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "mockups-route-"));
  dir = path.join(root, "docs", "mockups");
  mkdirSync(dir, { recursive: true });
  vi.spyOn(process, "cwd").mockReturnValue(root);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

function seed(): void {
  writeFileSync(path.join(dir, `${ID}.md`), mockup(ID, "2026-10-28", `Before.\n\`\`\`\n+--+\n\`\`\`\nimage: ${ID}-a.png`));
  writeFileSync(path.join(dir, `${ID}-a.png`), PNG);
  writeFileSync(path.join(dir, "m-aaaaaa.md"), mockup("m-aaaaaa", "2026-10-01", "Older."));
  /* Bad: an unclosed fence. Left out of the list, not a 500. */
  writeFileSync(path.join(dir, "m-bbbbbb.md"), mockup("m-bbbbbb", "2026-10-29", "```\nnever closed"));
  /* Bad: its name says PNG but its bytes do not. The list must apply the same
     first-bytes check as the image route, rather than advertising a mockup whose
     picture can only answer 404. */
  writeFileSync(
    path.join(dir, "m-cccccc.md"),
    mockup("m-cccccc", "2026-10-30", "image: m-cccccc-not-really.png"),
  );
  writeFileSync(path.join(dir, "m-cccccc-not-really.png"), "<html>not a png</html>");
}

describe("the mockups routes", () => {
  it("refuse a non-administrator on all three, before anything is read", async () => {
    seed();
    for (const url of ["/api/admin/mockups", `/api/admin/mockups/${ID}`, `/api/admin/mockups/${ID}/images/0`]) {
      const sent = await request(url, { verify: acceptSomebodyElse });
      expect(sent.status, url).toBe(403);
      expect(sent.body.includes(Buffer.from("Mockup")), url).toBe(false);
      expect(sent.body.includes(PNG), url).toBe(false);
    }
  });

  it("list the good ones newest first, with their image counts, and leave a bad one out", async () => {
    seed();
    const sent = await request("/api/admin/mockups");
    expect(sent.status).toBe(200);
    expect(sent.headers["cache-control"]).toBe("private, no-store");
    expect(json(sent)).toEqual({
      mockups: [
        { id: ID, title: `Mockup ${ID}`, made: "2026-10-28", question: "q-cgpett", report: null, images: 1 },
        { id: "m-aaaaaa", title: "Mockup m-aaaaaa", made: "2026-10-01", question: "q-cgpett", report: null, images: 0 },
      ],
    });
  });

  it("answer an empty list when the directory is not there", async () => {
    rmSync(dir, { recursive: true });
    const sent = await request("/api/admin/mockups");
    expect(sent.status).toBe(200);
    expect(json(sent)).toEqual({ mockups: [] });
  });

  it("answer one mockup with its body in parts and its images as indexes, never filenames", async () => {
    seed();
    const sent = await request(`/api/admin/mockups/${ID}`);
    expect(sent.status).toBe(200);
    expect(sent.headers["cache-control"]).toBe("private, no-store");
    expect(json(sent)).toEqual({
      mockup: {
        id: ID,
        title: `Mockup ${ID}`,
        made: "2026-10-28",
        question: "q-cgpett",
        report: null,
        body: [
          { kind: "text", text: "Before.\n```\n+--+\n```" },
          { kind: "image", index: 0 },
        ],
        images: [{ index: 0, contentType: "image/png" }],
      },
    });
    expect(sent.body.includes(Buffer.from(`${ID}-a.png`))).toBe(false);
  });

  it("404 a mockup that is not there, and one that does not validate", async () => {
    seed();
    expect((await request("/api/admin/mockups/m-dddddd")).status).toBe(404);
    expect((await request("/api/admin/mockups/m-bbbbbb")).status).toBe(404);
  });

  it("400 anything that is not a mockup id or an index", async () => {
    seed();
    for (const url of [
      "/api/admin/mockups/m-nope",
      "/api/admin/mockups/..%2F..%2F.env.local",
      `/api/admin/mockups/${ID}/images/01`,
      `/api/admin/mockups/${ID}/images/-1`,
      `/api/admin/mockups/${ID}/images/1.0`,
    ]) {
      const sent = await request(url);
      expect([400, 404], url).toContain(sent.status);
      expect(sent.body.includes(PNG), url).toBe(false);
    }
    expect((await request("/api/admin/mockups/m-nope")).status).toBe(400);
    expect((await request(`/api/admin/mockups/${ID}/images/01`)).status).toBe(400);
  });

  it("serve an image's bytes with exactly these headers", async () => {
    seed();
    const sent = await request(`/api/admin/mockups/${ID}/images/0`);
    expect(sent.status).toBe(200);
    expect(sent.headers).toEqual({
      "content-type": "image/png",
      "content-length": String(PNG.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    });
    expect(sent.body.equals(PNG)).toBe(true);
  });

  it("404 an index past the last image", async () => {
    seed();
    expect((await request(`/api/admin/mockups/${ID}/images/1`)).status).toBe(404);
    expect((await request("/api/admin/mockups/m-aaaaaa/images/0")).status).toBe(404);
  });
});
