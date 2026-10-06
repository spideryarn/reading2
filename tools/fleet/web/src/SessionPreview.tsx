/**
 * **What a compact session card left out, as a card you read without opening
 * the session.**
 *
 * Beside an open detail the list is a 340px column and its cards are `compact`
 * (SessionsPanel.tsx): the description is clamped to two lines and a question
 * keeps only its prompt and "N options — open it to read them". This is the
 * other half, drawn in the `Tooltip` on the card's title button, so a reader
 * can decide whether to switch session before switching.
 *
 * **Nothing in here may be focusable, and no `Explain` or `Tooltip`.** The
 * surface is `pointer-events: none` with `role="tooltip"` (tailwind.css
 * § tooltip): a pointer cannot enter it and a keyboard cannot reach into it, so
 * a control here would be one nobody can press. That is why this does not reuse
 * `StatusPill`, `Uptime`, `Handles` or `QuestionCard`, all of which carry
 * `Explain` buttons, and builds from the same formatters instead.
 *
 * **It cannot scroll either, so it is bounded, and every bound is said.** A
 * long description or prompt is cut at {@link PREVIEW_TEXT_CAP} characters and
 * a long menu at {@link PREVIEW_OPTION_CAP} options, each followed by a line
 * saying the rest is in the session. Cut in the data rather than with
 * `line-clamp`, because a clamp cannot know whether it clipped anything and so
 * cannot say so. The question's material is never shown: it can be a whole
 * diff, and the place to read what you are approving is beside the buttons.
 *
 * Everything comes off the pushed row. No fetch.
 */
import type { ReactNode } from "react";

import { cx, toneClasses } from "./ui";
import type { FleetRow } from "./types";
import { statusLabel, whereLine } from "./view";

/** How many of a question's options the preview lists before saying how many more there are. */
export const PREVIEW_OPTION_CAP = 6;

/** How many characters of a description, or of a prompt, the preview shows. About eleven lines at its width. */
export const PREVIEW_TEXT_CAP = 600;

/** `text`, or its first `cap` characters and the fact that it was cut. */
function cutAt(text: string, cap: number): { text: string; cut: boolean } {
  if (text.length <= cap) return { text, cut: false };
  return { text: `${text.slice(0, cap).trimEnd()}…`, cut: true };
}

const CUT_NOTE = "Cut short here — open the session to read the rest.";

/** A paragraph that may have been cut, and says so when it was. */
function Bounded({ text, className }: { text: string; className: string }): ReactNode {
  const shown = cutAt(text, PREVIEW_TEXT_CAP);
  return (
    <>
      <p className={className}>{shown.text}</p>
      {shown.cut ? (
        <p data-cut className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
          {CUT_NOTE}
        </p>
      ) : null}
    </>
  );
}

export function SessionPreview({
  row,
  heading,
}: {
  row: FleetRow;
  /**
   * The card's own heading, from `headingFor` — passed rather than recomputed
   * so the preview cannot name the session differently from the button it
   * describes. (And `headingFor` lives in SessionsPanel.tsx, which imports
   * this file.)
   */
  heading: string;
}): ReactNode {
  const label = statusLabel(row.status);
  const tone = toneClasses(label.tone);
  const where = whereLine(row);
  const dir = row.meta.version === 1 ? row.meta.dir : null;
  const question = row.question;
  const shownOptions = question === null ? [] : question.options.slice(0, PREVIEW_OPTION_CAP);
  const moreOptions = question === null ? 0 : question.options.length - shownOptions.length;

  return (
    <div className="session-preview tw:text-[13px] tw:leading-snug tw:break-words tw:text-ink">
      <p className="tw:font-medium">{heading}</p>
      <p className={cx("tw:mt-0.5 tw:text-[11px] tw:font-semibold tw:tracking-wide tw:uppercase", tone.ink)}>
        {label.text}
      </p>
      {label.detail !== null ? <p className={cx("tw:mt-0.5", tone.ink)}>{label.detail}</p> : null}

      {row.description.kind === "described" ? (
        <Bounded text={row.description.description} className="tw:mt-1.5 tw:text-ink-soft" />
      ) : null}

      {where === null ? (
        <p className="tw:mt-1.5 tw:text-ink-faint">no repo recorded</p>
      ) : (
        <p className="tw:mt-1.5 tw:text-ink-soft">{where}</p>
      )}
      {dir !== null ? <p className="tw:text-[12px] tw:text-ink-faint">{dir}</p> : null}

      {question !== null ? (
        <div className="tw:mt-2 tw:border-t tw:border-rule tw:pt-2">
          <p className="tw:text-[11px] tw:font-semibold tw:tracking-wide tw:text-needs-ink tw:uppercase">Asking</p>
          <Bounded text={question.prompt} className="tw:mt-0.5 tw:font-medium" />
          {question.options.length === 0 ? (
            <p className="tw:mt-1 tw:text-ink-faint">No options could be read off the pane.</p>
          ) : (
            <ul className="tw:mt-1 tw:list-disc tw:pl-4 tw:text-ink-soft">
              {shownOptions.map((option, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: options carry no id, two can share a label, and these items hold no state; a new row replaces the list whole.
                <li key={`${index}-${option.label}`}>{option.label}</li>
              ))}
            </ul>
          )}
          {moreOptions > 0 ? (
            <p className="tw:mt-0.5 tw:text-[11px] tw:text-ink-faint">
              and {moreOptions} more — open the session to read them.
            </p>
          ) : null}
          {question.material.kind === "read" ? (
            <p className="tw:mt-1 tw:text-[11px] tw:text-ink-faint">
              What it would approve is not shown here — open the session to read it.
            </p>
          ) : question.material.kind === "unreadable" ? (
            <p className="tw:mt-1 tw:text-[11px] tw:text-ink-faint">What it would approve could not be read.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
