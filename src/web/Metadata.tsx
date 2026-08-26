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
 * (docs/plans/bottom-bar.md#why-the-bottom), and a page has no such problem
 * because it is not beside anything.
 *
 * **Nothing here is generated and nothing here is a model call.** This is the
 * page you open when something looks wrong, so every number on it is read off
 * the artefacts.
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
 * per-file sizes and mtimes, and the privacy toggle and owner email, which
 * describe an app with accounts.
 *
 * ## What it deliberately does not say
 *
 * **Whether anything is stale.** The first version of this page led with a red
 * warning when a later artefact was older than an earlier one. That check is
 * wrong: a *successful* toc run writes `tree.json` and then copies
 * `blocks.json` beside it, so every correct run tripped it. More deeply, an
 * mtime records when a file was written, not what it was written *from*. Until
 * `tree.json` and `arc.json` carry a hash of the blocks they consumed — the way
 * `tweets.json` already does — the honest thing is to say which stages have
 * run and stop. A confident wrong verdict is worse here than no verdict,
 * because this is the page you open once you have stopped trusting the others.
 *
 * **How hard the article is to read.** No badge, and no paragraph explaining
 * the absence either; the case is in
 * original-version/difficulty-and-reading-time.md. Note that it is *not* in the
 * "not built yet" section at the bottom either — that section is a list of
 * things we mean to build, and this is a thing we have decided against.
 *
 * Tailwind utilities rather than a block in styles.css: this page is chrome,
 * and chrome is what Tailwind is here for
 * (docs/project/web-client.md#tailwind-and-shadcn-components). Every class needs
 * the `tw:` prefix — unprefixed names silently do nothing.
 */
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useQueryState } from "nuqs";
import {
  ArrowLeft,
  Blocks,
  BookA,
  BookOpen,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Layers,
  List,
  ListOrdered,
  ListTree,
  MessageCircle,
  RefreshCw,
  Target,
  Trash2,
  Waypoints,
} from "lucide-react";
import type { Article, ArticleMetadata, StageState, StepName } from "../types.js";
import { WPM } from "../reading-time.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { atParam } from "./params.js";
import { carriedSearch, readHref } from "./router.js";
import { articleStats } from "./stats.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { SLOW_AFTER_MS } from "./useSlow.js";

/**
 * Clear of the fixed bottom bar, in terms of `--dock-h` rather than a number.
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
const DOCK_CLEARANCE = "tw:pb-[calc(var(--dock-h)_+_2rem)]";

/** The card surface, said once. Same tokens as a library card, on purpose. */
const CARD = "tw:rounded-lg tw:border tw:border-border tw:bg-card";

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
  toc: ListTree,
  arc: Waypoints,
  tweets: ListOrdered,
  glossary: BookA,
  summary: Layers,
};

/**
 * Things this page should say and cannot yet, each with what the previous
 * version's attempt at it taught us.
 *
 * Same shape and same tooltip treatment as `SOON` in Dock.tsx — one convention
 * for "this is a real intention, not an oversight", so a reader who has met a
 * dimmed button in the bar already knows what a dimmed row here means.
 *
 * **Reading difficulty is deliberately not in this list.** It is not unbuilt;
 * it is declined, and putting it here would promise it.
 */
const SOON: { key: string; label: string; icon: ComponentType<{ size?: number }>; blurb: string; learned: string }[] = [
  {
    key: "purpose",
    label: "Your reading purpose",
    icon: Target,
    blurb: "What you are reading this for, in your own words, kept with the article.",
    learned:
      "A genuinely good question to ask, and theirs asked it. The blocker is not the text field: this repo has exactly one reader-state store today, and a second one should not be invented for a single line of text.",
  },
  {
    key: "rerun",
    label: "Re-run a stage",
    icon: RefreshCw,
    blurb: "Regenerate the tree, or the arc, from the row above that says it is out of date.",
    learned:
      "The queue already accepts the request. What is missing is the sentence above it — nothing here can honestly tell you a stage is stale until the artefacts record what they were built from.",
  },
  {
    key: "delete",
    label: "Delete this article",
    icon: Trash2,
    blurb: "Remove the article and everything the pipeline wrote for it.",
    learned:
      "Theirs had this button. Ours would be deleting the only copy of the block ids that every question is addressed by, and there is nothing here to undo it with.",
  },
];

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

export function Metadata({ slug, article }: { slug: string; article: Article }) {
  const { meta, tree, arc } = article;
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  /**
   * Which stages have run, and how many questions have been asked. Not in the
   * article payload and deliberately never will be: that payload is fetched on
   * every page, and walking the filesystem for it would charge every reader for
   * a page almost nobody opens.
   */
  const [provenance, setProvenance] = useState<ArticleMetadata | null>(null);
  const [provenanceError, setProvenanceError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let live = true;
    setProvenance(null);
    setProvenanceError(null);
    setSlow(false);
    const timer = setTimeout(() => live && setSlow(true), LOADING_AFTER_MS);
    fetch(`/api/metadata/${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? r.statusText);
        return body as ArticleMetadata;
      })
      .then((m) => live && setProvenance(m))
      .catch((e: Error) => live && setProvenanceError(e.message));
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug]);

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
  const lastRead = at ? article.blocks.find((b) => b.id === at) : undefined;

  const backHref = readHref(slug, carriedSearch(location.search), "article");
  const facts = [meta.byline, meta.siteName, meta.lang].filter(Boolean) as string[];

  return (
    <>
      {/* `pt-14` rather than `pt-10`: the corner wordmark is fixed
          (HomeLogo.tsx), so on a window narrow enough that this centred column
          reaches the left edge it would otherwise sit on the back-link. */}
      <main className={`tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-14 tw:font-sans ${DOCK_CLEARANCE}`}>
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
        <h1 className="tw:m-0 tw:font-prose tw:text-2xl tw:leading-snug tw:text-foreground">
          {meta.title}
        </h1>
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
        {meta.url && (
          <p className="tw:mt-1 tw:mb-0 tw:text-xs">
            <a
              href={meta.url}
              target="_blank"
              rel="noreferrer noopener"
              className="tw:inline-flex tw:items-center tw:gap-1 tw:break-all tw:text-highlight"
            >
              {meta.url}
              <ExternalLink size={12} className="tw:shrink-0" />
            </a>
          </p>
        )}
        <p className="tw:mt-2 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:font-mono tw:text-xs tw:text-ink-faint">
          <span className="tw:rounded tw:border tw:border-border tw:px-1.5 tw:py-0.5">{slug}</span>
          {provenance && (
            <span className="tw:rounded tw:border tw:border-border tw:px-1.5 tw:py-0.5">
              {provenance.dir}/
            </span>
          )}
          {/* The fixture opens under any unknown slug, so a page describing it
              must say so — otherwise the numbers below look like this article's
              and are somebody else's. */}
          {provenance && provenance.dir === "example" && slug !== "example" && (
            <span
              className="tw:rounded tw:border tw:border-highlight/40 tw:px-1.5 tw:py-0.5 tw:text-highlight"
              title="No artefacts exist for this slug, so the reading view is showing the committed example fixture — see example/README.md"
            >
              fixture
            </span>
          )}
        </p>

        {/* ------------------------------------------------- 2. at a glance --
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
                tip={`Words ÷ ${WPM} a minute, rounded, and never less than one. A flat rate: it does not know how hard this particular article is. The original version asked a model instead of counting syllables, and scaled its answer by how confident the model was — we have not.`}
              />
              <Stat
                icon={Blocks}
                label="Blocks"
                value={stats.blocks.toLocaleString()}
                tip="Paragraphs, headings, quotes and images — each with a stable id that every question and every summary is addressed by."
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
                tip="How many rungs the tree has below the whole article. It is the number of granularity columns this piece can offer, so it is the honest answer to “why does this one only have two?”."
              />
            </div>
          </TooltipGroup>
        </Section>

        {/* ------------------------------------------- 3. in one sentence --
            Serif, because this is the article talking rather than the app —
            the same distinction the reading view makes between prose and
            chrome, and the same one a library card makes. */}
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

        {/* ------------------------------------------ 4. what we did to it --
            Which stages have run, and the two that carry a model's name. A
            stage counts as run only when *all* of its outputs are on disk —
            src/pipeline.ts owns that rule and this page borrows it rather than
            restating it. */}
        <Section label="What we did to it">
          {provenanceError && (
            <p
              className={`${CARD} tw:m-0 tw:border-destructive/40 tw:bg-destructive/10 tw:p-4 tw:text-sm tw:text-foreground`}
            >
              {provenanceError}
            </p>
          )}
          {/* Named, not "Loading…", and only after the timer — their loading
              rules on both counts (original-version/design-system.md#loading-states). */}
          {!provenanceError && provenance === null && slow && (
            <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
              Checking which files the pipeline wrote…
            </p>
          )}
          {provenance && (
            <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
              {provenance.stages.map((stage) => (
                <StageRow
                  key={stage.step}
                  stage={stage}
                  generator={
                    stage.step === "toc"
                      ? `${tree.generator} · ${tree.version}`
                      : stage.step === "arc" && arc
                        ? `${arc.generator} · ${arc.version}`
                        : undefined
                  }
                />
              ))}
            </div>
          )}
        </Section>

        {/* ------------------------------------------------ 5. your reading --
            Reader state, and the only section on the page that is about you
            rather than about the article. */}
        <Section label="Your reading">
          <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden`}>
            <Row icon={MessageCircle} label="Questions asked">
              {provenance ? (
                provenance.comments > 0 ? (
                  <Link
                    href={readHref(slug, withPanel(carriedSearch(location.search)), "article")}
                    className="tw:text-highlight"
                  >
                    {provenance.comments} question{provenance.comments === 1 ? "" : "s"}
                  </Link>
                ) : (
                  <span className="tw:text-muted-foreground">None yet</span>
                )
              ) : (
                <span className="tw:text-muted-foreground">{slow ? "Counting…" : ""}</span>
              )}
            </Row>
            <Row icon={Target} label="Where you left off">
              {lastRead ? (
                <Link href={backHref} className="tw:text-highlight">
                  “{snippet(lastRead.text)}”
                </Link>
              ) : (
                <span className="tw:text-muted-foreground">
                  You haven't moved off the top of this one yet.
                </span>
              )}
            </Row>
          </div>
        </Section>

        {/* --------------------------------------------- 6. not built yet --
            Dimmed rows rather than absence, because absence is indistinguishable
            from an oversight. Same tooltip convention as the bar's placeholder
            buttons (Dock.tsx): what the thing would be, and what the previous
            version's attempt at it taught us. */}
        <Section label="Not built yet">
          <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
            <div className={`${CARD} tw:divide-y tw:divide-border tw:overflow-hidden tw:opacity-70`}>
              {SOON.map((idea) => (
                <Tooltip
                  key={idea.key}
                  placement="top"
                  className="tip-soon"
                  content={
                    <>
                      <div className="tip-soon-head">
                        {idea.label} <span className="tip-soon-flag">not built yet</span>
                      </div>
                      <p>{idea.blurb}</p>
                      <p className="tip-soon-learned">{idea.learned}</p>
                    </>
                  }
                >
                  {/* A button so it is focusable and reaches the tooltip by
                      keyboard, `aria-disabled` so nothing announces it as
                      something that will happen if pressed. */}
                  <button
                    type="button"
                    aria-disabled="true"
                    className="tw:flex tw:w-full tw:items-center tw:gap-3 tw:px-4 tw:py-3 tw:text-left tw:text-sm tw:text-muted-foreground tw:cursor-help tw:hover:bg-accent/40 tw:focus-visible:outline-none tw:focus-visible:bg-accent/40"
                  >
                    <Chip icon={idea.icon} />
                    <span className="tw:border-b tw:border-dotted tw:border-rule-strong">
                      {idea.label}
                    </span>
                    <span className="tw:ml-auto tw:shrink-0 tw:rounded-full tw:border tw:border-border tw:px-2 tw:py-0.5 tw:text-[0.68rem] tw:uppercase tw:tracking-[0.06em]">
                      not built yet
                    </span>
                  </button>
                </Tooltip>
              ))}
            </div>
          </TooltipGroup>
        </Section>
      </main>

      {/* No `drawer` prop, and that is the whole reason the Questions button on
          this page is a link back to the article rather than a drawer trigger.
          See Dock.tsx. */}
      <Dock slug={slug} view="metadata" />
    </>
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
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="tw:mt-8">
      <h2 className="tw:m-0 tw:mb-3 tw:flex tw:items-center tw:gap-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.09em] tw:text-ink-faint">
        <span
          aria-hidden="true"
          className="tw:inline-block tw:h-3.5 tw:w-[3px] tw:shrink-0 tw:rounded-full tw:bg-highlight/70"
        />
        {label}
      </h2>
      {children}
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
    <Tooltip placement="top" content={<Note>{tip}</Note>}>
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
 * The text inside a plain tooltip.
 *
 * `.tooltip` styles the panel and deliberately sets no font-size, so a bare
 * string inherits `body`'s 1rem — noticeably bigger than every other tooltip in
 * the app, all of which are on classed content (`.tip-crumb`, `.tip-search`,
 * `.tip-soon`). Sized here rather than by adding a rule to styles.css, which
 * would be a fifth spelling of the same thing.
 *
 * `foreground/85` and NOT `ink-soft`, which is what the eye wants and what the
 * other tooltips use: `--ink-soft` is declared in styles.css but is not one of
 * the four reading-view names bridged into Tailwind's theme (tailwind.css), so
 * `tw:text-ink-soft` compiles to nothing at all and the text would simply
 * inherit — no error, no missing class, just the wrong colour.
 */
function Note({ children }: { children: ReactNode }) {
  return (
    <span className="tw:block tw:text-xs tw:leading-relaxed tw:text-foreground/85">{children}</span>
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
  const Icon = STAGE_ICONS[step];
  return (
    <div className={`tw:px-4 tw:py-3 ${done ? "" : "tw:opacity-60"}`}>
      <div className="tw:flex tw:items-center tw:gap-3">
        <Chip icon={Icon} />
        <span className="tw:font-mono tw:text-sm tw:text-foreground">{step}</span>
        {/* `done &&` is load-bearing. The generator string comes off the tree
            and the arc, which are in hand because the article loaded — so a toc
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
      <div className="tw:mt-1.5 tw:pl-9 tw:text-xs tw:text-ink-faint">
        {done ? (
          <span className="tw:font-mono tw:break-all">{outputs.join(" · ")}</span>
        ) : (
          // The stage's own present-tense label, which reads as the thing that
          // has not happened yet rather than as a list of missing files.
          <span>{label}</span>
        )}
      </div>
    </div>
  );
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
      content={<Note>{when.toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}</Note>}
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
