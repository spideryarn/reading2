/**
 * **Every Help page's Markdown file, by the anchor it is the page for.**
 *
 * One Markdown file per anchor under src/web/help/pages/: a topic at the top, a
 * mode under `modes/`, a question under `questions/`, a guide under `guides/`.
 * This file imports each with Vite's `?raw`, as ChangelogPage.tsx does its
 * data, and reads the front matter. No React here: the renderer is
 * help-markdown.tsx.
 * docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md
 * § The Markdown, and how it becomes a page.
 *
 * ## Every import written out, and not `import.meta.glob`
 *
 * The four tables are `Record<HelpTopic, …>`, `Record<Mode, …>`,
 * `Record<FaqId, …>` and `Record<HelpGuide, …>`, with every key and every
 * import explicit. That is the
 * point of them: **a new mode with no Help file is a type error** here, the
 * same guard `HELP_MODES` gave when the words were TSX. A glob would find
 * whatever files happen to exist and say nothing about the one that does not.
 * (A key with an import whose file is missing is not a type error; it fails
 * the build and every test that loads this file.)
 *
 * ## Beside the code, not under `docs/`
 *
 * For ChangelogPage.tsx's reason: `.vercelignore` prunes `docs/` from the
 * upload, so an import into it builds everywhere except Vercel.
 */
import { MODES, type Mode } from "../../modes.js";
import {
  FAQ_IDS,
  HELP_GUIDE_IDS,
  HELP_TOPIC_IDS,
  helpAnchorKind,
  resolveHelpAnchor,
  type FaqId,
  type HelpAnchor,
  type HelpGuide,
  type HelpTopic,
} from "./help-anchors.js";
import { readFrontMatter, splitList } from "./help-front-matter.js";

import whatItIsForMd from "./pages/what-it-is-for.md?raw";
import addingArticlesMd from "./pages/adding-articles.md?raw";
import theReadingViewMd from "./pages/the-reading-view.md?raw";
import spineMd from "./pages/spine.md?raw";
import jumpingAroundMd from "./pages/jumping-around.md?raw";
import gutterMd from "./pages/gutter.md?raw";
import linkingToAPassageMd from "./pages/linking-to-a-passage.md?raw";
import keyboardMd from "./pages/keyboard.md?raw";
import touchMd from "./pages/touch.md?raw";
import aiWordsMd from "./pages/ai-words.md?raw";
import waitingAndCostMd from "./pages/waiting-and-cost.md?raw";
import modesMd from "./pages/modes.md?raw";
import shelfMd from "./pages/shelf.md?raw";
import sharingMd from "./pages/sharing.md?raw";
import commentsMd from "./pages/comments.md?raw";
import readerProfileMd from "./pages/reader-profile.md?raw";
import experimentalFeaturesMd from "./pages/experimental-features.md?raw";
import plansMd from "./pages/plans.md?raw";
import yourDataMd from "./pages/your-data.md?raw";
import feedbackMd from "./pages/feedback.md?raw";
import whatsNewMd from "./pages/whats-new.md?raw";
import modePlainMd from "./pages/modes/plain.md?raw";
import modeChatMd from "./pages/modes/chat.md?raw";
import modeGlossaryMd from "./pages/modes/glossary.md?raw";
import modeSearchMd from "./pages/modes/search.md?raw";
import modeRefereeMd from "./pages/modes/referee.md?raw";
import modeSummaryMd from "./pages/modes/summary.md?raw";
import modeDiagramMd from "./pages/modes/diagram.md?raw";
import modeIdeasMd from "./pages/modes/ideas.md?raw";
import modeLearnMd from "./pages/modes/learn.md?raw";
import modeQuotesMd from "./pages/modes/quotes.md?raw";
import modeTimelineMd from "./pages/modes/timeline.md?raw";
import modeDebateMd from "./pages/modes/debate.md?raw";
import modeStructureMd from "./pages/modes/structure.md?raw";
import modeCitationsMd from "./pages/modes/citations.md?raw";
import modeFaqMd from "./pages/modes/faq.md?raw";
import modeSkimMd from "./pages/modes/skim.md?raw";
import modeMarginaliaMd from "./pages/modes/marginalia.md?raw";
import faqIsTheAiReadingForMeMd from "./pages/questions/faq-is-the-ai-reading-for-me.md?raw";
import faqWhySlowFirstTimeMd from "./pages/questions/faq-why-slow-first-time.md?raw";
import faqDoesAModeUseMyAllowanceMd from "./pages/questions/faq-does-a-mode-use-my-allowance.md?raw";
import faqMissingPartsMd from "./pages/questions/faq-missing-parts.md?raw";
import faqBeyondTheArticleMd from "./pages/questions/faq-beyond-the-article.md?raw";
import faqOlderProfileMd from "./pages/questions/faq-older-profile.md?raw";
import faqFindArchivedMd from "./pages/questions/faq-find-archived.md?raw";
import faqSharedPersonalisedMd from "./pages/questions/faq-shared-personalised.md?raw";
import guideFirstArticleMd from "./pages/guides/first-article.md?raw";
import guideForStudentsMd from "./pages/guides/for-students.md?raw";
import guideForReviewersMd from "./pages/guides/for-reviewers.md?raw";
import guideForExpertsMd from "./pages/guides/for-experts.md?raw";

/** The topics' files, as written. Total over `HelpTopic`. */
export const HELP_TOPIC_FILES: Record<HelpTopic, string> = {
  "what-it-is-for": whatItIsForMd,
  "adding-articles": addingArticlesMd,
  "the-reading-view": theReadingViewMd,
  spine: spineMd,
  "jumping-around": jumpingAroundMd,
  gutter: gutterMd,
  "linking-to-a-passage": linkingToAPassageMd,
  keyboard: keyboardMd,
  touch: touchMd,
  "ai-words": aiWordsMd,
  "waiting-and-cost": waitingAndCostMd,
  modes: modesMd,
  shelf: shelfMd,
  sharing: sharingMd,
  comments: commentsMd,
  "reader-profile": readerProfileMd,
  "experimental-features": experimentalFeaturesMd,
  plans: plansMd,
  "your-data": yourDataMd,
  feedback: feedbackMd,
  "whats-new": whatsNewMd,
};

/** The modes' files, as written. Total over `Mode`: a new mode needs one. */
export const HELP_MODE_FILES: Record<Mode, string> = {
  plain: modePlainMd,
  chat: modeChatMd,
  glossary: modeGlossaryMd,
  search: modeSearchMd,
  referee: modeRefereeMd,
  summary: modeSummaryMd,
  diagram: modeDiagramMd,
  ideas: modeIdeasMd,
  learn: modeLearnMd,
  quotes: modeQuotesMd,
  timeline: modeTimelineMd,
  debate: modeDebateMd,
  structure: modeStructureMd,
  citations: modeCitationsMd,
  faq: modeFaqMd,
  skim: modeSkimMd,
  marginalia: modeMarginaliaMd,
};

/** The questions' files, as written. Total over `FaqId`. */
export const HELP_FAQ_FILES: Record<FaqId, string> = {
  "faq-is-the-ai-reading-for-me": faqIsTheAiReadingForMeMd,
  "faq-why-slow-first-time": faqWhySlowFirstTimeMd,
  "faq-does-a-mode-use-my-allowance": faqDoesAModeUseMyAllowanceMd,
  "faq-missing-parts": faqMissingPartsMd,
  "faq-beyond-the-article": faqBeyondTheArticleMd,
  "faq-older-profile": faqOlderProfileMd,
  "faq-find-archived": faqFindArchivedMd,
  "faq-shared-personalised": faqSharedPersonalisedMd,
};

/** The guides' files, as written. Total over `HelpGuide`. */
export const HELP_GUIDE_FILES: Record<HelpGuide, string> = {
  "first-article": guideFirstArticleMd,
  "for-students": guideForStudentsMd,
  "for-reviewers": guideForReviewersMd,
  "for-experts": guideForExpertsMd,
};

/** A topic's file, read: what the contents page and the search box need, and the words. */
export interface HelpTopicPage {
  title: string;
  /** One plain sentence saying what the page covers, for the contents page. */
  summary: string;
  /** The words a reader might search for that the title does not say. */
  keywords: string;
  /** The pages its *See also* lists, in the order the file gives them. */
  related: readonly HelpAnchor[];
  /** The Markdown under the front matter. */
  body: string;
}

/** A guide's file: the same four lines and a body as a topic's. */
export type HelpGuidePage = HelpTopicPage;

/** A question's file. No summary: the question is its own. */
export type HelpFaqPage = Omit<HelpTopicPage, "summary">;

/**
 * A mode's file. **No title and no summary**: a mode's heading is `MODE_LABEL`
 * and its line is `MODE_CATALOG`'s, so a mode is not restated here
 * (help-content.tsx § The modes say only what the catalog does not).
 */
export type HelpModePage = Omit<HelpTopicPage, "title" | "summary">;

/**
 * **`related` as live anchors.** A page that has gone must not linger in
 * somebody's *See also*, and an alias is not good enough either: the list is
 * drawn as links, and a link should name the page it lands on.
 */
function relatedAnchors(value: string | undefined, name: string): HelpAnchor[] {
  return splitList(value).map((id) => {
    const anchor = resolveHelpAnchor(id);
    if (anchor === null || anchor !== id) throw new Error(`Help page ${name}: related names "${id}", which is not a live Help anchor`);
    return anchor;
  });
}

function readTopic(id: HelpTopic): HelpTopicPage {
  const { meta, body } = readFrontMatter(
    HELP_TOPIC_FILES[id],
    { required: ["title", "summary", "keywords"], optional: ["related"] },
    id,
  );
  return { title: meta.title, summary: meta.summary, keywords: meta.keywords, related: relatedAnchors(meta.related, id), body };
}

function readGuide(id: HelpGuide): HelpGuidePage {
  const name = `guides/${id}`;
  const { meta, body } = readFrontMatter(
    HELP_GUIDE_FILES[id],
    { required: ["title", "summary", "keywords"], optional: ["related"] },
    name,
  );
  return { title: meta.title, summary: meta.summary, keywords: meta.keywords, related: relatedAnchors(meta.related, name), body };
}

function readFaq(id: FaqId): HelpFaqPage {
  const { meta, body } = readFrontMatter(HELP_FAQ_FILES[id], { required: ["title", "keywords"], optional: ["related"] }, id);
  return { title: meta.title, keywords: meta.keywords, related: relatedAnchors(meta.related, id), body };
}

function readMode(mode: Mode): HelpModePage {
  const name = `modes/${mode}`;
  const { meta, body } = readFrontMatter(HELP_MODE_FILES[mode], { required: ["keywords"], optional: ["related"] }, name);
  return { keywords: meta.keywords, related: relatedAnchors(meta.related, name), body };
}

/**
 * `Object.fromEntries` forgets its keys, so this is the one cast: the keys are
 * exactly the ids mapped over, which is what `Record<K, …>` says.
 */
export function byId<K extends string, V>(ids: readonly K[], read: (id: K) => V): Record<K, V> {
  return Object.fromEntries(ids.map((id) => [id, read(id)])) as Record<K, V>;
}

/* **Read once, when the Help chunk loads.** Fifty short files and no
   Markdown parsing yet, only the front matter. Reading here rather than on
   first use means a malformed file fails every test that imports Help, not
   only the one that happens to open that page. */

/** Every topic's page. */
export const HELP_TOPIC_PAGES: Record<HelpTopic, HelpTopicPage> = byId(HELP_TOPIC_IDS, readTopic);
/** Every question's page. */
export const HELP_FAQ_PAGES: Record<FaqId, HelpFaqPage> = byId(FAQ_IDS, readFaq);
/** Every mode's page. */
export const HELP_MODE_PAGES: Record<Mode, HelpModePage> = byId(MODES, readMode);
/** Every guide's page. */
export const HELP_GUIDE_PAGES: Record<HelpGuide, HelpGuidePage> = byId(HELP_GUIDE_IDS, readGuide);

/**
 * **The file behind any anchor, read**: the three things every kind of file
 * has. What only some have (a title, a summary) is asked of the kind's own
 * table.
 */
export function helpPage(anchor: HelpAnchor): HelpModePage {
  const kind = helpAnchorKind(anchor);
  switch (kind.kind) {
    case "topic":
      return HELP_TOPIC_PAGES[kind.id];
    case "faq":
      return HELP_FAQ_PAGES[kind.id];
    case "guide":
      return HELP_GUIDE_PAGES[kind.id];
    case "mode":
      return HELP_MODE_PAGES[kind.mode];
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** The Markdown body behind any anchor. */
export function helpPageBody(anchor: HelpAnchor): string {
  return helpPage(anchor).body;
}
