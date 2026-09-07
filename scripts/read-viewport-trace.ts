/**
 * **Turn a phone's viewport trace into the arithmetic decision it is supposed to make.**
 *
 *     npx tsx scripts/read-viewport-trace.ts trace.json
 *     npx tsx scripts/read-viewport-trace.ts trace.json --profile=no-composer
 *
 * Stage 4 of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md.
 * `src/web/ViewportProbe.tsx` (`?probe=1`, and already in production) records
 * what a real phone does while its keyboard opens. This prints what the file
 * says. **The analysis is in [`viewport-trace.ts`](viewport-trace.ts)** and its
 * tests are `tests/viewport-trace.test.ts`; this file is printing and exit
 * codes, so the thinking is callable by something other than itself.
 *
 * The three questions it answers, none of which this box can answer without a
 * phone: whether anything a reader must reach is outside the visible strip;
 * whether the keyboard **shrank** that strip from the bottom (so a `bottom:`
 * rule is the right shape) or **panned** it (so no `bottom:` rule reaches the
 * band's head at all — GPT Sol's F1, still open); and `max(base, inset)` against
 * `base + inset`, computed per sample rather than argued.
 *
 * **It decides nothing and contains no fix.** The plan's rule stands: no
 * viewport-fit arithmetic is chosen until a real trace has been read.
 *
 * ## Exit codes, which are the point of the command rather than decoration
 *
 * - **0** — the trace answered the question: `DEFECT` or `CLEAN`.
 * - **3** — `INCONCLUSIVE`. No chronological closed→open episode, no `mark`
 *   taken while the keyboard was up, no editor focused at that endpoint, a
 *   missing rectangle the profile requires, or **any** sample that failed
 *   validation. **This is not a softer "clean"**, and the non-zero code is so
 *   that nothing downstream reads silence as success.
 * - **2** — the file could not be read: missing, not JSON, not from this probe,
 *   no samples, every sample malformed, or out of time order.
 *
 * `tests/viewport-trace.test.ts` runs this as a subprocess for each of those,
 * because the codes are a contract and none of the analysis tests touch them —
 * Sol's third mutation, which is the one that was not caught: turning the
 * inconclusive return into `0` left all 23 analysis tests green.
 *
 * ## § anchor — the one derived check worth more than the columns
 *
 * `.mode-band` is `position: fixed` with a known `bottom:`, so if rectangles are
 * measured against the **layout** viewport then `band.y + band.height` must come
 * back as `innerHeight − clearance` in every sample. That equation is the
 * premise the whole fix rests on, stated in numbers rather than quoted from a
 * spec, and it is printed whether it holds or not.
 */
import {
  CHAT,
  NO_COMPOSER,
  additiveCollapses,
  anchorVerdict,
  chronology,
  classify,
  hiddenFor,
  parseTrace,
  readSample,
  verdictOf,
  type Profile,
  type Reading,
} from "./viewport-trace.js";

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}
function rpad(s: string, n: number): string {
  return s.length >= n ? s : " ".repeat(n - s.length) + s;
}
function cell(v: number | null): string {
  return v === null ? "-" : String(v);
}

function table(readings: readonly Reading[], profile: Profile): readonly string[] {
  const interesting = readings.filter(
    (r) =>
      r.sample.ev === "mark" ||
      r.sample.ev === "start" ||
      r.bottomInset > 0 ||
      r.offsetTop > 0 ||
      profile.reach.some(
        (k) => (hiddenFor(r, k, "below") ?? 0) > 0 || (hiddenFor(r, k, "above") ?? 0) > 0,
      ),
  );
  if (interesting.length === 0) return [];
  const out = [
    "",
    `${pad("t(ms)", 8)}${pad("ev", 8)}${rpad("inset", 7)}${rpad("offTop", 8)}${rpad("base", 6)}${rpad("max()", 7)}${rpad("plus", 7)}${rpad("head↑", 7)}${rpad("comp↓", 7)}  focus`,
  ];
  for (const r of interesting) {
    out.push(
      pad(String(r.sample.t), 8) +
        pad(r.sample.ev + (r.usable ? "" : "*"), 8) +
        rpad(String(r.bottomInset), 7) +
        rpad(String(r.offsetTop), 8) +
        rpad(cell(r.baseClearance), 6) +
        rpad(cell(r.candidateMax), 7) +
        rpad(cell(r.candidatePlus), 7) +
        rpad(cell(hiddenFor(r, "head", "above")), 7) +
        rpad(cell(hiddenFor(r, "composer", "below")), 7) +
        `  ${r.sample.of["focus"] ?? "—"}`,
    );
  }
  out.push("  * = not usable for arithmetic (no visualViewport, or pinched away from scale 1)");
  out.push(
    "  head↑ / comp↓ = pixels outside the visible strip; `-` means the probe recorded NO rectangle, which is not zero",
  );
  return out;
}

const PROFILES: Readonly<Record<string, Profile>> = {
  chat: CHAT,
  "no-composer": NO_COMPOSER,
};

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const path = args.find((a) => !a.startsWith("--"));
  const wanted = args.find((a) => a.startsWith("--profile="))?.slice("--profile=".length) ?? "chat";
  const profile = PROFILES[wanted];
  if (!path || !profile) {
    console.log("usage: npx tsx scripts/read-viewport-trace.ts <trace.json> [--profile=chat|no-composer]");
    console.log(
      "  the analysis is scripts/viewport-trace.ts; its tests are tests/viewport-trace.test.ts",
    );
    if (path && !profile) console.log(`  (no profile called ${JSON.stringify(wanted)})`);
    return 2;
  }

  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    /* Caught here rather than left to the rejection handler, which exits 1 and
       would contradict the contract above. Sol found the mismatch. */
    console.log(`${path}: cannot read — ${String(e)}`);
    return 2;
  }

  const parsed = parseTrace(raw);
  if (parsed.fatal !== null) {
    console.log(`${path}: ${parsed.fatal}`);
    console.log("Nothing to report — this is NOT a clean result.");
    return 2;
  }

  const readings = parsed.samples.map(readSample);
  const chron = chronology(readings);
  const motion = classify(chron);
  const verdict = verdictOf(chron, motion, profile, parsed.rejected);

  console.log(
    `samples: ${parsed.samples.length} read, ${readings.filter((r) => r.usable).length} usable at scale 1  ·  profile: ${profile.name}`,
  );
  if (parsed.rejected.length > 0) {
    console.log(
      `REJECTED ${parsed.rejected.length} malformed sample(s) — a newer probe, or a truncated paste. The decision is inconclusive because of them:`,
    );
    for (const r of parsed.rejected.slice(0, 5)) console.log(`  sample ${r.index}: ${r.why}`);
    if (parsed.rejected.length > 5) console.log(`  … and ${parsed.rejected.length - 5} more`);
  }
  const modes = [...new Set(parsed.samples.map((s) => s.dm))].filter(Boolean);
  console.log(`display-mode: ${modes.join(", ") || "(none recorded)"}`);
  console.log(
    `episodes: ${chron.cycles.length} closed→open, ${chron.cycles.filter((c) => c.settled).length} with a settled mark`,
  );
  if (chron.orphans.length > 0)
    console.log(
      `  ${chron.orphans.length} moved sample(s) precede any keyboard-closed frame and are ignored — the probe's \`clear\` empties the list without a new \`start\`, so this is ordinary`,
    );
  if (chron.resized)
    console.log(
      "  WARNING: the layout viewport's height changed mid-trace — a rotation, or an engine that resizes it. Episodes either side are not comparable.",
    );

  const anchor = anchorVerdict(readings);
  console.log(
    !anchor.known
      ? "anchor: cannot check — no sample has both a band rectangle and all three tokens."
      : anchor.holds
        ? `anchor: CONFIRMED layout-anchored — band.bottom tracks innerHeight − clearance within ${Math.abs(anchor.worst)}px across ${anchor.n} samples.`
        : `anchor: NOT layout-anchored as assumed — worst disagreement ${anchor.worst}px over ${anchor.n} samples. The premise the whole fix rests on does not hold; stop and re-read before choosing any arithmetic.`,
  );

  console.log("");
  console.log(`motion: ${motion.motion.toUpperCase()} — ${motion.why}`);
  console.log(
    motion.bottomRuleSuffices
      ? "  ⇒ a bottom-anchored rule can address this."
      : "  ⇒ do NOT pick bottom-only arithmetic on this trace.",
  );
  if (motion.transientClipping)
    console.log(
      "  note: the head was clipped above in at least one frame while the keyboard was SLIDING. Reported, not decided on — the reader never held still there.",
    );

  console.log("");
  console.log(`VERDICT: ${verdict.which.toUpperCase()} — ${verdict.why}`);

  for (const line of table(readings, profile)) console.log(line);

  const collapses = additiveCollapses(readings);
  console.log("");
  console.log(
    collapses.length === 0
      ? "max vs +: no usable sample collapses the band under `base + inset`. `+` is not disproved BY THIS TRACE; prefer `max` on the reasoning in the plan (Sol F2), not on this file."
      : `max vs +: ${collapses.length} usable sample(s) would leave the band zero or negative height under \`base + inset\`. The additive form is disproved by measurement, not only by argument.`,
  );

  return verdict.which === "inconclusive" ? 3 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.log(String(e));
    process.exitCode = 1;
  },
);
