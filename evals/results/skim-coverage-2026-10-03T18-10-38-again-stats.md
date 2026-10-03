# skim/8 vs skim/9: what the results file says

From `evals/results/skim-coverage-2026-10-03T18-10-38.json`.

## 1. How much the NEW routes carry

Walk length = own stops + carried stops. Share = carried / walk length.

| Article | offered | run | More: walk · carried · share | Most: walk · carried · share | carried Gist→More | Gist→Most | More→Most | badAgain |
|---|---|---|---|---|---|---|---|---|
| vb-spya-vu3xen | 8 | 1 | 4 · 1 · 25% | 4 · 1 · 25% | 1 of 2 | 0 | 1 of 3 | 0 |
| vb-spya-vu3xen | 8 | 2 | 5 · 1 · 20% | 2 · 0 · 0% | 1 of 2 | 0 | 0 of 4 | 0 |
| cargocult-spya-rz663q | 11 | 1 | 5 · 2 · 40% | 6 · 1 · 17% | 2 of 3 | 1 | 0 of 3 | 0 |
| cargocult-spya-rz663q | 11 | 2 | 5 · 1 · 20% | 6 · 2 · 33% | 1 of 3 | 2 | 0 of 4 | 0 |
| entropy-24-00930-spya-pywwkq | 20 | 1 | 9 · 3 · 33% | 10 · 0 · 0% | 3 of 4 | 0 | 0 of 6 | 0 |
| entropy-24-00930-spya-pywwkq | 20 | 2 | 9 · 3 · 33% | 11 · 1 · 9% | 3 of 4 | 1 | 0 of 6 | 0 |
| source-spya-furjgs | 13 | 1 | 5 · 1 · 20% | 7 · 1 · 14% | 1 of 3 | 1 | 0 of 4 | 0 |
| source-spya-furjgs | 13 | 2 | 5 · 1 · 20% | 9 · 3 · 33% | 1 of 3 | 1 | 2 of 4 | 0 |
| best-spya-ny2pgx | 23 | 1 | 12 · 5 · 42% | 12 · 1 · 8% | 5 of 5 | 1 | 0 of 7 | 0 |
| best-spya-ny2pgx | 23 | 2 | 7 · 0 · 0% | 11 · 0 · 0% | 0 of 5 | 0 | 0 of 7 | 0 |
| fowler-phrenology | 31 | 1 | 9 · 2 · 22% | 19 · 0 · 0% | 2 of 5 | 0 | 0 of 7 | 0 |
| fowler-phrenology | 31 | 2 | 8 · 1 · 13% | 26 · 7 · 27% | 1 of 5 | 4 | 3 of 7 | 0 |

## 2. Did anything else move?

First-placed pass sizes (stops with depth 1 / 2 / 3), which is what the caps and targets count.

| Article | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| vb-spya-vu3xen | 2 / 2 / 4 | 2 / 4 / 2 | 2 / 3 / 3 | 2 / 4 / 2 |
| cargocult-spya-rz663q | 3 / 3 / 5 | 3 / 3 / 5 | 3 / 3 / 5 | 3 / 4 / 4 |
| entropy-24-00930-spya-pywwkq | 4 / 6 / 10 | 4 / 6 / 10 | 4 / 6 / 10 | 4 / 6 / 10 |
| source-spya-furjgs | 3 / 4 / 6 | 3 / 4 / 6 | 3 / 4 / 6 | 3 / 4 / 6 |
| best-spya-ny2pgx | 5 / 7 / 11 | 5 / 7 / 11 | 5 / 7 / 11 | 5 / 7 / 11 |
| fowler-phrenology | 5 / 7 / 19 | 5 / 7 / 19 | 5 / 7 / 19 | 5 / 7 / 19 |

Ideas with a stop on one of their own paragraphs ("in"), cumulative at Gist / More / Most, of the article's Ideas.

| Article (Ideas) | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| vb-spya-vu3xen (3) | 1 / 1 / 3 | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 3 / 3 |
| cargocult-spya-rz663q (5) | 4 / 5 / 5 | 4 / 5 / 5 | 4 / 5 / 5 | 4 / 5 / 5 |
| entropy-24-00930-spya-pywwkq (10) | 4 / 6 / 6 | 4 / 5 / 6 | 4 / 5 / 6 | 4 / 6 / 6 |
| source-spya-furjgs (8) | 3 / 5 / 5 | 3 / 5 / 5 | 3 / 4 / 5 | 3 / 4 / 5 |
| best-spya-ny2pgx (5) | 3 / 5 / 5 | 3 / 5 / 5 | 3 / 5 / 5 | 3 / 5 / 5 |
| fowler-phrenology (8) | 6 / 8 / 8 | 5 / 8 / 8 | 5 / 8 / 8 | 5 / 7 / 8 |

Ideas "in or beside", the same way.

| Article | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| vb-spya-vu3xen | 1 / 1 / 3 | 1 / 3 / 3 | 1 / 3 / 3 | 1 / 3 / 3 |
| cargocult-spya-rz663q | 5 / 5 / 5 | 5 / 5 / 5 | 5 / 5 / 5 | 5 / 5 / 5 |
| entropy-24-00930-spya-pywwkq | 4 / 7 / 8 | 4 / 6 / 8 | 4 / 6 / 8 | 4 / 7 / 8 |
| source-spya-furjgs | 3 / 6 / 6 | 3 / 6 / 6 | 3 / 5 / 6 | 3 / 5 / 6 |
| best-spya-ny2pgx | 4 / 5 / 5 | 4 / 5 / 5 | 4 / 5 / 5 | 4 / 5 / 5 |
| fowler-phrenology | 6 / 8 / 8 | 6 / 8 / 8 | 6 / 8 / 8 | 6 / 7 / 8 |

Content sections with a stop, cumulative at Gist / More / Most.

| Article (sections) | OLD 1 | OLD 2 | NEW 1 | NEW 2 |
|---|---|---|---|---|
| vb-spya-vu3xen (6) | 2 / 4 / 5 | 2 / 4 / 5 | 2 / 4 / 5 | 2 / 4 / 5 |
| cargocult-spya-rz663q (5) | 3 / 3 / 3 | 3 / 3 / 3 | 3 / 3 / 3 | 3 / 3 / 3 |
| entropy-24-00930-spya-pywwkq (9) | 3 / 6 / 7 | 3 / 5 / 7 | 3 / 6 / 7 | 3 / 6 / 7 |
| source-spya-furjgs (8) | 2 / 5 / 7 | 2 / 5 / 7 | 3 / 5 / 7 | 3 / 5 / 7 |
| best-spya-ny2pgx (9) | 5 / 7 / 7 | 5 / 7 / 7 | 5 / 6 / 7 | 5 / 6 / 7 |
| fowler-phrenology (9) | 3 / 5 / 5 | 4 / 5 / 5 | 4 / 5 / 5 | 4 / 5 / 5 |

Quotes two routes place at the same first depth (of the quotes either route uses).

| Article | OLD 1 v OLD 2 (control) | NEW 1 v NEW 2 | OLD 1 v NEW 1 | OLD 2 v NEW 2 | OLD 1 v NEW 2 | OLD 2 v NEW 1 |
|---|---|---|---|---|---|---|
| vb-spya-vu3xen | 6/8 | 7/8 | 7/8 | 8/8 | 6/8 | 7/8 |
| cargocult-spya-rz663q | 9/11 | 10/11 | 11/11 | 8/11 | 10/11 | 9/11 |
| entropy-24-00930-spya-pywwkq | 18/20 | 18/20 | 16/20 | 18/20 | 18/20 | 18/20 |
| source-spya-furjgs | 13/13 | 13/13 | 9/13 | 9/13 | 9/13 | 9/13 |
| best-spya-ny2pgx | 17/23 | 21/23 | 17/23 | 19/23 | 18/23 | 21/23 |
| fowler-phrenology | 27/31 | 25/31 | 25/31 | 29/31 | 25/31 | 27/31 |

## 3. Order: Gist first, and where a carried stop sits

`Gist first` = every depth-1 stop is listed before any deeper stop in the route. `recap at the head` = in the More walk, every carried stop comes before every stop of More's own. `beside its own` = carried stops in the More walk with one of More's own stops directly before or after.

| Article | arm#run | Gist first | carried into More | recap at the head | beside its own |
|---|---|---|---|---|---|
| vb-spya-vu3xen | old#1 | yes | 0 | – | – |
| vb-spya-vu3xen | old#2 | yes | 0 | – | – |
| vb-spya-vu3xen | new#1 | yes | 1 | yes | 1 of 1 |
| vb-spya-vu3xen | new#2 | yes | 1 | yes | 1 of 1 |
| cargocult-spya-rz663q | old#1 | yes | 0 | – | – |
| cargocult-spya-rz663q | old#2 | yes | 0 | – | – |
| cargocult-spya-rz663q | new#1 | yes | 2 | yes | 1 of 2 |
| cargocult-spya-rz663q | new#2 | yes | 1 | yes | 1 of 1 |
| entropy-24-00930-spya-pywwkq | old#1 | yes | 0 | – | – |
| entropy-24-00930-spya-pywwkq | old#2 | yes | 0 | – | – |
| entropy-24-00930-spya-pywwkq | new#1 | yes | 3 | yes | 1 of 3 |
| entropy-24-00930-spya-pywwkq | new#2 | yes | 3 | yes | 1 of 3 |
| source-spya-furjgs | old#1 | yes | 0 | – | – |
| source-spya-furjgs | old#2 | yes | 0 | – | – |
| source-spya-furjgs | new#1 | yes | 1 | yes | 1 of 1 |
| source-spya-furjgs | new#2 | no | 1 | yes | 1 of 1 |
| best-spya-ny2pgx | old#1 | no | 0 | – | – |
| best-spya-ny2pgx | old#2 | yes | 0 | – | – |
| best-spya-ny2pgx | new#1 | no | 5 | no | 5 of 5 |
| best-spya-ny2pgx | new#2 | no | 0 | – | – |
| fowler-phrenology | old#1 | no | 0 | – | – |
| fowler-phrenology | old#2 | no | 0 | – | – |
| fowler-phrenology | new#1 | yes | 2 | yes | 1 of 2 |
| fowler-phrenology | new#2 | no | 1 | yes | 1 of 1 |

old: Gist first in 9 of 12 routes; recap at the head in 0 of the 0 runs that carry into More.

new: Gist first in 8 of 12 routes; recap at the head in 10 of the 11 runs that carry into More.

## 4. Validity and cost

| Arm | calls | failures | badAgain | other drops (not `collapsed`) | cost | input tokens / call | output tokens / call | thinking tokens / call | model |
|---|---|---|---|---|---|---|---|---|---|
| old (skim/8) | 12 | 0 | 0 | 0 | $0.3099 | 7428 | 1097 | 297 | anthropic/claude-sonnet-5 |
| new (skim/9) | 12 | 0 | 0 | 0 | $0.3766 | 8031 | 1532 | 626 | anthropic/claude-sonnet-5 |
