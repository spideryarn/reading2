/**
 * **Should live conversation move from `gpt-realtime-2.1` to `gpt-live-1`?**
 *
 * Stage 0 of docs/plans/261002j-live-voice-chat-cleanup.md, written up in
 * docs/investigations/261002r-gpt-live-spike.md. Greg asked for the newest
 * model, "instant mode", short back-and-forth answers and "something clever
 * with tool use in the background" (report spya-f4eq7p). `gpt-live-1` is that
 * shape — a voice front end that delegates thinking and tools to a backend
 * model — but it is a different API, not a new model id. So this measures it
 * against what we run today, on the same questions, spoken.
 *
 * ## The arms
 *
 * - **A** — `gpt-realtime-2.1` exactly as `liveSession` builds it, with the
 *   `reasoning` field removed: OpenAI's default effort, which is what
 *   production ran until 2026-10-02.
 * - **B** — the same session with `reasoning: { effort: "low" }` (what
 *   `liveSession` now sets). A vs B is the grounding check for that switch.
 * - **C** — `gpt-live-1` with Responses delegation. The voice model gets only
 *   the spoken rules and a delegation policy; the backend (`gpt-6-luna`, low
 *   effort) gets the whole article with block ids and `show_passage`, which
 *   this script answers the way the browser would.
 * - **Cin** — C, but with the (short) article in the voice instructions as
 *   well, to see whether a voice model that has read the piece still delegates.
 *   Only for an article that fits the 16,384-token instruction cap.
 *
 * A and B use `liveSession` and `LIVE_SYSTEM` from src/live.ts as they stand in
 * the working tree when this runs; the run records a hash of `LIVE_SYSTEM` so
 * the write-up can say which prompt it measured.
 *
 * ## The transport is WebSocket, and that is a limit
 *
 * Both APIs are driven from Node over a WebSocket with audio streamed in real
 * time (100 ms chunks, paced by the clock). Production uses WebRTC, and
 * GPT-Live's WebRTC handshake is different from today's (the browser's SDP
 * offer goes to OUR server, which creates the session and returns the answer).
 * **That handshake is not measured here.** Nor is playback: "first audio" is
 * when the first audio bytes arrived, which is when a player could start.
 *
 * ## The questions are spoken
 *
 * By `gpt-4o-mini-tts` (cached in the scratchpad, cost excluded), so every arm
 * hears identical audio. A synthetic voice is cleaner than a person in a room.
 *
 * ## What "first substantive audio" means
 *
 * GPT-Live talks while it works — "let me check" — so first audio is not the
 * answer. Each reply is split into utterances (per response for Realtime; by
 * gaps in the transcript timeline for GPT-Live) and an utterance counts as a
 * backchannel if it is a few words of filler (`isBackchannel`). The write-up
 * checks the classification by eye.
 *
 *   npx tsx evals/live/gpt-live-spike.mts --probe
 *   npx tsx evals/live/gpt-live-spike.mts --configs=A,B,C,Cin --reps=3 --out=logs/f4sp-spike/run1
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../../src/env.js";

loadEnvLocal();

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY is not set");

const { liveSession, mintLiveToken, SHOW_PASSAGE_TOOL, LIVE_SYSTEM, LIVE_MODEL, LIVE_VOICE } = await import(
  "../../src/live.js"
);
const { priceRealtimeResponse } = await import("../../src/pricing.js");
const { articleWithIds, estimateTokens } = await import("../../src/article-prompt.js");
const { plainWords } = await import("../../src/plain-words.js");
const { loadArticle } = await import("../../src/store/index.js");
const { environmentOwnerId, runAsOwner } = await import("../../src/owner.js");

type Block = import("../../src/types.js").Block;
type Meta = import("../../src/types.js").Meta;
/** A wire event. Both APIs send JSON objects whose shape we read field by field. */
// biome-ignore lint/suspicious/noExplicitAny: wire events are read defensively, field by field
type Ev = Record<string, any>;

// ---------------------------------------------------------------- settings

const RATE = 24_000;
const CHUNK_MS = 100;
const CHUNK_BYTES = (RATE * 2 * CHUNK_MS) / 1000;
const LIVE_VOICE_MODEL = "gpt-live-1";
const BACKEND_MODEL = "gpt-6-luna";
/** USD per 1M tokens, from developers.openai.com/api/docs/models/gpt-6-luna, read 2026-10-02. */
const LUNA = { input: 0.1, cachedInput: 0.01, output: 0.5 };
/** USD per minute, developers.openai.com/api/docs/models/gpt-live-1, read 2026-10-02. */
const LIVE_USD_PER_MIN = 0.05;
/** gpt-live-transcribe, as src/pricing.ts has it. Realtime arms pay it; GPT-Live includes transcripts. */
const TRANSCRIBE_USD_PER_MIN = 0.017;
const SCRATCH = "/tmp/claude-1000/-home-greg-code-spideryarn2/53b8fb4b-8177-4b0b-8738-602dd9b74f23/scratchpad";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k ?? "", v ?? "true"] as const;
  }),
);
const CONFIGS = (args.get("configs") ?? "A,B,C").split(",") as Config[];
const REPS = Number(args.get("reps") ?? "1");
const SPEND_CEILING_USD = Number(args.get("ceiling") ?? "11.5");
const ARTICLES = (args.get("articles") ?? "short,long").split(",") as ArticleKey[];
const SCENARIOS = (args.get("scenarios") ?? "1,2,3,4").split(",").map(Number);
const CONCURRENCY = Number(args.get("concurrency") ?? "3");
const OUT = args.get("out") ?? "logs/f4sp-spike/run";

type Config = "A" | "B" | "Bp" | "C" | "Cin";

/**
 * **B' ("Bp"): B with the model told to speak before it points.** Realtime
 * called show_passage before its first word in 64 of 72 turns of the first run,
 * and that cost about 1.2 s. This is a COPY of LIVE_SYSTEM's wording with two
 * edits; src/live.ts is not touched. Each edit must find its text exactly, or
 * the run stops — a substitution that silently matched nothing would measure B
 * twice and call it B'.
 */
const POINT_AFTER_EDITS: readonly [string, string][] = [
  [
    `- Before a tool that makes them wait, a few words so the silence is not
  mysterious ("let me look that up"). Never before show_passage, which is
  instant — just point and talk.`,
    `- Before a tool that makes them wait, a few words so the silence is not
  mysterious ("let me look that up").
- show_passage is instant and needs no announcement. Start your answer first,
  then call show_passage while or after you speak — never make the reader wait
  in silence for the pointer.`,
  ],
  [
    `When you want the reader to look at a passage, CALL show_passage WITH THE IDS
and say in words where to look`,
    `When you want the reader to look at a passage, say in words where to look
and CALL show_passage WITH THE IDS as you speak`,
  ],
];
function pointAfter(instructions: string): string {
  let out = instructions;
  for (const [from, to] of POINT_AFTER_EDITS) {
    if (!out.includes(from)) throw new Error(`B' edit did not match LIVE_SYSTEM: ${from.slice(0, 60)}…`);
    out = out.replace(from, to);
  }
  return out;
}
type ArticleKey = "short" | "long";

// ---------------------------------------------------------------- the questions

/** Section ranges, inclusive, by block id. A pointer is "right" if any id it names is inside one. */
type Range = [string, string];

interface Turn {
  say: string;
  /** Spoken while the first answer is in progress (scenario 3). */
  correction?: string;
  expect: Range[];
}
interface Scenario {
  id: number;
  name: string;
  seed?: { user: string; assistant: string };
  turns: Turn[];
}

const ARTICLE_SLUGS: Record<ArticleKey, string> = {
  short: "article-spya-uzf7vk", // Ioannidis 2005, PLoS Medicine, ~9k tokens
  long: "scaling-hypothesis", // Gwern, ~27k tokens
};

const SCENARIO_SETS: Record<ArticleKey, Scenario[]> = {
  short: [
    {
      id: 1,
      name: "follow-up, no lookup",
      seed: {
        user: "What's the main claim of this paper?",
        assistant:
          "That in most fields a claimed research finding is more likely to be false than true, because of small studies, small effects, bias, and many teams chasing the same question.",
      },
      turns: [{ say: "Hmm. So is that a good thing or a bad thing?", expect: [] }],
    },
    {
      id: 2,
      name: "article question",
      turns: [
        {
          say: "Why does he say the hotter a field is, the less likely its findings are to be true?",
          expect: [["spya-mgrr58", "spya-d9kd86"], ["spya-u5x4p2", "spya-u5x4p2"]],
        },
      ],
    },
    {
      id: 3,
      name: "correction mid-answer",
      turns: [
        {
          say: "What's the point of the schizophrenia gene example?",
          correction: "Sorry, no, I meant the example about nutrients and tumours.",
          expect: [["spya-khfp04", "spya-sn8xnv"]],
        },
      ],
    },
    {
      id: 4,
      name: "three turns",
      turns: [
        { say: "What does he mean by bias here?", expect: [["spya-gfvava", "spya-s46ctb"], ["spya-uvmvbc", "spya-uvmvbc"]] },
        {
          say: "And does running bigger studies fix that?",
          expect: [["spya-vzv8aq", "spya-vzv8aq"], ["spya-d9kd86", "spya-d9kd86"], ["spya-a2jbw9", "spya-a2jbw9"]],
        },
        { say: "So what does he say we should do about it?", expect: [["spya-t4k903", "spya-y44q7p"]] },
      ],
    },
  ],
  long: [
    {
      id: 1,
      name: "follow-up, no lookup",
      seed: {
        user: "What's the scaling hypothesis, in a sentence?",
        assistant:
          "That once you find an architecture that scales, simply training bigger networks on more data keeps producing more sophisticated and more general behaviour, without needing new ideas.",
      },
      turns: [{ say: "Hmm. So is that a good thing or a bad thing?", expect: [] }],
    },
    {
      id: 2,
      name: "article question",
      turns: [{ say: "What does he mean by the blessings of scale?", expect: [["spya-jwq3zr", "spya-jg69cy"]] }],
    },
    {
      id: 3,
      name: "correction mid-answer",
      turns: [
        {
          say: "What does he say about AlphaGo Zero?",
          correction: "Actually, scratch that. Why does he think pretraining works?",
          expect: [["spya-ce0ts7", "spya-uett4g"]],
        },
      ],
    },
    {
      id: 4,
      name: "three turns",
      turns: [
        {
          say: "Why does he say GPT-3 wasn't actually that expensive?",
          /* The abstract and the cost footnote say it too; both were pointed at, and both are right. */
          expect: [["spya-jh78mt", "spya-w83b0m"], ["spya-ewxv9q", "spya-ewxv9q"], ["spya-c5ejjt", "spya-c5ejjt"]],
        },
        {
          say: "Did anyone predict that this would happen?",
          expect: [["spya-uett4g", "spya-sm7bx4"], ["spya-bp9mm2", "spya-cxnhav"]],
        },
        { say: "What does he think the critics get wrong?", expect: [["spya-bp9mm2", "spya-me38yq"]] },
      ],
    },
  ],
};

// ---------------------------------------------------------------- prompts for C

/**
 * The voice model's instructions in C: the spoken rules from `LIVE_SYSTEM`'s
 * HOW TO TALK, cut to what a model that never sees the article can follow,
 * laid out on OpenAI's GPT-Live template (its three policy headings are the
 * ones the guide says to keep).
 */
function voiceInstructions(meta: Meta, inlineArticle: string | null): string {
  const title = meta?.title ?? "an article";
  const by = meta?.authors?.length ? ` by ${meta.authors.map((a) => a.name).join(", ")}` : "";
  return [
    `You are a reading companion in a live voice conversation. A reader has "${title}"${by} open and is talking to you about it while they read. You are here to send them back into the piece better equipped, not to read it to them.

How to talk:
- Short. One or two sentences is a normal answer; quick back and forth is the point. Say more only when they ask.
- Answer in your first words. No warm-up, never praise the question, never repeat it back, never close with an offer.
- One idea per turn. Plain spoken English. No lists, no markdown, no URLs.
- Never say an id like spya-k3m9qt out loud.
- Use the author's own terms, and say what they mean.
- If the article does not cover something, say so plainly.

Backchannel policy: Use few backchannels. A brief listening sound is fine while the reader is still talking; do not talk over them.

Interruption policy: Stop speaking when the reader interrupts. Listen to what they say. If they change their question, the new question replaces the old one.

Delegation policy:
Backend tools:
- The article: the backend has the whole text. It can find what the article says and where, and it highlights the passage on the reader's screen.
Delegate to the backend when:
- The reader asks what the article says, means or argues, or where it says something.
- The answer depends on a detail of the article you have not already been told in this conversation.
- A correction changes a question already sent to the backend.
Do not delegate to the backend when:
- The reader is reacting, or asking your view of something already said in this conversation.
- They ask you to repeat or rephrase.
- You need a brief clarification to understand the request.
Delegate before giving an answer that depends on the article. Do not guess what the article says while waiting. While it works, say a few words at most, or nothing.`,
    inlineArticle
      ? `THE ARTICLE\n\nYou also have the whole article below, so you can answer simple questions about it yourself. Still delegate when the reader should be shown a passage.\n\n${inlineArticle}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The backend's instructions in C: the article, the tool, and what to hand back. */
function backendInstructions(article: string): string {
  return `You hold one article and help a voice assistant that is talking with a reader about it. The voice assistant does not have the article; it will say your answer aloud.

The request reaches you from a live conversation: the reader's words are a transcript and can contain mistakes, half-finished phrases and later corrections. Answer the latest version of the question.

For each request:
1. Find what the article says that answers it. Stay in the article. If it does not say, say so: "He doesn't address that."
2. If the answer rests on a passage, call show_passage first, with the ids of the one to three paragraphs it rests on. The reader sees them highlighted.
3. Then write the answer: one or two short sentences, ready to be spoken. Keep the author's key terms and say what they mean. No ids, no markdown, no lists, no preamble, no offer to say more.

${plainWords("explain", "spoken")}

THE ARTICLE

${article}`;
}

// ---------------------------------------------------------------- helpers

const now = (): number => performance.now();

/** Duration of a base64 PCM16 chunk, and whether it is more than silence. */
function audioInfo(b64: string): { ms: number; loud: boolean } {
  const buf = Buffer.from(b64, "base64");
  let peak = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const v = Math.abs(buf.readInt16LE(i));
    if (v > peak) peak = v;
  }
  return { ms: (buf.length / 2 / RATE) * 1000, loud: peak > 300 };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Speak a sentence as 24 kHz mono PCM16, cached on disk so every arm hears identical audio. */
async function tts(text: string): Promise<Buffer> {
  const file = path.join(SCRATCH, `f4sp-tts-${createHash("sha1").update(text).digest("hex").slice(0, 12)}.pcm`);
  if (existsSync(file)) return readFileSync(file);
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "alloy", input: text, response_format: "pcm" }),
  });
  if (!res.ok) throw new Error(`tts failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, buf);
  return buf;
}

/**
 * **A microphone that never stops.** Sends a 100 ms chunk every 100 ms, paced
 * by the clock: speech when something has been queued, silence otherwise.
 * GPT-Live wants a continuous stream, and a VAD needs the silence after a
 * sentence to decide it has ended, so both arms get the same feed.
 */
class Feeder {
  sentMs = 0;
  private t0 = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private speech: Buffer | null = null;
  private offset = 0;
  private speechStartMs = 0;
  private done: ((r: Spoken) => void) | null = null;
  constructor(private readonly push: (b64: string) => void) {}
  start(): void {
    this.t0 = now();
    this.timer = setInterval(() => this.tick(), 20);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private tick(): void {
    /* One chunk ahead of the clock, like a real capture buffer. */
    while (this.sentMs <= now() - this.t0 + CHUNK_MS) {
      let chunk: Buffer;
      if (this.speech) {
        chunk = Buffer.alloc(CHUNK_BYTES);
        this.speech.copy(chunk, 0, this.offset, Math.min(this.offset + CHUNK_BYTES, this.speech.length));
        this.offset += CHUNK_BYTES;
        if (this.offset >= this.speech.length) {
          const r: Spoken = { startMs: this.speechStartMs, endMs: this.sentMs + CHUNK_MS, endWall: now() };
          this.speech = null;
          const d = this.done;
          this.done = null;
          d?.(r);
        }
      } else {
        chunk = Buffer.alloc(CHUNK_BYTES);
      }
      this.push(chunk.toString("base64"));
      this.sentMs += CHUNK_MS;
    }
  }
  speak(pcm: Buffer): Promise<Spoken> {
    if (this.speech) throw new Error("already speaking");
    this.speech = pcm;
    this.offset = 0;
    this.speechStartMs = this.sentMs;
    return new Promise((r) => {
      this.done = r;
    });
  }
}
interface Spoken {
  /** Position on the input timeline, ms since the feed started. */
  startMs: number;
  endMs: number;
  /** performance.now() when the last speech chunk went out. */
  endWall: number;
}

const FILLER =
  /\b(let me|let's|i'll|one (sec|second|moment)|hang on|hold on|just a (sec|moment)|checking|check(ing)? (that|this|the)|look(ing)? (that |it )?up|pull(ing)? (that|it) up|give me a|sure|okay|ok|mm+|hmm+|uh|got it|good question|right|yeah|alright|on it|looking)\b/i;

/** A few words of filler, not the answer. Checked by eye in the write-up. */
function isBackchannel(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  if (words.length <= 2) return true;
  return words.length <= 9 && FILLER.test(text);
}

interface Utterance {
  text: string;
  /** Wall ms after the question ended when its first text (or audio, for Realtime) arrived. */
  firstMs: number;
  firstAudioMs: number | null;
  /** GPT-Live only: its start on the session timeline, minus the question's end on the input timeline. */
  timelineMs: number | null;
  responseId?: string;
}

interface PassageCall {
  blockIds: string[];
  why: string;
  atMs: number;
  right: boolean | null;
}

interface DelegationRec {
  id: string;
  createdMs: number;
  offsetMs: number | null;
  responseIds: string[];
  functionCallMs: number | null;
  continuedMs: number | null;
  firstTextMs: number | null;
  completedMs: number | null;
  text: string;
  calls: string[];
  usage: { input: number; cached: number; output: number; reasoning: number };
}

interface TurnRec {
  config: Config;
  article: ArticleKey;
  scenario: number;
  rep: number;
  turn: number;
  question: string;
  correction: string | null;
  inputTranscript: string;
  answer: string;
  utterances: Utterance[];
  firstAudioMs: number | null;
  firstSubstantiveMs: number | null;
  firstSubstantiveTimelineMs: number | null;
  /** Scenario 3: measured from the end of the correction instead. */
  afterCorrectionSubstantiveMs: number | null;
  passages: PassageCall[];
  otherTools: string[];
  delegations: DelegationRec[];
  timedOut: boolean;
  /** GPT-Live: every output transcript fragment, for re-scoring by hand. */
  fragments?: { text: string; timelineMs: number; atMs: number }[];
  /** GPT-Live: when the last delegation's answer text began, ms after the question ended. */
  answerAvailableMs?: number | null;
}

interface SessionRec {
  config: Config;
  article: ArticleKey;
  scenario: number;
  rep: number;
  startupMs: number;
  wallSeconds: number;
  billedSeconds: number | null;
  closedReason: string | null;
  costUsd: number;
  costParts: Record<string, number>;
  realtimeTokens?: Record<string, number>;
  backendTokens?: Record<string, number>;
  error: string | null;
  turns: TurnRec[];
  maxContextRatio?: number | null;
}

let spent = 0;

function inRanges(id: string, ranges: Range[], order: Map<string, number>): boolean {
  const i = order.get(id);
  if (i === undefined) return false;
  return ranges.some(([a, b]) => {
    const ia = order.get(a);
    const ib = order.get(b);
    return ia !== undefined && ib !== undefined && i >= ia && i <= ib;
  });
}

// ---------------------------------------------------------------- Realtime (A, B)

async function runRealtime(
  config: "A" | "B" | "Bp",
  key: ArticleKey,
  sc: Scenario,
  rep: number,
  art: LoadedArticle,
  eventsFile: string,
): Promise<SessionRec> {
  const session = liveSession({ meta: art.meta, blocks: art.blocks, profile: null, vocabulary: null }) as Ev;
  if (config === "A") delete session.reasoning;
  else session.reasoning = { effort: "low" };
  if (config === "Bp") session.instructions = pointAfter(String(session.instructions));

  const t0 = now();
  const token = await mintLiveToken(session);
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${LIVE_MODEL}`, [
    "realtime",
    `openai-insecure-api-key.${token.token}`,
  ]);
  const rec: SessionRec = {
    config,
    article: key,
    scenario: sc.id,
    rep,
    startupMs: 0,
    wallSeconds: 0,
    billedSeconds: null,
    closedReason: null,
    costUsd: 0,
    costParts: { realtime: 0, transcription: 0 },
    realtimeTokens: { textIn: 0, cachedTextIn: 0, audioIn: 0, cachedAudioIn: 0, textOut: 0, audioOut: 0 },
    error: null,
    turns: [],
  };
  const send = (e: Ev) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(e));
  const listeners = new Set<(e: Ev, at: number) => void>();
  let created!: () => void;
  const ready = new Promise<void>((r) => {
    created = r;
  });
  const opened = now();

  ws.onmessage = (m) => {
    const at = now();
    const e = JSON.parse(String(m.data)) as Ev;
    logEvent(eventsFile, e, at - t0);
    if (e.type === "response.output_audio.delta") e.__loud = audioInfo(String(e.delta ?? "")).loud;
    if (e.type === "session.created") created();
    if (e.type === "error") rec.error = `${e.error?.code ?? ""} ${e.error?.message ?? ""}`.trim();
    if (e.type === "response.done") {
      const u = e.response?.usage;
      if (u) {
        const inD = u.input_token_details ?? {};
        const cached = inD.cached_tokens_details ?? {};
        const t = {
          freshTextTokens: (inD.text_tokens ?? 0) - (cached.text_tokens ?? 0),
          freshAudioTokens: (inD.audio_tokens ?? 0) - (cached.audio_tokens ?? 0),
          cachedTextTokens: cached.text_tokens ?? 0,
          cachedAudioTokens: cached.audio_tokens ?? 0,
          outputTextTokens: u.output_token_details?.text_tokens ?? 0,
          outputAudioTokens: u.output_token_details?.audio_tokens ?? 0,
        };
        const rt = rec.realtimeTokens as Record<string, number>;
        rt.textIn = (rt.textIn ?? 0) + t.freshTextTokens;
        rt.cachedTextIn = (rt.cachedTextIn ?? 0) + t.cachedTextTokens;
        rt.audioIn = (rt.audioIn ?? 0) + t.freshAudioTokens;
        rt.cachedAudioIn = (rt.cachedAudioIn ?? 0) + t.cachedAudioTokens;
        rt.textOut = (rt.textOut ?? 0) + t.outputTextTokens;
        rt.audioOut = (rt.audioOut ?? 0) + t.outputAudioTokens;
        const priced = priceRealtimeResponse(LIVE_MODEL, t, new Date());
        const usd = priced ? Number(priced.totalNanos) / 1e9 : 0;
        rec.costParts.realtime = (rec.costParts.realtime ?? 0) + usd;
        spent += usd;
      }
    }
    if (e.type === "conversation.item.input_audio_transcription.completed") {
      const u = e.usage;
      const seconds = u?.type === "duration" ? Number(u.seconds) : 0;
      const usd = (seconds / 60) * TRANSCRIBE_USD_PER_MIN;
      rec.costParts.transcription = (rec.costParts.transcription ?? 0) + usd;
      spent += usd;
    }
    for (const l of listeners) l(e, at);
  };
  ws.onerror = () => {
    if (rec.wallSeconds === 0) rec.error = rec.error ?? "websocket error";
  };

  await Promise.race([ready, sleep(15_000).then(() => Promise.reject(new Error("no session.created")))]);
  rec.startupMs = Math.round(now() - t0);
  void opened;

  if (sc.seed) {
    for (const [role, text] of [
      ["user", sc.seed.user],
      ["assistant", sc.seed.assistant],
    ] as const) {
      send({
        type: "conversation.item.create",
        item: { type: "message", role, content: [{ type: role === "assistant" ? "output_text" : "input_text", text }] },
      });
    }
    await sleep(500);
  }

  const feeder = new Feeder((audio) => send({ type: "input_audio_buffer.append", audio }));
  feeder.start();
  await sleep(600);

  for (let ti = 0; ti < sc.turns.length; ti++) {
    const turn = sc.turns[ti] as Turn;
    const tr = await realtimeTurn(config, key, sc, rep, ti, turn, art, feeder, send, listeners);
    rec.turns.push(tr);
    await sleep(1000);
  }
  feeder.stop();
  rec.wallSeconds = (now() - t0) / 1000;
  ws.close();
  rec.costUsd = Object.values(rec.costParts).reduce((a, b) => a + b, 0);
  return rec;
}

async function realtimeTurn(
  config: Config,
  key: ArticleKey,
  sc: Scenario,
  rep: number,
  ti: number,
  turn: Turn,
  art: LoadedArticle,
  feeder: Feeder,
  send: (e: Ev) => unknown,
  listeners: Set<(e: Ev, at: number) => void>,
): Promise<TurnRec> {
  const tr: TurnRec = blankTurn(config, key, sc, rep, ti, turn);
  const question = await tts(turn.say);
  const correction = turn.correction ? await tts(turn.correction) : null;

  const responses = new Map<string, Utterance & { fnCalls: Ev[] }>();
  let qEnd = Number.POSITIVE_INFINITY;
  let corrEnd: number | null = null;
  let lastSpeechEnd = Number.POSITIVE_INFINITY;
  let correctionQueued = false;
  let finalAt: number | null = null;
  let lastActivity = now();

  const rel = (at: number) => Math.round(at - qEnd);
  const listener = (e: Ev, at: number) => {
    const rid: string | undefined = e.response_id ?? e.response?.id;
    const get = () => {
      if (!rid) return null;
      let r = responses.get(rid);
      if (!r) {
        r = { text: "", firstMs: Number.NaN, firstAudioMs: null, timelineMs: null, responseId: rid, fnCalls: [] };
        responses.set(rid, r);
      }
      return r;
    };
    switch (e.type) {
      case "response.created":
        get();
        finalAt = null;
        lastActivity = at;
        break;
      case "response.output_audio.delta": {
        const r = get();
        if (!e.__loud) break;
        if (r && r.firstAudioMs === null) r.firstAudioMs = rel(at);
        if (tr.firstAudioMs === null && at > qEnd) tr.firstAudioMs = rel(at);
        lastActivity = at;
        if (correction && !correctionQueued) {
          correctionQueued = true;
          void feeder.speak(correction).then((s) => {
            corrEnd = s.endWall;
            lastSpeechEnd = s.endWall;
          });
        }
        break;
      }
      case "response.output_audio_transcript.delta": {
        const r = get();
        if (r) {
          if (Number.isNaN(r.firstMs)) r.firstMs = rel(at);
          r.text += e.delta ?? "";
        }
        lastActivity = at;
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        tr.inputTranscript += `${tr.inputTranscript ? " | " : ""}${String(e.transcript ?? "").trim()}`;
        break;
      case "response.done": {
        lastActivity = at;
        const out: Ev[] = e.response?.output ?? [];
        const calls = out.filter((o) => o.type === "function_call");
        if (calls.length > 0) {
          for (const c of calls) {
            let a: Ev = {};
            try {
              a = JSON.parse(c.arguments ?? "{}");
            } catch {}
            if (c.name === "show_passage") {
              const ids: string[] = Array.isArray(a.blockIds) ? a.blockIds.map(String) : [];
              tr.passages.push({
                blockIds: ids,
                why: String(a.why ?? ""),
                atMs: rel(at),
                right: turn.expect.length ? ids.some((id) => inRanges(id, turn.expect, art.order)) : null,
              });
              send({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: c.call_id,
                  output: `Showed the reader ${ids.length} passage${ids.length === 1 ? "" : "s"}.`,
                },
              });
            } else {
              tr.otherTools.push(`${c.name}(${String(c.arguments ?? "").slice(0, 80)})`);
              send({
                type: "conversation.item.create",
                item: {
                  type: "function_call_output",
                  call_id: c.call_id,
                  output: "That tool is not available right now. Answer from the article.",
                },
              });
            }
          }
          send({ type: "response.create" });
        } else if (at > lastSpeechEnd && e.response?.status === "completed") {
          finalAt = at;
        }
        break;
      }
    }
  };
  listeners.add(listener);

  const q = await feeder.speak(question);
  qEnd = q.endWall;
  lastSpeechEnd = qEnd;
  const deadline = now() + 45_000;
  while (now() < deadline) {
    await sleep(100);
    if (finalAt !== null && now() - lastActivity > 1500 && (!correction || corrEnd !== null)) break;
  }
  tr.timedOut = finalAt === null;
  listeners.delete(listener);

  const utts = [...responses.values()].filter((r) => r.text.trim() !== "" || r.firstAudioMs !== null);
  tr.utterances = utts.map(({ fnCalls: _f, ...u }) => u);
  tr.answer = utts.map((u) => u.text.trim()).join(" / ");
  const sub = utts.find((u) => !isBackchannel(u.text));
  tr.firstSubstantiveMs = sub ? (sub.firstAudioMs ?? sub.firstMs) : null;
  if (corrEnd !== null) {
    const ce = corrEnd;
    const after = utts.filter((u) => (u.firstAudioMs ?? u.firstMs) > ce - qEnd && !isBackchannel(u.text));
    const first = after[0];
    tr.afterCorrectionSubstantiveMs = first ? (first.firstAudioMs ?? first.firstMs) - Math.round(ce - qEnd) : null;
    tr.correction = turn.correction ?? null;
  }
  return tr;
}

// ---------------------------------------------------------------- GPT-Live (C, Cin)

async function runLive(
  config: "C" | "Cin",
  key: ArticleKey,
  sc: Scenario,
  rep: number,
  art: LoadedArticle,
  eventsFile: string,
): Promise<SessionRec> {
  const rec: SessionRec = {
    config,
    article: key,
    scenario: sc.id,
    rep,
    startupMs: 0,
    wallSeconds: 0,
    billedSeconds: null,
    closedReason: null,
    costUsd: 0,
    costParts: { voice: 0, backend: 0 },
    backendTokens: { input: 0, cached: 0, output: 0, reasoning: 0 },
    error: null,
    turns: [],
    maxContextRatio: null,
  };
  const t0 = now();
  /* Node's WebSocket is undici's, which takes headers in its init object. */
  const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", {
    headers: { Authorization: `Bearer ${KEY}` },
  } as unknown as string[]);
  const send = (e: Ev) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(e));
  const listeners = new Set<(e: Ev, at: number) => void>();
  let started!: () => void;
  let closed!: () => void;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const finalized = new Promise<void>((r) => {
    closed = r;
  });

  /* Per-delegation bookkeeping lives at session level: a delegation can outlive the turn that made it. */
  const delegations = new Map<string, DelegationRec>();
  const pendingCalls = new Map<string, string[]>(); // delegation id -> call ids awaiting a continuation
  /* GPT-Live streams output audio continuously, silence included, so the
     running sample count is a position on the output timeline. */
  let outPosMs = 0;
  let turnStart = 0; // wall time the current turn's question ended
  let currentTurn: TurnRec | null = null;
  let currentExpect: Range[] = [];

  ws.onopen = () => {
    send({
      type: "session.start",
      event_id: "start",
      session: {
        model: LIVE_VOICE_MODEL,
        instructions: voiceInstructions(art.meta, config === "Cin" ? art.withIds : null),
        audio: { format: { type: "audio/pcm", rate: RATE }, output: { voice: LIVE_VOICE } },
        delegation: {
          type: "responses",
          responses: {
            model: BACKEND_MODEL,
            instructions: backendInstructions(art.withIds),
            tools: [SHOW_PASSAGE_TOOL],
            tool_choice: "auto",
            reasoning: { effort: "low" },
          },
        },
        ...(sc.seed
          ? {
              input: [
                { type: "message", role: "user", content: [{ type: "input_text", text: sc.seed.user }] },
                { type: "message", role: "assistant", content: [{ type: "output_text", text: sc.seed.assistant }] },
              ],
            }
          : {}),
      },
    });
  };

  ws.onmessage = (m) => {
    const at = now();
    const e = JSON.parse(String(m.data)) as Ev;
    logEvent(eventsFile, e, at - t0);
    if (e.type === "session.output_audio.delta") {
      const a = audioInfo(String(e.delta ?? ""));
      e.__posMs = outPosMs;
      e.__loud = a.loud;
      outPosMs += a.ms;
    }
    switch (e.type) {
      case "session.started":
        started();
        break;
      case "error":
        rec.error = `${e.error?.code ?? ""} ${e.error?.message ?? ""}`.trim();
        if (/start/.test(String(e.error?.client_event_id ?? ""))) started();
        break;
      case "session.usage.updated":
        rec.billedSeconds = Number(e.usage?.seconds ?? rec.billedSeconds);
        if (e.context_window?.usage_ratio !== undefined)
          rec.maxContextRatio = Math.max(rec.maxContextRatio ?? 0, Number(e.context_window.usage_ratio));
        break;
      case "session.closed":
        rec.billedSeconds = Number(e.usage?.seconds ?? rec.billedSeconds);
        rec.closedReason = String(e.reason ?? "");
        closed();
        break;
      case "session.delegation.created": {
        const d: DelegationRec = {
          id: e.delegation?.id,
          createdMs: Math.round(at - turnStart),
          offsetMs: e.offset_ms ?? null,
          responseIds: e.delegation?.response_id ? [e.delegation.response_id] : [],
          functionCallMs: null,
          continuedMs: null,
          firstTextMs: null,
          completedMs: null,
          text: "",
          calls: [],
          usage: { input: 0, cached: 0, output: 0, reasoning: 0 },
        };
        delegations.set(d.id, d);
        currentTurn?.delegations.push(d);
        break;
      }
      case "response.event": {
        const d = delegations.get(e.delegation_id);
        const n: Ev = e.event ?? {};
        const rid: string | undefined = n.response?.id ?? n.response_id;
        if (d && rid && !d.responseIds.includes(rid)) d.responseIds.push(rid);
        if (n.type === "response.output_text.delta" && d) {
          if (d.firstTextMs === null) d.firstTextMs = Math.round(at - turnStart);
          d.text += n.delta ?? "";
        }
        if (n.type === "response.output_item.done" && n.item?.type === "function_call") {
          const item = n.item;
          if (d && d.functionCallMs === null) d.functionCallMs = Math.round(at - turnStart);
          d?.calls.push(`${item.name}(${item.arguments})`);
          let a: Ev = {};
          try {
            a = JSON.parse(item.arguments ?? "{}");
          } catch {}
          const ids: string[] = Array.isArray(a.blockIds) ? a.blockIds.map(String) : [];
          if (item.name === "show_passage" && currentTurn) {
            currentTurn.passages.push({
              blockIds: ids,
              why: String(a.why ?? ""),
              atMs: Math.round(at - turnStart),
              right: currentExpect.length ? ids.some((id) => inRanges(id, currentExpect, art.order)) : null,
            });
          } else if (currentTurn) currentTurn.otherTools.push(item.name);
          send({
            type: "response.item.create",
            event_id: `out_${item.call_id}`,
            item: {
              type: "function_call_output",
              call_id: item.call_id,
              output:
                item.name === "show_passage"
                  ? `Showed the reader ${ids.length} passage${ids.length === 1 ? "" : "s"}.`
                  : "That tool is not available.",
            },
          });
          /* Keyed by delegation: the nested output_item.done carries no response id. */
          const key = String(e.delegation_id ?? "?");
          pendingCalls.set(key, [...(pendingCalls.get(key) ?? []), item.call_id]);
        }
        if (n.type === "response.completed" || n.type === "response.done" || n.type === "response.failed" || n.type === "response.incomplete") {
          const u = n.response?.usage;
          if (u && d) {
            const inT = Number(u.input_tokens ?? 0);
            const cached = Number(u.input_tokens_details?.cached_tokens ?? 0);
            const outT = Number(u.output_tokens ?? 0);
            d.usage.input += inT;
            d.usage.cached += cached;
            d.usage.output += outT;
            d.usage.reasoning += Number(u.output_tokens_details?.reasoning_tokens ?? 0);
            const usd = ((inT - cached) * LUNA.input + cached * LUNA.cachedInput + outT * LUNA.output) / 1e6;
            rec.costParts.backend = (rec.costParts.backend ?? 0) + usd;
            spent += usd;
            const bt = rec.backendTokens as Record<string, number>;
            bt.input = (bt.input ?? 0) + inT;
            bt.cached = (bt.cached ?? 0) + cached;
            bt.output = (bt.output ?? 0) + outT;
          }
          const key = String(e.delegation_id ?? "?");
          if ((pendingCalls.get(key) ?? []).length > 0 && n.type === "response.completed") {
            pendingCalls.delete(key);
            if (d) d.continuedMs = Math.round(at - turnStart);
            send({ type: "response.create", event_id: `continue_${key}` });
          } else if (d) {
            d.completedMs = Math.round(at - turnStart);
          }
        }
        break;
      }
    }
    for (const l of listeners) l(e, at);
  };
  ws.onerror = () => {
    if (rec.wallSeconds === 0) rec.error = rec.error ?? "websocket error";
    started();
    closed();
  };
  ws.onclose = () => {
    started();
    closed();
  };

  await Promise.race([ready, sleep(20_000)]);
  rec.startupMs = Math.round(now() - t0);
  if (ws.readyState !== WebSocket.OPEN || rec.error) {
    try {
      ws.close();
    } catch {}
    return rec;
  }

  const feeder = new Feeder((audio) => send({ type: "session.input_audio.append", audio }));
  feeder.start();
  await sleep(600);

  for (let ti = 0; ti < sc.turns.length; ti++) {
    const turn = sc.turns[ti] as Turn;
    const tr = blankTurn(config, key, sc, rep, ti, turn);
    currentTurn = tr;
    currentExpect = turn.expect;
    await liveTurn(tr, turn, feeder, listeners, delegations, (t) => {
      turnStart = t;
    });
    rec.turns.push(tr);
    await sleep(1000);
  }

  /* Graceful close: install the listener (above), send session.close, wait for session.closed. */
  send({ type: "session.close", event_id: "close" });
  await Promise.race([finalized, sleep(15_000)]);
  feeder.stop();
  rec.wallSeconds = (now() - t0) / 1000;
  try {
    ws.close();
  } catch {}
  const voice = ((rec.billedSeconds ?? rec.wallSeconds) / 60) * LIVE_USD_PER_MIN;
  rec.costParts.voice = voice;
  spent += voice;
  rec.costUsd = Object.values(rec.costParts).reduce((a, b) => a + b, 0);
  return rec;
}

async function liveTurn(
  tr: TurnRec,
  turn: Turn,
  feeder: Feeder,
  listeners: Set<(e: Ev, at: number) => void>,
  delegations: Map<string, DelegationRec>,
  setTurnStart: (t: number) => void,
): Promise<void> {
  const question = await tts(turn.say);
  const correction = turn.correction ? await tts(turn.correction) : null;

  /* Transcript fragments, grouped into utterances by gaps on the session timeline. */
  type Frag = { text: string; start: number; end: number; at: number };
  const out: Frag[] = [];
  const inFrags: string[] = [];
  let qEnd = Number.POSITIVE_INFINITY;
  let qEndMs = 0;
  let corrEnd: number | null = null;
  let correctionQueued = false;
  let lastActivity = now();
  let firstAudio: number | null = null;
  const loudChunks: { at: number; pos: number }[] = [];
  let speaking = true;
  const myDelegations = new Set<string>();

  const queueCorrection = () => {
    if (!correction || correctionQueued) return;
    correctionQueued = true;
    void feeder.speak(correction).then((s) => {
      corrEnd = s.endWall;
    });
  };

  const listener = (e: Ev, at: number) => {
    switch (e.type) {
      case "session.output_audio.delta":
        if (e.__loud) {
          if (!speaking && firstAudio === null) firstAudio = at;
          if (!speaking) loudChunks.push({ at, pos: Number(e.__posMs) });
          lastActivity = at;
        }
        break;
      case "session.output_transcript.delta":
        if (!speaking) out.push({ text: e.delta ?? "", start: Number(e.start_ms), end: Number(e.end_ms), at });
        lastActivity = at;
        break;
      case "session.input_transcript.delta":
        inFrags.push(e.delta ?? "");
        break;
      case "session.delegation.created":
        if (!speaking) {
          myDelegations.add(e.delegation?.id);
          queueCorrection();
        }
        lastActivity = at;
        break;
      case "response.event":
        lastActivity = at;
        break;
    }
  };
  listeners.add(listener);

  /* The clock for delegation timings is the question's end. Estimated before
     speaking, because GPT-Live can delegate before the reader has finished. */
  const tStart = now() + (question.length / 2 / RATE) * 1000;
  setTurnStart(tStart);
  const q = await feeder.speak(question);
  qEnd = q.endWall;
  qEndMs = q.endMs;
  speaking = false;

  /* If nothing delegates within 6 s, interrupt on the first words instead. */
  const deadline = now() + 60_000;
  while (now() < deadline) {
    await sleep(100);
    /* Fallback when nothing delegates: interrupt after 6 s, or once it is plainly answering. */
    const said = out.map((f) => f.text).join("").trim().split(/\s+/).length;
    if (correction && !correctionQueued && (now() - qEnd > 6000 || said > 6)) queueCorrection();
    const pending = [...myDelegations].some((id) => {
      const d = delegations.get(id);
      return d !== undefined && d.completedMs === null && now() - qEnd - d.createdMs < 25_000;
    });
    const waitingForCorrection = correction !== null && corrEnd === null;
    const spoke = out.some((f) => f.at > (corrEnd ?? qEnd));
    if (spoke && !pending && !waitingForCorrection && now() - lastActivity > 3000) break;
  }
  tr.timedOut = now() >= deadline;
  listeners.delete(listener);

  type U = { text: string; start: number; end: number; at: number };
  /* Utterances: a new one wherever the speech timeline has a gap over 600 ms. */
  const group = (frags: Frag[]): U[] => {
    const us: U[] = [];
    let cur: U | null = null;
    for (const f of frags) {
      if (!cur || f.start - cur.end > 600) {
        if (cur) us.push(cur);
        cur = { text: f.text, start: f.start, end: f.end, at: f.at };
      } else {
        cur.text += f.text;
        cur.end = Math.max(cur.end, f.end);
      }
    }
    if (cur) us.push(cur);
    return us;
  };
  /* An utterance's audio: the first loud chunk at or after its transcript
     start on the output timeline. GPT-Live's output audio is continuous, so the
     sample count is that timeline; the write-up checks the alignment. */
  const audioOf = (u: U): number | null => {
    const chunk = loudChunks.find((c) => c.pos >= u.start - 150);
    return chunk ? Math.round(chunk.at - qEnd) : null;
  };
  const toUtt = (u: U): Utterance => ({
    text: u.text.trim(),
    firstMs: Math.round(u.at - qEnd),
    firstAudioMs: audioOf(u),
    timelineMs: Math.round(u.start - qEndMs),
  });
  const utts = group(out).map(toUtt);
  tr.utterances = utts;
  tr.fragments = out.map((f) => ({ text: f.text, timelineMs: Math.round(f.start - qEndMs), atMs: Math.round(f.at - qEnd) }));
  tr.inputTranscript = inFrags.join("").trim();
  tr.answer = utts.map((u) => u.text).join(" / ");
  tr.firstAudioMs = firstAudio === null ? null : Math.round(firstAudio - qEnd);

  /* **The answer cannot start before the backend has one.** When the turn
     delegated, the voice model only has the article's answer once the last
     delegation's text starts arriving, so speech before that is filler however
     many words it runs to ("I'll check how he's using that term right there").
     So: fragments that arrived after that moment, grouped, first one that is
     not a backchannel. A turn with no delegation uses all of its speech. */
  const mine = [...myDelegations].map((id) => delegations.get(id)).filter((d): d is DelegationRec => d !== undefined);
  const last = mine.sort((a, b) => a.createdMs - b.createdMs).at(-1);
  const answerFrom = last ? tStart + (last.firstTextMs ?? last.completedMs ?? 0) : Number.NEGATIVE_INFINITY;
  tr.answerAvailableMs = last ? Math.round(answerFrom - qEnd) : null;
  const substantive = (after: number): U | undefined =>
    group(out.filter((f) => f.at >= Math.max(after, answerFrom))).find((u) => !isBackchannel(u.text));
  const sub = substantive(Number.NEGATIVE_INFINITY);
  tr.firstSubstantiveMs = sub ? (audioOf(sub) ?? Math.round(sub.at - qEnd)) : null;
  tr.firstSubstantiveTimelineMs = sub ? Math.round(sub.start - qEndMs) : null;
  if (corrEnd !== null) {
    const ce = corrEnd;
    const first = substantive(ce);
    const audio = first ? audioOf(first) : null;
    tr.afterCorrectionSubstantiveMs = first ? (audio ?? Math.round(first.at - qEnd)) - Math.round(ce - qEnd) : null;
    tr.correction = turn.correction ?? null;
  }
}

// ---------------------------------------------------------------- plumbing

function blankTurn(config: Config, key: ArticleKey, sc: Scenario, rep: number, ti: number, turn: Turn): TurnRec {
  return {
    config,
    article: key,
    scenario: sc.id,
    rep,
    turn: ti + 1,
    question: turn.say,
    correction: null,
    inputTranscript: "",
    answer: "",
    utterances: [],
    firstAudioMs: null,
    firstSubstantiveMs: null,
    firstSubstantiveTimelineMs: null,
    afterCorrectionSubstantiveMs: null,
    passages: [],
    otherTools: [],
    delegations: [],
    timedOut: false,
  };
}

function logEvent(file: string, e: Ev, ms: number): void {
  const slim = { ...e };
  if (typeof slim.delta === "string" && /audio/.test(String(e.type))) slim.delta = `<${slim.delta.length} b64>`;
  if (typeof slim.audio === "string") slim.audio = `<${slim.audio.length} b64>`;
  if (slim.session?.instructions) slim.session = { ...slim.session, instructions: `<${slim.session.instructions.length} chars>` };
  if (slim.session?.delegation?.responses?.instructions)
    slim.session.delegation = {
      ...slim.session.delegation,
      responses: { ...slim.session.delegation.responses, instructions: "<backend prompt>" },
    };
  appendFileSync(file, `${JSON.stringify({ ms: Math.round(ms), ...slim })}\n`);
}

interface LoadedArticle {
  meta: Meta;
  blocks: Block[];
  withIds: string;
  order: Map<string, number>;
  tokens: number;
}

async function load(key: ArticleKey): Promise<LoadedArticle> {
  return runAsOwner(environmentOwnerId(), async () => {
    const a = await loadArticle(ARTICLE_SLUGS[key]);
    const withIds = articleWithIds(a.meta, a.blocks);
    return {
      meta: a.meta,
      blocks: a.blocks,
      withIds,
      order: new Map(a.blocks.map((b, i) => [String(b.id), i])),
      tokens: estimateTokens(withIds),
    };
  });
}

const median = (xs: number[]): number | null => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const worst = (xs: number[]): number | null => {
  const s = xs.filter((x) => Number.isFinite(x));
  return s.length ? Math.max(...s) : null;
};

// ---------------------------------------------------------------- probe

async function probe(): Promise<void> {
  const short = await load("short");
  const long = await load("long");
  console.log(`short ~${short.tokens} tokens, long ~${long.tokens} tokens (estimateTokens)`);
  for (const [label, instr] of [
    ["minimal", "Be concise."],
    ["short article in voice instructions", voiceInstructions(short.meta, short.withIds)],
    ["long article in voice instructions", voiceInstructions(long.meta, long.withIds)],
  ] as const) {
    const t0 = now();
    const ws = new WebSocket("wss://api.openai.com/v1/live/sessions", {
      headers: { Authorization: `Bearer ${KEY}` },
    } as unknown as string[]);
    const result = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("timeout"), 20_000);
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "session.start",
            event_id: "start",
            session: {
              model: LIVE_VOICE_MODEL,
              instructions: instr,
              audio: { format: { type: "audio/pcm", rate: RATE }, output: { voice: LIVE_VOICE } },
              delegation: { type: "responses", responses: { model: BACKEND_MODEL, instructions: backendInstructions(long.withIds), tools: [SHOW_PASSAGE_TOOL], reasoning: { effort: "low" } } },
            },
          }),
        );
      ws.onmessage = (m) => {
        const e = JSON.parse(String(m.data)) as Ev;
        if (e.type === "session.started") {
          ws.send(JSON.stringify({ type: "session.close" }));
        } else if (e.type === "session.closed") {
          clearTimeout(timer);
          resolve(`started+closed in ${Math.round(now() - t0)}ms, billed ${e.usage?.seconds}s, reason ${e.reason}`);
        } else if (e.type === "error") {
          clearTimeout(timer);
          resolve(`error: ${JSON.stringify(e.error)}`);
        }
      };
      ws.onerror = (err) => {
        clearTimeout(timer);
        resolve(`ws error ${String((err as unknown as { message?: string }).message ?? "")}`);
      };
      ws.onclose = (c) => resolve(`closed ${c.code} ${c.reason}`);
    });
    try {
      ws.close();
    } catch {}
    console.log(`${label}: ${result}`);
  }
}

// ---------------------------------------------------------------- main

if (args.has("probe")) {
  await probe();
  process.exit(0);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, "events"), { recursive: true });
const promptHash = createHash("sha256").update(LIVE_SYSTEM).digest("hex").slice(0, 12);
const loaded: Record<string, LoadedArticle> = {};
for (const k of ARTICLES) loaded[k] = await load(k);
writeFileSync(
  path.join(OUT, "meta.json"),
  JSON.stringify(
    {
      started: new Date().toISOString(),
      liveSystemSha: promptHash,
      liveSystemHasWhenToThink: LIVE_SYSTEM.includes("WHEN TO THINK"),
      configs: CONFIGS,
      reps: REPS,
      articles: Object.fromEntries(Object.entries(loaded).map(([k, a]) => [k, { slug: ARTICLE_SLUGS[k as ArticleKey], tokens: a.tokens }])),
      voicePromptChars: loaded.short ? voiceInstructions(loaded.short.meta, null).length : null,
    },
    null,
    2,
  ),
);
console.log(`LIVE_SYSTEM sha ${promptHash}; articles ${Object.entries(loaded).map(([k, a]) => `${k}=${a.tokens}t`).join(" ")}`);

/* Jobs interleaved rep by rep, so a slow patch of network hits every arm alike. */
interface Job {
  config: Config;
  article: ArticleKey;
  sc: Scenario;
  rep: number;
}
const jobs: Job[] = [];
for (let rep = 1; rep <= REPS; rep++)
  for (const article of ARTICLES)
    for (const sc of SCENARIO_SETS[article].filter((s) => SCENARIOS.includes(s.id)))
      for (const config of CONFIGS) {
        if (config === "Cin" && (article !== "short" || sc.id > 2)) continue;
        jobs.push({ config, article, sc, rep });
      }
console.log(`${jobs.length} sessions, concurrency ${CONCURRENCY}`);

const resultsFile = path.join(OUT, "sessions.jsonl");
const results: SessionRec[] = [];
let next = 0;
async function worker(): Promise<void> {
  while (next < jobs.length) {
    if (spent > SPEND_CEILING_USD) {
      console.log(`!! spend ceiling reached ($${spent.toFixed(2)}); stopping`);
      return;
    }
    const job = jobs[next++] as Job;
    const art = loaded[job.article] as LoadedArticle;
    const tag = `${job.config}-${job.article}-s${job.sc.id}-r${job.rep}`;
    const events = path.join(OUT, "events", `${tag}.jsonl`);
    let rec: SessionRec;
    try {
      rec = await Promise.race([
        job.config === "A" || job.config === "B" || job.config === "Bp"
          ? runRealtime(job.config, job.article, job.sc, job.rep, art, events)
          : runLive(job.config, job.article, job.sc, job.rep, art, events),
        sleep(300_000).then(() => {
          throw new Error("session over 5 minutes");
        }),
      ]);
    } catch (err) {
      rec = {
        config: job.config,
        article: job.article,
        scenario: job.sc.id,
        rep: job.rep,
        startupMs: 0,
        wallSeconds: 0,
        billedSeconds: null,
        closedReason: null,
        costUsd: 0,
        costParts: {},
        error: err instanceof Error ? err.message : String(err),
        turns: [],
      };
    }
    results.push(rec);
    appendFileSync(resultsFile, `${JSON.stringify(rec)}\n`);
    const t = rec.turns.map((x) => `${x.firstAudioMs ?? "-"}/${x.firstSubstantiveMs ?? "-"}ms sp=${x.passages.length}`).join(" ");
    console.log(`${tag}: $${rec.costUsd.toFixed(4)} ${t}${rec.error ? ` ERR ${rec.error}` : ""} (total $${spent.toFixed(2)})`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

// ---------------------------------------------------------------- summary

console.log("\n== per config × article × scenario: first audio / first substantive (ms, median & worst) ==");
const groups = new Map<string, TurnRec[]>();
for (const r of results) for (const t of r.turns) {
  const k = `${t.config}\t${t.article}\ts${t.scenario}`;
  groups.set(k, [...(groups.get(k) ?? []), t]);
}
for (const [k, ts] of [...groups.entries()].sort()) {
  const fa = ts.map((t) => t.firstAudioMs ?? Number.NaN);
  const fs = ts.map((t) => t.firstSubstantiveMs ?? Number.NaN);
  const tl = ts.map((t) => t.firstSubstantiveTimelineMs ?? Number.NaN);
  const ac = ts.map((t) => t.afterCorrectionSubstantiveMs ?? Number.NaN);
  const withExpect = ts.filter((t) => SCENARIO_SETS[t.article].find((s) => s.id === t.scenario)?.turns[t.turn - 1]?.expect.length);
  const called = withExpect.filter((t) => t.passages.length > 0).length;
  const right = withExpect.filter((t) => t.passages.some((p) => p.right)).length;
  console.log(
    `${k}\tn=${ts.length}\taudio ${median(fa)}/${worst(fa)}\tsubst ${median(fs)}/${worst(fs)}\ttimeline ${median(tl)}/${worst(tl)}\tafterCorr ${median(ac)}/${worst(ac)}\tshow_passage ${called}/${withExpect.length} right ${right}/${withExpect.length}\ttimeouts ${ts.filter((t) => t.timedOut).length}`,
  );
}
console.log("\n== cost per session (median) and per billed/wall minute ==");
const cg = new Map<string, SessionRec[]>();
for (const r of results) cg.set(`${r.config}\t${r.article}`, [...(cg.get(`${r.config}\t${r.article}`) ?? []), r]);
for (const [k, rs] of [...cg.entries()].sort()) {
  const ok = rs.filter((r) => !r.error || r.turns.length > 0);
  const total = ok.reduce((a, r) => a + r.costUsd, 0);
  const minutes = ok.reduce((a, r) => a + (r.billedSeconds ?? r.wallSeconds) / 60, 0);
  console.log(
    `${k}\tsessions ${ok.length}\tmedian $${(median(ok.map((r) => r.costUsd)) ?? 0).toFixed(4)}\ttotal $${total.toFixed(3)}\tper minute $${(total / Math.max(minutes, 1e-9)).toFixed(3)}\tstartup median ${median(ok.map((r) => r.startupMs))}ms\terrors ${rs.filter((r) => r.error).length}`,
  );
}
console.log(`\nTOTAL SPEND (excl. TTS): $${spent.toFixed(3)}`);
process.exit(0);
