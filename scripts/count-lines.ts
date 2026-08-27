/**
 * How big is this repo, and what is it made of?
 *
 *   npm run count-lines
 *   npm run count-lines -- --by-file          # the 20 biggest files
 *   npm run count-lines -- --category=tests   # every file in one category
 *   npm run count-lines -- --json             # for a script to read
 *
 * Ported from gjdutils' `count-lines.ts`, which wraps cloc. Two things changed,
 * and both are the point of this file rather than tidying:
 *
 * **The file list comes from git, not from a hand-kept exclude list.** The
 * original passes cloc a directory and a list of things to skip —
 * `node_modules`, `dist`, `data`, `.vercel`, and so on. That list is a second
 * copy of `.gitignore`, and a second copy drifts: this repo ignores
 * `api-dist/`, `scratch-bakeoff/`, `output/` and `*.activity.log`, none of
 * which appear in any generic list, and the day somebody ignores a fifth thing
 * the count silently starts including it. `git ls-files` already knows, so it
 * is the input here and `.gitignore` is the only place exclusions are written.
 * The cost is honest and worth saying: a file you have created but not yet
 * `git add`ed is not counted. `--untracked` counts it.
 *
 * **The breakdown is by what a file is for, not by what language it is in.**
 * cloc groups by language, which for a TypeScript repo means one enormous row.
 * The question worth asking here is how much is product code, how much is
 * tests, and how much is prose — this repo keeps a lot of prose on purpose (see
 * CLAUDE.md), so a total that folds `docs/` in with `src/` is a number nobody
 * can use. Categories are path rules in CATEGORIES below; every file matches
 * exactly one, the first that claims it, and anything unmatched is reported as
 * `other` rather than dropped, so a gap in the rules shows up instead of
 * quietly shrinking the repo.
 *
 * Comment lines are shown as a percentage because in this repo they are not a
 * rounding error — the house style puts the reasoning next to the code, and
 * `src/` is roughly a third comments. A "lines of code" number that hides that
 * is describing a different repo.
 *
 * cloc does the actual counting (`brew install cloc`). Without it the script
 * still runs, counting total and blank lines itself and saying, in the output,
 * that the comment column is missing — a degraded count you are told about
 * beats an error message when all you wanted was a ballpark.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// What a file is for
// ---------------------------------------------------------------------------

type Category = {
  name: string;
  /** One line for the summary at the bottom. */
  blurb: string;
  /**
   * Counted in the "written by hand" headline. Generated files and binary
   * assets are still listed — they are part of the repo — but a headline that
   * includes a 8,600-line lockfile is measuring npm, not us.
   */
  handWritten: boolean;
  match: (file: string) => boolean;
  /** Optional split within the category; first match wins, so end with a catch-all. */
  parts?: Array<[label: string, match: (file: string) => boolean]>;
};

const isTest = (f: string) =>
  /^tests?\//.test(f) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(f);

/**
 * Committed pipeline output: article JSON kept as fixtures, the PDFs the eval
 * suite reads, the eval results themselves. Real files, deliberately in git
 * (docs/project/testing.md), and nobody wrote a line of any of them — so they
 * are listed and kept out of the headline, same as the lockfile.
 */
const isFixture = (f: string) =>
  f.startsWith("test/fixtures/") ||
  f.startsWith("example/") ||
  f.includes("/fixtures/") ||
  /^evals\/pdf\/(?!bakeoff\/)/.test(f);

const isGenerated = (f: string) =>
  f.startsWith("drizzle/") ||
  f.startsWith("evals/results/") ||
  f.includes("/baselines/") ||
  f === "package-lock.json" ||
  f.endsWith(".d.ts");

const CONFIG_FILES = new Set([
  "biome.jsonc",
  "components.json",
  "drizzle.config.ts",
  "knip.jsonc",
  "package.json",
  "tsconfig.base.json",
  "tsconfig.json",
  "vercel.json",
  "vite.api.config.ts",
  "vite.config.ts",
  "vitest.config.ts",
]);

/**
 * Order matters — a file belongs to the first category that claims it — and the
 * order encodes two judgements.
 *
 * `docs` is first, so **a .md is prose wherever it sits**. `evals/results/`
 * holds machine-written JSON and hand-written write-ups of what that JSON
 * meant, side by side; a rule that claimed the whole directory would file six
 * essays as generated output.
 *
 * The three "nobody wrote this" rules come next, above `tests`. Otherwise
 * `test/fixtures/structures.blocks.json` — pipeline output, committed so a test
 * has something to run against — counts as a test somebody sat down and wrote.
 */
const CATEGORIES: Category[] = [
  {
    name: "docs",
    blurb: "docs/ and every other .md",
    handWritten: true,
    match: (f) => f.startsWith("docs/") || f.endsWith(".md"),
    parts: [
      ["project", (f) => f.startsWith("docs/project/")],
      ["plans", (f) => f.startsWith("docs/plans/")],
      ["research", (f) => f.startsWith("docs/research/")],
      ["postmortems", (f) => f.startsWith("docs/postmortems/")],
      ["reusable", (f) => f.startsWith("docs/reusable/")],
      ["at the root", (f) => !f.includes("/")],
      ["beside the code", () => true],
    ],
  },
  {
    name: "fixtures",
    blurb: "committed pipeline output, and the PDFs the evals read",
    handWritten: false,
    match: isFixture,
  },
  {
    name: "generated",
    blurb: "drizzle migrations, eval results, the lockfile",
    handWritten: false,
    match: isGenerated,
  },
  {
    name: "assets",
    blurb: "images, certs, the html shell",
    handWritten: false,
    match: (f) =>
      f.startsWith("public/") ||
      f.startsWith("certs/") ||
      f.includes("/assets/") ||
      f.endsWith(".html"),
  },
  {
    name: "tests",
    blurb: "vitest suites",
    handWritten: true,
    match: isTest,
  },
  {
    name: "styles",
    blurb: "hand-written CSS",
    handWritten: true,
    match: (f) => f.endsWith(".css"),
  },
  {
    name: "source",
    blurb: "the app itself",
    handWritten: true,
    match: (f) => f.startsWith("src/") || f.startsWith("api/"),
    parts: [
      ["client", (f) => f.startsWith("src/web/")],
      ["storage", (f) => f.startsWith("src/store/")],
      ["db", (f) => f.startsWith("src/db/")],
      ["api handlers", (f) => f.startsWith("api/")],
      ["pipeline + server", () => true],
    ],
  },
  {
    name: "evals",
    blurb: "model evals, run by hand",
    handWritten: true,
    match: (f) => f.startsWith("evals/"),
  },
  {
    name: "scripts",
    blurb: "dev + ops commands",
    handWritten: true,
    match: (f) => f.startsWith("scripts/"),
  },
  {
    name: "config",
    blurb: "build, lint, deploy, supabase",
    handWritten: true,
    match: (f) =>
      CONFIG_FILES.has(f) ||
      f.startsWith("supabase/") ||
      !f.includes("/"), // dotfiles and anything else loose at the root
  },
  {
    name: "other",
    blurb: "matched no rule above — a gap in CATEGORIES, or genuinely misc",
    handWritten: false,
    match: () => true,
  },
];

const categorise = (file: string) =>
  CATEGORIES.find((c) => c.match(file)) as Category;

const partOf = (cat: Category, file: string) =>
  cat.parts?.find(([, match]) => match(file))?.[0];

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

type Counts = { files: number; code: number; comment: number; blank: number };
type FileCount = Counts & { file: string; language: string };

const zero = (): Counts => ({ files: 0, code: 0, comment: 0, blank: 0 });

const add = (into: Counts, from: Counts) => {
  into.files += from.files;
  into.code += from.code;
  into.comment += from.comment;
  into.blank += from.blank;
};

/**
 * Tracked files, minus symlinks — and the symlinks are not a detail. `git
 * ls-files` lists `CLAUDE.md`, which points at `AGENTS.md`; hand both to cloc
 * and it counts one and drops the other as a duplicate, and which one it drops
 * is up to cloc. It dropped `AGENTS.md`, so the repo's largest single document
 * was showing up under a name that is not a file. A symlink has no lines of
 * its own, so the fix is to not offer it.
 */
const listFiles = (untracked: boolean): string[] => {
  const tracked = execFileSync("git", ["ls-files", "--cached", "--stage"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean)
    .filter((line) => !line.startsWith("120000 ")) // symlink mode
    .map((line) => line.split("\t").slice(1).join("\t"));
  if (!untracked) return tracked;

  const extra = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  return [...tracked, ...extra];
};

const haveCloc = () => {
  try {
    execFileSync("cloc", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

/**
 * cloc, in one pass over the whole list. `--by-file` so we can regroup by
 * category; running cloc once per category would be nine times the work and
 * would still have to agree with itself about what a comment is.
 */
const countWithCloc = (files: string[]): FileCount[] => {
  const listPath = path.join(tmpdir(), `spideryarn-count-lines-${process.pid}`);
  writeFileSync(listPath, `${files.join("\n")}\n`);
  const raw = execFileSync(
    "cloc",
    [`--list-file=${listPath}`, "--by-file", "--json", "--quiet"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(raw) as Record<
    string,
    { blank: number; comment: number; code: number; language?: string }
  >;
  return Object.entries(parsed)
    .filter(([key]) => key !== "header" && key !== "SUM")
    .map(([file, v]) => ({
      file,
      language: v.language ?? "unknown",
      files: 1,
      code: v.code,
      comment: v.comment,
      blank: v.blank,
    }));
};

/**
 * Total and blank only, no comment split. Used for the whole repo when cloc is
 * missing, and — even when cloc is there — for the handful of files cloc has no
 * language for: `.jsonc`, `.gitignore`, `.env.example`. Those are ~900 real
 * lines here, and the alternative is a total that quietly omits them because a
 * third-party tool did not recognise a file extension.
 */
const countOurselves = (files: string[]): FileCount[] => {
  const out: FileCount[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue; // unreadable, or gone since git listed it
    }
    if (text.includes("\0")) continue; // binary, same as cloc skipping it
    const lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const blank = lines.filter((l) => l.trim() === "").length;
    out.push({
      file,
      language: path.extname(file).slice(1) || "none",
      files: 1,
      code: lines.length - blank,
      comment: 0,
      blank,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const n = (x: number) => x.toLocaleString("en-US");
const pct = (part: number, whole: number) =>
  whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;

type Col = { head: string; right?: boolean };

const table = (cols: Col[], rows: string[][]): string => {
  const widths = cols.map((c, i) =>
    Math.max(c.head.length, ...rows.map((r) => (r[i] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, i) => {
        const width = i === cols.length - 1 ? 0 : (widths[i] ?? 0);
        return cols[i]?.right ? cell.padStart(widths[i] ?? 0) : cell.padEnd(width);
      })
      .join("  ")
      .trimEnd();
  return [
    line(cols.map((c) => c.head)),
    widths.map((w) => "─".repeat(w)).join("  "),
    ...rows.map(line),
    "",
  ].join("\n");
};


// ---------------------------------------------------------------------------
// Gathering
// ---------------------------------------------------------------------------

type Report = {
  /** True when cloc did the counting, so the comment column means something. */
  useCloc: boolean;
  files: string[];
  counted: FileCount[];
  /** Counted by us because cloc had no language for them: no comment split. */
  rescued: FileCount[];
  /** Binary: nothing to count, by anyone. */
  skipped: string[];
  byCategory: Map<string, Counts>;
  byPart: Map<string, Map<string, Counts>>;
  byLanguage: Map<string, Counts>;
  total: Counts;
  handWritten: Counts;
};

const gather = (opts: { untracked: boolean; noCloc: boolean }): Report => {
  const files = listFiles(opts.untracked);
  const useCloc = !opts.noCloc && haveCloc();
  const counted = useCloc ? countWithCloc(files) : countOurselves(files);

  // Anything cloc had no language for, counted the plain way rather than lost.
  const clocSaw = new Set(counted.map((c) => c.file));
  const rescued = useCloc
    ? countOurselves(files.filter((f) => !clocSaw.has(f)))
    : [];
  counted.push(...rescued);

  const seen = new Set(counted.map((c) => c.file));
  const skipped = files.filter((f) => !seen.has(f));

  const byCategory = new Map<string, Counts>();
  const byPart = new Map<string, Map<string, Counts>>();
  const byLanguage = new Map<string, Counts>();
  const bucket = (m: Map<string, Counts>, key: string, c: Counts) => {
    if (!m.has(key)) m.set(key, zero());
    add(m.get(key) as Counts, c);
  };
  for (const c of counted) {
    const cat = categorise(c.file);
    bucket(byCategory, cat.name, c);
    bucket(byLanguage, c.language, c);
    const part = partOf(cat, c.file);
    if (part) {
      if (!byPart.has(cat.name)) byPart.set(cat.name, new Map());
      bucket(byPart.get(cat.name) as Map<string, Counts>, part, c);
    }
  }

  const total = zero();
  const handWritten = zero();
  for (const cat of CATEGORIES) {
    const counts = byCategory.get(cat.name);
    if (!counts) continue;
    add(total, counts);
    if (cat.handWritten) add(handWritten, counts);
  }

  return {
    useCloc,
    files,
    counted,
    rescued,
    skipped,
    byCategory,
    byPart,
    byLanguage,
    total,
    handWritten,
  };
};

// ---------------------------------------------------------------------------
// The three things it can print
// ---------------------------------------------------------------------------

const HELP = [
  "Count the lines in this repo, grouped by what each file is for.",
  "",
  "  --by-file            list the biggest files",
  "  --top=N              how many (default 20)",
  "  --category=NAME      list every file in one category instead",
  "  --by-language        add the language breakdown",
  "  --untracked          include files git does not track yet",
  "  --no-cloc            use the built-in counter (no comment column)",
  "  --json               machine-readable, nothing else printed",
  "",
  `Categories: ${CATEGORIES.map((c) => c.name).join(", ")}`,
  "",
].join("\n");

/** `--by-file`, or `--category=NAME`: one row per file rather than per bucket. */
const renderFiles = (r: Report, only: string | undefined, top: number) => {
  const noSplit = new Set(r.rescued.map((x) => x.file));
  const rows = r.counted
    .filter((c) => !only || categorise(c.file).name === only)
    .sort((a, b) => b.code - a.code);
  const shown = only ? rows : rows.slice(0, top);
  const out = [
    "",
    only
      ? `Every file in \`${only}\` — ${n(rows.length)} files, ${n(
          rows.reduce((sum, x) => sum + x.code, 0),
        )} lines of code\n`
      : `The ${n(shown.length)} biggest files, by lines of code\n`,
    table(
      [
        { head: "code", right: true },
        { head: "comment", right: true },
        ...(only ? [] : [{ head: "cat" }]),
        { head: "file" },
      ],
      shown.map((c) => [
        n(c.code),
        r.useCloc && !noSplit.has(c.file) ? n(c.comment) : "—",
        ...(only ? [] : [categorise(c.file).name]),
        c.file,
      ]),
    ),
  ];
  if (!only && rows.length > shown.length) {
    out.push(
      `…and ${n(rows.length - shown.length)} more. --top=N for a longer list.\n`,
    );
  }
  return out.join("\n");
};

/** The default: two blocks, hand-written above, nobody-wrote below. */
const renderTable = (r: Report) => {
  const { useCloc, byCategory, byPart, total, handWritten } = r;

  /** Shares are of hand-written code, which is the number people mean. */
  const row = (label: string, c: Counts, share: boolean) => [
    label,
    n(c.files),
    n(c.code),
    share ? pct(c.code, handWritten.code) : "—",
    useCloc ? n(c.comment) : "—",
    useCloc ? pct(c.comment, c.code + c.comment) : "—",
    n(c.blank),
  ];
  const rowsFor = (want: boolean) =>
    CATEGORIES.flatMap((cat) => {
      const c = byCategory.get(cat.name);
      if (!c || cat.handWritten !== want) return [];
      const parts = [...(byPart.get(cat.name) ?? [])]
        .sort((a, b) => b[1].code - a[1].code)
        .map(([label, p]) => [...row(`  ${label}`, p, want), ""]);
      return [[...row(cat.name, c, want), cat.blurb], ...parts];
    });

  const notHand = zero();
  add(notHand, total);
  for (const k of ["files", "code", "comment", "blank"] as const) {
    notHand[k] -= handWritten[k];
  }

  return table(
    [
      { head: "" },
      { head: "files", right: true },
      { head: "code", right: true },
      { head: "share", right: true },
      { head: "comment", right: true },
      { head: "% cmt", right: true },
      { head: "blank", right: true },
      { head: "" },
    ],
    [
      ...rowsFor(true),
      [...row("— written by hand", handWritten, true), ""],
      ["", "", "", "", "", "", "", ""],
      ...rowsFor(false),
      [...row("— nobody wrote", notHand, false), ""],
    ],
  );
};

const renderLanguages = (r: Report) =>
  table(
    [
      { head: "" },
      { head: "files", right: true },
      { head: "code", right: true },
      { head: "comment", right: true },
      { head: "blank", right: true },
    ],
    [...r.byLanguage]
      .sort((a, b) => b[1].code - a[1].code)
      .map(([lang, c]) => [
        lang,
        n(c.files),
        n(c.code),
        r.useCloc ? n(c.comment) : "—",
        n(c.blank),
      ]),
  );

/** The four numbers worth saying in a sentence, plus every caveat we know of. */
const renderSummary = (r: Report, forced: boolean) => {
  const { useCloc, total, handWritten, rescued, skipped, files } = r;
  const of = (name: string) => r.byCategory.get(name) ?? zero();
  const code = of("source").code + of("tests").code + of("styles").code;
  const out = ["The short version"];

  out.push(
    `  ${n(code)} lines of code — ${n(of("source").code)} app, ${n(of("styles").code)} CSS, ` +
      `${n(of("tests").code)} tests (${pct(of("tests").code, code)} of it is tests)`,
  );
  out.push(
    `  ${n(of("docs").code)} lines of docs — ${(of("docs").code / Math.max(code, 1)).toFixed(2)} lines of prose per line of code`,
  );
  if (useCloc) {
    const src = of("source");
    out.push(
      `  ${pct(src.comment, src.code + src.comment)} of src/ is comments — the house style, not a lint failure`,
    );
  }
  out.push(
    `  ${n(handWritten.code)} written by hand, ${n(total.code - handWritten.code)} generated or vendored`,
  );
  out.push("");

  if (!useCloc) {
    out.push(
      forced
        ? "cloc was turned off (--no-cloc), so `code` means every non-blank line and"
        : "cloc is not installed, so `code` means every non-blank line and",
      forced
        ? "comments are counted as code. Drop the flag for the real split.\n"
        : "comments are counted as code. `brew install cloc` for the real split.\n",
    );
  }
  if (rescued.length) {
    const names = [...new Set(rescued.map((x) => path.basename(x.file)))];
    out.push(
      `cloc knows no language for ${n(rescued.length)} files (${names.slice(0, 3).join(", ")}` +
        `${names.length > 3 ? ", …" : ""}), so their ${n(rescued.reduce((sum, x) => sum + x.code, 0))} lines are` +
        " counted here with no comment split rather than dropped.\n",
    );
  }
  if (skipped.length) {
    out.push(
      `${n(skipped.length)} binary files have no lines to count: ${skipped.slice(0, 3).join(", ")}` +
        `${skipped.length > 3 ? ", …" : ""}\n`,
    );
  }
  const misc = r.byCategory.get("other");
  if (misc) {
    out.push(
      `\`other\` is ${n(misc.files)} files — if that is growing, CATEGORIES in this script needs a rule.\n`,
    );
  }
  // Every listed file is counted or skipped. If not, the arithmetic is wrong.
  if (total.files + skipped.length !== files.length) {
    out.push(
      `⚠️  ${n(files.length)} files listed, ${n(total.files + skipped.length)} accounted for — count-lines.ts has a bug.\n`,
    );
  }
  return out.join("\n");
};

// ---------------------------------------------------------------------------

const main = () => {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

  if (flag("help")) {
    process.stdout.write(HELP);
    return;
  }

  const r = gather({ untracked: flag("untracked"), noCloc: flag("no-cloc") });

  if (flag("json")) {
    process.stdout.write(
      `${JSON.stringify(
        {
          tool: r.useCloc ? "cloc" : "builtin",
          totals: { all: r.total, handWritten: r.handWritten },
          categories: Object.fromEntries(r.byCategory),
          parts: Object.fromEntries(
            [...r.byPart].map(([k, v]) => [k, Object.fromEntries(v)]),
          ),
          languages: Object.fromEntries(r.byLanguage),
          noCommentSplit: r.rescued.map((x) => x.file),
          binary: r.skipped,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  const only = value("category");
  if (only || flag("by-file")) {
    if (only && !CATEGORIES.some((c) => c.name === only)) {
      process.stderr.write(
        `No category \`${only}\`. Try: ${CATEGORIES.map((c) => c.name).join(", ")}\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${renderFiles(r, only, Number(value("top") ?? 20))}\n`);
    return;
  }

  const out = [
    "",
    `Spideryarn — ${n(r.total.files)} files, ${n(r.total.code + r.total.comment + r.total.blank)} lines in all\n`,
    renderTable(r),
  ];
  if (flag("by-language")) out.push("By language\n", renderLanguages(r));
  out.push(renderSummary(r, flag("no-cloc")));
  process.stdout.write(`${out.join("\n")}\n`);
};

main();
