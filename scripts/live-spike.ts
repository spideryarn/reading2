/**
 * **The spike's own little server**, so that live conversation mode can be
 * tried in a real browser without touching anything the app ships.
 *
 * `npm run live:spike`. **It has no page any more**: the throwaway
 * `preview/preview-live.html` it was tried from was deleted on 2026-09-11 with
 * the other preview pages, and live conversation now runs inside the reading
 * view (docs/project/live-conversation.md). The page is in git history if the
 * spike is ever needed again.
 *
 * ## Why this is not two routes in src/routes.ts
 *
 * It will be, when this is a feature. Today it is a spike, and a spike that
 * edits a 4,000-line file six other agents are working in buys a merge problem
 * in exchange for nothing — every line here that matters is in `src/live.ts`,
 * which is where the real routes will import it from.
 *
 * It also sidesteps a question the spike does not need to answer yet. Every
 * `/api/` route is behind `requireUser`, so a throwaway page would need a real
 * Supabase session on whatever port Vite happened to pick that morning
 * (docs/project/browser-testing.md). This process runs as the environment's
 * own owner instead, on a fixed port, bound to loopback.
 *
 * **It is local-only and it says yes to everybody.** `Access-Control-Allow-
 * Origin: *` and no authentication at all: anything that can reach this port
 * can spend money against `OPENAI_API_KEY`. That is why it binds 127.0.0.1
 * explicitly rather than 0.0.0.0, why it is a script you start on purpose, and
 * why it must never become the shape of the real thing.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

/* **The store's reader, not `src/api.ts`'s.** That one was the *filesystem*
   reader, and this file used it at both `/session` and `/tool` while its
   vocabulary and its tools went to Postgres seams — so a slug that exists only
   in the database could not start a live session, and a stale `data/<slug>/`
   with the same name fed the model filesystem prose while its tools answered
   from the Postgres article. Two sources of truth inside one conversation, and
   nothing to say so. It was invisible while `SPIDERYARN_STORE` chose the
   default; the hinge of 2026-09-05 made it the only reader left pointing at
   `data/`. GPT Sol's review of that stage. */
import { loadArticle } from "../src/store/index.js";
import { runTool } from "../src/chat-tools.js";
import { loadEnvLocal } from "../src/env.js";
import { liveSession, mintLiveToken } from "../src/live.js";
import { environmentOwnerId, runAsOwner } from "../src/owner.js";
import { vocabularyTermsFor } from "../src/vocabulary-sources.js";

loadEnvLocal();

const PORT = 5399;
const HOST = "127.0.0.1";

/* Loopback and a literal 127.0.0.1 rather than "localhost", which resolves to
   ::1 first on this machine — the dev server binds IPv6 only and a health check
   on 127.0.0.1 reports a healthy server as down. Naming the family on both ends
   means the page's URL and the listener cannot disagree. */

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw === "") return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  });
  res.end(text);
}

/** The one string a caller may send, and it is a slug. */
function slugOf(b: Record<string, unknown>): string {
  const slug = typeof b.slug === "string" ? b.slug : "";
  if (!/^[\w.-]+$/.test(slug)) throw new Error(`not a slug: ${JSON.stringify(slug)}`);
  return slug;
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === "OPTIONS") return send(res, 204, {});
      const path = (req.url ?? "").split("?")[0];

      /* Mint a token for one connection. Everything expensive about the session
         — the whole article, the eight tools, the vocabulary — is decided here
         and the browser is told none of it. src/live.ts § mintLiveToken. */
      if (path === "/session" && req.method === "POST") {
        const b = await body(req);
        const slug = slugOf(b);
        /* Checked against the union rather than passed through: this arrives
           from a browser, and an unknown string would reach OpenAI as an
           invalid `noise_reduction.type` and fail the whole session for a
           preference. */
        const placement = b.placement === "headset" || b.placement === "laptop" ? b.placement : null;
        const out = await runAsOwner(environmentOwnerId(), async () => {
          const article = await loadArticle(slug);
          /* Best-effort, exactly as dictation treats it: a live conversation
             that starts without the article's jargon in its `keywords` is
             slightly worse, and one that refuses to start because a glossary
             row was slow is useless. */
          const vocabulary = await vocabularyTermsFor({ kind: "article", slug }).catch(() => []);
          const session = liveSession({
            meta: article.meta,
            blocks: article.blocks,
            vocabulary,
            placement,
          });
          const token = await mintLiveToken(session);
          return { token, title: article.meta.title, blocks: article.blocks.length };
        });
        console.log(
          `  session for ${slug} — ${out.blocks} blocks, ${placement ?? "default"} mic, ${out.title}`,
        );
        return send(res, 200, { ...out.token, title: out.title });
      }

      /* The tool relay. The browser hears the model ask for a tool, posts it
         here, and sends the answer back down its own data channel — because
         every one of the seven needs a database, an embedding or the open web,
         and none of that belongs in a tab. `show_passage` never arrives here:
         it is answered in the browser, in the frame it lands in. */
      if (path === "/tool" && req.method === "POST") {
        const b = await body(req);
        const slug = slugOf(b);
        const name = typeof b.name === "string" ? b.name : "";
        const args = (b.args ?? {}) as Record<string, unknown>;
        const started = Date.now();
        const out = await runAsOwner(environmentOwnerId(), async () => {
          const article = await loadArticle(slug);
          return runTool(name, args, {
            slug,
            meta: article.meta,
            blocks: article.blocks,
          });
        });
        console.log(`  tool ${name} — ${out.label} / ${out.detail} (${Date.now() - started}ms)`);
        return send(res, 200, out);
      }

      send(res, 404, { error: `no such path: ${path}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("  !", message);
      /* The message, not a blank 500. This server exists to be debugged from a
         browser console, and half its failures are a sentence OpenAI wrote. */
      send(res, 500, { error: message });
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.log(`live spike server on http://${HOST}:${PORT}`);
  console.log(`  POST /session  { slug }            → an ephemeral OpenAI token`);
  console.log(`  POST /tool     { slug, name, args } → a chat tool, run server-side`);
  console.log(``);
  console.log(`  no page ships with this any more — see the header of scripts/live-spike.ts`);
  if (!process.env.OPENAI_API_KEY) {
    console.log(``);
    console.log(`  ! OPENAI_API_KEY is not set — /session will refuse.`);
  }
});
