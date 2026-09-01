/**
 * Referee mode's vocabulary: the mode itself, and its four sub-modes.
 *
 * Stage 1 of docs/plans/260831an-referee-mode-for-peer-reviewers.md builds a
 * mode that calls no model, so there is nothing here about prompts or costs.
 * What there is worth holding at this stage is the pair of things that go wrong
 * silently: a `?referee=` value this build does not recognise opening a broken
 * page instead of the default, and a mode that has no label because
 * `MODE_LABEL` was the one required record somebody did not have to fill in.
 * The second is a compile error today — which is the design — and this test is
 * what says so if the record ever loses its `Record<Mode, string>` annotation.
 *
 * Deterministic, no network, no model call, like everything under tests/.
 */
import { describe, expect, it } from "vitest";

import { isMode, MODES } from "../src/modes.js";
import {
  DEFAULT_REFEREE_VIEW,
  isRefereeView,
  REFEREE_VIEWS,
  type RefereeView,
} from "../src/web/referee-views.js";
import { MODE_LABEL } from "../src/title-text.js";
import { refereeParam } from "../src/web/params.js";

describe("the referee mode itself", () => {
  it("is a mode, and the server's guard agrees", () => {
    expect(MODES).toContain("referee");
    expect(isMode("referee")).toBe(true);
  });

  it("has a label, and so does every other mode", () => {
    expect(MODE_LABEL.referee).toBe("Referee");
    /* Over `MODES` rather than a list retyped here: `MODE_LABEL` is a required
       `Record<Mode, string>` so a missing entry cannot compile, and this is the
       check that the annotation is still doing that job. A `Partial<>` slipped
       in later would leave an untitled tab and nothing else would notice. */
    for (const mode of MODES) {
      expect(MODE_LABEL[mode], `${mode} has no label`).toBeTruthy();
    }
  });

  it("is a sibling of Search rather than of Remember", () => {
    /* Not a decoration: `remember` — `review` until 2026-09-01, and renamed
       partly because of this very adjacency — is a different mode with a
       different job, and the plan's § "The name is `referee`, not `reviewer`"
       is about keeping one word for one thing. If somebody renames this to
       `reviewer` they should have to come here and argue with the sentence. */
    expect(MODES).toContain("remember");
    expect(MODES).not.toContain("review");
    expect(MODES).not.toContain("reviewer");
    expect(MODES.indexOf("referee")).toBe(MODES.indexOf("search") + 1);
  });
});

describe("which sub-mode a link asks for", () => {
  it("recognises the four, and nothing else", () => {
    for (const view of REFEREE_VIEWS) expect(isRefereeView(view)).toBe(true);
    expect(isRefereeView("verdict")).toBe(false);
    expect(isRefereeView("Criteria")).toBe(false);
    expect(isRefereeView("")).toBe(false);
    expect(isRefereeView(null)).toBe(false);
    expect(isRefereeView(undefined)).toBe(false);
  });

  it("degrades an unknown value to the default rather than erroring", () => {
    /* The rule every parser in src/web/params.ts follows. `parse` returning
       null is what nuqs reads as "use the default", so these two assertions are
       the whole of it: a `?referee=` from a future version — or from a past one
       naming a sub-mode since renamed — opens Criteria and not an error page. */
    expect(refereeParam.parse("verdict")).toBeNull();
    expect(refereeParam.parse("")).toBeNull();
    expect(refereeParam.defaultValue).toBe(DEFAULT_REFEREE_VIEW);
    expect(refereeParam.defaultValue).toBe("criteria");
  });

  it("keeps the ones it does know", () => {
    for (const view of REFEREE_VIEWS) expect(refereeParam.parse(view)).toBe(view);
  });

  it("round-trips every one of them through the query string", () => {
    for (const view of REFEREE_VIEWS) {
      const written: string = refereeParam.serialize(view);
      expect(refereeParam.parse(written)).toBe(view);
    }
  });

  it("names the default as one of them", () => {
    /* `DEFAULT_REFEREE_VIEW` is typed `RefereeView`, so this is belt and braces
       — but the annotation is one edit away from being widened, and a default
       outside the list would leave the mode opening a panel that does not
       exist. */
    const fallback: RefereeView = DEFAULT_REFEREE_VIEW;
    expect(REFEREE_VIEWS).toContain(fallback);
  });

  it("carries the editor's question last, and it is not the default", () => {
    /* `candidates` is the one sub-mode that is not the referee's own question —
       it is an editor asking who should review this — and Greg added it on
       2026-08-31 over the cut the plan's appendix argues for. Last in the list
       and never the landing view: somebody who opened Referee mode is almost
       always the referee. */
    expect(REFEREE_VIEWS).toContain("candidates");
    expect(REFEREE_VIEWS[REFEREE_VIEWS.length - 1]).toBe("candidates");
    expect(DEFAULT_REFEREE_VIEW).not.toBe("candidates");
  });
});
