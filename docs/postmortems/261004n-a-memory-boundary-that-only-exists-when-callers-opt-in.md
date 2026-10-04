# A memory boundary that only exists when callers opt in

Security review of [261004k](../plans/261004k-one-size-limit-for-an-upload-and-an-address.md)
found production Storage reads that still buffered without a size bound. No production exhaustion
was observed in this review; the evidence is the reachable code, not an incident report.
Parent: [postmortems.md](../project/postmortems.md).

## The class: an opt-in memory boundary

`RawSourceStore.get` accepted an optional `maxBytes`. Supabase's adapter checked it only when
supplied, so the same method was a bounded read for upload acquisition and an unbounded read for
image delivery and old raw manifests. Canonical names and verified writes establish which object a
caller means; they do not bound the response from a corrupted object or a changed bucket policy.

The shape began in **`24054082d`**, which introduced the upload's Storage adapter. Its `get` checked
an optional ceiling before and after `arrayBuffer()`. **`ff97c4181`** improved reads with a named
ceiling by counting the stream, but explicitly retained `arrayBuffer()` when no ceiling was named.
The legacy-manifest omission in `readRawBytes` dates to **`5e8f74423d`**.

The reachable siblings were private plate delivery (`src/routes.ts`, `sendPlate`), private image
delivery (`sendArticleAsset`), public image delivery (`src/store/public-reader.ts`, `loadAsset`),
and `src/fetch.ts`'s `readRawBytes` when `storedBytes` was absent.

## Why the checks agreed

The new streaming regression supplied `maxBytes`, exercising the protected branch. The omitted-cap
test returned three bytes, proving completeness but saying nothing about bounded memory. Neither
check could distinguish a safe default from no default.

The review adds four boundary regressions to `tests/one-size-limit.test.ts`: an omitted ceiling,
`NaN`, `Infinity`, and a negative ceiling. Each supplies a finite oversized stream and expects the
default ceiling and early cancellation. Against the original code the first three can finish the
oversized body; the negative value instead refuses with the invalid negative ceiling. The tests'
purpose is to distinguish both mistakes from a usable default. All four failed against the
original adapter: the first three resolved with 104,857,600 bytes, and the negative case reported
"the limit is -1". All four pass with the safe default.

## The fix

Supabase `get` uses `MAX_UPLOAD_BYTES` when the ceiling is absent, nonfinite or negative, and every
successful response goes through the streaming counter. Valid explicit ceilings remain available,
including zero and a verified stored byte count larger than the wire limit.

That last case matters: fetched HTML is decoded and stored as UTF-8, which can expand the wire
bytes. Modern manifests carry the exact `storedBytes`; legacy reads need an explicit bounded
allowance of three times `MAX_UPLOAD_BYTES` for HTML and `MAX_UPLOAD_BYTES` for PDF. A blanket
50 MiB cap on every stored object would close the memory hole by refusing some legitimate HTML.

The long-term design is a safe default at the resource boundary, with explicit finite allowances
for transformations that enlarge their input. This review implements that in Supabase.

## What would catch the class, ranked by ease against value

1. **Exercise the default as well as explicit limits** — cheap boundary tests, added here. Use a
   producer that records consumption and cancellation so rejecting after buffering cannot pass.
2. **Put the default in the resource adapter** — one implementation change protects callers added
   later, without relying on every route remembering the same argument. Done in this review.
3. **Make every call supply a mandatory ceiling** — rejected here. It adds migration work and
   still lets a caller choose `Infinity`; a required argument alone does not establish safety.
4. **Run exhaustion probes against production** — rejected. Finite synthetic streams distinguish
   the unsafe branches without consuming a deployed process's memory or affecting readers.
