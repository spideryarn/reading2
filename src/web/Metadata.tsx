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
 * a flat `WPM` this repo chose (reading-time.ts), and a rerun confirmation
 * quotes a fixed wait. Neither comes from an artefact. GPT Sol, 2026-09-08.
 *
 * That is narrower than *nothing here is generated*, which is what this line
 * said until 2026-09-08 and which had stopped being true twice over: the page
 * shows the hierarchy's `gist` and `summary` (§ In one sentence), and since
 * 2026-09-07 it can start a run of its own (§ Generate it again, below, one
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
 *    ours is words ÷ 230, and the reader has no way to know that. Dotted
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
 *    as unanswered as it was, and a person reading "hierarchy ran 3 days ago, arc ran
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
 * wrong: a *successful* hierarchy run writes the tree and then copies the blocks
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
 * **run** — `revision_step_runs.input_hash`, read by `hierarchyCurrency`, the
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
 * behind. *Generate it again* offers a re-run and claims nothing about whether
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
  Blocks,
  Bot,
  BookA,
  Lightbulb,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  FileQuestion,
  FileType,
  Fingerprint,
  Image,
  Layers,
  Link2,
  List,
  ListOrdered,
  ListTree,
  MessageCircle,
  MessageCircleQuestionMark,
  MessagesSquare,
  Paintbrush,
  PenLine,
  RefreshCw,
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
  LibraryEntry,
  Meta,
  StageState,
  StepName,
  Visibility,
} from "../types.js";
import { MAX_PURPOSE_CHARS } from "../types.js";
/* The nine steps this page will re-run, from a leaf rather than from
   `src/pipeline.ts` — which is a server module the client may not import
   (tests/client-imports.test.ts). See src/rerun-steps.ts. */
import { METADATA_RERUN_STEPS, type MetadataRerunStep } from "../rerun-steps.js";
import { WPM } from "../reading-time.js";
import { isWebUrl } from "../urls.js";
import { forgetSummaries } from "./link-facts.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { atParam } from "./params.js";
import { LIBRARY_HREF, PROFILE_HREF, carriedSearch, navigate, readHref } from "./router.js";
import { cameOffADisk, SourceLink, webSource } from "./SourceLink.js";
import { articleStats } from "./stats.js";
import { EditableTitle, useArticleRename } from "./TitleEditor.js";
import { TipNote, Tooltip, TooltipGroup } from "./Tooltip.js";
import { howLong, timeAgo } from "./relative-time.js";
import { useNow } from "./useNow.js";
import { SLOW_AFTER_MS } from "./useSlow.js";
import { useExperimental } from "./useExperimental.js";
import { apiFetch, failure, readJson, statusOf } from "./lib/api.js";
import { cachedReaderNow, forgetCachedReader } from "./lib/cached-shelf.js";
import { AccessSharing, asArticleSharing } from "./AccessSharing.js";
import { CARD } from "./card.js";
import { ProfileBox } from "./ProfileBox.js";
import { PageContents } from "./PageContents.js";
import { Button } from "@/components/ui/button";
import { JobProgress } from "./JobProgress.js";
import { SKETCH_PRICE, SKETCH_WAIT } from "./sketch-cost.js";
import { useOrderedRead, type ArtefactRead } from "./useOrderedRead.js";
import { useStepJob } from "./useStepJob.js";

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
  extract: FileText,
  blocks: Blocks,
  hierarchy: ListTree,
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
  /* The same clock the Dock puts on the Timeline button, so the stage row and
     the mode button a reader has already met say the same thing. */
  timeline: Clock,
  /* A question mark in a bubble: the questions the piece asks back, and the one
     stage here whose artefact is a prompt to the reader rather than a reading
     of the article. Not `FileQuestion`, which this page already uses for the
     "no raw document" state a few rows down. */
  quiz: MessageCircleQuestionMark,
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
};

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
  onRenamed: (slug: string, title: string) => void;
  /**
   * The reader threw the sharing switch below — handed up for the same reason
   * `onRenamed` is, and it is the same hazard: the article payload is fetched
   * once for all three views and never refetched between them, so a fact
   * changed here goes stale in the reading view's masthead one click away.
   * `AccessSharing` § `onVisibility` has the long version, including why `null`
   * is one of the values.
   */
  onVisibility: (slug: string, visibility: Visibility | null) => void;
}) {
  const { meta, tree, arc } = article;
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  /* The same rename the shelf offers, on the page that describes the article —
     Greg, 2026-08-27. One hook, one editor, one request shape, shared with the
     masthead and with the shelf: TitleEditor.tsx. */
  const rename = useArticleRename(slug, onRenamed);

  /* **The bar is told which modes this reader sees; it does not go and get it.**
     One shared store behind the hook, so this page and the reading view cannot
     disagree for the length of a toggle. Dock.tsx § experimental. */
  const experimental = useExperimental();

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
   * **On `useOrderedRead`, because nine rows below can now ask for this again.**
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
  const { reload, refresh } = useOrderedRead(readProvenance);
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
   * `null` means "not seeded yet", so an empty box the reader has cleared is
   * tellable from one that has not loaded. Same distinction `SummaryPanel`
   * holds for its steer.
   */
  const [purposeDraft, setPurposeDraft] = useState<string | null>(null);
  const [purposeSaved, setPurposeSaved] = useState<string | null>(null);
  const [purposeError, setPurposeError] = useState<string | null>(null);
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
    const value = provenance.purpose ?? "";
    setPurposeDraft(value);
    setPurposeSaved(value);
  }, [provenance, slug]);

  /* Blur, or Cmd/Ctrl+Enter — the same moment `TitleEditor` on the shelf
     commits at, and no debounce, because there is no debounce anywhere in this
     client and this is not the place to introduce one. */
  function savePurpose(): void {
    if (purposeDraft === null || purposeSaved === null) return;
    if (purposeDraft === purposeSaved) return;
    const sending = purposeDraft;
    setPurposeError(null);
    apiFetch(`/api/library/${encodeURIComponent(slug)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose: sending === "" ? null : sending }),
    })
      .then((r) => readJson<{ purpose: string | null }>(r))
      .then((body) => {
        /* The server's answer, not what was typed: it trims and settles line
           endings, and the box must show the string that was actually stored —
           otherwise every prompt carries something the reader cannot see.

           Read from `purpose` rather than from `entry`: the shelf card
           deliberately does not carry it, because only this page renders it and
           putting it on the card would send it with every card on the homepage.
           src/routes.ts § patchShelf. */
        const stored = body.purpose ?? "";
        setPurposeSaved(stored);
        setPurposeDraft(stored);
        /* **The link cards' summaries were written from this sentence.** They
           are cached per tab in front of a server that would have noticed
           (src/web/link-facts.ts § `forgetSummaries`), so without this the
           reader edits their purpose, goes back to the article, hovers a link
           they hovered before, and reads the answer written for the sentence
           they just replaced. */
        forgetSummaries();
      })
      .catch((e: Error) => setPurposeError(e.message));
  }

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
  const facts = [meta.byline, meta.siteName, meta.lang].filter(Boolean) as string[];

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

  const pipelineLine = useMemo(() => {
    if (!provenance) return null;
    const ran = provenance.stages.filter((s) => s.done).length;
    const stamps = provenance.stages
      .map((s) => (s.ranAt ? Date.parse(s.ranAt) : Number.NaN))
      .filter((t) => !Number.isNaN(t));
    const newest = stamps.length ? Math.max(...stamps) : null;
    return `${ran} of ${provenance.stages.length} stages${newest === null ? "" : ` · last wrote ${ago(new Date(newest))}`}`;
  }, [provenance]);

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
          more here than usual. Hidden below `xl`, where there is no margin to
          put it in. */}
      <PageContents containerRef={body} label="Sections of this page" />

      {/* `metadata-page` carries exactly one rule, and it is a typography fix
          rather than a layout one: every `<button>` on this page inherits its
          font (styles.css § metadata). We import no preflight, on purpose, so a
          button otherwise keeps the UA's 13.3px Arial — which is why the
          collapsible section headings drew half again the size of the ones
          beside them. Greg, 2026-09-03: *"some of them seem larger than others
          somehow?"* */}
      <main
        ref={body}
        className={`metadata-page tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-[calc(2.5rem_+_var(--safe-top))] tw:font-sans ${DOCK_CLEARANCE}`}
      >
        <Link
          href={backHref}
          className="tw:mb-6 tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ink-faint tw:no-underline tw:hover:text-highlight"
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
          inputClassName="tw:font-prose tw:text-2xl tw:leading-snug"
        >
          <h1 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
            {meta.title}
          </h1>
        </EditableTitle>
        {/* Only the facts this article actually has, filtered once and counted
            from the filtered list — same reasoning as the library card. A chain
            of `&&`s, or a separate test of the same fields, is how a line ends
            up starting with a stranded `·`. */}
        <p className="tw:mt-2 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-sm tw:text-muted-foreground">
          {facts.map((fact, i) => (
            <span key={fact}>
              {i > 0 && <span className="tw:mr-2 tw:opacity-50">·</span>}
              {fact}
            </span>
          ))}
          {/* Relative, with the exact stamp on hover — theirs did this and it is
              the right way round. "3 days ago" is what you want to know; the
              timestamp is what you want when the answer is surprising. */}
          <Fetched iso={meta.fetchedAt} lead={facts.length > 0} />
        </p>
        {/* Where it came from, and the way back to it — `Origin` below. `owner`
            is `hasShelfRow` rather than a fresh test, because the link it gates
            is the same private `GET /api/source/:slug` the masthead gates, and
            this page already has one answer to *is this yours*. */}
        <Origin meta={meta} slug={slug} owner={hasShelfRow} />
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
              className="tw:rounded tw:border tw:border-highlight/40 tw:px-1.5 tw:py-0.5 tw:font-mono tw:text-xs tw:text-highlight"
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
          <Section label="In one sentence">
            <div className={`${CARD} tw:p-5`}>
              {root?.gist && (
                <p className="tw:m-0 tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:text-foreground">
                  {root.gist}
                </p>
              )}
              {root?.summary && (
                <p className="tw:mt-3 tw:mb-0 tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint">
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

        {/* ------------------------------------------------- 3. at a glance --
            Six numbers, each big enough to read without reading a sentence.
            One TooltipGroup so that once the pointer has opened one card's
            explanation, sweeping across the rest is instant rather than six
            separate waits — the same reasoning as the spine's bands. */}
        <Section label="At a glance">
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
                   Metadata"* — and it already was, right here. What only the
                   placeholder knew is now in this sentence: the original
                   version dropped the standard readability formulas for a
                   model's judgement, then scaled the estimate by how confident
                   the model said it was. See Dock.tsx, and
                   original-version/difficulty-and-reading-time.md. */
                tip={`Words ÷ ${WPM} a minute, rounded, and never less than one. A flat rate: it does not know how hard this particular article is.`}
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
            above), then the decisions about where it goes (this and Export),
            then the reader's own work on it, then the machinery. The previous
            arrangement had the one irreversible control on the page — a public
            link cannot be un-rung (messages.ts § SHARING_CANNOT_UNRING) —
            below two screenfuls of notes and file paths.

            Still above Archive, and Archive is still last: nothing that takes
            the article off the shelf sits above something somebody came here to
            read.

            **Not offered on the fixture.** That address has no row of its own
            (`showingFixture` above), so the `PUT` behind the switch would 404,
            and a control that can only fail is worse than no control because
            pressing it is how you find out. */}
        <SharingSection
          onVisibility={onVisibility}
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
        <Section label="Your reading">
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
              value={purposeDraft ?? ""}
              onChange={setPurposeDraft}
              onCommit={savePurpose}
              max={MAX_PURPOSE_CHARS}
              disabled={purposeDraft === null}
              rows={2}
            />
            <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:text-ink-faint" aria-live="polite">
              {purposeError ? (
                <span className="tw:inline-flex tw:items-center tw:gap-1 tw:text-highlight">
                  <TriangleAlert size={12} /> Not saved — {purposeError}
                </span>
              ) : provenance === null ? (
                slow ? "Loading…" : ""
              ) : (
                "Saved when you click away, or with ⌘↵."
              )}
            </p>

            {/* The global half, shown rather than edited. A reader looking at
                "why is this glossary written like this" needs both answers, and
                sending them to another page for one of them is the way to make
                sure they never see it. */}
            <div className="tw:mt-4 tw:border-t tw:border-border tw:pt-3">
              <div className="tw:flex tw:items-baseline tw:justify-between tw:gap-3">
                <span className="tw:text-[0.7rem] tw:uppercase tw:tracking-[0.03em] tw:text-ink-faint">
                  About you
                </span>
                <Link href={PROFILE_HREF} className="tw:text-xs tw:text-highlight">
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
                href={readHref(slug, withPanel(carriedSearch(location.search)), "article")}
              />
            </Row>
            <Row icon={Target} label="Where you left off">
              {lastRead ? (
                <Link href={backHref} className="tw:text-highlight">
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

        {/* ------------------------------------------- 7. generate it again --
            After "Your reading" and before Export, because the page's order is
            what the article is, then where it goes, then the reader's own work
            on it, then the machinery — and asking for something to be generated
            again is the reader's own work. Greg, 2026-09-06:
            *"there should be a way to re-run any of the generated modes"*. */}
        <RerunSection slug={slug} provenance={provenance} onFinished={refresh} />

        {/* -------------------------------------------------- 8. export it --
            Below sharing because both are decisions about where this article's
            data goes, and above the machinery because this one is a thing the
            owner does rather than a thing we did. Still above Archive, which
            stays last. */}
        <ExportSection slug={slug} offer={hasShelfRow} />

        {/* ------------------------------------------- 9. technical details --
            Everything that is true, is ours rather than the reader's, and has
            no bearing on reading the article: the two identifiers, the PDF's
            fingerprint, which stages have run, and the one thing this page
            cannot do yet. Shut, so the page ends at Export for anybody not
            looking for it. Greg, 2026-09-03. */}
        <TechnicalDetails
          slug={slug}
          provenance={provenance}
          rawSha256={meta.rawSha256}
          error={provenanceError}
          slow={slow}
          aside={pipelineLine}
          hierarchyGenerator={`${tree.generator} · ${tree.version}`}
          arcGenerator={arc ? `${arc.generator} · ${arc.version}` : undefined}
        />

        {/* ---------------------------------------------- 10. archiving it --
            Last on the page, and last on purpose: the control that takes the
            article off the shelf belongs past everything somebody might have
            come here to read, not beside it. Under the technical section rather
            than over it for the same reason — that is the least urgent thing
            here, and it is still not something to scroll this button past. */}
        <Section label="Archive this article">
          <ArchiveArticle
            slug={slug}
            archivedAt={provenance?.archivedAt}
            failed={Boolean(provenanceError)}
            fixture={showingFixture}
          />
        </Section>

        {/* ------------------------------------------ 11. destroying it --
            Under Archive, and last of everything, because it is the only act
            on this page that cannot be taken back. Greg, 2026-09-06:
            *"probably only visible for now from within Metadata for that
            article, underneath Archive, with appropriate UI styling"*. The
            shelf card deliberately has no such button — its controls are
            hover-revealed and adjacent, and on a phone they are all tap
            targets. docs/plans/260906h-delete-an-article-permanently.md. */}
        <Section label="Delete this article">
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
      <Dock slug={slug} view="metadata" experimental={experimental} />
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
}: {
  slug: string;
  title: string;
  /** Straight through to the card — see `Metadata`'s prop of the same name. */
  onVisibility: (slug: string, visibility: Visibility | null) => void;
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
  return (
    <Section label="Access & sharing">
      {/* **In a card, like every other section on this page**, since
          2026-09-04. It was the one section whose contents sat straight on the
          page background — Greg: *"the section should be inside a box like the
          other sections"* — which read as a stray paragraph rather than as the
          page's one irreversible control, and left the confirmation panel
          below it as the only boxed thing here, so the *warning* looked more
          like a card than the switch did.

          `${CARD} p-4`, matching `ExportSection` rather than "In one
          sentence"'s `p-5`: both of these are a control with a sentence beside
          it, and the two sit next to each other. */}
      <div className={`${CARD} tw:p-4`}>
        <AccessSharing
          slug={slug}
          title={title}
          sharing={sharing}
          onVisibility={onVisibility}
        />
      </div>
    </Section>
  );
}

/**
 * **The nine things this page will ask for again.**
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
 * The stage rows in *Technical details* answer a different question, and only
 * one of the two is a menu: that list is a **record** — all sixteen stages, when
 * each last wrote, no controls — and this is a **menu** of the nine you can ask
 * for. Interleaving them would put an eligibility branch inside `StageRow` and
 * rows with a button beside rows that cannot have one.
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
 * **Which nine, and why not the other seven**, is `METADATA_RERUN_STEPS`
 * (src/rerun-steps.ts) — read it there rather than restating it here.
 *
 * ## No gate, unlike Export and Archive two sections down
 *
 * Those two are withheld until we know there is a shelf row, because their only
 * possible outcome without one is a 404 and pressing them is how you would find
 * out. This is not that shape: a run is `POST /api/jobs`, whose refusal comes
 * back as a sentence written for a reader, and `JobProgress` is built to show
 * exactly that beside the row it belongs to. So the rows are drawn while the
 * metadata request is still out — which also keeps the nine `useStepJob`
 * subscriptions mounted for the whole visit rather than appearing under a
 * reader who has already scrolled past.
 *
 * The cost, said out loud: nine subscriptions to one shared engine
 * (`useJobs` is a `useSyncExternalStore` over `jobEngine`), so this is nine
 * store subscriptions and **not** nine polls.
 */
function RerunSection({
  slug,
  provenance,
  onFinished,
}: {
  slug: string;
  /** Null until the metadata request lands; the rows draw either way. */
  provenance: ArticleMetadata | null;
  /**
   * **`refresh`, never `reload`** — see the read in `Metadata` above and
   * `useOrderedRead`'s header. The same function for all nine, so a completion
   * in any row is one question asked of one reader.
   */
  onFinished: () => void;
}) {
  return (
    <Section label="Generate it again">
      {/* Two facts and no third. **It does not say anything is out of date** —
          nothing here can honestly tell you that, and the whole reason this
          shipped while the placeholder it replaces did not is that a button
          saying *regenerate this* needs no such claim. And no timing: the nine
          are not one speed, so a *"takes a minute or two"* here would be wrong
          about the Sketch, which says its own wait in its own confirm. */}
      <p className="tw:mt-0 tw:mb-3 tw:text-xs tw:text-ink-faint">
        Ask for any of these to be written again. It costs you nothing, and what is here now stays
        until the new run succeeds.
      </p>
      <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
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
            onFinished={onFinished}
          />
        ))}
      </div>
    </Section>
  );
}

/**
 * The reader-facing name of each of the nine — a noun, not the present-tense
 * label the stage rows carry.
 *
 * `Record<MetadataRerunStep, string>`, so a tenth member of the list is a
 * typecheck failure here rather than a blank row.
 */
const RERUN_LABEL: Record<MetadataRerunStep, string> = {
  arc: "Arc",
  tweets: "Thread",
  glossary: "Glossary",
  quotes: "Quotes",
  ideas: "Ideas",
  timeline: "Timeline",
  quiz: "Quiz",
  sketch: "Sketch",
  debate: "Debate",
};

/**
 * **What the confirm says, and it is the sentence that has to be true of every
 * row it appears under.**
 *
 * *"The result changes only if the run succeeds"* rather than *"what is here now
 * is replaced"*, because replacement is false for the glossary — and because
 * this is the draft-then-publish guarantee said where it is worth something
 * instead of left in the database docs: a step writes into a draft revision and
 * the draft replaces the live artefact only on success (`failRevision`,
 * src/store/pg-revisions.ts). A single-step re-run is therefore binary — either
 * the new artefact is published or the reader keeps exactly what they had.
 */
const RERUN_CONFIRM = "Another model call. The result changes only if the run succeeds.";
/**
 * **The glossary's own, because forcing that step appends.**
 *
 * `generateGlossary` (src/glossary.ts) adds a batch of terms rather than
 * replacing the list, which is why `src/pipeline.ts` names it as the reason
 * glossary is in `FORCE_ONLY_WHEN_NAMED` at all. Changing only the *button* to
 * say *Find more terms* would leave the confirmation lying — found by a
 * cross-family review of the plan, and the reason there are two variants rather
 * than a label swap.
 */
const RERUN_CONFIRM_GLOSSARY = "Another model call. New terms are added only if the run succeeds.";
/**
 * The one row where *"another model call"* understates the press by an order of
 * magnitude — `SKETCH_PRICE` and `SKETCH_WAIT` from ./sketch-cost.ts, so this
 * page and the Sketch panel cannot name two different prices.
 */
const RERUN_CONFIRM_SKETCH = `${RERUN_CONFIRM} It is the slowest one here — ${SKETCH_WAIT} — and it costs ${SKETCH_PRICE}.`;
/**
 * **The one row where *"another model call"* is not even the right number.**
 *
 * Debate makes **two separately metered calls** and not one call producing two
 * lists — src/debate.ts § *Two groups, two passes, one atomic step*, which says
 * why the split is load-bearing rather than incidental. Pass B runs only if
 * pass A succeeded, so a failure costs one rather than two; *up to* is doing
 * real work in the sentence.
 *
 * **The price is a range and not a number, and this said “up to about $0.27”
 * until 2026-09-07.** ⟨Sol, F12.⟩ That ceiling is
 * docs/plans/260905f-debate-mode-stage-0-spike-results.md § The spend ceiling,
 * and the *same document* corrects it twenty-seven lines further down —
 * § Stage 3½ § 1, *“The cost figure is a range, and the plan's ceiling was too
 * low”*: a completed live run cost **$0.3527**, because the ceiling was
 * measured with probes **carrying no article** while pass B sends the whole
 * thing. Per-pass cost varied **2.4×** ($0.0725 to $0.1780) with how much the
 * model chose to search, so any single figure is a sample. That section asks
 * for the words this constant now uses: *$0.20–0.40 for a completed run on a
 * short article*, rising with length, said as a range.
 *
 * Left here rather than only in the plan, because the next person to want a
 * Debate price will grep for one and the first hit is what they will take —
 * which is exactly how the wrong number got here.
 *
 * `src/step-order.ts` calls the step the second dearest thing in the app; on
 * **this** page it is the dearest of the nine, which is the comparison the
 * reader in front of it can act on, and the Sketch's row next door is what
 * makes that legible.
 *
 * **Inline rather than a constant beside `SKETCH_PRICE`.** That leaf exists
 * because three surfaces render the sketch's price to a reader and must not
 * disagree; this figure reaches a reader here and nowhere else, while the
 * ~$0.27 that appears a dozen times in `src/` is prose in comments that a
 * constant could not have collected anyway. A shared home would look like one
 * without being one. ⟨Sol, F9 — the generic sentence understated the press.⟩
 *
 * *"only if the run succeeds"* is word for word the clause the other three
 * carry: it is the draft-then-publish guarantee, and it is true here too.
 */
const RERUN_CONFIRM_DEBATE =
  "Two model calls, not one: it searches the open web, and it is the dearest thing " +
  "on this page — $0.20–0.40 for a completed run on a short article, and more on a " +
  "long one. The result changes only if the run succeeds.";

/**
 * One row: the mode's name, and a control that asks before it spends anything.
 *
 * **A component per row rather than a loop of hooks**, because each row owns its
 * own `useStepJob` and `provenance` is null before the fetch lands — a `.map` of
 * hooks inside the section would change the hook count between renders the
 * moment anything about the row list came off the request.
 *
 * ## Two clicks, and the confirm is the whole answer to the objection
 *
 * A re-run costs the reader nothing — `POST /api/jobs` spends a slot only for a
 * request carrying a `url`, and ours is a bare slug (src/routes.ts;
 * docs/project/billing.md) — and costs **us** a model call. Nothing rate-limits
 * job creation, and Greg declined a per-reader spend cap on 2026-09-06 on the
 * strength of a **global** monthly cap at OpenRouter, whose failure mode is
 * every reader losing every paid feature until the month turns. So a one-click
 * repeatable paid button, on a page holding nine of them, is the wrong shape.
 *
 * The pattern is `Rewrite` in ./Tweets.tsx — an inline confirm row, no dialog,
 * nothing blocked, and a `busy` that survives the round trip so a press cannot
 * look ignored. Copied rather than imported: that component is welded to the
 * thread page's layout.
 *
 * **On every row, including the ones the pill says have not run.** The uniform
 * rule is one code path, and the branch it saves would live in the one place a
 * mistake costs money.
 *
 * ## Everything after the press is `JobProgress`
 *
 * Running, failed, stalled, Retry and the gap between the POST and the first
 * poll that sees the job — all of it is already right in that component, so the
 * two things this row hands it that are its own are `onRun` and a wrapped
 * `retry`, both of which open the confirm instead of spending anything.
 *
 * **The Retry went straight through until 2026-09-07, and that was the two-click
 * rule with a hole in it.** ⟨Sol, F10, on the built code.⟩ `retryJob` carries the
 * original force forward — `force: forceForRetry(old.steps)`, src/jobs.ts —
 * so the new job forces the same paid step, and the button that buys it sits
 * under a failure at the moment a reader is most likely to press without
 * reading. One click, one forced paid step, no sentence. It is not the shelf
 * card's shape either: there a Retry resumes a many-stage ingest that mostly
 * worked.
 */
function RerunRow({
  slug,
  step,
  done,
  onFinished,
}: {
  slug: string;
  step: MetadataRerunStep;
  /** `StageState.done`, or undefined while the metadata request is out. */
  done: boolean | undefined;
  onFinished: () => void;
}) {
  const { job, failed, stalled, starting, start, cancel } = useStepJob(
    slug,
    step,
    onFinished,
    "watches-queue",
  );
  /**
   * **Which press the confirm is standing in front of**, or null for no confirm.
   *
   * A boolean called `asking` until 2026-09-07, and the boolean was the bug:
   * with only one paid press to guard it left the *other* one — Retry — no way
   * of routing through the same sentence. Three states, one confirm row, and
   * the Yes button dispatches on this.
   */
  const [pending, setPending] = useState<null | "run" | "retry">(null);
  /**
   * **A confirm may not outlive the state it was opened over.** ⟨Sol, F14.⟩
   *
   * Two ways it can, and both were reachable: a job arriving from another tab
   * (or the CLI) while the reader is still reading the sentence, and the
   * failure a Retry stands over clearing underneath it — `useStepJob` sets
   * `failed` to null and nothing here noticed, so `failed?.retry?.()` became a
   * button whose only effect was to close itself. A press that does nothing and
   * says nothing is the failure this repo names most often.
   *
   * **An active job wins over both kinds of confirm**, not just the retry. The
   * confirm asks whether to buy a run; a job in the polled list means the run
   * the reader is being asked about is *already happening*, and drawing the
   * question over it costs them the progress, the Stop button and the stall
   * warning for as long as they take to answer. `job` is only ever a queued or
   * running row (src/web/useStepJob.ts § `job`), so this cannot be tripped by a
   * finished one.
   *
   * **`job`, deliberately, and never `starting`.** `starting` is the gap
   * between our own POST and the first poll that sees it — so keying on it
   * would tear the confirm away between the click on Yes and the answer, which
   * is the state `busy` exists to hold on screen.
   */
  const obsolete =
    pending !== null && (job !== null || (pending === "retry" && !failed?.retry));
  /* Cleared rather than only hidden, so that a job finishing does not bring a
     question the reader never answered back out from behind it. Asking again is
     one press, and it is the press they would have made. */
  useEffect(() => {
    if (obsolete) setPending(null);
  }, [obsolete]);
  /* What is actually drawn. Derived rather than waited for, because the effect
     above lands a render later and that render is the one showing the confirm
     over the live job. */
  const asking = obsolete ? null : pending;
  /* The round trip. `start` resolves when the POST has been answered, not when
     the job has, and until then there is nothing in the polled list — so
     without this the confirm row would come and go under a press that had
     already landed. */
  const [busy, setBusy] = useState(false);
  /**
   * **Where focus goes when the confirm opens**, and it went to `BODY`
   * until 2026-09-07 ⟨Sol, F13⟩: the press unmounts the button it was on, and
   * nothing here caught it. A reader who could not see the sentence therefore
   * had to go looking for the control that had replaced the one they pressed,
   * and would meet Yes with no idea what it was standing over.
   */
  const yesRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (asking) yesRef.current?.focus();
  }, [asking]);
  /**
   * **The id the sentence is reachable by**, keyed on the step because nine of
   * these rows are on screen at once and a fixed id would give the reader
   * whichever row happened to be first in the document.
   */
  const confirmId = `rerun-confirm-${step}`;

  const Icon = STAGE_ICONS[step];
  /* *Find more terms* for the glossary, in the words its own panel already uses,
     because forcing that step appends. Otherwise off `done`, so the button and
     the `ran` / `not run` pill in Technical details cannot contradict each
     other — and `undefined` reads as "not that we know of". */
  const label = step === "glossary" ? "Find more terms" : done ? "Run it again" : "Run it";
  const confirm =
    step === "glossary"
      ? RERUN_CONFIRM_GLOSSARY
      : step === "sketch"
        ? RERUN_CONFIRM_SKETCH
        : step === "debate"
          ? RERUN_CONFIRM_DEBATE
          : RERUN_CONFIRM;
  /* **The same sentence for a Retry as for a run, and that is not laziness.**
     `JobProgress`'s Retry says *"skipping the stages that already worked"* in
     its tooltip, which is true of an ingest and vacuous here: our job has one
     step, so there is nothing else in it that could have worked. A retry of it
     *is* a re-run, and it forces the same step, so it buys exactly what the run
     buys and the confirm can honestly say the same thing. Only the Yes button's
     words differ, so the reader can tell which press they are agreeing to. */
  const yes =
    asking === "retry" ? "Yes, try again" : step === "glossary" ? "Yes, find more" : "Yes, run it";
  /* Retry, routed through the confirm instead of straight to the retry route —
     see § the Retry in this component's header. The original `failed.retry` is
     read at click time below, off this render's `failed`, so nothing here has to
     hold a stale copy of it. `retry: null` (a POST that never became a job)
     stays null, because that is what tells `JobProgress` to draw the run button
     instead — and that one already asks. */
  const failedAsking =
    failed?.retry ? { ...failed, retry: () => setPending("retry") } : failed;

  return (
    <div
      /* The hook the tests find a row by, so that asserting on DOM order — which
         would pass whatever the list happened to be — is never the way in. The
         same argument `data-section` on this page's headings makes.

         **It is not what tells the nine buttons apart**, and reading it that way
         is how the missing accessible names went unnoticed: every actionable
         control in the row now carries the mode's name in its own `aria-label`,
         and the tests assert on those. */
      data-rerun-step={step}
      className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-2 tw:px-4 tw:py-3 tw:text-sm"
    >
      <Chip icon={Icon} />
      <span className="tw:text-foreground">{RERUN_LABEL[step]}</span>
      {/* A `div` and not a `span`: `JobProgress` draws a `div` for its starting
          row and its running band, and a block element inside phrasing content
          is invalid markup that nothing here would ever go red over. */}
      <div className="tw:ml-auto tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2">
        {asking ? (
          <>
            <span id={confirmId} className="tw:text-xs tw:text-muted-foreground">
              {confirm}
            </span>
            <Button
              type="button"
              ref={yesRef}
              variant="outline"
              size="xs"
              disabled={busy}
              /* **What the press costs, said to the reader who cannot see it.**
                 The sentence beside this button is a plain sibling `<span>`,
                 which a screen reader announces on its way past and not at all
                 to somebody navigating by button list — so without this, Yes
                 announced its own words and nothing about two model calls or
                 the price, and the two-click rule bought nothing for exactly
                 the reader who can least afford a surprise. ⟨Sol, F13.⟩

                 **On Yes and not on Cancel.** A description is read after the
                 name every time the control is reached, and Cancel spends
                 nothing: repeating the price on it would be noise on the safe
                 button. The guarded press carries it. */
              aria-describedby={confirmId}
              /* Every actionable control in this row carries the mode's name,
                 because the name itself is a sibling `<span>` and a screen
                 reader's button list does not read those — nine rows of *Yes,
                 run it* and *Cancel* otherwise. The visible words come first, so
                 saying them still matches. ⟨Sol, F11.⟩ */
              aria-label={`${busy ? "Starting…" : yes} — ${RERUN_LABEL[step]}`}
              onClick={async () => {
                setBusy(true);
                if (asking === "retry") {
                  /* The failure's own retry, taken from this render rather than
                     from the wrapper handed to `JobProgress`. It returns void —
                     `queue.retry` is fired and not awaited (src/web/useStepJob.ts)
                     — so there is no round trip to hold `busy` across, unlike the
                     branch below. */
                  failed?.retry?.();
                } else {
                  /* Forced, and forced **by name**. The step's own freshness check
                     would otherwise skip an artefact that is, by construction,
                     current — a run that looks like it worked and changed
                     nothing. `useStepJob` turns this into `force: [step]`, never a
                     positional force, so nothing after it in `STEP_ORDER` is
                     swept in. */
                  await start({ force: true });
                }
                setBusy(false);
                setPending(null);
              }}
            >
              {busy ? "Starting…" : yes}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy}
              aria-label={`Cancel — ${RERUN_LABEL[step]}`}
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
          </>
        ) : (
          <JobProgress
            job={job}
            starting={starting}
            failed={failedAsking}
            stalled={stalled}
            /* Opens the confirm rather than starting a run — the two-click rule,
               kept in the one place the button is actually drawn. */
            onRun={async () => setPending("run")}
            onCancel={cancel}
            label={label}
            step={step}
            icon={<RefreshCw size={13} />}
            /* What the band's own two buttons are about, for their accessible
               names — see `about` in JobProgress.tsx. Nine bands on one page is
               the case that prop exists for. */
            about={RERUN_LABEL[step]}
            /* Only ever shown for the moment before the step reports a label of
               its own, so it says the neutral thing rather than guessing a verb
               — the pipeline's own are *Writing the arc*, *Finding the terms*,
               *Drawing the argument*, and none of those generalises. */
            runningLabel={`Working on the ${RERUN_LABEL[step].toLowerCase()}`}
          />
        )}
      </div>
    </div>
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
     hand the reader two copies of the same file. */
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/export/${encodeURIComponent(slug)}`);
      /* `failure`, not `readJson`: the success body is a zip and reading it as
         text to look for an `error` key would consume the bytes we came for.
         On a refusal it hands back the server's own sentence. */
      if (!res.ok) throw await failure(res);

      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug}.zip`;
      /* In the document, not detached: Firefox has never dispatched the default
         action for a `click()` on an anchor that is not in a tree, and the
         symptom is nothing happening at all. */
      document.body.append(link);
      link.click();
      link.remove();
      /* A macrotask later, not synchronously. Revoking inside the same task can
         land before the browser has resolved the URL for the download, and the
         download then fails silently. A tick is enough — unlike SourceLink's
         minute-long timer, where a *new tab* has to fetch the URL itself; here
         the fetch starts during the click above. */
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      /* The 413's prose is the server's and it is already written for the
         reader (src/routes.ts § `sendExport`): it says what happened and that
         trying again will not help, which is what docs/project/copy.md asks
         for. Putting "Couldn't build the download" in front of it would add a
         lead that sentence does not need. Everything else gets the lead,
         because a bare "No such article." beside a button says nothing about
         which button. */
      setError(
        statusOf(e) === 413
          ? `${(e as Error).message} [export-too-big]`
          : `Couldn't build the download. ${(e as Error).message} [export-failed]`,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!offer) return null;

  return (
    <Section label="Export">
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
          augmentation on top of it — hierarchy, glossary, ideas, quotes, timeline, quiz, comments,
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
    <p className="tw:mt-1 tw:mb-0 tw:font-prose tw:text-sm tw:text-muted-foreground">
      {profile ? (
        profile
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
    <Link href={href} className="tw:text-highlight">
      {/* **"Comments", to match the row's own label and the mode's name.** It
          said "questions" under a label that said Comments, which is two words
          for one thing on one line — and the mode a reader has already met in
          the bar is called Comments (docs/project/comments.md). */}
      {count} comment{count === 1 ? "" : "s"}
    </Link>
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
function Origin({ meta, slug, owner }: { meta: Meta; slug: string; owner: boolean }) {
  const source = webSource(meta);
  if (source) {
    return (
      <p className="tw:mt-1 tw:mb-0 tw:text-xs">
        <a
          href={source}
          target="_blank"
          rel="noreferrer noopener"
          className="tw:inline-flex tw:items-center tw:gap-1 tw:break-all tw:text-highlight"
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
        <span className="tw:text-highlight">
          <SourceLink slug={slug}>View the original</SourceLink>
        </span>
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
    <Section label="How well we read the PDF">
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
 * it shipped, as *Generate it again* — a section of its own, further up, and
 * open. Which is the second half of the story this paragraph tells: burying it
 * here is exactly why nobody found it. See `RerunSection` above, and the note
 * where `SOON` stood.
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
 */
function TechnicalDetails({
  slug,
  provenance,
  rawSha256,
  error,
  slow,
  aside,
  hierarchyGenerator,
  arcGenerator,
}: {
  slug: string;
  provenance: ArticleMetadata | null;
  /** The PDF's hash, if this article is one. */
  rawSha256: string | undefined;
  error: string | null;
  slow: boolean;
  /** `N of M stages · last wrote …`, kept on the heading so shutting it takes only the detail. */
  aside: string | null;
  hierarchyGenerator: string;
  arcGenerator: string | undefined;
}) {
  return (
    <Section label="Technical details" collapsible={!error} aside={error ? null : aside}>
      {error && (
        <p
          className={`${CARD} tw:m-0 tw:mb-3 tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground`}
        >
          {error}
        </p>
      )}

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
                className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:font-mono tw:text-xs tw:break-all tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight"
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
                  className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:font-mono tw:text-xs tw:break-all tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight"
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
                  className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:font-mono tw:text-xs tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight"
                >
                  {rawSha256.slice(0, 12)}…
                </button>
              </Tooltip>
            </Row>
          )}
        </div>
      </TooltipGroup>

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
                generator={
                  stage.step === "hierarchy"
                    ? hierarchyGenerator
                    : stage.step === "arc"
                      ? arcGenerator
                      : undefined
                }
              />
            ))}
          </div>
        </TooltipGroup>
      )}

    </Section>
  );
}

/**
 * Archive — and Put back, which is the whole reason it may.
 *
 * **It was called Delete until 2026-09-04**, and the handler behind it has
 * never done anything but archive. That gap is the whole of report
 * SPIDERYARN-READING2-19: Greg asked for an archive feature, from this page and
 * from the shelf, that had existed since 2026-08-26 — because the word on the
 * button told him he was looking at something else. Renaming a control is a
 * smaller act than building one and it was the entire fix.
 *
 * ## Why the placeholder that stood here for two days was right, and what changed
 *
 * This was a dimmed `SOON` row until 2026-08-27, and its stated reason was not
 * that the endpoint was missing — `PATCH /api/library/:slug` has taken
 * `{ archived }` since 2026-08-26 — but that the shelf's confirmation is a
 * nine-second Undo strip, and *"a page you can navigate away from is a bad
 * place to put the only chance to change your mind"*.
 *
 * That reason has been answered twice over. The shelf grew a **Show archived**
 * disclosure the same week, so the strip stopped being the only way back
 * ([Library.tsx](Library.tsx)); and this control does not use a strip at all.
 * An archived article stays readable by direct link — only the shelf filters
 * (docs/project/library.md) — so the reader who archives it from here is still
 * looking at its page afterwards, and the honest thing for that page to show is
 * the state it is now in, with the way out of it, and no clock. **The undo here
 * never expires.** That is a stronger promise than the shelf's, not a weaker
 * one, and it is available precisely because this page is about one article.
 *
 * ## Three states, and the third is the one to get right
 *
 * `undefined` is *we have not been told yet* — the metadata request is in
 * flight, or it failed. Neither may show a button at all, and the failed one
 * must not say which way round things are: a page that shows Archive over an
 * already-archived article, or Put back over a live one, has made a claim about
 * the reader's library out of a request that established nothing. The same rule
 * `AboutYou` above is arranged around, found by the same review.
 *
 * There is a fourth state above those three, and it is a refusal rather than an
 * ignorance: an address with **no article of its own**, which `loadArticle` and
 * `articleMetadata` both answer with the fixture. Nothing to archive, and the
 * PATCH would 404, so the section says so instead of offering a button whose
 * only outcome is an error. `showingFixture` at the call site.
 *
 * Nothing here needs a `key`: App.tsx already mounts this whole page as
 * `<Metadata key={slug}>`, so switching article remounts everything below it
 * and none of this state can cross from one article to another. An inner key
 * was written first and removed as redundant when a review pointed at the outer
 * one.
 */
function ArchiveArticle({
  slug,
  archivedAt,
  failed,
  fixture,
}: {
  slug: string;
  /** From the server. `undefined` until it lands, and for ever if it does not. */
  archivedAt: string | null | undefined;
  failed: boolean;
  /** This address has no article of its own — see `showingFixture` at the call site. */
  fixture: boolean;
}) {
  /* What the reader has just done, if anything — `null` means they have not
     touched it, and the server's answer stands. A sentinel object rather than
     seeding a `useState` from the prop in an effect, because the prop arrives
     late and a seeding effect would need to know whether a later `provenance`
     is fresher than a click, which is a question with no good answer.

     `at: undefined` inside it is the third answer: *we asked, and we no longer
     know*. See the catch below. */
  const [acted, setActed] = useState<{ at: string | null | undefined } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();

  const at = acted ? acted.at : archivedAt;

  /* One function for both directions, because they are one PATCH with one
     boolean in it — exactly as `useShelf.undo` and `useShelf.restore` are
     deliberately the same request on the shelf side. Two functions here would
     be two places to get the field name wrong. */
  async function set(archived: boolean): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`/api/library/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      /* The server's own answer, not the boolean we sent. Both stores build
         this entry through `describeArticle`, so the date on it is the date
         that was stored — including the case that makes this worth doing:
         archiving something already archived keeps the ORIGINAL date
         (src/shelf.ts), and a locally-invented `new Date()` would print a
         timestamp the store disagrees with. */
      const { entry } = await readJson<{ entry: LibraryEntry }>(r);
      setActed({ at: entry.archivedAt ?? null });
    } catch (e) {
      /* **A failed request is not proof that nothing was written**, and saying
         so was this control's one dishonest sentence until a cross-model review
         took it apart, 2026-08-27. The route writes and *then* reads again to
         answer `purpose` (src/routes.ts § patchShelf), both stores persist and
         then rebuild the entry to return it, and a response can simply be lost
         on the way back. Every one of those fails after the archive has
         happened. A page that then says "Nothing changed" and offers Archive
         again is telling the reader something it has no way to know — and the
         Archive they press next is the one that looks like it did nothing.

         So: ask. The answer to "did that work" is a fresh read, not the
         request's own exit code. If even the re-read fails we are honestly
         lost, and `at: undefined` says so by taking the button away. */
      setError((e as Error).message);
      try {
        const m = await readJson<ArticleMetadata>(
          await apiFetch(`/api/metadata/${encodeURIComponent(slug)}`),
        );
        setActed({ at: m.archivedAt });
      } catch {
        setActed({ at: undefined });
      }
    } finally {
      setBusy(false);
    }
  }

  /* Not ignorance but a refusal, and it comes first because it is the one state
     where the answer is known and the act is still impossible: nothing under
     this address is ours to archive. */
  if (fixture) {
    return (
      <div className={`${CARD} tw:p-4`}>
        <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
          This address has no article of its own — the reading view is showing the example fixture,
          so there is nothing here to archive. The{" "}
          <Link href={LIBRARY_HREF} className="tw:text-highlight">
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
    const lost = failed || acted !== null;
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

           `timeAgo` on a `useNow` clock rather than this file's own `ago`, and
           both halves of that matter. The clock, because this line is written
           the instant the reader presses Archive: `ago` reads `Date.now()` once
           during render, so "Archived just now" would still say "just now" an
           hour later, on a page nothing else re-renders. And `timeAgo`, because
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
            ? "tw:text-highlight tw:hover:bg-highlight/10 tw:focus-visible:bg-highlight/10"
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
            It is off the library and out of library search. It is not erased, and this offer does
            not expire.
          </>
        ) : (
          <>
            It comes off the library and out of library search. Nothing is erased — the article, its
            block ids and every question you have asked about it stay exactly where they are, this
            page and the reading view keep working, and Put back is here and under{" "}
            <em className="tw:not-italic tw:text-foreground">Show archived</em> on the{" "}
            <Link href={LIBRARY_HREF} className="tw:text-highlight">
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
 * highlights, questions, chats, summaries and the hierarchy all hang off the
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
  "highlights, questions and chats, its summaries and hierarchy — and it cannot be undone. " +
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
            className="tw:cursor-pointer tw:border-0 tw:bg-transparent tw:p-0 tw:text-sm tw:text-highlight tw:underline tw:underline-offset-4 tw:focus-visible:outline-none tw:focus-visible:text-highlight"
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
     revalidation (see its header). Every row in *Generate it again* can fire
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
          className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight"
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
          className="tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight"
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
 * A section's heading turned into an element id, for the contents list to aim at.
 *
 * Deriving it rather than passing one in: an `id` prop is a second name for the
 * section that nothing checks against the first, and the failure is a contents
 * entry that scrolls nowhere. The labels here are short English phrases, so
 * lower-casing and hyphenating is enough — `"Access & sharing"` becomes
 * `"access-sharing"`, and there is no pair of labels on this page that collide
 * under it.
 */
function sectionId(label: string): string {
  return `sec-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function Section({
  label,
  aside,
  collapsible,
  children,
}: {
  label: string;
  /** One line answering the section's question, on the heading row. */
  aside?: ReactNode;
  collapsible?: boolean;
  children: ReactNode;
}) {
  /* Local state, not a URL parameter, and this page's own `at` two hundred
     lines up is the reason that needs saying: url-state.md puts every bit of
     view state in the address bar. A shut section is not view state in that
     sense — it is the same kind of thing as an open drawer, which
     `carriedSearch` deliberately strips on every navigation because a drawer
     you left open is not a place you were. Nothing about a shut section is
     worth linking to, and a `?stages=open` in every shared metadata URL would
     be noise in the one place this app keeps clean. */
  /**
   * **`open` is the reader's toggle; `showing` is what actually renders.**
   *
   * This was `useState(!collapsible)`, and that is a bug that had been live
   * since the section was written, found by tests/metadata-page-order.test.tsx
   * on 2026-09-03. `useState`'s argument is an *initial* value: it is read on
   * the first render and never again. But the one caller that passes a varying
   * `collapsible` computes it from a request that has not answered yet —
   * `collapsible={!provenanceError}` — so the section mounts collapsible,
   * latches `open: false`, and then the request fails.
   *
   * At that moment `collapsible` goes false, which takes the disclosure button
   * away (the heading stops being a control), while `open` is still false. The
   * section was left **shut, with nothing on the page that could open it**, and
   * what was sealed inside was the error message — the exact outcome the rule
   * was written to prevent, by a cross-model review on 2026-08-27 which said
   * "a shut section is exactly where it would have gone". It went there anyway.
   *
   * Deriving it fixes the class rather than the instance: a section that is not
   * collapsible shows its children, whenever it stopped being collapsible and
   * whatever the reader had toggled beforehand. docs/postmortems/260903d-a-collapsible-section-latched-shut-and-sealed-the-error-in.md
   */
  const [open, setOpen] = useState(false);
  const showing = !collapsible || open;
  const head = (
    <>
      <span
        aria-hidden="true"
        className="tw:inline-block tw:h-3.5 tw:w-[3px] tw:shrink-0 tw:rounded-full tw:bg-highlight/70"
      />
      {label}
    </>
  );
  return (
    /* `data-section` is what the contents list in the margin reads, and `id` is
       where it scrolls to — PageContents.tsx, which derives its whole list from
       these rather than from a second array of section names.

       `scroll-mt-24` is 6rem, and `REACHED_PX` over there is deliberately a
       little MORE than it — the section a click has just scrolled to must be
       the section the list then marks, and setting the two equal put that on a
       knife edge that a browser lost. See the constant's docstring; if you
       change this 24, that number has to stay above it. */
    <section id={sectionId(label)} data-section={label} className="tw:mt-8 tw:scroll-mt-24">
      <h2 className="tw:m-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.09em] tw:text-ink-faint">
        {collapsible ? (
          /* The heading itself is the control, so the target is the whole line
             rather than a 12px chevron. `aria-expanded` on the button and
             nothing on the section: the button is what opens, and the h2 stays
             a heading so the page's outline is the same shut or open. */
          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={showing}
            className="tw:flex tw:items-center tw:gap-2 tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:uppercase tw:tracking-[0.09em] tw:cursor-pointer tw:hover:text-highlight tw:focus-visible:outline-none tw:focus-visible:text-highlight"
          >
            {head}
            {showing ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          head
        )}
        {/* Shown open or shut, and that is the point of it: shutting the
            section must not take the answer away, only the detail. */}
        {aside && (
          <span className="tw:ml-auto tw:min-w-0 tw:truncate tw:normal-case tw:tracking-normal tw:text-ink-faint">
            {aside}
          </span>
        )}
      </h2>
      {showing && children}
    </section>
  );
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
  tip,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  value: string;
  tip: string;
}) {
  return (
    <Tooltip placement="top" content={<TipNote>{tip}</TipNote>}>
      <div className={`${CARD} tw:p-4 tw:cursor-help tw:transition-colors tw:hover:border-highlight/40`}>
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
function StageRow({ stage, generator }: { stage: StageState; generator: string | undefined }) {
  const { step, label, outputs, done } = stage;
  // `stage.ranAt` / `stage.bytes` are read off the object below rather than
  // destructured here, so a reader of `<Wrote>` can see which they are.
  const Icon = STAGE_ICONS[step];
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
            and the arc, which are in hand because the article loaded — so a hierarchy
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
        <Wrote at={stage.ranAt} began={stage.startedAt} bytes={stage.bytes} done={done} />
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
}: {
  at: string | null;
  began: string | null;
  bytes: number | null;
  done: boolean;
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
        className="tw:ml-auto tw:shrink-0 tw:cursor-help tw:border-0 tw:border-b tw:border-dotted tw:border-rule-strong tw:bg-transparent tw:p-0 tw:text-inherit tw:focus-visible:outline-none tw:focus-visible:text-highlight"
      >
        {/* "last wrote" rather than "ran" for a stage that is not done: something
            of its is on disk and the set is incomplete, which is precisely the
            state this page gets opened to look at. */}
        {done ? "ran" : "last wrote"} {ago(when)}
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
function Fetched({ iso, lead }: { iso: string | undefined; lead: boolean }) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
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
        {lead && <span className="tw:mr-2 tw:opacity-50">·</span>}
        <span className="tw:border-b tw:border-dotted tw:border-rule-strong">
          fetched {ago(when)}
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * "3 days ago", from `Intl.RelativeTimeFormat` rather than a date library.
 *
 * Theirs used date-fns' `formatDistanceToNow` for this one string. The platform
 * has done it since 2018 and this app has no other use for a date library, so
 * the dependency would be carrying ~20KB to say "yesterday".
 */
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600e3],
  ["month", 30 * 24 * 3600e3],
  ["week", 7 * 24 * 3600e3],
  ["day", 24 * 3600e3],
  ["hour", 3600e3],
  ["minute", 60e3],
];

function ago(when: Date): string {
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const elapsed = when.getTime() - Date.now();
  /* `Intl.RelativeTimeFormat.format` throws a RangeError on a non-finite
     number, so an unparseable date anywhere upstream would take the whole page
     down rather than print a wrong time. Same rule `timeAgo` in
     relative-time.ts keeps, arrived at the same way — a review, 2026-08-27. */
  if (!Number.isFinite(elapsed)) return "at an unknown time";
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) return fmt.format(Math.round(elapsed / ms), unit);
  }
  return fmt.format(Math.round(elapsed / 1000), "second");
}

/**
 * A carried query string asking for the questions drawer.
 *
 * `carriedSearch` strips `?panel=` deliberately — a drawer left open across a
 * navigation is not a place you were. This puts one back for the one case where
 * the navigation IS for the drawer, exactly as Dock.tsx does for its own button.
 */
function withPanel(search: string): string {
  return search ? `${search}&panel=questions` : "panel=questions";
}

/** Enough of a paragraph to recognise it, cut on a word boundary. */
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
