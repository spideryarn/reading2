# sketch

**rank**: mean U = 1.56 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 2.5 | base-a -1, base-b -2, low-a 0, low-b -2 |
| entropy-24-00930-spya-pywwkq | 0 | base-a 0, base-b 0, low-a -1, low-b -2 |
| noema-mythology-of-conscious-ai | 0 | base-a -1, base-b 0, low-a -3, low-b -2 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 4 | base-a -2, base-b -3, low-a -1, low-b 0 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 4 | base-a -2, base-b -3, low-a 0, low-b -1 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | base-a 0, base-b -1, low-a -3, low-b -2 |
| spider-silk-spya-ge30uz | 2 | base-a -2, base-b -1, low-a -3, low-b 0 |
| cargocult-spya-rz663q | 0 | base-a 0, base-b -1, low-a -2, low-b -3 |

**score**: mean U = 1.69 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 2.5 | base-a 19, base-b 5, low-a 20, low-b 5 |
| entropy-24-00930-spya-pywwkq | 0 | base-a 22, base-b 20, low-a 19, low-b 19 |
| noema-mythology-of-conscious-ai | 1.5 | base-a 17, base-b 21, low-a 20, low-b 17 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 1 | base-a 18, base-b 21, low-a 17, low-b 20 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 3 | base-a 19, base-b 17, low-a 18, low-b 20 |
| after-work-we-ll-have-each-other-spya-we6h75 | 2 | base-a 20, base-b 19, low-a 18, low-b 22 |
| spider-silk-spya-ge30uz | 3.5 | base-a 17, base-b 19, low-a 19, low-b 20 |
| cargocult-spya-rz663q | 0 | base-a 22, base-b 22, low-a 18, low-b 17 |

**Combined (worse of the two)**: no visible loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 149817 | base | 11936 | 17431 | 0.256 | 165 |
| replication-crisis-spya-hrjamq | 149817 | low | 3055 | 5815 | 0.139 | 53 |
| entropy-24-00930-spya-pywwkq | 56536 | base | 9404 | 15199 | 0.206 | 144 |
| entropy-24-00930-spya-pywwkq | 56536 | low | 82 | 3960 | 0.094 | 32 |
| noema-mythology-of-conscious-ai | 52573 | base | 13554 | 18642 | 0.238 | 181 |
| noema-mythology-of-conscious-ai | 52573 | low | 2227 | 7459 | 0.126 | 65 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | base | 13624 | 19285 | 0.247 | 180 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 46808 | low | 1675 | 6190 | 0.116 | 54 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | base | 12317 | 18131 | 0.230 | 172 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 45461 | low | 346 | 4196 | 0.091 | 34 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | base | 13186 | 18427 | 0.223 | 178 |
| after-work-we-ll-have-each-other-spya-we6h75 | 34272 | low | 49 | 3743 | 0.076 | 30 |
| spider-silk-spya-ge30uz | 62920 | base | 13699 | 18856 | 0.233 | 182 |
| spider-silk-spya-ge30uz | 62920 | low | 154 | 3548 | 0.080 | 32 |
| cargocult-spya-rz663q | 21195 | base | 16547 | 21939 | 0.248 | 208 |
| cargocult-spya-rz663q | 21195 | low | 136 | 4542 | 0.074 | 34 |

**Median thinking reduction, articles under 100k characters**: 99% (gate: ≥ 33%)
**Invalid draws**: replication-crisis-spya-hrjamq base-b; replication-crisis-spya-hrjamq low-b

**Hard gates**: literal (no invalid candidate draw) FAIL; compared (candidate 1 invalid ≤ base 1) pass
