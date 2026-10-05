/**
 * Everything we know about an article, on a page of its own.
 *
 * `/read/<slug>/metadata`. Greg, 2026-08-25, on where it should live:
 *
 * > The Metadata view (which maybe needs its own `/read/[slug]/metadata/` url so
 * > it can have the page to itself.
 *
 * and on what should happen to the drawer panel it replaces:
 *
 * > We can get rid of the panel, and move all its contents into the new page.
 *
 * So this is not an addition alongside the About panel — it *is* that panel,
 * grown into the room it needed, and Dock.tsx no longer has one. The reason a
 * page rather than a column or a drawer: this view's hard problem is horizontal
 * (docs/plans/260825c-bottom-bar.md#why-the-bottom), and a page has no such problem
 * because it is not beside anything.
 *
 * **Opening it generates nothing and makes no model call.** This is the page
 * you open when something looks wrong, so its statistics are computed from
 * artefacts already written.
 *
 * *Statistics*, and not *every number on it*, which was the draft and is
 * overbroad in the same breath as a correction — the read-time stat divides by
 * a flat `WPM` this repo chose (reading-time.ts), and a rerun row's cost note
 * quotes a fixed wait. Neither comes from an artefact. GPT Sol, 2026-09-08.
 *
 * That is narrower than *nothing here is generated*, which is what this line
 * said until 2026-09-08 and which had stopped being true twice over: the page
 * shows the tree's `gist` and `summary` (§ In one sentence), and since
 * 2026-09-07 it can start a run of its own (§ AI processing, below, one
 * button per step). Neither happens on arrival, and *on arrival* is the half a
 * reader here is trusting.
 *
 * It is worth saying why the old sentence is worth this much space. It was
 * copied out of this docblock into the Metadata button's hover card on
 * 2026-09-07, where a reader would have read it — the card was corrected before
 * it shipped, but only because a cross-family review went looking
 * (docs/plans/260907b-rich-tooltips-on-the-dock-modes.md § Stage 2). A stale
 * header is not a private matter between a file and its next author.
 *
 * ## The second pass, 2026-08-25: what came back from the original
 *
 * The first version of this page was correct and plain — five headings with a
 * line of text under each. Asked to look again at what the previous version's
 * `MetadataPanel.tsx` did better, four things came across, and all four are
 * about *legibility* rather than about new facts:
 *
 *  - **Cards, not rules.** Their sections were surfaces with divided rows.
 *    Ours were prose under a horizontal rule, which reads as one continuous
 *    page rather than as separate answers. Same tokens as the library cards
 *    (Library.tsx), so the two pages look like one app.
 *  - **The counts are a grid of numbers, not a sentence.** "9,142 words · 40
 *    min · 214 blocks" makes you parse a sentence to find one number. Six stat
 *    cards, each with the number big and the label small, is the thing you can
 *    read at a glance — which is what the section is for.
 *  - **A pill per stage, not a tick in a table column.** Theirs said
 *    "Generated" / "Not generated" as a coloured pill and it is much easier to
 *    scan down. The 4-column table also needed `overflow-x` on a narrow window;
 *    rows that wrap do not.
 *  - **Tooltips that say what a number means.** Read time is the clearest case:
 *    ReadTimeCard.tsx explains the flat rate and what it cannot see. Dotted
 *    underline, `cursor-help`, same convention theirs used.
 *
 * What did **not** come across, deliberately: their gradient icon chips and
 * `shadow-sm` white cards (this app is dark, and lifted-white-on-grey is a
 * light-mode idiom that has no dark translation — depth here comes from
 * --card being *lighter* than --page, per styles.css), the difficulty badge
 * (docs/project/original-version/difficulty-and-reading-time.md), book pages,
 * and the privacy toggle and owner email, which describe an app with accounts.
 * Per-file sizes and mtimes were on that list too, until 2026-08-27 — see below.
 *
 * ## The third pass, 2026-08-27: shut the long section, and say when
 *
 * Greg:
 *
 * > In the "Metadata" section, make "What we did to it" collapsible and
 * > default-collapsed and add extra metadata (e.g. exact date times), perhaps
 * > in tooltips.
 *
 * Three changes, and the first two are the same change seen from either end.
 *
 *  - **"What we did to it" is shut when the page opens.** Nine rows of file
 *    paths is the answer to a question most visits are not asking, and it was
 *    pushing everything about *this reader* — their purpose, their questions,
 *    where they left off — below the fold. Shut, it costs one line; open, it is
 *    exactly what it was. The heading keeps the two facts a shut section would
 *    otherwise take away: how many stages have run, and when any of them last
 *    wrote.
 *  - **Every stage says when it last wrote, with the exact stamp on hover** —
 *    `Wrote`, below, and `ranAt`/`bytes` on `StageState`. This reverses a
 *    decision two paragraphs up, and the reversal is narrower than it looks:
 *    what was wrong about mtimes was the *verdict* drawn from them, never the
 *    number. Nothing compares two of these. The staleness question is exactly
 *    as unanswered as it was, and a person reading "structure ran 3 days ago, arc ran
 *    in March" can draw the conclusion this page still refuses to draw for them.
 *  - **Where a PDF came from** — `CameFrom`, below. Their Document Information
 *    had a "file type" row and ours never took it, because until 2026-08-26
 *    every article was a web page. Now some are read by a model instead
 *    (docs/project/content-extraction.md), and how well that reading was
 *    checked is a fact about trust that nothing else on this page carries.
 *
 * ## The fourth pass, 2026-08-27: Archive this article, and Put back
 *
 * Greg:
 *
 * > Add "Delete this article" functionality, both to Metadata and Homepage.
 * > Ideally it would Archive, i.e. soft-delete, so it can be undone.
 *
 * The homepage half already existed and needed nothing — the button on the card
 * and on the table row, archive rather than erase, Undo strip, the disclosure
 * at the foot of the shelf (Library.tsx, ShelfEntry.tsx). This is the half that
 * was still a dimmed placeholder here: `ArchiveArticle`, below, which carries
 * the reasoning, including why it has no strip and no dialog and why its undo
 * never expires.
 *
 * **Every one of those said "Delete" until 2026-09-04**, having only ever
 * archived — and Greg filed a report asking for the archive feature he was
 * already looking at. The second half of his own sentence above is what the
 * interface now says out loud. docs/project/library.md § Archive, and Undo is
 * the confirmation.
 *
 * **And since 2026-09-07 the word has something of its own to name**:
 * `DeletePermanently`, in a section below Archive, which really does destroy
 * the article — the first irreversible act on a reader's own data anywhere in
 * this product. It is on this page and on no other, which is Greg's decision
 * rather than an omission: the shelf card's buttons are hover-revealed and
 * adjacent, and on a phone they are all tap targets.
 * docs/plans/260906h-delete-an-article-permanently.md.
 *
 * ## The fifth pass, 2026-08-27: rename it from here
 *
 * Greg:
 *
 * > I think we have a button to edit the title of an article in the Home page.
 * > Can we add a similar button to the article page itself, and/or its Metadata.
 *
 * A pencil beside the heading, opening the shelf's own editor in place — and
 * the masthead got one at the same time (Masthead.tsx). One implementation
 * across all three, in TitleEditor.tsx, because a rename has three outcomes
 * that look identical when the happy path works. The one thing this page does
 * that the masthead does not is **withhold the pencil on the fixture**, which
 * is `showingFixture` again and exactly the refusal Archive makes below.
 *
 * ## What it deliberately does not say
 *
 * **Whether anything is stale.** The first version of this page led with a red
 * warning when a later artefact was older than an earlier one. That check is
 * wrong: a *successful* structure run writes the tree and then copies the blocks
 * beside it, so every correct run tripped it. More deeply, an mtime records when
 * a file was written, not what it was written *from*. A confident wrong verdict
 * is worse here than no verdict, because this is the page you open once you have
 * stopped trusting the others.
 *
 * **Half of that reasoning is now about the page rather than about the store,
 * and the correction matters.** This paragraph said until 2026-09-07 that the
 * honest thing was to say which stages had run *"until `tree.json` and
 * `arc.json` carry a hash of the blocks they consumed"*. The store answers that
 * now, though **not** in the shape that sentence imagined, and the difference is
 * worth stating rather than glossing: there is no `tree.json`, and `Tree`
 * carries no `sourceHash` to this day. What carries it for the tree is the
 * **run** — `revision_step_runs.input_hash`, read by `structureCurrency`, the
 * very function `reasonsNotToPublish` uses — while `Arc` does carry a
 * `sourceHash` of its own. `articleMetadata` (src/store/pg.ts) puts a per-step
 * `isCurrent` over both, which is why `StageState.done` has meant *ran, and
 * would not be re-run today* since the Postgres move.
 * **So the store can answer; this page cannot say.** `done` is one boolean
 * carrying two facts, and `StageRow` renders it as a two-state pill, so a
 * *stale* glossary reads here as *not run* beside a glossary the reader can open
 * next door. Telling *absent* from *stale* needs a second field, and that is
 * named and deferred in
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md.
 *
 * What has **not** changed is the rule: no verdict this page cannot stand
 * behind. *AI processing* offers a re-run and claims nothing about whether
 * you need one, which is exactly why it could ship while the placeholder it
 * replaced could not.
 *
 * **How hard the article is to read.** No badge, and no paragraph explaining
 * the absence either; the case is in
 * original-version/difficulty-and-reading-time.md. It was *"not in the 'not
 * built yet' section at the bottom either"* — that section and its one row went
 * on 2026-09-07 when the row shipped (see the note where `SOON` stood), so what
 * is left of the distinction is this: an absence here is a decision, and it is
 * recorded rather than left to be rediscovered as an oversight.
 *
 * Tailwind utilities rather than a block in styles.css: this page is chrome,
 * and chrome is what Tailwind is here for
 * (docs/project/web-client.md#tailwind-and-shadcn-components). Every class needs
 * the `tw:` prefix — unprefixed names silently do nothing.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useQueryState } from "nuqs";
import { pageTitle, useDocumentTitle } from "./page-title.js";
import {
  Archive,
  ArrowLeft,
  ArrowRightLeft,
  Blocks,
  Bot,
  BookA,
  CircleDashed,
  Lightbulb,
  BookOpen,
  Clock,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  IdCard,
  FileQuestion,
  FileType,
  Fingerprint,
  Globe,
  Image,
  Layers,
  Link2,
  CornerDownRight,
  List,
  ListOrdered,
  ListTree,
  MessageCircle,
  MessageCircleQuestionMark,
  MessagesSquare,
  Paintbrush,
  PenLine,
  RefreshCw,
  RotateCcw,
  Route,
  ScanLine,
  Tag,
  Target,
  Trash2,
  TriangleAlert,
  Undo2,
  Upload,
  Waypoints,
  Quote,
} from "lucide-react";
import type {
  Article,
  ArticleMetadata,
  ArticleSharing,
  Meta,
  SourceGuess,
  StageState,
  StepName,
  Visibility,
} from "../types.js";
import { MAX_PURPOSE_CHARS } from "../types.js";
/* The steps this page will re-run, from a leaf rather than from
   `src/pipeline.ts` — which is a server module the client may not import
   (tests/client-imports.test.ts). See src/rerun-steps.ts. */
import { METADATA_RERUN_STEPS, type MetadataRerunStep } from "../rerun-steps.js";
import { ReadTimeCard } from "./ReadTimeCard.js";
import { isWebUrl } from "../urls.js";
import { leavePurpose, savePurpose } from "./purpose.js";
import { Dock, withPanel } from "./Dock.js";
import { Link } from "./Link.js";
import { atParam, type MetadataSection, sectionParam } from "./params.js";
import { LIBRARY_HREF, PROFILE_HREF, carriedSearch, navigate, readHref } from "./router.js";
import { cameOffADisk, journalBesideSite, SourceLink, webSource } from "./SourceLink.js";
import { articleStats } from "./stats.js";
import { EditableTitle, type OnRenamed, useArticleRename } from "./TitleEditor.js";
import { TagEditor } from "./TagEditor.js";
import { editArticleTags, type TagChange } from "./article-tags.js";
import { TipNote, Tooltip, TooltipGroup } from "./Tooltip.js";
import { AuthorNames, AuthorSearchLinks } from "./AuthorNames.js";
import { howLong, publishedOf, relativeAgo, timeAgo } from "./relative-time.js";
import { useNow } from "./useNow.js";
import { SLOW_AFTER_MS } from "./useSlow.js";
import { useExperimental } from "./useExperimental.js";
import { type ArchiveControl, useArchive } from "./useArchive.js";
import { downloadExport } from "./export-download.js";
import { apiFetch, readJson, statusOf } from "./lib/api.js";
import { cachedReaderNow, forgetCachedReader } from "./lib/cached-shelf.js";
import { ownLabel } from "./lib/own-label.js";
import { AccessSharing, asArticleSharing } from "./AccessSharing.js";
import { PrivateLink } from "./PrivateLink.js";
import { isAdmin } from "../admin.js";
import { ArticleCostBody, articleCostSummary, useArticleCost } from "./ArticleCost.js";
import { CARD } from "./card.js";
import { useSession } from "./useSession.js";
import { ProfileBox } from "./ProfileBox.js";
import { useAutosavedText } from "./useAutosavedText.js";
import { GuessedSourceLink } from "./Masthead.js";
import { CONTENTS_MARGIN, PageContents, useRevealOnArrival } from "./PageContents.js";
/* The section every card on this page sits in. It lived in this file until
   2026-10-03, when `/profile` needed the same folding (plan 261003k). */
import { Section, sectionId } from "./PageSection.js";
import { Button } from "@/components/ui/button";
import { HighPowerSwitch } from "./HighPowerSwitch.js";
import { JobProgress } from "./JobProgress.js";
import { ResetArticle } from "./ResetArticle.js";
/* The labels and notes the command bar shares — that file's header says why
   they are not here. */
import { RERUN_COST_NOTE, RERUN_LABEL } from "./rerun-commands.js";
import { useOrderedRead, type ArtefactRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";
import { articleTitleVoice, voiceClass, withVoice } from "./voice.js";

/**
 * Clear of the fixed bottom bar, in terms of `--dock-space` rather than a number.
 *
 * **`--dock-space`, not `--dock-h`.** The bar's own height is no longer the room
 * it takes: since 2026-08-28 it also carries the home indicator's inset as
 * padding (styles.css § tokens), and on an iPhone that inset is 34px against
 * the 2rem of slack this line adds — so the last paragraph of this page would
 * have finished two pixels under the bar rather than clear of it. GPT Sol,
 * 2026-08-28.
 *
 * `.reader` has its own bottom padding for this (styles.css) and is not
 * reusable here — it also applies the spine's left padding and the reading
 * view's width rules, none of which mean anything on a page of prose-width
 * chrome. So this page states its own clearance, and states it against the same
 * token, because a hard-coded 6rem is right until somebody changes the bar.
 */
/* The underscores are not decoration: Tailwind turns `_` into a space, and CSS
   `calc()` REQUIRES whitespace around `+`. Written closed up it compiles to
   `calc(var(--dock-h)+2rem)`, which is invalid, so the browser drops the whole
   declaration — no error anywhere, just a page whose last line sits under the
   bar. */
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-space)_+_2rem)]";

/* The card surface, said once — and now said in card.ts, because the sharing
   card's preview page needs the same string and a second copy of it is a copy
   that goes stale in the one place screenshots are taken from. */


/**
 * A glyph per pipeline stage, so the rows are scannable before they are read.
 *
 * Keyed by `StepName`, which means adding a stage to src/pipeline.ts and
 * forgetting it here is a typecheck failure rather than a blank cell.
 */
const STAGE_ICONS: Record<StepName, ComponentType<{ size?: number }>> = {
  fetch: Download,
  /* The title and abstract off a minimal paper's first pages: a card, not a page. */
  metadata: IdCard,
  extract: FileText,
  blocks: Blocks,
  structure: ListTree,
  /* A luggage tag: the short label each paragraph is given so it can be told
     apart from its neighbours. Beside the tree it is written onto, and
     deliberately not another tree glyph — the two are one stage of the pipeline
     and two steps, and the rows have to be distinguishable at a glance.
     docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md. */
  labels: Tag,
  assets: Image,
  arc: Waypoints,
  tweets: ListOrdered,
  glossary: BookA,
  ideas: Lightbulb,
  quotes: Quote,
  /* A route: the stops are the quotes one row up, in an order. The Skim
     band is stage 2 of docs/plans/260928a and may choose its own glyph. */
  skim: Route,
  /* The same clock the Dock puts on the Timeline button, so the stage row and
     the mode button a reader has already met say the same thing. */
  timeline: Clock,
  /* A question mark in a bubble: the questions the piece asks back, and the one
     stage here whose artefact is a prompt to the reader rather than a reading
     of the article. Not `FileQuestion`, which this page already uses for the
     "no raw document" state a few rows down. */
  quiz: MessageCircleQuestionMark,
  /* The same bubble as `quiz`, reused rather than a new import — the FAQ panel
     is stage 2 of docs/plans/260916d-faq-mode.md and may choose its own glyph. */
  faq: MessageCircleQuestionMark,
  /* Two arrows, one each way: how a paragraph bears on the one before it.
     docs/plans/261003f-marginalia-relation-words-and-timeline-events.md. */
  relations: ArrowRightLeft,
  sketch: PenLine,
  /* A paintbrush beside the sketch's pen: the same argument, painted rather
     than drawn. docs/project/diagram.md § Illustrated. */
  illustrated: Paintbrush,
  /* Two speech marks facing each other: the one stage whose artefact is other
     people's words rather than a reading of these ones.
     docs/plans/260905f-debate-mode-what-the-web-says-about-this-piece.md.

     **The only line of `src/web/` this stage touches**, and it is here because
     `STAGE_ICONS` is a `Record<StepName, …>` — the typecheck asks for it the
     moment the step exists, which is exactly what that record is for. The mode
     itself, its button and its panel are a later stage. */
  debate: MessagesSquare,
  /* A link: what the row is for is the address of each work the piece cites.
     Reused rather than a new import — the Citations panel is stage 2 of
     docs/plans/260911g-citations-mode.md, and may choose its own glyph. */
  citations: Link2,
  /* The arrow the block-link card already draws for a jump (ProseHoverCard.tsx):
     what a cross-reference does is take you to another block of the piece.
     docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md. */
  crossrefs: CornerDownRight,
  /* Summary's own glyph (Dock.tsx): Simple is a sub-mode of Summary.
     docs/plans/260930i-simple-summaries-eli15-sub-mode.md. */
  simple: Layers,
};

/**
 * The glyph for a stage **the server named**, which may be one this copy of
 * the app was built before.
 *
 * `STAGE_ICONS` is complete for the names in this bundle and the type says so,
 * but a stage row's `step` comes off the wire, and a copy opened from a
 * home-screen icon outlives several deploys. When `relations` was added, every
 * older copy looked it up, got `undefined`, and React took the whole app to
 * the `[render]` screen for a missing 13-pixel icon (`SPIDERYARN-READING2-BJ`,
 * `-CB`). The server sends the row's label, so with a neutral glyph the row is
 * complete. tests/metadata-unknown-stage.test.tsx.
 */
function stageIcon(step: string): ComponentType<{ size?: number }> {
  return ownLabel(STAGE_ICONS, step) ?? CircleDashed;
}

/*
 * **`SOON` and its one row stood here until 2026-09-07, and the row was this
 * feature.**
 *
 * It was the convention Dock.tsx still uses — a dimmed line saying *this is a
 * real intention, not an oversight* — and its single entry was *"Re-run a
 * stage"*. The list is gone rather than left empty because it had exactly one
 * member and the member shipped; the convention itself lives in Dock.tsx, which
 * is where this one was copied from, so the next dimmed row on this page is
 * three lines from there rather than a thing to reinvent.
 *
 * **What the row knew, kept.** Its `learned` line said the queue already
 * accepted the request and that what was missing was *"the sentence above it —
 * nothing here can honestly tell you a stage is stale until the artefacts
 * record what they were built from."* That diagnosis is why it sat unbuilt for
 * three days, and it is only half right now: `articleMetadata`'s per-step
 * `isCurrent` (src/store/pg.ts) does answer currency, and what the page still
 * lacks is a way to *say* it — see § What it deliberately does not say, above.
 * The deeper point survives all of it, and is the reason this shipped: a button
 * that offers a re-run and claims nothing about whether you need one needs no
 * such answer.
 * docs/plans/260907d-re-run-any-generated-mode-from-the-metadata-page.md.
 */

/**
 * How long to wait before admitting we are still fetching.
 *
 * Their loading rules, quoted in original-version/design-system.md#loading-states,
 * which are short and right: *"Under 1 second: No
 * loading indicator needed (distracting)"*. This request is a directory walk on
 * localhost, so it almost always beats the timer and the section simply appears
 * filled in. A spinner that flashes for 200ms is worse than nothing — the
 * flicker reads as breakage.
 */
// The same 600ms as everywhere else, and now literally the same number:
// useSlow.ts owns it, because this page and the reading view reached this rule
// independently on the same day with a constant each. Kept under the local name
// so the docstring above and the effect below still read as they did.
const LOADING_AFTER_MS = SLOW_AFTER_MS;

export function Metadata({
  slug,
  article,
  onRenamed,
  onVisibility,
  onPrivateLink,
  archive: sharedArchive,
}: {
  slug: string;
  article: Article;
  /**
   * The reader renamed the article from the heading below.
   *
   * Handed up to `ArticlePage` (App.tsx) rather than kept here, so the heading,
   * the browser tab and the reading view one click away all change together —
   * the same reason the masthead's pencil reports upwards too.
   */
  onRenamed: OnRenamed;
  /**
   * The reader threw the sharing switch below — handed up for the same reason
   * `onRenamed` is, and it is the same hazard: the article payload is fetched
   * once for all three views and never refetched between them, so a fact
   * changed here goes stale in the reading view's masthead one click away.
   * `AccessSharing` § `onVisibility` has the long version, including why `null`
   * is one of the values.
   */
  onVisibility: (slug: string, visibility: Visibility | null) => void;
  onPrivateLink?: ((slug: string, on: boolean | null) => void) | undefined;
  /** The owner's controller. Optional only for focused tests that mount this page alone. */
  archive?: ArchiveControl | undefined;
}) {
  const { meta, tree, arc } = article;
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  /* The same rename the shelf offers, on the page that describes the article —
     Greg, 2026-08-27. One hook, one editor, one request shape, shared with the
     masthead and with the shelf: TitleEditor.tsx. */
  const rename = useArticleRename(slug, onRenamed, article.titleOverridden);

  /* **The bar is told which modes this reader sees; it does not go and get it.**
     One shared store behind the hook, so this page and the reading view cannot
     disagree for the length of a toggle. Dock.tsx § experimental. */
  const experimental = useExperimental();

  /* The administrator's cost section below asks the gate's own question. A
     courtesy only: the data comes from `/api/admin`, which refuses everyone
     else. ArticleCost.tsx. */
  const { user } = useSession();

  /**
   * Which stages have run, and how many questions have been asked. Not in the
   * article payload and deliberately never will be: that payload is fetched on
   * every page, and walking the filesystem for it would charge every reader for
   * a page almost nobody opens.
   */
  const [provenance, setProvenance] = useState<ArticleMetadata | null>(null);
  const [provenanceError, setProvenanceError] = useState<string | null>(null);
  /**
   * **Did that answer come off the network, or out of our own cupboard?**
   *
   * `apiFetch` answers a GET whose transport failed from the saved copy, with a
   * real `Response`, status 200 and `x-spideryarn-offline: copy`
   * (lib/api.ts § `attempt`) — so every caller downstream carries on unchanged,
   * which is exactly the point of it and exactly the trap for one control.
   * `DeletePermanently` below may not be offered over a body saved yesterday:
   * it cannot say whether the article is still there, still ours, or already
   * gone, and destroying something is not a decision to take on a guess.
   * Nothing else on this page cares, and nothing else reads this.
   */
  const [provenanceOffline, setProvenanceOffline] = useState(false);
  const [slow, setSlow] = useState(false);
  /**
   * **On `useOrderedRead`, because a dozen rows below can now ask for this again.**
   *
   * This was a bare `useEffect` with a `live` flag until 2026-09-07, which is
   * exactly right for a page that reads once and never again — and *Generate it
   * again* made that false. Every row hands its `useStepJob` the `refresh`
   * below, and a `reload` there would **join** the GET already in flight: a read
   * that started before the job wrote is not an answer to *"it has changed"*,
   * and landing last it would put the pre-job stages back for good, because
   * nothing announces a job twice. `useOrderedRead` is that distinction, and its
   * header is the story.
   *
   * The error is cleared on a success and set on a failure, and **`provenance`
   * is not thrown away by a failed refresh** — the reader keeps the rows they
   * had, with the sentence beside them, rather than watching the page empty out
   * because one revalidation did not land.
   */
  const readProvenance = useCallback<ArtefactRead>(
    async (current) => {
      try {
        const res = await apiFetch(`/api/metadata/${encodeURIComponent(slug)}`);
        /* Read off the `Response` before `readJson` consumes it — see
           `provenanceOffline` above. */
        const copy = res.headers.get("x-spideryarn-offline") === "copy";
        const answer = await readJson<ArticleMetadata>(res);
        if (!current()) return;
        setProvenance(answer);
        setProvenanceOffline(copy);
        setProvenanceError(null);
      } catch (e) {
        if (!current()) return;
        setProvenanceError((e as Error).message);
      }
    },
    [slug],
  );
  const { reload, refresh, armRefresh } = useOrderedRead(readProvenance);
  /* Keyed on `reload`, whose identity changes with the slug and with nothing
     else — so "a different article" is said once, in the place `useOrderedRead`
     already has to be right about it, rather than a second time here. */
  useEffect(() => {
    setProvenance(null);
    setProvenanceError(null);
    setProvenanceOffline(false);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), LOADING_AFTER_MS);
    void reload();
    return () => clearTimeout(timer);
  }, [reload]);

  /**
   * The per-article half of the reader profile, as a draft.
   *
   * Seeded from `provenance` rather than fetched separately — that endpoint is
   * already walking this article's directory, so one more read answers it for
   * free, which is the same argument its `comments` count already makes.
   *
   * `saved === null` means "not seeded yet", so an empty box the reader has
   * cleared is tellable from one that has not loaded.
   *
   * The save is [`useAutosavedText`](./useAutosavedText.ts), shared with
   * `/profile` since 2026-10-01, when the box began saving itself after a pause
   * (spya-czbj9r): one save at a time, written back only over what was sent,
   * flushed when the tab is hidden and sent with `keepalive` as it closes.
   *
   * Here, and only here, an empty box means **clear it**: this box was seeded
   * with the stored sentence, so the reader can see what they are erasing. The
   * add page's box cannot, and never sends an empty one (src/web/purpose.ts).
   * `savePurpose` also forgets the link cards' summaries, which were written
   * from the sentence being replaced.
   */
  const purpose = useAutosavedText({
    save: async (text) => {
      /* The server's answer, not what was typed: it trims and settles line
         endings, and the box must show the string that was actually stored.
         Read from `purpose` rather than from `entry`: the shelf card
         deliberately does not carry it (src/routes.ts § patchShelf). */
      const stored = (await savePurpose(slug, text === "" ? null : text)) ?? "";
      /* The glossary row's verdict (`glossaryRun`) is judged against this
         sentence, so one read before the save may be wrong after it — plan
         261001i § 3, GPT Sol's plan review. */
      void refresh();
      return stored;
    },
    leave: (text) => leavePurpose(slug, text),
  });
  const seedPurpose = purpose.seed;
  /**
   * **Seeded once per article, not on every read of it.**
   *
   * This ran on every `provenance` change, which was the same thing while the
   * page read once and stopped being so on 2026-09-07, when a finished re-run
   * started firing a refresh: a reader half-way through typing why they are
   * reading this would have had the stored sentence dropped over their draft by
   * a job they started in a row below.
   *
   * A ref keyed on the slug rather than a `null` check, so a reader who has
   * deliberately **cleared** the box does not get the stored sentence put back
   * by the next refresh — an empty draft and an unseeded one are the same value
   * and must not be the same behaviour.
   */
  const seededPurposeFor = useRef<string | null>(null);
  useEffect(() => {
    if (!provenance || seededPurposeFor.current === slug) return;
    seededPurposeFor.current = slug;
    seedPurpose(provenance.purpose ?? "");
  }, [provenance, slug, seedPurpose]);

  /**
   * Where the reader was in the article, so this page can say — and so "back to
   * the article" goes back to the paragraph rather than to the top.
   *
   * Note what this page does NOT fetch: the comments. See Dock.tsx — the
   * Questions button is a link back to the reading view here, so nothing on
   * this page needs them, and a visit should not cost a request for them. The
   * *count* below comes from the metadata endpoint, which is already looking in
   * this article's directory.
   */
  const [at] = useQueryState("at", atParam);

  /* The tab: the article first, then which of its pages this is. See
     src/web/page-title.ts. */
  useDocumentTitle(pageTitle({ kind: "read", title: article.meta.title, view: "metadata" }));
  const lastRead = at ? article.blocks.find((b) => b.id === at) : undefined;

  const backHref = readHref(slug, carriedSearch(location.search), "article");

  /**
   * This address has no article of its own and is being shown the fixture.
   *
   * `loadArticle` fell through to `example/` for an unknown slug and
   * `articleMetadata` followed it, deliberately, so that the two pages described
   * the same thing. Two places on this page need to know: the
   * `fixture` chip below, which has said so since the page was built, and —
   * since 2026-08-27 — Archive, which must not be offered. The shelf has no
   * entry under this slug, so the PATCH behind it would 404; a button that can
   * only fail is worse than no button, because pressing it is how you find out.
   * Found by a cross-model review. One derivation, used twice, rather than the
   * same three terms written out again.
   *
   * **Dead since 2026-08-30, and kept only until someone unpicks it.** The
   * state it describes — this page showing `example/`'s files under somebody
   * else's slug — cannot happen any more: `candidateDirs` offers the fixture to
   * its own slug and to no other, so `articleMetadata` 404s where it used to
   * answer with a foreign `dir` (the commit
   * that closed it). The right half of the `&&` was always what made it
   * *false* for `example` itself, so removing the whole thing changes nothing
   * a reader can see.
   *
   * It is left in place rather than pulled out because it is threaded through a
   * dozen sites here, and this file was being edited by other sessions on the
   * day the fallback went. The reason to say so *here* is that the paragraph
   * above now describes a hazard that no longer exists, and a comment arguing
   * for a state the code can no longer reach is how the next person learns
   * something untrue. docs/plans/260830am-faster-ingest-and-concurrency.md § Stage 1.
   */
  const showingFixture = provenance?.dir === "example" && slug !== "example";
  /**
   * Whether to offer the controls that write to this article's shelf row.
   *
   * Two conditions, and both are the same rule: there has to *be* a row, and we
   * have to know there is. `provenance` is null both before the request lands
   * and after it fails, so `showingFixture` is false in a state that is really
   * "not yet told" — and the controls behind it (the pencil, the sharing
   * switch) all end in a request that would 404 against an address with no row.
   * A control that can only fail is worse than no control, because pressing it
   * is how you find out. GPT Sol drew the line for the pencil, 2026-08-27; the
   * sharing switch joined it on 2026-08-28.
   *
   * One derivation rather than the same two terms written out at each site.
   */
  const hasShelfRow = provenance !== null && !showingFixture;
  /* The TagEditor and command bar share `saveTags`, so their admission record
     has to live here too. React state would update a render later and admit
     two presses in one tick; a ref closes the gate before the request leaves. */
  const tagSaveInFlight = useRef(false);
  /**
   * **The one save of this article's tags on this page** — the `TagEditor`'s,
   * and since 2026-10-03 the command bar's *Add the tag* / *Remove the tag*
   * rows too (`shelfRow.tags` below), so a press in the bar and the editor on
   * the page are one state. Plan 261003f, GPT Sol's F4: the bar calling
   * `editArticleTags` itself would have left the editor showing the old list.
   */
  const saveTags = useCallback(
    async (change: TagChange): Promise<string[]> => {
      if (tagSaveInFlight.current) throw new Error("Still saving the last tag change — a moment.");
      tagSaveInFlight.current = true;
      try {
        const tags = await editArticleTags(slug, change);
        /* A metadata GET already in flight may have read the old tags. Let it
           finish, then repair it from the server; with no GET in flight the
           PATCH answer already is the freshest answer. */
        armRefresh();
        setProvenance((p) => (p && p.slug === slug ? { ...p, tags } : p));
        return tags;
      } finally {
        tagSaveInFlight.current = false;
      }
    },
    [slug, armRefresh],
  );
  /* A local controller for focused mounts; the app hands in OwnedArticle's. */
  const metadataArchive = useArchive(
    slug,
    provenance?.archivedAt,
    provenance !== null,
    Boolean(provenanceError),
  );
  /* In the app, one controller survives the switch between Reader and
     Metadata. The local controller keeps this page independently mountable in
     its focused tests. */
  const archive = sharedArchive ?? metadataArchive;
  /* The byline leaves this line when the Authors section below says it one name
     at a time — the same names twice on one screen is noise (plan 260929d). */
  /* **Where and when it was published** (Greg, 2026-10-03, spya-pcz6a3). The
     journal is the registry's name for where the piece appeared, left out when
     the site already says it; the day is the publisher's own calendar day,
     printed by the same `publishedOf` the shelf sorts on, so the two cannot
     disagree about what counts as a date. A paper the registry dates only to
     a year prints the year alone, `Published 2011` (plan 261004h). */
  const journal = journalBesideSite(meta.journal, meta.siteName);
  const published = publishedOf(meta)?.label;
  const facts = [
    ["byline", meta.authors ? undefined : meta.byline],
    ["journal", journal],
    ["site", meta.siteName],
    ["published", published ? `Published ${published}` : undefined],
    ["language", meta.lang],
  ].filter(([, fact]) => Boolean(fact)) as [string, string][];
  const fetchedShown = fetchedIsShown(meta.fetchedAt);

  /**
   * The one line that has to survive the section being shut.
   *
   * "What we did to it" is closed by default — Greg, 2026-08-27 — because nine
   * rows of file paths is the answer to a question most visits are not asking,
   * and it pushed everything about *this reader* below the fold. So the heading
   * carries the two facts a shut section would otherwise take away: how much of
   * the pipeline has run, and when any of it last did.
   *
   * The newest stamp across every stage, not the last stage's: stages run in
   * any order and re-run one at a time, so "when did anything happen to this
   * article" is a max rather than a lookup.
   */
  /**
   * The page body, for the contents list in the margin to read its entries off.
   *
   * A ref rather than a `document.querySelector("main")`: this component is
   * mounted in tests two at a time (the owner's page and the visitor's, in
   * tests/metadata-origin.test.tsx), and a document-wide selector would hand
   * one page's contents list the other page's sections.
   */
  const body = useRef<HTMLElement>(null);

  /**
   * **`?section=`: open the section an address names, then take it off.**
   * Written by the command bar's *Run again* rows, which land a run here, in
   * *AI processing*, rather than in the mode (plan 261002c, GPT Sol's F1) —
   * from the reading view as a link, and on this page as the same address
   * with the parameter added in place.
   *
   * Taken off with `replace` (the parameter's own history) **only once the
   * section has been found and revealed** — `useRevealOnArrival`, which waits
   * for a section still mounting and says why the order matters (F4). After
   * that the address is the page's own again, so a reload does not flash the
   * section a second time and a copied link does not carry the instruction.
   */
  const [section, setSection] = useQueryState("section", sectionParam);
  useRevealOnArrival(body, section === null ? null : sectionIdFor(section), () => {
    void setSection(null);
  });

  /* Share… in `TopActions`: to the sharing card, landing on its heading.
     Through `body` rather than `document`, for the reason `body`'s docstring
     gives. `scrollIntoView` is optional-called because jsdom has none. */
  function goToSharing(): void {
    const section = body.current?.querySelector<HTMLElement>(`#${sectionId("Access & sharing")}`);
    section?.scrollIntoView?.({ block: "start" });
    section?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }

  /* The page's one clock for the three times it says in words — "fetched …",
     "ran …", "last wrote …" — read here and passed down, so the heading's
     "last wrote" and the row's cannot straddle a minute (useNow.ts). */
  const now = useNow();
  const pipelineLine = useMemo(() => {
    if (!provenance) return null;
    const ran = provenance.stages.filter((s) => s.done).length;
    const stamps = provenance.stages
      .map((s) => (s.ranAt ? Date.parse(s.ranAt) : Number.NaN))
      .filter((t) => !Number.isNaN(t));
    const newest = stamps.length ? Math.max(...stamps) : null;
    return `${ran} of ${provenance.stages.length} stages${newest === null ? "" : ` · last wrote ${whenSaid(new Date(newest).toISOString(), now)}`}`;
  }, [provenance, now]);

  return (
    <>
      {/* **2.5rem, and it was 3.5 until 2026-09-06.** The extra rem was room for
          the corner wordmark, which is fixed (HomeLogo.tsx) and would otherwise
          have sat on the back-link on any window narrow enough that this centred
          column reached the left edge. This page mounts a `Dock` and the
          wordmark is in it, so there is nothing above this element to clear and
          the strip it was holding open was empty.
          docs/plans/260905g-move-the-wordmark-and-feedback-button-into-the-dock.md
          § Stage 2. The four other `main`s that copied this — Tweets.tsx and the
          three in PublicPages.tsx — moved with it; ProfilePage, ContactPage and
          PrivacyPage keep 3.5rem, because they keep the wordmark.

          **`+ var(--safe-top)` stays, and its reason has changed.** It was here
          because `.logo-home` rests at `top: var(--safe-top)`, so in the
          installed app the wordmark occupied y=47..91 while a flat 56px of
          padding put the back link at y=56 — 35px of overlap on every page that
          is not the reader (GPT Sol, second pass, 2026-08-28,
          docs/plans/260828av-mobile-screen-real-estate.md § 2). The wordmark has
          gone and the clock has not: this page has no sticky bar of its own, so
          y=0 here is under the status bar and the term is what keeps the back
          link out from under it. */}
      {/* The contents list in the left margin. It reads its entries off the
          `[data-section]` elements inside `main`, so there is no second list of
          section names to keep in step — PageContents.tsx says why that matters
          more here than usual. Hidden below `lg`, where there is no margin to
          put it in; from `lg` until the centred margin is wide enough there is
          only room once `main` steps right to clear it, which is
          `CONTENTS_MARGIN` below. */}
      <PageContents containerRef={body} label="Sections of this page" />

      {/* `metadata-page` carries no rule now. It once held a typography fix —
          every `<button>` on this page inheriting its font, because we import
          no preflight and a button otherwise keeps the UA's 13.3px Arial
          (Greg, 2026-09-03: *"some of them seem larger than others
          somehow?"*). That reset is app-wide since 2026-09-04 (tailwind.css §
          the bit of preflight we need; feedback.css § metadata keeps the
          diagnosis).

          **`CONTENTS_MARGIN` is room for the contents list, and nothing
          else** — PageContents.tsx has the arithmetic, shared with `/profile`
          since 2026-10-03. */}
      <main
        ref={body}
        className={`metadata-page tw:mx-auto ${CONTENTS_MARGIN} tw:max-w-3xl tw:px-6 tw:pt-[calc(2.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}
      >
        <Link
          href={backHref}
          className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight-text"
        >
          <ArrowLeft size={13} />
          Back to the article
        </Link>

        {/* ---------------------------------------------------- 1. identity --
            Byline and site name come from Readability at extraction time, with
            no model call (docs/project/content-extraction.md) — which is the
            one place this page is ahead of the panel it was borrowed from:
            theirs never had a byline field at all. */}
        {/* The title, and the pencil beside it. Where the pencil hides, what
            replaces the heading and what a failed write says are all
            TitleEditor.tsx's — the masthead needs the same three.

            **Not offered on the fixture**, for exactly the reason Archive is not
            (see `showingFixture` above): there is no shelf row under this
            address, so the PATCH behind it would 404. */}
        <EditableTitle
          rename={rename}
          title={meta.title}
          /* **Only once we know.** `provenance` is null both before the request
             lands and after it fails, and `showingFixture` is therefore false in
             a state that is really "not yet told" — so the first version drew
             the pencil for a moment on every address, including the ones where
             pressing it PATCHes a row that does not exist. Withheld until the
             answer is in, which is the same standard Archive holds itself to a
             few sections down. GPT Sol, 2026-08-27. */
          offer={hasShelfRow}
          inputClassName="tw:text-2xl tw:leading-snug"
        >
          <h1
            className={withVoice(
              "tw:m-0 tw:min-w-0 tw:flex-1 tw:text-2xl tw:leading-snug tw:text-foreground",
              articleTitleVoice(rename.overridden),
            )}
          >
            {meta.title}
          </h1>
        </EditableTitle>
        {hasShelfRow && !rename.editing && (
          <ImportedTitle original={meta.titleOriginal} showing={meta.title} onUse={rename.done} />
        )}
        {/* Only the facts this article actually has, filtered once and counted
            from the filtered list — same reasoning as the library card. A chain
            of `&&`s, or a separate test of the same fields, is how a line ends
            up starting with a stranded `·`. */}
        <p
          data-metadata-facts
          className="tw:mt-2 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-sm tw:text-muted-foreground"
        >
          {/* **The separator ends an item; it never starts one.** The line wraps
              on a phone, and a row beginning "· fetched 3 weeks ago" reads as a
              stray mark (261004a's browser check). At the end of the row above
              it reads as "and there is more". */}
          {facts.map(([key, fact], i) => (
            <span key={key}>
              {fact}
              {(i < facts.length - 1 || fetchedShown) && <span className="tw:ml-2 tw:opacity-50">·</span>}
            </span>
          ))}
          {/* Relative, with the exact stamp on hover — theirs did this and it is
              the right way round. "3 days ago" is what you want to know; the
              timestamp is what you want when the answer is surprising. */}
          <Fetched iso={meta.fetchedAt} now={now} />
        </p>
        {/* Where it came from, and the way back to it — `Origin` below. `owner`
            is `hasShelfRow` rather than a fresh test, because the link it gates
            is the same private `GET /api/source/:slug` the masthead gates, and
            this page already has one answer to *is this yours*. */}
        <Origin meta={meta} slug={slug} owner={hasShelfRow} guess={article.sourceGuess} />
        {/* **The two identifiers are gone from here**, to `TechnicalDetails` at
            the foot of the page. They were the third line under the title on
            every visit, in mono, and Greg on 2026-09-03 said the thing a header
            is not allowed to make somebody wonder: *"I don't know what these
            are."* Neither is addressed to the reader — one is the text already
            in their address bar, the other is a row in a database — and neither
            has ever been actionable from up here.

            The fixture badge stays, because it is the opposite kind of fact: it
            says the numbers on this page belong to somebody else's article, and
            a warning behind a shut heading is not a warning. */}
        {showingFixture && (
          <p className="tw:mt-2 tw:mb-0">
            <span
              className="tw:rounded tw:border tw:border-highlight/40 tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-xs tw:text-highlight-text"
              /* The `example/README.md` pointer went with the rewrite: it named
                 a file in this repository to a reader who has no copy of it.
                 What is left is the consequence, which is the part they can do
                 something about. */
              title="Nothing has been stored at this address, so the page is showing our built-in example article. Nothing below is about yours."
            >
              fixture
            </span>
          </p>
        )}

        {/* **The reader's own tags**, near the top as asked (Greg, 2026-10-01:
            *"Also add this near the top of the article's Metadata page, reusing
            machinery"*) — the shelf's editor, TagEditor.tsx. Only on the
            reader's own article, which is what `hasShelfRow` already says.
            `?? []`: a Metadata answer cached before tags existed has none.
            Plan 261003d. */}
        {hasShelfRow && provenance && (
          <div className="tw:mt-3 tw:max-w-xl">
            <p className="tw:mt-0 tw:mb-1 tw:text-xs tw:font-medium tw:text-muted-foreground">
              Your tags <span className="tw:font-normal">— only you see them</span>
            </p>
            <TagEditor
              tags={provenance.tags ?? []}
              save={saveTags}
            />
          </div>
        )}

        {/* The two acts people come here for most often, under the title —
            `TopActions`. */}
        <TopActions archive={archive} fixture={showingFixture} onShare={goToSharing} />

        {/* --------------------------------------------- 2. in one sentence --
            Serif, because this is the article talking rather than the app —
            the same distinction the reading view makes between prose and
            chrome, and the same one a library card makes.

            **Directly under the title since 2026-09-03**, where it was third
            before. Greg: *"Perhaps the 'In one sentence' could be displayed
            directly underneath the title."* It is the only thing on the page
            that answers *what is this*, so everything above it was furniture
            in front of the answer — and it is the one section here written in
            the article's own voice, which makes it read as part of the heading
            rather than as the first of nine cards. */}
        {Boolean(root?.gist || root?.summary || meta.note) && (
          <Section label="In one sentence" keywords="takeaway gist summary short brief one line what is it about">
            <div className={`${CARD} tw:p-5`}>
              {root?.gist && (
                <p
                  className={withVoice("tw:m-0 tw:text-[0.95rem] tw:leading-relaxed tw:text-foreground", "ai")}
                >
                  {root.gist}
                </p>
              )}
              {root?.summary && (
                <p
                  className={withVoice(
                    "tw:mt-3 tw:mb-0 tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint",
                    "ai",
                  )}
                >
                  {root.summary}
                </p>
              )}
              {meta.note && (
                <p className="tw:mt-3 tw:mb-0 tw:border-t tw:border-border tw:pt-3 tw:text-xs tw:text-ink-faint">
                  {meta.note}
                </p>
              )}
            </div>
          </Section>
        )}

        {/* ------------------------------------------------------ 2½. authors --
            Who wrote it and where they work, one per line — Greg, 2026-09-29:
            *"At the very least, display them in the Metadata section."* Only
            when stage 2 knew the list (`meta.authors`, plan 260929d); otherwise
            the byline is in the facts line under the title, as it always was.
            The names link to the shelf searched for them, as in the masthead,
            and each has two outside searches under it — where a phone reader
            finds them, since a tap on a name follows it (plan 261003f). */}
        {meta.authors && (
          /* Shut until opened, since 2026-09-30 — Greg, SPIDERYARN-READING2-6Z:
             *"we can have more of the sections be default collapsed, like
             authors, export, delete"*. The count stays on the heading. */
          <Section
            label="Authors"
            aside={`${meta.authors.length}`}
            keywords="names writers byline who wrote it affiliations people person researchers institution university"
            collapsible
          >
            <ol className={`${CARD} tw:m-0 tw:list-none tw:p-5 tw:text-sm`} data-testid="metadata-authors">
              {meta.authors.map((author, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: two authors can share a name; order is the identity
                <li key={i} className={i > 0 ? "tw:mt-3" : undefined}>
                  <AuthorNames authors={[author]} linkToShelf={hasShelfRow} all />
                  {author.affiliations.map((a, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static list, order is the identity
                    <span key={j} className="tw:block tw:text-xs tw:leading-relaxed tw:text-ink-faint">
                      {a}
                    </span>
                  ))}
                  <AuthorSearchLinks author={author} />
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* ------------------------------------------------- 3. at a glance --
            Six numbers, each big enough to read without reading a sentence.
            One TooltipGroup so that once the pointer has opened one card's
            explanation, sweeping across the rest is instant rather than six
            separate waits — the same reasoning as the spine's bands. */}
        <Section
          label="At a glance"
          keywords="words read time reading duration long blocks parts sections levels length size count statistics"
        >
          <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
            <div className="tw:grid tw:grid-cols-2 tw:gap-3 tw:sm:grid-cols-3">
              <Stat
                icon={FileText}
                label="Words"
                value={stats.words.toLocaleString()}
                tip="Counted off the blocks themselves, not the raw HTML — so navigation, footers and cookie banners are not in it."
              />
              <Stat
                icon={Clock}
                label="Read time"
                value={`${stats.minutes} min`}
                /* The bottom bar carried a dimmed "Reading time" placeholder
                   until 2026-08-26, when Greg said it *"should be part of
                   Metadata"* — and it already was, right here. The same card
                   as the masthead's minutes since 2026-10-05 (spya-jew7ds):
                   ReadTimeCard.tsx. */
                card={<ReadTimeCard words={stats.words} supplementWords={stats.supplementWords} />}
              />
              <Stat
                icon={Blocks}
                label="Blocks"
                value={stats.blocks.toLocaleString()}
                /* **Not *a permanent id*, which this said until 2026-09-08.**
                   Stage 3 carries an id over by matching block text
                   (block-ids.md § Surviving stage 2), so a block whose words
                   changed can be re-minted. What survives the re-read is the
                   *identity*: `comments_identity_fk` points at
                   `block_identities`, which are never deleted, so the comment
                   outlives the revision either way. Same correction as
                   comments.md § the gutter, and the same myth the Comments
                   tooltip had. GPT Sol. */
                tip="Paragraphs, headings, quotes and images. Each carries an id that a re-read preserves wherever its words are unchanged — and a comment on one survives that re-read regardless, because it is anchored to an identity we never delete rather than to this version of the article."
              />
              <Stat
                icon={BookOpen}
                label="Parts"
                value={stats.parts.toLocaleString()}
                tip="The article's top-level divisions, and the rungs of the leftmost gist column."
              />
              <Stat
                icon={List}
                label="Sections"
                value={stats.sections.toLocaleString()}
                tip="The sections inside those parts — one rung further down the tree."
              />
              <Stat
                icon={Layers}
                label="Levels"
                value={stats.depth.toLocaleString()}
                tip="How many rungs of detail the tree has below the whole article. It is also how many zoom columns this piece can offer, so it answers “why does this one only have two?”."
              />
            </div>
          </TooltipGroup>
        </Section>

        {/* ------------------------------------- 4. how well we read the PDF --
            The one field of their Document Information we never took, because
            when this page was built the answer was the same for every article.
            It is not any more: since 2026-08-26 a PDF is read by a
            model rather than by Readability
            (docs/project/content-extraction.md), and `CameFrom` says what that
            reading actually did. Nothing for a web page — see the component.

            High on the page, above everything about the reader, because it is
            the trust question: a PDF owner who opened this page because
            *something looked wrong* is asking whether the words on screen are
            the words in the file, and every section below answers something
            else. Fable, 2026-09-03. */}
        <CameFrom meta={meta} />

        {/* -------------------------------------------- 5. access & sharing --
            **Moved above "your reading" on 2026-09-03**, on Greg's *"Move
            Access & Sharing up."* It was below it, under a section of pipeline
            rows that has now gone to the foot of the page.

            The order it lands in is: what this article is (the three sections
            above), then the decision about who can read it (this), then the
            reader's own work on it, then the machinery and the controls at the
            foot. The previous arrangement had the one irreversible control on
            the page — a public link cannot be un-rung (messages.ts §
            SHARING_CANNOT_UNRING) — below two screenfuls of notes and file
            paths. Export moved to the foot on 2026-10-01; it no longer sits
            beside this section.

            **Not offered on the fixture.** That address has no row of its own
            (`showingFixture` above), so the `PUT` behind the switch would 404,
            and a control that can only fail is worse than no control because
            pressing it is how you find out. */}
        <SharingSection
          onVisibility={onVisibility}
          onPrivateLink={onPrivateLink}
          slug={slug}
          title={meta.title}
          /* **Not `hasShelfRow`**, which is false while the fetch is out and
             false for ever if it fails — so a failed metadata check removed the
             whole section rather than showing its "we could not check" state.
             An owner looking for the sharing switch found no sharing switch and
             nothing saying why. GPT Sol, 2026-08-28.
             Hidden only for a *known* fixture, which is the one case where the
             controls really would 404. */
          offer={!showingFixture}
          /* **Parsed, not passed.** `readJson<ArticleMetadata>` above is a
             cast and checks nothing, so `sharing: {}` used to be truthy, become
             the card's *known* state, and draw "Only you can read this" about a
             body that said nothing. The write response was validated from the
             day it was written; this door was not. AccessSharing.tsx §
             asArticleSharing. */
          sharing={asArticleSharing(provenance?.sharing)}
        />

        {/* ------------------------------------------------ 6. your reading --
            Reader state, and the only section on the page that is about you
            rather than about the article. */}
        <Section
          label="Your reading"
          keywords="purpose reason goal notes comments questions annotations highlights bookmarks progress left off resume continue position"
        >
          {/* The per-article half of the reader profile. The global half is
              read-only here with a link to /profile, because a global value
              edited inside one article's page is a global value nobody can
              find — Greg, 2026-08-26. docs/project/reader-profile.md.

              This is the first thing on this page that writes anything. The
              docstring at the top still holds: nothing here is *generated* and
              nothing is a model call. This is the reader's own words. */}
          <div className={`${CARD} tw:mb-3 tw:p-4`}>
            <ProfileBox
              id="article-purpose"
              label="Why you're reading this one"
              placeholder="e.g. I want the evidence, not the history"
              hint="Changes what the glossary, the ideas, chat and explanations put first — for this article only. Never what the article says."
              value={purpose.draft}
              onChange={purpose.setDraft}
              onCommit={purpose.commit}
              max={MAX_PURPOSE_CHARS}
              disabled={purpose.saved === null}
              rows={2}
              save={purpose.state}
              inFlight={purpose.inFlight}
            />

            {/* The global half, shown rather than edited. A reader looking at
                "why is this glossary written like this" needs both answers, and
                sending them to another page for one of them is the way to make
                sure they never see it. */}
            <div className="tw:mt-4 tw:border-t tw:border-border tw:pt-3">
              <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-3">
                <span className="tw:text-[0.7rem] tw:uppercase tw:tracking-[0.03em] tw:text-ink-faint">
                  About you
                </span>
                <Link href={PROFILE_HREF} className="tw:text-xs tw:text-highlight-text">
                  Edit on your profile →
                </Link>
              </div>
              <AboutYou profile={provenance?.profile ?? null} failed={Boolean(provenanceError)} />
            </div>
          </div>

          <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
            <Row icon={MessageCircle} label="Comments">
              <Questions
                count={provenance?.comments ?? null}
                failed={Boolean(provenanceError)}
                slow={slow}
                href={readHref(slug, withPanel(carriedSearch(location.search), "questions"), "article")}
              />
            </Row>
            <Row icon={Target} label="Where you left off">
              {lastRead ? (
                <Link href={backHref} className={withVoice("tw:text-highlight-text", "author")}>
                  “{snippet(lastRead.text)}”
                </Link>
              ) : (
                <span className="tw:text-muted-foreground">
                  You haven't scrolled past the top of this one yet.
                </span>
              )}
            </Row>
          </div>
        </Section>

        {/* ------------------------------------------- 9. technical details --
            Everything that is true, is ours rather than the reader's, and has
            no bearing on reading the article: the two identifiers and the PDF's
            fingerprint. Shut, so it costs one line for anybody not looking for
            it. Greg, 2026-09-03. Which stages have run moved to *AI
            processing* on 2026-10-01 (`spya-qgh5ta`). */}
        <TechnicalDetails slug={slug} provenance={provenance} rawSha256={meta.rawSha256} />

        {/* ------------------------------- 9¼. what it cost (administrator) --
            Greg, 2026-09-30 (SPIDERYARN-READING2-68): *"In the metadata mode
            for admin users, can you include a section that shows cost
            estimates"*. Beside the technical details it is one of, and above
            the controls. docs/plans/260930f-article-cost-on-the-metadata-page.md. */}
        {isAdmin(user?.id) && <CostSection slug={slug} />}

        {/* -------------------------------------------------- 9⅓. export it --
            Under the machinery since 2026-10-01 — Greg (SPIDERYARN-READING2-7H):
            *"move "Export" section further down"*. As far down as it goes
            without parting Re-run from Archive (4Z) or Archive from Delete, and
            near the Delete control, whose "Export it first" scrolls here.
            docs/plans/261001c-metadata-cost-shut-with-its-total-and-export-further-down.md. */}
        <ExportSection slug={slug} offer={hasShelfRow} />

        {/* ----------------------------------------- 9½. AI processing --
            **What we did to it, and asking for it again, in one section**
            since 2026-10-01 — Greg (`spya-qgh5ta`): *"in Metadata mode,
            perhaps also amalgamate "What we did to it" and "Re-run AI
            processing""*. The stage rows came out of *Technical details*,
            with the error rule they carry. Before that:
            One section for both ways of asking again — a mode at a time, or
            the whole article — just above Archive, shut until opened. Greg,
            2026-09-29 (SPIDERYARN-READING2-4Z): *"We have both a "Generate it
            again" and "Start this article again". Let's somehow amalgamate
            them … Perhaps this section should be default-collapsed … And maybe
            position it above "Archive this article"."* It is also, since the
            same morning, the only place a standing redo lives: the modes keep
            only the button inside their out-of-date banner.
            docs/plans/260929b-one-place-to-re-run-ai-processing.md. */}
        <RerunSection
          slug={slug}
          provenance={provenance}
          onFinished={refresh}
          reset={experimental.on}
          error={provenanceError}
          slow={slow}
          aside={pipelineLine}
          now={now}
          structureGenerator={`${tree.generator} · ${tree.version}`}
          arcGenerator={arc ? `${arc.generator} · ${arc.version}` : undefined}
        />

        {/* ---------------------------------------------- 10. archiving it --
            First of the two endings at the foot: the reversible control that
            takes the article off the shelf, followed only by permanent
            deletion. Both belong past everything somebody might have come here
            to read. */}
        <Section label="Archive this article" keywords="remove from shelf put away tidy done unarchive restore library">
          <ArchiveArticle archive={archive} fixture={showingFixture} />
        </Section>

        {/* ------------------------------------------ 11. destroying it --
            Under Archive, and last of everything, because it is the only act
            on this page that cannot be taken back. Greg, 2026-09-06:
            *"probably only visible for now from within Metadata for that
            article, underneath Archive, with appropriate UI styling"*. The
            shelf card deliberately has no such button — its controls are
            hover-revealed and adjacent, and on a phone they are all tap
            targets. docs/plans/260906h-delete-an-article-permanently.md. */}
        {/* Shut until opened, since 2026-09-30 (SPIDERYARN-READING2-6Z, with
            Authors and Export). Kept mounted, so a confirm half-way through
            survives the reader shutting it; the confirm itself is unchanged,
            and shutting the section only adds a press in front of it. */}
        <Section
          label="Delete this article"
          keywords="permanent permanently forever gone wipe for good irreversible"
          collapsible
          keepMounted
        >
          <DeletePermanently
            slug={slug}
            /* **`||`, not `??`, and a browser pass is what found that.** An
               article whose extraction produced no title carries `""` rather
               than null — an ordinary URL paste did it — and `??` keeps the
               empty string, so the question read *Delete “” for ever?* and the
               one safeguard in it was gone. Naming the article is the cheap
               ninety per cent of type-the-title: it makes the reader read
               *which* one. The slug is a poor name and a far better nothing. */
            title={meta.title?.trim() || slug}
            known={provenance !== null}
            offline={provenanceOffline}
            failed={Boolean(provenanceError)}
            fixture={showingFixture}
            /* Off the same fetch the sharing card reads, so the two cannot
               disagree about whether this article is public. **False where the
               store could not say**, and that is the right way round: the extra
               sentence is an additional warning, so not drawing it is the
               understatement rather than the false claim. */
            shared={asArticleSharing(provenance?.sharing)?.visibility === "public"}
          />
        </Section>
      </main>

      {/* No `drawer` prop, and that is the whole reason the Questions button on
          this page is a link back to the article rather than a drawer trigger.
          See Dock.tsx. */}
      <Dock
        slug={slug}
        view="metadata"
        experimental={experimental}
        /* The bar's Archive and Export act on this page's one controller, so
           a press there and the buttons here are one state. Not on the
           fixture, where there is no row and both requests would 404 — the
           rule `ArchiveArticle` and `ExportSection` follow. Not gated on
           `hasShelfRow`'s provenance wait: CommandBar.tsx §
           `CommandBarArticle.shelfRow` says why the bar need not wait.
           `tags` is the editor's own save (`saveTags`), so a tag added from
           the bar is on the page at once (GPT Sol's F4 on plan 261003f). */
        shelfRow={showingFixture ? undefined : { archive, tags: { edit: saveTags } }}
      />
    </>
  );
}

/**
 * The global half of the reader profile, shown rather than edited.
 *
 * **The empty state is a claim about the reader, so it may only be made when we
 * know it is true.** `provenance` is null both before the request lands and
 * after it fails, and the first version said "You haven't said anything about
 * yourself yet" in the second case — stating as a fact about a person something
 * the failed request had no way to establish. Found by a cross-model review,
 * 2026-08-27.
 */
/**
 * The sharing switch, and the decision about whether to offer it at all.
 *
 * A component rather than a `{hasShelfRow && …}` in the page body, because the
 * body is one long return and each conditional in it costs against a complexity
 * budget this file is already at the edge of. Moving the test in here is free
 * and it keeps the section's heading and its content together.
 */
function SharingSection({
  slug,
  title,
  offer,
  sharing,
  onVisibility,
  onPrivateLink,
}: {
  slug: string;
  title: string;
  /** Straight through to the card — see `Metadata`'s prop of the same name. */
  onVisibility: (slug: string, visibility: Visibility | null) => void;
  onPrivateLink?: ((slug: string, on: boolean | null) => void) | undefined;
  /** There is a shelf row and we know it — `hasShelfRow` in `Metadata`. */
  offer: boolean;
  /**
   * Off the same `provenance` fetch this page already makes, which is the
   * point of the field being there rather than on a route of its own: the card
   * costs no request until the owner presses something. `undefined` while it is
   * in flight, and for ever on a store with no column to read.
   */
  sharing: ArticleSharing | undefined;
}) {
  if (!offer) return null;
  return <SharingCard slug={slug} title={title} sharing={sharing} onVisibility={onVisibility} onPrivateLink={onPrivateLink} />;
}

/**
 * The card itself: the private link, then the public switch (plan 261005e).
 *
 * **Two controls, and one thing passes between them**: whether the article is
 * public now. The private link's control says so when both are on, because
 * turning the link off then closes nothing. It hears it the way the masthead
 * does, from what the public switch reports upwards: the page's own answer
 * first, `null` the moment a write goes out, then the server's answer. Until
 * the switch has said anything, the page's fetch is the answer.
 */
function SharingCard({
  slug,
  title,
  sharing,
  onVisibility,
  onPrivateLink,
}: {
  slug: string;
  title: string;
  sharing: ArticleSharing | undefined;
  onVisibility: (slug: string, visibility: Visibility | null) => void;
  onPrivateLink?: ((slug: string, on: boolean | null) => void) | undefined;
}) {
  /* `undefined` is *the switch has reported nothing yet*; `null` is its own
     *we no longer know*. */
  const [reported, setReported] = useState<Visibility | null | undefined>(undefined);
  const visibility = reported === undefined ? (sharing?.visibility ?? null) : reported;
  const report = useCallback(
    (forSlug: string, to: Visibility | null) => {
      if (forSlug === slug) setReported(to);
      onVisibility(forSlug, to);
    },
    [slug, onVisibility],
  );
  /* And the other way: whether a private link is on, from the control that
     reads it to the switch whose *"Only you can read this"* depends on it.
     `null` until that control has read it, and whenever it cannot say. */
  const [linkOn, setLinkOn] = useState<boolean | null>(null);
  const reportLink = useCallback((on: boolean | null) => {
    setLinkOn(on);
    onPrivateLink?.(slug, on);
  }, [slug, onPrivateLink]);
  return (
    <Section
      label="Access & sharing"
      keywords="anyone everybody readers signed in account permission public private link key privacy visible who can read send friend colleague republish"
    >
      {/* **In a card, like every other section on this page**, since
          2026-09-04. It was the one section whose contents sat straight on the
          page background — Greg: *"the section should be inside a box like the
          other sections"* — which read as a stray paragraph rather than as the
          page's one irreversible control, and left the confirmation panel
          below it as the only boxed thing here, so the *warning* looked more
          like a card than the switch did.

          `${CARD} p-4`, matching the compact control cards elsewhere on the
          page rather than "In one sentence"'s `p-5`. */}
      <div className={`${CARD} tw:p-4`}>
        <PrivateLink
          slug={slug}
          title={title}
          sharing={sharing}
          isPublic={visibility === null ? null : visibility === "public"}
          onLink={reportLink}
        />
        {/* The second control, under its own heading and a rule, so the card
            reads as two switches and not one paragraph. */}
        <div className="tw:mt-4 tw:border-t tw:border-rule tw:pt-4">
          <h3 className="tw:m-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:font-sans tw:text-sm tw:font-semibold tw:text-ink">
            <Globe size={14} />
            Public
          </h3>
          <AccessSharing
            slug={slug}
            title={title}
            sharing={sharing}
            onVisibility={report}
            privateLinkOn={linkOn}
          />
        </div>
      </div>
    </Section>
  );
}

/**
 * **AI processing** — the things this page will ask for again, and,
 * behind the experimental switch, starting the whole article again; and since
 * 2026-10-01, below them, the record of what has run (`StageRecord`). It was
 * called *Re-run AI processing* until the record joined it (`spya-qgh5ta`,
 * docs/plans/261001j-five-small-feedback-tooltips-and-labels.md § 5).
 *
 * One section since 2026-09-29, when Greg asked for *Generate it again* and
 * *Start this article again* to be amalgamated, shut by default and moved above
 * Archive — docs/plans/260929b-one-place-to-re-run-ai-processing.md. Since
 * 2026-09-30 the reset is the first row of the modes' own card rather than a
 * subheading and a card under it, and the mode rows run on one press —
 * docs/plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md.
 * ./ResetArticle.tsx is the reset's control.
 *
 * Greg, 2026-09-06, declining a library-wide backfill and asking for this in the
 * same breath:
 *
 * > Leave it, new articles only. Although i think there should be a way to
 * > re-run any of the generated modes (either within the UI for the mode, or
 * > perhaps in the Metadata section) - I realise this is a new piece of work,
 * > but it's important
 *
 * ## A section of its own, not a button on each stage row
 *
 * The stage rows below the re-run menu answer a different question, and only
 * one of the two lists is a menu: `StageRecord` is a **record** — all sixteen
 * stages, when each last wrote, no controls — while the first list is the modes
 * you can ask for. Interleaving them would put an eligibility branch inside
 * `StageRow` and rows with a button beside rows that cannot have one.
 *
 * It is also where a reader can find it. The dimmed *"Re-run a stage"*
 * placeholder sat inside `Technical details` — a shut section, behind a second
 * subheading — from 2026-09-03, and Greg asked for this feature three days later
 * without mentioning it. Building the real control into the same hole would be
 * repeating that experiment.
 *
 * ## What it claims, and what it deliberately does not
 *
 * **Nothing about staleness.** A button that says *regenerate this* and makes no
 * claim about whether you need to is honest and needs no artefact provenance —
 * which is the whole reason this shipped and the placeholder never did. The
 * button's wording is chosen off `StageState.done` so that it cannot contradict
 * the `ran` / `not run` pill next door, and that is the extent of it. The plan's
 * § Deferred keeps the staleness half, including why *absent* and *stale* are
 * one boolean today.
 *
 * **Which, and why not the rest**, is `METADATA_RERUN_STEPS`
 * (src/rerun-steps.ts) — read it there rather than restating it here.
 *
 * ## No gate, unlike Export and Archive
 *
 * Those two are withheld until we know there is a shelf row, because their only
 * possible outcome without one is a 404 and pressing them is how you would find
 * out. This is not that shape: a run is `POST /api/jobs`, whose refusal comes
 * back as a sentence written for a reader, and `JobProgress` is built to show
 * exactly that beside the row it belongs to. So the rows are drawn while the
 * metadata request is still out.
 *
 * **Shut by default, and still mounted.** `keepMounted` hides the rows rather
 * than unmounting them, so every row's `useStepJob` subscription lives for the whole
 * visit, and a run that finishes while the section is shut still refreshes the
 * page — see `Section`'s `keepMounted` (PageSection.tsx) for what unmounting lost.
 *
 * The cost, said out loud: one subscription per row to one shared engine
 * (`useJobs` is a `useSyncExternalStore` over `jobEngine`), so these are store
 * subscriptions and **not** polls.
 */
function RerunSection({
  slug,
  provenance,
  onFinished,
  reset,
  error,
  slow,
  aside,
  now,
  structureGenerator,
  arcGenerator,
}: {
  slug: string;
  /** Null until the metadata request lands; the rows draw either way. */
  provenance: ArticleMetadata | null;
  /**
   * **`refresh`, never `reload`** — see the read in `Metadata` above and
   * `useOrderedRead`'s header. The same function for every row, so a completion
   * in any row is one question asked of one reader.
   */
  onFinished: () => void;
  /** `useExperimental().on` — the whole-article reset is drawn only with it. */
  reset: boolean;
  /** The metadata request's failure, which draws the section open — below. */
  error: string | null;
  slow: boolean;
  /** `N of M stages · last wrote …`, kept on the heading so shutting it takes only the detail. */
  aside: string | null;
  /** The page's clock, for the rows' "ran …" — `Metadata`'s one `useNow`. */
  now: number;
  structureGenerator: string;
  arcGenerator: string | undefined;
}) {
  return (
    /* **Collapsible only while nothing has gone wrong** — the rule the stage
       rows brought with them from *Technical details* (`StageRecord` below):
       a failed metadata request draws the section open, with the error first. */
    <Section
      label="AI processing"
      keywords={`${AI_PROCESSING_KEYWORDS}${reset ? ` ${WHOLE_ARTICLE_KEYWORDS}` : ""}`}
      collapsible={!error}
      keepMounted
      aside={error ? null : aside}
    >
      {error && (
        <p
          className={`${CARD} tw:m-0 tw:mb-3 tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground`}
        >
          {error}
        </p>
      )}
      {/* **High-powered AI**, for the owner of the article — switching it on counts
          as one more article against their allowance (plan 260930k). First in
          the section, above the rows it changes the model for (all but Simple):
          switching it re-runs nothing, and the rows below are how you ask. */}
      <HighPowerSwitch slug={slug} since={provenance?.highPowerSince} onChanged={onFinished} />
      {/* Two facts and no third. **It does not say anything is out of date** —
          nothing here can honestly tell you that, and the whole reason this
          shipped while the placeholder it replaces did not is that a button
          saying *regenerate this* needs no such claim. And no timing: the rows
          are not one speed, so a *"takes a minute or two"* here would be wrong
          about the Sketch, which says its own wait beside its name. */}
      <p className="tw:mt-0 tw:mb-3 tw:text-xs tw:text-ink-faint">
        Ask for any mode to be written again. It costs you nothing, and what is here now stays
        until the new run succeeds.
      </p>
      <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
        {/* **The whole article first, as a row of the same card** since
            2026-09-30 — Greg, SPIDERYARN-READING2-65: *"amalgamate the "Start
            the whole article again" into the run-it-again section above, e.g.
            as a button at the top"*. It was a subheading and a second card
            under the modes. First because it is the widest press here, and
            the one a reader who has come to start over is looking for; the
            intro line above is about the modes, and this row says what it does
            in its own. Still behind the experimental switch. */}
        {reset && (
          <div className="tw:px-4 tw:py-3">
            <ResetArticle
              slug={slug}
              provenance={provenance}
              onFinished={onFinished}
              lead={
                <>
                  <Chip icon={RotateCcw} />
                  <span className="tw:text-foreground">Whole article</span>
                </>
              }
            />
          </div>
        )}
        {METADATA_RERUN_STEPS.map((step) => (
          <RerunRow
            key={step}
            slug={slug}
            step={step}
            /* `undefined` while the request is out, and it stays `undefined`
               rather than becoming `false`, because a `false` would be a claim
               we cannot make yet. `RerunRow` reads either as *not that we know
               of*, which is what picks *Run it* over *Run it again*. */
            done={provenance?.stages.find((s) => s.step === step)?.done}
            /* Read by the glossary's row alone — plan 261001i § 3. */
            glossaryRun={provenance?.glossaryRun}
            onFinished={onFinished}
          />
        ))}
      </div>

      <StageRecord
        provenance={provenance}
        error={error}
        slow={slow}
        now={now}
        structureGenerator={structureGenerator}
        arcGenerator={arcGenerator}
      />
    </Section>
  );
}

/**
 * **What we did to it** — which pipeline stages have run, and when, as a
 * record with no controls. Inside *AI processing* since 2026-10-01, below the
 * menu of what can be asked for again; it was a subheading of *Technical
 * details* before that (`TechnicalDetails`' header has its history). Its own
 * component, not rows interleaved with `RerunRow`: `RerunSection`'s header
 * says why the record and the menu stay two lists in one section.
 *
 * The error is drawn by the section, above everything, and opens it.
 */
function StageRecord({
  provenance,
  error,
  slow,
  now,
  structureGenerator,
  arcGenerator,
}: {
  provenance: ArticleMetadata | null;
  error: string | null;
  slow: boolean;
  now: number;
  structureGenerator: string;
  arcGenerator: string | undefined;
}) {
  return (
    <>
      {/* Which stages have run, and the two that carry a model's name. A stage
          counts as run only when *all* of its outputs are on disk —
          src/pipeline.ts owns that rule and this page borrows it rather than
          restating it. */}
      <SubHeading>What we did to it</SubHeading>
      {/* Named, not "Loading…", and only after the timer — their loading
          rules on both counts (original-version/design-system.md#loading-states). */}
      {!error && provenance === null && slow && (
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          Checking which files the pipeline wrote…
        </p>
      )}
      {provenance && (
        /* One group over all the rows, same as the stat cards: once one row's
           tooltip is open, running down the column is instant rather than a
           fresh wait per row. */
        <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
          <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
            {provenance.stages.map((stage) => (
              <StageRow
                key={stage.step}
                stage={stage}
                now={now}
                generator={
                  stage.step === "structure"
                    ? structureGenerator
                    : stage.step === "arc"
                      ? arcGenerator
                      : undefined
                }
              />
            ))}
          </div>
        </TooltipGroup>
      )}
    </>
  );
}

/* `RERUN_LABEL` and `RERUN_COST_NOTE` live in ./rerun-commands.ts since
   2026-10-02, because the command bar's *Run again* rows name the same steps and
   cannot import them from here (this file imports the Dock, the Dock the bar —
   GPT Sol's F8 on docs/plans/261002c-commands-do-more-and-an-interface-model-vision.md).
   What stays here is the glossary's verdict-driven override, below, which is a
   fact about this article rather than about the step. */

/**
 * **What a reader might type looking for *AI processing*** — the section where
 * everything is asked for again, and so the one with the most ways to say it.
 * Greg, `spya-nkjpte`, 2026-10-02: *"I tried searching for "regenerate" to
 * find ways to regenerate the AI processing, and nothing matched"*.
 *
 * The words for *again* that mean only that are a synonym group in
 * page-search.ts § METADATA_SYNONYMS (*regenerate*, *reprocess*, …). The
 * broader ones are here, on this section alone: a synonym applies to every
 * section, so *update* or *over* in that group would rank this above *At a
 * glance* for *over time* (GPT Sol, plan review of 261002c, P2). Then the
 * High-powered AI switch and every row `RERUN_LABEL` names — built from it, so
 * a new row is findable the day it is added.
 *
 * The whole-article reset's words are separate because that row is behind the
 * experimental switch. Advertising *reset* while the switch is off would land
 * the reader in a section that has no such control. Code review of 261002c.
 */
const AI_PROCESSING_KEYWORDS = [
  "steps stages pipeline models summaries glossary structure hierarchy",
  "start again update fix generate",
  "high powered power opus sonnet model better smarter stronger capable",
  ...Object.values(RERUN_LABEL),
].join(" ");

const WHOLE_ARTICLE_KEYWORDS = "over reset whole";

/*
 * **`RERUN_COST_NOTE` (now in ./rerun-commands.ts): the four rows for which
 * "another model call" is not the whole story**, said under the mode's name,
 * before the press, because nothing else on this page says it.
 *
 * Until 2026-09-30 these were the four special sentences in an inline confirm
 * that every press went through; Greg asked for the confirm to go (below, at
 * `RerunRow`). The glossary's says **both** outcomes: a run appends when
 * `existingFor` (src/glossary.ts) accepts the old list — same source, prompt
 * version and reader profile — and writes a new list when there is no old one
 * or any of those three differ. Nothing on this page knows which in advance
 * (GPT Sol's two code reviews). The old confirm, and the *Find more terms*
 * label, promised the append every time.
 *
 * **No dollar figure, since 2026-09-30.** The Sketch's and Debate's notes
 * named a price until Greg ruled that what AI processing costs us is for the
 * administrator alone — *"i don't want any regular users to know how much AI
 * processing of their articles costs"* — and the administrator reads the real
 * figure in *What it cost* further down this page.
 * docs/plans/260930k-high-power-for-readers-and-cost-only-for-admins.md § 3;
 * tests/no-ai-cost-for-readers.test.ts fails on a figure here.
 *
 * The Sketch's wait is `SKETCH_WAIT` from ./sketch-cost.ts, so this page and
 * the Sketch panel cannot name two different waits. Debate is **up to** two
 * separately metered calls — pass B runs only if pass A succeeded
 * (src/debate.ts) — each with a web search. For developers: a completed live
 * run cost $0.3527, and per-pass cost varied 2.4× with how much the model
 * chose to search — docs/plans/260905f-debate-mode-stage-0-spike-results.md
 * § Stage 3½ § 1; the ~$0.27 in comments across `src/` is the superseded
 * ceiling. Skim refuses before any model call when there are
 * no Quotes (src/pipeline.ts), which is worth knowing before pressing rather
 * than learning from the failure.
 *
 * Each is also the button's accessible description (`describedBy` on
 * `JobProgress`), because a sibling `<span>` is not read to somebody who
 * reaches the button by keyboard.
 */

/**
 * **The glossary's label and note once the server has said which** — plan
 * 261001i § 3. `glossaryRun` is `glossaryRunKind` (src/glossary.ts), the
 * run's own `existingFor` verdict for the profile this page's press sends, so
 * *Find more terms* comes back and is true when it shows. Absent or `null` —
 * an older server, the request still out, no fingerprint — keeps the hedge in
 * `RERUN_COST_NOTE`.
 */
const GLOSSARY_RUN: Record<
  "first" | "append" | "rewrite",
  { label: string | null; note: string | null }
> = {
  /* `null` label: the ordinary *Run it* / *Run it again* off `done`. */
  first: { label: null, note: null },
  append: {
    label: "Find more terms",
    note: "Adds more terms to this list",
  },
  rewrite: {
    label: null,
    note: "Writes a new list, because the article, the glossary's instructions or your profile has changed",
  },
};

/**
 * One row: the mode's name, and a button that runs it.
 *
 * **A component per row rather than a loop of hooks**, because each row owns its
 * own `useStepJob` and `provenance` is null before the fetch lands — a `.map` of
 * hooks inside the section would change the hook count between renders the
 * moment anything about the row list came off the request.
 *
 * ## One press, since 2026-09-30
 *
 * > In Metadata when I click "Run it" or "Run it again" for a mode, don't
 * > include the confirmation step. Just do it.
 * >
 * > — Greg, 2026-09-30 (SPIDERYARN-READING2-64)
 *
 * From 2026-09-07 the first press only opened an inline confirm, and the Retry
 * went through the same one. What it guarded, checked before it went
 * (docs/plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md):
 * **no reader's slot** — `POST /api/jobs` reserves one only for a `url` or an
 * upload, and a re-run is a bare slug (docs/project/billing.md); **nothing of the
 * reader's** — a step writes a draft that replaces the live artefact only on
 * success; and **our money, against a slip of the finger only** — a script calls
 * the route and a person clicks twice, and it was never on
 * docs/project/security-map.md. So it went for every reader, not only for Greg.
 * The per-reader limiter that would actually bound this is designed and
 * deliberately not built — docs/project/ai-gateway.md § What stops a reader
 * spending our money.
 *
 * **A double click still posts once.** The synchronous `pressing` ref below
 * closes the gap before React commits; `start` then keeps `starting` true from
 * the POST through the poll that first carries the job, and `JobProgress` draws
 * a status instead of the button throughout. Retry has the same two layers in
 * `useStepJob`: a ref before the commit, then `starting` until its job appears.
 *
 * ## Everything after the press is `JobProgress`
 *
 * Running, failed, stalled, Retry and the gap between the POST and the first
 * poll that sees the job — all of it is already right in that component, and
 * this row hands it the run and the step's own failure unchanged.
 */
function RerunRow({
  slug,
  step,
  done,
  glossaryRun,
  onFinished,
}: {
  slug: string;
  step: MetadataRerunStep;
  /** `StageState.done`, or undefined while the metadata request is out. */
  done: boolean | undefined;
  /** `ArticleMetadata.glossaryRun`; only the glossary's row reads it. */
  glossaryRun: ArticleMetadata["glossaryRun"];
  onFinished: () => void;
}) {
  const { job, failed, stalled, starting, start, cancel } = useStepJob(
    slug,
    step,
    onFinished,
    "watches-queue",
  );
  /* **One press, one run.** `starting` takes the button away on the next
     commit, but two click events can reach this handler before it — two paid
     runs, now nothing asks first. Held for the POST's round trip; after that
     `starting` holds until the job is polled, and the button is long gone.
     Here and not in `useStepJob.start`, which other panels call twice on
     purpose — see `inFlight` there. */
  const pressing = useRef(false);
  const run = async () => {
    if (pressing.current) return;
    pressing.current = true;
    try {
      /* Forced, and forced **by name**. The step's own freshness check
         would otherwise skip an artefact that is, by construction,
         current — a run that looks like it worked and changed nothing.
         `useStepJob` turns this into `force: [step]`, never a positional
         force, so nothing after it in `STEP_ORDER` is swept in. */
      await start({ force: true });
    } finally {
      pressing.current = false;
    }
  };

  const Icon = STAGE_ICONS[step];
  /* Off `done`, so the button and the `ran` / `not run` pill in Technical
     details cannot contradict each other — and `undefined` reads as "not that
     we know of". **The glossary too, since 2026-09-30.** It said *Find more
     terms* whatever its state, and then off `done`, and both were a guess at
     whether this press appends or rewrites — which `existingFor`
     (src/glossary.ts) decides from the source, the prompt version and the
     reader profile, none of which `done` tracks exactly (GPT Sol, both
     reviews of 260930e). So it gets the plain label, and its note says the
     two outcomes rather than predicting one — **until the server says which**,
     since 2026-10-01: `GLOSSARY_RUN` above. */
  const known = step === "glossary" && glossaryRun ? GLOSSARY_RUN[glossaryRun] : null;
  const label = known?.label ?? (done ? "Run it again" : "Run it");
  const note = known ? known.note : RERUN_COST_NOTE[step];
  /* Keyed on the step: a dozen rows share the page, and a fixed id would
     describe every button with whichever note came first. */
  const noteId = `rerun-note-${step}`;

  return (
    <div
      /* The hook the tests find a row by, so that asserting on DOM order — which
         would pass whatever the list happened to be — is never the way in. The
         same argument `data-section` on this page's headings makes.

         **It is not what tells the buttons apart**: every actionable control in
         the row carries the mode's name in its own `aria-label` (`about`,
         below), and the tests assert on those. */
      data-rerun-step={step}
      className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:px-4 tw:py-3 tw:text-sm"
    >
      <Chip icon={Icon} />
      <span className="tw:text-foreground">{RERUN_LABEL[step]}</span>
      {/* **On its own line under the name, at every width** — `order-last` and
          `basis-full` in a wrapping row, indented by the chip and its gap
          (24px + 12px) so it sits under the name. Beside the name, a 390px
          screen pushed only these rows' buttons onto a line of their own,
          out of step with every other row (browser check, 2026-09-30). */}
      {note && (
        <span
          id={noteId}
          className="tw:order-last tw:-mt-1 tw:basis-full tw:pl-9 tw:text-xs tw:text-ink-faint"
        >
          {note}
        </span>
      )}
      {/* A `div` and not a `span`: `JobProgress` draws a `div` for its starting
          row and its running band, and a block element inside phrasing content
          is invalid markup that nothing here would ever go red over. */}
      <div className="tw:ml-auto tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        <JobProgress
          job={job}
          starting={starting}
          failed={failed}
          stalled={stalled}
          onRun={run}
          onCancel={cancel}
          label={label}
          step={step}
          icon={<RefreshCw size={13} />}
          /* What the band's own buttons are about, for their accessible
             names — see `about` in JobProgress.tsx. A dozen bands on one page
             is the case that prop exists for. */
          about={RERUN_LABEL[step]}
          describedBy={note ? noteId : undefined}
          /* Only ever shown for the moment before the step reports a label of
             its own, so it says the neutral thing rather than guessing a verb
             — the pipeline's own are *Writing the arc*, *Finding the terms*,
             *Drawing the argument*, and none of those generalises. */
          runningLabel={`Working on the ${RERUN_LABEL[step].toLowerCase()}`}
        />
      </div>
    </div>
  );
}

/**
 * **What it cost, shut, with the total on its heading.** Greg, 2026-10-01
 * (SPIDERYARN-READING2-7G): *"default to collapsed (to save vertical space),
 * showing only the total figure/summary."* The read is here rather than in the
 * body because a shut section does not mount its body (ArticleCost.tsx §
 * `useArticleCost`). Mounted only behind `isAdmin`, so nobody else's page makes
 * the request at all.
 *
 * **A failed read is not shut away**: the section stops being collapsible and
 * the alert shows, as *AI processing* does with its metadata error — postmortem
 * 260903d, a shut section that sealed the error in.
 */
function CostSection({ slug }: { slug: string }) {
  const load = useArticleCost(slug);
  const failed = load.kind === "failed";
  return (
    <Section
      label="What it cost"
      keywords="ai calls models tokens breakdown total expensive cheap"
      collapsible={!failed}
      aside={articleCostSummary(load)}
    >
      <ArticleCostBody load={load} />
    </Section>
  );
}

/**
 * **Everything we hold for this article, in one zip.**
 *
 * > Let's add an Export button somewhere, perhaps in Metadata, that exports all
 * > the data for an article. […] It can exclude the original PDF/HTML itself
 * > (because that's easy to get otherwise).
 * >
 * > — Greg, 2026-09-01
 *
 * The zip is `GET /api/export/:slug` (src/routes.ts § `sendExport`), assembled
 * per request from `articleBundle`. What is in it, and why there are two
 * exporters, is docs/project/export.md.
 *
 * ## Why this cannot be an `<a href>`, which is the obvious first try
 *
 * The route needs an `Authorization: Bearer` and a navigation carries no
 * headers, so a plain link would 401 for everybody — the same wall
 * `SourceLink.tsx` hit on 2026-08-27, and the same way out: fetch it with the
 * token, then hand the browser a `blob:` URL. `tests/no-api-hrefs.test.ts`
 * exists because of that first try.
 *
 * **The filename has to be on the anchor.** The route sets a
 * `Content-Disposition` naming `<slug>.zip`, and every header is lost the
 * moment the bytes become a blob URL — so without `download="…"` the reader
 * gets a file called something like `a1b2c3-…` with no extension. The header is
 * still right for anyone who reaches the route directly.
 *
 * ## Gated on `hasShelfRow`, and that costs something
 *
 * `hasShelfRow` is false while the metadata request is out **and for ever if it
 * fails**, so a failed check leaves no button and nothing saying why — the
 * exact complaint that moved the sharing card off it (`SharingSection` above).
 * It is still right here, because that card has a "we could not check" state
 * worth rendering and this section is one button: with no row there is nothing
 * to export, and a control whose only outcome is a 404 is worse than no control
 * because pressing it is how you find out.
 */
function ExportSection({
  slug,
  offer,
}: {
  slug: string;
  /** There is a shelf row and we know it — `hasShelfRow` in `Metadata`. */
  offer: boolean;
}) {
  /* The zip is assembled on the server before a byte is sent, so this is a real
     wait — a second or two on a long article — and the button is disabled for
     it. Not only to say so: a second press would start a second assembly and
     hand the reader two copies of the same file. The request itself, and the
     guard that also covers the command bar's Export row, are
     export-download.ts's since 2026-10-02 (plan 261002c). */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await downloadExport(slug);
    /* `busy` is a bar press already building this zip: that one will arrive,
       so this press has nothing to say. */
    if (result.kind === "failed") setError(result.message);
    setBusy(false);
  }

  if (!offer) return null;

  return (
    /* Shut until opened, since 2026-09-30 (SPIDERYARN-READING2-6Z). Kept
       mounted, so a zip being built when the reader shuts it still downloads.
       Its error, if one arrives while shut, is inside `hidden` and so is not
       announced until the section is opened — accepted: the reader shut it
       themselves, mid-wait. GPT Sol, plan review. */
    <Section label="Export" keywords="data files zip markdown take out keep offline" collapsible keepMounted>
      <div className={`${CARD} tw:p-4`}>
        {/* An inline button in the card, in `ArchiveArticle`'s shape rather than
            the toolbar's `IconButton` — this one has a label to carry and no
            row to fit into. Quiet at rest, tinted on hover, and **not** the
            destructive tint: nothing here changes the article. */}
        <button
          type="button"
          onClick={() => void download()}
          disabled={busy}
          className="tw:inline-flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:text-muted-foreground tw:disabled:opacity-50 tw:hover:bg-accent/40 tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:bg-accent/40 tw:focus-visible:text-foreground"
        >
          {/* Not `Download`, which this page has already spent on the fetch
              stage (`STAGE_ICONS`) — two meanings on one glyph, on one page. */}
          <FileArchive size={14} />
          {busy ? "Building the zip…" : "Export this article"}
        </button>

        <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          A zip of everything we hold for this article: the text as we read it, and every
          augmentation on top of it — structure, glossary, ideas, quotes, timeline, quiz, comments,
          chats. Plain files, readable without Spideryarn. Not the original page or PDF, which you
          already have, and not the image files themselves — those are listed rather than included.
        </p>

        {/* `role="alert"`, because the rest of a failed export is invisible: no
            file arrives, and nothing else on the page moves. Same reason
            SourceLink's arm carries one. */}
        {error ? (
          <p
            role="alert"
            className="tw:mt-3 tw:mb-0 tw:inline-flex tw:items-start tw:gap-1 tw:text-sm tw:text-destructive"
          >
            <TriangleAlert size={12} /> {error}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

function AboutYou({ profile, failed }: { profile: string | null; failed: boolean }) {
  return (
    <p className="tw:mt-1 tw:mb-0 tw:text-sm tw:text-muted-foreground">
      {profile ? (
        <span className={voiceClass("reader")}>{profile}</span>
      ) : failed ? (
        <span className="tw:text-ink-faint">We couldn't read your profile just now.</span>
      ) : (
        <span className="tw:text-ink-faint">
          You haven't said anything about yourself yet. Everything is written for a reader we know
          nothing about.
        </span>
      )}
    </p>
  );
}

/**
 * How many questions have been asked, linking back to where they are.
 *
 * `null` is "not answered yet", and it has two causes that must not read the
 * same: still loading, and failed. This said "Counting…" forever in the second
 * case — a page insisting it is working on something it has already given up
 * on. The error itself is spelled out in the section above; this only has to
 * stop claiming to be busy.
 */
function Questions({
  count,
  failed,
  slow,
  href,
}: {
  count: number | null;
  failed: boolean;
  slow: boolean;
  href: string;
}) {
  if (count === null) {
    return (
      <span className="tw:text-muted-foreground">
        {failed ? "Couldn't be counted" : slow ? "Counting…" : ""}
      </span>
    );
  }
  if (count === 0) return <span className="tw:text-muted-foreground">None yet</span>;
  // A link, because a question is worth opening: clicking one scrolls to the
  // passage it is about.
  return (
    <Link href={href} className="tw:text-highlight-text">
      {/* **"Comments", to match the row's own label and the mode's name.** It
          said "questions" under a label that said Comments, which is two words
          for one thing on one line — and the mode a reader has already met in
          the bar is called Comments (docs/project/comments.md). */}
      {count} comment{count === 1 ? "" : "s"}
    </Link>
  );
}

/**
 * **The title as it arrived, when import tidied it, and the way back.**
 *
 * Import makes a title printed in capitals title case and keeps the original
 * (`Meta.titleOriginal`, src/title-tidy.ts). Greg asked that the tidying could
 * be undone, and this line is the undo: the button writes the original as the
 * reader's own title through the page's one rename, so it survives the article
 * being imported again. Nothing is drawn when import changed nothing, or when
 * the title showing already is the original.
 * docs/plans/261005g-tidy-an-imported-title-and-keep-the-original.md
 */
export function ImportedTitle({
  original,
  showing,
  onUse,
}: {
  original: string | undefined;
  showing: string;
  onUse: (title: string) => void;
}) {
  if (!original || original === showing) return null;
  return (
    <p
      data-imported-title
      className="tw:mt-1 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-sm tw:text-muted-foreground"
    >
      <span className="tw:min-w-0">
        Imported as “<span className={voiceClass("author")}>{original}</span>”.
      </span>
      <Button type="button" variant="outline" size="sm" onClick={() => onUse(original)}>
        Use that title
      </Button>
    </p>
  );
}

/**
 * **Where the article came from: a web address, or a file the reader uploaded.**
 *
 * This line was the source URL and nothing else, `{meta.url && …}`, so an
 * uploaded article got no line at all — and the page whose entire job is
 * answering "where did this come from?" simply did not answer. Greg,
 * 2026-08-30, having opened one and gone looking for the address:
 *
 * > Ah, maybe I'm being dense - I forgot that I uploaded it, so that would
 * > explain why it doesn't have the original url where I got the article from!
 * > In that case, make it clear that it was uploaded!
 *
 * **The absence had to be said out loud**, and that is the whole change: a
 * missing row reads as a page that forgot, and the reader spends their
 * attention deciding which. One line either way costs nothing and closes it.
 *
 * ## Saying "uploaded" is safe *here* and is not safe in general
 *
 * There is no field for it — the inference is *no web address, therefore a
 * file* — and it holds only for a reader who owns the article. This page is
 * unreachable for a visitor (`PublicMetadataPage` replaces it, App.tsx) and
 * `/api/metadata/:slug` behind it is owner-only, so it holds here. The masthead
 * is mounted for both and has to gate the same sentence on ownership;
 * `OriginLine` there says what a visitor's absent `url` can also mean.
 *
 * ## Why the file link is on the uploaded branch only
 *
 * A fetched PDF has its address right here, which is the better answer to
 * "where is this from" and the one a reader can share. An uploaded one has
 * nowhere else to point, so the file is the only original there is — and it is
 * also the only verification a scan ever gets (Masthead.tsx § `SeeTheOriginal`).
 * Owner-gated because the route is: `GET /api/source/:slug` serves a stranger's
 * bytes and refuses everyone else, so an ungated control could only ever open a
 * blank tab and fail.
 */
function Origin({
  meta,
  slug,
  owner,
  guess,
}: {
  meta: Meta;
  slug: string;
  owner: boolean;
  /** `Article.sourceGuess`, drawn under the upload sentence — `GuessedLine`. */
  guess: SourceGuess | undefined;
}) {
  const source = webSource(meta);
  if (source) {
    return (
      <p className="tw:mt-1 tw:mb-0 tw:text-xs">
        <a
          href={source}
          target="_blank"
          rel="noreferrer noopener"
          className="tw:inline-flex tw:items-center tw:gap-1 tw:break-all tw:text-highlight-text"
        >
          {source}
          <ExternalLink size={12} className="tw:shrink-0" />
        </a>
      </p>
    );
  }
  /* **`cameOffADisk` is the evidence, not the absent URL.** A missing
     `meta.json` is tolerated and a revision may be published with neither
     `requested_url` nor `final_url` (src/db/schema.ts), so an owner can hold an
     ordinary web article with no address — and "you uploaded this" is a claim about what
     they did, assembled from a gap in our own files. GPT Sol, 2026-08-30. The
     other branch says what is actually true: we have no record of one.

     It was `meta.source === "pdf"` here and in Masthead.tsx until 2026-09-07,
     when an uploaded web page made that both a wrong answer and a question
     about the wrong axis. SourceLink.tsx owns it once now. */
  const uploaded = cameOffADisk(meta);
  /* **We hold an address, and it is not one anybody can follow.** `webSource`
     refuses anything that is not `http(s)`, because an imported article's
     metadata goes straight into the row, so a `javascript:` or `data:` value is
     reachable and an anchor here would be an active URL sink (src/urls.ts,
     docs/project/security.md; GPT Sol, 2026-08-31, the third of three sinks on
     this field). A `file://` from `npm run eval:pdf-read` lands here too.

     **Only the sentence changes; the address itself is never printed.** An
     earlier version of this line showed the refused value as inert text, on the
     argument that this is the page whose job is saying what we hold. It is not
     worth it: the commonest such value is `file:///Users/<somebody>/…`, which is
     a home directory on a page, and tests/metadata-origin.test.tsx pins that it
     stays off. What *is* worth keeping is not saying something false — "no web
     address was recorded" about a row that recorded one. */
  const unfollowable = Boolean(meta.url && !isWebUrl(meta.url));
  return (
    <>
      <p className="tw:mt-1 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
        {uploaded ? (
          <Upload size={12} className="tw:shrink-0" aria-hidden="true" />
        ) : (
          <FileQuestion size={12} className="tw:shrink-0" aria-hidden="true" />
        )}
        <span>
          {uploaded
            ? "Uploaded from a file — there is no web address to go back to."
            : unfollowable
              ? "The address recorded for this article is not one a browser can follow."
              : "No web address was recorded for this article."}
        </span>
        {/* Only for a PDF: `GET /api/source/:slug` serves what stage 1 stored,
            and an uploaded HTML document has nothing a reader would want opened
            as a document. `slug` is the route's, never `meta.slug` — an address
            with no article of its own is answered with the fixture's meta, and
            this link must be about the address the reader is standing on. */}
        {uploaded && owner && (
          <span className="tw:text-highlight-text">
            <SourceLink slug={slug}>View the original</SourceLink>
          </span>
        )}
      </p>
      {uploaded && <GuessedLine guess={guess} />}
    </>
  );
}

/**
 * **What we found when we looked for an upload on the web** — the line under
 * the upload sentence. docs/plans/260929g-canonical-link-for-an-uploaded-paper.md
 * § Shown how.
 *
 * Unlike the masthead, this page also says a settled **no**: it is the page a
 * reader opens to ask where something came from, and *we looked and found
 * nothing we could be sure of* is an answer to that. While a search is under
 * way, or nobody has looked, it says nothing — the reading view is what asks
 * (src/web/useSourceGuess.ts), and this line fills in when the answer is
 * layered onto the payload.
 *
 * Owner-only by construction: this page is unreachable for a visitor. A
 * visitor sees a shared upload's found guess in the banner instead
 * (PublicChrome.tsx § `SharedNotice`, plan 261002g).
 */
function GuessedLine({ guess }: { guess: SourceGuess | undefined }) {
  if (guess === undefined || guess.status === "searching") return null;
  return (
    <p className="tw:mt-1 tw:mb-0 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-1.5 tw:text-xs tw:text-muted-foreground">
      {guess.status === "none" ? (
        "We looked for it on the web and found no page we could be sure was this paper."
      ) : (
        <>
          <span>
            {guess.kind === "canonical" ? "Probably the original:" : "A page that matches this paper:"}
          </span>
          <GuessedSourceLink guess={guess} className="origin-link origin-guess" />
        </>
      )}
    </p>
  );
}

/**
 * A PDF's provenance: what it was made from, by what, and how well that was checked.
 *
 * **Renders nothing for a web page**, deliberately. Their Document Information
 * had a "file type" row and ours never took it, because on the day this page
 * was built every answer was the same. A web page's section here would be one
 * row saying "a web page" under a URL that already said so, and a section that
 * exists to say nothing is worse than its absence.
 *
 * The masthead already tells the *reader* the shape of this, in a sentence,
 * because they are entitled to know before they trust a line of it
 * (Masthead.tsx). This is the same fact with the numbers attached, on the page
 * you open when you want numbers. docs/plans/260826c-pdf-ingestion.md.
 */
function CameFrom({ meta }: { meta: Meta }) {
  if (meta.source !== "pdf") return null;
  return (
    /* **"Where it came from" until 2026-09-03**, which described the section
       next to it rather than this one: where it came from is the URL or the
       "uploaded from a file" line under the title, three inches up. What is
       actually in here is a transcription and how far to trust it, so the
       heading now says that. Fable, 2026-09-03. */
    <Section
      label="How well we read the PDF"
      keywords="transcription missed missing words pages accuracy errors mistakes garbled ocr scanned"
    >
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
          <Row icon={FileType} label="Made from">
            A PDF{meta.pages ? `, ${meta.pages} page${meta.pages === 1 ? "" : "s"}` : ""}
          </Row>
          {meta.method && (
            <Row icon={Bot} label="Transcribed by">
              <span className="tw:font-mono tw:text-xs tw:break-all">{meta.method}</span>
            </Row>
          )}
          {/* **"Words we may have missed", not "Checked".** Greg, 2026-09-03:
              *"the one for 'Where it came from / Checked' is very confusing"*,
              and it was confusing in three separate ways.

              "Checked" named the *process* — did a check happen — while a
              reader is asking about the *outcome*: can I trust the words on
              the screen to be the words in the file. So the row is named after
              what it measures, and stated as a shortfall, which is the
              direction somebody worries in. "83% of the words" also read as a
              grade, and 83% is not a mark out of a hundred; it is coverage.

              Second, the tooltip said "averaged over the pages that had one",
              and that is not what the number is: `recall` is
              `matchedTokens / baselineTokens` (src/pdf-read.ts), pooled across
              every checked page and therefore weighted by how much text each
              page had — not a mean of per-page recalls. Both this tooltip and
              the field's own docstring in src/types.ts said "mean"; the
              docstring is corrected in the same commit.

              Third, and worst, "on 3 of 17 pages" was never explained, so the
              obvious reading is "14 pages failed". It means the other fourteen
              carry no hidden text to compare against, so nothing could check
              them — which is a much more useful thing to know and was findable
              only by reading `pagesChecked`'s definition. Fable, 2026-09-03. */}
          <Row icon={ScanLine} label="Words we may have missed">
            <Missed meta={meta} />
          </Row>
          {/* **Fingerprint has gone to `TechnicalDetails`.** Greg named it as
              one of the things to put away, and it was the odd row here in any
              case: the three rows above are about whether to trust the words,
              and a hash answers "is this the same file", which is a different
              question asked by a different person on a different day. */}
        </div>
      </TooltipGroup>
    </Section>
  );
}

/** A heading for one card inside a section, without starting a section of its own. */
function SubHeading({ children }: { children: ReactNode }) {
  /* An `h3` rather than a styled `p`, so a screen reader still gets the page's
     outline — but deliberately NOT a nested `Section`, which would put "What we
     did to it" into the contents list in the margin as if it were a peer of
     "Your reading". `Section` is what `[data-section]` means. */
  return (
    <h3 className="tw:mt-5 tw:mb-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.06em] tw:text-ink-faint">
      {children}
    </h3>
  );
}

/**
 * Everything true about this article that is about us rather than about it.
 *
 * ## What this section is for
 *
 * Greg, 2026-09-03, having opened the page on a real article and met
 * `temporal-context-reinstatement-spya-dhqkf9` and
 * `spideryarn.article_revisions/e7efb065-…/` under the title:
 *
 * > I don't know what these are. Give them tooltips, and maybe also hide them
 * > in a section of "Technical details" (default collapsed) or something like
 * > that, along with Fingerprint, etc.
 *
 * and, of the nine-to-thirteen rows of stage names and file paths:
 *
 * > Move "What we did to it" down, and maybe put that in the Technical Details.
 *
 * So: both, and the "not built yet" row too, which was a note about the stage
 * rows above it and had a section of the page to itself for one dimmed line.
 * Everything in here is *true* and none of it changes how you read the article,
 * which is the test for what belongs.
 *
 * **That row has gone**, on 2026-09-07: its one entry was *"Re-run a stage"* and
 * it shipped as *Generate it again*. From 2026-09-29 until 2026-10-01 it was the
 * shut *Re-run AI processing* section near the foot, immediately above Archive;
 * that section is now *AI processing*. This is the second half of the story this
 * paragraph tells: burying it here is exactly why nobody found it. See
 * `RerunSection` above, and the note where `SOON` stood.
 *
 * ## The rule this section inherits, and must not break
 *
 * "What we did to it" was collapsible **only while nothing had gone wrong**,
 * because the metadata request's error message lives in it and a shut heading
 * is exactly where an error goes to not be seen. A cross-model review found
 * that on 2026-08-27, when the first version hid it.
 *
 * Moving those rows into a section that is shut *by default* rather than by
 * choice makes that rule matter more, not less — so it comes along, unchanged:
 * `collapsible={!error}`, and a failure draws the whole section open with the
 * error at the top. tests/metadata-page-order.test.tsx pins it, and pins that
 * the section is really there while it does — the first draft of that test
 * passed against a page with no such section at all.
 *
 * ## And then they moved again, and the rule with them
 *
 * On 2026-10-01 *What we did to it* left this section for *AI processing*,
 * beside the re-run rows — Greg, `spya-qgh5ta`: *"amalgamate "What we did to
 * it" and "Re-run AI processing""*. The error and `collapsible={!error}` went
 * with the rows (`RerunSection`, `StageRecord`), so this section, which is
 * now only identifiers and a fingerprint, is always collapsible.
 * docs/plans/261001j-five-small-feedback-tooltips-and-labels.md § 5.
 */
function TechnicalDetails({
  slug,
  provenance,
  rawSha256,
}: {
  slug: string;
  provenance: ArticleMetadata | null;
  /** The PDF's hash, if this article is one. */
  rawSha256: string | undefined;
}) {
  return (
    <Section
      label="Technical details"
      keywords="address url source original stored storage location link fingerprint hash slug id revision where from website web page developer"
      collapsible
    >
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
          {/* **The slug, called what it is to the person reading.** "Slug" is
              our word; the reader's word for this string is the address, since
              it is the part of the URL in front of them. The tooltip answers
              the question the string actually provokes on an article whose
              title has since been edited. */}
          <Row icon={Link2} label="Address">
            <Tooltip
              placement="top"
              content={
                <TipNote>
                  The last part of this article's web address — the `/read/…/` in your address
                  bar. Made from the title when you added it, plus a few random letters so two
                  articles with the same name never collide. Renaming the article does not change
                  it.
                </TipNote>
              }
            >
              <button
                type="button"
                className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:font-mono tw:text-xs tw:break-all tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
              >
                {slug}
              </button>
            </Tooltip>
          </Row>
          {provenance && (
            <Row icon={Database} label="Stored as">
              <Tooltip
                placement="top"
                content={
                  <TipNote>
                    Where this article's data physically sits. There is nothing to do with it —
                    except quote it if you are reporting a problem with this particular article,
                    which is the one thing it is good for.
                  </TipNote>
                }
              >
                <button
                  type="button"
                  className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:font-mono tw:text-xs tw:break-all tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
                >
                  {provenance.dir}/
                </button>
              </Tooltip>
            </Row>
          )}
          {/* Down from "how well we read the PDF", where it was the odd row
              out: the three rows around it are about whether to trust the
              words, and this one is an identity check on the file. */}
          {rawSha256 && (
            <Row icon={Fingerprint} label="Fingerprint">
              <Tooltip
                placement="top"
                content={
                  <TipNote>
                    A checksum of the PDF exactly as we received it. Two files with the same
                    fingerprint are the same document, whatever they have been named or wherever
                    they were downloaded from.
                    <br />
                    <span className="tw:font-mono tw:break-all">{rawSha256}</span>
                  </TipNote>
                }
              >
                {/* Twelve characters is enough to recognise one and far too
                    few to compare two, which is what the tooltip is for — and
                    since the other 52 are only in the tooltip, the trigger has
                    to be reachable by keyboard. */}
                <button
                  type="button"
                  className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:font-mono tw:text-xs tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
                >
                  {rawSha256.slice(0, 12)}…
                </button>
              </Tooltip>
            </Row>
          )}
        </div>
      </TooltipGroup>
    </Section>
  );
}

/** The quiet inline button this page uses for an act with a sentence beside it. */
const QUIET_BUTTON =
  "tw:inline-flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:disabled:opacity-50 tw:focus-visible:outline-none tw:text-muted-foreground tw:hover:bg-accent/40 tw:hover:text-foreground tw:focus-visible:bg-accent/40 tw:focus-visible:text-foreground";

/**
 * **Archive and Share…, under the title.** Greg, 2026-09-30
 * (SPIDERYARN-READING2-6Z): *"perhaps we could add a button to archive near the
 * top because that's going to be quite a common action, and also a button to
 * publicly share."*
 *
 * - **Archive is the same act as the section at the foot of the page**, off the
 *   same `useArchive` state, and it follows that section's rules: no button
 *   while we do not know, one `<button>` across both labels so focus survives
 *   the press, the box and never the bin or the red. Nothing navigates — *"it
 *   doesn't need to kick you out of the article itself"* — and the line under it
 *   says so. That line and the error are plain text: the section's `status` and
 *   `alert` already announce them once.
 * - **Share… does not share.** It takes the reader to *Access & sharing* and
 *   lands on its heading, because publishing has its own confirmation and
 *   rights tick-box there and this must not become a way round them — Greg
 *   expected as much: *"it'll probably have to take you to the section for
 *   public sharing"*. It does not know whether the article is already public;
 *   saying so would mean lifting `AccessSharing`'s state up too, deferred in the
 *   plan.
 *
 * Neither on the fixture, where there is no row to archive or share.
 * docs/plans/260930h-metadata-collapses-more-sections-and-archive-and-share-near-the-top.md.
 */
function TopActions({
  archive,
  fixture,
  onShare,
}: {
  archive: ArchiveControl;
  fixture: boolean;
  /** Scroll to *Access & sharing* and focus its heading. */
  onShare: () => void;
}) {
  const now = useNow();
  if (fixture) return null;
  const { at, busy, error, set } = archive;
  const archived = at !== null && at !== undefined;
  const when = archived ? timeAgo(at, now) : undefined;
  return (
    <div className="tw:mt-4 tw:flex tw:flex-wrap tw:items-center tw:gap-2" data-testid="metadata-top-actions">
      {/* Fixed slots, `? … : null`, so the Archive button keeps its DOM node
          when the lines around it come and go — see `ArchiveArticle`. */}
      {at !== undefined ? (
        <button
          type="button"
          data-top-action="archive"
          onClick={() => void set(!archived)}
          disabled={busy}
          title={
            archived
              ? "Back onto the shelf."
              : "Off the shelf, and reversible. You stay here and can carry on reading."
          }
          className={QUIET_BUTTON}
        >
          {archived ? <Undo2 size={14} /> : <Archive size={14} />}
          {busy ? (archived ? "Putting back…" : "Archiving…") : archived ? "Put back" : "Archive"}
        </button>
      ) : null}
      <button
        type="button"
        data-top-action="share"
        onClick={onShare}
        title="Takes you to Access & sharing below, which asks before anything goes public."
        className={QUIET_BUTTON}
      >
        <Globe size={14} />
        Share…
      </button>
      {archived ? (
        <p className="tw:m-0 tw:basis-full tw:text-sm tw:text-foreground">
          {when ? `Archived ${when}` : "Archived"} — off the shelf, and you can carry on reading.
        </p>
      ) : null}
      {error ? (
        <p className="tw:m-0 tw:basis-full tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:text-destructive">
          <TriangleAlert size={12} /> Couldn't confirm that — {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Archive section at the foot of the page: the control, and what it does
 * said before it is done. Its state is `useArchive`'s, above, which is where
 * the rules about unknown and failed states now live.
 */
function ArchiveArticle({
  archive,
  fixture,
}: {
  /** The page's one archive state, shared with `TopActions`. */
  archive: ArchiveControl;
  /** This address has no article of its own — see `showingFixture` at the call site. */
  fixture: boolean;
}) {
  const { at, lost, busy, error, set } = archive;
  const now = useNow();

  /* Not ignorance but a refusal, and it comes first because it is the one state
     where the answer is known and the act is still impossible: nothing under
     this address is ours to archive. */
  if (fixture) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          This address has no article of its own — the reading view is showing the example fixture,
          so there is nothing here to archive. The{" "}
          <Link href={LIBRARY_HREF} className="tw:text-highlight-text">
            library
          </Link>{" "}
          has the articles that do exist.
        </p>
      </div>
    );
  }

  /* Rendered whenever `at` is unknown, which is three situations and not one:
     the first request is in flight, it failed, or a write failed and the
     re-read after it failed too. No button in any of them — a *disabled*
     Archive would still be telling the reader the article is on the shelf, and
     none of the three establishes that. */
  if (at === undefined) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p
          className="tw:m-0 tw:text-sm tw:text-muted-foreground"
          /* `alert` only when there is something to hear. "Checking…" is not
             news; "we cannot tell you" arriving after a click is. */
          {...(lost ? { role: "alert" as const } : {})}
        >
          {lost
            ? "Couldn't check whether this one is archived, so there is nothing safe to offer here. Reload the page."
            : "Checking…"}
        </p>
        {error ? (
          <p className="tw:mt-3 tw:mb-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:text-destructive">
            <TriangleAlert size={12} /> {error}
          </p>
        ) : null}
      </div>
    );
  }

  const archived = at !== null;
  const when = timeAgo(at ?? undefined, now);

  /* **One `<button>` element in both states, not two behind a ternary.** The
     reader presses Archive with the keyboard; if the two states were separate
     elements React would unmount the one they are standing on and mount a
     different one, and focus would fall to `<body>` — so the next Tab starts
     from the top of the page and a screen reader loses its place, at the exact
     moment there is something worth hearing. Same element, changed label,
     changed handler: the DOM node survives and focus stays on it. The icons do
     swap, but they are inside the button, so nothing focusable moves.

     The conditional children below are `? … : null` at fixed positions for the
     same reason: React reconciles a fixed set of JSX children by position, and
     a `null` holds its slot — inserting the "Archived" line without one would
     shift the button along by one and remount it after all. */
  return (
    <div className={`${CARD} tw:p-4`}>
      {archived ? (
        /* `status`, not `alert`, for the same reason the shelf's Undo strip is:
           the reader did this on purpose, so it is a confirmation rather than an
           emergency.

           `timeAgo` on a `useNow` clock, and both halves of that matter. (This
           file had a private `ago` until 2026-10-04 that had neither.) The
           clock, because this line is written the instant the reader presses
           Archive: a `Date.now()` read once during render would have "Archived
           just now" still saying "just now" an hour later. And `timeAgo`, because
           it hands back `undefined` for a date it cannot parse instead of
           feeding `NaN` to `Intl.RelativeTimeFormat`, which throws. Both found
           by a cross-model review, 2026-08-27. */
        <p role="status" className="tw:m-0 tw:mb-3 tw:text-sm tw:text-foreground">
          {when ? `Archived ${when}.` : "Archived."}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void set(!archived)}
        disabled={busy}
        className={`tw:inline-flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:disabled:opacity-50 tw:focus-visible:outline-none ${
          archived
            ? "tw:text-highlight-text tw:hover:bg-highlight/10 tw:focus-visible:bg-highlight/10"
            : /* Quiet at rest and tinted on hover — the shelf's own Archive
                 button (ShelfEntry.tsx), one convention for the one act, and the
                 heading above already carries the weight.

                 **Not the destructive red**, which it wore until 2026-09-04.
                 Red is this app's word for *this cannot be undone*, and the
                 paragraph directly below promises the opposite for ever.

                 That used to end *"there is now no destructive tint anywhere on
                 this page"*, and since 2026-09-07 there is exactly one:
                 `DeletePermanently` below, on **Delete for ever** inside its
                 confirm step and nowhere else. That is the sentence above
                 finally being paid rather than contradicted — the one control
                 on this page that genuinely cannot be un-rung is the one thing
                 wearing the colour that means it, and Archive keeping the quiet
                 treatment is what makes the difference legible. Publishing is
                 still guarded by a question rather than a colour
                 (AccessSharing.tsx), because unshare exists. */
              "tw:text-muted-foreground tw:hover:bg-accent/40 tw:hover:text-foreground tw:focus-visible:bg-accent/40 tw:focus-visible:text-foreground"
        }`}
      >
        {archived ? <Undo2 size={14} /> : <Archive size={14} />}
        {busy ? (archived ? "Putting back…" : "Archiving…") : archived ? "Put back" : "Archive"}
      </button>

      {/* What it actually does, said before it is done rather than in a confirm
          dialog after. There is no dialog on purpose: the act is reversible from
          this same spot for ever, and a modal asking you to confirm something
          undoable trains people to click through modals. */}
      <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {archived ? (
          <>
            It is archived, so the library and its search hide it by default; Include archived
            lists and searches it there. It is not erased, and this offer does not expire.
          </>
        ) : (
          <>
            It moves to the archive, which the library and its search hide by default; Include
            archived lists and searches it there. Nothing is erased — the article, its block ids and
            every question you have asked about it stay exactly where they are, this page and the
            reading view keep working, and Put back is here and under{" "}
            <em className="tw:not-italic tw:text-foreground">Include archived</em> on the{" "}
            <Link href={LIBRARY_HREF} className="tw:text-highlight-text">
              library
            </Link>
            .
          </>
        )}
      </p>

      {/* `alert`, because it arrives without the reader looking for it and it
          contradicts what they just pressed — the one thing on this page that
          has to interrupt. And it says *couldn't confirm*, never "nothing
          changed": the state above it has been re-read from the server, so what
          is shown is true, but whether the write landed is genuinely unknown. */}
      {error ? (
        <p
          role="alert"
          className="tw:mt-3 tw:mb-0 tw:inline-flex tw:items-center tw:gap-1 tw:text-sm tw:text-destructive"
        >
          <TriangleAlert size={12} /> Couldn't confirm that — {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 *  Delete permanently
 * ---------------------------------------------------------------------- */

/**
 * **What is destroyed, said once**, because the reader reads it at rest and
 * again inside the question — and two copies of this sentence would drift.
 *
 * It names the reader's own work first and ours second, which is the order the
 * loss is felt in. Everything in it is true of the cascade: comments, notes,
 * highlights, questions, chats, summaries and the structure all hang off the
 * article by a foreign key and go with it (docs/plans/260906h § *What survives
 * a delete, deliberately* has the short list that does not, none of which is
 * anything the reader would look for afterwards).
 *
 * **And it points at Archive rather than gating on it.** The recorded design
 * wanted Delete offered only over an already-archived article, so *"offer to
 * just archive instead"* became structural; Greg overruled that on 2026-09-06
 * — a gate is a greyed-out control that needs explaining and doubles the trip
 * for somebody who meant it. This sentence is the steering that gate was for.
 */
const DELETE_ERASES =
  "This erases the article and everything you have done with it — your comments, notes, " +
  "highlights, questions and chats, its summaries and structure — and it cannot be undone. " +
  "If you only want it off the shelf, Archive above does that and can be reversed.";

/** Said only when we KNOW it is public — see `shared` at the call site. */
const DELETE_SHARED = "It is shared, so anyone with the link will find nothing there afterwards.";

/**
 * **The one promise this feature cannot keep, said before it is broken.**
 *
 * Stage E removes the stored objects, and everything in this app's own database
 * goes with the article — but a file that has already reached the reader's
 * machine is on the reader's machine. Two of those are ours to name because we
 * put them there: the copy this browser saved so the article opens offline
 * (lib/offline-store.ts), and any export the reader has taken. There is a
 * third, `src/routes.ts:605`, where authenticated plates and assets are served
 * `immutable` for a year, so a browser may go on painting an image out of its
 * HTTP cache after the article is gone — that one is a bug to fix rather than a
 * fact to state, and it is this sentence's business only until it is fixed.
 *
 * Said in `docs/project/privacy.md` too, in the same plain words. A "delete
 * permanently" that quietly means "except the copies" is exactly the kind of
 * claim that page exists to stop us making.
 */
const DELETE_DEVICE_COPIES =
  "Anything already on a device stays there: the copy this browser saved so the article " +
  "opens offline, and any export you have taken. We cannot recall those.";

/**
 * Everything the reader is agreeing to, and the way out of agreeing to it.
 *
 * A component rather than four lines repeated in two branches — the rest state
 * shows the first two, and the question shows all of them, because the extra
 * warnings belong beside the press that acts rather than beside the press that
 * opens a question.
 */
function WhatDeleteDoes({ shared, full }: { shared: boolean; full: boolean }) {
  return (
    <>
      <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
        {DELETE_ERASES}
        {shared ? ` ${DELETE_SHARED}` : ""}
      </p>
      {full ? (
        <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          {DELETE_DEVICE_COPIES}
        </p>
      ) : null}
      {full ? (
        <p className="tw:mt-3 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          {/* **The offer that turns an irreversible act into a recoverable
              one**, and the archive note asked for it by name. A button that
              scrolls, not `<a href="#sec-export">`: this app routes its own
              anchors and keeps `#` out of an address bar it deliberately keeps
              clean (PageContents.tsx says the same thing at length).

              Scoped to the enclosing `<main>` rather than `document`, for
              PageContents' reason: two of these pages mounted at once carry
              duplicate ids and a document-wide lookup scrolls to the wrong one.
              Export is offered under exactly the gate this control is —
              `hasShelfRow` — so the section is always there to scroll to. */}
          <button
            type="button"
            onClick={(e) =>
              e.currentTarget
                .closest("main")
                ?.querySelector<HTMLElement>("#sec-export")
                ?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-highlight-text tw:underline tw:underline-offset-4 tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
          >
            Export it first
          </button>{" "}
          if you might want any of it afterwards.
        </p>
      ) : null}
    </>
  );
}

/** A message with a full stop on the end, whatever the server sent. */
function ended(message: string): string {
  const said = message.trim();
  return /[.!?]$/.test(said) ? said : `${said}.`;
}

/**
 * **Is that article still on the server?** — and the two answers that are
 * neither "yes" nor "no".
 *
 * This exists because the obvious re-read is wrong in a way nothing would show
 * you. `apiFetch` answers a GET whose transport failed out of the saved copy,
 * with a real `Response`, status 200 and `x-spideryarn-offline: copy`
 * (lib/api.ts § `attempt`) — which is exactly right for every other caller and
 * catastrophic for this one: the naive version reports *"still here,
 * untouched"* about an article that has been destroyed, and the reader believes
 * it. GPT Sol's F6.
 *
 * So: **only a fresh server 404 proves it went, and only a fresh server 200
 * proves it survived.** A copy, a transport failure, a 500, a 401 — none of
 * those is evidence in either direction, and they all come back `"unknown"`,
 * whose sentence says so rather than guessing.
 *
 * The body is never read. The status and one header are the whole answer, and
 * parsing a body we are not going to render would only add a way to fail.
 */
type Survival = "gone" | "here" | "unknown";

async function stillOnTheServer(slug: string): Promise<Survival> {
  try {
    const res = await apiFetch(`/api/metadata/${encodeURIComponent(slug)}`);
    if (res.headers.get("x-spideryarn-offline") === "copy") return "unknown";
    if (res.status === 404) return "gone";
    /* **200 and nothing else**, and this was `res.ok` until 2026-09-08 ⟨Sol,
       F24⟩ — which also takes 201, 202, 204 and 206. A re-read answered
       `204 No Content` therefore made this control say *"still here,
       untouched"* about an article that had just been destroyed, which is the
       exact sentence the paragraph above exists to prevent. The comment said
       *only a fresh server 200*; now the code does too. */
    if (res.status === 200) return "here";
    return "unknown";
  } catch {
    /* No status, and there never will be one for this request. */
    return "unknown";
  }
}

/**
 * Destroy this article, for good — the other ending, beside Archive above.
 *
 * Greg, 2026-09-06:
 *
 * > We have a way to Archive documents, which is great. I think we also need a
 * > way to delete them permanently (probably only visible for now from within
 * > Metadata for that article, underneath Archive, with appropriate UI
 * > styling). Obviously be extra-careful to make sure that people can only
 * > delete articles they own, etc.
 *
 * The store was built the other way round on purpose — `schema.ts` says *"Never
 * a delete; Greg chose archive + Undo"* — so this is the first irreversible act
 * a reader can perform on their own data here. `DELETE /api/library/:slug`
 * (src/routes.ts), `ShelfStore.destroy` (src/store/pg-shelf.ts), and the whole
 * argument in docs/plans/260906h-delete-an-article-permanently.md.
 *
 * ## It inherits `ArchiveArticle`'s three states, and adds two
 *
 * Never offer a button over a state we have not established, and every refusal
 * below is that one rule. `known` is *the metadata request has landed*; the
 * fixture refuses for the reason it does above; **`failed` refuses on its own**
 * rather than only when `known` is false, because a failed *refresh* keeps the
 * previous answer and would otherwise leave deletion offered over metadata the
 * client explicitly failed to re-establish (⟨Sol, F23⟩, at the branch).
 *
 * The first of the two new ones is **`offline`**: `apiFetch` answers a GET whose
 * transport failed from the saved copy with a real 200 (`provenanceOffline` at
 * the call site), and a body saved yesterday cannot say whether this article is
 * still there, still ours, or already gone. Archive can be wrong about that and
 * be put right by pressing Put back; this cannot.
 *
 * The second is **`uncertain`**, and it is the only one that arrives *after* a
 * press: the DELETE did not come back and the server would not say what is
 * there now, so there is nothing honest left to offer (⟨Sol, F26⟩; the state is
 * declared below).
 *
 * In every one of them the control is **absent**, not disabled — a dimmed
 * *Delete permanently* still claims there is something here to delete.
 *
 * ## Two steps, no modal, and the second one is somewhere else
 *
 * No dialog, for `AccessSharing`'s reason: there is no dialog component in this
 * app, and a modal is machinery (focus trap, restore, escape, scroll lock) for
 * an interruption, which this is not. The row is replaced in place by the
 * question.
 *
 * **The confirm button must not land where the trigger was**, or a double-click
 * destroys an article. At rest the trigger is the card's first element; in the
 * question it is the heading, and the button that destroys sits under three
 * paragraphs of it. That is the whole guard, and
 * tests/metadata-delete-permanently.test.tsx asserts the structure rather than
 * a pixel, because jsdom has no layout.
 *
 * Nothing is auto-focused, for the other half of the same hazard: a `Space`
 * held down on a button fires its click on keyup, so a control that took focus
 * here would be activated by the press that opened it. The trigger is unmounted
 * outright rather than relabelled — deliberately the **opposite** of
 * `ArchiveArticle`, which keeps one `<button>` across both its states so that
 * focus survives a press. There, keeping focus is a kindness; here it is the
 * bug.
 *
 * ## And afterwards, the answer is a fresh read, not the request's exit code
 *
 * `ArchiveArticle`'s catch block is the lesson and this is the harder version
 * of it: a failed request is not proof that nothing was written, so we ask —
 * but only the server may answer. `stillOnTheServer` above.
 *
 * And the other half of the same rule, which took a second review to land: a
 * *successful* request is not proof that anything **was** written either. The
 * route answers `{ destroyed: slug }`, and the client requires it to name this
 * slug before it believes a word of it — see the check in `destroy`.
 *
 * A **409** is the exception, and it is one because it is already a fresh
 * server answer that deleted nothing: `destroy` refuses on the live-job check
 * before it reaches the `DELETE` statement (src/store/pg-shelf.ts §
 * `importRunning`). So there is nothing to re-read, and the reader stays in the
 * question, where they can stop the import in the band above and press again.
 * The sentence is the server's own, unwrapped — it says what is in the way and
 * what to do about it, and a *"Couldn't delete it —"* in front of it would add
 * a lead it does not need (`ExportSection` makes the same call about the 413).
 */
function DeletePermanently({
  slug,
  title,
  known,
  offline,
  failed,
  fixture,
  shared,
}: {
  slug: string;
  /** For the question, so the reader reads WHICH article they are destroying. */
  title: string;
  /** The metadata request has landed — `provenance !== null` at the call site. */
  known: boolean;
  /** …but out of the cupboard rather than off the network. See the header. */
  offline: boolean;
  failed: boolean;
  /** This address has no article of its own — `showingFixture` at the call site. */
  fixture: boolean;
  /** Known to be public. False where the store could not say — see the call site. */
  shared: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * **We asked, and we no longer know** — `ArchiveArticle`'s `at: undefined`,
   * for the act that cannot be pressed twice on a guess.
   *
   * Set only from the re-read's `"unknown"`: the DELETE did not come back and
   * the server would not say what is there now. A separate flag rather than a
   * fourth value on `error`, because the two questions are different — `error`
   * is *what to tell the reader*, this is *whether there is anything left to
   * offer them* — and the branch below has to be readable as the second one.
   *
   * One-way. Nothing here clears it, because nothing here can learn the answer:
   * the reader is told to reload, and a reload is what re-establishes the state.
   */
  const [uncertain, setUncertain] = useState(false);

  /**
   * Retire the cached set of the reader who pressed, then go to the library.
   *
   * **In that order, and awaited.** Invalidating `/api/library` alone is not
   * enough — metadata, comments, chat, search, glossary and illustrated are all
   * cacheable (lib/api.ts § `cacheable`) — and navigating first would let the
   * shelf paint a card for an article that no longer exists, which
   * `offline-store.ts` points out looks exactly like a delete that failed.
   * `forgetCachedReader` never throws.
   *
   * **`reader` is captured before the DELETE goes out, not looked up here.** By
   * the time this runs a round trip has gone by, and an account switch inside it
   * would send us to empty the *new* reader's drawer while leaving the old one
   * holding the destroyed article — cached-shelf.ts § *The reader is an argument*
   * has both halves of that and the limit of the repair. ⟨Sol, F27.⟩
   */
  async function leave(reader: string | null): Promise<void> {
    await forgetCachedReader(reader);
    navigate(LIBRARY_HREF);
  }

  async function destroy(): Promise<void> {
    /* Before anything is sent. See `leave` above. */
    const reader = cachedReaderNow();
    setBusy(true);
    setError(null);
    try {
      const answer = await readJson<{ destroyed?: unknown }>(
        await apiFetch(`/api/library/${encodeURIComponent(slug)}`, { method: "DELETE" }),
      );
      /**
       * **The route names what it destroyed, and we make it.** ⟨Sol, F25.⟩
       *
       * This parsed `{ destroyed }` and threw it away until 2026-09-08, so a
       * *status* was the whole of the proof — and `readJson` deliberately turns
       * an empty successful body into `{}` (lib/api.ts), which means a `204`, a
       * `{}`, or a body naming somebody else's slug all read as *deleted*. On
       * any of those the reader's entire cached set was retired and they were
       * taken to their library, over a request that may have deleted nothing.
       * That is the silent success this repo keeps writing up
       * (docs/reusable/silent-success.md), in the one place where being wrong
       * cannot be walked back.
       *
       * The throw is not a dead end: it drops into the catch below, which asks
       * the server what is actually there. So a route that really did delete
       * and merely answered oddly still ends with the reader in their library —
       * by evidence rather than by assumption.
       */
      if (answer.destroyed !== slug) {
        throw new Error("The server did not confirm which article was deleted");
      }
      await leave(reader);
      /* No `setBusy(false)`: the article is gone and we are on our way out.
         Re-enabling a button over a destroyed article is the one state this
         component must never draw. */
    } catch (e) {
      /* An import is in the way. A fresh refusal, nothing written — see the
         header on why this one does not re-read. */
      if (statusOf(e) === 409) {
        setError(ended((e as Error).message));
        setBusy(false);
        return;
      }
      const survival = await stillOnTheServer(slug);
      if (survival === "gone") {
        /* The response was lost on the way back, but the delete landed. Saying
           "that failed" here would be this control's one dishonest sentence. */
        await leave(reader);
        return;
      }
      if (survival === "unknown") {
        /* **We do not know, so we offer nothing.** ⟨Sol, F26.⟩ Until
           2026-09-08 this set the honest sentence and then left `asking` true
           and put `busy` back to false, so *Delete for ever* stood enabled
           directly under an admission that we could not say whether the
           article still existed — the one thing this component's header
           forbids, done in its own error path. A second press from there sends
           another DELETE for something that may already be gone. */
        setError("Couldn't tell whether that worked. Reload the page.");
        setUncertain(true);
        setBusy(false);
        return;
      }
      setError(
        `Couldn't delete it — ${ended((e as Error).message)} The article is still here, untouched.`,
      );
      setBusy(false);
    }
  }

  /* Known, and still impossible: nothing under this address is ours to destroy.
     First, for `ArchiveArticle`'s reason — it is a refusal rather than an
     ignorance. */
  if (fixture) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          This address has no article of its own — the reading view is showing the example fixture,
          so there is nothing here to delete.
        </p>
      </div>
    );
  }

  /* **The reader has already pressed, and we cannot say what happened.** Second,
     because it is the strongest claim on this card: it outranks *this page is a
     saved copy* and *we could not check this article*, both of which are about
     what we know now, while this one is about what we may already have done. No
     control of any kind — not the confirm, not Keep it, and not the trigger,
     which would invite the second DELETE. Only a reload settles it. */
  if (uncertain) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p
          role="alert"
          className="tw:m-0 tw:inline-flex tw:items-start tw:gap-1 tw:text-sm tw:text-destructive"
        >
          <TriangleAlert size={12} /> {error ?? "Couldn't tell whether that worked. Reload the page."}
        </p>
      </div>
    );
  }

  /* A saved copy of this page is not evidence about the article. No button, not
     a disabled one. */
  if (offline) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          This page is a saved copy, so we can't tell you what is really on the server — and
          deleting something for good is not a thing to do on a guess. Reload once you are back
          online.
        </p>
      </div>
    );
  }

  /* In flight, or it failed. Neither establishes that there is an article here,
     so neither may offer a button.

     **`|| failed`, and it was `!known` alone until 2026-09-08** ⟨Sol, F23⟩. A
     failed *first* load leaves `provenance` null and both halves agree; a
     failed **refresh** does not, because `readProvenance` deliberately keeps
     the previous answer so the page does not empty out over one lost
     revalidation (see its header). Every row in *AI processing* can fire
     one. So this control arrived at `known=true, failed=true` — a state the
     first load cannot produce — and went on offering deletion over metadata
     the client had explicitly failed to re-establish, in the window where the
     article may have been destroyed elsewhere or changed hands. Keeping the
     stale rows is right for everything else on this page and wrong for exactly
     this one. */
  if (!known || failed) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p
          className="tw:m-0 tw:text-sm tw:text-muted-foreground"
          /* `alert` only when there is something to hear, exactly as above. */
          {...(failed ? { role: "alert" as const } : {})}
        >
          {failed
            ? "Couldn't check this article, so there is nothing safe to offer here. Reload the page."
            : "Checking…"}
        </p>
      </div>
    );
  }

  return (
    <div className={`${CARD} tw:p-4`}>
      {asking ? (
        /* The question, standing exactly where the trigger stood — so the
           second press of a double-click lands on a heading. Naming the title
           is the cheap 90% of type-the-title-to-confirm: it costs the reader
           nothing and it makes them read WHICH article. */
        <h3 className="tw:m-0 tw:text-sm tw:font-semibold tw:text-foreground">
          Delete “{title}” for ever?
        </h3>
      ) : (
        /* Quiet at rest, like Archive and Export: the same shape, because it is
           the same kind of row, and the heading above already carries the
           weight. The red is spent below, on the press that acts. */
        <button
          type="button"
          onClick={() => {
            setAsking(true);
            setError(null);
          }}
          className="tw:inline-flex tw:items-center tw:gap-2 tw:rounded-md tw:border tw:border-border tw:bg-transparent tw:px-3 tw:py-1.5 tw:text-sm tw:text-muted-foreground tw:hover:bg-accent/40 tw:hover:text-foreground tw:focus-visible:outline-none tw:focus-visible:bg-accent/40 tw:focus-visible:text-foreground"
        >
          <Trash2 size={14} />
          {/* **Never bare "Delete"**, which on this page and on the shelf meant
              archive for nine days and cost a bug report
              (SPIDERYARN-READING2-19, `ArchiveArticle` above). */}
          Delete permanently
        </button>
      )}

      <WhatDeleteDoes shared={shared} full={asking} />

      {asking ? (
        <div className="tw:mt-4 tw:flex tw:items-center tw:gap-2">
          {/* **The one solid-destructive control on this page**, and the reason
              the tint means anything: red is this app's word for *this cannot
              be undone*, and this is the only thing here that cannot. */}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => void destroy()}
          >
            <Trash2 size={14} />
            {busy ? "Deleting…" : "Delete for ever"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setAsking(false);
              setError(null);
            }}
          >
            Keep it
          </Button>
        </div>
      ) : null}

      {/* `alert`: it arrives without the reader looking for it, it contradicts
          what they just pressed, and one of its three sentences is an admission
          that we do not know what happened. */}
      {error ? (
        <p
          role="alert"
          className="tw:mt-3 tw:mb-0 tw:inline-flex tw:items-start tw:gap-1 tw:text-sm tw:text-destructive"
        >
          <TriangleAlert size={12} /> {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * One section: a small accent bar, an uppercase label, and whatever goes under
 * it.
 *
 * A component rather than markup repeated per section, which is exactly what
 * the 1,274-line panel this was borrowed from did seven times inline — the bar
 * and the label are three elements over there, copied into every section, and
 * one of the seven has a different gradient for no reason anybody recorded.
 */
/**
 * How much of the PDF we may have failed to transcribe — in four states.
 *
 * Split out of `CameFrom` because it *is* four states: a scan, an unscored
 * record, a perfect score and a number, each with its own sentence and its own
 * tooltip. Inline it was three nested ternaries inside a fourth conditional and
 * put that function over this repo's cognitive-complexity limit, which was the
 * lint telling the truth — the row is the hardest thing on this page to state
 * correctly, and it deserves to be readable on its own.
 */
function Missed({ meta }: { meta: Meta }) {
  return (
    <>
    {meta.unverified ? (
      /* Not a number, because there is no number: a scan has no
         text layer, so nothing compared anything. The sentence is
         the honest form and a "0%" would be a lie in the other
         direction. docs/plans/260826c-pdf-ingestion.md § A scan with no
         text layer. */
      <Tooltip
        placement="top"
        content={
          <TipNote>
            There was not enough of the PDF's own text to check the transcription
            against — a scan is pictures of pages, and what little text a scan does carry
            is usually the digitising library's rather than the author's. Nobody and
            nothing has verified this one. Open the original if a line reads oddly.
          </TipNote>
        }
      >
        <button
          type="button"
          className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
        >
          Couldn't be checked — this is a scan
        </button>
      </Tooltip>
    ) : meta.recall === undefined ? (
      /* **"Not recorded", and not a guess at why.** This said "read
         before we started recording this", which is one cause among
         several and cannot be told from the others here: a SINGLE-page
         scan reaches this branch too, because `isScan` requires
         `pages.length > 1` (src/pdf.ts § withText), so such a document
         is recorded as neither verified nor scored. Naming a cause we
         cannot establish is the failure this whole page exists to
         avoid. GPT Sol, 2026-09-03. */
      <span>No comparison score was recorded</span>
    ) : (
      <Tooltip
        placement="top"
        content={
          <TipNote>
            {/* **What was compared, not why the rest was not.** This
                said "the other N had no hidden text, so nothing could
                check them", and that is not what `pagesChecked` counts:
                `scored` also drops end-of-document reference lists,
                which do have a text layer and are excluded because the
                model transcribes them only partly (src/pdf-score.ts §
                checkable). GPT Sol, 2026-09-03. */}
            {meta.pages && meta.pagesChecked
              ? `We compared our transcription against the PDF's own hidden text on ${meta.pagesChecked} of its ${meta.pages} pages, and ${found(meta.recall)}% of that text turned up in what the model wrote.${
                  /* **Only when some were.** Seen in a browser on a
                     real article where all 8 of 8 pages were checked:
                     "The other 0 were left out of the comparison",
                     which is a sentence about nothing and reads as a
                     bug on the page whose job is being trusted. */
                  meta.pages > meta.pagesChecked
                    ? ` The other ${meta.pages - meta.pagesChecked} were left out of the comparison — usually for carrying no text to compare against.`
                    : ""
                }`
              : `We compared our transcription against the PDF's own hidden text, and ${found(meta.recall)}% of it turned up in what the model wrote.`}{" "}
            Compare a page against the original if a passage reads oddly.
          </TipNote>
        }
      >
        <button
          type="button"
          className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
        >
          {/* The page count only when there is one. `?? 0` on a
              meta.json written before `pages` existed produces "judging
              by 3 of 0 pages", and a nonsense denominator undermines the
              number standing next to it. */}
          {/* **`recall === 1`, not a rounded 100.** Those are not the
              same claim, and the difference is live on a real article:
              a stored recall of 0.998 rounds to 100 and would have
              printed "None found" over a document that did miss words.
              GPT Sol, 2026-09-03. */}
          {meta.recall === 1
            ? "None found"
            : found(meta.recall) === 100
              ? "Less than 1%"
              : `About ${100 - found(meta.recall)}%`}
          {meta.pages ? `, judging by ${meta.pagesChecked ?? 0} of ${meta.pages} pages` : ""}
        </button>
      </Tooltip>
    )}
    </>
  );
}

/**
 * The percentage of the checked text we found, rounded once.
 *
 * **Rounded once, and subtracted from afterwards.** The row says how much was
 * missed and its tooltip says how much was found, and computing those
 * separately — `round(100 - r*100)` in one and `round(r*100)` in the other —
 * lets them disagree: at a recall of 0.835 the row said 17% missed while the
 * tooltip said 84% found, which is 101% of the document. One rounding, two
 * readings of it.
 */
function found(recall: number): number {
  return Math.round(recall * 100);
}

/**
 * **The element a `?section=` value names** — the value is the id `sectionId`
 * (PageSection.tsx) makes, without its prefix, so the address reads `section=ai-processing`
 * rather than `section=sec-ai-processing`. tests/metadata-section-param.test.tsx
 * checks every accepted value against this page's real sections.
 */
function sectionIdFor(section: MetadataSection): string {
  return `sec-${section}`;
}

/**
 * One number, big, with a label small above it and an explanation on hover.
 *
 * The dotted underline on the label is the affordance, and it is the one the
 * previous version used for exactly this: it says there is more here without
 * spending a line of the card on saying so.
 */
function Stat({
  icon: Icon,
  label,
  value,
  ...said
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
  /* A sentence, or a whole card of short paragraphs set in `ControlTip`'s
     classes — one or the other, so a tile cannot say two things. */
} & ({ tip: string; card?: undefined } | { card: ReactNode; tip?: undefined })) {
  return (
    <Tooltip
      placement="top"
      {...(said.card !== undefined
        ? { className: "tip-soon", content: said.card }
        : { content: <TipNote>{said.tip}</TipNote> })}
    >
      {/* Focusable since 2026-10-05: the card is the only place the
          explanation is, and a keyboard had no way to it (GPT Sol, plan 261005c). */}
      <div
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the explanation; pressing does nothing
        tabIndex={0}
        className={`${CARD} tw:p-4 tw:cursor-help tw:transition-colors tw:hover:border-highlight/40 tw:focus-visible:border-highlight-text`}
      >
        <div className="tw:mb-2 tw:flex tw:items-center tw:gap-2">
          <Chip icon={Icon} />
          <span className="tw:border-b tw:border-dotted tw:border-rule-strong tw:text-[0.68rem] tw:uppercase tw:tracking-[0.06em] tw:text-ink-faint">
            {label}
          </span>
        </div>
        <div className="tw:text-xl tw:text-foreground">{value}</div>
      </div>
    </Tooltip>
  );
}


/**
 * The small square an icon sits in.
 *
 * Theirs was a gradient fill with a white glyph, which is a light-mode idiom:
 * on a dark ground a saturated chip in every row is louder than the numbers it
 * is labelling. A flat raised surface does the same job — separating the glyph
 * from the text — and stays chrome.
 */
function Chip({ icon: Icon }: { icon: ComponentType<{ size?: number }> }) {
  return (
    <span
      aria-hidden="true"
      className="tw:inline-flex tw:h-6 tw:w-6 tw:shrink-0 tw:items-center tw:justify-center tw:rounded-md tw:bg-secondary tw:text-ink-faint"
    >
      <Icon size={13} />
    </span>
  );
}

/** A labelled row inside a card: chip, label, and the answer on the right. */
function Row({
  icon,
  label,
  children,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:px-4 tw:py-3 tw:text-sm">
      <Chip icon={icon} />
      <span className="tw:text-[0.68rem] tw:uppercase tw:tracking-[0.06em] tw:text-ink-faint">
        {label}
      </span>
      <span className="tw:ml-auto tw:min-w-0 tw:text-right tw:text-ink-faint">{children}</span>
    </div>
  );
}

/**
 * One stage: whether it ran, what it writes, and which model wrote it.
 *
 * A row rather than a table cell. The first version was a four-column table,
 * which needed `overflow-x: auto` to survive a narrow window — and a horizontal
 * scrollbar hides the model name, which is half of what the row is for.
 *
 * The file paths are the real ones — `output/<slug>.html`, not a tidier
 * `article.html`. This is the page you open to go and look at a file, and a
 * name you cannot find on disk is worse than no name.
 */
function StageRow({
  stage,
  generator,
  now,
}: {
  stage: StageState;
  generator: string | undefined;
  now: number;
}) {
  const { step, label, outputs, done } = stage;
  // `stage.ranAt` / `stage.bytes` are read off the object below rather than
  // destructured here, so a reader of `<Wrote>` can see which they are.
  const Icon = stageIcon(step);
  return (
    <div className={`tw:px-4 tw:py-3 ${done ? "" : "tw:opacity-60"}`}>
      <div className="tw:flex tw:items-center tw:gap-3">
        <Chip icon={Icon} />
        {/* **The English name first, the key beside it.** Until 2026-09-03 the
            row led with `step` — `arc`, `tweets`, `blocks` — and showed the
            human label *only when the stage had not run*, so the rows you could
            read were the ones with nothing in them. The key still earns its
            place: it is what `npm run <step> <slug>` takes, and this is the
            page you have open when you are about to type that. */}
        <span className="tw:text-sm tw:text-foreground">{label}</span>
        <span className="tw:font-mono tw:text-xs tw:text-ink-faint">{step}</span>
        {/* `done &&` is load-bearing. The generator string comes off the tree
            and the arc, which are in hand because the article loaded — so a structure
            stage whose blocks copy is missing would otherwise print a model
            name next to the words "not run". */}
        {done && generator && (
          <span className="tw:truncate tw:font-mono tw:text-xs tw:text-ink-faint">{generator}</span>
        )}
        {/* The pill their Processing Status section used, in our palette. There
            is no green token here and there should not be one for this: orange
            is what this app says "yes, and it is this one" with everywhere
            else. */}
        <span
          className={`tw:ml-auto tw:shrink-0 tw:rounded-full tw:border tw:px-2 tw:py-0.5 tw:text-[0.68rem] tw:uppercase tw:tracking-[0.06em] ${
            done
              ? "tw:border-highlight/30 tw:bg-highlight-wash tw:text-highlight-ink"
              : "tw:border-border tw:text-muted-foreground"
          }`}
        >
          {done ? "ran" : "not run"}
        </span>
      </div>
      {/* Indented to the chip's width so the files hang under the stage name
          rather than under its icon. */}
      <div className="tw:mt-1.5 tw:flex tw:flex-wrap tw:items-baseline tw:gap-x-3 tw:gap-y-1 tw:pl-9 tw:text-xs tw:text-ink-faint">
        {/* Only for a stage that ran. A not-run stage's line is now blank — its
            label moved up to be the row's name, and listing the files it would
            have written reads as a list of things that are missing rather than
            as a thing that has not happened yet. */}
        {done && (
          <span className="tw:min-w-0 tw:font-mono tw:break-all">{outputs.join(" · ")}</span>
        )}
        <Wrote at={stage.ranAt} began={stage.startedAt} bytes={stage.bytes} done={done} now={now} />
      </div>
    </div>
  );
}

/**
 * When this stage last wrote, how long it took, and what it left behind —
 * relative on the row, exact on hover.
 *
 * Greg, 2026-08-27, asked for *"extra metadata (e.g. exact date times), perhaps
 * in tooltips"*, and this is where most of it landed. It is deliberately the
 * same shape as `Fetched` at the top of the page: the relative time is what you
 * want to know, and the exact stamp is what you want the moment the relative
 * one surprises you.
 *
 * **The duration joined on 2026-09-08**, on a second ask — *"a tooltip for
 * exactly when it happened … And also, how long it took"* — of which only the
 * second half was missing, and missing from the wire rather than the database
 * (docs/plans/260908a-exact-time-and-duration-on-the-metadata-step-rows.md). It
 * is in the card rather than on the row because the row already carries a path,
 * a state pill and a relative time, sixteen times over.
 *
 * **The tooltip says what the number is not.** A file's timestamp records when
 * it was written, never what it was written *from* — a copy, a `touch` or a
 * fresh `git clone` resets it, which is exactly why the fixture's every stage
 * reports the minute somebody cloned this repo. Saying so in the tooltip is the
 * difference between a fact and a verdict, and this page owes the reader the
 * first and refuses to give them the second
 * (see the docstring at the top of this file, and src/store/pg.ts § articleMetadata).
 *
 * Renders nothing when the store cannot say — Postgres has no files, so it has
 * no size, and a stage that has written nothing has neither.
 */
function Wrote({
  at,
  began,
  bytes,
  done,
  now,
}: {
  at: string | null;
  began: string | null;
  bytes: number | null;
  done: boolean;
  now: number;
}) {
  if (!at) return null;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return null;
  const when = new Date(t);
  const took = tookFor(began, t);
  return (
    <Tooltip
      placement="top"
      content={
        <TipNote>
          {exactly(when)}
          {took !== null && ` · took ${took}`}
          {bytes !== null && ` · ${weight(bytes)} on disk`}
          <br />
          {/* The caveat is about **files**, so it is only told where there are
              files. In Postgres this is `finished_at` — a recorded fact about a
              run, which no checkout can reset — and repeating the mtime warning
              there would be teaching the reader to distrust a number that
              deserves it less. `bytes` is the honest test for which store
              answered, because only one of them has anything to weigh. */}
          {bytes === null
            ? "When this stage last finished."
            : "When the newest of this stage's files was written. A copy or a fresh checkout resets that, so it says when — never what from."}
        </TipNote>
      }
    >
      {/* A button, not a span, because everything in this tooltip is only in
          this tooltip and a span cannot be reached by keyboard — `Tooltip` wires
          up `useFocus`, so a focusable trigger is all it takes. Found by a
          cross-model review, 2026-08-27. The `Stat` cards and `Fetched` above
          have the same problem and the same fix; they are older than the rule
          being noticed, and are not changed here so that this stays one change. */}
      <button
        type="button"
        className="tw:ml-auto tw:shrink-0 tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight-text"
      >
        {/* "last wrote" rather than "ran" for a stage that is not done: something
            of its is on disk and the set is incomplete, which is precisely the
            state this page gets opened to look at. */}
        {done ? "ran" : "last wrote"} {whenSaid(at, now)}
      </button>
    </Tooltip>
  );
}

/**
 * The exact stamp: date, seconds, and the zone it is in.
 *
 * `timeStyle: "long"` rather than `"short"` — an exact time without seconds is
 * not exact, and without a timezone it is ambiguous the moment anybody reads it
 * on a different machine from the one that wrote the file.
 */
function exactly(when: Date): string {
  return when.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" });
}

/**
 * How long that run took, or `null` if we cannot honestly say.
 *
 * Three ways it declines, and each is a different kind of not-knowing that a
 * `0` would have flattened into the same lie:
 *
 *  - **no start recorded** — every row written by `recordStepRun` without one,
 *    and every row older than the `started_at` column. `StageState.startedAt`
 *    is `null` and there is nothing to subtract.
 *  - **an unparseable start** — `Date.parse` gives `NaN`, and `NaN` compares
 *    false in both directions, so it has to be tested for rather than compared
 *    (the trap `timeAgo` in relative-time.ts is arranged around).
 *  - **the finish is before the start** — two clocks disagreeing, not a fact
 *    about the article. `timeAgo` clamps a future stamp to "just now" for the
 *    same reason; here there is nothing to clamp *to*, because "took 0s" is a
 *    claim and not an absence, so this draws nothing at all.
 *
 * **All three decline before `howLong` sees the number**, which is what keeps
 * that function's `an unknown time` — right on the Tweets page it was written
 * for — off this card, where it would sit beside a timestamp we are certain of
 * and read as doubt about the whole line. The formatting is
 * `howLong` in relative-time.ts; deciding whether there is anything to format
 * is this function, and that is the whole split between them.
 *
 * Exported for its own test. Takes the finish as a parsed number because the
 * caller has already parsed it and had to, to decide whether to render at all.
 */
export function tookFor(began: string | null, finished: number): string | null {
  if (!began) return null;
  const start = Date.parse(began);
  if (Number.isNaN(start)) return null;
  const ms = finished - start;
  if (ms < 0) return null;
  return howLong(ms);
}

/**
 * Bytes, in the unit a person would use.
 *
 * `Intl.NumberFormat`'s `unit: "byte"` with `notation: "compact"` exists and is
 * decimal — it calls 1,048,576 bytes "1.0MB". Everything else in this app that
 * reports a file size is `ls`, which is not, so this is the 1024 one and says
 * KB/MB rather than KiB/MiB, matching what the reader's file manager tells them.
 */
function weight(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * When we fetched it — "3 days ago", with the full stamp on hover.
 *
 * Renders nothing at all if stage 2 never recorded one, rather than a stranded
 * separator; `lead` is whether anything precedes it on the line.
 */
/** Whether `Fetched` draws anything — the caller's separator before it depends on the same answer. */
function fetchedIsShown(iso: string | undefined): iso is string {
  return Boolean(iso) && !Number.isNaN(Date.parse(iso ?? ""));
}

function Fetched({ iso, now }: { iso: string | undefined; now: number }) {
  if (!fetchedIsShown(iso)) return null;
  const t = Date.parse(iso);
  const when = new Date(t);
  return (
    <Tooltip
      placement="bottom"
      /* The exact stamp, and what it is a stamp *of*. "fetched 3 days ago" on
         its own gets read as "written 3 days ago" — this is the date we took
         our copy, and the page may have changed underneath it since. */
      content={
        <TipNote>
          {exactly(when)} — when we took our copy. The article may have changed on its own site
          since.
        </TipNote>
      }
    >
      <span className="tw:cursor-help">
        <span className="tw:border-b tw:border-dotted tw:border-rule-strong">
          fetched {whenSaid(iso, now)}
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * **A time, as the words after a verb**: "ran 3 days ago", "fetched just now",
 * and past a month "last wrote on 5 Aug 2026".
 *
 * The shared formatter (relative-time.ts) on the page's `useNow` clock, since
 * 2026-10-04. Until then this file had a private `ago()` that read
 * `Date.now()` during render, so it never moved while the page was open, said
 * "ran in 4 seconds" when the server's clock was a little ahead of the
 * browser's, and counted in "last month" and "2 months ago" where everything
 * else in the app gives the date.
 *
 * **"on", because `timeAgo`'s absolute half is a bare date** and all three
 * callers put a verb in front: "ran Aug 5, 2026" is not a sentence. The
 * threshold stays `relativeAgo`'s — it answers `undefined` exactly where the
 * date takes over. GPT Sol's plan review, S4, in
 * docs/plans/261004d-sweep-clusters-13-and-18-lint-gates-census-test-and-client-tidy.md.
 *
 * Every caller has already refused an unparseable stamp and draws nothing for
 * it; the last arm is what the old copy said for one, kept so that this cannot
 * print "on undefined" if a caller ever stops checking.
 * tests/metadata-relative-times.test.tsx.
 */
function whenSaid(iso: string, now: number): string {
  const recent = relativeAgo(iso, now);
  if (recent !== undefined) return recent;
  const date = timeAgo(iso, now);
  return date === undefined ? "at an unknown time" : `on ${date}`;
}

/** Enough of a paragraph to recognise it, cut on a word boundary. */
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
