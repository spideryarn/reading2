/**
 * **The one rule for drawing a control that is behind the experimental-features
 * switch**, in one place, because there are now two rows of controls that obey
 * it and a second copy is a second thing to get wrong.
 *
 * A control is drawn when it is not experimental, **or** the switch is on, **or**
 * it is the one the reader is currently in. That third clause is the half that
 * is easy to lose and the reason this is shared rather than written twice:
 *
 *  - both rows are a `role="radiogroup"`, where exactly one child must be
 *    checked — a hidden *current* control leaves a group announcing
 *    *one of these* with none of them on;
 *  - both are addressable by URL (`?mode=`, `?diagram=`), and **hidden means
 *    hidden from the controls, not unreachable**: a link somebody shared, or a
 *    bookmark from before the switch existed, has to keep working and has to
 *    show both readers the same band whatever their switches say.
 *    docs/project/experimental-features.md.
 *
 * Neither call site is a gate. The switch is about clutter, and nothing on the
 * server reads it — see the same doc, and `docs/project/security-map.md` for
 * where Diagram's real boundary lives (`access` in DiagramPanel.tsx, and
 * `requireUser` on the two endpoints that spend).
 *
 * **Named fields rather than three positional booleans.** Every argument here
 * is a `boolean`, so a swapped pair would type-check and silently draw the
 * wrong row.
 *
 * The two callers are `visibleModes` (Dock.tsx) and `visibleKinds`
 * (DiagramPanel.tsx). A third should call this, not copy it.
 */
export function shownBehindTheSwitch({
  experimental,
  on,
  current,
}: {
  /** Is this control itself behind the switch? */
  experimental: boolean;
  /** Is the reader's experimental-features switch on? */
  on: boolean;
  /** Is this the control the reader is in right now — whatever the URL says? */
  current: boolean;
}): boolean {
  return !experimental || on || current;
}
