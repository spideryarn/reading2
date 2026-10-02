# hierarchy

**rank**: mean U = 2.13 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 3.5 | base-a -1, base-b -2, toc11-a -1, toc11-b 0 |
| entropy-24-00930-spya-pywwkq | 0 | base-a 0, base-b -1, toc11-a -2, toc11-b -3 |
| noema-mythology-of-conscious-ai | 2 | base-a -3, base-b 0, toc11-a -2, toc11-b -1 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 1 | base-a -2, base-b 0, toc11-a -1, toc11-b -3 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 4 | base-a -3, base-b -2, toc11-a 0, toc11-b -1 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | base-a -1, base-b 0, toc11-a -2, toc11-b -3 |
| spider-silk-spya-ge30uz | 3.5 | base-a -1, base-b -2, toc11-a 0, toc11-b -1 |
| cargocult-spya-rz663q | 3 | base-a -1, base-b -3, toc11-a 0, toc11-b -2 |

**score**: mean U = 2.56 → no visible loss

| article | U | quality by arm |
|---|---:|---|
| replication-crisis-spya-hrjamq | 2.5 | base-a 20, base-b 19, toc11-a 19, toc11-b 23 |
| entropy-24-00930-spya-pywwkq | 2 | base-a 22, base-b 22, toc11-a 22, toc11-b 22 |
| noema-mythology-of-conscious-ai | 1 | base-a 23, base-b 23, toc11-a 22, toc11-b 23 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 2 | base-a 17, base-b 23, toc11-a 22, toc11-b 18 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 3.5 | base-a 16, base-b 18, toc11-a 20, toc11-b 18 |
| after-work-we-ll-have-each-other-spya-we6h75 | 3 | base-a 23, base-b 22, toc11-a 23, toc11-b 23 |
| spider-silk-spya-ge30uz | 2.5 | base-a 23, base-b 22, toc11-a 24, toc11-b 22 |
| cargocult-spya-rz663q | 4 | base-a 20, base-b 5, toc11-a 22, toc11-b 21 |

**Combined (worse of the two)**: no visible loss

| article | chars | arm | thinking (mean) | output (mean) | $ (mean) | latency s (mean) |
|---|---:|---|---:|---:|---:|---:|
| replication-crisis-spya-hrjamq | 0 | base | 16223 | 23342 | 0.304 | 197 |
| replication-crisis-spya-hrjamq | 0 | toc11 | 10714 | 16814 | 0.240 | 137 |
| entropy-24-00930-spya-pywwkq | 0 | base | 6687 | 12257 | 0.167 | 96 |
| entropy-24-00930-spya-pywwkq | 0 | toc11 | 0 | 3634 | 0.082 | 33 |
| noema-mythology-of-conscious-ai | 0 | base | 5639 | 8811 | 0.132 | 74 |
| noema-mythology-of-conscious-ai | 0 | toc11 | 0 | 2742 | 0.073 | 28 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | base | 8962 | 14309 | 0.188 | 120 |
| towards-a-theory-of-bugs-the-ruliology-of-the-unexpected | 0 | toc11 | 3477 | 6959 | 0.116 | 63 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | base | 5823 | 10098 | 0.141 | 87 |
| analog-cognition-and-consciousness-4-28-26-spya-f03kqf | 0 | toc11 | 3395 | 8504 | 0.126 | 71 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | base | 3580 | 6641 | 0.098 | 60 |
| after-work-we-ll-have-each-other-spya-we6h75 | 0 | toc11 | 2494 | 4964 | 0.082 | 44 |
| spider-silk-spya-ge30uz | 0 | base | 7816 | 11962 | 0.155 | 99 |
| spider-silk-spya-ge30uz | 0 | toc11 | 4742 | 7738 | 0.115 | 66 |
| cargocult-spya-rz663q | 0 | base | 4245 | 5663 | 0.077 | 52 |
| cargocult-spya-rz663q | 0 | toc11 | 2430 | 5625 | 0.078 | 52 |

**Thinking reduction**: not a gate — toc/10 and toc/11 both run at production `low` effort.
**Invalid draws**: cargocult-spya-rz663q base-b

**Hard gates**: literal (no invalid candidate draw) pass; compared (candidate 0 invalid ≤ base 1) pass
