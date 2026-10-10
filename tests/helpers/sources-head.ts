/**
 * **Sources' chip row, for a test that draws one panel on its own** — the
 * header `SourcesBand` hands BibliographyPanel and ReceptionAndClaimsPanel since
 * 2026-10-09, built from the same selectors (sources-counts.ts), so a
 * panel test that presses a chip or reads its count is testing the row a
 * reader gets. docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md.
 */
import { createElement, type ReactElement } from "react";
import type { PublicReception, PublicSourcesClaimList } from "../../src/public-types.js";
import type { Reception, SourcesClaimsBears, SourcesClaimCheck, SourcesClaimList } from "../../src/types.js";
import { SourcesViews } from "../../src/web/modes/sources/SourcesMode.js";
import type { SourcesView } from "../../src/web/params.js";
import { checkedSources, listedClaims, sourcesCounts } from "../../src/web/sources-counts.js";

export function sourcesHead(args: {
  view: SourcesView;
  onView(view: SourcesView): void;
  /** The owner's slug, so a press arms; `null` for a visitor. */
  ownerSlug: string | null;
  works?: readonly unknown[] | null;
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
    reception: args.reception ?? null,
    listed: listedClaims(list.kind === "owner" ? { kind: "owner", status: list.status, claimList: list.claimList } : list),
    checked,
    relevance: args.relevance ?? null,
    thread: args.thread ?? null,
  });
  return createElement(SourcesViews, { view: args.view, counts, ownerSlug: args.ownerSlug, onView: args.onView });
}
