/**
 * A throwaway page for looking at a formatted chat answer in a browser.
 *
 * It draws `CitedMarkdown` inside the real `.mode-band.chat > .chat-scroll >
 * .chat-turn.model` chain, so the answers below are laid out by the rules that
 * ship, at the width that ships — outside the auth gate and without an article,
 * a session or a model call. Delete when the check is done; it is not in the
 * router and nothing links to it. docs/plans/chat-markdown.md.
 */
import { createRoot } from "react-dom/client";
import { CitedMarkdown, CitedText } from "./Cited.js";
import { MODE_MIN, SPINE_W } from "./layout.js";
import type { BlockId } from "../types.js";
import "./tailwind.css";

/** Two article blocks, so the citations in these answers are real ones. */
const BLOCKS = new Map<string, string>([
  ["spya-k3m9qt", "Consciousness, he argues, is not a property of computation but of living matter."],
  ["spya-p7w2dn", "The substrate independence thesis is doing more work here than it can bear."],
]);

const ANSWERS: [string, string][] = [
  [
    "a bullet list — the shape this was all for",
    `He gives three reasons, and they are not equally strong:

- **Metabolism.** A living cell is doing thermodynamic work every second [spya-k3m9qt].
- **Boundaries.** What counts as the system is decided by the organism, not by us.
- **History.** A brain is the residue of its own past, and a simulation is not.

The first is the one the rest lean on.`,
  ],
  [
    "a numbered list, nested, starting where the model said",
    `3. The third move is where it gets shaky:
   - he treats "substrate" as though it meant "material" [spya-p7w2dn]
   - and then argues against the second
4. The fourth move inherits the problem.`,
  ],
  [
    "a heading, a quote and a rule",
    `## Where the argument turns

He is explicit about it:

> The question is not whether a simulation could think, but whether thinking is
> the kind of thing a simulation could be.

---

Everything after that paragraph depends on it.`,
  ],
  [
    "code, inline and fenced",
    `The word he keeps using is \`substrate\`, and the id \`spya-k3m9qt\` is a string
here rather than a chip. His toy example is this:

\`\`\`python
def think(state):
    return step(state)
\`\`\`

which is exactly the picture he is arguing against.`,
  ],
  [
    "an ordinary answer, which must look exactly as it always did",
    `He does not say that anywhere in the piece.

What he says is narrower: that a functional duplicate would lack something he
calls "mattering" [spya-k3m9qt]. Whether that is the same claim is the
interesting question, and he never quite settles it.`,
  ],
  [
    "still arriving: an unclosed fence, mid-token",
    `Here is the shape of it:

\`\`\`ts
const answer = await stream(`,
  ],
  [
    "the narrow column against long unbroken things",
    `The identifier is \`someExtremelyLongIdentifierNobodyShouldHaveWritten\`, and the
block below has no spaces to break at either:

\`\`\`
const x = aVeryLongFunctionName(withAnArgument, andAnother, andAThirdOne, andAFourth);
\`\`\``,
  ],
  [
    "the eight things a review caught",
    `# Learn C#

He calls it **the *hard* problem** throughout, links it as
[run \`npm test\`](https://example.com/x), and writes café_naïve_été without meaning
any of it in italics.`,
  ],
  [
    "the refusals — none of this should be interpreted",
    `**Bold openings** are the commonest thing a model writes, and they are not bullets.

He multiplies it out as 2 * 3 * 4, mentions some_variable_name, and writes an
unclosed ** marker. The #1 argument survives too. He wrote <b>bold</b> in the
original, which you should be reading as characters.`,
  ],
];

function Preview() {
  return (
    /* `.reader` and the two custom properties App sets at runtime, for the
       reason preview-colour.tsx gives at length: `.mode-band` is
       `position: fixed; left: var(--spine-w); width: var(--mode-w)`, and both
       are declared on `.reader` alone. Without them the band shrink-wraps and
       every width judgement made from a screenshot is meaningless. */
    <div
      className="reader"
      style={{ ["--spine-w" as string]: `${SPINE_W}px`, ["--mode-w" as string]: `${MODE_MIN}px` }}
    >
      <div className="mode-band chat" style={{ position: "static", width: MODE_MIN }}>
        <div className="chat-scroll">
          {ANSWERS.map(([label, text]) => (
            <div key={label}>
              <div
                style={{ margin: "1.2rem 0 0.4rem", color: "#888", font: "11px/1.3 monospace" }}
              >
                {label}
              </div>
              <div className="chat-turn model">
                <CitedMarkdown
                  text={text}
                  blocks={BLOCKS}
                  onJump={(id: BlockId) => console.log("jump", id)}
                  links
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The summary panel's path, which is the same component in **flat** mode.
 *
 * Worth having on this page because it is the half with no structure: marks
 * yes, blocks no, and a block that is not a paragraph drawn as the characters
 * the model wrote rather than flattened — which would delete the `- ` from
 * every line of a list. docs/plans/chat-markdown.md § Two things left alone.
 */
const SUMMARIES: [string, string][] = [
  [
    "an ordinary summary, with marks and a citation",
    "He argues that **mattering** is what a functional duplicate lacks [spya-k3m9qt], and that the question is prior to the empirical one.",
  ],
  [
    "two paragraphs — blank lines, not elements",
    "The first move is the one that matters.\n\nEverything after it is consequence.",
  ],
  [
    "a list, which a summary must show rather than flatten",
    "Two things:\n\n- the first\n- the second",
  ],
];

function Summaries() {
  return (
    <div style={{ width: MODE_MIN, padding: "0.7rem" }}>
      {SUMMARIES.map(([label, text]) => (
        <div key={label}>
          <div style={{ margin: "1.2rem 0 0.4rem", color: "#888", font: "11px/1.3 monospace" }}>
            {label}
          </div>
          <p className="summ-text">
            <CitedText text={text} blocks={BLOCKS} onJump={(id: BlockId) => console.log(id)} />
          </p>
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <>
    <Preview />
    <Summaries />
  </>,
);
