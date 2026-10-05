/**
 * **The general sections of the Help page** — everything but the modes and
 * the questions. help-content.tsx says what belongs in a section and why; this
 * file is only the words.
 *
 * Every product fact here was checked against the code when it was written
 * (docs/plans/261002b-help-page.md, stage 1b). When the product changes, the
 * deploy runbook's Help step is where this file is meant to hear about it.
 *
 * Two words the whole page uses one way: the **bottom bar** (the row of buttons
 * along the foot of the reading view — the code calls it the Dock) and
 * **whoever added the article** (the reader whose shelf it is on — the code
 * says owner), because that is the phrase the product's own messages use
 * (messages.ts § ownersOnly).
 */
import { MODE_CATALOG } from "../../mode-catalog.js";
import { MODES } from "../../modes.js";
import { PUBLIC_SHELF_LABEL } from "../../messages.js";
import { MODE_LABEL } from "../../title-text.js";
import {
  CHANGELOG_HREF,
  CHANGELOG_LABEL,
  PRICING_HREF,
  PRIVACY_HREF,
  PROFILE_HREF,
  PUBLIC_LIBRARY_HREF,
} from "../router.js";
import type { HelpTopic } from "./help-anchors.js";
import { ModesTable } from "./help-modes.js";
import { HelpRef, PageLink, type HelpSection } from "./help-parts.js";

/** The experimental modes, by name, from the catalog — so the list cannot go stale. */
const EXPERIMENTAL_MODES = MODES.filter((m) => MODE_CATALOG[m].experimental).map((m) => MODE_LABEL[m]);

/** "A, B and C". */
function listOf(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Total over `HelpTopic`, so a topic id with no section does not compile. */
export const HELP_TOPICS: Record<HelpTopic, HelpSection> = {
  "what-it-is-for": {
    title: "What Spideryarn is for",
    keywords: "about purpose why what is spideryarn summary summarise read deeply understand ai reading tool",
    body: (
      <>
        <p>
          Spideryarn helps you read a piece properly. It does not replace it with a summary.
          Everything the AI makes is there to send you back into the author’s own words: a
          definition points to where a term is used, a summary paragraph links to the passages it
          rests on, a quote is cut straight out of the text.
        </p>
        <p>
          The main column is always the article itself, word for word. The AI’s work sits beside it,
          in the modes, the spine and the cards, so you can tell what came from the author and what
          came from the model — see <HelpRef to="ai-words">the AI’s words and the author’s</HelpRef>.
        </p>
        <p>
          A good way to use it: get your bearings first (<HelpRef to="spine">the spine</HelpRef>,{" "}
          <HelpRef to="mode-structure">Structure</HelpRef>, <HelpRef to="mode-skim">Skim</HelpRef>),
          then read, stopping to ask, define or mark things as you go. Afterwards, test what you
          kept. The aim is not to spend less time on the piece, but less of it on the parts you did
          not need and more on the parts you did.
        </p>
      </>
    ),
  },

  "adding-articles": {
    title: "Adding an article",
    keywords:
      "add import paste url link pdf upload file html save page paywall failed error stuck bookmarklet new article",
    body: (
      <>
        <p>
          Paste a web address into <strong>Add an article</strong> on your shelf and press{" "}
          <strong>Add</strong>. You can leave off the <code>https://</code>. To add a file, press{" "}
          <strong>File</strong> or drop one on that box: a PDF, or a web page you saved as HTML. One
          file is read in full. Choose several at once and each is added with only its title,
          authors and abstract read; open one and press <strong>Read this</strong> when you want the
          whole of it.
        </p>
        <p>
          You can also add a page from its address: go to <code>/add/</code> followed by the full
          URL, for example <code>spideryarn.com/add/https://example.com/essay</code>. That makes a
          bookmarklet easy.
        </p>
        <p>
          While an article is coming in, you see each stage tick past.{" "}
          <strong>Keep a Spideryarn tab open until it finishes</strong>: the work is driven by your
          browser, and if you close every tab it pauses until you come back. Adding sends the text to
          an AI provider to be processed.
        </p>
        <p>When it goes wrong, the message says why. What to try:</p>
        <ul>
          <li>
            <strong>Not enough readable text</strong> usually means a login wall, a paywall, an error
            page, or a page that fills itself in with scripts. Trying again gets the same page.
            Instead, open it in your browser, save the page as HTML, and upload that file.
          </li>
          <li>
            <strong>A PDF that is locked, damaged, too big or too long</strong>: upload a copy
            without the password, a smaller file, or just the part you want.
          </li>
          <li>
            <strong>A stage stopped part way</strong>: press <strong>Retry</strong>. It skips the
            stages that already worked.
          </li>
        </ul>
        <p>
          An article counts against your allowance only once it comes back readable; a failure costs
          nothing. See <HelpRef to="plans">Plans</HelpRef>.
        </p>
      </>
    ),
  },

  "the-reading-view": {
    title: "The parts of the reading view",
    keywords: "layout screen columns panel left right bottom bar buttons where what am i looking at interface overview",
    body: (
      <>
        <ul>
          <li>
            <strong>The spine</strong> is the thin strip down the left edge: a map of the whole
            article, each part as tall as it is long. See <HelpRef to="spine">Reading the spine</HelpRef>.
          </li>
          <li>
            <strong>The article</strong> is the main column, in the author’s own words. Beside each
            paragraph is a narrow margin for your own marks — see{" "}
            <HelpRef to="gutter">the margin beside each paragraph</HelpRef>.
          </li>
          <li>
            <strong>A mode’s panel</strong> opens between the spine and the article when you choose
            a mode, such as Glossary, Quotes or Chat. Only one is open at a time; press its button
            again to close it, or <strong>Plain</strong> to close it and the Marginalia column both.
          </li>
          <li>
            <strong>Marginalia</strong> is a column of notes on the right of the article, which can
            stay open beside any panel.
          </li>
          <li>
            <strong>The bottom bar</strong> starts with the way home (the Spideryarn wordmark). On
            your own article, that is followed by the <strong>Commands</strong> button. Next come
            the mode buttons, then <strong>Comments</strong> and <strong>Metadata</strong>. When you
            are signed in, it also has the <strong>Experimental</strong> switch and{" "}
            <strong>Feedback</strong>. To come back to this page from your own article, press{" "}
            <strong>Commands</strong> and type <em>help</em>, or follow <strong>More in Help</strong>{" "}
            in a mode’s (i). On an article somebody shared with you there is no{" "}
            <strong>Commands</strong> button, and the bar has a <strong>Help</strong> link instead.
          </li>
        </ul>
        <p>
          When there is not room for everything, the mode buttons drop their words and show only
          icons. Point at one to see its name and what it does; each mode also shows its name for a
          few seconds when you open it. On a narrow screen the panel covers the article instead of
          sitting beside it — see <HelpRef to="touch">Phones and tablets</HelpRef>.
        </p>
      </>
    ),
  },

  spine: {
    title: "Reading the spine",
    keywords:
      "rail strip map overview where am i position progress ticks lines heat coloured marks colours orange box results visuals legend meaning",
    body: (
      <>
        <p>
          The spine is the thin strip down the left edge: the whole article squeezed to the height
          of your window. It is <strong>proportional</strong> — a part that fills half the piece
          fills half the spine — so it is a picture of the article’s shape, not a list of headings.
          At a glance it shows how far through you are, how big each part is, and where the things
          you are looking for sit.
        </p>
        <p>What each mark means:</p>
        <ul>
          <li>
            <strong>Tinted blocks, stacked top to bottom: the parts.</strong> Each is as tall as that
            part is long, with a thin line between one and the next. A short part can be a sliver too
            thin to see.
          </li>
          <li>
            <strong>One block a little brighter: the part you are in.</strong>
          </li>
          <li>
            <strong>The strongest fill: the section you are in</strong>, inside the brighter part.
            It does not appear when a part has no sections.
          </li>
          <li>
            <strong>Short hairlines inside a part: where its sections begin</strong>, even where
            there is no room to name them.
          </li>
          <li>
            <strong>Very faint blocks near the bottom: endnotes, references and other back
            matter.</strong> Dimmed so you can see where the argument ends, but kept at their true
            size. If the spine says you are 60% through and the rest is faint, you have nearly
            finished the article itself.
          </li>
          <li>
            <strong>A box with orange top and bottom edges: what is on your screen.</strong> It moves
            as you scroll, and its height shows how much of the article fits on one screen.
          </li>
          <li>
            <strong>
              A tinted area from the left edge, with a brighter line at its edge: where you have
              spent time reading.
            </strong>{" "}
            The further across the strip it reaches, the longer you spent there. A quick glance
            may leave no shading. Use it to find where you had got to after jumping
            around. Only whoever added the article sees it.
          </li>
          <li>
            <strong>One faint grey bar across the full width: where you jumped from.</strong> It
            appears with the <strong>↩ back to …</strong> button and goes when that does — see{" "}
            <HelpRef to="jumping-around">Jumping around</HelpRef>.
          </li>
          <li>
            <strong>Coloured marks down the right edge: the passages the open mode points at.</strong>{" "}
            In Search, each search you have switched on gets its own narrow lane in its own colour;
            in Quotes, Ideas, Skim and the other modes that point at passages, the marks are those
            passages. <strong>Each mark is as tall as its paragraph</strong>, so you can see how a
            set of results is spread: bunched in one section, scattered evenly, or only in the notes.
            A list of results cannot show you that.
          </li>
        </ul>
        <p>
          <strong>Point at the spine to read it.</strong> Every section has a card. It starts with a
          small outline of the article showing where the section sits: the part it belongs to,
          the sections on either side, and its place in the part (“3 of 7”) when the part is long.
          Under the section’s own name are a short gist and what is inside it. Then come how many
          words it has, how far in it starts, and how many search matches it holds. A heading set in
          the author’s typeface is the author’s own; one in the AI’s was written by the AI. Once a
          card is open, move slowly down the spine and the cards follow, so you can read the outline
          section by section.
        </p>
        <p>
          <strong>Click to go there.</strong> A click lands at the start of that section. On a
          touchscreen, the first tap opens the card and the second goes there, because most sections
          are too thin to tap blind. With the pointer over the spine, <kbd>↑</kbd> and <kbd>↓</kbd>{" "}
          move one part at a time.
        </p>
      </>
    ),
  },

  "jumping-around": {
    title: "Jumping around, and getting back",
    keywords: "back return go back lost where was i jump undo history back button previous place",
    body: (
      <>
        <p>
          Following a link to a passage, clicking the spine, choosing a search result: each of these
          is a jump. After one, a <strong>↩ back to</strong> button, naming the section you left,
          appears above the bottom bar. Press it to go back; press it again to keep going back
          through earlier jumps. The <strong>×</strong> beside it hides it.
        </p>
        <p>
          Your browser’s Back button does the same, because each jump is saved in your history.
          Ordinary scrolling is not, so Back never makes you crawl up the page a screen at a time.
          The way back survives switching mode: jump from inside Chat, open Glossary, and the button
          still takes you back to the passage you left.
        </p>
        <p>
          On a narrow screen, tapping a passage link in a mode’s panel moves the panel aside to show
          you the paragraph, and a <strong>↩ back to</strong> button naming the mode brings the
          panel back as you left it, half-typed question and all.
        </p>
        <p>
          If you have added Spideryarn to your phone’s home screen there is no Back button, and this
          is the way back.
        </p>
      </>
    ),
  },

  gutter: {
    title: "The margin beside each paragraph",
    keywords: "gutter icons paragraph link copy permalink bookmark chat ask ai help question mark dots more",
    body: (
      <>
        <p>
          The narrow margin beside each paragraph stays empty until you point at the paragraph (or
          tap it on a touchscreen). Then its controls appear:
        </p>
        <ul>
          <li>
            <strong>Link</strong> copies a link that opens at exactly this paragraph — see{" "}
            <HelpRef to="linking-to-a-passage">Linking to a passage</HelpRef>.
          </li>
          <li>
            <strong>Chat</strong> opens a conversation about this paragraph, where you type your own
            question. If one already exists, the icon stays visible and shows how many.
          </li>
          <li>
            <strong>Bookmark</strong> marks the whole paragraph with one press. Nothing is written and
            nothing goes to the AI. The bookmark then stays at the top of the margin, so you can spot
            the paragraph later.
          </li>
          <li>
            <strong>?</strong> asks the AI to help you understand this paragraph.{" "}
            <strong>One press sends it</strong>, with no box to type in, and the answer opens as a
            chat you can carry on.
          </li>
          <li>
            <strong>…</strong> appears when a short paragraph has no room for every control.
          </li>
        </ul>
        <p>
          To mark only part of a paragraph, select the words instead — see{" "}
          <HelpRef to="comments">Comments and bookmarks</HelpRef>.
        </p>
        <p>
          On someone else’s shared article the margin can show their existing comments or bookmarks,
          and always lets you copy the paragraph’s link. You cannot add a bookmark, start a chat or
          use the <strong>?</strong>.
        </p>
      </>
    ),
  },

  "linking-to-a-passage": {
    title: "Linking to a passage",
    keywords: "share link url send copy permalink paragraph passage address bar open at mode reload where i left",
    body: (
      <>
        <p>
          The address bar always holds where you are and how you are looking: the section on your
          screen, the open mode, and what is picked inside it, such as a glossary term or a Skim
          stop. So you can copy the address at any time and send it, and it opens at the same place
          in the same mode. Reloading brings you back there too.
        </p>
        <p>
          For one exact paragraph, press the <strong>link</strong> icon in its margin. That copies a
          link that opens at that paragraph and keeps your current mode. On a phone, a long press on
          the icon offers the browser’s own <strong>Copy link</strong>.
        </p>
        <p>
          Opening an article from your shelf returns you to where you left it on that device, but a
          link always wins: if someone sends you a passage, it opens at their passage. When signed
          in, an article you have not opened in this browser before can open in Summary, where the
          window has room for it beside the text.
        </p>
        <p>
          The person you send it to can open it only if they can see the article — see{" "}
          <HelpRef to="sharing">Sharing</HelpRef>.
        </p>
      </>
    ),
  },

  keyboard: {
    title: "Keyboard shortcuts",
    keywords:
      "keys hotkeys arrow up down left right command k ctrl enter escape g glossary navigate jump first find look up define find more terms quotes tag untag microphone dictate speak sentence ask did you mean natural language",
    body: (
      <>
        <ul>
          <li>
            <kbd>⌘K</kbd> (Mac) or <kbd>Ctrl K</kbd> opens the <strong>command bar</strong>. Type the
            name of a mode, a page or an action — <em>quotes</em>, <em>library</em>,{" "}
            <em>feedback</em> — and press <kbd>Enter</kbd>. Rows marked <strong>generates</strong>{" "}
            start the AI writing something. The <kbd>⌘</kbd> button in the bottom bar opens the same
            thing. It works while you are typing in most boxes too, and simply closing it keeps
            what you typed. It leaves title editing and boxes inside another open dialog alone.
            On a Mac, use <kbd>⌘K</kbd>: <kbd>Ctrl K</kbd> stays the box’s own editing key.
          </li>
          <li>
            The command bar also takes a few whole requests. <em>where does it first mention entropy</em>{" "}
            jumps to the first place the article says it. <em>search for entropy</em> or{" "}
            <em>find entropy</em> offers a quick search for it first, on your own articles, and
            every place the exact word appears second.{" "}
            <em>look up entropy</em> opens a matching term already visible in the glossary, or, once
            the article has a glossary, offers to look it up and add it.{" "}
            <em>tag as methods</em> and <em>untag methods</em> change your own tags, and{" "}
            <em>experimental</em> turns experimental features on or off. <em>dark mode</em>,{" "}
            <em>light mode</em> and <em>system</em> change the page’s colours on this device, the
            choice your Profile also has. <em>find more terms</em> and{" "}
            <em>more quotes</em> open Glossary or Quotes and press its <strong>Find more</strong> for
            you; they are offered only while that list can be added to. Press the microphone in the
            box to say it instead of typing. Press Stop twice quickly and the bar presses{" "}
            <kbd>Enter</kbd> for you once the words arrive: it runs the command you named, or asks
            what you meant.
          </li>
          <li>
            If you do not know the name, type or say a whole sentence — <em>what’s changed on this site</em>,{" "}
            <em>is consciousness mentioned anywhere</em> — and, when nothing matches, press{" "}
            <strong>Ask what you meant</strong> or <kbd>Enter</kbd>. A fast AI model reads your sentence and the list
            of commands, never the article. If it is sure and the command only takes you somewhere,
            you go there; otherwise it shows its best guesses under <strong>Did you mean</strong> and
            you press the one you want, or <kbd>Enter</kbd>. You need to be signed in.
          </li>
          <li>
            <kbd>↑</kbd> / <kbd>↓</kbd> move one paragraph at a time, or one part at a time with the
            pointer over the spine. Holding a key down does not repeat, so every step lands somewhere
            you can read.
          </li>
          <li>
            <kbd>←</kbd> / <kbd>→</kbd> step through Skim’s stops, Quiz’s questions, Quotes’ quotes and
            Structure’s smallest sections while that mode is open. Elsewhere they do what your browser
            normally does.
          </li>
          <li>
            <kbd>G</kbd> opens the glossary at a term in the paragraph you are on; press it again for
            the next term. <kbd>Esc</kbd> takes you back.
          </li>
          <li>
            <kbd>⌘ Enter</kbd> / <kbd>Ctrl Enter</kbd> opens the article’s Metadata page, and on it
            takes you back to the article, as pressing <strong>Metadata</strong> again does. In a box you
            are typing in — a comment, feedback, a quiz answer — it saves or sends instead, and plain{" "}
            <kbd>Enter</kbd> starts a new line.
          </li>
          <li>
            <kbd>Esc</kbd> closes whatever is in front: a dialog, a card, an open panel. On the
            Metadata page, with nothing in front and focus outside a text box, it takes you back
            to the article.
          </li>
        </ul>
        <p>
          The article-navigation shortcuts leave keys alone while you are typing in a box.{" "}
          <kbd>⌘ Enter</kbd> / <kbd>Ctrl Enter</kbd> is instead left to the box to save or send,
          and <kbd>Esc</kbd> can still close what is in front.
        </p>
      </>
    ),
  },

  touch: {
    title: "Phones and tablets",
    keywords: "phone mobile ipad tablet touch small screen narrow landscape portrait home screen gestures long press tap twice",
    body: (
      <>
        <p>Spideryarn works best on a large screen. On a phone or tablet, these work differently:</p>
        <ul>
          <li>
            <strong>A mode’s panel covers the article</strong> when the window is too narrow for
            both. Press <strong>Plain</strong> to get back to the text. Turning a phone to landscape
            often gives room for both.
          </li>
          <li>
            <strong>Tap twice on the spine.</strong> The first tap shows that section’s card; the
            second, on the same section, takes you there.
          </li>
          <li>
            <strong>Tap a link in the article twice.</strong> The first tap shows where it goes, so a
            stray tap never takes you off the page; the second opens it.
          </li>
          <li>
            <strong>Tap an underlined term</strong> to see its glossary definition.
          </li>
          <li>
            <strong>Tap a paragraph to show its margin controls.</strong> They stay hidden until then,
            so the page is not covered in icons.
          </li>
          <li>
            <strong>Press and hold to select words.</strong> On your own article a{" "}
            <strong>Highlight or comment</strong> button appears under them. Tap it and the words
            are highlighted, with a box to add a comment, change the colour or remove it. Tap
            anywhere else to keep the highlight.
          </li>
          <li>
            <strong>On your home screen</strong> there is no Back button: use the{" "}
            <strong>↩ back to …</strong> button above the bottom bar — see{" "}
            <HelpRef to="jumping-around">Jumping around</HelpRef>.
          </li>
        </ul>
        <p>
          Anything explained only on hover, like the mode buttons’ descriptions, cannot be reached by
          touch. To make up for it, each mode shows its name and a sentence about it for a few
          seconds when you open it, and this page has the rest.
        </p>
      </>
    ),
  },

  "ai-words": {
    title: "The AI’s words and the author’s",
    keywords:
      "ai generated written author original trust grounded hallucination accurate source check verify typeface font which is ai",
    body: (
      <>
        <p>
          <strong>The main column is always the author’s text, word for word.</strong> Spideryarn
          never rewrites it. Everything around it was written by a model — gists, definitions,
          summaries, questions, chat answers, and section titles without a <strong>§</strong> — and
          how closely each mode stays tied to the article varies:
        </p>
        <ul>
          <li>
            <strong>Tied to passages.</strong> Quotes are cut out of the article: the model only
            chose them. FAQ writes no answers at all; each question points to the passages that
            respond to it. Summary and its thread, Ideas, Remember and Chat link each claim to the
            paragraphs behind it, so you can check in one click.
          </li>
          <li>
            <strong>The model’s reading of the article.</strong> The glossary defines terms from how
            this piece uses them. Ideas sorts what the piece assumes from what it adds, and Timeline
            puts events in order. The article marks neither, so treat them as a careful reader’s
            interpretation.
          </li>
          <li>
            <strong>Reaching beyond the article.</strong> Chat can search the web, your other
            articles, or a page this one links to, and says so above any answer that did. Debate is
            entirely about what the rest of the web says, and every row links out. Citations takes
            each work’s address from the article, but how influential a work is comes from the
            model’s general knowledge.
          </li>
        </ul>
        <p>
          The test is always the same: follow the link to the passage and read it. A claim with no
          passage behind it is the model’s opinion; weigh it as one.
        </p>
        <p>
          <strong>Each voice has its own typeface</strong>: the author in a serif, the AI in a
          typewriter face, what you typed in a plain sans.
        </p>
      </>
    ),
  },

  "waiting-and-cost": {
    title: "Waiting for a mode",
    keywords: "slow loading how long cost generate run again cached stored free first time high powered opus",
    body: (
      <>
        <p>
          <strong>The first time you open most modes, the AI writes what they show.</strong> That
          usually takes seconds and can take a minute or more. After that the result is stored, and{" "}
          <strong>opening it again is instant</strong>, for you and for anyone you share the article
          with. Nothing reruns by itself.
        </p>
        <p>What sets one off:</p>
        <ul>
          <li>
            <strong>Pressing a mode’s button</strong>, or choosing it in the command bar, writes it if
            it has not been written yet.
          </li>
          <li>
            <strong>Arriving by a link, or with Back, does not.</strong> You see an empty panel with a
            button to start it, so a link someone sends you never starts work you did not ask for.
          </li>
          <li>
            <strong>Summary’s Thread is the exception</strong>: on your own article it starts writing as
            soon as you open it, however you got there.
          </li>
          <li>
            <strong>Chat, Search and the margin’s ?</strong> work when you ask, and answers appear as
            they are written.
          </li>
          <li>
            <strong>When you add an article</strong>, leaving{" "}
            <strong>Generate the main modes as soon as it opens</strong> ticked prepares the modes
            named beneath the tick-box, plus the links between passages, in the background.
          </li>
        </ul>
        <p>
          The work runs while a Spideryarn tab is open; close them all and it pauses until you come
          back. On someone else’s shared article you see whatever has already been made, but you
          cannot start anything new.
        </p>
        <p>
          <strong>None of this uses up your allowance</strong> — opening, generating, chatting and
          re-running are included. For a difficult piece, <strong>High-powered AI</strong> uses a
          stronger model (Claude Opus) for work done after you switch it on. Tick it while the
          article is being added to use it for the work still to come; or switch it on later from the
          article’s Metadata page and use <strong>Run it again</strong> there to redo a mode with it. That switch is the
          one thing besides adding that counts — see <HelpRef to="plans">Plans</HelpRef>.
        </p>
      </>
    ),
  },

  modes: {
    title: "Which mode when",
    keywords: "choose pick compare list overview bottom bar buttons what does each do",
    body: (
      <>
        <p>
          The buttons in the bottom bar are the modes. Each shows the same article a different way,
          in a panel beside the text; the text itself never changes. You do not need most of them for
          most pieces — pick by the question you have.
        </p>
        <ModesTable />
        <p>
          The ones marked experimental appear only once you turn on{" "}
          <HelpRef to="experimental-features">experimental features</HelpRef>.
        </p>
      </>
    ),
  },

  shelf: {
    title: "Your shelf, and the topics above it",
    keywords: "library home homepage articles list sort order filter unread table cards topics tags categories find",
    body: (
      <>
        <p>
          Your shelf is every article you have added. The search box above it does two jobs: it
          narrows the cards by what is written on them (title, author, site and the one-line
          summary), and it searches the words <em>inside</em> your articles, listing matching passages
          underneath. Open one and you land on that passage with your words lit up. Archived articles
          are left out of both unless <strong>Include archived</strong> is on.
        </p>
        <ul>
          <li>
            <strong>Sorting.</strong> The chips set the order; press the one you are on to reverse
            it. <strong>Shift-click</strong> a second chip to sort within the first — by Added, then
            by Length, say. <strong>Published</strong> is the date the publisher gives. For a paper
            it is the date, or just the year, on its public record, and a paper with only a year
            sits at the start of that year. An article with neither goes last.
          </li>
          <li>
            <strong>Cards or Table.</strong> The same list two ways: cards for deciding what to read
            next, the table for comparing. Its Columns menu hides the columns you don’t want.
          </li>
          <li>
            <strong>Unread</strong> shows only the articles you have never opened.
          </li>
          <li>
            <strong>Point at a card’s date line</strong> to see when it was added, where from, how
            often you’ve opened it and how long it is.
          </li>
          <li>
            <strong>On a phone or tablet</strong>, a card’s actions are behind its{" "}
            <strong>⋯</strong> button.
          </li>
        </ul>
        <p>
          <strong>Topics</strong> are the row of subjects above the list, each with a count. Choose
          one to see only the articles about it; choose a second to narrow to articles about{" "}
          <em>both</em>. Usually, a model names them from your articles’ titles and one-sentence
          summaries, using your profile if you have written one: broad subjects first, with finer
          ones inside them marked <strong>›</strong>. Until that answer exists, the row can fall
          back to phrases from the articles themselves. New articles are sorted in by themselves.
          Each article shows the topics it is in under its title: up to four, or the first three
          and how many more. Topics appear once there are about eight different articles on the
          shelf, and shift as it grows.
        </p>
      </>
    ),
  },

  sharing: {
    title: "Sharing an article, and the public shelf",
    keywords:
      "share public publish link private link key send someone some people friend colleague visitor see comments bookmarks chats profile private padlock globe shared articles unshare stop turn off unlisted",
    body: (
      <>
        <p>
          Every article starts <strong>private</strong>. The padlock beside the title means it is
          not public. Sending someone its ordinary address lets nobody in: copying an address
          changes nothing about who can open it.
        </p>
        <p>
          There are two ways to let other people read one, and both are under{" "}
          <strong>Access &amp; sharing</strong> on the article’s Metadata page: a private link, for
          the people you send it to, and making it public, for everyone.
        </p>
        <p>
          <strong>A private link.</strong> Press <strong>Create a link</strong>, look at what
          somebody with the link would get, tick that you have the right to share the text, and
          press <strong>Create the link</strong>. Then copy the link and send it however you like.
        </p>
        <ul>
          <li>
            <strong>Anyone who has the link can read the article without an account</strong>, and
            can pass the link on. We cannot tell you who has opened it.
          </li>
          <li>
            <strong>An article shared only this way is not listed anywhere</strong>, and the page tells whoever opens it that it
            is a private link. They get what a visitor to a public article gets, and like any
            visitor they cannot write anything or start any AI work.
          </li>
          <li>
            <strong>Turn off</strong> stops the link working from the next request. Creating a link
            again makes a new one, and the old one stays dead.
          </li>
          <li>
            A private link does not change what the article counts against your allowance. If the
            article is also public, its ordinary address works without the link, and turning the
            link off does not make it private.
          </li>
        </ul>
        <p>
          <strong>Making it public.</strong> Press the padlock. It takes you to{" "}
          <strong>Access &amp; sharing</strong> on the
          article’s Metadata page, where you press <strong>Share with anyone…</strong>. Nothing goes
          out until you have seen exactly what a visitor would get, ticked that you have the right to
          share the text, and pressed <strong>Share it</strong>. The padlock then becomes a globe.
        </p>
        <p>What sharing means:</p>
        <ul>
          <li>
            <strong>Anyone can read it without an account, and it is listed</strong> on the public
            shelf, <PageLink href={PUBLIC_LIBRARY_HREF}>{PUBLIC_SHELF_LABEL}</PageLink>, so people who
            were never sent the link can find it. It is not listed in search engines.
          </li>
          <li>
            <strong>Visitors get the article and the reading aids already made for it</strong>, and{" "}
            <strong>your comments and bookmarks</strong> with the AI’s answers to them. They cannot
            write anything or start any AI work, so a visitor never uses up your allowance.{" "}
            <strong>Your chats and your profile are not shared.</strong>
          </li>
          <li>
            <strong>An article added since 5 September 2026 counts as half while shared.</strong>{" "}
            Older charged articles still count in full — see <HelpRef to="plans">Plans</HelpRef>.
          </li>
        </ul>
        <p>
          <strong>Stop sharing</strong> takes the article off the public shelf and refuses the next
          request for it. It cannot take back a page somebody has already loaded or copied.
        </p>
      </>
    ),
  },

  comments: {
    title: "Comments and bookmarks",
    keywords: "comment note annotate highlight bookmark mark save passage select text ask ai question drawer list delete",
    body: (
      <>
        <p>
          <strong>Select a few words in the article</strong> and they are highlighted in yellow
          straight away. A box opens beside them: click anywhere else and you are done, the
          highlight stays. In the box you can write a note, pick another colour, or pick no colour
          for a plain underlined bookmark. All of it is free. Clicking the passage later opens the
          box again.
        </p>
        <ul>
          <li>
            <strong>To take it off</strong>, press <strong>Remove highlight</strong> in the box.
          </li>
          <li>
            <strong>If you only wanted to copy the words</strong>, press{" "}
            <strong>Copy, don’t highlight</strong>, or copy with the keyboard while they are still
            selected: the words are copied and the highlight is taken off again. Once you have
            written a note or changed the colour, Copy only copies.
          </li>
          <li>
            <strong>Changing which words.</strong> Select again over some of the same words
            straight away and the new highlight replaces the first, unless you had already
            changed it.
          </li>
          <li>
            <strong>The AI is opt-in.</strong> Type a question in{" "}
            <strong>Ask the AI about this…</strong> and a conversation about the passage opens
            with your words ready to send. Nothing is asked until you send it.
          </li>
          <li>
            <strong>In the first seconds after a page opens</strong>, before your earlier comments
            have loaded, the highlight and its box appear a moment after you select rather than at
            once. Leaving or reloading the page in that moment still tries to save it, but a
            failed connection can lose it.
          </li>
          <li>
            <strong>In Referee mode</strong> selecting works the old way: a box opens first, and
            nothing is saved until you press <strong>Save</strong> or close it.
          </li>
          <li>
            <strong>To bookmark a whole paragraph</strong>, use the bookmark icon in its margin; you
            don’t need to select anything.
          </li>
          <li>
            <strong>Comments</strong> in the bottom bar lists everything you have marked, in article
            order, including the questions you asked from a paragraph’s margin. With a comment open,
            its arrows step to the one before or after it.
          </li>
          <li>
            To remove a comment, open it and press <strong>Delete</strong>.
          </li>
        </ul>
        <p>
          Your marks are tied to the passage, not to a position on the page, so they survive the
          article being re-fetched unless that passage itself changed. Visitors to a shared article
          can read your comments but cannot add or change any.
        </p>
      </>
    ),
  },

  "reader-profile": {
    title: "Your reader profile",
    keywords: "about me background expertise interests who i am personalise tailored why reading purpose written for you older",
    body: (
      <>
        <p>
          On <PageLink href={PROFILE_HREF}>your profile</PageLink>, <strong>About you</strong> tells
          the AI who is reading: your background, what you know well, what you are rusty on. It is
          used on every article, and it changes <em>what gets explained, and how much</em> — which
          terms the glossary thinks you need, how chat pitches an answer. It never changes what the
          article says. The glossary is where you will notice it most.
        </p>
        <p>
          Each article also asks <strong>Why are you reading this?</strong> while it is being added,
          and saves your answer as you type; change it later on its Metadata page. Something like “I
          want the methods, not the history” is what helps — the quiz, for one, aims more of its
          questions at what you said.
        </p>
        <ul>
          <li>These boxes save themselves a moment after you stop typing.</li>
          <li>
            Text written with your profile has a small <strong>person icon</strong> in the corner
            of its mode; point at it to see what it means, or press it to read and edit your
            profile there. When it marks text written for an older profile, the icon gains a pencil
            and a warmer colour. <strong>Nothing is rewritten by itself</strong>. The panel offers
            to replace the result where the mode can do that; Quotes is the exception, because its
            control adds to the list instead. Even a one-letter fix counts as an edit.
          </li>
          <li>The article’s parts and sections are never personalised, so they are the same for everyone.</li>
          <li>To stop the AI using a profile at all, empty both boxes.</li>
        </ul>
      </>
    ),
  },

  "experimental-features": {
    title: "Experimental features",
    keywords: "beta labs unfinished new switch toggle flask hidden modes missing more modes settings turn on",
    body: (
      <>
        <p>
          Some features are still being built, and stay hidden until you turn on{" "}
          <strong>Experimental features</strong>. Two switches change the one setting: the tick-box
          under Settings on <PageLink href={PROFILE_HREF}>your profile</PageLink>, and the{" "}
          <strong>Experimental</strong> switch, with a flask, near the end of the bottom bar.
        </p>
        <p>With it on, you get:</p>
        <ul>
          <li>
            <strong>More modes</strong>: {listOf(EXPERIMENTAL_MODES)}.
          </li>
          <li>
            <strong>Start the whole article again</strong>, on an article’s Metadata page.
          </li>
        </ul>
        <p>
          These can be slow, get things wrong, or change or vanish in a later release. Turning the
          switch off only hides them: nothing you made is deleted.
        </p>
      </>
    ),
  },

  plans: {
    title: "Plans, prices and the free allowance",
    keywords: "pricing pay subscription free allowance limit quota how many articles upgrade cancel billing money",
    body: (
      <>
        <p>
          Your allowance counts <strong>adding articles</strong>, not reading them. A link you paste
          or a file you upload counts once, when it comes back readable. A fetch that fails, a paywall
          that leaves nothing readable, or a PDF we turn down costs nothing.
        </p>
        <p>
          <strong>Everything you do with an article afterwards is included</strong>: modes, chat,
          questions, and re-running a mode or a whole article already on your shelf. What each plan
          gives you is on <PageLink href={PRICING_HREF}>the pricing page</PageLink>.
        </p>
        <p>Easy to miss:</p>
        <ul>
          <li>
            <strong>The free allowance is for the life of your account</strong>, not per month.
            Articles added while subscribed count towards it too, so cancelling doesn’t hand back a
            fresh one.
          </li>
          <li>
            <strong>An article added since 5 September 2026 counts as half while shared</strong>, so
            sharing it stretches your allowance; making it private again uses that half back up. An
            older charged article still counts in full, while one from before billing began already
            costs nothing.
          </li>
          <li>
            <strong>High-powered AI</strong>, a stronger model for one article — a tick box while it is
            being added, or a switch on its Metadata page — counts as one more article (half if the article is shared).
            Switching it off does not refund it, and switching it back on costs nothing more.
          </li>
          <li>
            <strong>Papers added several at once</strong>, with only the title, authors and abstract
            read, count as a hundredth of an article each. <strong>Read this</strong> reads the whole
            paper, and then it costs the same as one article in all.
          </li>
          <li>
            <strong>Archiving doesn’t give an article back</strong> to your allowance.
          </li>
          <li>
            <strong>Reading is never limited.</strong> At your limit, adding and switching another
            article to High-powered AI stop; everything you already have stays.
          </li>
        </ul>
        <p>
          Subscribe on <PageLink href={PRICING_HREF}>the pricing page</PageLink>. Invoices, card
          details and cancelling are under Plan on <PageLink href={PROFILE_HREF}>your profile</PageLink>.
        </p>
      </>
    ),
  },

  "your-data": {
    title: "Your data: export, archive, delete",
    keywords: "privacy export download zip delete remove erase archive account gdpr copy backup what you keep",
    body: (
      <>
        <p>
          <strong>Export.</strong> On an article’s Metadata page, <strong>Export this article</strong>{" "}
          downloads a zip of everything we hold for it: the text as we read it, and everything built
          on it, such as the glossary, quotes, comments and chats — plain files you can open without
          Spideryarn. The original page or PDF and the images are not included.
        </p>
        <p>
          <strong>Archive is not delete.</strong> Archive takes an article off your shelf, with an
          Undo for a few seconds. Nothing is destroyed and its link still opens. Turn on{" "}
          <strong>Include archived</strong> to see archived articles, and press{" "}
          <strong>Put back</strong> to return one.
        </p>
        <p>
          <strong>Deleting for good</strong> is on the article’s Metadata page, under{" "}
          <strong>Delete this article</strong>. It erases the article and everything you did with it,
          and there is no undo. It cannot reach copies already on a device: the copy your browser
          keeps so the article opens offline, or an export you downloaded.
        </p>
        <p>
          Your articles and notes are private unless you share an article.{" "}
          <PageLink href={PRIVACY_HREF}>The privacy page</PageLink> has the full account: what we
          keep, where it goes, and what you can ask for, including deleting your account.
        </p>
      </>
    ),
  },

  feedback: {
    title: "Telling us something",
    keywords: "feedback bug report problem suggestion idea contact help broken error screenshot diagnostics support shipped",
    body: (
      <>
        <p>
          When you are signed in, the <strong>Feedback</strong> button is at the right-hand end of the
          bottom bar in the reading view, and at the top of other pages. Pick{" "}
          <strong>Problem</strong> or <strong>Suggestion</strong> and write in your own words. For a
          problem, the most useful things are the steps you took, what you expected and what you saw
          instead. You can paste or drop in a screenshot.
        </p>
        <p>
          It sends what you wrote, your email address, which version of Spideryarn you were running,
          and the <strong>full address of the page you were on</strong> — so send it from the page
          where the problem is, and remember that a search you had open goes with it. Tick{" "}
          <strong>Send extra diagnostics</strong> to add your recent requests to us, the names of any
          errors and details of your browser; on your own article it may also send the article’s text
          and source file, so we can reproduce the problem. Extra diagnostics never include your
          notes, comments, chats or profile.
        </p>
        <p>
          The <strong>Earlier</strong> tab lists what you have sent and the page you sent it from, and marks a report{" "}
          <strong>Shipped</strong> once a change made for it is live. Most things that go wrong here
          fail quietly, so even a two-line report helps.
        </p>
      </>
    ),
  },

  "whats-new": {
    title: "What’s new",
    keywords: "changelog updates new features release notes changes recent version what changed",
    body: (
      <p>
        <PageLink href={CHANGELOG_HREF}>{CHANGELOG_LABEL}</PageLink> lists every update to Spideryarn,
        newest first, in plain words. Look there if something has moved, or a feature you remember
        looks different.
      </p>
    ),
  },
};
