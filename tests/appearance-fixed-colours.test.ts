/**
 * **No bare white or black outside the token files** — the guard the light
 * theme needs to stay light.
 *
 * Until 2026-10-03 the app was dark only, so `white` meant "more contrast" and
 * `black` meant "quieter", and a stylesheet could say either. With
 * `data-theme="light"` (src/web/appearance.ts) both are right in one theme and
 * backwards in the other: a white hairline that separates a panel on the dark
 * page is no line at all on the light one. The tokens say the direction
 * instead — `--toward-ink` / `--toward-page`, `--toward-ink-rgb` for a
 * translucent lift, `--highlight-foreground` for text on orange fills — and they
 * flip in the light block of src/web/styles/tokens.css.
 *
 * So: a component stylesheet under src/web/styles/ (not tokens.css), or any
 * .ts/.tsx under src/web, that writes white or black in a colour position —
 * `white`, `black`, `#fff`, `#ffffff`, `#000`, `#000000`, `rgb(255 255 255 …)`
 * in any of its spellings, Tailwind's `bg-white` / `text-black` — fails here,
 * unless it is on the allowlist below with a reason.
 *
 * **Allowed by shape rather than by line**, because they are theme-neutral by
 * construction: black in a shadow (shadows are dark on both grounds), and
 * either in a mask (a mask reads only alpha). Everything else is keyed by file
 * and a substring of the offending declaration or line — never a line number,
 * which would go stale on the next unrelated edit — and an entry that no
 * longer matches anything fails too, so the list cannot quietly outlive what
 * it excused.
 *
 * Comments are stripped first, so prose about "a white stroke" does not trip
 * it. **What it does not see**: a colour built at run time from parts
 * (`"#" + "fff"`), a near-white that is not white (`#fafafa`), and `rgb(0 0 0)`
 * outside a shadow is caught but `rgb(10 10 10)` is not. It is a tripwire for
 * the common spelling, not a proof.
 * docs/plans/261003e-light-dark-and-system-appearance-on-profile.md § Key decisions 7.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const WEB = join(ROOT, "src", "web");
const STYLES = join(WEB, "styles");

type Allowed = { file: string; contains: string; why: string };

const ALLOWLIST: readonly Allowed[] = [
  // ---- theme-neutral: these are the same on either ground ----
  {
    file: "src/web/styles/site.css",
    contains: "color: #000",
    why: "@media print: the headline on paper, which is white whatever the screen's theme",
  },
  {
    file: "src/web/styles/site.css",
    contains: "inset 0 1px 0 rgb(255 255 255 / 0.07)",
    why: "a top-edge highlight is light catching an edge: white on either ground, and invisible on the light theme's white card",
  },
  {
    file: "src/web/styles/site.css",
    contains: "inset 0 1px 0 rgb(255 255 255 / 0.04)",
    why: "the same top-edge highlight on a panel",
  },
  {
    file: "src/web/styles/site.css",
    contains: "rgb(255 255 255 / 0.22), rgb(219 138 69 / 0.16)",
    why: "the hero frame's lit edge, drawn over the edge of a screenshot of the app, which stays as shot",
  },
  {
    file: "src/web/styles/site.css",
    contains: "--site-lift:",
    why: "a drop shadow held in a custom property, so the shadow shape cannot see it; lighter in the light block",
  },
  {
    file: "src/web/PlanCards.tsx",
    contains: "inset_0_1px_0_rgb(255_255_255/0.11)",
    why: "the recommended price card's top-edge highlight, as in site.css",
  },
  {
    file: "src/web/styles/diagram-illustrated.css",
    contains: "background: rgb(0 0 0 / 0.72)",
    why: "the full-screen viewer's ::backdrop, a scrim: dimming is dark on both grounds",
  },
  {
    file: "src/web/styles/diagram-sketch.css",
    contains: "background: rgb(0 0 0 / 0.72)",
    why: "the full-screen viewer's ::backdrop, a scrim",
  },
  {
    file: "src/web/CommandBar.tsx",
    contains: "tw:bg-black/50",
    why: "the scrim behind the command bar dialog",
  },
  // ---- not ours to recolour, or not the app ----
  {
    file: "src/web/SignInControls.tsx",
    contains: 'background: "#FFFFFF"',
    why: "Google's specified light-theme sign-in button fill; the button is themed by choosing Google's palette, not ours",
  },
  {
    file: "src/web/ViewportProbe.tsx",
    contains: 'color: "#fff"',
    why: "a debug overlay, deliberately the same in both themes so it reads over anything",
  },
  {
    file: "src/web/ViewportProbe.tsx",
    contains: 'background: "rgba(0,0,0,0.82)"',
    why: "the same debug overlay's own dark plate",
  },
  {
    file: "src/web/DesignPage.tsx",
    contains: 'ctx.fillStyle = "#000"',
    why: "resets a 1x1 canvas probe before the colour under test is parsed; never painted",
  },
];

/** Blank out comments, keeping every newline so offsets still give lines. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/** The same for TS/TSX, stepping over strings so `"https://…"` survives. */
function stripTsComments(src: string): string {
  let out = "";
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (c === quote || (c === "\n" && quote !== "`")) quote = null;
      i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === "/" && next === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    out += c;
    i++;
  }
  return out;
}

const HEX_BLACK = /#(?:000(?:[0-9a-f])?|000000(?:[0-9a-f]{2})?)\b/i;
const HEX_WHITE = /#(?:fff(?:[0-9a-f])?|ffffff(?:[0-9a-f]{2})?)\b/i;
const RGB_WHITE = /rgba?\(\s*255[\s,_]+255[\s,_]+255\b/i;
const RGB_BLACK = /rgba?\(\s*0[\s,_]+0[\s,_]+0\b/i;
const OKLCH_WHITE = /oklch\(\s*(?:1(?:\.0+)?|100%)[\s_]+0[\s_]+0\b/i;
const OKLCH_BLACK = /oklch\(\s*0(?:%)?[\s_]+0[\s_]+0\b/i;
const WORD = /(?<![-\w$])(white|black)(?![-\w])/i;
const TW_CLASS =
  /(?<![\w-])(?:[\w-]+:)*-?(?:bg|text|border(?:-[trblxyse])?|fill|stroke|ring|ring-offset|outline|from|via|to|shadow|inset-shadow|decoration|accent|caret|divide|placeholder)-\[?(white|black)\b/i;
const QUOTED_WORD = /["'`](white|black)["'`]/i;

type Finding = { file: string; line: number; text: string; colour: "white" | "black" };

function lineAt(src: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

/** Which of white/black a piece of text writes, given whether it is a CSS value. */
function coloursIn(text: string, kind: "css-value" | "css-other" | "ts"): Set<"white" | "black"> {
  const found = new Set<"white" | "black">();
  if (HEX_WHITE.test(text) || RGB_WHITE.test(text) || OKLCH_WHITE.test(text)) found.add("white");
  if (HEX_BLACK.test(text) || RGB_BLACK.test(text) || OKLCH_BLACK.test(text)) found.add("black");
  const word =
    kind === "css-value" ? WORD.exec(text) : kind === "ts" ? (TW_CLASS.exec(text) ?? QUOTED_WORD.exec(text)) : null;
  if (word?.[1]) found.add(word[1].toLowerCase() as "white" | "black");
  return found;
}

/** Allowed by shape: black in a shadow, anything in a mask. */
function neutralByShape(text: string, colour: "white" | "black"): boolean {
  if (/mask/i.test(text)) return true;
  return colour === "black" && /shadow/i.test(text);
}

function scanCss(file: string, raw: string): Finding[] {
  const src = stripCssComments(raw);
  const out: Finding[] = [];
  // A declaration, a selector or an at-rule prelude: whatever lies between
  // two of `;`, `{`, `}`. A multi-line value stays one piece.
  const re = /[^;{}]+/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const piece = m[0];
    const decl = /^\s*(--[\w-]+|[a-z-]+)\s*:([\s\S]*)$/i.exec(piece);
    const isPrelude = /^\s*@/.test(piece);
    const kind = decl && !isPrelude ? "css-value" : "css-other";
    const scanned = decl && !isPrelude ? (decl[2] ?? "") : piece;
    for (const colour of coloursIn(scanned, kind)) {
      if (neutralByShape(piece, colour)) continue;
      const lead = piece.length - piece.trimStart().length;
      out.push({ file, line: lineAt(src, m.index + lead), text: piece.trim().replace(/\s+/g, " "), colour });
    }
  }
  return out;
}

function scanTs(file: string, raw: string): Finding[] {
  const src = stripTsComments(raw);
  const out: Finding[] = [];
  src.split("\n").forEach((text, i) => {
    for (const colour of coloursIn(text, "ts")) {
      if (neutralByShape(text, colour)) continue;
      out.push({ file, line: i + 1, text: text.trim(), colour });
    }
  });
  return out;
}

function walk(dir: string, keep: (path: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out.sort();
}

function scanTree(): Finding[] {
  const css = walk(STYLES, (p) => p.endsWith(".css") && !p.endsWith("/tokens.css"));
  const ts = walk(WEB, (p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts"));
  return [
    ...css.flatMap((p) => scanCss(relative(ROOT, p), readFileSync(p, "utf8"))),
    ...ts.flatMap((p) => scanTs(relative(ROOT, p), readFileSync(p, "utf8"))),
  ];
}

const allowedBy = (f: Finding) => ALLOWLIST.find((a) => a.file === f.file && f.text.includes(a.contains));

describe("no bare white or black outside the token files", () => {
  const findings = scanTree();

  it("finds none that the allowlist does not explain", () => {
    const unexplained = findings
      .filter((f) => !allowedBy(f))
      .map((f) => `${f.file}:${f.line} (${f.colour}): ${f.text.slice(0, 160)}`);
    expect(
      unexplained,
      "Bare white/black is right in one theme and backwards in the other. Use a token " +
        "(--toward-ink, --toward-page, rgb(var(--toward-ink-rgb) / a), --highlight-foreground, " +
        "--ink, --page) or, if it is genuinely theme-neutral, add it to ALLOWLIST with a reason.",
    ).toEqual([]);
  });

  it("has no allowlist entry that no longer matches anything", () => {
    const stale = ALLOWLIST.filter((a) => !findings.some((f) => allowedBy(f) === a)).map(
      (a) => `${a.file}: ${a.contains}`,
    );
    expect(stale).toEqual([]);
  });

  it("every allowlist entry says why", () => {
    for (const a of ALLOWLIST) expect(a.why.length, `${a.file}: ${a.contains}`).toBeGreaterThan(20);
  });
});

describe("the fill orange is not used as text", () => {
  it("uses --highlight-text for CSS color and Tailwind text utilities", () => {
    const hits: string[] = [];
    for (const file of walk(STYLES, (p) => p.endsWith(".css") && !p.endsWith("/tokens.css"))) {
      stripCssComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          /* Text, and since the code review the focus outlines and native
             accents too: a focus indicator needs 3:1, which the raw orange
             misses on the light page. */
          if (
            /(?<![-\w])color\s*:\s*var\(--highlight\)\s*;/.test(line) ||
            /outline[a-z-]*\s*:[^;]*var\(--highlight\)/.test(line) ||
            /accent-color\s*:\s*var\(--highlight\)/.test(line)
          ) {
            hits.push(`${relative(ROOT, file)}:${i + 1}`);
          }
        });
    }
    for (const file of walk(WEB, (p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts"))) {
      stripTsComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (
            /(?:^|:)(?:text|outline|ring)-highlight(?![-\w])/.test(line) ||
            /(?:focus|focus-visible|focus-within):border-highlight(?![-\w])/.test(line) ||
            /accent-color:var\(--highlight\)/.test(line)
          ) {
            hits.push(`${relative(ROOT, file)}:${i + 1}`);
          }
        });
    }
    expect(hits, "--highlight is a fill; text needs the contrast-safe --highlight-text").toEqual([]);
  });
});

describe("the scanner itself", () => {
  it("catches each spelling in a stylesheet", () => {
    const css = [
      ".a { color: white; }",
      ".b { background: #fff; }",
      ".c { border-color: rgb(255 255 255 / 0.1); }",
      ".d { --x: #000000; }",
      ".e { fill: color-mix(in oklab, var(--y) 80%, black); }",
      ".f { color: rgba(255,255,255,.5); }",
      ".g { color: oklch(1 0 0); }",
    ].join("\n");
    expect(scanCss("x.css", css).map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("leaves prose, white-space, shadows and masks alone", () => {
    const css = [
      "/* a white stroke on a black page */",
      ".a { white-space: nowrap; }",
      ".b { box-shadow: 0 1px 2px rgb(0 0 0 / 0.5); }",
      ".c { mask-image: linear-gradient(black, transparent); }",
      ".d { color: var(--toward-ink); }",
    ].join("\n");
    expect(scanCss("x.css", css)).toEqual([]);
  });

  it("catches a white shadow, which is not neutral", () => {
    expect(scanCss("x.css", ".a { box-shadow: 0 0 4px #fff; }")).toHaveLength(1);
  });

  it("catches Tailwind classes and quoted values in TS, not prose in comments", () => {
    const ts = [
      'const a = "tw:bg-white tw:p-2";',
      "const b = { color: '#ffffff' };",
      'const c = "tw:border-[rgb(255_255_255/0.16)]";',
      "const d = { fill: 'black' };",
      "// the white word on a black page",
      "/* tw:text-white */",
      'const e = "https://example.com"; const f = "tw:hover:text-black";',
      'const g = "tw:whitespace-nowrap tw:shadow-[0_1px_2px_rgb(0_0_0/0.5)]";',
    ].join("\n");
    expect(scanTs("x.tsx", ts).map((f) => f.line)).toEqual([1, 2, 3, 4, 7]);
  });
});
