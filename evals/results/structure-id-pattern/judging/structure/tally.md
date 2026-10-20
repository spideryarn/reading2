# structure

**rank**: mean U = 2.50 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 4 | base-a -2, base-b -2, toc13-a -1, toc13-b 0 |
| entropy-24-00930-spya-pywwkq | 2 | base-a 0, base-b -3, toc13-a -2, toc13-b -1 |
| noema-mythology-of-conscious-ai | 3.5 | base-a -2, base-b -1, toc13-a -1, toc13-b 0 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 2 | base-a -1, base-b -2, toc13-a 0, toc13-b -3 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 1 | base-a -2, base-b 0, toc13-a -1, toc13-b -3 |
| after-work-we-ll-have-each-other-spya-we6h75 | 1.5 | base-a 0, base-b -1, toc13-a 0, toc13-b -2 |
| spider-silk-spya-ge30uz | 4 | base-a -3, base-b -2, toc13-a 0, toc13-b -1 |
| cargocult-spya-rz663q | 2 | base-a -1, base-b -1, toc13-a 0, toc13-b -2 |

**score**: mean U = 1.94 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 3.5 | base-a 21, base-b 20, toc13-a 21, toc13-b 24 |
| entropy-24-00930-spya-pywwkq | 1.5 | base-a 23, base-b 21, toc13-a 22, toc13-b 21 |
| noema-mythology-of-conscious-ai | 2 | base-a 23, base-b 24, toc13-a 24, toc13-b 23 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 2 | base-a 22, base-b 22, toc13-a 23, toc13-b 18 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0.5 | base-a 22, base-b 23, toc13-a 22, toc13-b 19 |
| after-work-we-ll-have-each-other-spya-we6h75 | 2 | base-a 23, base-b 22, toc13-a 23, toc13-b 22 |
| spider-silk-spya-ge30uz | 4 | base-a 5, base-b 22, toc13-a 24, toc13-b 23 |
| cargocult-spya-rz663q | 0 | base-a 24, base-b 24, toc13-a 22, toc13-b 21 |

**Combined (worse of the two)**: no visible loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 0 | base | 0 | 2216 | 0.095 | 20 |
| replication-crisis-spya-hrjamq | 0 | toc13 | 0 | 2573 | 0.099 | 22 |
| entropy-24-00930-spya-pywwkq | 0 | base | 0 | 3212 | 0.079 | 23 |
| entropy-24-00930-spya-pywwkq | 0 | toc13 | 0 | 3058 | 0.077 | 21 |
| noema-mythology-of-conscious-ai | 0 | base | 0 | 2559 | 0.071 | 19 |
| noema-mythology-of-conscious-ai | 0 | toc13 | 0 | 2299 | 0.069 | 18 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | base | 0 | 3157 | 0.079 | 24 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | toc13 | 0 | 2328 | 0.070 | 20 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | base | 0 | 3136 | 0.073 | 22 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | toc13 | 0 | 2917 | 0.071 | 21 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | base | 0 | 2487 | 0.058 | 20 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | toc13 | 0 | 2106 | 0.055 | 17 |
| spider-silk-spya-ge30uz | 0 | base | 0 | 2794 | 0.066 | 20 |
| spider-silk-spya-ge30uz | 0 | toc13 | 0 | 2219 | 0.060 | 18 |
| cargocult-spya-rz663q | 0 | base | 0 | 2228 | 0.045 | 18 |
| cargocult-spya-rz663q | 0 | toc13 | 0 | 1895 | 0.042 | 17 |

**Thinking reduction**: not a gate — both Structure arms run at production `low` effort.
**Invalid draws**: spider-silk-spya-ge30uz base-a

**Hard gates**: literal (no invalid candidate draw) pass; compared (candidate 0 invalid ≤ base 1) pass
