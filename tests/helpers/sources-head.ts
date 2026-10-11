/**
 * **Sources' chip row, for a test that draws one panel on its own** — the
 * header `SourcesBand` hands BibliographyPanel, NotCitedPanel, LinksPanel and
 * ReceptionAndClaimsPanel, built from the same selectors (sources-counts.ts), so a
 * panel test that presses a chip or reads its count is testing the row a
 * reader gets. docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md.
 */
import { createElement, type ReactElement } from "react";
import type { PublicReception, PublicSourcesClaimList } from "../../src/public-types.js";
import type {
  Reception,
  RelatedWorkResult,
  SourcesClaimsBears,
  SourcesClaimCheck,
  SourcesClaimList,
} from "../../src/types.js";
import { SourcesViews } from "../../src/web/modes/sources/SourcesMode.js";
import type { SourcesView } from "../../src/web/params.js";
import { checkedSources, listedClaims, sourcesCounts } from "../../src/web/sources-counts.js";

export function sourcesHead(args: {
  view: SourcesView;
  onView(view: SourcesView): void;
  /** The owner's slug, so a press arms; `null` for a visitor. */
  ownerSlug: string | null;
  works?: readonly unknown[] | null;
  /** Not cited's answer (useRelatedWork.ts); none unless a test gives one. */
  notCited?: RelatedWorkResult | null;
  /** Links' rows (outbound-links.ts); none unless a test gives some. */
  links?: readonly unknown[];
  reception?: Reception | PublicReception | null;
  /** The owner's claims-list hook, or a visitor's list. */
  claimList?:
    | { kind: "owner"; status: string; claimList: SourcesClaimList | null; checks?: readonly SourcesClaimCheck[] }
    | { kind: "visitor"; claimList: PublicSourcesClaimList | null };
  relevance?: SourcesClaimsBears | null;
  thread?: string | null;
}): ReactElement {
  const list = args.claimList ?? { kind: "visitor", claimList: null };
  const checked =
    list.kind === "owner" && list.status === "ready" ? checkedSources(list.checks ?? [], list.claimList) : 0;
  const counts = sourcesCounts({
    works: args.works ?? null,
    notCited: args.notCited ?? null,
    links: args.links ?? [],
    reception: args.reception ?? null,
    listed: listedClaims(list.kind === "owner" ? { kind: "owner", status: list.status, claimList: list.claimList } : list),
    checked,
    relevance: args.relevance ?? null,
    thread: args.thread ?? null,
  });
  return createElement(SourcesViews, { view: args.view, counts, ownerSlug: args.ownerSlug, onView: args.onView });
}
