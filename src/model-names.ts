/**
 * **A model's name, as a person reads it** — the table and the lookup, in a
 * module that imports nothing, so the browser can use it as well as the
 * server. Moved out of src/models.ts on 2026-10-08 for a chat thread's (i)
 * (docs/plans/261008c-chat-back-to-the-list-on-a-phone-the-model-in-the-thread-s-i-and-step-between-messages.md § 2);
 * src/models.ts re-exports both, and its header § "a third spelling" is still
 * the reasoning.
 */

/**
 * **One human-readable name per model, whichever wire it went down.**
 *
 * The bug this exists for, 2026-08-27: `/profile` listed ten jobs and printed
 * each one's raw wire id, so seven rows said `claude-sonnet-5` and three said
 * `anthropic/claude-sonnet-5`. Every one of those strings was correct. The page
 * was still wrong, because a reader looking at ten rows reads two names as two
 * models, and the question the page exists to answer — *which model writes
 * what* — got a different answer depending on which transport the code happened
 * to use. The provider prefix is an addressing detail; it is not part of the
 * model's name.
 *
 * **Literals, not `id.split("/").pop()`**, and for the same reason the header
 * gives for not deriving one wire spelling from the other. Stripping the prefix
 * works for exactly the current pair and would have failed for the pair before
 * it: `anthropic/claude-sonnet-4.5` strips to `claude-sonnet-4.5`, which is not
 * what the Anthropic SDK calls that model (`claude-sonnet-4-5`) — so the two
 * rows would have gone on disagreeing while looking like they had been fixed.
 * A table cannot be wrong that way; it can only be incomplete, and
 * `displayName` says so out loud when it is.
 *
 * **Every id this app can send belongs here**, tier or no tier — which is why
 * `PDF_READER_MODEL` and `EMBEDDING_MODEL` are in it. That sentence was here
 * before either of them was, and was therefore false; a GPT-5.6-sol review
 * caught it on 2026-08-27. An inventory that quietly means "the ones that were
 * easy to enumerate" is worse than no inventory, because the next person trusts
 * it. `tests/models.test.ts` checks the claim rather than repeating it.
 */
export const DISPLAY_NAME: Record<string, string> = {
  "claude-sonnet-5-5": "claude-sonnet-5-5",
  "anthropic/claude-sonnet-5.5": "claude-sonnet-5-5",
  /* Sonnet 5, the capable model until 2026-10-09: still named on what it
     wrote, so its stamps keep a name rather than a raw id. */
  "claude-sonnet-5": "claude-sonnet-5",
  "anthropic/claude-sonnet-5": "claude-sonnet-5",
  /* The high-power model, plan 260930f — sent only for an article with
     High-powered AI switched on. */
  "claude-opus-5-5": "claude-opus-5-5",
  "anthropic/claude-opus-5.5": "claude-opus-5-5",
  "openai/gpt-5.6-luna": "gpt-5.6-luna",
  "voyageai/voyage-4": "voyage-4",
  /* `google/gemini-3.1-flash-lite` was here for dictation until 2026-09-07 and
     went with it — nothing else in the app sends that id, and an inventory that
     keeps a model nobody calls tells the next reader of /privacy that their text
     reaches somewhere it does not. docs/plans/260907c-dictation-onto-an-openai-transcriber.md. */
  "openai/gpt-transcribe": "gpt-transcribe",
  "google/gemini-3-flash-preview": "gemini-3-flash-preview",
  /* The Illustrated painter (`IMAGE_MODEL`, src/illustrated.ts), missing here
     until plan 260930k — so /privacy was never required to name it. */
  "google/gemini-3.1-flash-image": "gemini-3.1-flash-image",
  "openai/gpt-6-luna": "gpt-6-luna",
  /* The batch import's metadata reader, `PAPER_METADATA_MODEL`, and the
     reading-difficulty rater, `READING_DIFFICULTY_MODEL`. */
  "deepseek/deepseek-v4.1-flash": "deepseek-v4.1-flash",
  /* Quick search's scorer, `QUICK_SEARCH_MODEL`. */
  "typesafe/jev-1.13": "jev-1.13",
};

/**
 * A model id as a person should read it — the id itself if we have no better
 * name for it.
 *
 * The fallback is the raw id rather than `"unknown"` on purpose: an unlisted
 * model is a table somebody forgot to extend, and the honest thing then is the
 * string that was really sent. Ugly on screen, which is the point — it is the
 * only way anyone finds out.
 */
export function displayName(modelId: string): string {
  /* `hasOwn`, not a bare lookup: a stored id is data, and `DISPLAY_NAME["__proto__"]`
     is an object that `??` lets through (lib/own-label.ts says the same). */
  return Object.hasOwn(DISPLAY_NAME, modelId) ? DISPLAY_NAME[modelId]! : modelId;
}
