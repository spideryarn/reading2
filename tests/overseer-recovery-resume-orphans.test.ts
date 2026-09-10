/**
 * Sol's G18 at the store's single write point: a resume request whose
 * candidate the recovery fold does not hold is PROJECTED as an orphan, never
 * silently dropped — and the fleet's real parser, over the file the real writer
 * wrote, reads it as published with that orphan, the records untouched.
 *
 * Plan docs/plans/260910f-gradual-recovery-resume-selected-interrupted-work-one-at-a-time.md.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { loadRecoveryFile, projectRecovery } from "../tools/fleet/recovery-feed.js";
import type { RecoveryResumeProjection } from "../tools/fleet/wire.js";
import { identityOf, sessionKey, type OverseerEvent } from "../tools/overseer/diff.js";
import type { ObservedRow } from "../tools/overseer/observation.js";
import { openStore } from "../tools/overseer/store.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const NOW = new Date("2026-09-10T16:00:00.000Z");
const GONE = "rc-0f0f0f0f0f0f0f0f0f0f";

function projection(): RecoveryResumeProjection {
  return {
    schema: 1,
    writtenAt: NOW.toISOString(),
    launcher: { kind: "wired" },
    gate: null,
    pace: { kind: "free" },
    requests: [
      {
        candidateId: GONE,
        name: GONE,
        state: { kind: "pending", position: 1, requestedAt: "2026-09-10T15:59:00.000Z", actor: "dashboard", why: "the record is no longer in the recovery index", until: null },
      },
    ],
    previews: [],
    orphans: [],
    pendingOverflow: 0,
  };
}

describe("G18: the store projects orphaned resume requests", () => {
  test("a request for a candidate the fold does not hold is listed as an orphan with its state and why, and the fleet reads it", async () => {
    const root = mkdtempSync(join(tmpdir(), "overseer-recovery-resume-orphans-"));
    roots.push(root);
    const opened = openStore({ root, now: () => NOW });
    if (!opened.ok) throw new Error("the store did not open");
    const store = opened.store;
    try {
      // One ordinary sighting, so the log is not empty and the store writes
      // recovery.json at all (store.ts § `recoveryDue`); it makes no record.
      const row: ObservedRow = {
        id: "$701",
        name: "orphan-test-session",
        execution: { kind: "unknown", cause: "not-reported", why: "written by hand for this test" },
        title: null,
        repo: "spideryarn/reading2",
        worktree: null,
        meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/srv/orphan-test" },
        startedAt: "2026-09-10T15:00:00.000Z",
        paneId: "%7",
        panePid: 7700,
        claimedConversationId: null,
        question: null,
        status: { kind: "idle" },
      };
      const seen: OverseerEvent = { kind: "session-seen", at: "2026-09-10T15:30:00.000Z", tmuxServerPid: 512077, key: sessionKey(identityOf(row)), identity: identityOf(row), row };
      store.append([seen]);
      expect(store.setRecoveryResume(projection())).toBe(true);
      expect(store.checkpoint({ lastGoodSnapshotAt: null, tick: false }).ok).toBe(true);
    } finally {
      store.close();
    }
    const feed = projectRecovery(await loadRecoveryFile(root), NOW.toISOString());
    if (feed.kind !== "published") throw new Error(`the feed is ${feed.kind}: ${JSON.stringify(feed)}`);
    expect(feed.total).toBe(0);
    if (feed.resume.kind !== "published") throw new Error(`the resume section is ${feed.resume.kind}: ${JSON.stringify(feed.resume)}`);
    expect(feed.resume.projection.requests).toEqual([]);
    expect(feed.resume.projection.orphans).toEqual([
      {
        candidateId: GONE,
        state: expect.objectContaining({ kind: "pending", requestedAt: "2026-09-10T15:59:00.000Z" }),
        why: expect.stringContaining("no longer holds"),
      },
    ]);
  });
});
