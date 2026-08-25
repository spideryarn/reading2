/**
 * The column-context pills — four experiments and a progress hairline, each
 * with a tooltip that says what it does, why it exists, and what the research
 * and GPT's review said about it. See docs/project/column-context.md.
 *
 * Greg, 2026-08-25:
 *
 * > try implementing it multiple ways, with buttons to toggle them on/off so
 * > we can play with and compare various ideas. For each one, add a rich
 * > tooltip to the button explaining the working/intent/research.
 *
 * The three column treatments share one URL parameter (`?ctx=`), so pressing
 * one releases the others; the hairline is its own bit (`?prog=1`). Both push
 * history like `cols` — see params.ts. This component owns its own query
 * state rather than being handed it by App, so that App's controls bar gains
 * one line, not a wiring harness; nuqs keeps every reader of a parameter in
 * step.
 *
 * Tooltips are the same Floating UI `Tooltip` the spine uses, made
 * `interactive` so the research links can actually be followed.
 */
import { useQueryState } from "nuqs";
import { Toggle } from "@/components/ui/toggle";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { ctxParam, progParam } from "./params.js";
import type { ContextMode } from "./context.js";

interface Explain {
  title: string;
  how: string;
  intent: string;
  research: { text: string; href: string; note: string }[];
  /** What the GPT design review said, 2026-08-25. Kept even where we overruled it. */
  gpt: string;
  cost: string;
}

const HORNBAEK = {
  text: "Hornbæk & Hertzum 2007",
  href: "https://www.kasperhornbaek.dk/papers/TOCHI2007_FisheyeMenus.pdf",
  note: "eye-tracking: people barely look at a fisheye's shrunk periphery. For finding a known item, plain hierarchical menus were much faster than fisheye ones; for browsing, the times did not differ. So the periphery is a landmark, not content — tiers are discrete and the far ones are only meant to be distinguishable.",
};
const FURNAS = {
  text: "Furnas 1986",
  href: "https://cspages.ucalgary.ca/~saul/581/exer.eps/4furnas86.pdf",
  note: "degree of interest = importance − distance from focus. Siblings counts distance in the tree — a sibling is near, a section in another part is beyond the list — while the panels count distance along the list and let the part headings mark the tree's boundaries.",
};
const WIKIPEDIA = {
  text: "Wikipedia's ToC user testing (2022–23)",
  href: "https://www.mediawiki.org/wiki/Reading/Web/Desktop_Improvements/Repository/Sticky_Header_and_Table_of_Contents_User_Testing",
  note: "three separate findings: the persistent sidebar outline ranked first across every group tested; prototypes that showed more of the outline did better; and readers asked for the current section to be bolded so they could tell where they were. Put together, that is a full list with a cursor — but the study did not test that combination against the rest as one thing.",
};
const VSCODE = {
  text: "VS Code Sticky Scroll",
  href: "https://devblogs.microsoft.com/visualstudio/sticky-scroll-stay-in-the-right-context/",
  note: "pins the enclosing scopes as you scroll into nested code — about five lines at most — and users asked to choose whether inner or outer context wins when there is no room for both.",
};

const MODES: { mode: ContextMode; label: string; explain: Explain }[] = [
  {
    mode: "siblings",
    label: "Siblings",
    explain: {
      title: "Siblings — the level's outline, inside the cell",
      how: "In the cell you are reading, the sticky box lists that level's siblings: every part at L1; the sections of the current part at L2, with the previous and next part named faintly at either end. The current one keeps its title and gist; the two next to it show a title; the rest show a fainter title, and the ones already read fade. Other cells on screen draw as before. Focus follows the scroll, never the pointer.",
      intent:
        "Greg's ask was to scan up and down a column and see what came before and where this sits. A list with a cursor does that without leaving the cell: the list lives inside the cell it describes and stops where the next cell starts. (The current title itself sits a few lines down, under its earlier siblings, not on the cell's top edge.)",
      research: [WIKIPEDIA, FURNAS, HORNBAEK],
      gpt: "Keep — the most genuinely local experiment. Cap the item count; never apply it to the leaf column, where there is no gist to show (it isn't).",
      cost: "A cell shorter than its list clips it: a one-paragraph section cannot hold a list of six siblings, and the sticky box has no range to slide in. The Panel modes exist to compare against exactly that.",
    },
  },
  {
    mode: "neighbours",
    label: "Neighbours",
    explain: {
      title: "Neighbours — the item before, and the one after",
      how: "The previous item's title sits faintly above the current gist, and the next item's title is pinned to the bottom of the viewport for as long as the current cell runs on below it — then it settles at the cell's end, where the next cell begins. Nothing else changes.",
      intent:
        "The minimal version. Answers 'what's next' and 'what was that' without adding a list, keeping the columns as clean as they are now. VS Code's sticky scroll, both ways.",
      research: [VSCODE, HORNBAEK],
      gpt: "Cut — it adds little and rests on the weakest CSS mechanism (a bottom-stuck element only has range if it is laid out at the cell's bottom, so the cell needs an absolutely positioned fill for it to live in). Kept anyway, as the cheapest thing to compare the richer modes against.",
      cost: "For the moment the current cell's end and the next cell's start are both on screen, the pinned '↓ next' line sits directly above the next cell's own title — briefly doubled.",
    },
  },
  {
    mode: "panel",
    label: "Panel",
    explain: {
      title: "Panel — the whole level, in a window over the column",
      how: "A fixed panel covers the column from the header to the bottom of the window and lists the entire level — every part, or every section with its part as a heading — with the current item open. The list stays still and slides only when the current item would leave a comfortable band of the panel. It is clipped, not scrollable: whatever falls outside is not shown, so the wheel always moves the article and never the panel.",
      intent:
        "Wikipedia's tested winner, per level: show everything, mark where you are, move as little as possible. Never clips on a short cell, because it is not in the cell.",
      research: [WIKIPEDIA, HORNBAEK],
      gpt: "Keep as the main candidate, but call it a bounded context window — a level can hold dozens of sections and they cannot all be readable at once. Note that it knowingly steps outside the table's alignment invariant: the panel's rows are not the table's rows.",
      cost: "The current title no longer starts where its text starts, and the panel is an equal-weight list where the spine is deliberately proportional — two ideas of 'where am I' on one screen.",
    },
  },
  {
    mode: "centred",
    label: "Centred",
    explain: {
      title: "Centred — the current item held at the reading line",
      how: "The same panel, but the list slides so that the current item always sits on the focus line, 40% down the window, with its neighbours above and below in three fixed tiers. 'Current' here is the item under that focus line, not the one under the header — the item you are looking at, not the one whose cell has just handed over.",
      intent:
        "Greg's own sketch: \"always have the current cell centred and then show stuff above and below smaller.\" Built as he described it so it can be compared honestly with the others.",
      research: [HORNBAEK, FURNAS],
      gpt: "Merge with Panel as an anchor choice — same data, same DOM, different resting place — which is how it is built. And name the two 'current' lines separately, which is why this one has its own.",
      cost: "At the first and last items, centring leaves the panel half empty. And the research is unkind to the premise: nobody reads the shrunk items, so a centred fisheye buys a sense of position rather than information.",
    },
  },
];

const PROGRESS: Explain = {
  title: "Progress — how far through this item you are",
  how: "A hairline under the current item, at every level on screen, filling as you read through it. Measured from the cell's real height, written straight to a CSS variable on every scroll frame, and never through React.",
  intent:
    "The arc column already says '5 / 9'. This says how far into the 5 you are, at every level at once, without a number.",
  research: [VSCODE],
  gpt: "Keep, only as an independent toggle and only with direct CSS updates. Test whether it adds anything the spine's viewport band doesn't.",
  cost: "One more moving thing in the corner of the eye. If it is noise, it is a single toggle to lose.",
};

function ExplainCard({ e }: { e: Explain }) {
  return (
    <div className="tip-explain">
      <div className="tip-crumb">Column context</div>
      <div className="tip-title">{e.title}</div>
      <p>
        <span className="tip-label">How</span> {e.how}
      </p>
      <p>
        <span className="tip-label">Why</span> {e.intent}
      </p>
      <p>
        <span className="tip-label">Research</span>{" "}
        {e.research.map((r, i) => (
          <span key={r.href}>
            {i > 0 && " · "}
            <a href={r.href} target="_blank" rel="noreferrer noopener">
              {r.text}
            </a>
            : {r.note}
          </span>
        ))}
      </p>
      <p>
        <span className="tip-label">GPT's review</span> {e.gpt}
      </p>
      <p className="tip-cost">
        <span className="tip-label">Cost</span> {e.cost}
      </p>
    </div>
  );
}

export function ContextControls({ pill }: { pill: string }) {
  const [ctx, setCtx] = useQueryState("ctx", ctxParam);
  const [prog, setProg] = useQueryState("prog", progParam);
  return (
    <TooltipGroup delay={{ open: 500, close: 120 }}>
      <span className="controls-label ctx-label">Context</span>
      {MODES.map(({ mode, label, explain }) => (
        <Tooltip
          key={mode}
          placement="bottom"
          className="tip-explain-panel"
          interactive
          content={<ExplainCard e={explain} />}
        >
          <Toggle
            className={pill}
            pressed={ctx === mode}
            onPressedChange={() => void setCtx(ctx === mode ? "off" : mode)}
          >
            {label}
          </Toggle>
        </Tooltip>
      ))}
      <Tooltip
        placement="bottom"
        className="tip-explain-panel"
        interactive
        content={<ExplainCard e={PROGRESS} />}
      >
        <Toggle className={pill} pressed={prog} onPressedChange={() => void setProg(!prog)}>
          Progress
        </Toggle>
      </Tooltip>
    </TooltipGroup>
  );
}
