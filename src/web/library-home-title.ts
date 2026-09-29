/**
 * The native tooltip on a signed-in home wordmark.
 *
 * `HomeLogo` used to be the home control on every standalone signed-in page.
 * The four pages with `SiteNav` replaced it with the bar's wordmark on
 * 2026-09-29, so the tooltip — including the build stamp used to identify a
 * deployed copy — belongs to both controls rather than to either component.
 */
import { buildDescription } from "./build-stamp.js";

const LIBRARY_HOME_TITLE = "Spideryarn — back to the library";

export function libraryHomeTitle(): string {
  const build = buildDescription();
  return build === null ? LIBRARY_HOME_TITLE : `${LIBRARY_HOME_TITLE}\n(${build})`;
}
