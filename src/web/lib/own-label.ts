/**
 * **Reading a table by a value the server sent.**
 *
 * A table typed `Record<Kind, string>` is complete for the kinds this bundle
 * was built with, and the compiler reads that as "every lookup answers". But
 * the key comes off the wire, and a copy opened from a home-screen icon
 * outlives several deploys: a newer server sends it a kind it has no entry
 * for. A bare `TABLE[value]` then answers `undefined`, and for a name every
 * object inherits (`__proto__`, `constructor`, `toString`) it answers an
 * object or a function, which `??` lets through. React throws on the object,
 * a template string prints `[object Object]`, and `useState`'s setter calls
 * the function. `SPIDERYARN-READING2-BJ` and `-CB` were the first of these
 * (src/web/Metadata.tsx § `stageIcon`).
 *
 * So there is one way to do it: `ownLabel` answers only for a key the table
 * itself holds, and the caller names what an unknown value becomes. For a
 * badge that is usually `plainWords`, the server's own value made readable; for
 * a sentence of explanation it is nothing, because the client cannot write
 * one. docs/plans/261005h, Stage A.
 */

/** `table[key]` when the table itself has that key, otherwise `undefined`. */
export function ownLabel<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/**
 * A wire value as words: `screen-reader-only` reads "screen reader only".
 *
 * Empty for anything that is not a string. The types say it always is one, and
 * they are a claim about JSON; "undefined" on screen would be this module's
 * own bug come back.
 */
export function plainWords(value: string): string {
  return typeof value === "string" ? value.replaceAll("-", " ") : "";
}
