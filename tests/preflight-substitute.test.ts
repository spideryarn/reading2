/**
 * **We hand-wrote a replacement for Tailwind's preflight, and it has been
 * incomplete four times. This is the checklist that makes a fifth loud.**
 *
 * [`tailwind.css`](../src/web/tailwind.css) deliberately imports no preflight —
 * it would reset the article author's own HTML inside `.prose`, the one place
 * we cannot enumerate the tags — and hand-writes the rules shadcn depends on
 * instead. Every time somebody has looked closely at that block, it has turned
 * out to name fewer properties than it needed:
 *
 * | found | missing | how it showed |
 * |---|---|---|
 * | 2026-08-27 | scoped to `[data-slot]`, so most buttons got nothing | 36 of 59 buttons wore the UA's `2px outset white` border; all 59 had `cursor: default` |
 * | 2026-08-27 | `img { height: auto }` | the landing page's screenshots were stretched 1.95× |
 * | 2026-09-04 | `font-family` / `font-size` | every button that set no font of its own rendered in the UA's Arial on a Geist page |
 * | 2026-10-06 | `html { -webkit-text-size-adjust }` | an iPhone in landscape drew a band's wrapped text half as big again as the article beside it |
 *
 * The fourth was on `html`, which the checklist did not cover: it looked only
 * at `button`. It covers both now (`DECLINED_HTML`).
 *
 * Each was found by eye, late, by somebody looking at something else. The
 * pattern is always the same and it is the [silent-success](../docs/reusable/silent-success.md)
 * shape: a reset that is present, documented, and covers a minority of what it
 * names, so the *existence* of the block is taken as evidence it is complete.
 *
 * ## What this test actually does
 *
 * It reads **Tailwind's own `preflight.css` out of `node_modules`** — the real
 * source of truth, which updates when the dependency does — pulls out every
 * property preflight sets on a bare `<button>` or `html`, and requires each one
 * to be either mirrored in our block or listed in the element's decision list
 * with a reason.
 *
 * That is deliberately not "our block is correct". Nothing here can know that.
 * What it can know is that **nobody has decided** about a property preflight
 * thinks either element needs — which is exactly the state all four findings
 * above were in. A new property in a Tailwind upgrade fails this test until
 * somebody reads it and either copies it or writes down why not.
 *
 * `button` and `html` only, because those are the elements whose missing
 * preflight rules have caused bugs here. `input`, `select` and `textarea` share
 * the button rule and are deliberately not covered — see `DECLINED`.
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const TAILWIND_CSS = new URL("../src/web/tailwind.css", import.meta.url).pathname;
const PREFLIGHT = new URL("../node_modules/tailwindcss/preflight.css", import.meta.url).pathname;

/**
 * Properties preflight sets on a button that this app **deliberately does not**,
 * each with the reason. Adding a line here is a decision; the test only insists
 * that one was taken.
 *
 * **`instead` is load-bearing, and the first draft of this file did not have
 * it.** `font` is declined in favour of two longhands — and because preflight
 * has no `font-family` line of its own to compare against, deleting both
 * longhands from `tailwind.css` left this test green over the exact bug it was
 * written for. Verified by deleting them, 2026-09-04. A property declined
 * *in favour of* something else has to name that something, or the decline is
 * indistinguishable from an omission — which is the whole subject of this file.
 */
interface Declined {
  reason: string;
  /** Properties our block must declare instead, if the decline is a swap. */
  instead?: string[];
}

const DECLINED: Record<string, Declined | string> = {
  font: {
    instead: ["font-family", "font-size"],
    reason:
      "the shorthand also sets `line-height`, and `body` is 1.55 against a UA button's `normal` " +
      "— it would have made every button that sets only a `font-size` about 5px taller, five " +
      "rules of them, four on surfaces that could not be reached to check. The two longhands are " +
      "the whole of the bug that was observed. 2026-09-04.",
  },
  "font-feature-settings": "no bug seen; the reading face sets its own features in styles.css.",
  "font-variation-settings": "no bug seen; Geist Variable is driven by `font-weight` alone here.",
  "letter-spacing": "no bug seen, and several controls set their own tracking on purpose.",
  color:
    "`ghost` and `link` and every hand-rolled control set their own colour, and a blanket " +
    "`inherit` would fight them in `base` for no observed gain.",
  "border-radius":
    "we set `border: 0 solid` for the border-style reason, and the radius is always supplied by " +
    "the component — shadcn's `rounded-md`, the pills' 999px. Zeroing it here would be a third " +
    "spelling.",
  opacity: "nothing in this app renders a button at a UA-supplied opacity.",
  appearance:
    "the UA appearance is already defeated by the background and border we set; no bug seen.",
};

/**
 * The same decision list for preflight's `html` rule, added 2026-10-06 with the
 * fourth finding: `-webkit-text-size-adjust`. Without it an iPhone in landscape
 * enlarged the wrapped text in a mode's band by half while the article beside
 * it stayed at its own size (report spya-ar65p3, plan 261006k).
 */
const DECLINED_HTML: Record<string, string> = {
  "line-height": "`body` sets the app's own (styles/shell.css), and `.prose` the article's.",
  "tab-size":
    "keep the browser's tab width for preserved-whitespace article and model content; the app " +
    "has made no four-column tab-width decision.",
  "font-family": "`body` names the app's face from the tokens, and the voices set theirs.",
  "font-feature-settings":
    "the app defines no Tailwind default feature settings; its body and voice rules own the fonts.",
  "font-variation-settings":
    "the app sets no global variation coordinates: weights use `font-weight`, and Source Serif's " +
    "optical sizing remains automatic.",
  "-webkit-tap-highlight-color":
    "keep Safari's native tap feedback: the app does not supply an `:active` state for every link " +
    "and button.",
};

/** Strip comments so a property named in prose is not read as a declaration. */
function decomment(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/** Every property preflight declares on a bare `button`. */
async function preflightButtonProps(): Promise<string[]> {
  const css = decomment(await readFile(PREFLIGHT, "utf8"));
  const props = new Set<string>();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const targetsButton = (selector ?? "")
      .split(",")
      .map((s) => s.trim())
      .some((s) => s === "button" || s.startsWith("button:") || s.startsWith("button["));
    if (!targetsButton) continue;
    for (const decl of (body ?? "").split(";")) {
      const name = decl.split(":")[0]?.trim();
      if (name) props.add(name);
    }
  }
  /* An empty read would pass this file vacuously — the exact shape it exists to
     catch. Preflight has always set at least `font` and `background-color`. */
  expect(props.size, `no button rules found in ${PREFLIGHT}; has preflight moved?`).toBeGreaterThan(
    3,
  );
  return [...props];
}

/** Every property our own `@layer base` block declares on a button. */
async function oursButtonProps(): Promise<string[]> {
  const css = decomment(await readFile(TAILWIND_CSS, "utf8"));
  const base = css.match(/@layer base \{([\s\S]*?)\n\}/g)?.join("\n") ?? "";
  expect(base, "no @layer base block found in tailwind.css").not.toBe("");
  const props = new Set<string>();
  for (const [, selector, body] of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\bbutton\b/.test(selector ?? "")) continue;
    for (const decl of (body ?? "").split(";")) {
      const name = decl.split(":")[0]?.trim();
      if (name) props.add(name);
    }
  }
  return [...props];
}

/** Every property a stylesheet declares in a rule whose selector list names bare `html`. */
function htmlProps(css: string): string[] {
  const props = new Set<string>();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const targetsHtml = (selector ?? "")
      .split(",")
      .some((s) => s.trim() === "html");
    if (!targetsHtml) continue;
    for (const decl of (body ?? "").split(";")) {
      const name = decl.split(":")[0]?.trim();
      if (name) props.add(name);
    }
  }
  return [...props];
}

async function preflightHtmlProps(): Promise<string[]> {
  const props = htmlProps(decomment(await readFile(PREFLIGHT, "utf8")));
  /* As above: an empty read must not pass, and this is the property the check is for. */
  expect(props, `no html rule found in ${PREFLIGHT}; has preflight moved?`).toContain(
    "-webkit-text-size-adjust",
  );
  return props;
}

async function oursHtmlProps(): Promise<string[]> {
  const css = decomment(await readFile(TAILWIND_CSS, "utf8"));
  const base = css.match(/@layer base \{([\s\S]*?)\n\}/g)?.join("\n") ?? "";
  expect(base, "no @layer base block found in tailwind.css").not.toBe("");
  return htmlProps(base);
}

describe("the hand-written preflight substitute", () => {
  it("has a decision recorded for every property preflight sets on a button", async () => {
    const preflight = await preflightButtonProps();
    const ours = new Set(await oursButtonProps());

    const undecided = preflight.filter((p) => !ours.has(p) && !(p in DECLINED));

    expect(
      undecided,
      "Tailwind's preflight sets these on a `<button>` and this app neither mirrors them nor " +
        "records why not. Read each one, then either add it to the @layer base block in " +
        "tailwind.css or add a line to DECLINED in this file saying why not. Three separate " +
        "bugs have come out of this block quietly covering less than it appeared to.",
    ).toEqual([]);
  });

  it("declares whatever a declined property was declined in favour of", async () => {
    /* **The half that catches a swap coming undone.** Declining `font` for two
       longhands and then losing the longhands is the bug of 2026-09-04 exactly,
       and the check above cannot see it: preflight never names `font-family`,
       so nothing compares against it. */
    const ours = new Set(await oursButtonProps());
    const missing: string[] = [];
    for (const [property, entry] of Object.entries(DECLINED)) {
      if (typeof entry === "string") continue;
      for (const swap of entry.instead ?? []) {
        if (!ours.has(swap)) missing.push(`${property} → ${swap}`);
      }
    }
    expect(
      missing,
      "these were declined in favour of something the @layer base block no longer declares, so " +
        "the property is now simply absent — which is the state the decline was meant to avoid",
    ).toEqual([]);
  });

  it("keeps DECLINED honest, listing nothing preflight has stopped setting", async () => {
    /* A reason for declining a property preflight no longer sets is a reason
       nobody will ever re-read, and it makes the list above look more considered
       than it is. */
    const preflight = new Set(await preflightButtonProps());
    const stale = Object.keys(DECLINED).filter((p) => !preflight.has(p));
    expect(
      stale,
      "DECLINED explains why we skip properties preflight does not set any more — delete these",
    ).toEqual([]);
  });

  it("has a decision recorded for every property preflight sets on html", async () => {
    const preflight = await preflightHtmlProps();
    const ours = new Set(await oursHtmlProps());
    const undecided = preflight.filter((p) => !ours.has(p) && !(p in DECLINED_HTML));
    expect(
      undecided,
      "Tailwind's preflight sets these on `html` and this app neither mirrors them in the " +
        "@layer base block in tailwind.css nor records why not in DECLINED_HTML.",
    ).toEqual([]);
  });

  it("switches Safari's landscape text autosizing off, at 100%", async () => {
    /* The check above compares names, so `auto` would pass it. This is the value. */
    const css = decomment(await readFile(TAILWIND_CSS, "utf8"));
    const base = css.match(/@layer base \{([\s\S]*?)\n\}/g)?.join("\n") ?? "";
    const html = [...base.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, selector]) => (selector ?? "").trim() === "html")
      .map(([, , body]) => (body ?? "").replace(/\s+/g, ""))
      .join("");
    expect(html).toContain("-webkit-text-size-adjust:100%;");
    expect(html).toMatch(/(^|;)text-size-adjust:100%;/);
  });

  it("keeps DECLINED_HTML honest: nothing preflight stopped setting, nothing we now set", async () => {
    const preflight = new Set(await preflightHtmlProps());
    const ours = new Set(await oursHtmlProps());
    const stale = Object.keys(DECLINED_HTML).filter((p) => !preflight.has(p) || ours.has(p));
    expect(stale, "delete these from DECLINED_HTML").toEqual([]);
  });
});
