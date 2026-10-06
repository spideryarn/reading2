# State prose can pass with the promised control missing

Review of `134376afd` found a gap in the new metadata retry test: it promised that
the sharing switch returned, but checked only the private-state sentence. Its
fixture omitted `available`, so the real card correctly withheld the publish
button. This is a coverage defect; no production defect or reader impact has
been established from this gap.

## The class: state prose can pass with the promised control missing

The test named a recovered control but asserted a neighbouring sentence. Its
fixture satisfied the sentence's prerequisites and failed the control's separate
inventory prerequisite. A successful state read and an actionable control are
different claims, so the former cannot prove the latter.

The gap was introduced by `134376afd` in
[`tests/metadata-sharing-card.test.tsx`](../../tests/metadata-sharing-card.test.tsx),
in `asks again after a failed read, and draws the switch when one lands`.
The committed fixture is `{ visibility: "private", publicAt: null, personalised: [] }`;
the committed recovery assertion is `toContain("Only you can read this")`.
[`AccessSharing`](../../src/web/AccessSharing.tsx) requires `inventory` before it
offers the publish button. The existing test `offers no share button when the body
carried no artefact flags` deliberately covers exactly this fixture's state.

## Why nothing went red

Removing retries made the new test fail, proving recovery of the read and its
sentence. It did not prove the stronger behaviour in the test name. The fixture's
missing flags made the button absent even when retries worked, and no assertion
observed that absence. The file's existing `ALL_BUILT` fixture already explains
this distinction; the new test bypassed it.

## Fix and evidence

Use the existing typed `ALL_BUILT` as `available`, and assert that an actual
`button` containing `Share with anyone` appears after recovery. First add that
button assertion to the committed fixture and watch it fail; then correct the
fixture and watch it pass. The added assertion failed before the fixture change:
`AssertionError: expected false to be true` at line 560, with one failed test.
The requested two-file Vitest run then passed all 77 tests. The typecheck script
passed via `node --import tsx scripts/typecheck.ts`; `npm run typecheck` itself
was blocked by the sandbox refusing the launcher's IPC socket (`listen EPERM`).

This is also the long-term fix: a test promising a restored control must render
the real control with its prerequisites and observe that control. No production
change is required for the intentional inventory gate.

## Countermeasures, ranked by ease against value

1. **Assert the promised control itself** — one assertion, high value. This
   catches a recovered sentence with a missing button in any similar view.
2. **Reuse typed valid fixtures for unrelated fields** — one fixture field here.
   This keeps recovery tests on the successful path while separate tests exercise
   invalid inventory. The existing `ALL_BUILT` is sufficient.
3. **Add a universal test-name-to-assertion checker** — rejected. Determining
   whether prose promises match DOM assertions would cost more than this narrow
   guard and provide weaker evidence than observing the actual control.

Related: [silent success](../reusable/silent-success.md) and the owning
[postmortem collection](../project/postmortems.md).
