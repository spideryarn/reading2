/**
 * **Are a block's `role`, `treatment`, `noteId` and `context` well-formed?**
 *
 * A validator for blocks that arrive as *data* rather than as a value this
 * process just produced. `src/blocks.ts` mints all four fields and is trusted;
 * anything read back out of JSON is a claim.
 *
 * ## It lived in the importer until 2026-09-01
 *
 * `checkNoteFields` was written for `db:import`, whose input was a
 * hand-editable `data/<slug>/blocks.json`, and it moved here when the importer
 * was deleted — docs/plans/260831b-finish-the-database-move.md § Stage 3 item 5.
 * The comments below still argue in the importer's terms ("an import is
 * somebody else's JSON"), and that is kept deliberately: the reasoning is
 * GPT Sol's across three reviews of docs/plans/260828o-footnotes.md, and
 * paraphrasing it would lose the arguments for *rejecting* rather than
 * dropping.
 *
 * ## Nothing in production calls it, and that is a live question
 *
 * The importer was its only caller. The files→Postgres path that survives is
 * `copyArtefacts` (src/store/copy-artefacts.ts) → `writeBlocks`
 * (src/store/artifacts-pg.ts), which reads `blocks.json` off a disk and runs
 * none of these checks — it never did. So this is either the guard that path
 * should be running, or dead code to delete. **That decision is Greg's**, and
 * deleting the importer was not the moment to make it; see the report in
 * docs/plans/260831b-finish-the-database-move.md.
 *
 * What the database already refuses on its own, so that the overlap is visible:
 * `revision_blocks_role`, `revision_blocks_treatment`, `revision_blocks_context`
 * and `revision_blocks_context_type` in src/db/schema.ts. What only this file
 * refuses: the two id *shapes*, and `footnote ⇒ supplement` + `footnote ⇒
 * noteId`.
 */

import { NOTE_ID_PATTERN } from "./notes.js";
import { CONTEXT_ID_PATTERN } from "./reserved.js";
import type { Block } from "./types.js";

/** The two closed axes, spelled out here because a `Block` from a file is a claim, not a type. */
const ROLES = new Set(["footnote", "reference", "acknowledgment", "credit", "appendix"]);
const TREATMENTS = new Set(["supplement"]);

/**
 * Refuse the whole import if any block's `role` or `treatment` is not one of
 * ours. **Rejected, not dropped, and the choice matters.**
 *
 * Dropping would be the friendlier-looking option and it is the worse one: a
 * block that arrives claiming to be apparatus and is stored as body is
 * *silently reclassified as argument*, which is the exact failure the whole
 * feature exists to prevent — summarised, embedded, and on the clock, with
 * every count still looking plausible (docs/plans/260828o-footnotes.md). An import is a
 * file somebody handed us, so a value we do not recognise means the file was
 * written by something we do not understand, and the honest answer is to stop.
 *
 * The CHECK constraint would also stop it — but as a Postgres constraint
 * violation naming `revision_blocks_role`, from inside a transaction, with no
 * block id in it. This is the guard; the constraint is the backstop.
 *
 * ## Each field being legal is not the same as the block being coherent
 *
 * The first version checked the three fields **in isolation**, and GPT Sol's
 * review of stage 3 found that the failure this function exists to prevent
 * walked straight in through the door that left open. Two shapes, both of which
 * every value passes on its own:
 *
 * - `role: "footnote"` with **no `treatment`**. Legal role, absent treatment,
 *   and `isBody` reads an absent treatment as body — so the block declares
 *   itself apparatus in the one column nothing reads and is summarised,
 *   embedded, labelled and put on the clock as argument. Which is silent
 *   reclassification, arriving as a *well-formed* import.
 * - `noteId: "anything at all"`. Stage 2 mints ten hex digits and stage 3
 *   refuses anything else (`noteFieldsFor` in src/blocks.ts gates on
 *   `NOTE_ID_PATTERN`), so a value in any other shape did not come from this
 *   pipeline. Stage 5 resolves a marker to a note by that id; an arbitrary
 *   string there is a hover card resolving to nothing, or to the wrong note.
 *
 * So the cross-field rules are checked too. `NOTE_ID_PATTERN` is imported from
 * src/notes.ts rather than restated, because two spellings of "what an id looks
 * like" can only ever disagree — and the day they do, the minting half and the
 * validating half each look correct.
 *
 * **`role: "appendix"` is deliberately allowed without a treatment.** An
 * appendix may be real prose worth gisting, which is the case one closed set
 * could not express and the reason there are two axes at all (`Block.role` in
 * src/types.ts). The implication runs from `"footnote"` only, because that is
 * the one role v1 assigns and the only one whose meaning is settled.
 *
 * **And `treatment: "supplement"` with no role stays legal**, which is the
 * asymmetry to notice rather than tidy away: apparatus we cannot name the kind
 * of is still apparatus, and every predicate already treats it correctly. It is
 * the reverse direction — a claim of apparatus that the predicates read as body
 * — that is unsafe.
 *
 * **A third rule was considered and left out**, and it is worth the paragraph
 * because it looks like it belongs: `noteId` present ⇒ `treatment:
 * "supplement"`. It has the same shape as the first rule — a block declaring
 * membership of a note while every predicate reads it as argument — and
 * `noteFieldsFor` cannot produce it, since the container check gates all three
 * fields together. It is not enforced for two reasons found by trying it.
 * First, it rejects the five-role fixture in tests/block-roles.test.ts, whose
 * `appendix` block deliberately carries a `noteId` and no treatment; that fixture
 * is arguably wrong, but it is not this function's place to decide so. Second,
 * stage 5 has to resolve a marker to its note, and a `noteId` on the *marker's*
 * block — which is body — is one of the shapes that could be reached for.
 * Foreclosing it from the import validator, before the stage that needs it has
 * been built, is the wrong order.
 *
 * ## Should a CHECK constraint back this?
 *
 * It could: all three are columns of one row, so
 * `check (role <> 'footnote' or treatment = 'supplement')` is expressible, and
 * the same is true of the `note_id` shape. **Not added here**, for two reasons.
 * The first is scope: it needs a migration, and this stage is not applying one.
 * The second is that a constraint is a *backstop* and this is the *guard* — the
 * constraint would fail as a violation naming `revision_blocks_role`, inside a
 * transaction, with no block id in it, which is the position the existing
 * single-column CHECKs already occupy. The recommendation is that the pair ride
 * along with the next migration this feature needs rather than becoming one of
 * their own; recorded in docs/plans/260828o-footnotes.md.
 */
export function checkNoteFields(slug: string, blocks: Block[]): void {
  for (const [index, b] of blocks.entries()) {
    const where = `block ${index} (${b.id ?? "no id"})`;
    if (b.role !== undefined && !ROLES.has(b.role)) {
      throw new Error(`${slug}: ${where} has an unrecognised role ${JSON.stringify(b.role)}`);
    }
    if (b.treatment !== undefined && !TREATMENTS.has(b.treatment)) {
      throw new Error(
        `${slug}: ${where} has an unrecognised treatment ${JSON.stringify(b.treatment)}`,
      );
    }
    if (b.noteId !== undefined && typeof b.noteId !== "string") {
      throw new Error(`${slug}: ${where} has a noteId that is not a string`);
    }

    /* The cross-field rules. `role` is checked against the closed set above, so
       by here `"footnote"` means what it says. */
    if (b.role === "footnote" && b.treatment !== "supplement") {
      throw new Error(
        `${slug}: ${where} is a footnote with treatment ${JSON.stringify(b.treatment)} — ` +
          `a footnote is apparatus, and stored without treatment "supplement" every predicate ` +
          `would read it as argument`,
      );
    }
    /* **A footnote must say which note it belongs to.** Stage 3 considered a
       `noteId` rule and left it out, in the other direction (`noteId` present ⇒
       supplement) and for two reasons that were good at the time. This is the
       implication that actually bites, and stage 5a is what made it bite:
       `noteIndex` in src/web/notes-view.ts keys on a non-empty `noteId`, so a
       footnote stored without one is removed from the argument *and* absent
       from the index — its marker opens nothing. Neither of the stage-3
       reasons covers it: the five-role fixture's `appendix` carries a `noteId`
       without the footnote role, and a marker's own block is body. GPT Sol's
       review of stage 4, 2026-08-28. */
    if (b.role === "footnote" && b.noteId === undefined) {
      throw new Error(
        `${slug}: ${where} is a footnote with no noteId — stage 5 resolves a marker to its ` +
          `note by that id, so the note would be stored but unreachable`,
      );
    }
    if (b.noteId !== undefined && !NOTE_ID_PATTERN.test(b.noteId)) {
      throw new Error(
        `${slug}: ${where} has a noteId ${JSON.stringify(b.noteId)} that stage 2 could not have ` +
          `minted (${NOTE_ID_PATTERN.source})`,
      );
    }

    checkContext(slug, where, b);
  }
}

/**
 * **The context, checked the same way and for the same reason as the three note
 * fields.**
 *
 * An import is somebody else's JSON. The CHECK constraint refuses a bad `type`
 * and a half-set pair, but it does so inside a transaction with no block id in
 * the message, and it cannot see the id's *shape* at all. Stage 2 mints these
 * (src/reserved.ts), so a value that could not have come from there is a value
 * from a page.
 *
 * Its own function rather than four more branches inside `checkNoteFields`,
 * which the complexity rule was right to complain about: that one is about the
 * note axis and its cross-field rules, and this is a different axis that happens
 * to be validated at the same seam.
 */
function checkContext(slug: string, where: string, b: Block): void {
  if (b.context === undefined) return;
  if (b.context.type !== "callout") {
    throw new Error(
      `${slug}: ${where} has an unrecognised context type ${JSON.stringify(b.context.type)}`,
    );
  }
  if (typeof b.context.id !== "string" || !CONTEXT_ID_PATTERN.test(b.context.id)) {
    throw new Error(
      `${slug}: ${where} has a context id ${JSON.stringify(b.context.id)} that stage 2 could ` +
        `not have minted (${CONTEXT_ID_PATTERN.source})`,
    );
  }
}
