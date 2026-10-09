/**
 * **Does a new Chat conversation open an earlier one when it should, and leave
 * it alone when it should not?** Plan
 * docs/plans/261008e-chat-knows-the-reader-s-other-conversations.md.
 *
 *   npx tsx evals/chat-other-threads.ts [--repeats=3] [--hard]
 *
 * One article (the Noema fixture), two earlier conversations held as fixtures:
 *
 * - **A**, titled by its first question ("What is the bit about the
 *   cinnamon bun for?"), which then went on to the argument's weak points;
 * - **B**, about what "computational functionalism" means.
 *
 * Each earlier conversation's gist is written by the production gist call
 * (`gistOf`, a real small-model call), so this also shows what the gists look
 * like. Then three questions are asked in a new Chat conversation, each in two
 * arms — with the list of other conversations (what ships) and without it (no
 * list: what Chat had before, the prompt otherwise the same) — `--repeats`
 * times:
 *
 * - `weak`  "Where is his argument weakest?" — should open A;
 * - `fn`    "Remind me what computational functionalism means here?" — should open B;
 * - `other` "Who is Blake Lemoine?" — should open neither.
 *
 * `reader_notes` is answered from the fixtures through `converse`'s
 * `runToolWith`, as evals/learn-explore.ts does; every other tool is real.
 * Prints a table of which conversation each answer opened, and the first lines
 * of each answer. Spend is recorded under an eval scope. About $1 a run.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { gistOf } from "../src/chat-gist.js";
import { describeCall, runTool, type ToolOutcome } from "../src/chat-tools.js";
import { converse } from "../src/converse.js";
import { loadEnvLocal } from "../src/env.js";
import { isMain } from "../src/is-main.js";
import { otherConversationsSection, threadTranscript } from "../src/reader-notes.js";
import { withLedger } from "../src/cli-ledger.js";
import type { Block, ChatMessage, ChatThread, Meta } from "../src/types.js";

const DIR = path.resolve(import.meta.dirname, "..", "tests", "fixtures", "data-root", "data", "noema-mythology-of-conscious-ai");
const CURRENT = "spya-curr00";

/**
 * `--hard`: conversation A's second question is a general one ("What did you
 * make of it overall?") and the weak points arrive only in the answer — Greg's
 * own case, where the model raised the confounds unasked. That is the case a
 * preview of the latest question cannot see and a gist can.
 */
const HARD = process.argv.includes("--hard");

let n = 0;
const m = (role: "user" | "assistant", text: string): ChatMessage => ({
  id: `spya-ev${String(++n).padStart(4, "0")}`,
  role,
  text,
  createdAt: "2026-10-07T10:00:00.000Z",
  status: "done",
});

const A: ChatThread = {
  id: "spya-thra11",
  title: "What is the bit about the cinnamon bun for?",
  createdAt: "2026-10-07T10:00:00.000Z",
  updatedAt: "2026-10-07T10:20:00.000Z",
  kind: "chat",
  messages: [
    m("user", "What is the bit about the cinnamon bun for?"),
    m(
      "assistant",
      "It is Figure 1, a picture of Mother Teresa seen in a cinnamon bun [spya-gxdsbh]. Seth uses it as an example of pareidolia: we see faces, and minds, where there are none. It sets up his claim that our biases make us see consciousness in AI.",
    ),
    m("user", HARD ? "OK. What did you make of it overall?" : "OK. Where do you think his argument is weakest?"),
    m(
      "assistant",
      "Three places. First, 'brains are not computers' [spya-a8jgf4] argues against a crude version of functionalism; a functionalist can grant that brains are not Turing machines and still hold that what matters is the causal organisation, which silicon could in principle share. Second, his biological view leans on the link between life and consciousness, but that link is a hypothesis, not a finding — nothing in the piece rules out a non-living system having the relevant properties. Third, he treats our psychological biases (anthropocentrism, human exceptionalism) [spya-h4mwb2 spya-her4zk] as a reason to doubt AI consciousness, but a bias explains why people might believe something, not whether it is false. My inference is that the essay is stronger as a warning against hasty attribution than as an argument that machine consciousness is impossible.",
    ),
  ],
};

const B: ChatThread = {
  id: "spya-thrb22",
  title: "What does computational functionalism mean?",
  createdAt: "2026-10-07T11:00:00.000Z",
  updatedAt: "2026-10-07T11:05:00.000Z",
  kind: "chat",
  messages: [
    m("user", "What does computational functionalism mean?"),
    m(
      "assistant",
      "It is the view that having a mind, and being conscious, is a matter of carrying out the right computations, whatever they run on [spya-wepmnr]. On this view a brain and a computer running the same program would have the same experiences. Seth says the whole idea of conscious AI rests on it, and sets out to challenge it [spya-cv97j7].",
    ),
  ],
};

const QUESTIONS = {
  weak: { text: "Where is his argument weakest?", expect: A.id },
  fn: { text: "Remind me what computational functionalism means here?", expect: B.id },
  other: { text: "Who is Blake Lemoine?", expect: null },
} as const;

/** `reader_notes` from the fixtures; every other tool is the real one. */
function fixtureTools(threads: ChatThread[]): typeof runTool {
  return async (name, args, ctx): Promise<ToolOutcome> => {
    if (name !== "reader_notes") return runTool(name, args, ctx);
    const wanted = typeof args.thread === "string" ? args.thread.trim() : "";
    const t = threadTranscript(threads, wanted, ctx.threadId);
    return { label: describeCall("reader_notes", args), detail: wanted || "list", content: t.content };
  };
}

/**
 * The three arms: `gist`, the list as it ships; `preview`, the same list with
 * every gist taken away, so each row falls back to its latest question (GPT
 * Sol's simpler alternative, plan review point 6); `none`, no list at all.
 */
type Arm = "gist" | "preview" | "none";
const ARMS: readonly Arm[] = ["gist", "preview", "none"];

async function ask(meta: Meta, blocks: Block[], threads: ChatThread[], question: string, arm: Arm) {
  const listed = arm === "preview" ? threads.map(({ gist: _gist, ...t }) => t) : threads;
  const opened: string[] = [];
  let text = "";
  for await (const event of converse({
    power: "standard",
    meta,
    blocks,
    history: [],
    question,
    slug: "eval-other-threads",
    threadId: CURRENT,
    kind: "chat",
    others: arm === "none" ? null : (otherConversationsSection(listed, CURRENT)?.content ?? null),
    runToolWith: async (name, args, ctx) => {
      if (name === "reader_notes") opened.push(typeof args.thread === "string" ? args.thread : "(list)");
      return fixtureTools(threads)(name, args, ctx);
    },
  })) {
    if (event.type === "delta") text += event.text;
  }
  return { opened, text };
}

async function main(): Promise<void> {
  const repeats = Number(process.argv.find((a) => a.startsWith("--repeats="))?.slice(10) ?? 3);
  const { blocks } = JSON.parse(await readFile(path.join(DIR, "blocks.json"), "utf-8")) as { blocks: Block[] };
  const meta = JSON.parse(await readFile(path.join(DIR, "meta.json"), "utf-8")) as Meta;

  const threads: ChatThread[] = [];
  for (const t of [A, B]) {
    const gist = await gistOf(t);
    console.log(`gist ${t.id}: ${gist}`);
    threads.push({ ...t, ...(gist ? { gist } : {}) });
  }

  const rows: string[] = [];
  for (const [key, q] of Object.entries(QUESTIONS)) {
    for (const arm of ARMS) {
      const runs = await Promise.all(
        Array.from({ length: repeats }, () => ask(meta, blocks, threads, q.text, arm)),
      );
      const right = runs.filter((r) =>
        q.expect === null ? !r.opened.some((o) => o.startsWith("spya-thr")) : r.opened.includes(q.expect),
      ).length;
      const wrong = runs.filter((r) => r.opened.some((o) => o.startsWith("spya-thr") && o !== q.expect)).length;
      rows.push(`| ${key} | ${arm} | ${right}/${repeats} | ${wrong} | ${runs.map((r) => r.opened.join("+") || "–").join(" · ")} |`);
      for (const r of runs) console.log(`\n--- ${key} / ${arm} / opened ${r.opened.join("+") || "nothing"}\n${r.text.slice(0, 600)}`);
    }
  }
  console.log("\n| question | arm | right | opened a wrong one | opened per run |\n|---|---|---|---|---|");
  for (const r of rows) console.log(r);
}

if (isMain(import.meta.url)) {
  loadEnvLocal();
  await withLedger("eval", main);
}
