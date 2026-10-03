/**
 * **The requests, and what we say the right command is.** Not reader data.
 *
 * Four sets, all labelled before any arm of the 2026-10-03 run saw them:
 *
 * - `round1` (`p01`–`p46`) and `round2` (`h01`–`h26`): the 72 from plan 261002c
 *   Stage D, written 2026-10-02, **relabelled here against the bar's real ids**
 *   (src/command-pick-catalogue.generated.json). Where the right answer changed, not just its
 *   spelling, the `note` says so.
 * - `new` (`n01`–): written 2026-10-03 for plan 261003k Stage 1 by the agent
 *   that also wrote the prompts. Greg's two examples, sentences for each of the
 *   five argument kinds that the bar's verbs do not parse, dictated rambles,
 *   rows the first 72 never asked for, and requests with no right answer.
 * - `blind` (`b01`–`b40`): written by a separate Sonnet subagent that was shown
 *   only each row's id, name and one-line description — not the prompts, not
 *   the other phrases, no code. Its file is `blind.raw.json`, unedited; the
 *   two labels we changed are in `BLIND_RELABEL` below with the reason.
 *
 * `accept` lists every id counted as right; the first is the one we would have
 * built. `[NONE]` means nothing should run. A phrase whose right answer takes
 * an argument carries `argument` (and `argumentAlso` for other spellings we
 * would take); the pick is scored on the id, and the argument separately.
 *
 * **Three labelling rules, applied to every set alike:**
 *
 * 1. *Asking to delete the article* accepts `none` **or** the Metadata page.
 *    The bar itself gives that row the nickname `delete`, because that page is
 *    where the delete button is; going there deletes nothing. Archive stays
 *    wrong: it changes the shelf and is not what was asked.
 * 2. *A question about what the article says* ("why does the author think
 *    entropy matters") accepts `mode:chat` **or** `none`. Chat is the place to
 *    ask it, but opening Chat does not carry the question across, so `none`
 *    is an honest answer too. Nothing else is accepted.
 * 3. *Asking what a named term means* accepts `arg:glossary` first and
 *    `mode:glossary` second (the glossary without the term), as `h01` did in
 *    the first run. `arg:find` is not accepted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NONE } from "./catalogue.js";

export type PhraseSet = "round1" | "round2" | "new" | "blind";
export type PhraseStyle =
  | "greg"
  | "paraphrase"
  | "voice"
  | "typo"
  | "no-answer"
  | "hard"
  | "argument"
  | "content-question";

export interface Phrase {
  readonly id: string;
  readonly set: PhraseSet;
  readonly text: string;
  readonly accept: readonly string[];
  readonly argument?: string;
  readonly argumentAlso?: readonly string[];
  readonly style: PhraseStyle;
  /** Why the label is what it is, where that is not obvious. */
  readonly note?: string;
}

const META = "page:/read/a-piece/metadata";
const BRIEF = "submode:summary:brief";
const SIMPLE = "submode:summary:simple";
const FULLER = "submode:summary:fuller";
const QUIZ = "submode:remember:quiz";
const HIGH = "action:section-high-powered";
const SHARE = "action:section-access-sharing";
const PROCESSING = "action:section-ai-processing";
const FIND = "arg:find";
const JUMP = "arg:jump-first";
const GLOSS = "arg:glossary";
const TAG = "arg:tag-add";
const UNTAG = "arg:tag-remove";

type Hand = Omit<Phrase, "set">;

const OLD: readonly Hand[] = [
  /* Greg's own examples (docs/project/chat-llm-help-commands-vision.md). */
  {
    id: "p01",
    style: "greg",
    text: "add a tag of neuroscience to this paper",
    accept: [TAG],
    argument: "neuroscience",
    note: "Was `none` in the first run: tags did not exist then.",
  },
  { id: "p02", style: "greg", text: "do they talk about predictive coding?", accept: [FIND], argument: "predictive coding" },
  {
    id: "p03",
    style: "greg",
    text: "redo the glossary with the good model",
    accept: ["action:rerun-glossary", HIGH],
    note: "Two commands in one request (switch on, then re-run); either half counts.",
  },
  {
    id: "p04",
    style: "greg",
    text: "reprocess the glossary with more powerful AI",
    accept: ["action:rerun-glossary", HIGH],
    note: "As p03.",
  },

  { id: "p05", style: "paraphrase", text: "show me the glossary", accept: ["mode:glossary"] },
  { id: "p06", style: "paraphrase", text: "what do the technical words in this mean", accept: ["mode:glossary"] },
  { id: "p07", style: "paraphrase", text: "give me a quick summary", accept: [BRIEF, "mode:summary"] },
  { id: "p08", style: "paraphrase", text: "explain it like I'm five", accept: [BRIEF, SIMPLE, "mode:summary"] },
  {
    id: "p09",
    style: "paraphrase",
    text: "draw me a picture of the argument",
    accept: ["mode:diagram", "submode:diagram:sketch", "submode:diagram:illustrated"],
    note: "Illustrated added: the real list has it, and it is a picture of the argument.",
  },
  { id: "p10", style: "paraphrase", text: "quiz me on this", accept: [QUIZ] },
  {
    id: "p11",
    style: "paraphrase",
    text: "test whether I understood it",
    accept: [QUIZ, "mode:remember", "submode:remember:recall", "submode:remember:tutorial"],
    note: "Recall and Tutorial added: the hand copy left them out, and each tests understanding.",
  },
  { id: "p12", style: "paraphrase", text: "what do other people think of this paper", accept: ["mode:debate"] },
  { id: "p13", style: "paraphrase", text: "show me the references", accept: ["mode:citations"] },
  {
    id: "p14",
    style: "paraphrase",
    text: "table of contents",
    accept: ["mode:structure", "submode:structure:expanded", "submode:structure:fisheye"],
    note: "The two Structure sub-modes added; the hand copy did not have them.",
  },
  { id: "p15", style: "paraphrase", text: "turn this into a twitter thread", accept: ["mode:tweets"] },
  { id: "p16", style: "paraphrase", text: "what are the best lines in it", accept: ["mode:quotes"] },
  { id: "p17", style: "paraphrase", text: "when did all of this happen", accept: ["mode:timeline"] },
  { id: "p18", style: "paraphrase", text: "what is the author taking for granted", accept: ["mode:ideas"] },
  { id: "p19", style: "paraphrase", text: "I'm peer reviewing this for a journal", accept: ["mode:referee"] },
  { id: "p20", style: "paraphrase", text: "does the paper deliver what it promises", accept: ["submode:referee:claims"] },
  { id: "p21", style: "paraphrase", text: "take me back to my articles", accept: ["page:/"] },
  { id: "p22", style: "paraphrase", text: "change my account settings", accept: ["page:/profile"] },
  { id: "p23", style: "paraphrase", text: "make this article public so a colleague can read it", accept: [SHARE] },
  { id: "p24", style: "paraphrase", text: "download a copy of everything for this article", accept: ["action:export"] },
  { id: "p25", style: "paraphrase", text: "get this off my shelf", accept: ["action:archive"] },
  { id: "p26", style: "paraphrase", text: "I want to report a bug", accept: ["action:feedback"] },
  { id: "p27", style: "paraphrase", text: "show my bookmarks", accept: ["action:comments"] },
  { id: "p28", style: "paraphrase", text: "how long will this take to read", accept: [META] },
  { id: "p29", style: "paraphrase", text: "regenerate the timeline", accept: ["action:rerun-timeline"] },
  { id: "p30", style: "paraphrase", text: "the quotes are rubbish, have another go", accept: ["action:rerun-quotes"] },
  { id: "p31", style: "paraphrase", text: "use a better model for this article", accept: [HIGH] },
  { id: "p32", style: "paraphrase", text: "find mentions of dopamine", accept: [FIND], argument: "dopamine" },
  { id: "p33", style: "paraphrase", text: "search for free energy principle", accept: [FIND], argument: "free energy principle" },
  { id: "p34", style: "paraphrase", text: "does it mention Friston", accept: [FIND], argument: "Friston" },

  { id: "p35", style: "voice", text: "um can you like open the summary thing", accept: ["mode:summary"] },
  { id: "p36", style: "voice", text: "okay go back to just the text", accept: ["mode:plain"] },
  { id: "p37", style: "voice", text: "hey so I've got a question about section three", accept: ["mode:chat"] },
  {
    id: "p38",
    style: "voice",
    text: "where in this do they talk about uh working memory",
    accept: [FIND, JUMP],
    argument: "working memory",
    note: "Jump-first added: it did not exist in the first run and it answers `where`.",
  },

  { id: "p39", style: "typo", text: "glosary", accept: ["mode:glossary"] },
  { id: "p40", style: "typo", text: "shwo me the timline", accept: ["mode:timeline"] },
  { id: "p41", style: "typo", text: "regenrate the faq", accept: ["action:rerun-faq"] },

  {
    id: "p42",
    style: "no-answer",
    text: "delete this article",
    accept: [NONE, META],
    note: "Rule 1. Was `none` only in the first run.",
  },
  { id: "p43", style: "no-answer", text: "what's the weather tomorrow", accept: [NONE] },
  { id: "p44", style: "no-answer", text: "translate this into French", accept: [NONE] },
  { id: "p45", style: "no-answer", text: "email this to my boss", accept: [NONE] },
  { id: "p46", style: "no-answer", text: "remind me to finish this tomorrow", accept: [NONE] },

  /* Round 2 of the first run: written to sit between near-neighbour rows. */
  {
    id: "h01",
    style: "hard",
    text: "show me where they define entropy",
    accept: [FIND, JUMP, GLOSS, "mode:glossary"],
    argument: "entropy",
    note: "Jump-first and the glossary look-up added; both now exist and both answer it.",
  },
  { id: "h02", style: "hard", text: "the summary is too long", accept: [BRIEF] },
  { id: "h03", style: "hard", text: "this summary is too dumbed down", accept: [FULLER] },
  { id: "h04", style: "hard", text: "make the sketch prettier", accept: ["submode:diagram:illustrated"] },
  { id: "h05", style: "hard", text: "who has responded to this online", accept: ["mode:debate"] },
  { id: "h06", style: "hard", text: "what papers does this build on", accept: ["mode:citations"] },
  { id: "h07", style: "hard", text: "redo the thread", accept: ["action:rerun-tweets"] },
  { id: "h08", style: "hard", text: "the cross references look wrong, make them again", accept: ["action:rerun-crossrefs"] },
  { id: "h09", style: "hard", text: "make this private again", accept: [SHARE] },
  { id: "h10", style: "hard", text: "I'm done with this one", accept: ["action:archive", "page:/"] },
  { id: "h11", style: "hard", text: "how much am I paying for this", accept: ["page:/profile"] },
  { id: "h12", style: "hard", text: "where was this originally published", accept: [META] },
  { id: "h13", style: "hard", text: "add a note to this paragraph", accept: ["action:comments"] },
  { id: "h14", style: "hard", text: "read it aloud to me", accept: [NONE], note: "No read-aloud command in the bar." },
  { id: "h15", style: "hard", text: "compare this with the paper I read yesterday", accept: [NONE] },
  {
    id: "h16",
    style: "hard",
    text: "highlight the bit about consciousness",
    accept: [FIND, JUMP],
    argument: "consciousness",
    note: "The Search mode without the words stays wrong, as in the first run.",
  },
  { id: "h17", style: "hard", text: "open the margin notes", accept: ["mode:marginalia"] },
  { id: "h18", style: "hard", text: "skim it for me", accept: ["mode:skim"] },
  {
    id: "h19",
    style: "hard",
    text: "regenerate everything for this article",
    accept: [PROCESSING, META],
    note: "Was `none`: the bar now has the AI processing row, nicknamed `regenerate everything`. It opens the section; it runs nothing.",
  },
  { id: "h20", style: "hard", text: "make the glossary again but better", accept: ["action:rerun-glossary", HIGH] },
  { id: "h21", style: "hard", text: "go to the articles other people have shared", accept: ["page:/read/public"] },
  { id: "h22", style: "hard", text: "buy more articles", accept: ["page:/profile"] },
  { id: "h23", style: "hard", text: "print this", accept: [NONE] },
  { id: "h24", style: "hard", text: "what dates are mentioned", accept: ["mode:timeline"] },
  { id: "h25", style: "hard", text: "summarise section two for me", accept: ["mode:chat", "mode:summary", "mode:structure"] },
  { id: "h26", style: "hard", text: "turn on dark mode", accept: [NONE], note: "No such setting in the list." },
];

const NEW: readonly Hand[] = [
  /* Greg's two, spya-t0dg9u. */
  { id: "n01", style: "greg", text: "I want to see what's changed on this site since yesterday", accept: ["page:/changelog"] },
  { id: "n02", style: "greg", text: "search for predictive processing", accept: [FIND], argument: "predictive processing" },

  /* Find: sentences the verb table does not parse. */
  { id: "n03", style: "argument", text: "is consciousness mentioned anywhere", accept: [FIND], argument: "consciousness" },
  { id: "n04", style: "argument", text: "show me every place they bring up the hippocampus", accept: [FIND], argument: "hippocampus", argumentAlso: ["the hippocampus"] },
  { id: "n05", style: "argument", text: "are there any bits about reward prediction error", accept: [FIND], argument: "reward prediction error" },
  { id: "n06", style: "argument", text: "I'm looking for the part on sleep spindles", accept: [FIND, JUMP], argument: "sleep spindles" },
  { id: "n07", style: "argument", text: "anything in here on Bayesian inference", accept: [FIND], argument: "Bayesian inference" },
  { id: "n08", style: "argument", text: "can you look for the word homeostasis", accept: [FIND], argument: "homeostasis" },

  /* Jump to first. */
  { id: "n09", style: "argument", text: "where do they first bring up dopamine", accept: [JUMP], argument: "dopamine" },
  { id: "n10", style: "argument", text: "take me to the first time it mentions Karl Friston", accept: [JUMP], argument: "Karl Friston" },
  { id: "n11", style: "argument", text: "go to where free energy first comes up", accept: [JUMP], argument: "free energy" },
  { id: "n12", style: "argument", text: "when does the author first talk about attention", accept: [JUMP], argument: "attention" },
  { id: "n13", style: "argument", text: "skip to the earliest mention of surprise", accept: [JUMP], argument: "surprise" },

  /* Glossary (rule 3). */
  { id: "n14", style: "argument", text: "what's a Markov blanket", accept: [GLOSS, "mode:glossary"], argument: "Markov blanket", argumentAlso: ["a Markov blanket"] },
  { id: "n15", style: "argument", text: "I don't know what variational free energy is", accept: [GLOSS, "mode:glossary"], argument: "variational free energy" },
  { id: "n16", style: "argument", text: "remind me what precision weighting means here", accept: [GLOSS, "mode:glossary"], argument: "precision weighting" },
  { id: "n17", style: "argument", text: "explain the term active inference", accept: [GLOSS, "mode:glossary"], argument: "active inference" },
  { id: "n18", style: "argument", text: "what do they mean by generative model", accept: [GLOSS, "mode:glossary"], argument: "generative model" },
  { id: "n19", style: "argument", text: "meaning of allostasis", accept: [GLOSS, "mode:glossary"], argument: "allostasis" },

  /* Add a tag. */
  { id: "n20", style: "argument", text: "file this under neuroscience", accept: [TAG], argument: "neuroscience" },
  { id: "n21", style: "argument", text: "label it machine learning", accept: [TAG], argument: "machine learning" },
  { id: "n22", style: "argument", text: "mark this one as to read", accept: [TAG], argument: "to read" },
  { id: "n23", style: "argument", text: "stick a philosophy tag on this", accept: [TAG], argument: "philosophy" },
  { id: "n24", style: "argument", text: "this is a methods paper, tag it that way", accept: [TAG], argument: "methods", argumentAlso: ["methods paper"] },

  /* Remove a tag. */
  { id: "n25", style: "argument", text: "take the tag draft off", accept: [UNTAG], argument: "draft" },
  { id: "n26", style: "argument", text: "this isn't about psychology, lose that tag", accept: [UNTAG], argument: "psychology" },
  { id: "n27", style: "argument", text: "drop the to read label", accept: [UNTAG], argument: "to read" },
  { id: "n28", style: "argument", text: "get rid of the neuroscience tag", accept: [UNTAG], argument: "neuroscience" },
  { id: "n29", style: "argument", text: "it shouldn't be tagged urgent any more", accept: [UNTAG], argument: "urgent" },

  /* Dictated rambles. */
  { id: "n30", style: "voice", text: "um so can you like show me the the summary but the short one", accept: [BRIEF, "mode:summary"] },
  { id: "n31", style: "voice", text: "okay uh I think I want to I want to see the the timeline thing", accept: ["mode:timeline"] },
  { id: "n32", style: "voice", text: "right so where where does it uh mention the the cerebellum", accept: [FIND, JUMP], argument: "cerebellum", argumentAlso: ["the cerebellum"] },
  { id: "n33", style: "voice", text: "hmm can we go back to to the the library please", accept: ["page:/"] },
  { id: "n34", style: "voice", text: "so like what's what's new in the app lately", accept: ["page:/changelog"] },
  { id: "n35", style: "voice", text: "er could you do the the quiz again no sorry make a new quiz", accept: ["action:rerun-quiz"] },
  { id: "n36", style: "voice", text: "I I want to um tell you about a bug I found", accept: ["action:feedback"] },
  { id: "n37", style: "voice", text: "yeah so tag this as as um reinforcement learning", accept: [TAG], argument: "reinforcement learning" },
  { id: "n38", style: "voice", text: "uh what does what does um epistemic value mean", accept: [GLOSS, "mode:glossary"], argument: "epistemic value" },
  { id: "n39", style: "voice", text: "let me see who's who's cited in this", accept: ["mode:citations"] },

  /* Rows the first 72 never asked for. */
  { id: "n40", style: "paraphrase", text: "how does this app work", accept: ["page:/help"] },
  { id: "n41", style: "paraphrase", text: "I'm stuck, is there a manual", accept: ["page:/help"] },
  { id: "n42", style: "paraphrase", text: "hide the unfinished features", accept: ["action:experimental"] },
  { id: "n43", style: "paraphrase", text: "show me other people's articles", accept: ["page:/read/public"] },
  { id: "n44", style: "paraphrase", text: "who would be a good reviewer for this", accept: ["submode:referee:candidates"] },
  { id: "n45", style: "paraphrase", text: "check my review comments for tone", accept: ["submode:referee:mirror", "mode:referee"] },
  { id: "n46", style: "paraphrase", text: "what questions would a sceptic ask about this", accept: ["mode:faq"] },
  { id: "n47", style: "paraphrase", text: "walk me through it a bit at a time and ask me things", accept: ["submode:remember:tutorial", "mode:remember"] },
  { id: "n48", style: "paraphrase", text: "I want to write down what I remember and see if I got it right", accept: ["submode:remember:recall", "mode:remember"] },
  { id: "n49", style: "paraphrase", text: "upgrade my plan", accept: ["page:/profile"] },
  { id: "n50", style: "paraphrase", text: "back up this article to my computer", accept: ["action:export"] },
  { id: "n51", style: "paraphrase", text: "see all the sections with their summaries", accept: ["submode:structure:expanded", "mode:structure"] },
  { id: "n52", style: "paraphrase", text: "run the debate again", accept: ["action:rerun-debate"] },
  {
    id: "n53",
    style: "paraphrase",
    text: "start again from scratch on this article",
    accept: [PROCESSING, META],
    note: "As h19: the row opens the section where that is done.",
  },

  /* Publishing: the bar's row opens Access & sharing; it publishes nothing. */
  { id: "n54", style: "hard", text: "make this public", accept: [SHARE], note: "The right row, and it only opens the section — the reader presses the switch." },
  { id: "n55", style: "hard", text: "share this with everyone right now", accept: [SHARE] },
  { id: "n56", style: "hard", text: "remove this from the public shelf", accept: [SHARE] },
  { id: "n57", style: "hard", text: "cancel my subscription", accept: ["page:/profile"], note: "Profile is `Your account, your plan`, nicknamed `billing`." },

  /* Questions about the article's content, not commands (rule 2). */
  { id: "n58", style: "content-question", text: "why does the author think entropy matters", accept: ["mode:chat", NONE] },
  { id: "n59", style: "content-question", text: "what is the main argument of section 4", accept: ["mode:chat", NONE] },
  { id: "n60", style: "content-question", text: "do you agree with the conclusion", accept: ["mode:chat", NONE] },

  /* No right answer. */
  { id: "n61", style: "no-answer", text: "delete my account", accept: [NONE, "page:/profile"], note: "Rule 1's twin: Profile is where the account is; going there deletes nothing." },
  { id: "n62", style: "no-answer", text: "erase all my notes", accept: [NONE] },
  { id: "n63", style: "no-answer", text: "sign me out", accept: [NONE], note: "Deliberately not in the bar (CommandBar.tsx § What is deliberately not here)." },
  { id: "n64", style: "no-answer", text: "make the text bigger", accept: [NONE] },
  { id: "n65", style: "no-answer", text: "send this to my kindle", accept: [NONE] },
  { id: "n66", style: "no-answer", text: "play some music", accept: [NONE] },
  { id: "n67", style: "no-answer", text: "add this to my calendar", accept: [NONE] },
  { id: "n68", style: "no-answer", text: "undo", accept: [NONE] },
  { id: "n69", style: "no-answer", text: "merge this with my other article", accept: [NONE] },
  { id: "n70", style: "no-answer", text: "asdf jkl", accept: [NONE] },
  { id: "n71", style: "no-answer", text: "thanks that's all", accept: [NONE] },
  { id: "n72", style: "no-answer", text: "archive everything on my shelf", accept: [NONE], note: "Archive acts on this article only; picking it would archive the wrong thing." },

  /* **Destructive-sounding, with a near neighbour in the list** (GPT Sol's F6
     on the plan: "nothing risky picked for a none" is vacuous unless a risky
     row is there to be picked). Added after the first pass of calls was made
     and before any answer was scored or read; every arm was then run on them. */
  { id: "n73", style: "no-answer", text: "delete the glossary", accept: [NONE], note: "Near neighbour: Glossary › Run again." },
  { id: "n74", style: "no-answer", text: "throw away the quiz and don't make another", accept: [NONE], note: "Near neighbour: Quiz › Run again." },
  { id: "n75", style: "no-answer", text: "make all my articles public", accept: [NONE], note: "Near neighbour: Share this article, which is about this one only." },
  { id: "n76", style: "no-answer", text: "run everything again on every article I have", accept: [NONE], note: "Near neighbours: AI processing, the Run again rows." },
  { id: "n77", style: "no-answer", text: "archive this for good so it can never come back", accept: [NONE], note: "Near neighbour: Archive, which is reversible and says so." },
  { id: "n78", style: "no-answer", text: "regenerate the timeline for all my papers", accept: [NONE], note: "Near neighbour: Timeline › Run again, this article only." },
  { id: "n79", style: "no-answer", text: "remove every tag from everything", accept: [NONE], note: "Near neighbour: Remove a tag." },
  { id: "n80", style: "no-answer", text: "stop sharing all of my articles", accept: [NONE], note: "Near neighbour: Share this article." },
];

/* ------------------------------------------------------------- the blind set -- */

interface BlindRaw {
  text: string;
  id: string;
  also: string[];
  argument: string | null;
  style: "typed" | "spoken" | "typo";
}

/**
 * **Where our label differs from the blind writer's**, decided on reading its
 * file and before any arm ran. Each is one of the three rules above; nothing
 * else was changed, and its `also` lists were kept as written.
 */
const BLIND_RELABEL: Readonly<Record<string, { accept: readonly string[]; why: string }>> = {
  b35: { accept: [NONE, META], why: "Rule 1: `permanently delete this article…` — writer said `none` only." },
  b39: {
    accept: [NONE, "page:/profile"],
    why: "As n61: `cancel my subscription, actually no, delete my account` — writer said `none` only.",
  },
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BLIND: readonly Phrase[] = (JSON.parse(readFileSync(path.join(HERE, "blind.raw.json"), "utf8")) as BlindRaw[]).map(
  (raw, i): Phrase => {
    const id = `b${String(i + 1).padStart(2, "0")}`;
    const relabel = BLIND_RELABEL[id];
    return {
      id,
      set: "blind",
      text: raw.text,
      accept: relabel?.accept ?? [raw.id, ...raw.also],
      ...(raw.argument ? { argument: raw.argument } : {}),
      style: raw.id === NONE ? "no-answer" : raw.argument ? "argument" : raw.style === "typo" ? "typo" : raw.style === "spoken" ? "voice" : "paraphrase",
      ...(relabel ? { note: relabel.why } : {}),
    };
  },
);

export const PHRASES: readonly Phrase[] = [
  ...OLD.map((p): Phrase => ({ ...p, set: p.id.startsWith("p") ? "round1" : "round2" })),
  ...NEW.map((p): Phrase => ({ ...p, set: "new" })),
  ...BLIND,
];

/** The right answer is an argument command (the first accepted id). */
export const wantsArgument = (p: Phrase): boolean => p.argument !== undefined;
/** Nothing should run: `none` is the first accepted id. */
export const wantsNone = (p: Phrase): boolean => p.accept[0] === NONE;
