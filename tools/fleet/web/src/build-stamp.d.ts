/**
 * What this bundle was built from, compiled in by `vite.fleet.config.ts`'s
 * `define`. It says which bundle THIS TAB is running, which is a different
 * fact from which bundle is on disk now (`dist/build-stamp.json`, which a
 * rebuild replaces under an open tab). docs/plans/260910f D3.
 *
 * An inline `import()` type rather than an `import` statement, so this file
 * stays a global declaration rather than becoming a module.
 */
declare const __FLEET_BUILD__: import("../../wire.js").BuildStamp;
