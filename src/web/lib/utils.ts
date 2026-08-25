import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The class-name helper every shadcn component imports as `@/lib/utils`.
 *
 * `clsx` flattens conditionals; `twMerge` then resolves conflicts by keeping
 * the last of any two utilities that set the same property, so a caller's
 * `tw:px-6` beats a component's built-in `tw:px-4` instead of the two both
 * landing and specificity deciding it arbitrarily.
 *
 * The `tw:` prefix needs no configuration here. tailwind-merge 3.x reads v4
 * colon syntax natively and treats the prefix as a variant, so `tw:px-4
 * tw:px-6` collapses to `tw:px-6` and `tw:hover:px-4 tw:hover:px-6` to the
 * latter, while `tw:px-4 px-6` correctly keeps both. Checked rather than
 * assumed — an unconfigured merger would have failed silently, leaving both
 * classes in place for source order to settle. See src/web/tailwind.css for
 * why the prefix exists at all.
 */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
