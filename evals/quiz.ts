/**
 * Eval — do the quiz's two prompts behave?
 *
 *     npm run eval:quiz                  # the committed corpus article
 *     npm run eval:quiz -- --marks-only
 *     npm run eval:quiz -- <dir with blocks.json + tree.json>
 *
 * **This one spends money**, and it is the reason stage 1 of
 * docs/plans/260831al-review-quiz-sub-mode.md is prompts-and-eval with no
 * routes, no store and no panel. In this feature the prompt *is* the product:
 * the artefact, the panel and the walk are plumbing around two pages of
 * instructions, and nothing deterministic can tell you whether those two pages
 * work. tests/quiz.test.ts pins where the words are; only a model can say what
 * they do.
 *
 * ## Two halves, and they are independent on purpose
 *
 * **Generation** runs the real stage against the real article and prints every
 * question, so the first thing anybody looks at is a real batch. Read it for
 * the things the spike found and the prompt now bans: a question about where
 * something sits in the piece, two questions joined by "and", a reference
 * answer that is one semicolon-spliced sentence, and — since `quiz/5` — a
 * premise that gives its own question away.
 *
 * **Marking** does NOT use those questions. Its eight cases carry their own
 * question, reference answer and evidence, hand-written against this article,
 * and that is load-bearing rather than lazy: the case that matters most is a
 * **deliberately poisoned reference answer with valid block ids**, and you
 * cannot poison a reference the model has just written. Fixed cases also mean
 * the marking half can be re-run on its own with `--marks-only` while the
 * marking prompt is being edited, without repaying for generation.
 *
 * ## Where the eight cases come from
 *
 * Each is a specific way this prompt would misbehave, taken from GPT Sol's
 * review of the plan — the six the first draft was missing are all here:
 *
 *   differentWords     right, worded nothing like the draft → an invented correction
 *   elsewhere          right, from a DIFFERENT passage      → treated as a miss
 *   confidentlyWrong   wrong and sure of it                 → a correction from inference
 *   noIdea             "tell me"                            → a hedge instead of an answer
 *   half               two of three parts                   → an inventory of omissions
 *   moreComplete       more than the draft contains         → the extra read as an error
 *   poisonedReference  the DRAFT is wrong, ids and all      → the reader told they are wrong
 *   illPosed           the article does not settle it       → a confident answer anyway
 *
 * **`poisonedReference` is the one to read first.** It is the whole of Sol's
 * finding 1: the reference answer is model prose written before anybody
 * answered, and a marker that treats it as an answer key will tell a reader who
 * is right that they are wrong, cite a real block id while doing it, and sound
 * authoritative.
 *
 * ## The pass condition is read by a person
 *
 * Deliberately, as in evals/learn-recall.ts. This is a judgement about tone
 * and authority, and anything a regex could check would be checking the wrong
 * thing — a reply can contain none of the banned phrases and still read as a
 * school report. The counts below are a prompt to look, never a verdict. A
 * green count with a patronising answer under it is exactly
 * docs/reusable/silent-success.md.
 *
 * ## One thing this eval found and did not fix
 *
 * **Generation failed to parse twice in nine calls** while stage 1 was being
 * written — `the model's answer is not valid JSON: it breaks at position 5824
 * of 11381 characters`, mid-answer, neither a refusal nor a truncation. Four
 * deliberate attempts to reproduce it all parsed cleanly, so it is intermittent
 * at roughly one call in five, and every stage on this wire has the same
 * exposure.
 *
 * Two things follow, both for a later piece of work rather than for here:
 *
 * - **It is a retry, not a bug.** The call is nondeterministic, so unlike the
 *   `max_tokens` case a second attempt really can come out differently. Where
 *   that retry belongs is src/jobs.ts, for all eight stages at once — a silent
 *   retry added to this one stage would be a second way of doing something the
 *   pipeline already owns.
 * - **It is currently undiagnosable, by design.** `parseJsonFrom` withholds the
 *   content so the article never reaches a log, and no stage writes the raw
 *   answer anywhere, so working out what broke means writing a throwaway script
 *   that repeats the call — which is what was done here. src/parse-json.ts
 *   § What a developer loses anticipates exactly this and names the fix: a
 *   deliberate write of the raw answer beside the artefact, decided on purpose.
 *
 * The cases are written against *this* article — Seth's "The Mythology Of
 * Conscious AI" — because a case has to be checkable: `elsewhere` is only
 * elsewhere if the piece really does say the same thing in two places. Pointing
 * this at a different article means rewriting all eight, which is why the
 * article is a positional argument with a default rather than a parameter that
 * changes what the cases mean.
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadEnvLocal } from "../src/env.js";
import { withLedger } from "../src/cli-ledger.js";
import { generateQuiz } from "../src/quiz.js";
import { markAnswer, type QuizMarkResult } from "../src/quiz-mark.js";
import { readArticleFromDir } from "../tests/helpers/article-from-dir.js";
import { FIXTURE_ROOT } from "../tests/helpers/require-fixture.js";
import { fallbackHeadTitle } from "../src/source-hash.js";
import type { Meta } from "../src/types.js";
/* The cases and the counters live in quiz-cases.ts since plan 261029i, so
   evals/quiz-models.ts reads the same eight. */
import { CASES, citations, flags, loadMeta, misattributed, namesTheDraft } from "./quiz-cases.js";

loadEnvLocal();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  /* **The committed corpus by default, not `data/`.** The eight marking cases
     below are written against *this* article — `elsewhere` is only elsewhere if
     the piece really does say the same thing in two places — so the article has
     to be the same bytes every time the eval is run. `data/` is gitignored and
     is whatever that laptop last ingested; `tests/fixtures/data-root/data/` is
     tracked in git (tests/helpers/require-fixture.ts,
     docs/plans/260901b-committed-fixture-corpus.md). A positional path still
     overrides it, for a hand-edited copy of the folder. */
  const dir =
    args.find((a) => !a.startsWith("--")) ??
    path.join(FIXTURE_ROOT, "data", "noema-mythology-of-conscious-ai");
  const doGenerate = !args.includes("--marks-only");
  const doMark = !args.includes("--generate-only");

  const article = await readArticleFromDir(dir);
  const meta = (await loadMeta(dir)) ?? ({ title: fallbackHeadTitle(article.tree) } as Meta);

  const lines: string[] = [];
  const say = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  say(`# Quiz — ${meta.title ?? dir}`);
  say();
  say(`Article: \`${dir}\` (${article.blocks.length} blocks)`);
  say();
  say(
    "Two halves. **Read the answers.** The counts below are a prompt to look, not a verdict — see the header of `evals/quiz.ts`.",
  );
  say();

  /* ------------------------------------------------------- generation -- */

  if (doGenerate) {
    say("## The batch");
    say();
    say(
      "Read for what the prompt bans and the spike found anyway: a question about where something sits in the piece, two questions joined by “and”, a reference answer that is one semicolon-spliced sentence — and, since the quiz became a path, a premise that gives away its own question's answer, or a path that is a list with nothing leaning on anything.",
    );
    say();
    try {
      const run = await generateQuiz({ power: "standard", article });
      const { quiz } = run;
      const premised = quiz.questions.filter((q) => q.premise).length;
      say(
        `${quiz.questions.length} questions, ${premised} with a premise. ` +
          `\`${run.model}\`, ${(run.elapsedMs / 1000).toFixed(1)}s, ` +
          `${run.inputTokens} in / ${run.outputTokens} out.`,
      );
      say();
      const d = run.dropped;
      say(
        `Dropped: ${d.unanchored} unanchored, ${d.unknownIds} bad ids, ${d.unquoted} unquoted, ` +
          `${d.malformed} malformed, ${d.duplicate} duplicates, ${d.truncated} over the evidence ` +
          `cap, ${d.overCap} over the question cap, ${d.gaps ?? 0} gaps mid-path.`,
      );
      say();
      for (const [i, q] of quiz.questions.entries()) {
        say(`### ${i + 1}. ${q.question}`);
        say();
        if (q.premise) {
          say(`*Premise:* ${q.premise}`);
          say();
        }
        say(q.evidence.map((e) => `\`${e.blockId}\``).join(" "));
        say();
        say(q.referenceAnswer);
        say();
        for (const e of q.evidence) say(`> ${e.quote}  \`${e.blockId}\``);
        say();
      }
    } catch (err) {
      /* A failed generation is a RESULT, not a crash — a batch where nothing
         anchored throws by design, and the message says so. Losing the marking
         half over it would be the wrong trade. */
      say("### generation FAILED");
      say();
      say("```");
      say(String(err instanceof Error ? err.message : err));
      say("```");
      say();
    }
  }

  /* ---------------------------------------------------------- marking -- */

  if (!doMark) {
    await write(lines);
    return;
  }

  say("## The marks");
  say();
  say(
    "Eight fixed cases, each carrying its own question, draft answer and evidence — **not** the batch above, because a draft you have just written cannot be poisoned. Two of the eight hand the marker a draft that is wrong on purpose, with real block ids.",
  );
  say();

  let flagged = 0;
  /* The hidden verdict against its hand label — see `expectVerdict`. Only the
     seven labelled cases are counted; `half` is deliberately unlabelled. */
  let verdictsChecked = 0;
  let verdictsAgreed = 0;
  const verdictMisses: string[] = [];
  let uncited = 0;
  let invented = 0;
  let misplaced = 0;
  let checkedQuotes = 0;
  let model = "";
  /* `marked` and `failed` exist because of a bug this eval shipped with: a
     marking call that threw was printed as **FAILED** and `continue`d past,
     and the summary below still printed `marks: ${CASES.length}` — a
     constant — while every quality counter only ever incremented on success.
     Eight failed calls therefore produced a results file reading `marks: 8`
     and every quality count a clean 0, indistinguishable from a run that
     measured eight good replies. docs/reusable/silent-success.md, in this
     eval's own report. `marked` is how many replies were actually obtained;
     the summary reports that, not CASES.length, and `failed` makes a
     non-zero failure count impossible to miss. */
  let marked = 0;
  let failed = 0;

  for (const c of CASES) {
    say(`### ${c.name}`);
    say();
    say(`**Watch for:** ${c.watchFor}`);
    say();
    say(`**Question.** ${c.question}`);
    say();
    say(
      `**${c.poisoned ? "Draft answer — DELIBERATELY WRONG" : "Draft answer"}.** ${c.referenceAnswer}`,
    );
    say();
    say(`**Evidence.** ${c.evidence.map((e) => `\`${e.blockId}\``).join(" ")}`);
    say();
    say("**The reader said:**");
    say();
    say("> " + c.said.replace(/\n/g, "\n> "));
    say();

    const started = performance.now();
    let out: QuizMarkResult;
    try {
      out = await markAnswer({ power: "standard",
        meta,
        blocks: article.blocks,
        question: c.question,
        referenceAnswer: c.referenceAnswer,
        evidence: c.evidence,
        answer: c.said,
        telemetry: { slug: article.slug, questionId: c.name },
      });
    } catch (err) {
      failed += 1;
      say("**FAILED**");
      say();
      say("```");
      say(String(err instanceof Error ? err.message : err));
      say("```");
      say();
      continue;
    }
    marked += 1;
    model = out.model || model;
    const hit = flags(out.reply);
    const cited = citations(out.reply, article.blocks);
    const placed = misattributed(out.reply, article.blocks);
    if (hit.length) flagged += 1;
    if (cited.known === 0) uncited += 1;
    if (cited.unknown > 0) invented += 1;
    misplaced += placed.wrong;
    checkedQuotes += placed.checked;
    const secs = ((performance.now() - started) / 1000).toFixed(1);

    /* **The hidden verdict, and whether it matches the hand label.** The mark
       above is what the reader sees; this is the word that decides how hard
       their next question is and that they never see. A mismatch here is
       invisible in production by construction, which is why it is printed
       beside a label somebody wrote by hand.
       docs/plans/260907d-make-the-quiz-adaptive.md § Measuring it. */
    const got = out.verdict ?? "none";
    if (c.expectVerdict) {
      verdictsChecked += 1;
      if (got === c.expectVerdict) verdictsAgreed += 1;
      else verdictMisses.push(`${c.name}: wanted ${c.expectVerdict}, got ${got}`);
    }

    say(
      `**Verdict (hidden from the reader)** — \`${got}\`` +
        (c.expectVerdict
          ? got === c.expectVerdict
            ? ` · matches the hand label`
            : ` · ⚠︎ **hand label says \`${c.expectVerdict}\`**`
          : ` · no hand label — watch whether it is stable across runs`),
    );
    say();

    say(
      `**Reply** — ${out.reply.split(/\s+/).length} words, ${cited.known} citation${cited.known === 1 ? "" : "s"}, ${secs}s` +
        (cited.unknown > 0 ? `, ⚠︎ ${cited.unknown} INVENTED id(s)` : "") +
        (placed.wrong > 0
          ? `, ⚠︎ ${placed.wrong}/${placed.checked} quote(s) NOT IN the block cited`
          : "") +
        (hit.length ? `, ⚠︎ banned: ${hit.join(", ")}` : "") +
        (c.poisoned
          ? namesTheDraft(out.reply)
            ? ", names the draft"
            : " — ⚠︎ **does not name the draft at all**"
          : ""),
    );
    say();
    say(out.reply.trim());
    say();
  }

  say("## Counts, which are not the answer");
  say();
  if (failed > 0) {
    say(
      `**${failed} of ${CASES.length} marking calls FAILED** — see FAILED above, one per case. ` +
        `Every count below covers only the ${marked} that came back; it says nothing about the ` +
        `${failed} that did not, and a 0 among them is not a pass.`,
    );
    say();
  }
  say(`- model: \`${model}\``);
  say(`- marks: ${marked} obtained / ${CASES.length} attempted`);
  say(`- containing a banned phrase: **${flagged}** of ${marked} (should be 0)`);
  say(`- citing an id this article does not have: **${invented}** of ${marked} (should be 0)`);
  say(
    `- quotations attributed to a block that does not contain them: **${misplaced}** of ` +
      `${checkedQuotes} checked (should be 0 — see \`misattributed\` in \`evals/quiz.ts\`)`,
  );
  say(`- citing no block at all: ${uncited} of ${marked} (worth a look, not a failure)`);
  /* **This one IS close to a verdict**, unlike the counts around it, and that is
     the difference between a judgement about tone and a judgement about a label
     somebody wrote down first. It still is not a gate: seven cases and a model
     that varies means one miss is worth reading rather than reacting to, and
     `poisonedReference` is worth more than the other six put together. */
  say(
    `- hidden verdict matching its hand label: **${verdictsAgreed}** of ${verdictsChecked} ` +
      `(the adaptive ladder steps on this — see \`expectVerdict\`)`,
  );
  if (verdictMisses.length) {
    say(`  - ⚠︎ ${verdictMisses.join("; ")}`);
  }
  say();
  if (marked === 0) {
    say(
      "Nothing was measured. Every count above is 0 of 0, which is not the same thing as clean — see the failures above.",
    );
  } else {
    say(
      "A zero in the first two means nothing on its own. The question these runs exist to answer is whether `poisonedReference` sided with the article — and whether `differentWords`, `elsewhere` and `moreComplete` were left alone. Only reading them says that.",
    );
  }

  /* Every marking call failing means the run produced no signal at all, so
     exiting 0 would say "clean" about a file that measured nothing — the same
     shape as the bug above, at the process boundary instead of in the text.
     A single failed call is different: the eval's own header records
     generation failing intermittently for a known, real reason (roughly one
     call in five), and a run with seven good replies out of eight still has
     something to read. Only complete failure trips the exit code. */
  if (doMark && CASES.length > 0 && marked === 0) {
    process.exitCode = 1;
  }

  await write(lines);
}

async function write(lines: string[]): Promise<void> {
  const out = path.resolve(import.meta.dirname, "results", "quiz.md");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${lines.join("\n")}\n`, "utf-8");
  console.log(`\nWritten to ${path.relative(process.cwd(), out)}`);
}

/* **`withLedger`, not a bare `main()`.** These calls already go through the
   gateway and are already metered — what they would lack is a collector, so
   every one would warn "no spend collector open" and leave no row. `"eval"` is
   the scope kind, so `npm run cost` can keep this out of the number Greg sets a
   price against while still counting it. */
await withLedger("eval", main);
