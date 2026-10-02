/**
 * Eval — does Remember's **Tutorial** prompt hold a short, teaching
 * back-and-forth over several turns?
 *
 *     npm run eval:tutorial -- data/noema-mythology-of-conscious-ai
 *
 * **This one spends money.** Tutorial is a conversation, so a single reply
 * says little: whether turns stay short, whether the task climbs as the reader
 * succeeds and drops when they struggle, whether an earlier point comes back —
 * those only show over several turns. So each reader below is a **script**:
 * five turns of what they say, written in advance and generic enough to fit
 * whatever the model said before, run in order with the model's own replies as
 * the history. The reader does not adapt to the model; the model is meant to
 * adapt to the reader.
 *
 * Three readers, each a way the prompt could go wrong:
 *
 *   notRead   has not read it at all       → quizzing somebody on a text they
 *                                             have not read; a lecture
 *   remembers read it, remembers a bit     → ignoring what they said; gimmes
 *   expert    a profile and a narrow goal  → a tour of the basics
 *
 * As in evals/remember-recall.ts, **the pass condition is a person reading
 * it.** The counts (words, questions, citations) are prompts to look.
 * docs/plans/261002i-one-adaptive-recall-and-a-tutorial-sub-mode-for-remember.md.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { converse } from "../src/converse.js";
import { withLedger } from "../src/cli-ledger.js";
import type { Block, ChatMessage, Meta } from "../src/types.js";

loadEnvLocal();

interface Reader {
  readonly name: string;
  readonly watchFor: string;
  /** "About the reader … / Why they are reading …", as `renderProfile` writes it. */
  readonly profile?: string;
  readonly turns: readonly string[];
}

const READERS: readonly Reader[] = [
  {
    name: "notRead",
    watchFor:
      "Has NOT read it. Starts from zero with a cited orienting claim and a question they can answer without having read it? Then small steps, never a quiz on unread text, never a lecture.",
    turns: [
      "I haven't read it yet, to be honest.",
      "Um, I guess I'd expect that AI could be conscious eventually if it gets smart enough?",
      "Okay so it's saying being intelligent and being conscious aren't the same thing.",
      "I don't know, I'm not sure I follow that bit.",
      "Right. So brains aren't like computers because you can't separate the software from the hardware?",
    ],
  },
  {
    name: "remembers",
    watchFor:
      "Read it, remembers some. Builds on what they said, corrects at most one thing, climbs from say-it-back towards apply/question, and reaches back to an earlier point by turn 4 or 5?",
    turns: [
      "I read it last week. I remember the simulation thing — a simulated storm doesn't make anything wet — and that he thinks life matters somehow.",
      "So simulating a brain wouldn't give you a mind, unless the mind is just computation anyway.",
      "I think the point is that a simulation can copy the pattern without being the living thing itself — like a flight simulator doesn't fly anywhere.",
      "Hmm, no idea.",
      "I suppose I'd push back that maybe consciousness IS just computation, and then his argument doesn't work.",
    ],
  },
  {
    name: "expert",
    profile:
      "About the reader: a cognitive neuroscientist who works on predictive processing.\nWhy they are reading this piece: to see how he argues that life, not computation, matters for consciousness.",
    watchFor:
      "Expert with a narrow goal. Goes straight to the 'life matters' passages, skips basics, asks harder questions (what the argument needs, where it is weak), no praise, no announcing that it is skipping basics?",
    turns: [
      "I've read it. I'm mainly interested in the biological naturalism argument.",
      "The link is meant to be that prediction error minimisation is bottomed out in metabolism, so the inference is tied to staying alive.",
      "I think the weak point is that you could implement the same predictive dynamics in a non-living system.",
      "He'd probably say the dynamics wouldn't be the same without the metabolic substrate, but that seems to beg the question.",
      "What does he actually concede at the end about how confident he is?",
    ],
  },
];

const BANNED = [
  "great answer",
  "great question",
  "excellent",
  "exactly right",
  "well done",
  "not quite",
  "close, but",
  "you seem to think",
  "it's important to note",
  "as a neuroscientist",
  "given your background",
] as const;
const BANNED_OPENERS = [
  ["good —", /^good\s*[—-]/i],
  ["that's exactly", /^that['’]s exactly\b/i],
  ["perfect", /^perfect\b/i],
] as const;

async function loadArticle(dir: string): Promise<{ meta: Meta; blocks: Block[] }> {
  const { blocks } = JSON.parse(await readFile(path.join(dir, "blocks.json"), "utf-8")) as { blocks: Block[] };
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf-8")) as Meta;
  return { meta, blocks };
}

const row = (role: "user" | "assistant", text: string, i: number): ChatMessage => ({
  id: `spya-${role === "user" ? "usr" : "ans"}${String(i).padStart(3, "0").replace(/1/g, "z")}`,
  role,
  text,
  createdAt: "2026-10-02T00:00:00.000Z",
  status: "done",
});

async function oneTurn(
  meta: Meta,
  blocks: Block[],
  history: ChatMessage[],
  said: string,
  profile: string | null,
): Promise<{ text: string; model: string; truncated: boolean }> {
  let text = "";
  let model = "";
  let truncated = false;
  for await (const event of converse({
    power: "standard",
    meta,
    blocks,
    history,
    question: said,
    slug: "eval-tutorial",
    kind: "tutorial",
    profile,
    /* Our own tools off, as in remember-recall.ts: every turn is answerable
       from the article, and tools would make runs slow and non-comparable. */
    useTools: false,
  })) {
    if (event.type === "delta") text += event.text;
    if (event.type === "done") {
      model = event.model;
      truncated = event.truncated;
    }
  }
  return { text, model, truncated };
}

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const questions = (t: string) => (t.match(/\?/g) ?? []).length;
const cites = (t: string) => (t.match(/\bspya-[a-z0-9]{6}\b/g) ?? []).length;

async function main(): Promise<void> {
  const dir = process.argv[2] ?? "data/noema-mythology-of-conscious-ai";
  const { meta, blocks } = await loadArticle(dir);
  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };
  say(`# Remember: Tutorial — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${dir}\` (${blocks.length} blocks). ${READERS.length} scripted readers × 5 turns. **Read the conversations.** See the header of \`evals/remember-tutorial.ts\`.`);
  say();
  let model = "";
  let long = 0;
  let multiQ = 0;
  let uncited = 0;
  let flagged = 0;
  let total = 0;
  for (const r of READERS) {
    say(`## ${r.name}`);
    say();
    say(`**Watch for:** ${r.watchFor}`);
    if (r.profile) say(`\n**Profile:** ${r.profile.replace(/\n/g, " / ")}`);
    say();
    const history: ChatMessage[] = [];
    for (const [i, said] of r.turns.entries()) {
      say(`> **Reader ${i + 1}:** ${said}`);
      say();
      let out: Awaited<ReturnType<typeof oneTurn>>;
      try {
        out = await oneTurn(meta, blocks, history, said, r.profile ?? null);
      } catch (err) {
        say(`**FAILED:** ${String(err instanceof Error ? err.message : err)}`);
        say();
        break;
      }
      total += 1;
      model = out.model || model;
      const w = words(out.text);
      const q = questions(out.text);
      const c = cites(out.text);
      const lower = out.text.toLowerCase();
      const hit = [
        ...BANNED.filter((p) => lower.includes(p)),
        ...BANNED_OPENERS.filter(([, pattern]) => pattern.test(out.text.trimStart())).map(([label]) => label),
      ];
      if (w > 140) long += 1;
      if (q > 1) multiQ += 1;
      if (c === 0) uncited += 1;
      if (hit.length) flagged += 1;
      say(`**Tutor ${i + 1}** — ${w} words, ${q} question mark${q === 1 ? "" : "s"}, ${c} citation${c === 1 ? "" : "s"}${hit.length ? `, ⚠︎ banned: ${hit.join(", ")}` : ""}${out.truncated ? ", ⚠︎ CUT OFF" : ""}`);
      say();
      say(out.text.trim());
      say();
      history.push(row("user", said, i * 2), row("assistant", out.text, i * 2 + 1));
    }
  }
  say("## Counts, which are not the answer");
  say();
  say(`- model: \`${model}\``);
  say(`- replies: ${total}`);
  say(`- over the 140-word ceiling: ${long}`);
  say(`- more than one question mark: ${multiQ} (one task per turn; a quoted question can trip this)`);
  say(`- citing no block: ${uncited}`);
  say(`- containing a banned phrase: ${flagged}`);
  const out = path.resolve(import.meta.dirname, "results", "remember-tutorial.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf-8");
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
}

/* `withLedger` so the spend is recorded under an eval scope — see the note at
   the foot of evals/remember-recall.ts. */
await withLedger("eval", main);
