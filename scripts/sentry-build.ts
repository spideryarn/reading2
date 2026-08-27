/**
 * Source maps to Sentry, from both builds, under one release.
 *
 * Shared by [vite.config.ts](../vite.config.ts) (the client) and
 * [vite.api.config.ts](../vite.api.config.ts) (the serverless function) because
 * **both halves need it and only the client half is obvious.** The first version
 * of this change put the plugin in the client config alone, which cannot work:
 * `vercel.json`'s build command runs the client build first and the API build
 * second, so at the moment the plugin ran, `api-dist/vercel.js.map` did not yet
 * exist. A server stack trace would have pointed at a line in a 40,000-line
 * bundle nobody wrote. Found by GPT Sol's review, 2026-08-27.
 *
 * ## Why the maps are only *generated* when they can be uploaded
 *
 * `sourcemap` is decided by the same token that decides whether to upload, and
 * that is deliberate rather than tidy. A build with no token that still emitted
 * maps would leave `dist/assets/*.map` sitting in the deployed static output —
 * publicly fetchable, since nothing deletes them and `filesToDeleteAfterUpload`
 * only runs as part of an upload. So the failure mode of "somebody deployed
 * without the token" is *no source maps*, which is visible and annoying, rather
 * than *the source published*, which is invisible.
 *
 * ## Why the plugin is omitted rather than disabled
 *
 * `sentryVitePlugin` takes `disable`, and it works. But without a token the
 * installed 5.4.0 logs missing-token warnings for release creation and for
 * upload — on every local build, in every agent's tree, for a feature nobody
 * running `npm run build` on a laptop asked for. Not adding the plugin says the
 * same thing with no output.
 *
 * ## What is deliberately left able to fail the build
 *
 * With a token configured, an upload failure stops the build, and that is the
 * plugin's default. Keeping it is a decision: a deployment that silently ships
 * unmapped monitoring looks exactly like one that works, right up until the
 * first issue arrives as a column number.
 */
import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { PluginOption } from "vite";

/**
 * The plugin, or nothing at all.
 *
 * `release` must be the **same string** in both builds and the same one the two
 * runtime SDKs report, or an event will not find its map. Everything here reads
 * it from `resolveBuildStamp()`, which is already this project's single answer
 * to "which commit is this" — see scripts/build-stamp.ts.
 *
 * `filesToDeleteAfterUpload` is what stops the maps reaching the deployed
 * output. It runs after a successful upload, which is the whole reason the
 * no-token path does not generate them in the first place.
 */
export function sentrySourceMaps(release: string, mapGlob: string): PluginOption[] {
  if (!sentryUploadEnabled()) return [];
  /* Read after the guard, and asserted rather than defaulted: `sentryUploadEnabled`
     has just established all three are set, and a `?? ""` here would turn a
     configuration mistake into an upload addressed at an empty org. */
  const org = process.env.SENTRY_ORG as string;
  const project = process.env.SENTRY_PROJECT as string;
  const authToken = process.env.SENTRY_AUTH_TOKEN as string;
  return [
    sentryVitePlugin({
      org,
      project,
      authToken,
      release: { name: release },
      /* Off. This is a private project and the plugin's telemetry is a second
         thing leaving the build machine that nobody asked for. */
      telemetry: false,
      sourcemaps: { filesToDeleteAfterUpload: [mapGlob] },
    }),
  ];
}

/**
 * Whether this build can upload, which is also whether it should emit maps.
 *
 * All three, not just the token: the plugin needs an org and a project to
 * address an upload at, and two of three set is a build that fails late rather
 * than one that quietly does nothing.
 */
export function sentryUploadEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SENTRY_AUTH_TOKEN && env.SENTRY_ORG && env.SENTRY_PROJECT);
}
