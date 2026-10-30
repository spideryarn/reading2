/**
 * **The administrator's rows in the command bar** — Greg, 2026-10-23
 * (`spya-v88mga`), reading an article and wondering whether to tell its author:
 *
 * > maybe that would require us to have a kind of admin-specific set of
 * > functionality that would only be included in the command bar for admins.
 * > Probably it would just open up the relevant page in /admin. But do a review
 * > of all the functionality we might want to include that's admin-specific
 * > and add it to the command bar. And if there's a way to do this without
 * > leaving the article, that would be even better.
 *
 * The review, and why each admin function is or is not a row, is
 * docs/plans/261024n-admin-commands-in-the-command-bar-and-an-author-gift-without-leaving-the-article.md.
 * In short: the author gift for this article (a dialog over the page, so the
 * article stays put), this article's *What it cost* section, and the admin
 * pages and `/design` as places to go. Since 2026-10-30 also the viewport
 * probe, started on the page as it stands (plan 261030e).
 *
 * ## A courtesy, not a gate
 *
 * `CommandBar` builds these only for `isAdmin` and never under *view as*. That
 * hides rows; it protects nothing. Every private read or write they reach is
 * under `/api/admin/*`, which the server refuses with a 403 for anybody but
 * `ADMIN_USER_IDS` (src/routes.ts, docs/project/admin.md § The three
 * refusals). The *What it cost* section is drawn only for the administrator
 * and reads there too. `/design` is only a cosmetic admin route and holds no
 * private data.
 *
 * ## Not shown to the sentence picker
 *
 * The keys `CommandBar` sends to the fast model that places a sentence are
 * built from the rows *without* these (plan § F4), so
 * src/command-pick-catalogue.generated.json stays the list of every row the
 * picker can be sent. The picker is for readers; the one person who sees these
 * names them.
 *
 * ## All typed-only
 *
 * The empty list stays the reader's; typing `admin`, `gift`, `author`, `users`,
 * `costs` or `probe` brings these up. Last in the list, so on a tie every reader's
 * row wins — `feedback` is the Feedback dialog before it is the admin page.
 */
import type { ActionOutcome, Command } from "./command-match.js";
import { type SectionRow, sectionCommand } from "./article-commands.js";
import { startProbe } from "./probe-switch.js";
import {
  ADMIN_ARTICLES_HREF,
  ADMIN_COSTS_HREF,
  ADMIN_FEEDBACK_HREF,
  ADMIN_HREF,
  ADMIN_MOCKUPS_HREF,
  ADMIN_USERS_HREF,
  ADMIN_VOUCHERS_HREF,
  DESIGN_HREF,
} from "./router.js";

type Run = () => ActionOutcome | Promise<ActionOutcome>;

export const AUTHOR_GIFT_ROW_ID = "admin-author-gift";
export const AUTHOR_GIFT_ROW_LABEL = "Gift this to its author";

/**
 * **This article's *What it cost*** — Metadata's administrator-only section
 * (Metadata.tsx § `CostSection`). The other section rows say it is left out of
 * theirs because it is an administrator's (article-commands.ts); this is where
 * it went.
 */
export const COST_SECTION_ROW: SectionRow = {
  id: "what-it-cost",
  section: "what-it-cost",
  label: "What it cost",
  description: "Every AI call made for this article, and what each one cost.",
  aliases: ["spend", "article cost", "cost of this article", "how much did it cost", "ai cost"],
};

export const VIEWPORT_PROBE_ROW_ID = "admin-viewport-probe";

/**
 * **The viewport probe, on the page as it stands** — the way to record a
 * layout bug on a phone or an iPad *while it is happening*, which `?probe=1`
 * could not do because adding it reloads the page (probe-switch.ts, plan
 * 261030e). Only with an article, because the probe is drawn by the reading
 * view.
 */
const VIEWPORT_PROBE_ROW: Command = {
  kind: "action",
  id: VIEWPORT_PROBE_ROW_ID,
  label: "Viewport probe",
  description:
    "Show the viewport recording for a layout bug on a phone or an iPad. Mark, then copy the trace into Feedback.",
  aliases: ["probe", "viewport", "viewport trace", "layout trace", "debug the layout", "bar partway up"],
  generates: false,
  typedOnly: true,
  opensOnly: true,
  run: () =>
    startProbe()
      ? { kind: "close" }
      : { kind: "stay", message: "The viewport probe is drawn by an article's reading view, not this page." },
};

/** The admin pages and `/design`, in the `/admin` index's own order. */
const ADMIN_PAGES: readonly Extract<Command, { kind: "page" }>[] = [
  {
    kind: "page",
    href: ADMIN_HREF,
    label: "Admin",
    description: "The administrator's index of pages.",
    aliases: ["administrator", "admin pages"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: ADMIN_USERS_HREF,
    label: "Admin › Users",
    description: "Everybody who has signed up, and how much each has read.",
    aliases: ["admin users", "users", "accounts", "sign-ups", "signups", "readers", "view as"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: ADMIN_FEEDBACK_HREF,
    label: "Admin › Feedback",
    description: "Every report readers filed with the Feedback button.",
    aliases: ["admin feedback", "feedback reports", "bug reports", "reports"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: ADMIN_VOUCHERS_HREF,
    label: "Admin › Gift vouchers",
    description: "Give free articles, and the author gifts waiting to be sent.",
    aliases: ["admin gift vouchers", "admin vouchers", "vouchers", "gifts", "author gifts", "drafts", "give articles"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: ADMIN_ARTICLES_HREF,
    label: "Admin › Articles",
    description: "Every article, whoever owns it, and moving one to another account.",
    aliases: ["admin articles", "all articles", "move article", "transfer article", "ownership"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: ADMIN_COSTS_HREF,
    label: "Admin › Costs",
    description: "What the AI calls cost, by person, article, mode, model and day.",
    aliases: ["admin costs", "costs", "spending", "bills", "openrouter"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: ADMIN_MOCKUPS_HREF,
    label: "Admin › Mockups",
    description: "Mockups agents made for the questions waiting on you.",
    aliases: ["admin mockups", "mockups", "mockup", "wireframes", "sketches"],
    generates: false,
    typedOnly: true,
  },
  {
    kind: "page",
    href: DESIGN_HREF,
    label: "Design reference",
    description: "Every colour, type size and control on one page.",
    aliases: ["design", "design system", "styles", "tokens"],
    generates: false,
    typedOnly: true,
  },
];

/**
 * **The administrator's rows for where the bar was opened.** The three that need
 * the reading view only with `article`; the pages always.
 *
 * `openAuthorGift` opens `AuthorGiftDialog` over the page. The row only opens
 * it — `generates: false`, `opensOnly: true` — and the dialog's *Draft* button,
 * behind the rights tick, is what spends (plan § F2).
 */
export function adminRows({
  article,
}: {
  article: { readonly openAuthorGift: Run; readonly goToCost: Run } | undefined;
}): readonly Command[] {
  return [
    ...(article === undefined
      ? []
      : [
          {
            kind: "action",
            id: AUTHOR_GIFT_ROW_ID,
            label: AUTHOR_GIFT_ROW_LABEL,
            description:
              "Draft a gift of free articles for this piece's author, with a private link and a lookup for their address. Nothing is sent until you press Send.",
            aliases: ["author gift", "gift", "give to the author", "tell the author", "email the author", "voucher for the author"],
            generates: false,
            typedOnly: true,
            opensOnly: true,
            run: article.openAuthorGift,
          } as const,
          sectionCommand(COST_SECTION_ROW, article.goToCost),
          VIEWPORT_PROBE_ROW,
        ]),
    ...ADMIN_PAGES,
  ];
}
