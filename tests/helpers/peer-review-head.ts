/**
 * **Peer review's chip row, for a test that draws one panel on its own** — the
 * header `PeerReviewBand` hands CitationsPanel and DebatePanel since
 * 2026-10-09, built from the same selectors (peer-review-counts.ts), so a
 * panel test that presses a chip or reads its count is testing the row a
 * reader gets. docs/plans/261009l-peer-review-mode-merges-citations-and-debate.md.
 */
import { createElement, type ReactElement } from "react";
import type { PublicDebate, PublicDebateClaimList } from "../../src/public-types.js";
import type { Debate, DebateBears, DebateClaimCheck, DebateClaimList } from "../../src/types.js";
import { PeerReviewViews } from "../../src/web/modes/peer-review/PeerReviewMode.js";
import type { PeerReviewView } from "../../src/web/params.js";
import { checkedSources, listedClaims, peerReviewCounts } from "../../src/web/peer-review-counts.js";

export function peerReviewHead(args: {
  view: PeerReviewView;
  onView(view: PeerReviewView): void;
  /** The owner's slug, so a press arms; `null` for a visitor. */
  ownerSlug: string | null;
  works?: readonly unknown[] | null;
  debate?: Debate | PublicDebate | null;
  /** The owner's claims-list hook, or a visitor's list. */
  claimList?:
    | { kind: "owner"; status: string; claimList: DebateClaimList | null; checks?: readonly DebateClaimCheck[] }
    | { kind: "visitor"; claimList: PublicDebateClaimList | null };
  relevance?: DebateBears | null;
  thread?: string | null;
}): ReactElement {
  const list = args.claimList ?? { kind: "visitor", claimList: null };
  const checked =
    list.kind === "owner" && list.status === "ready" ? checkedSources(list.checks ?? [], list.claimList) : 0;
  const counts = peerReviewCounts({
    works: args.works ?? null,
    debate: args.debate ?? null,
    listed: listedClaims(list.kind === "owner" ? { kind: "owner", status: list.status, claimList: list.claimList } : list),
    checked,
    relevance: args.relevance ?? null,
    thread: args.thread ?? null,
  });
  return createElement(PeerReviewViews, { view: args.view, counts, ownerSlug: args.ownerSlug, onView: args.onView });
}
