---
reports: spya-c7807j
ending: shipped
---
# The Illustrated diagram draws on the paper's own figures

SPIDERYARN-READING2-5X, from Greg (admin, verified by account id), in production, build `6d09e3cc`,
on `/read/dongetal25-spya-vfmvmm?…&mode=diagram&diagram=illustrated`.

> For the illustrated diagrams, make sure we feed in the figures from the paper, and perhaps it can
> try and sort of create or incorporate those somehow as part of the montage.

**Ending: Shipped** — on `dev`, not deployed. Sentry resolved from this session.

What we did: the image model already accepts reference images, so the paper's stored PDF figures
are now listed for the brief as `FIGURE A`, `FIGURE B`, …, and every figure a plate's composition
names is handed to the illustrator as the actual picture, to be redrawn into the montage in the
plate's own hand. Papers without stored figures, and web articles, paint exactly as before. On a
local paper the central Venn figure came back recognisably redrawn as an inset. The zoom plates
copying much of the overview turned out to be existing behaviour, not something this change caused.
It is still behind the Experimental switch.

Plan, reviews and the evidence:
[260930f](../plans/260930f-illustrated-diagram-draws-on-the-paper-figures.md).
