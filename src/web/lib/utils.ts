import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class-name helper every shadcn component imports as `@/lib/utils`.
 *
 * `clsx` flattens conditionals; `twMerge` then resolves conflicts by keeping
 * the last of any two utilities that set the same property, so a caller's
 * padding utility beats a component's built-in one instead of
 * the two both landing and specificity deciding it arbitrarily.
 *
 * The prefix needs no configuration here. tailwind-merge 3.x reads v4 colon
 * syntax natively and treats the prefix as a variant, so a prefixed px-4
 * followed by a prefixed px-6 collapses to the px-6, the same holds under a
 * hover: variant, and a prefixed px-4 beside a BARE px-6 correctly keeps both.
 * Checked rather than assumed — an unconfigured merger would have failed
 * silently, leaving both classes in place for source order to settle.
 *
 * (Those examples are spelled out in words rather than written as literal
 * class names on purpose. Tailwind scans this file, and a literal prefixed
 * class in a COMMENT compiles into the bundle exactly as if a component had
 * asked for it — four dead rules shipped from this docstring before it was
 * reworded. See the @source note in src/web/tailwind.css.)
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
