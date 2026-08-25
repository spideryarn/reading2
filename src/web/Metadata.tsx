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
 * original-version/difficulty-and-reading-time.md.
 *
 * Tailwind utilities rather than a block in styles.css: this page is chrome,
 * and chrome is what Tailwind is here for
 * (docs/project/web-client.md#tailwind-and-shadcn-components). Every class needs
 * the `tw:` prefix — unprefixed names silently do nothing.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryState } from "nuqs";
import { ArrowLeft, Check, ExternalLink, Minus } from "lucide-react";
import type { Article, ArticleMetadata, StageState } from "../types.js";
import { Dock } from "./Dock.js";
import { Link } from "./Link.js";
import { atParam } from "./params.js";
import { carriedSearch, readHref } from "./router.js";
import { articleStats } from "./stats.js";

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

export function Metadata({ slug, article }: { slug: string; article: Article }) {
  const { meta, tree, arc } = article;
  const stats = useMemo(() => articleStats(article), [article]);
  const root = tree.nodes[tree.rootId];

  /**
   * Which stages have run. Not in the article payload and deliberately never
   * will be: that payload is fetched on every page, and walking the filesystem
   * for it would charge every reader for a page almost nobody opens.
   */
  const [provenance, setProvenance] = useState<ArticleMetadata | null>(null);
  const [provenanceError, setProvenanceError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
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
    };
  }, [slug]);

  /**
   * Where the reader was in the article, so this page can say — and so "back to
   * the article" goes back to the paragraph rather than to the top.
   *
   * Note what this page does NOT fetch: the comments. See Dock.tsx — the
   * Questions button is a link back to the reading view here, so nothing on
   * this page needs them, and a visit should not cost a request for them.
   */
  const [at] = useQueryState("at", atParam);
  const lastRead = at ? article.blocks.find((b) => b.id === at) : undefined;

  const backHref = readHref(slug, carriedSearch(location.search), "article");

  return (
    <>
      <main className={`tw:mx-auto tw:max-w-3xl tw:px-6 tw:pt-10 tw:font-sans ${DOCK_CLEARANCE}`}>
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
        <h1 className="tw:m-0 tw:font-serif tw:text-2xl tw:leading-snug tw:text-foreground">
          {meta.title}
        </h1>
        <p className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-muted-foreground">
          {[meta.byline, meta.siteName, meta.lang, whenFetched(meta.fetchedAt)]
            .filter(Boolean)
            .join(" · ")}
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
        <p className="tw:mt-1 tw:mb-0 tw:font-mono tw:text-xs tw:text-ink-faint">{slug}</p>

        {/* ------------------------------------------------------ 2. length -- */}
        <Section label="Length">
          <p className="tw:m-0 tw:text-sm tw:text-foreground">
            {stats.words.toLocaleString()} words · ~{stats.minutes} min ·{" "}
            {stats.blocks.toLocaleString()} blocks
          </p>
        </Section>

        {/* ------------------------------------------------------- 3. shape -- */}
        <Section label="Shape">
          <p className="tw:m-0 tw:text-sm tw:text-foreground">
            {stats.parts} parts · {stats.sections} sections · {stats.blocks.toLocaleString()}{" "}
            blocks · {stats.depth} levels deep
          </p>
          {root?.gist && (
            <p className="tw:mt-3 tw:mb-0 tw:font-serif tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint">
              {root.gist}
            </p>
          )}
          {root?.summary && (
            <p className="tw:mt-2 tw:mb-0 tw:font-serif tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint">
              {root.summary}
            </p>
          )}
          {meta.note && (
            <p className="tw:mt-3 tw:mb-0 tw:text-xs tw:text-ink-faint">{meta.note}</p>
          )}
        </Section>

        {/* ------------------------------------------ 4. what we did to it --
            Which stages have run, and the two that carry a model's name. A
            stage counts as run only when *all* of its outputs are on disk —
            src/pipeline.ts owns that rule and this page borrows it rather than
            restating it. */}
        <Section label="What we did to it">
          {provenanceError && (
            <p className="tw:m-0 tw:text-sm tw:text-destructive">{provenanceError}</p>
          )}
          {!provenanceError && provenance === null && (
            <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">Looking…</p>
          )}
          {provenance && (
            <div className="tw:overflow-x-auto">
              <table className="tw:w-full tw:border-collapse tw:text-xs">
                <tbody>
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
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* ------------------------------------------------ 5. your reading -- */}
        <Section label="Your reading">
          {lastRead ? (
            <p className="tw:m-0 tw:text-sm tw:text-ink-faint">
              Last read at{" "}
              <Link href={backHref} className="tw:text-highlight">
                “{snippet(lastRead.text)}”
              </Link>
            </p>
          ) : (
            <p className="tw:m-0 tw:text-sm tw:text-muted-foreground">
              You haven't moved off the top of this one yet.
            </p>
          )}
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
 * One section: an uppercase label and whatever goes under it.
 *
 * A component rather than markup repeated per section, which is exactly what
 * the 1,274-line panel this was borrowed from did seven times inline.
 */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="tw:mt-8 tw:border-t tw:border-border tw:pt-4">
      <h2 className="tw:m-0 tw:mb-2 tw:text-[0.68rem] tw:font-normal tw:uppercase tw:tracking-[0.09em] tw:text-ink-faint">
        {label}
      </h2>
      {children}
    </section>
  );
}

/**
 * One stage: whether it ran, what it writes, and which model wrote it.
 *
 * The file paths are the real ones — `output/<slug>.html`, not a tidier
 * `article.html`. This is the page you open to go and look at a file, and a
 * name you cannot find on disk is worse than no name.
 */
function StageRow({ stage, generator }: { stage: StageState; generator: string | undefined }) {
  const { step, label, outputs, done } = stage;
  return (
    <tr className={done ? "tw:text-ink-faint" : "tw:text-muted-foreground/60"}>
      <td className="tw:py-1.5 tw:pr-3 tw:align-top">
        {done ? (
          <Check size={13} className="tw:text-highlight" aria-label="ran" />
        ) : (
          <Minus size={13} aria-label="has not run" />
        )}
      </td>
      <td className="tw:py-1.5 tw:pr-4 tw:align-top tw:whitespace-nowrap">{step}</td>
      <td className="tw:py-1.5 tw:pr-4 tw:align-top">
        {done ? (
          <span className="tw:font-mono">{outputs.join(" · ")}</span>
        ) : (
          // The stage's own present-tense label, which reads as the thing that
          // has not happened yet rather than as a list of missing files.
          <span>{label}</span>
        )}
      </td>
      <td className="tw:py-1.5 tw:align-top tw:whitespace-nowrap tw:font-mono">
        {done ? (generator ?? "") : "not run"}
      </td>
    </tr>
  );
}

/** `fetched 25 Aug 2026`, or nothing at all if stage 2 never recorded one. */
function whenFetched(iso: string | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const when = new Date(t).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `fetched ${when}`;
}

/** Enough of a paragraph to recognise it, cut on a word boundary. */
function snippet(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= 60) return clean;
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
