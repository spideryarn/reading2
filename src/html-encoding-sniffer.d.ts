/**
 * Types for `html-encoding-sniffer`, which ships none.
 *
 * The package is jsdom's own implementation of the HTML spec's encoding-sniffing
 * algorithm, and it is already in the tree as jsdom's dependency. We declare it
 * in package.json anyway rather than reaching through jsdom for it — see
 * src/fetch.ts `decodeHtml` and docs/project/fetching.md#character-encoding.
 *
 * It is CommonJS with a single function on `module.exports`, so `export =` is
 * the accurate spelling; `esModuleInterop` is what lets fetch.ts default-import
 * it.
 */
declare module "html-encoding-sniffer" {
  interface SniffOptions {
    /** Treat the bytes as XML, which skips the `<meta charset>` prescan. */
    xml?: boolean;
    /** The charset from the `Content-Type` header, if the server sent one. */
    transportLayerEncodingLabel?: string;
    /** What to assume when nothing declares anything. Defaults to windows-1252. */
    defaultEncoding?: string;
  }

  /** Returns a canonical WHATWG encoding name — feed it straight to `TextDecoder`. */
  function sniffHTMLEncoding(bytes: Uint8Array, options?: SniffOptions): string;

  export = sniffHTMLEncoding;
}
