/**
 * **`className="linky"` only works under four ancestors, and nothing said so.**
 *
 * styles.css is explicit that this is deliberate — *"`.linky` is a shape, not a
 * shared class: the `.controls` one and this one are two independent rules that
 * happen to agree about underlines"* — and there is no unscoped rule anywhere.
 * So a `linky` on a button outside `.controls`, `.cmt-dialog`, `.chat-dialog`
 * or `.annotate-dialog` matches nothing at all, and the button renders as bare
 * text with no underline and no affordance.
 *
 * **Four buttons were in that state, in three files, for weeks.** The sharing
 * card's Share — the page's one irreversible control, reading as a line of
 * prose — plus `BillingSection`'s *Try again*, both of `SettingsSection`'s, and
 * `AnnotateDialog`'s *Cancel* beside a bordered Save. Nobody reported any of
 * them, because a class that matches no rule looks exactly like a class that
 * works: the markup is right, the class is on the element, and only the
 * cascade knows. docs/reusable/silent-success.md. Found 2026-09-04.
 *
 * ## Why this is a source scan and not a rendering test
 *
 * The honest check is *"does this button have a styled ancestor at runtime"*,
 * which needs the real page, the real stylesheet and jsdom's cascade — and
 * jsdom does not apply stylesheets to `getComputedStyle` for anything but
 * inline styles, so the honest check cannot be written here at all. A source
 * scan is weaker: it asks whether the file that uses the class also *mentions*
 * a scoping ancestor, which a sufficiently strange component could satisfy
 * while still rendering the button somewhere else.
 *
 * It is worth having anyway, because the failure it catches is the one that
 * actually happened four times: somebody copies a `linky` button into a
 * component that has never heard of these four containers. Stated plainly so
 * the next reader knows what it does not prove.
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = new URL("../src/web/", import.meta.url).pathname;

/**
 * The ancestors styles.css actually scopes the class to, read **out of the
 * stylesheet** rather than typed in here — so adding a fifth scope makes this
 * test allow it, and deleting one makes it fail, without anybody remembering
 * this file exists.
 */
async function scopes(): Promise<string[]> {
  const css = await readFile(join(WEB, "styles.css"), "utf8");
  const found = [...css.matchAll(/^\.([a-z-]+) button\.linky \{/gm)].map((m) => m[1] as string);
  /* If this ever comes back empty the test would pass vacuously for every file
     — the exact shape of silent success it exists to catch. */
  expect(found.length, "no `.<ancestor> button.linky` rules found in styles.css").toBeGreaterThan(0);
  return found;
}

/**
 * **The source with its block comments taken out**, which both checks below run
 * against — and the second half of the same lesson.
 *
 * Every file this test is about now carries a comment explaining the bug, and
 * those comments quote the offending markup verbatim: `AccessSharing.tsx` says
 * *"`className="linky"` styles nothing here"*. So the use-detector matched the
 * explanation of the fix and reported the fixed file as an offender. The
 * scope-detector had the mirror image of it. Both halves of this test were
 * reading prose about the code as though it were the code.
 *
 * Block comments only — `/* … *\/` and the `{/* … *\/}` JSX form, which is
 * where all of this app's explanation lives. A `//` line comment would need
 * care around the `//` in a URL, and nothing here needs it.
 */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ");
}

/**
 * Does `src` put `scope` at the **start of a `className` value** — i.e. is it
 * the container's own class, rather than a word in a sentence?
 *
 * **The first version of this test asked `src.includes(scope)`, and it passed
 * against the bug it was written to catch.** The three files I had just fixed
 * each carry a comment explaining why they no longer use `linky` — and those
 * comments name all three scoping ancestors in prose. So reinstating the bug in
 * `BillingSection.tsx` left the test green, because the file still *mentioned*
 * `.controls`. A check that agrees with the code because it shares a string
 * with the code's comments is the same silent-success shape as the bug, written
 * into the guard against it. Caught by running the guard red before trusting
 * it, 2026-09-04.
 *
 * Anchored at the opening quote or backtick, so `className="cmt-dialog"` and
 * ``className={`cmt-dialog${dodging ? " dodging" : ""}`}`` both count and
 * `className="chat-dialog-label"` does not.
 */
function opensAClassName(src: string, scope: string): boolean {
  return new RegExp(`className=(?:"|\\{\`)${scope}(?=["\`\\s$\\{])`).test(src);
}

async function tsxFiles(): Promise<string[]> {
  const names = await readdir(WEB);
  return names.filter((n) => n.endsWith(".tsx"));
}

describe("the `linky` class", () => {
  it("is only used in components that also carry one of its scoping ancestors", async () => {
    const allowed = await scopes();
    const offenders: string[] = [];

    for (const name of await tsxFiles()) {
      /* Comments stripped first, and that is load-bearing rather than tidy —
         see `withoutComments`. Three of these files explain this very bug in a
         comment that quotes the markup, and both checks below matched the
         explanation. */
      const src = withoutComments(await readFile(join(WEB, name), "utf8"));
      if (!/className=(?:"linky"|\{`linky)/.test(src)) continue;
      if (!allowed.some((scope) => opensAClassName(src, scope))) offenders.push(name);
    }

    expect(
      offenders,
      `these use className="linky" with no ancestor that styles it (${allowed.join(", ")}), ` +
        "so the button renders as bare text",
    ).toEqual([]);
  });
});
