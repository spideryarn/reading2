# Bounding one field does not bound an untrusted request

Up: [postmortems.md](../project/postmortems.md)

Code review found this before the multi-page importer shipped, so nothing reached a reader. The
judge prompt bounded extracted prose, link count, anchor text and context, but copied the page title
and link URLs whole. A 2 MB hostile page produced a 2,000,126-character model message, undermining
the cheap-call assumption and making request rejection or large allocations attacker-controlled.

## The class: partial field limits are not a payload limit

The design reviewed the conspicuous prose field and the number of links independently. The actual
security and cost boundary is the serialized message after JSON escaping. URLs also stayed full
because full values are correctly needed later for fetching; one representation was made to serve
both a trusted in-process lookup and an untrusted presentation to a model.

Commit `cff6e504e` introduced the request in stage 1. The full URL map was a sound safety property
for resolving model ids, but it did not need to be the text shown to the model.

The fix keeps full URLs in `PageLink`, bounds only their presentation along with title and page
address, then asserts a 100,000-character ceiling on the final serialized JSON. An overflow fails
the optional judge and imports page 1 alone. This is the long-term design: per-field bounds preserve
useful evidence; the final serialized bound owns the resource invariant.

## What would have caught it, ranked by ease against value

1. Construct the largest hostile values the source cap permits and assert the serialized request's
   total length while also asserting that the internal fetch URL remains full. Done.
2. Put a final bound at every outbound model boundary whose input contains stranger-controlled
   collections. Done here; auditing all other model calls is wider work.
3. Dropping links until the payload fits was rejected: unless answer validation uses the same
   shortened list, hidden ids remain valid model outputs. Failing this optional call is simpler.

The thing I would tell myself: a list cap and several string slices do not compose into a request
cap. Measure the object that crosses the boundary.
