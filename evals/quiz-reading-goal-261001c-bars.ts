/**
 * The eight bars of docs/plans/261001c-quiz-adapts-heavily-to-the-reader-profile-and-reading-goal.md
 * § How we will know, checked against one judge's labels — run once per judge;
 * a bar holds only if it holds under both. Bar 8 (reading every question) is a
 * person's, not this script's.
 *
 *   npx tsx evals/quiz-reading-goal-261001c-bars.ts evals/results/quiz-reading-goal/blind-261001c/judge1
 *   npx tsx evals/quiz-reading-goal-261001c-bars.ts evals/results/quiz-reading-goal/blind-261001c-r2/judge3 r2
 */
import fs from "node:fs";
import path from "node:path";

const SLUG = "entropy-24-00930-spya-pywwkq";
const RESULTS = path.join(import.meta.dirname, "results", "quiz-reading-goal");
const dir = process.argv[2];
if (!dir) throw new Error("name a judge's directory (key.tsv + labels.tsv)");
/** Which round of wording is "after": `new` (the first) or `r2` (the second). Bar 1 always reads `new-none`. */
const NEW = process.argv[3] ?? "new";

const rows = (f: string) =>
  fs.readFileSync(path.join(dir, f), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t").map((c) => c.trim()));
const armOf = new Map(rows("key.tsv").map((r) => [r[0], r[1]]));
type Label = { GOAL: string; TOPIC: string; KIND: string; BACKGROUND: string; CENTRAL: string };
const byArm = new Map<string, Label[]>();
for (const r of rows("labels.tsv")) {
  const arm = armOf.get(r[0]);
  if (!arm) throw new Error(`unknown id ${r[0]}`);
  const [, GOAL = "", TOPIC = "", KIND = "", BACKGROUND = "", CENTRAL = ""] = r;
  byArm.set(arm, [...(byArm.get(arm) ?? []), { GOAL, TOPIC, KIND, BACKGROUND, CENTRAL }]);
}
const L = (arm: string) => {
  const l = byArm.get(arm);
  if (!l) throw new Error(`no labels for ${arm}`);
  return l;
};
const count = (arm: string, f: (x: Label) => boolean) => L(arm).filter(f).length;
const share = (arm: string, f: (x: Label) => boolean) => (100 * count(arm, f)) / L(arm).length;
const runs = (p: string) => [`${p}-1`, `${p}-2`];
const pct = (n: number) => `${Math.round(n)}%`;

/** Part-7 proxy, as `report` counts it. */
function part7(arm: string): number {
  const f = JSON.parse(fs.readFileSync(path.join(RESULTS, arm, `${SLUG}.json`), "utf8")) as {
    order: string[];
    parts: { range: [string, string] }[];
    questions: { evidence: string[] }[];
  };
  const lo = f.order.indexOf(f.parts[6]!.range[0]);
  const hi = f.order.indexOf(f.parts[6]!.range[1]);
  return f.questions.filter((q) => {
    const inT = q.evidence.filter((id) => {
      const at = f.order.indexOf(id);
      return at >= lo && at <= hi;
    }).length;
    return inT * 2 > q.evidence.length;
  }).length;
}

const verdicts: [string, boolean, string][] = [];
const bar = (name: string, ok: boolean, detail: string) => verdicts.push([name, ok, detail]);
const goalOn = (x: Label) => x.GOAL === "ON";

// 1. No profile unchanged.
{
  const old = runs("old-none");
  const g = old.map((a) => count(a, goalOn));
  const p = old.map(part7);
  const ok = runs("new-none").every((a) => {
    const gn = count(a, goalOn);
    const pn = part7(a);
    const c = L(a);
    return (
      gn >= Math.min(...g) - 2 && gn <= Math.max(...g) + 2 && pn >= Math.min(...p) - 2 && pn <= Math.max(...p) + 2 &&
      c.some((x) => x.CENTRAL === "OVERALL") && c.some((x) => x.CENTRAL === "SUPPORT")
    );
  });
  const show = (a: string) =>
    `${a}: GOAL ${count(a, goalOn)}/${L(a).length}, part7 ${part7(a)}, OVERALL ${count(a, (x) => x.CENTRAL === "OVERALL")}, SUPPORT ${count(a, (x) => x.CENTRAL === "SUPPORT")}`;
  bar("1 no profile unchanged", ok, [...old, ...runs("new-none")].map(show).join("; "));
}
// 2. About moves the pitch.
{
  const ref = [...runs("old-none"), ...runs("new-none"), ...runs("old-aboutA")];
  const bg = (a: string) => count(a, (x) => x.BACKGROUND === "YES");
  const floor = Math.min(...ref.map(bg));
  const ok = runs(`${NEW}-aboutA`).every((a) => bg(a) <= floor - 2);
  bar("2 About moves the pitch", ok, [...ref, ...runs(`${NEW}-aboutA`)].map((a) => `${a} ${bg(a)}`).join(", "));
}
// 3. About moves the parts.
{
  const fd = (x: Label) => x.TOPIC === "FINDINGS" || x.TOPIC === "DATA";
  const hi = Math.max(...runs("old-aboutA").map((a) => share(a, fd)));
  const ok = runs(`${NEW}-aboutA`).every((a) => share(a, fd) >= hi + 15);
  bar("3 About moves the parts", ok, [...runs("old-none"), ...runs("new-none"), ...runs("old-aboutA"), ...runs(`${NEW}-aboutA`)].map((a) => `${a} ${pct(share(a, fd))}`).join(", "));
}
// 4. The goal moves the kind.
{
  const apply = (x: Label) => x.KIND === "APPLY";
  const hi = Math.max(...[...runs("old-none"), ...runs("new-none")].map((a) => share(a, apply)));
  const ok = runs(`${NEW}-goal`).every((a) => share(a, apply) >= hi + 20);
  bar("4 goal moves the kind", ok, [...runs("old-none"), ...runs("new-none"), ...runs("old-goal"), ...runs(`${NEW}-goal`)].map((a) => `${a} ${pct(share(a, apply))}`).join(", "));
}
// 5. The goal is not weaker.
{
  const lo = Math.min(...runs("old-goal").map((a) => count(a, goalOn)));
  const arms = [...runs(`${NEW}-goal`), ...runs(`${NEW}-bothA`), ...runs(`${NEW}-bothB`)];
  const ok = arms.every((a) => share(a, goalOn) >= 65 && count(a, goalOn) >= lo - 2);
  bar("5 goal not weaker", ok, [...runs("old-goal"), ...runs("old-bothA"), ...runs("old-bothB"), ...arms].map((a) => `${a} ${count(a, goalOn)}/${L(a).length} ${pct(share(a, goalOn))}`).join(", "));
}
// 6. The reason leads, About chooses within it.
{
  const formalOfOn = (a: string) => {
    const on = L(a).filter(goalOn);
    return on.length ? (100 * on.filter((x) => x.TOPIC === "FORMAL").length) / on.length : 0;
  };
  const ok = Math.min(...runs(`${NEW}-bothB`).map(formalOfOn)) >= Math.max(...runs(`${NEW}-bothA`).map(formalOfOn)) + 20;
  const pooled = (p: string) => {
    const on = runs(p).flatMap((a) => L(a).filter(goalOn));
    return (100 * on.filter((x) => x.TOPIC === "FORMAL").length) / on.length;
  };
  const gapNew = pooled(`${NEW}-bothB`) - pooled(`${NEW}-bothA`);
  const gapOld = pooled("old-bothB") - pooled("old-bothA");
  bar(
    "6 reason leads, About chooses within",
    ok && gapNew > gapOld,
    `FORMAL among GOAL-on: ${["old-bothA", "old-bothB", `${NEW}-bothA`, `${NEW}-bothB`].flatMap(runs).map((a) => `${a} ${pct(formalOfOn(a))}`).join(", ")}; pooled gap new ${pct(gapNew)} vs old ${pct(gapOld)}`,
  );
}
// 7. The balance.
{
  const c = (a: string, v: string) => count(a, (x) => x.CENTRAL === v);
  const arms = [...runs(`${NEW}-goal`), ...runs(`${NEW}-bothA`), ...runs(`${NEW}-bothB`)];
  const ok = arms.every((a) => c(a, "OVERALL") + c(a, "SUPPORT") >= 3 && c(a, "OVERALL") >= 1 && c(a, "SUPPORT") >= 1);
  bar("7 the balance", ok, [...runs("old-goal"), ...runs("old-bothA"), ...runs("old-bothB"), ...arms].map((a) => `${a} O${c(a, "OVERALL")}+S${c(a, "SUPPORT")}`).join(", "));
}

for (const [name, ok, detail] of verdicts) console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${detail}`);
