/**
 * **The card surface, said once.** Same tokens as a library card, on purpose.
 *
 * It lived in `Metadata.tsx` as a private const until 2026-09-04, when
 * `preview-sharing.tsx` needed it. The preview had it spelled out by hand for
 * half an hour, with a comment promising to keep the two in step — which is the
 * shape of promise nobody keeps, and worse than that: the preview is the thing
 * the *screenshots* are taken from, so a hard-coded copy stays boxed in the
 * picture on the day somebody deletes the real wrapper. GPT Sol, 2026-09-04.
 *
 * A module of its own rather than an export from `Metadata.tsx`, because
 * importing that would pull the whole metadata page — every panel it draws and
 * every hook it calls — into a preview entry whose one claim is that it asks
 * nothing of the server.
 */
export const CARD = "tw:rounded-lg tw:border tw:border-border tw:bg-card";
