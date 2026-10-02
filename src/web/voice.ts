/**
 * **Whose words these are, when the answer depends on the data.**
 *
 * Every piece of text on screen has a voice — the article's author, a model,
 * the reader, or the app itself — and each has its own face
 * (docs/project/fonts.md; the faces are `src/web/styles/voices.css`). Most
 * elements always hold the same voice, and voices.css names their classes
 * directly. Some do not: a Structure title is the author's heading or the
 * model's, a shelf blurb is a model's gist or the author's excerpt. Those
 * compute a `Voice` and put `voiceClass(voice)` on the element, so the
 * decision is one value with a type rather than a pair of modifier classes
 * per element, each with its own ternary.
 *
 * Greg, 2026-10-02: "Yes they should now be used throughout and always going
 * forwards. Try and build this in a clean, general, robust way."
 * docs/plans/261002f-the-three-faces-for-everyone-and-every-surface-voiced.md.
 */

/** `ui` is the app's own words — the chrome, and every fixed sentence we wrote. */
export type Voice = "author" | "ai" | "reader" | "ui";

/**
 * The class that puts `voice`'s face on an element: `voice-author`, `voice-ai`,
 * `voice-reader` or `voice-ui`, each in its rule in voices.css. `voice-ui` is
 * there so a computed "ours" does not inherit a voice from around it.
 *
 * **Never on an element voices.css already names** (`.tip-gist`, `.prose`…):
 * those lists' rules carry the specificity of their most specific entry, which
 * beats the one-class generic rules, so the named voice would win. Put the
 * class on a `<span>` inside instead — fonts.md § How to put an element in
 * its voice.
 */
export function voiceClass(voice: Voice): string {
  switch (voice) {
    case "author":
      return "voice-author";
    case "ai":
      return "voice-ai";
    case "reader":
      return "voice-reader";
    case "ui":
      return "voice-ui";
    default: {
      const unreachable: never = voice;
      return unreachable;
    }
  }
}

/** `voiceClass`, joined onto the element's own classes. */
export function withVoice(className: string, voice: Voice): string {
  return `${className} ${voiceClass(voice)}`;
}

/**
 * **Whose words a shelf blurb is**: the model's gist or the author's excerpt,
 * as the server worked it out (src/library-scalars.ts § `gistVoiceOf`). A shelf
 * saved in the browser before the server said so has no answer, and an
 * unknown voice is drawn as ours rather than guessed.
 */
export function gistVoice(entry: { gistVoice?: "ai" | "author" | undefined }): Voice {
  return entry.gistVoice ?? "ui";
}

/**
 * **An article's title is the author's, unless the reader renamed it.**
 *
 * `overridden` comes from the server wherever a title is drawn: a shelf row
 * (`Boolean(entry.titleOverridden)`, set only when there IS a rename), the
 * owner's `Article` and `UnreadPaper`, a `LibraryHit`, and the rename hook once
 * a write has answered — all decided by `titleRenamed` / the same `coalesce`
 * that chose the title. `undefined` means a payload saved before the flag
 * existed, and is drawn as ours rather than guessed, because a guess of
 * "author" would put the reader's own words in the author's face (GPT Sol,
 * plan review of 261002f, P1). A public page never shows an owner's rename
 * (src/public/dto.ts), so it passes `false`.
 */
export function articleTitleVoice(overridden: boolean | undefined): Voice {
  if (overridden === undefined) return "ui";
  return overridden ? "reader" : "author";
}
