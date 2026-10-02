# ideas

**rank**: mean U = 1.69 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 3 | base-a -1, base-b -3, medium-a -2, medium-b 0 |
| entropy-24-00930-spya-pywwkq | 0 | base-a 0, base-b -1, medium-a -3, medium-b -2 |
| noema-mythology-of-conscious-ai | 1 | base-a 0, base-b -2, medium-a -1, medium-b -3 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 3 | base-a -3, base-b -1, medium-a 0, medium-b -2 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0.5 | base-a -1, base-b 0, medium-a -1, medium-b -2 |
| after-work-we-ll-have-each-other-spya-we6h75 | 4 | base-a -3, base-b -2, medium-a 0, medium-b -1 |
| spider-silk-spya-ge30uz | 2 | base-a 0, base-b -3, medium-a -2, medium-b -1 |
| cargocult-spya-rz663q | 0 | base-a 0, base-b 0, medium-a -1, medium-b -1 |

**score**: mean U = 1.13 → possible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 1 | base-a 24, base-b 20, medium-a 19, medium-b 21 |
| entropy-24-00930-spya-pywwkq | 0 | base-a 23, base-b 23, medium-a 21, medium-b 21 |
| noema-mythology-of-conscious-ai | 1 | base-a 25, base-b 22, medium-a 23, medium-b 21 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 2 | base-a 21, base-b 21, medium-a 22, medium-b 18 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | base-a 23, base-b 23, medium-a 22, medium-b 22 |
| after-work-we-ll-have-each-other-spya-we6h75 | 2 | base-a 20, base-b 23, medium-a 22, medium-b 22 |
| spider-silk-spya-ge30uz | 2 | base-a 22, base-b 23, medium-a 18, medium-b 24 |
| cargocult-spya-rz663q | 1 | base-a 22, base-b 20, medium-a 20, medium-b 20 |

**Combined (worse of the two)**: possible loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 149817 | base | 13198 | 18022 | 0.250 | 176 |
| replication-crisis-spya-hrjamq | 149817 | medium | 4011 | 7862 | 0.148 | 83 |
| entropy-24-00930-spya-pywwkq | 56536 | base | 8935 | 13333 | 0.179 | 129 |
| entropy-24-00930-spya-pywwkq | 56536 | medium | 1332 | 4785 | 0.094 | 46 |
| noema-mythology-of-conscious-ai | 52573 | base | 8403 | 13595 | 0.179 | 128 |
| noema-mythology-of-conscious-ai | 52573 | medium | 1055 | 5010 | 0.094 | 46 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | base | 8597 | 13857 | 0.182 | 133 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | medium | 94 | 4729 | 0.090 | 43 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | base | 6174 | 10032 | 0.141 | 95 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | medium | 2453 | 6097 | 0.102 | 59 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | base | 5395 | 8587 | 0.118 | 84 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | medium | 2151 | 5095 | 0.083 | 52 |
| spider-silk-spya-ge30uz | 62920 | base | 6602 | 9719 | 0.133 | 91 |
| spider-silk-spya-ge30uz | 62920 | medium | 767 | 3552 | 0.072 | 34 |
| cargocult-spya-rz663q | 21195 | base | 4047 | 6524 | 0.087 | 66 |
| cargocult-spya-rz663q | 21195 | medium | 679 | 2873 | 0.051 | 28 |

**Median thinking reduction, articles under 100k characters**: 85% (gate: ≥ 33%)
**Invalid draws**: none

**Hard gates**: literal (no invalid candidate draw) pass; compared (candidate 0 invalid ≤ base 0) pass
