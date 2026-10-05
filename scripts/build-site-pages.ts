/**
 * **A head for each of our own pages, written into the client build** — the
 * step between `vite build` and the API build.
 *
 * Vite builds one `index.html` with one head, which says `noindex, nofollow`
 * and the bare word *Spideryarn*. A search engine needs a title, a description
 * and a canonical that are about the page it asked for, in the HTML it is sent.
 * So, from that one file and the list in src/site-pages.ts, this writes:
 *
 * | File | What it is | Who is sent it |
 * |---|---|---|
 * | `dist/shell.html` | the shell exactly as Vite built it | every path not on the list (vercel.json's catch-all), and the function that answers `/read/<slug>` compiles it in |
 * | `dist/_pages/<name>.html` | the shell with one page's head | that page's path, by a rewrite in vercel.json |
 * | `dist/index.html` | the shell with the homepage's head | `/`, which is answered from the file system before any rewrite |
 * | `dist/sitemap.xml` | the list | search engines |
 *
 * `npm run build:client` runs it. `npm run dev` does not: locally every path
 * has the default head, as it always has.
 *
 * ## The one way this goes silently wrong
 *
 * **Run twice over one build**, the second run would read the homepage's head
 * out of `index.html`, take it for the shell, and write it to `shell.html`:
 * every app path would lose its `noindex` and gain a canonical naming the
 * homepage, and nothing would be red. So it refuses when `shell.html` is
 * already there, and refuses a shell whose head is not the default.
 * `vite build` empties `dist/` first, so the ordinary build never meets either.
 *
 * docs/plans/261005f-link-previews-and-seo-for-shared-links.md § Stage 2.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MANAGED_HEAD_END, MANAGED_HEAD_START, composeSitePage } from "../src/public/page-head.js";
import { SHELL_FILE, SITE_PAGES, sitePageFile, sitemapXml } from "../src/site-pages.js";

/** The default head's robots tag, exactly as index.html writes it. */
const DEFAULT_ROBOTS = '<meta name="robots" content="noindex, nofollow" />';

/**
 * Refuse anything that is not the default shell: the head that says `noindex`
 * and names no address.
 */
function requireDefaultShell(html: string, file: string): void {
  const start = html.indexOf(MANAGED_HEAD_START);
  const end = html.indexOf(MANAGED_HEAD_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`build-site-pages: ${file} has no managed head, so it is not the client shell.`);
  }
  const managed = html.slice(start, end);
  if (!managed.includes(DEFAULT_ROBOTS)) {
    throw new Error(
      `build-site-pages: the managed head of ${file} does not say noindex, so it is not the default shell. ` +
        "Every path that is not one of our own pages is served this head, and it has to fail closed. " +
        "If this build has already been through this step, run `npm run build` again.",
    );
  }
  if (managed.includes('property="og:url"') || managed.includes('rel="canonical"')) {
    throw new Error(
      `build-site-pages: the managed head of ${file} names an address, so it is not the default shell. ` +
        "One head is served at every app path, and an address in it is wrong for all but one.",
    );
  }
}

/**
 * Write every file in the table above into `distDir`.
 *
 * Returns the paths written, relative to `distDir`, for the build's log.
 */
export function buildSitePages(distDir: string): string[] {
  const indexPath = path.join(distDir, "index.html");
  const shellPath = path.join(distDir, SHELL_FILE.slice(1));
  if (existsSync(shellPath)) {
    throw new Error(
      `build-site-pages: ${shellPath} is already there, so this build has already been through this ` +
        "step and its index.html is the homepage's, not the shell. Run `npm run build` again.",
    );
  }

  /* Bytes in, bytes out for the shell: its SHA-256 is compared with the one the
     function reports, and a re-encoded copy is a different number. */
  const shellBytes = readFileSync(indexPath);
  const shell = shellBytes.toString("utf8");
  requireDefaultShell(shell, indexPath);

  const written: string[] = [];
  const write = (relative: string, body: string | Buffer): void => {
    const target = path.join(distDir, relative.replace(/^\//, ""));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(relative);
  };

  write(SHELL_FILE, shellBytes);
  for (const page of SITE_PAGES) write(sitePageFile(page), composeSitePage(shell, page));
  write("/sitemap.xml", sitemapXml());
  return written;
}

const RUN_DIRECTLY = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (RUN_DIRECTLY) {
  const dist = path.resolve(import.meta.dirname, "..", "dist");
  const written = buildSitePages(dist);
  console.log(`build-site-pages: wrote ${written.length} files into dist/ — ${written.join(", ")}`);
}
