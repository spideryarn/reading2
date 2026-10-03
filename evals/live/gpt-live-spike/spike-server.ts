/**
 * SPIKE (throwaway): can GPT-Live's tool loop be relayed by the browser alone?
 * Run: npx tsx evals/live/gpt-live-spike/spike-server.ts
 * The server makes ONE upstream request per session (the SDP exchange). No sideband.
 */
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../src/env.ts";

loadEnvLocal();
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY missing");
const HERE = import.meta.dirname;
const PORT = 5398;

const FRONT = `You are a voice companion helping someone read an article. Be brief: one or two short spoken sentences. British English.
# Delegation Policy
You know nothing about the article yourself. Whenever the user asks what the article says about anything, delegate to the backend and never guess. While the backend works you may say you are checking.`;
const BACK = `You are the backend for a live voice conversation about an article. To answer any question about what the article says, you MUST call lookup_passage with the topic, then answer in one plain spoken sentence using only what it returned.`;

const filler = (words: number) => {
  const w = ["the", "lighthouse", "keeper", "walks", "along", "a", "narrow", "path", "above", "sea"];
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(w[i % w.length]!);
  return "\n\n# Background (ignore)\n" + out.join(" ");
};

/** The allowlist under test (Q10). `allow=1` uses this; `allow=min` drops the optional ones. */
const ALLOW = {
  allowed_client_events: ["response.item.create", "response.create", "session.close"],
  allowed_server_events: [
    { type: "session.started" },
    { type: "session.input_transcript.delta" },
    { type: "session.output_transcript.delta" },
    { type: "session.delegation.created" },
    { type: "session.usage.updated" },
    { type: "session.closed" },
    { type: "error" },
    { type: "response.event", response_event: "response.created" },
    { type: "response.event", response_event: "response.output_item.done" },
    { type: "response.event", response_event: "response.completed" },
    { type: "response.event", response_event: "response.incomplete" },
    { type: "response.event", response_event: "response.failed" },
    { type: "response.event", response_event: "error" },
  ],
};
const ALLOW_MIN = {
  allowed_client_events: ["response.item.create", "response.create", "session.close"],
  allowed_server_events: [
    { type: "session.started" },
    { type: "session.output_transcript.delta" },
    { type: "session.closed" },
    { type: "response.event", response_event: "response.created" },
    { type: "response.event", response_event: "response.output_item.done" },
    { type: "response.event", response_event: "response.completed" },
  ],
};

function body(req: http.IncomingMessage): Promise<string> {
  return new Promise((res, rej) => {
    let s = "";
    req.on("data", (c) => (s += c));
    req.on("end", () => res(s));
    req.on("error", rej);
  });
}
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 23), ...a);

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    log(req.method, url.pathname + url.search.slice(0, 200));
    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(path.join(HERE, "spike-page.html")));
        return;
      }
      if (req.method === "POST" && url.pathname === "/session") {
        const { sdp, variant = {} } = JSON.parse(await body(req)) as {
          sdp: string;
          variant?: { bigInstr?: number; bigBackend?: number; allow?: string };
        };
        const instructions = FRONT + (variant.bigInstr ? filler(variant.bigInstr) : "");
        const backInstr = BACK + (variant.bigBackend ? filler(variant.bigBackend) : "");
        const allow = variant.allow === "1" ? ALLOW : variant.allow === "min" ? ALLOW_MIN : null;
        const payload = {
          session: {
            model: "gpt-live-1",
            instructions,
            audio: { output: { voice: "marin" } },
            ...(allow ? { client: { data_channel: allow } } : {}),
            delegation: {
              type: "responses",
              responses: {
                model: "gpt-6-luna",
                instructions: backInstr,
                reasoning: { effort: "low" },
                tools: [
                  {
                    type: "function",
                    name: "lookup_passage",
                    description: "Look up what the article says about a topic",
                    parameters: {
                      type: "object",
                      properties: { topic: { type: "string" } },
                      required: ["topic"],
                      additionalProperties: false,
                    },
                  },
                ],
              },
            },
          },
          transport: { type: "webrtc", sdp },
        };
        const at = Date.now();
        const up = await fetch("https://api.openai.com/v1/live/sessions", {
          method: "POST",
          headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const text = await up.text();
        let json: any = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* not json */
        }
        log(
          `  upstream ${up.status} in ${Date.now() - at}ms; content-type=${up.headers.get("content-type")};`,
          `instr chars=${instructions.length} backend chars=${backInstr.length} allow=${variant.allow ?? ""};`,
          up.ok
            ? `keys=${JSON.stringify(Object.keys(json ?? {}))} session=${JSON.stringify(json?.session)} transport.type=${json?.transport?.type} sdp chars=${json?.transport?.sdp?.length}`
            : `body=${text.slice(0, 600)}`,
        );
        res.writeHead(up.status, { "content-type": "application/json" });
        res.end(
          up.ok
            ? JSON.stringify({ sessionId: json.session.id, sdp: json.transport.sdp, raw: { session: json.session, transportType: json.transport.type, topKeys: Object.keys(json) } })
            : JSON.stringify({ error: json ?? text }),
        );
        return;
      }
      if (req.method === "POST" && url.pathname === "/tool") {
        const b = await body(req);
        const delay = Number(url.searchParams.get("delay") ?? 0);
        log(`  tool args=${b} delay=${delay}`);
        if (delay) await new Promise((r) => setTimeout(r, delay));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ output: "The article says the lighthouse was painted teal in 1987." }));
        return;
      }
      res.writeHead(404).end("not found");
    } catch (err) {
      log("  ERROR", (err as Error).message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  })
  .listen(PORT, "127.0.0.1", () => log(`spike server on http://127.0.0.1:${PORT}/`));
