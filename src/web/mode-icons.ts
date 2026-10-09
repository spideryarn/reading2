/**
 * **The icon each mode wears**, everywhere it is drawn: on the bar
 * (`MODES_UI` in Dock.tsx, which reads this and keeps no icon of its own) and
 * on a row of Chat's list that came from that mode (ChatPanel.tsx §
 * `ThreadSourceMark`). docs/project/icons.md: a control that takes you into a
 * mode uses that mode's icon.
 *
 * A file of its own because the second reader could not import the Dock: the
 * icons lived in its unexported `MODES_UI` until 2026-10-05, and the panel had
 * begun a copy (plan
 * docs/plans/261005i-chats-started-from-a-mode-a-thread-remembers-where-it-began.md,
 * D5). Why each glyph was chosen is still said beside its row in `MODES_UI`,
 * where the bar's order is argued.
 *
 * A `Record` over `Mode`, so a new mode does not compile until it has one.
 */
import {
  AlignLeft,
  BadgeQuestionMark,
  BookA,
  BookText,
  Brain,
  ClipboardCheck,
  Clock,
  Columns2,
  Layers,
  Lightbulb,
  type LucideIcon,
  MessagesSquare,
  Network,
  PanelRight,
  Quote,
  Route,
  Search,
} from "lucide-react";
import type { Mode } from "../modes.js";

export const MODE_ICON: Readonly<Record<Mode, LucideIcon>> = {
  plain: AlignLeft,
  structure: Columns2,
  summary: Layers,
  diagram: Network,
  skim: Route,
  quotes: Quote,
  glossary: BookA,
  faq: BadgeQuestionMark,
  ideas: Lightbulb,
  timeline: Clock,
  referee: ClipboardCheck,
  /* Citations' book until 2026-10-09: the mode opens on Bibliography, so the
     button shows what a press lands on. Debate's globe stays Reception's
     job-progress icon (DebatePanel.tsx). */
  "peer-review": BookText,
  search: Search,
  chat: MessagesSquare,
  learn: Brain,
  marginalia: PanelRight,
};
