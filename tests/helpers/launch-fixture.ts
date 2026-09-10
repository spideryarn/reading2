/**
 * One launch attempt's artefact directory, the way the protocol leaves it just
 * before it invokes a launcher: `<root>/launches/o/<occurrenceId>/material.txt`
 * and `…/a<n>/`, 0700, with a valid `intent.json` in it and nothing else.
 *
 * Built from Stage 1's own id functions and intent writer, so a test that
 * passes against this fixture passes against the directory the real protocol
 * writes — the writers in Stage 2 have to round-trip through that reader.
 */
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeIntentFile, type LaunchIntent } from "../../tools/overseer/launch-artefacts.js";
import { correlationIdOf, occurrenceIdOf, pinOf, recoveryOrigin, type CorrelationId, type LauncherKind, type RunSpec } from "../../tools/overseer/launch-protocol.js";
import { MATERIAL_FILE } from "../../tools/overseer/launch-store.js";

let counter = 0;

export type LaunchFixture = {
  readonly root: string;
  readonly dir: string;
  /** The occurrence's pinned material, where the store keeps it: the attempt directory's parent. */
  readonly materialPath: string;
  readonly correlationId: CorrelationId;
  readonly intent: LaunchIntent;
};

export const FIXTURE_RUN: RunSpec = { timeoutMinutes: 30, access: "review", account: "pool-test" };

export function makeLaunchDir(
  options: { readonly parent?: string; readonly launcherKind?: LauncherKind; readonly attempt?: number; readonly material?: string; readonly run?: RunSpec } = {},
): LaunchFixture {
  const root = options.parent ?? mkdtempSync(join(tmpdir(), "launch-fixture-"));
  counter += 1;
  const id = occurrenceIdOf(recoveryOrigin(`fixture-${process.pid}-${Date.now()}-${counter}`));
  const attempt = options.attempt ?? 1;
  const occurrenceDir = join(root, "launches", "o", id);
  const dir = join(occurrenceDir, `a${attempt}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(occurrenceDir, 0o700);
  chmodSync(dir, 0o700);
  const bytes = Buffer.from(options.material ?? "p", "utf8");
  const materialPath = join(occurrenceDir, MATERIAL_FILE);
  writeFileSync(materialPath, bytes, { mode: 0o600 });
  const launcherKind = options.launcherKind ?? "headless";
  const correlationId = correlationIdOf(id, attempt);
  const intent: LaunchIntent = {
    v: 1,
    kind: "intent",
    correlationId,
    occurrenceId: id,
    attempt,
    launcherKind,
    material: pinOf(bytes),
    run: launcherKind === "tmux" ? null : (options.run ?? FIXTURE_RUN),
    bootId: null,
    at: new Date().toISOString(),
  };
  writeIntentFile(dir, intent);
  return { root, dir, materialPath, correlationId, intent };
}

/** A parent directory whose name is hostile to every shell layer: a space, a quote, and a command substitution that must never run. */
export function hostileParent(): string {
  const base = mkdtempSync(join(tmpdir(), "launch-hostile-"));
  const parent = join(base, "it's a $(touch pwned) dir");
  mkdirSync(parent, { recursive: true });
  return parent;
}
