/**
 * **The requests, and what we say the right command is** — written and
 * labelled by us (the agent running plan 261002c Stage D), 2026-10-02, before
 * any model saw them. Not reader data.
 *
 * `accept` lists every id we would count as right; the first is the one we
 * would have built. `[NONE]` means nothing in the catalogue should run. A find
 * case carries `argument`, the words we expect pulled out; a pick of
 * `action:find` is scored on the id alone, and the argument separately.
 */
import { NONE } from "./catalogue.js";

export type PhraseStyle = "greg" | "paraphrase" | "voice" | "typo" | "no-answer" | "hard";

export interface Phrase {
  readonly id: string;
  readonly text: string;
  readonly accept: readonly string[];
  readonly argument?: string;
  readonly style: PhraseStyle;
  /** Why the label is what it is, where that is not obvious. */
  readonly note?: string;
}

export const PHRASES: readonly Phrase[] = [
  /* Greg's own examples (docs/project/chat-llm-help-commands-vision.md). */
  { id: "p01", style: "greg", text: "add a tag of neuroscience to this paper", accept: [NONE], note: "Tags do not exist." },
  { id: "p02", style: "greg", text: "do they talk about predictive coding?", accept: ["action:find"], argument: "predictive coding" },
  {
    id: "p03",
    style: "greg",
    text: "redo the glossary with the good model",
    accept: ["rerun:glossary", "section:high-powered-ai"],
    note: "Two commands in one request (switch on, then re-run); either half counts.",
  },
  {
    id: "p04",
    style: "greg",
    text: "reprocess the glossary with more powerful AI",
    accept: ["rerun:glossary", "section:high-powered-ai"],
    note: "As p03.",
  },

  { id: "p05", style: "paraphrase", text: "show me the glossary", accept: ["mode:glossary"] },
  { id: "p06", style: "paraphrase", text: "what do the technical words in this mean", accept: ["mode:glossary"] },
  { id: "p07", style: "paraphrase", text: "give me a quick summary", accept: ["sub:summary-brief", "mode:summary"] },
  { id: "p08", style: "paraphrase", text: "explain it like I'm five", accept: ["sub:summary-brief", "sub:summary-simple", "mode:summary"] },
  { id: "p09", style: "paraphrase", text: "draw me a picture of the argument", accept: ["mode:diagram", "sub:diagram-sketch"] },
  { id: "p10", style: "paraphrase", text: "quiz me on this", accept: ["sub:remember-quiz"] },
  { id: "p11", style: "paraphrase", text: "test whether I understood it", accept: ["sub:remember-quiz", "mode:remember"] },
  { id: "p12", style: "paraphrase", text: "what do other people think of this paper", accept: ["mode:debate"] },
  { id: "p13", style: "paraphrase", text: "show me the references", accept: ["mode:citations"] },
  { id: "p14", style: "paraphrase", text: "table of contents", accept: ["mode:structure"] },
  { id: "p15", style: "paraphrase", text: "turn this into a twitter thread", accept: ["mode:tweets"] },
  { id: "p16", style: "paraphrase", text: "what are the best lines in it", accept: ["mode:quotes"] },
  { id: "p17", style: "paraphrase", text: "when did all of this happen", accept: ["mode:timeline"] },
  { id: "p18", style: "paraphrase", text: "what is the author taking for granted", accept: ["mode:ideas"] },
  { id: "p19", style: "paraphrase", text: "I'm peer reviewing this for a journal", accept: ["mode:referee"] },
  { id: "p20", style: "paraphrase", text: "does the paper deliver what it promises", accept: ["sub:referee-claims"] },
  { id: "p21", style: "paraphrase", text: "take me back to my articles", accept: ["page:library"] },
  { id: "p22", style: "paraphrase", text: "change my account settings", accept: ["page:profile"] },
  { id: "p23", style: "paraphrase", text: "make this article public so a colleague can read it", accept: ["section:access-sharing"] },
  { id: "p24", style: "paraphrase", text: "download a copy of everything for this article", accept: ["action:export"] },
  { id: "p25", style: "paraphrase", text: "get this off my shelf", accept: ["action:archive"] },
  { id: "p26", style: "paraphrase", text: "I want to report a bug", accept: ["action:feedback"] },
  { id: "p27", style: "paraphrase", text: "show my bookmarks", accept: ["action:comments"] },
  { id: "p28", style: "paraphrase", text: "how long will this take to read", accept: ["page:metadata"] },
  { id: "p29", style: "paraphrase", text: "regenerate the timeline", accept: ["rerun:timeline"] },
  { id: "p30", style: "paraphrase", text: "the quotes are rubbish, have another go", accept: ["rerun:quotes"] },
  { id: "p31", style: "paraphrase", text: "use a better model for this article", accept: ["section:high-powered-ai"] },
  { id: "p32", style: "paraphrase", text: "find mentions of dopamine", accept: ["action:find"], argument: "dopamine" },
  { id: "p33", style: "paraphrase", text: "search for free energy principle", accept: ["action:find"], argument: "free energy principle" },
  { id: "p34", style: "paraphrase", text: "does it mention Friston", accept: ["action:find"], argument: "Friston" },

  { id: "p35", style: "voice", text: "um can you like open the summary thing", accept: ["mode:summary"] },
  { id: "p36", style: "voice", text: "okay go back to just the text", accept: ["mode:plain"] },
  {
    id: "p37",
    style: "voice",
    text: "hey so I've got a question about section three",
    accept: ["mode:chat"],
  },
  {
    id: "p38",
    style: "voice",
    text: "where in this do they talk about uh working memory",
    accept: ["action:find"],
    argument: "working memory",
  },

  { id: "p39", style: "typo", text: "glosary", accept: ["mode:glossary"] },
  { id: "p40", style: "typo", text: "shwo me the timline", accept: ["mode:timeline"] },
  { id: "p41", style: "typo", text: "regenrate the faq", accept: ["rerun:faq"] },

  { id: "p42", style: "no-answer", text: "delete this article", accept: [NONE], note: "Deliberately not a command (plan 261002c § Deliberately not)." },
  { id: "p43", style: "no-answer", text: "what's the weather tomorrow", accept: [NONE] },
  { id: "p44", style: "no-answer", text: "translate this into French", accept: [NONE] },
  { id: "p45", style: "no-answer", text: "email this to my boss", accept: [NONE] },
  { id: "p46", style: "no-answer", text: "remind me to finish this tomorrow", accept: [NONE] },

  /* **Round 2, added after round 1 came back at the ceiling** (Jev 46/46),
     which left its confidence nothing wrong to be calibrated against. These
     were written to sit between near-neighbour rows — sub-mode vs mode, mode vs
     re-run, a near miss to a command that does not exist — and labelled before
     either arm saw them. Not predeclared in the plan; the write-up says so. */
  { id: "h01", style: "hard", text: "show me where they define entropy", accept: ["action:find", "mode:glossary"], argument: "entropy" },
  { id: "h02", style: "hard", text: "the summary is too long", accept: ["sub:summary-brief"] },
  { id: "h03", style: "hard", text: "this summary is too dumbed down", accept: ["sub:summary-fuller"] },
  { id: "h04", style: "hard", text: "make the sketch prettier", accept: ["sub:diagram-illustrated"] },
  { id: "h05", style: "hard", text: "who has responded to this online", accept: ["mode:debate"] },
  { id: "h06", style: "hard", text: "what papers does this build on", accept: ["mode:citations"] },
  { id: "h07", style: "hard", text: "redo the thread", accept: ["rerun:tweets"] },
  { id: "h08", style: "hard", text: "the cross references look wrong, make them again", accept: ["rerun:crossrefs"] },
  { id: "h09", style: "hard", text: "make this private again", accept: ["section:access-sharing"] },
  { id: "h10", style: "hard", text: "I'm done with this one", accept: ["action:archive", "page:library"] },
  { id: "h11", style: "hard", text: "how much am I paying for this", accept: ["page:profile"] },
  { id: "h12", style: "hard", text: "where was this originally published", accept: ["page:metadata"] },
  { id: "h13", style: "hard", text: "add a note to this paragraph", accept: ["action:comments"] },
  { id: "h14", style: "hard", text: "read it aloud to me", accept: [NONE], note: "No read-aloud command in the bar." },
  { id: "h15", style: "hard", text: "compare this with the paper I read yesterday", accept: [NONE] },
  { id: "h16", style: "hard", text: "highlight the bit about consciousness", accept: ["action:find"], argument: "consciousness" },
  { id: "h17", style: "hard", text: "open the margin notes", accept: ["mode:marginalia"] },
  { id: "h18", style: "hard", text: "skim it for me", accept: ["mode:skim"] },
  { id: "h19", style: "hard", text: "regenerate everything for this article", accept: [NONE], note: "No single command; Start-again is deliberately not in the bar." },
  { id: "h20", style: "hard", text: "make the glossary again but better", accept: ["rerun:glossary", "section:high-powered-ai"] },
  { id: "h21", style: "hard", text: "go to the articles other people have shared", accept: ["page:public-shelf"] },
  { id: "h22", style: "hard", text: "buy more articles", accept: ["page:profile"] },
  { id: "h23", style: "hard", text: "print this", accept: [NONE] },
  { id: "h24", style: "hard", text: "what dates are mentioned", accept: ["mode:timeline"] },
  { id: "h25", style: "hard", text: "summarise section two for me", accept: ["mode:chat", "mode:summary", "mode:structure"] },
  { id: "h26", style: "hard", text: "turn on dark mode", accept: [NONE], note: "No such setting in the catalogue." },
];
