/**
 * **A syntactic tripwire over the stylesheets: no rule reads a token that
 * nothing defines, and no rule paints text in a surface token.**
 *
 * Read the first sentence of the next section before trusting this file. It is
 * a text scanner, not a rendering engine, and it is deliberately named a
 * tripwire rather than a proof.
 *
 * ## Why it exists
 *
 * Both halves were live in `§ outline mode` until 2026-08-30, and between them
 * they made half the panel unreadable — Greg's screenshot, and the reason this
 * file exists. The block had been written against a token vocabulary this app
 * does not have:
 *
 *   - `var(--fg)`, `var(--panel-2)`, `var(--ui-font)` — **defined nowhere.**
 *     An undefined custom property with no fallback is *invalid at computed
 *     value time*: the declaration is thrown away and the property inherits.
 *     So `.outln-row.here { color: var(--fg) }` — the mark on the whole
 *     ancestor chain, one of the panel's two answers to "where am I" — simply
 *     did nothing, and looked exactly like a rule that had been applied.
 *   - `color: var(--muted)` in six places. `--muted` is shadcn's raised dark
 *     *surface*, `oklch(0.245 0 0)`, and the band is `oklch(0.19 0 0)`: about
 *     **1.14:1**. The text was painted, correctly, in very nearly its own
 *     background. The text token is `--muted-foreground` / `--ink-faint`.
 *
 * tokens.css already carries a shouted comment about exactly this for
 * `--accent`, and styles.css carries another, and Sol's code review had
 * already caught *this same panel* using `--accent` for its focus ring. The
 * comments were there, were read, and the mistake was made anyway with
 * `--accent`'s neighbour. **A rule that is only written down is not a check.**
 *
 * ## What this does NOT prove
 *
 * Named because the first version of this file implied the opposite, and GPT
 * Sol was right to call that out (2026-08-30). A green run here does not mean
 * the CSS computes correctly. It cannot see:
 *
 *   - **Scope or reachability.** A token defined under an unrelated selector,
 *     or inside an inactive `@media` / `@supports`, counts as defined here
 *     even though it never reaches the element that reads it.
 *   - **What is actually behind the text.** "Surface token" is a proxy for "too
 *     close to its own background", and it is only a proxy: `--page` is a
 *     surface and is *correctly* used as a text colour three times in this
 *     stylesheet, on bright orange and red fills. See `TEXT_ON_BRIGHT` below.
 *   - **Fallback semantics.** `var(--missing, 1px)` is not flagged, and it
 *     makes a `color` declaration invalid just as thoroughly as no fallback.
 *   - **React inline styles** beyond the fact that a `--token:` key exists
 *     somewhere in `src/web`, and nothing about whether that object is ever
 *     rendered.
 *
 * What it does cover, and what the red/green check at the bottom of the
 * outline work actually exercised, is the *spelling* class: a stylesheet
 * naming a token from somewhere else. That is the class that bit, twice.
 */
import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every stylesheet the client actually loads — tailwind.css imports the rest. */
const SHEETS = [
  "src/web/tailwind.css",
  "src/web/styles.css",
  "styles/tokens.css",
  "styles/colourscales.css",
];

/** Comments are prose *about* tokens, not uses of them. `--cat-N-rgb` is a
 *  comment's way of writing a family and would otherwise fail here. Applied to
 *  the TypeScript too: a dead object in a comment is not an inline style, and
 *  leaving it in is how this scanner would quietly start accepting anything
 *  anyone had ever written down. */
const decomment = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "");

const sheets = SHEETS.map((path) => ({ path, css: decomment(readFileSync(path, "utf8")) }));

const declared = (re: RegExp, hay: string) => {
  const out = new Set<string>();
  for (const m of hay.matchAll(re)) if (m[1]) out.add(m[1]);
  return out;
};

/** `--x: <value>` across all four sheets, for resolving one alias to the next. */
const valueOf = new Map<string, string>();
for (const { css } of sheets) {
  for (const m of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]*)/g)) {
    if (m[1] && m[2] !== undefined) valueOf.set(m[1], m[2]);
  }
}

describe("no stylesheet reads a custom property that nothing defines", () => {
  const inCss = new Set(valueOf.keys());

  /* Defined from the client, as an inline style. Some are written as a literal
     key (`"--lane": …`) and some as a template (`--h${i}`), so the templates
     are kept as prefixes and matched against a numeric tail — which is exactly
     what annotate.ts emits. The closing quote of an object key sits between
     the name and the colon (`{ "--lane": … }`); leaving it out of the pattern
     is why this test's first run reported `--lane` and `--h` as undefined when
     both are set two lines apart in Spine.tsx. */
  const js = decomment(
    globSync("src/web/**/*.{ts,tsx}")
      .map((f) => readFileSync(f, "utf8"))
      .join("\n"),
  );
  const fromJs = new Set<string>();
  const jsFamilies = new Set<string>();
  for (const t of declared(/(--[A-Za-z0-9_${}-]+)["'`]?\s*:/g, js)) {
    if (t.includes("${")) jsFamilies.add(t.replace(/\$\{[^}]*\}/g, ""));
    else fromJs.add(t);
  }
  const setFromJs = (token: string) =>
    fromJs.has(token) ||
    [...jsFamilies].some((f) => token.startsWith(f) && /^\d+$/.test(token.slice(f.length)));

  for (const { path, css } of sheets) {
    /* `var(--x, fallback)` is fine whether or not `--x` exists — the fallback
       is the author saying so. Only the no-fallback form is a claim that the
       token is there, and only that form is checked. */
    const used = declared(/var\(\s*(--[A-Za-z0-9_-]+)\s*\)/g, css);
    for (const token of [...used].sort()) {
      if (inCss.has(token)) continue;
      it(`${path} reads ${token}`, () => {
        expect(
          setFromJs(token),
          `\`var(${token})\` in ${path} is defined in no stylesheet and set by no inline style. ` +
            `An undefined custom property with no fallback makes the whole declaration invalid ` +
            `and the property inherits — nothing errors, the rule just does nothing.`,
        ).toBe(true);
      });
    }
  }
});

/**
 * **Tokens that are not text colours.** Mostly surfaces — each shadcn one has a
 * `-foreground` twin that is the text colour, and styles.css adds `--ink` /
 * `--ink-soft` / `--ink-faint` over the top. Painting text in one of these puts
 * near-black on near-black: it is the mistake, not a dark-mode subtlety.
 *
 * The semantic aliases (`--panel`, `--surface-raised`, `--rule`,
 * `--highlight-wash`) are here on Sol's finding that the first version listed
 * only the shadcn names, which is half the vocabulary this stylesheet actually
 * writes in.
 *
 * **It was called `SURFACES` until 2026-09-05, and that name had stopped being
 * true.** `--border`, `--rule` and `--rule-strong` are hairlines rather than
 * surfaces — `--rule-strong` is `oklch(0.36 0 0)`, about 2.1:1 on the page:
 * text you can see is there and cannot read. Painting words in a border colour
 * is the same mistake as painting them in a background, and the check has
 * always treated them alike, so the name follows the contract rather than the
 * other way round. Sol, 2026-09-05.
 */
const NON_TEXT_TOKENS = [
  "--background",
  "--card",
  "--popover",
  "--secondary",
  "--muted",
  "--accent",
  "--sidebar",
  "--input",
  "--border",
  "--panel",
  "--surface-raised",
  "--rule",
  "--rule-strong",
  "--highlight-wash",
];

/**
 * **The one surface that is a legitimate text colour, and why it is not a
 * loophole.** `--page` is the near-black page, and three rules paint text in it
 * — on `--highlight` and on `--destructive`, both bright fills. Dark ink on a
 * bright chip is the correct use, and the only one: the check above cannot see
 * what is behind the text, so this is the point where that limit has to be
 * declared rather than inferred. Anything else added here needs the same
 * sentence, naming the fill it sits on.
 */
const TEXT_ON_BRIGHT = ["--page"];

/** `--x` → does it bottom out at a surface? One alias deep was not enough:
 *  `--panel: var(--sidebar)` and `--page: var(--background)` are both a hop
 *  away from a shadcn surface, and `color: var(--alias)` was one of the shapes
 *  Sol showed passing the first version. */
function resolvesToSurface(token: string, seen = new Set<string>()): boolean {
  if (TEXT_ON_BRIGHT.includes(token)) return false;
  if (NON_TEXT_TOKENS.includes(token)) return true;
  if (seen.has(token) || seen.size > 10) return false;
  seen.add(token);
  const value = valueOf.get(token);
  if (value === undefined) return false;
  for (const m of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
    if (m[1] && resolvesToSurface(m[1], seen)) return true;
  }
  return false;
}

describe("no text is painted in a surface token", () => {
  it("finds colour declarations at all", () => {
    /* **The vacuity guard.** A scanner that has stopped matching `color:`
       reports a perfectly clean stylesheet, and that is indistinguishable from
       one — Sol's "or even that a future regex still finds any candidates",
       2026-08-30. Counted across the sheets TOGETHER and not one by one: the
       first version asserted it per sheet and went red on tailwind.css and
       colourscales.css, which are token definitions and quite properly paint
       nothing. `--color-muted:` is not a hit, because the lookbehind sees the
       hyphen — which is exactly the behaviour the check below depends on. */
    const scanned = sheets.reduce(
      (n, { css }) => n + [...css.matchAll(/(?<![-\w])color\s*:/gi)].length,
      0,
    );
    expect(scanned, "no `color:` declaration found in any sheet — the scanner is broken")
      .toBeGreaterThan(50);
  });

  for (const { path, css } of sheets) {
    /* **The whole declaration value, not just a `var()` sitting immediately
       after the colon.** `color: color-mix(in oklab, var(--muted), white)` was
       one of Sol's bypasses, and so was the space in `color : var(--muted)`.
       The lookbehind keeps `background-color`, `border-color` and `caret-color`
       out — those are the properties these tokens are *for* — while letting
       `-webkit-text-fill-color` in, which paints glyphs and was the other
       bypass. Case-insensitive: CSS property names are. */
    const hits: string[] = [];
    for (const m of css.matchAll(
      /(?<![-\w])(?:color|-webkit-text-fill-color)\s*:\s*([^;{}]*)/gi,
    )) {
      const value = m[1] ?? "";
      for (const v of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
        if (v[1] && resolvesToSurface(v[1])) hits.push(`${m[0].trim()}  →  ${v[1]}`);
      }
    }
    it(path, () => {
      expect(
        hits,
        `these paint text in a surface token (directly, or through an alias that ` +
          `resolves to one); the text twin is \`<token>-foreground\`, or one of ` +
          `--ink / --ink-soft / --ink-faint`,
      ).toEqual([]);
    });
  }
});

/**
 * The same mistake in Tailwind's spelling. `tw:text-muted` looks like the text
 * colour and is not: the bridge at the top of tailwind.css maps `--color-muted`
 * to `--muted`, the surface. `tw:text-muted-foreground` is the one that means
 * text.
 *
 * Sol named this as a bypass of the CSS-side check, and it is — but it is not
 * currently a bug: all 88 uses in `src/web` are already the `-foreground` form.
 * So this arrives with a clean baseline, which is the only time a check like
 * this is cheap to add.
 *
 * **Four names were excluded here until 2026-09-05, and the exclusion has gone.**
 * `panel`, `surface-raised`, `rule` and `highlight-wash` were left out on the
 * grounds that they were not in the `@theme inline` bridge, so `tw:text-rule`
 * could not compile and there was nothing to guard against. Adding
 * `--color-rule` and `--color-surface-raised` to that bridge — the whole point
 * of `260905f` — makes `tw:text-rule` and `tw:text-surface-raised` compile
 * perfectly well, into near-invisible text on a near-black page. **A theme key
 * enables every colour-shaped utility, not the one you wanted**, and the new
 * `tests/tailwind-utilities-resolve.test.ts` would positively approve both of
 * them, because they do produce a rule. Sol found this, 2026-09-05, and it is
 * the one cost of that fix.
 *
 * `highlight-wash` was already bridged and already unguarded, so it comes out
 * of the exclusion too. `panel` still is not bridged; it is listed anyway,
 * because "cannot currently compile" is a fact about today's theme file and not
 * a reason to leave a hole in a check. All four have a clean baseline.
 */
describe("no component reaches a surface token through a Tailwind text utility", () => {
  const bare = NON_TEXT_TOKENS.map((t) => t.slice(2)).join("|");
  /* The trailing class is what tells `tw:text-muted` from
     `tw:text-muted-foreground` — a `\b` matches before a hyphen, and using one
     here reported all 88 correct call sites as broken. */
  const wrong = new RegExp(`tw:text-(?:${bare})(?![a-zA-Z0-9_-])`, "g");

  /* **`{ts,tsx}`, and the `.ts` half is not decoration.** This scanned only
     `.tsx` until 2026-09-05, on the assumption that class strings live where
     the JSX does. They do not: `src/web/pill.ts` is a whole module of them, and
     `tw:text-rule` written there passed this check *and* the resolver test —
     the resolver quite correctly says the rule exists, and this one never
     opened the file. Sol found it by making the edit. Tailwind's own `@source`
     is the whole of `src/web`, so this matches it. */
  const files = globSync("src/web/**/*.{ts,tsx}").map((file) => ({
    file,
    src: readFileSync(file, "utf8"),
  }));

  it("finds text utilities at all", () => {
    /* **The vacuity guard, and it is the point of this `it`.** A `describe`
       that generates no cases passes, and a regex that has stopped matching
       anything looks exactly like a codebase with nothing wrong in it — Sol's
       "or even that a future regex still finds any candidates", 2026-08-30.
       So the scanner has to prove it can still see the shape it is filtering.
       88 call sites today; the floor is deliberately far below that, because
       this is a check against the scanner breaking, not a count of them. */
    const seen = files.filter((f) => /tw:text-[a-z]/.test(f.src)).length;
    expect(seen, "no `tw:text-*` utility found anywhere — the scanner is broken").toBeGreaterThan(5);
  });

  it("and none of them names a surface", () => {
    const hits = files.flatMap(({ file, src }) =>
      [...src.matchAll(wrong)].map((m) => `${file}: ${m[0]}`),
    );
    expect(
      hits,
      "`tw:text-<surface>` paints text in a surface — the bridge at the top of " +
        "tailwind.css maps `--color-muted` to `--muted`. Add `-foreground`.",
    ).toEqual([]);
  });
});

/**
 * **A percentage in a grid track's max position is not a cap.**
 *
 * Its own defect, kept next to the token checks because it is the same shape:
 * CSS that reads as one thing and computes as another, with nothing to say so.
 *
 * `minmax(0, 40%)` looks like "size to content, but never past 40%". It is not.
 * A percentage max makes the track *fixed*, so the maximise-tracks step grows
 * it to the whole 40% before any `fr` track beside it is fed. Written on
 * `.outln-row` to bound a runaway number, it made the number column 40% of the
 * outline panel on every row — a hand's width of nothing between `1` and its
 * title. It shipped, and Greg saw it within the hour.
 *
 * jsdom does no layout, so no rendering test in this repo could have caught
 * that; it needs a browser, and the browser was not available that day. What a
 * text scan *can* say is that the track went back to `auto` and stayed there.
 * The cap belongs on the item (`max-width`), which constrains the content the
 * `auto` track is sizing to.
 */
describe("the outline row's number track is content-sized, not a percentage", () => {
  const css = sheets.find((s) => s.path === "src/web/styles.css")?.css ?? "";
  const rule = css.match(/\.outln-row\s*\{([^}]*)\}/)?.[1] ?? "";

  it("has a rule to check", () => {
    /* The vacuity guard again: a renamed class makes the regex match nothing,
       and an empty rule passes every assertion below. */
    expect(rule, "no `.outln-row { … }` rule found — the scanner is broken").not.toBe("");
  });

  it("uses an auto first track", () => {
    const tracks = rule.match(/grid-template-columns:\s*([^;]*)/)?.[1]?.trim();
    expect(tracks, "`.outln-row` declares no grid-template-columns").toBeDefined();
    expect(
      tracks,
      "a `%` in a track's max position makes the track fixed, and grid grows it to " +
        "the full percentage before the `fr` beside it — cap the item with max-width instead",
    ).not.toMatch(/%/);
    expect(tracks).toMatch(/^auto\s/);
  });
});
