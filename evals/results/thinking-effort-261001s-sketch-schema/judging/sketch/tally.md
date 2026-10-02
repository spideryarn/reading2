# sketch

**rank**: mean U = 1.63 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 4 | base-a -2, base-b -3, no-schema-a -1, no-schema-b 0 |
| entropy-24-00930-spya-pywwkq | 0 | base-a -1, base-b 0, no-schema-a -2, no-schema-b -3 |
| noema-mythology-of-conscious-ai | 2 | base-a 0, base-b -2, no-schema-a -1, no-schema-b -1 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | base-a 0, base-b -1, no-schema-a -3, no-schema-b -2 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 4 | base-a -3, base-b -2, no-schema-a -1, no-schema-b 0 |
| after-work-we-ll-have-each-other-spya-we6h75 | 1 | base-a 0, base-b -2, no-schema-a -1, no-schema-b -3 |
| spider-silk-spya-ge30uz | 2 | base-a -1, base-b -2, no-schema-a -3, no-schema-b 0 |
| cargocult-spya-rz663q | 0 | base-a 0, base-b -1, no-schema-a -2, no-schema-b -3 |

**score**: mean U = 2.19 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 4 | base-a 18, base-b 16, no-schema-a 19, no-schema-b 23 |
| entropy-24-00930-spya-pywwkq | 1.5 | base-a 17, base-b 22, no-schema-a 17, no-schema-b 19 |
| noema-mythology-of-conscious-ai | 4 | base-a 17, base-b 16, no-schema-a 18, no-schema-b 19 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | base-a 19, base-b 21, no-schema-a 5, no-schema-b 17 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 3 | base-a 19, base-b 21, no-schema-a 20, no-schema-b 22 |
| after-work-we-ll-have-each-other-spya-we6h75 | 2 | base-a 21, base-b 21, no-schema-a 22, no-schema-b 17 |
| spider-silk-spya-ge30uz | 1.5 | base-a 18, base-b 17, no-schema-a 5, no-schema-b 18 |
| cargocult-spya-rz663q | 1.5 | base-a 19, base-b 16, no-schema-a 18, no-schema-b 16 |

**Combined (worse of the two)**: no visible loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 149817 | base | 257 | 3931 | 0.125 | 36 |
| replication-crisis-spya-hrjamq | 149817 | no-schema | 1791 | 5865 | 0.140 | 50 |
| entropy-24-00930-spya-pywwkq | 56536 | base | 135 | 4264 | 0.102 | 36 |
| entropy-24-00930-spya-pywwkq | 56536 | no-schema | 65 | 4333 | 0.098 | 35 |
| noema-mythology-of-conscious-ai | 52573 | base | 134 | 4629 | 0.102 | 37 |
| noema-mythology-of-conscious-ai | 52573 | no-schema | 133 | 5011 | 0.101 | 39 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | base | 841 | 5141 | 0.110 | 45 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | no-schema | 212 | 4377 | 0.098 | 41 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | base | 724 | 5248 | 0.106 | 45 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | no-schema | 1419 | 5379 | 0.103 | 47 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | base | 100 | 4385 | 0.087 | 40 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | no-schema | 53 | 3641 | 0.075 | 29 |
| spider-silk-spya-ge30uz | 62920 | base | 82 | 3490 | 0.084 | 30 |
| spider-silk-spya-ge30uz | 62920 | no-schema | 73 | 2669 | 0.071 | 24 |
| cargocult-spya-rz663q | 21195 | base | 68 | 5365 | 0.087 | 41 |
| cargocult-spya-rz663q | 21195 | no-schema | 151 | 4549 | 0.074 | 39 |

**Median thinking reduction, articles under 100k characters**: 11% (gate: ≥ 33%)
**Invalid draws**: towards-a-theory-of-bugs-the-ruliology-of-the-unexpected no-schema-a; spider-silk-spya-ge30uz no-schema-a

**Hard gates**: literal (no invalid candidate draw) FAIL; compared (candidate 2 invalid ≤ base 0) FAIL
