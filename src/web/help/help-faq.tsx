/**
 * **The questions people ask** — each one something a reader actually asked or
 * was confused by, mostly from docs/user-feedback/. Short, and each points at
 * the section that says the rest rather than repeating it.
 *
 * Total over `FaqId` (help-anchors.ts § FAQ_IDS), whose ids are append-only
 * like every other anchor.
 */
import type { FaqId } from "./help-anchors.js";
import { HelpRef, type HelpSection } from "./help-parts.js";

export const HELP_FAQ: Record<FaqId, HelpSection> = {
  "faq-is-the-ai-reading-for-me": {
    title: "Is the AI reading the article for me?",
    keywords: "summary replace reading trust grounded passages sources accurate hallucinate made up check",
    body: (
      <>
        <p>
          No. It is there to help you read the article, not to read it instead of you. Most of what the
          modes show points back to the article’s own passages, so you can check it in one click, and
          quotes are cut from the article itself.
        </p>
        <p>
          Treat a summary as a map, not the territory: when something matters, follow the link and read
          the passage. See <HelpRef to="ai-words">the AI’s words and the author’s</HelpRef>.
        </p>
      </>
    ),
  },

  "faq-why-slow-first-time": {
    title: "Why does a mode take a while the first time, and not the second?",
    keywords: "slow wait loading spinner first time instant fast generating stored minutes",
    body: (
      <p>
        Most modes are one pass of the AI over the whole article. It runs the first time anyone asks,
        and the result is stored with the article, so after that the mode opens straight away — for you
        and for anyone you share it with. To skip the first wait, leave{" "}
        <strong>Generate the main modes as soon as it opens</strong> ticked when you add an article. See{" "}
        <HelpRef to="waiting-and-cost">Waiting for a mode</HelpRef>.
      </p>
    ),
  },

  "faq-does-a-mode-use-my-allowance": {
    title: "Does opening a mode use up my allowance?",
    keywords: "count charge generate rerun free quota",
    body: (
      <p>
        No. Your allowance counts the articles you <em>add</em>. Opening modes, generating them,
        chatting, and re-running them are all included. Besides adding, the only thing that counts is
        switching an article to High-powered AI. See <HelpRef to="plans">Plans</HelpRef>.
      </p>
    ),
  },

  "faq-missing-parts": {
    title: "Why did my article come out with missing parts?",
    keywords: "missing broken extraction images figures paywall pdf equations wrong text incomplete garbled footnotes",
    body: (
      <>
        <p>
          When we fetch a page we keep the article and leave behind the menus, adverts and the rest, and
          sometimes a figure or a box gets thrown out with the clutter. If a paywall lets only the
          opening through, the opening is all you get. A PDF is read by an AI model, which can now and
          then garble a word or turn an equation into plain text; the Metadata page’s{" "}
          <strong>How well we read the PDF</strong> lists the words it may have missed.
        </p>
        <p>
          What to try: the shelf card’s <strong>Re-fetch and rebuild</strong> (or{" "}
          <strong>Rebuild</strong>, for an uploaded file) reads the article again, without using up your
          allowance, and your comments stay attached. If it still looks wrong, send{" "}
          <HelpRef to="feedback">Feedback</HelpRef> from the article with{" "}
          <strong>Send extra diagnostics</strong> ticked, so we can see the source.
        </p>
      </>
    ),
  },

  "faq-beyond-the-article": {
    title: "Does it ever look beyond the article?",
    keywords: "go web internet search outside sources other articles knowledge where does the answer come from",
    body: (
      <p>
        Sometimes, and it tells you when. Chat can reach the open web, your other saved articles, or a
        page this one links to, and any answer that did has a strip above it saying so.{" "}
        <HelpRef to="mode-debate">Debate</HelpRef> is all about what the rest of the web says, and every
        row links to its source. Glossary’s <strong>Dig deeper</strong>, Citations’{" "}
        <strong>Dig deeper</strong> and Referee’s <strong>Candidates</strong> can also search or fetch
        outside sources. The glossary’s <strong>background</strong> notes and Citations’ influence bars
        come from the model’s general knowledge (a row says <em>influence unknown</em> where no usable
        influence score was saved; new lists ask the model to leave it unknown when unsure), and a reader profile can shape how some aids are
        written. Most other reading aids work from the article itself.
      </p>
    ),
  },

  "faq-older-profile": {
    title: "Everything says “older profile” since I edited my profile. Did something break?",
    keywords: "out of date stale label written for you regenerate profile changed",
    body: (
      <p>
        No. Each piece of text remembers which version of your profile it was written for, and any edit
        counts as a new version, even fixing a typo. Nothing is rewritten unless you ask, so the label
        just means the text was written for an earlier version. Rewrite the ones you care about from
        inside the mode. See <HelpRef to="reader-profile">Your reader profile</HelpRef>.
      </p>
    ),
  },

  "faq-find-archived": {
    title: "Where did my archived article go, and how do I get it back?",
    keywords: "lost missing disappeared gone went undo restore put back unarchive find",
    body: (
      <p>
        If the <strong>Undo</strong> is still showing, press it. Otherwise turn on{" "}
        <strong>Include archived</strong> beside the shelf’s search box: archived articles join the list
        and the search, each marked <em>Archived</em>, with <strong>Put back</strong> on the card. The
        article’s link still opens too. Archiving never deletes anything.
      </p>
    ),
  },

  "faq-shared-personalised": {
    title: "If I share an article, do visitors see what was written for me?",
    keywords: "share public profile personalised personalized glossary visitors privacy",
    body: (
      <p>
        Partly. Your profile itself is never shared, but aids written with it go out as they are, so a
        visitor might see a glossary that skips terms you already knew. Before you confirm, the sharing
        screen tells you which aids were written for your profile. See{" "}
        <HelpRef to="sharing">Sharing</HelpRef>.
      </p>
    ),
  },
};
