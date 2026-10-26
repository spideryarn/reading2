/**
 * **Sources › Not cited** — papers close to this piece that are not among the
 * works Spideryarn found in its bibliography, from OpenAlex, for the owner.
 *
 * ```
 *  ┌ Bibliography 42 │ Not cited 18 │ Links 61 │ Reception 3 │ Claims 8 ┐  (i)
 *  │ 18 papers found by OpenAlex's search on this piece's title and opening, …
 *  │ None of these is among the works Spideryarn found in this piece's
 *  │ bibliography. Whether any of them belongs in it is yours to judge.
 *  │  Non-Autoregressive Neural Machine Translation ↗
 *  │  Gu, Bradbury, Xiong +2 more · 2017 · ICLR · cited 506 times
 *  │  Existing approaches to neural machine translation condition…   (its abstract)
 *  │  [Search again]  This sends the piece's title and the opening…
 * ```
 *
 * The research behind it (261009b § Ideas, item 3): *"work on the same
 * question that the piece does not cite … every suggestion must say why it is
 * relevant, and the reviewer decides."* Here the *why* is facts the reader can
 * check — OpenAlex's rank, and the work's own abstract — and the framing says,
 * once, that the reader decides. A row never says "not cited" or "should
 * cite" (the plan's F4). Plan
 * docs/plans/261011ac-sources-not-cited-related-work-it-leaves-out.md.
 *
 * **Nothing is sent until the owner presses** (F1): the opening read is
 * useRelatedWork.ts's GET, which never asks OpenAlex, and *Search OpenAlex for
 * related work* says, under it, what it sends. The button is held from the
 * press until the answer is read.
 *
 * **The piece's own editions and its authors' other work are two groups under
 * the list, never hidden** (plan 261025h, decision 3): *Other editions of this
 * piece* when the server found a version of its title or identifier, *By the
 * same authors* when it found only the authors. Neither is in the list's count
 * nor on the chip, which counts the ordinary rows (src/web/sources-counts.ts).
 *
 * **OpenAlex's strings are a stranger's text** (docs/project/security-map.md):
 * drawn as text, never as markup, and in the app's face, as Reception's *Cited
 * by* rows are (docs/project/fonts.md § third-party text is left UI). Every
 * link is built by `citerUrl` from the shape-checked DOI or `W` id, never
 * taken from the answer.
 */
import { ExternalLink, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { citerUrl } from "../citer-link.js";
import {
  citedTimes,
  RELATED_WORK_ABOUT,
  RELATED_WORK_BIBLIOGRAPHY_CAPPED,
  RELATED_WORK_BIBLIOGRAPHY_STALE,
  RELATED_WORK_EDITIONS,
  RELATED_WORK_EDITIONS_NOTE,
  RELATED_WORK_INTRO,
  RELATED_WORK_LOADING,
  RELATED_WORK_NO_BIBLIOGRAPHY,
  RELATED_WORK_NO_QUERY,
  RELATED_WORK_NOT_SEARCHED,
  RELATED_WORK_QUERY_CHANGED,
  RELATED_WORK_RATE_LIMITED,
  RELATED_WORK_SAME_AUTHORS,
  RELATED_WORK_SAME_AUTHORS_NOTE,
  RELATED_WORK_SEARCH,
  RELATED_WORK_SEARCH_AGAIN,
  RELATED_WORK_SEARCHING,
  RELATED_WORK_SENDS,
  RELATED_WORK_UNAVAILABLE,
  relatedWorkLines,
} from "../messages.js";
import { MODE_LABEL } from "../title-text.js";
import type { RelatedWork, RelatedWorkResult } from "../types.js";
import { ModeSurface } from "./ModeSurface.js";
import { dayOf } from "./relative-time.js";
import type { UseRelatedWork } from "./useRelatedWork.js";

/** Authors named on a row before *+N more*. */
const AUTHORS_SHOWN = 3;

export function NotCitedPanel({ related, head }: { related: UseRelatedWork; head: ReactNode }) {
  return (
    <ModeSurface
      label={MODE_LABEL.sources}
      feature="gloss not-cited sources"
      mode="sources"
      about={<p>{RELATED_WORK_ABOUT}</p>}
      head={head}
    >
      <div className="tl-scroll rcp-related">
        {related.result === null ? (
          <p className="rcp-citers-note" role="status">
            <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" /> {RELATED_WORK_LOADING}
          </p>
        ) : (
          <Answer result={related.result} related={related} />
        )}
      </div>
    </ModeSurface>
  );
}

/** One outcome, as its sentence (and its press) or its list. The `never` makes a new outcome a type error here. */
function Answer({ result, related }: { result: RelatedWorkResult; related: UseRelatedWork }) {
  switch (result.kind) {
    case "no-bibliography":
      return <p className="rcp-citers-note">{RELATED_WORK_NO_BIBLIOGRAPHY}</p>;
    case "no-query":
      return <p className="rcp-citers-note">{RELATED_WORK_NO_QUERY}</p>;
    case "not-searched":
      return (
        <>
          <p className="rcp-citers-note">{RELATED_WORK_NOT_SEARCHED}</p>
          <SearchPress related={related} label={RELATED_WORK_SEARCH} />
        </>
      );
    case "unavailable":
      return (
        <div className="rcp-citers-retry">
          <p className="rcp-citers-note">{RELATED_WORK_UNAVAILABLE}</p>
          <Button type="button" variant="outline" size="sm" disabled={related.searching} onClick={related.retry}>
            {related.searching ? RELATED_WORK_SEARCHING : "Try again"}
          </Button>
        </div>
      );
    case "rate-limited":
      return <p className="rcp-citers-note">{RELATED_WORK_RATE_LIMITED}</p>;
    case "found":
      return <Found found={result} related={related} />;
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

/**
 * **The press, and what it sends, always together** (F1): the line under the
 * button is the only place the reader learns this piece's words leave for
 * OpenAlex, so it is never drawn without it.
 */
function SearchPress({ related, label }: { related: UseRelatedWork; label: string }) {
  return (
    <div className="rcp-related-press">
      <Button type="button" variant="outline" size="sm" disabled={related.searching} onClick={related.search}>
        {related.searching && <LoaderCircle size={13} className="cmt-spinner" aria-hidden="true" />}
        {related.searching ? RELATED_WORK_SEARCHING : label}
      </Button>
      <p className="rcp-citers-note">{RELATED_WORK_SENDS}</p>
    </div>
  );
}

function Found({ found, related }: { found: Extract<RelatedWorkResult, { kind: "found" }>; related: UseRelatedWork }) {
  const listed = found.works.length;
  return (
    <>
      {related.failed !== null && (
        <div className="rcp-citers-retry" role="status">
          <p className="rcp-citers-note">
            {related.failed === "unavailable" ? RELATED_WORK_UNAVAILABLE : RELATED_WORK_RATE_LIMITED}
          </p>
        </div>
      )}
      {found.queryChanged && <p className="rcp-citers-note">{RELATED_WORK_QUERY_CHANGED}</p>}
      {listed > 0 && found.bibliographyStale && (
        <p className="rcp-citers-note rcp-related-warn">{RELATED_WORK_BIBLIOGRAPHY_STALE}</p>
      )}
      {listed > 0 && found.bibliographyCapped && (
        <p className="rcp-citers-note rcp-related-warn">{RELATED_WORK_BIBLIOGRAPHY_CAPPED}</p>
      )}
      <p className="rcp-citers-note">
        {relatedWorkLines({ listed, excluded: found.excluded, yearLimited: found.yearLimited }, dayOf(found.searchedAt)).join(
          " ",
        )}
      </p>
      {listed > 0 && (
        <>
          <p className="rcp-citers-note">{RELATED_WORK_INTRO}</p>
          <ul className="rcp-citers-list">
            {found.works.map((work) => (
              <RelatedRow key={work.openalexId} work={work} />
            ))}
          </ul>
        </>
      )}
      <Group works={found.editions} title={RELATED_WORK_EDITIONS} note={RELATED_WORK_EDITIONS_NOTE} kind="editions" />
      <Group works={found.sameAuthors} title={RELATED_WORK_SAME_AUTHORS} note={RELATED_WORK_SAME_AUTHORS_NOTE} kind="same-authors" />
      <SearchPress related={related} label={RELATED_WORK_SEARCH_AGAIN} />
    </>
  );
}

/** One of the two groups under the list, with its heading and what it claims — or nothing when it is empty. */
function Group({
  works,
  title,
  note,
  kind,
}: {
  works: readonly RelatedWork[] | undefined;
  title: string;
  note: string;
  kind: "editions" | "same-authors";
}) {
  if (works === undefined || works.length === 0) return null;
  return (
    <section className="rcp-related-group" data-group={kind} aria-label={title}>
      <h3 className="rcp-related-group-title">
        {title} <span className="rcp-meta">{works.length}</span>
      </h3>
      <p className="rcp-citers-note">{note}</p>
      <ul className="rcp-citers-list">
        {works.map((work) => (
          <RelatedRow key={work.openalexId} work={work} />
        ))}
      </ul>
    </section>
  );
}

/** *Vaswani, Shazeer, Parmar +5 more* — the first few, and how many more OpenAlex lists. */
export function relatedAuthors(work: Pick<RelatedWork, "authors" | "authorCount">): string | null {
  if (work.authors.length === 0) return null;
  const shown = work.authors.slice(0, AUTHORS_SHOWN);
  const more = Math.max(work.authorCount, work.authors.length) - shown.length;
  return more > 0 ? `${shown.join(", ")} +${more} more` : shown.join(", ");
}

function RelatedRow({ work }: { work: RelatedWork }) {
  const url = citerUrl(work);
  const facts = [
    relatedAuthors(work),
    work.year ?? null,
    work.venue ?? null,
    work.citedByCount !== undefined ? citedTimes(work.citedByCount) : null,
  ].filter((fact) => fact !== null);
  return (
    <li className="rcp-citer rcp-related-row" data-openalex={work.openalexId}>
      {url !== null ? (
        <a
          className="rcp-citer-title"
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`${work.title} — opens in a new tab`}
        >
          {work.title}
          <ExternalLink size={11} aria-hidden="true" />
        </a>
      ) : (
        <span className="rcp-citer-title">{work.title}</span>
      )}
      {facts.length > 0 && <p className="rcp-meta">{facts.join(" · ")}</p>}
      {work.abstract !== undefined && <p className="rcp-related-abstract">{work.abstract}</p>}
    </li>
  );
}
