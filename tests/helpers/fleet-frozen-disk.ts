/**
 * A disk which can stop at one named append and silently drop everything later.
 *
 * Extracted from `tests/fleet-receipt-restart.test.ts` for the direct-steer
 * crash tests (plan 260910d, Stage 2). A crash is a disk that stops accepting
 * bytes, not an exception: exceptions run catch/finally code which a dead
 * process never reaches. `throw` is kept as a separate mode for the tests that
 * want a detected write failure rather than a crash.
 *
 * `isFrozen()` is for a fake transport: a dead process types nothing, so a
 * transport consulted after the freeze must record nothing either.
 */
import { writeSync } from "node:fs";

export type StoreName = "holds" | "receipts";
type RecordLabel = { store: StoreName; kind: string; receiptId: string | null };
export type FrozenDiskRule = {
  store: StoreName;
  kind: string;
  receiptId?: string | undefined;
  mode: "before" | "after" | "torn" | "throw" | "unreadable" | "malformed";
};

export class FrozenDisk {
  private rule: FrozenDiskRule | null = null;
  private frozen = new Set<StoreName>();

  arm(rule: FrozenDiskRule): void {
    this.rule = rule;
  }

  freeze(store?: StoreName): void {
    if (store === undefined) {
      this.frozen.add("holds");
      this.frozen.add("receipts");
    } else {
      this.frozen.add(store);
    }
  }

  /** True once every store is frozen — the simulated process is dead. */
  isFrozen(): boolean {
    return this.frozen.has("holds") && this.frozen.has("receipts");
  }

  writer(store: StoreName): (fd: number, line: string) => void {
    return (fd, line) => {
      if (this.frozen.has(store)) return;
      const label = this.label(store, line);
      const rule = this.rule;
      const matches =
        rule !== null &&
        rule.store === label.store &&
        rule.kind === label.kind &&
        (rule.receiptId === undefined || rule.receiptId === label.receiptId);
      if (!matches || rule === null) {
        writeSync(fd, line);
        return;
      }
      this.rule = null;
      switch (rule.mode) {
        case "before":
          this.freeze();
          return;
        case "after":
          writeSync(fd, line);
          this.freeze();
          return;
        case "torn":
          writeSync(fd, line.slice(0, Math.max(1, line.length - 9)));
          this.freeze();
          return;
        case "throw":
          throw new Error(`disk full while writing ${store} ${label.kind}`);
        case "unreadable": {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          writeSync(fd, `${JSON.stringify({ ...parsed, at: "not-a-number" })}\n`);
          return;
        }
        case "malformed":
          writeSync(fd, "these bytes are not json\n");
          return;
        default: {
          const never: never = rule.mode;
          throw new Error(`unknown frozen-disk mode ${String(never)}`);
        }
      }
    };
  }

  private label(store: StoreName, line: string): RecordLabel {
    const parsed = JSON.parse(line) as { kind?: unknown; receiptId?: unknown };
    return {
      store,
      kind: typeof parsed.kind === "string" ? parsed.kind : "unreadable",
      receiptId: typeof parsed.receiptId === "string" ? parsed.receiptId : null,
    };
  }
}
