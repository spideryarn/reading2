# ideas

**rank**: mean U = 1.44 → possible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 0.5 | base-a -1, base-b 0, low-a -2, low-b -1 |
| entropy-24-00930-spya-pywwkq | 2 | base-a -3, base-b 0, low-a -1, low-b -2 |
| noema-mythology-of-conscious-ai | 1 | base-a 0, base-b -2, low-a -3, low-b -1 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | base-a -1, base-b 0, low-a -3, low-b -2 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | base-a 0, base-b -1, low-a -3, low-b -2 |
| after-work-we-ll-have-each-other-spya-we6h75 | 4 | base-a -2, base-b -2, low-a -1, low-b 0 |
| spider-silk-spya-ge30uz | 1 | base-a 0, base-b -2, low-a -1, low-b -3 |
| cargocult-spya-rz663q | 3 | base-a 0, base-b -1, low-a 0, low-b 0 |

**score**: mean U = 0.88 → clear loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 2 | base-a 21, base-b 20, low-a 20, low-b 21 |
| entropy-24-00930-spya-pywwkq | 0.5 | base-a 24, base-b 21, low-a 21, low-b 19 |
| noema-mythology-of-conscious-ai | 1 | base-a 25, base-b 21, low-a 21, low-b 21 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 1 | base-a 21, base-b 21, low-a 19, low-b 21 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | base-a 24, base-b 23, low-a 18, low-b 20 |
| after-work-we-ll-have-each-other-spya-we6h75 | 1 | base-a 20, base-b 22, low-a 19, low-b 21 |
| spider-silk-spya-ge30uz | 0 | base-a 21, base-b 23, low-a 20, low-b 19 |
| cargocult-spya-rz663q | 1.5 | base-a 22, base-b 19, low-a 18, low-b 22 |

**Combined (worse of the two)**: clear loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 149817 | base | 13198 | 18022 | 0.250 | 176 |
| replication-crisis-spya-hrjamq | 149817 | low | 14 | 3518 | 0.105 | 35 |
| entropy-24-00930-spya-pywwkq | 56536 | base | 8935 | 13333 | 0.179 | 129 |
| entropy-24-00930-spya-pywwkq | 56536 | low | 73 | 3557 | 0.081 | 32 |
| noema-mythology-of-conscious-ai | 52573 | base | 8403 | 13595 | 0.179 | 128 |
| noema-mythology-of-conscious-ai | 52573 | low | 13 | 3790 | 0.081 | 35 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | base | 8597 | 13857 | 0.182 | 133 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | low | 70 | 3550 | 0.079 | 32 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | base | 6174 | 10032 | 0.141 | 95 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | low | 14 | 2850 | 0.069 | 27 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | base | 5395 | 8587 | 0.118 | 84 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | low | 12 | 2096 | 0.053 | 21 |
| spider-silk-spya-ge30uz | 62920 | base | 6602 | 9719 | 0.133 | 91 |
| spider-silk-spya-ge30uz | 62920 | low | 105 | 2662 | 0.063 | 25 |
| cargocult-spya-rz663q | 21195 | base | 4047 | 6524 | 0.087 | 66 |
| cargocult-spya-rz663q | 21195 | low | 8 | 2116 | 0.043 | 21 |

**Median thinking reduction, articles under 100k characters**: 100% (gate: ≥ 33%)
**Invalid draws**: none

**Hard gates**: literal (no invalid candidate draw) pass; compared (candidate 0 invalid ≤ base 0) pass
