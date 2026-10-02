/**
 * **What Help says about each mode, beyond what the catalog already says.**
 *
 * A mode's section on the page opens with its label (`MODE_LABEL`) and its two
 * catalog sentences (`MODE_CATALOG`, the words its band's (i) card shows), and
 * then draws these: when the mode is worth opening, and how to read what it
 * shows. So nothing here restates the catalog — a second copy would drift.
 * help-content.tsx § The modes say only what the catalog does not.
 *
 * Both tables are `Record<Mode, …>`: a new mode without a Help section, or
 * without a row in "Which mode when", is a type error.
 *
 * Experimental modes say nothing about the switch themselves: the page puts an
 * Experimental tag on their heading, linked to the section that explains it.
 * Terms follow help-topics.tsx's header: the **bottom bar**, a mode's
 * **panel**, **whoever added the article**.
 */
import type { ReactNode } from "react";

import { MODE_CATALOG } from "../../mode-catalog.js";
import { MODES, type Mode } from "../../modes.js";
import { MODE_LABEL } from "../../title-text.js";
import { modeAnchor } from "./help-anchors.js";
import { HelpRef, type HelpModeExtra } from "./help-parts.js";

/**
 * **"Reach for it when…"**, one line per mode, for the table in "Which mode
 * when". Total over `Mode`, so the table can never be missing a mode.
 */
export const MODE_WHEN: Record<Mode, ReactNode> = {
  plain: "you want the article and nothing else, or a way out of any other mode",
  chat: "you have a question of your own",
  glossary: "the piece uses words in a way you do not quite follow",
  search: "you are looking for a passage, by its words or by what it says",
  referee: "you have been asked to peer-review it",
  summary: "you need to decide whether this is worth reading at all",
  diagram: "you think better from a picture of the argument",
  ideas: "you want to know what the piece takes for granted, and what it adds",
  remember: "you have finished and want to test what you took from it",
  quotes: "you want the lines worth keeping, in the piece’s own words",
  timeline: "the piece tells a story in time and you have lost track of the order",
  debate: "you want to know what other people have said about it",
  structure: "you want to see how the piece is built, and where you are in it",
  citations: "you want what the piece leans on, with links",
  faq: "you want the questions a careful reader would ask, and where the piece answers them",
  skim: "you want to go round a paper more than once, a little deeper each time",
  tweets: "you want the argument as a short numbered run, or something to share",
  marginalia: "you want a few quiet notes beside the text while you read",
};

const CELL = "tw:border-b tw:border-rule tw:py-1.5 tw:align-top tw:text-left";

/**
 * **The "Which mode when" table**, every mode in `MODES` order. Two columns
 * that wrap rather than scroll: on a 390px phone the name column takes only
 * its longest word, and the experimental marker sits under the name rather
 * than beside it so it does not widen that column.
 */
export function ModesTable() {
  return (
    <table className="tw:w-full tw:border-collapse tw:text-sm">
      <thead>
        <tr>
          <th scope="col" className={`${CELL} tw:pr-3 tw:font-semibold tw:text-foreground`}>
            Mode
          </th>
          <th scope="col" className={`${CELL} tw:font-semibold tw:text-foreground`}>
            Reach for it when…
          </th>
        </tr>
      </thead>
      <tbody>
        {MODES.map((m) => (
          <tr key={m}>
            <th scope="row" className={`${CELL} tw:pr-3 tw:font-normal`}>
              <HelpRef to={modeAnchor(m)}>{MODE_LABEL[m]}</HelpRef>
              {MODE_CATALOG[m].experimental && (
                <span className="tw:block tw:text-xs tw:text-ink-faint">experimental</span>
              )}
            </th>
            <td className={`${CELL} tw:break-words`}>{MODE_WHEN[m]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * **What Help adds to each mode.** Total over `Mode`: this is the check that
 * keeps the page current for the commonest change there is, a new mode.
 */
export const HELP_MODES: Record<Mode, HelpModeExtra> = {
  plain: {
    keywords: "article text only close exit back to reading no panel clean distraction free default",
    whenToUse: (
      <p>
        For reading straight through. Open a mode when you hit something you want help with, then
        press <strong>Plain</strong> to come back; it closes the Marginalia column too. Pressing the
        mode you are in a second time also closes it. Plain is the first button in the bottom bar,
        in a box of its own, and on a phone the only one that keeps its name, so you can always find
        your way out.
      </p>
    ),
    reading: (
      <p>
        One thing carries over: once an article has a glossary, its terms stay underlined with orange
        dots in Plain. Point at one to read its definition without opening anything.
      </p>
    ),
  },

  chat: {
    keywords: "ask question conversation answer explain talk voice live speak dictate microphone help understand paragraph",
    whenToUse: (
      <>
        <p>
          When you have a question of your own: what a sentence means, whether a claim follows, how
          two passages fit together. It is the wrong tool for “summarise this” — Summary and
          Structure already do that, and Chat has no summarising tool on purpose.
        </p>
        <p>Quicker ways in than the Chat button:</p>
        <ul>
          <li>
            <strong>The speech-bubble in a paragraph’s margin</strong> opens a chat about just that
            paragraph. Nothing is asked until you send.
          </li>
          <li>
            <strong>The ? in a paragraph’s margin</strong> asks “Help me understand” straight away.
          </li>
          <li>
            <strong>Select some words</strong> to get a comment box with an{" "}
            <strong>Also ask the AI about it</strong> tick-box.
          </li>
        </ul>
        <p>Chat is only for whoever added the article; on someone else’s shared article its button is dimmed.</p>
      </>
    ),
    reading: (
      <>
        <p>
          The short codes in an answer are links to the paragraphs it relied on. Click one to jump
          there, or point at it to read the start first. A dimmed code is a paragraph the article no
          longer has. Check the passage before you trust the claim — that is what the codes are for.
        </p>
        <p>The lines above an answer say where else Chat looked:</p>
        <ul>
          <li>
            <strong>searched the web</strong>: the pages it used are listed under the answer as{" "}
            <strong>From the web</strong>.
          </li>
          <li>
            <strong>searched your library for …</strong>: it searched your other saved articles. This
            matches words, not meaning, so if it finds nothing, try other words before you conclude
            you never read about it.
          </li>
          <li>
            <strong>read</strong> and a site name: it fetched that page.
          </li>
        </ul>
        <p>An answer with none of these came from the article alone. Chat decides when it needs them.</p>
        <p>
          Each article keeps its own conversations under <strong>All conversations</strong>.{" "}
          <kbd>Enter</kbd> sends and <kbd>Shift Enter</kbd> starts a new line; <kbd>Esc</kbd> stops an
          answer still arriving. <strong>Answer again</strong> gets a fresh answer, and the pencil lets
          you rewrite your question.
        </p>
        <p>
          <strong>Talking instead of typing.</strong> The microphone turns your speech into text in
          the box, to edit before you send; a recording stops after five minutes.{" "}
          <strong>Live</strong>, beside it, is a spoken conversation you can interrupt. Your audio goes
          directly to OpenAI. What is said joins the same conversation, so you can hang up, type for a
          while, and press <strong>Live</strong> again. A call ends after five minutes of quiet, or
          twenty minutes in all.
        </p>
      </>
    ),
  },

  glossary: {
    keywords: "terms definitions define jargon words meaning underline dotted vocabulary people places concepts dictionary",
    whenToUse: (
      <>
        <p>
          Early in a piece from an unfamiliar field, or one where the author gives everyday words a
          narrower meaning. After that you rarely need the panel, because the terms are{" "}
          <strong>underlined with orange dots in every mode</strong>. If the piece is in your own
          field, skip it.
        </p>
        <p>
          If a word you need is missing, type it into <strong>Look up a term…</strong>: that explains
          the passage it is in, without adding it to the list. <strong>Find more</strong> looks for
          quieter terms, and <strong>Dig deeper</strong> on an entry searches the web. On someone
          else’s shared article you see the glossary already made, but cannot add to it.
        </p>
      </>
    ),
    reading: (
      <>
        <p>
          Clicking an underlined word does nothing: point at it for the card, and use the card’s{" "}
          <strong>in the glossary</strong> button for the full entry. On a touchscreen, tap once for
          the card and again for the entry. Press <kbd>G</kbd> in a paragraph to jump to its terms.
        </p>
        <p>In an entry:</p>
        <ul>
          <li>
            <strong>in this piece</strong> comes from the article. <strong>background</strong> is what
            the AI knows about the term, checked against nothing, so give it less weight.
          </li>
          <li>
            <strong>used in N places</strong> links to each place the term appears.
          </li>
          <li>
            The icon says what kind of thing the term is: a person, place, organisation, event, or a
            work such as a book or paper. Ideas and ordinary terms have none.
          </li>
        </ul>
        <p>
          The list opens on <strong>prioritised</strong>: only the terms that are hard and carry the
          argument, in the order the article introduces them. The <strong>threshold</strong> slider
          sets how many: left for more, right for fewer. The two small bars on a row are how hard the
          term is and how much of the argument rests on it, both the AI’s judgement. Choose{" "}
          <strong>first use</strong> to see every term.
        </p>
      </>
    ),
  },

  search: {
    keywords: "find look for passage words meaning quick fast phrase highlight mark colour where does it say semantic theme",
    whenToUse: (
      <>
        <p>
          Use <strong>words</strong> when you remember a phrase. Use <strong>meaning</strong> to ask a
          question of the whole piece — “where does he concede a weakness?”, “anywhere she gives
          numbers” — or to follow a theme through a long article. Search opens on meaning, so switch
          to words for an exact look-up. Your browser’s own Find works as usual.
        </p>
        <p>
          <strong>quick</strong> asks the same kind of question and answers in about a second: a
          fast model scores every paragraph, and the ones that match are marked whole, with no
          reasons. Use it for a first look; <strong>flesh out</strong> on a quick search runs the
          full meaning search on the same words.
        </p>
      </>
    ),
    reading: (
      <>
        <p>
          Each meaning search gets its own colour, and its matches are marked in the text in that
          colour and <strong>down the spine</strong> as thin bars, so you can see at a glance whether a
          theme sits in one place or runs through the whole piece — see{" "}
          <HelpRef to="spine">Reading the spine</HelpRef>.
        </p>
        <p>
          Tick several searches to show them together; click a search’s words to show only that one.{" "}
          <strong>↺</strong> puts the question back in the box to ask again.
        </p>
        <p>
          Each match has a score out of 100. It is the AI’s judgement of its own answer, not a
          measurement, so read a high score as “worth a look” rather than “certain”.{" "}
          <strong>prioritised</strong>, the default, hides weak matches from the list <em>and</em> the
          text; if you expected more marks, move the <strong>confidence</strong> slider left.
        </p>
        <p>Which searches are showing is part of the address, so a link you send opens with the same marks.</p>
      </>
    ),
  },

  referee: {
    keywords: "peer review reviewer reviewing paper manuscript criteria claims assess evaluate journal conference critique",
    whenToUse: (
      <>
        <p>
          When you are reviewing a paper and want help being thorough without handing over the
          judgement. It is built for public preprints, open-review submissions, and drafts the author
          has agreed to share. <strong>Do not put a manuscript you received in confidence through
          it</strong>: many funders, publishers and conferences count sending one to an AI service as a
          breach of confidentiality, and where a venue does allow AI help it usually asks you to say
          so.
        </p>
        <p>Four parts, chosen by the chips at the top:</p>
        <ul>
          <li>
            <strong>Criteria</strong>: write what you are judging against, or start from a preset such
            as <strong>Controls</strong> or <strong>Strength of evidence</strong>, then press{" "}
            <strong>Run this criterion</strong>.
          </li>
          <li>
            <strong>Claims</strong>: what the paper promises, each beside the passages meant to deliver
            it.
          </li>
          <li>
            <strong>Mirror</strong>: reads your own comments back and flags any an author would find
            hard to act on, or that you should check against the passage. It sees only your comments
            and the passages you marked. It is not saved, so leaving Mirror loses it.
          </li>
          <li>
            <strong>Candidates</strong>: the expertise a reviewer would need, then names if you ask. No
            conflict-of-interest check is run, and it may send words from the paper to a search engine.
          </li>
        </ul>
        <p>Referee is only for whoever added the article.</p>
      </>
    ),
    reading: (
      <>
        <p>
          <strong>Hidden instructions</strong>, at the top, checks the original web page for text a
          person would not see but an AI would read — text the colour of its background, too small to
          read, invisible characters, instructions written to a model. It reports and blocks nothing.
          “Nothing found” is not a clean bill: PDFs and some parts of a page are not checked, and it
          says which.
        </p>
        <p>Colour means two different things:</p>
        <ul>
          <li>
            A <strong>For / against</strong> criterion colours each passage by which way it cuts: red
            towards “against”, green towards “for”, with a sign too — − against, + for, · neither, ±
            both.
          </li>
          <li>Every other mark’s colour says only which criterion or claim made it. It carries no judgement.</li>
        </ul>
        <p>
          The number beside a criterion’s passage is the AI’s ordering of its own answers, not a
          score, and nothing adds them up. “The model did not find a passage” tells you about the
          search, not the paper. Fewer passages under a claim does not make it a weaker claim.
        </p>
        <p>
          When you comment on a passage in Referee you can place it on a For / against criterion
          yourself, and the panel shows your placement beside the AI’s and says when you disagree.
        </p>
      </>
    ),
  },

  summary: {
    keywords: "summarise short version tldr gist overview plain english simple brief explain level length",
    whenToUse: (
      <p>
        Before you read, to decide whether a piece is worth your time and roughly where it is going;
        after, to check you came away with the main points. Not instead of reading: it keeps the gist
        and drops the reasoning, which is usually the part worth having. Pick <strong>Fuller</strong>{" "}
        when the piece is close to your field and <strong>Brief</strong> when it is far from it. For
        the piece’s shape, part by part, open <HelpRef to="mode-structure">Structure</HelpRef>.
      </p>
    ),
    reading: (
      <>
        <p>
          The slider has no names on it: the left end is <strong>Brief</strong>, the middle{" "}
          <strong>Simple</strong>, the right end <strong>Fuller</strong>, which keeps more of the
          piece’s own terms. Point at the slider to see which is showing.
        </p>
        <p>
          When a sentence surprises you, follow the code after its paragraph and read what the author
          actually wrote.
        </p>
        <p>
          If you have filled in your <HelpRef to="reader-profile">reader profile</HelpRef>, the
          summary is written with it in mind, and a small badge says so. <strong>Write it again</strong>{" "}
          gives you a fresh one.
        </p>
      </>
    ),
  },

  diagram: {
    keywords: "sketch picture visual map drawing illustrated painting shape argument chart graph force drift trail",
    whenToUse: (
      <p>
        The <strong>Sketch</strong> is worth the wait for a long or tangled argument, where seeing its
        shape at once — three reasons meeting at a conclusion, a ladder of steps, a main line with
        side trips — tells you how to read the rest. For a short piece with one line of argument, skip
        it. On someone else’s shared article you see a Sketch only if one has already been drawn.
      </p>
    ),
    reading: (
      <>
        <p>
          The Sketch mostly runs down the page in the article’s order, and nothing in it is to scale.
          Point at a box to read more; click one to jump to its passage, though not every box has one.
          Click a region’s name to zoom into that part, and use <strong>Back</strong> or <kbd>Esc</kbd>{" "}
          to come out. <strong>Enlarge</strong> opens it full screen.
        </p>
        <p>The chips above the picture give other views:</p>
        <ul>
          <li>
            <strong>Force</strong>, <strong>Drift</strong> and <strong>Trail</strong> are diagrams
            assembled by code rather than pictures painted by a generative model. They do use an
            embedding model to judge semantic likeness: its dotted links are one of Force’s five
            relationships, and it supplies the positions for Drift and Trail. Force shows sections as
            bubbles that pull together when they talk about the same things. Drift puts one dot per
            paragraph down the page, placed sideways by subject. Trail joins Drift’s dots in reading
            order, which shows whether the piece moves forward or circles back — the one picture where
            lower down does not mean later.
          </li>
          <li>
            <strong>Illustrated</strong> is the Sketch painted as a picture. It takes four to seven
            minutes and needs a Sketch first. It is an interpretation: nothing in the painting can be
            clicked or checked, though <strong>What it depicts</strong>, under it, quotes the article
            and links to the passages. Treat the Sketch as the one to trust.
          </li>
        </ul>
      </>
    ),
  },

  ideas: {
    keywords: "assumptions premises propositions key points takeaways background knowledge prerequisites concepts assumes",
    whenToUse: (
      <p>
        Before a hard piece, to see what it expects you to know: <strong>What you need to bring</strong>{" "}
        lists the ideas it leans on and never states, and one that is new to you explains why a
        passage felt opaque. After reading, <strong>What this piece adds</strong> is a short list of
        the ideas worth taking away. Less useful for news or narrative, which rarely assume much.
      </p>
    ),
    reading: (
      <>
        <p>
          Click an idea to open it and mark all its passages in the text; the arrows step through
          them. Click it again to clear the marks.
        </p>
        <p>
          The heading over the passages matters. For an idea you need to bring it says{" "}
          <strong>The model thinks these passages rely on it</strong> — the AI’s reading, which the
          article never states. For an idea the piece adds it says{" "}
          <strong>Where the piece states it</strong>. <strong>One way to picture it</strong> is the
          AI’s own comparison, not the author’s.
        </p>
        <p>
          Your <HelpRef to="reader-profile">reader profile</HelpRef> shapes what counts as something
          you need to bring.
        </p>
      </>
    ),
  },

  remember: {
    keywords: "recall memory quiz test yourself questions retention learn check understanding explain back study revise",
    whenToUse: (
      <>
        <p>
          When you have finished a piece, or a part of one, and want it to stick. Saying what you took
          from something and finding out where you went wrong does more for memory than reading it
          again. For something you will not need next week, it is not worth the effort.
        </p>
        <ul>
          <li>
            <strong>Recall</strong>: say or type what you took from the piece, untidily if you like —{" "}
            <strong>Talk</strong> for the microphone, or <strong>Live conversation</strong> to talk it
            through out loud. The reply points at one to three places where your account comes apart
            from the article. It does not praise or grade you, and disagreeing with the author is not
            counted as misunderstanding. There is one Recall conversation per article; the bin icon
            starts it over.
          </li>
          <li>
            <strong>Quiz</strong>: up to twenty short questions written from the piece, each answered
            in a sentence or two. Writing them takes about a minute the first time.
          </li>
        </ul>
        <p>Remember is only for whoever added the article.</p>
      </>
    ),
    reading: (
      <>
        <p>
          In Recall, the <strong>Reply</strong> menu sets how hard it pushes back:{" "}
          <strong>Balanced</strong> (the default) tells you plainly when you are stuck and asks a
          question only when the gap is small; <strong>Respond</strong> says where your account and the
          article differ, quoting the article; <strong>Socratic</strong> asks one question, with a hint
          and a passage to look at; <strong>Signposts</strong> only points to passages worth re-reading.
          Whichever you choose, saying “just tell me” gets a plain answer.
        </p>
        <p>
          A Quiz mark says what you got, what is missing and where to look. There is no score.{" "}
          <strong>Show a reference answer</strong> is one good answer, not the only right one; if it and
          the article disagree, the article wins. Your answers and marks are not saved once you leave
          the page — only the questions are kept.
        </p>
        <p>
          Once a quiz exists, each question also appears as a faint line in the text after the passage
          it is about, in every mode. Press it to answer.
        </p>
      </>
    ),
  },

  quotes: {
    keywords: "quotations excerpts best lines highlights memorable sentences outline important striking keep",
    whenToUse: (
      <p>
        When you want to carry lines out of the piece in its own words — for notes, a review, or to see
        what the author put best. Quotes is also what <HelpRef to="mode-skim">Skim</HelpRef> walks you
        through. <strong>Find more</strong> adds lines to the list rather than replacing it.
      </p>
    ),
    reading: (
      <>
        <ul>
          <li>
            <strong>Once made, quotes are outlined in the text in every mode.</strong> A thicker, darker
            outline means the AI judged the line more important or more striking. Search results are
            filled with colour and quotes are only outlined, so the two never look alike.
          </li>
          <li>
            Each row carries two numbers: how much of the argument rests on the line, and how memorable
            it is. Both are the AI’s judgement.
          </li>
          <li>
            The <strong>(i)</strong> beside a row says why it was chosen. Press a row to jump to it in
            the text.
          </li>
          <li>
            <strong>in order</strong> (the default) lists them as the article says them;{" "}
            <strong>prioritised</strong> keeps only those above the slider and says how many it is
            hiding; <strong>most important</strong> and <strong>most striking</strong> sort by either
            score.
          </li>
        </ul>
        <p>
          A line the AI suggested that cannot be found in the article is thrown away, and the panel
          tells you how many were.
        </p>
      </>
    ),
  },

  timeline: {
    keywords: "chronology dates events when order history sequence dated undated uncertain year",
    whenToUse: (
      <p>
        On history, reporting and narrative pieces. Every row is the article’s own claim about time,
        kept as firm or as vague as the article left it — not when things really happened. On an
        argument or a review it will often find nothing, and says so rather than padding; trying again
        would find the same nothing.
      </p>
    ),
    reading: (
      <>
        <ul>
          <li>
            <strong>A date</strong>, such as <em>26 May</em> or <em>at or before 12 May</em>, was read
            from the article’s own words by plain code, not by the AI.
          </li>
          <li>
            <strong>Words in quotation marks</strong>, such as <em>“another month later”</em>, are the
            article’s own phrase — as precise as the piece ever got.
          </li>
          <li>
            <strong>A dash</strong> means the piece gives no time for this at all.
          </li>
          <li>
            Where the article gives a day and month but no year, the year comes from when the piece was
            published, and the list says so.
          </li>
        </ul>
        <p>
          Events the piece only raises as possibilities (<strong>What might have happened</strong>) and
          things it expects (<strong>What the piece expects</strong>) sit in groups of their own below.
          With fewer than three events, the panel tells you the piece is not really telling a story in
          time. Press a row to see how the piece dates it and jump there in the text.
        </p>
      </>
    ),
  },

  debate: {
    keywords: "critiques reception responses reviews criticism replies web what others say reaction sources supportive critical",
    whenToUse: (
      <p>
        For a well-known paper, a contested essay, or anything you are about to rely on; not for a
        blog post nobody has linked to. It waits for you to press <strong>Search the web</strong>, and
        takes about half a minute. Most pieces turn out to have no reception at all, and it says so —
        a real answer, not a failure. Only whoever added the article can run the search; visitors to a
        shared article see what has already been found.
      </p>
    ),
    reading: (
      <ul>
        <li>
          Anything tagged <strong>AI</strong> is the AI’s reading, checked against nothing: the threads
          across sources, the key-source picks (starred), each page’s lean (Supportive, Critical,
          Neither for nor against, Could not tell) and its relevance. Quoted excerpts, by contrast, are
          checked against what the search returned.
        </li>
        <li>
          <strong>Threads across these sources</strong>, at the top, are themes several sources share.
          Press one to show only its sources.
        </li>
        <li>
          Two sliders thin the list: <strong>identification</strong> is how firmly a page points at
          this article (names it, quotes it, links to it), <strong>relevance</strong> how directly it
          bears on the claim it answers.
        </li>
        <li>
          Orders: <strong>prioritised</strong> (replies to this piece first), <strong>by claim</strong>,{" "}
          <strong>date</strong> and <strong>stance</strong> (most critical first).
        </li>
      </ul>
    ),
  },

  structure: {
    keywords: "outline contents table of contents tree map hierarchy sections parts shape headings navigate overview",
    whenToUse: (
      <>
        <p>
          To get your bearings before you start, or to see where you are and what is left. Nothing is
          generated when you open it, so it is instant, and visitors to a shared article see it too.
        </p>
        <p>
          <strong>Structure and the <HelpRef to="spine">spine</HelpRef> are the same parts, drawn two
          ways.</strong> The spine shows <em>where</em> you are and how big each part is, with names
          only on hover; Structure gives the names and summaries, but not the sizes.
        </p>
      </>
    ),
    reading: (
      <>
        <p>
          In <strong>Fisheye</strong>, where a column has no room for every row it says how many come
          earlier or later. <strong>Expanded</strong> follows you only when you move into another
          section, so if you scroll it by hand it keeps your place until then. Press any row to jump
          there.
        </p>
        <p>
          <kbd>←</kbd> in the middle of a section goes back to that section’s start first. Titles here
          leave off the article’s own numbering (“3.2 Methods” shows as “Methods”); the text and the
          spine keep it.
        </p>
      </>
    ),
  },

  citations: {
    keywords: "references bibliography sources works cited papers links doi arxiv scholar footnotes influence relevance",
    whenToUse: (
      <p>
        For an academic paper or a report, where the question is “what is this built on, and where do I
        find it?” Making the list and <strong>Dig deeper</strong> are for whoever added the article;
        visitors to a shared article see the stored list.
      </p>
    ),
    reading: (
      <>
        <ul>
          <li>
            Each row says what we have read of the work, which is usually nothing: the sentence on what
            the piece uses it for is written from the article, not from the cited work.
          </li>
          <li>
            Two small bars: <strong>relevance</strong> to this piece, and <strong>influence</strong> in
            its field.
          </li>
          <li>
            <strong>first cited</strong> jumps to where the article first cites it.{" "}
            <em>only in the references</em> means the article lists it but never cites it in the text.
          </li>
          <li>
            <strong>In your library</strong> or <strong>On the public shelf</strong> means the work is
            already an article here, and links straight to it.
          </li>
          <li>
            Once the list exists, the places a work is cited are underlined with a dashed line in the
            text, in every mode. Point at one, or tap it, to see the work.
          </li>
        </ul>
        <p>
          Orders: <strong>prioritised</strong> (the default, with a slider), <strong>first cited</strong>,{" "}
          <strong>relevance</strong> and <strong>influence</strong>.
        </p>
      </>
    ),
  },

  faq: {
    keywords: "questions frequently asked objections queries interrogate understand clarify answers passages careful reader",
    whenToUse: (
      <p>
        On a dense piece, to find the objections it anticipates and how one part bears on another, or
        after a first read, to check you saw what it was answering. Expect to read rather than to be
        told. Only whoever added the article can make the list; visitors to a shared article see one
        already made.
      </p>
    ),
    reading: (
      <ul>
        <li>
          The quoted passages are the article’s own words, checked against it. Which passage answers
          which question is the AI’s reading.
        </li>
        <li>
          In <strong>prioritised</strong>, the default, the slider decides how many questions show.
        </li>
        <li>Press a passage to jump to it in the text.</li>
        <li>
          There are at most twelve questions, and “The model found no questions worth asking this piece”
          is a real answer.
        </li>
      </ul>
    ),
  },

  skim: {
    keywords: "skimming quick read route spiral trajectory stops depth gist more most tour fast overview",
    whenToUse: (
      <p>
        When you need the shape of a paper fast but do not want a summary in place of the text: every
        stop is the author’s sentence, in place, in context. <strong>Gist</strong> is a handful of
        stops, <strong>More</strong> about a dozen, <strong>Most</strong> a larger share of the piece.
        The order is planned for you — the results first, say, then a quick look at the methods — not
        the article’s. Only whoever added the article can plan a route; visitors to a shared article
        can walk one already planned.
      </p>
    ),
    reading: (
      <ul>
        <li>
          <kbd>‹</kbd> <kbd>›</kbd> at the top, or <kbd>←</kbd> <kbd>→</kbd> while reading, step from stop
          to stop. <strong>Next stop ›</strong>, in the text under the current stop, does the same, and at
          the end of a pass becomes <strong>More detail ›</strong>.
        </li>
        <li>Each stop has a short cue above it: what to <em>look for</em> in the passage, never what it found.</li>
        <li>
          Under the current stop, a card gathers what other modes have already found there:{" "}
          <strong>Terms it uses</strong> and <strong>Ideas it bears on</strong>.
        </li>
        <li>The dot beside each row shows how far through the article that stop is, so you can see the route jump about.</li>
        <li>
          <strong>Reading for:</strong> at the top is what you said you want from this article; the route
          is planned around it. <strong>Edit</strong> changes it.
        </li>
      </ul>
    ),
  },

  tweets: {
    keywords: "thread twitter x bluesky social share post copy short numbered",
    whenToUse: (
      <p>
        To get the argument in a dozen steps, or to share the piece. Unlike most modes it starts writing
        as soon as you open it, the first time, on your own article. A thread is a compression: treat it
        as a way in, not a stand-in for the text.
      </p>
    ),
    reading: (
      <ul>
        <li>
          Under each post, <strong>From</strong> links to the passages it came from.
        </li>
        <li>
          Each post shows its character count against the limit; a count in red means it is over. What
          the AI wrote is what you see.
        </li>
        <li>
          <strong>Copy the thread</strong> copies every post, numbered, with the article’s title and link
          at the top. The copy icon on a post copies just that post.
        </li>
        <li>
          The <strong>(i)</strong> compares the thread’s characters with the article’s words, which tells
          you how much it had to leave out.
        </li>
      </ul>
    ),
  },

  marginalia: {
    keywords: "margin notes annotations sidenotes right column questions assumes introduces side notes",
    whenToUse: (
      <p>
        While you read, as a quiet companion. Unlike the other modes it is a switch rather than a
        choice: the <strong>Marginalia</strong> button sits at the right-hand end of the modes in the
        bottom bar, and its column can stay open beside any other mode’s panel. It is sparse on
        purpose — one question per part, and a mark where an idea occurs. In a narrow window it tells you
        so, and if another mode’s panel is open, pressing <strong>Marginalia</strong> again swaps the
        notes in for it.
      </p>
    ),
    reading: (
      <ul>
        <li>
          <strong>A question with a thin line beside it</strong> is the question that part of the article
          answers; read on to find the answer. The one at the very top is the question the whole article
          answers.
        </li>
        <li>
          <strong>“assumes …”</strong> marks an idea the piece takes for granted;{" "}
          <strong>“introduces …”</strong> one it puts forward and argues for. Each sits beside the first
          passage where the idea occurs; point at it or tap it to read the idea in full. These appear
          only once <HelpRef to="mode-ideas">Ideas</HelpRef> has been made.
        </li>
        <li>The top of the column shows where you are, and where the argument has got to.</li>
      </ul>
    ),
  },
};
