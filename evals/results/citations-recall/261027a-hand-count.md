# Missed-citation count, six articles

## Method and caveats
- Candidates proposed by regex (every year-token with 60 chars of left context; every bracketed number group; glued superscript digits for article 4), then every candidate block was READ and false positives dropped (dates, versions, units such as cm2, table numbers, equation indices like s[0], "[medical citation needed]", figure numbers).
- Author-year: a distinct work = (first-author surname, year with letter suffix). "Henaff et al., 2019" (Model-predictive policy learning) and "Henaff et al., 2019" via "Hénaff et al., 2019" (CPC) were counted as two works (different first names/papers); likewise "Hinton and Salakhutdinov, 2006" vs "Hinton et al., 2006" in the JMLR paper. Identical repeated strings ("Brown et al., 2020; Brown et al., 2020") count once.
- Numbered: a distinct work = the number; ranges expanded. For Wikipedia (article 6) several numbers are the same underlying source (24=66, 48=49 by footnote text), so "works" there is slightly inflated; recall by underlying source would be a hair higher.
- Coverage: author-year = a row with the same surname (as a whole word in authors) and the same year; one row covers only one work (so "Chen 2020a/b" with one row = 1 covered, 1 missed). Numbered = a row whose reference block/entry carries that number. Article 4: 7 rows have no entry text, so I matched them by hand to numbers 5,6,8,36,41,60,70 from title/authors/year (Sutherland 1983, Eichenbaum 1999, O'Keefe & Dostrovsky 1971, Mitchell 1982, Packard 1990, Sturman 2018, Monaco et al.).
- Ambiguities: (a) JMLR row "Denoising autoencoders (Vincent et al., 2008, 2010)" is one row for two works; I counted both as covered because the row names both years. (b) Clark & Chalmers: "Chalmers (forthcoming)" has no year; row exists, counted covered. (c) Article 1: "(Pari et al., 2021; ?)" - the "?" is an unresolved cite, not counted. (d) Article 5 has the same paragraph twice (blocks spya-swankj and spya-fpgbaw); counted once. (e) Article 6 "Further reading" blocks 148-163 and external links are listed works that no body cite refers to; they are excluded from N. Two bibliography rows (Sinke et al. 2012, Ward 2013) point at Further-reading entries, so they count as rows with no in-text cite. (f) Articles 1,2,4,5 contain no reference-list blocks, so only body cites count.
- Rows: the "capped" flag was TRUE for article 6 but only 44 rows (not 80) came back, and FALSE for article 1 with only 23 rows for 105 works: the misses are not caused by the 80-row limit.

## Summary
| # | Article | Style | N cited | Covered | Missed | Recall | capped | Rows | Rows w/o in-text cite |
|---|---|---|---|---|---|---|---|---|---|
| 1 | prod LeCun (Path Towards AMI) | author-year, parenthetical "(Surname et al., 2020)" / "Surname and Surname, 2020" | 105 | 23 | 82 | 21.9% | false | 23 | 0 |
| 2 | JMLR Srivastava (Dropout) | author-year (Natbib), incl. inside tables | 36 | 36 | 0 | 100.0% | false | 35 | 0 |
| 3 | arXiv Vaswani (Attention) | numbered, bracketed [12] / [35, 2, 5] | 40 | 40 | 0 | 100.0% | false | 40 | 0 |
| 4 | Sci Rep Layfield (rearing) | numbered superscripts flattened to glued digits ("memory1-7", "Wells et al.18") | 70 | 69 | 1 | 98.6% | false | 69 | 0 |
| 5 | Clark & Chalmers 1998 | author-year without parentheses around year ("Kirsh 1995", "(Hutchins 1995)") plus 5 footnotes | 17 | 17 | 0 | 100.0% | false | 17 | 0 |
| 6 | Synesthesia (Wikipedia) | numbered Wikipedia bracket refs [12], footnote blocks at end (ord 168-319) | 152 | 42 | 110 | 27.6% | true | 44 | 2 |

Totals: 420 works, 227 covered.

## Where misses fall (covered/total)
| Article | by third of body (first cite position) | works first-cited in a block holding 1-2 / 3-5 / 6+ | first work in block / later works in block |
|---|---|---|---|
| 1 prod LeCun (Path Towards AMI) | 4/6 , 4/16 , 15/83 | 10/31 / 10/48 / 3/26 | 13/37 / 10/68 |
| 2 JMLR Srivastava (Dropout) | 23/23 , 9/9 , 4/4 | 33/33 / 3/3 / 0/0 | 24/24 / 12/12 |
| 3 arXiv Vaswani (Attention) | 24/24 , 4/4 , 12/12 | 18/18 / 7/7 / 15/15 | 19/19 / 21/21 |
| 4 Sci Rep Layfield (rearing) | 42/42 , 5/6 , 22/22 | 9/10 / 15/15 / 45/45 | 14/15 / 55/55 |
| 5 Clark & Chalmers 1998 | 7/7 , 5/5 , 5/5 | 6/6 / 11/11 / 0/0 | 7/7 / 10/10 |
| 6 Synesthesia (Wikipedia) | 18/54 , 17/52 , 7/46 | 20/54 / 14/53 / 8/45 | 21/60 / 21/92 |

(Thirds are by block ordinal over the whole article, so article 1's first third is mostly front matter and holds few cites.)

Other measurements: article 6 footnotes with a DOI/PMID/ISBN: 37 of 80 covered; web/news/other footnotes: 5 of 72. Article 1 related-work blocks (ordinals 326-354): 8 of 71 covered; the five blocks with 5+ new works there (329,330,331,334,352) cover 1 of 33.

## Per article: style, counts, missed works

### 1 prod LeCun (Path Towards AMI)
- Style: author-year, parenthetical "(Surname et al., 2020)" / "Surname and Surname, 2020"; reference list NOT in blocks
- N=105, covered=23, missed=82, recall=21.9%, capped=false, rows=23, rows with no in-text cite=0
- Missed works (key | first block | ordinal | citing words):
  - Levine:2021 | spya-g9ssef | 32 | Levine, 2021
  - Gottlieb:2013 | spya-axpgrc | 103 | Gottlieb et al., 2013
  - Walker:2021 | spya-bvhday | 209 | Walker et al., 2021
  - Jing:2020 | spya-bvhday | 209 | Jing et al., 2020
  - Gregor:2010b | spya-bvhday | 209 | Gregor and LeCun, 2010b
  - Evtimova:2022 | spya-bvhday | 209 | Evtimova and LeCun, 2022
  - Doi:2007 | spya-bvhday | 209 | Doi et al., 2007
  - Henaff:2019 | spya-bvhday | 209 | Henaff et al., 2019
  - Carion:2020 | spya-qzs5cw | 266 | Carion et al., 2020
  - Battaglia:2016 | spya-qzs5cw | 266 | Battaglia et al., 2016
  - Sobal:2022 | spya-gex5jf | 268 | Sobal et al., 2022
  - Bordes:2015 | spya-prfr9u | 274 | Bordes et al., 2015
  - Sukhbaatar:2015 | spya-prfr9u | 274 | Sukhbaatar et al., 2015
  - Henaff:2017 | spya-prfr9u | 274 | Henaff et al., 2017
  - Morari:1997 | spya-gy8f6b | 326 | Morari and Lee, 1997
  - Richalet:1978 | spya-gy8f6b | 326 | Richalet et al., 1978
  - Jordan:1992 | spya-xvww7c | 327 | Jordan and Rumelhart, 1992
  - Narendra:1990 | spya-xvww7c | 327 | Narendra and Parthasarathy, 1990
  - Miller:1995 | spya-xvww7c | 327 | Miller et al., 1995
  - Bertsekas:2019 | spya-k3e6qw | 328 | Bertsekas, 2019
  - Ha:2018b | spya-ff3vfq | 329 | Ha and Schmidhuber, 2018b
  - Ha:2018a | spya-ff3vfq | 329 | Ha and Schmidhuber, 2018a
  - Hafner:2018 | spya-ff3vfq | 329 | Hafner et al., 2018
  - Hafner:2020 | spya-ff3vfq | 329 | Hafner et al., 2020
  - Moerland:2020 | spya-ff3vfq | 329 | Moerland et al., 2020
  - Agrawal:2016 | spya-d99f0y | 330 | Agrawal et al., 2016
  - Finn:2017 | spya-d99f0y | 330 | Finn and Levine, 2017
  - Chua:2018 | spya-d99f0y | 330 | Chua et al., 2018
  - Srinivas:2018 | spya-d99f0y | 330 | Srinivas et al., 2018
  - Yu:2020 | spya-d99f0y | 330 | Yu et al., 2020
  - Yarats:2021 | spya-d99f0y | 330 | Yarats et al., 2021
  - Lerer:2016 | spya-jpx05q | 331 | Lerer et al., 2016
  - Oord:2017 | spya-jpx05q | 331 | van den Oord et al., 2017
  - Mathieu:2015 | spya-jpx05q | 331 | Mathieu et al., 2015
  - Luc:2020 | spya-jpx05q | 331 | Luc et al., 2020
  - Babaeizadeh:2017 | spya-jpx05q | 331 | Babaeizadeh et al., 2017
  - Denton:2018 | spya-jpx05q | 331 | Denton and Fergus, 2018
  - Mercat:2020 | spya-jpx05q | 331 | Mercat et al., 2020
  - Oh:2015 | spya-jpx05q | 331 | Oh et al., 2015
  - Fragkiadaki:2015 | spya-jpx05q | 331 | Fragkiadaki et al., 2015
  - Finn:2016 | spya-jpx05q | 331 | Finn et al., 2016
  - Nagabandi:2017 | spya-jpx05q | 331 | Nagabandi et al., 2017
  - Henaff:2019o | spya-fapgtp | 332 | Hénaff et al., 2019 (CPC; a different Hénaff from Henaff et al., 2019 above)
  - Oord:2018 | spya-fapgtp | 332 | van den Oord et al., 2018
  - Luc:2017 | spya-dw8kj9 | 333 | Luc et al., 2017
  - Luc:2018 | spya-dw8kj9 | 333 | Luc et al., 2018
  - Goroshin:2015a | spya-a9a38m | 334 | Goroshin et al., 2015a
  - Srivastava:2015 | spya-a9a38m | 334 | Srivastava et al., 2015
  - Wiskott:2002 | spya-a9a38m | 334 | Wiskott and Sejnowski, 2002
  - Gregor:2010a | spya-a9a38m | 334 | Gregor and LeCun, 2010a
  - Goroshin:2015b | spya-a9a38m | 334 | Goroshin et al., 2015b
  - Pari:2021 | spya-fp80br | 335 | Pari et al., 2021
  - Mohamed:2022 | spya-pe4hfh | 336 | Mohamed et al., 2022
  - Wayne:2014 | spya-pwm06u | 339 | Wayne and Abbott, 2014
  - Gehring:2021 | spya-pwm06u | 339 | Gehring et al., 2021
  - LeCun:2006 | spya-nt9nsa | 343 | LeCun et al., 2006
  - LeCun:1998 | spya-nt9nsa | 343 | LeCun et al., 1998
  - Hinton:1983 | spya-edwyt3 | 344 | Hinton and Sejnowski, 1983
  - Chopra:2005 | spya-yxn8ts | 346 | Chopra et al., 2005
  - Hadsell:2006 | spya-yxn8ts | 346 | Hadsell et al., 2006
  - Goldberger:2005 | spya-yxn8ts | 346 | Goldberger et al., 2005
  - Taigman:2014 | spya-yxn8ts | 346 | Taigman et al., 2014
  - Misra:2020 | spya-ypc9mu | 347 | Misra and Maaten, 2020
  - Chen:2020b | spya-ypc9mu | 347 | Chen et al., 2020b [row already used by sibling work (same surname/year, other letter)]
  - Caron:2020 | spya-je4mcv | 348 | Caron et al., 2020
  - Ermolov:2021 | spya-vp8dmm | 349 | Ermolov et al., 2021
  - Dai:2022 | spya-vp8dmm | 349 | Dai et al., 2022
  - Zaadnoordijk:2022 | spya-mfrf35 | 351 | Zaadnoordijk et al., 2022
  - Murphy:2002 | spya-fbszzh | 352 | Murphy, 2002
  - Gopnik:1997 | spya-fbszzh | 352 | Gopnik and Meltzoff, 1997
  - Spelke:2007 | spya-fbszzh | 352 | Spelke and Kinzler, 2007
  - Carey:2009 | spya-fbszzh | 352 | Carey, 2009
  - Gopnik:2001 | spya-fbszzh | 352 | Gopnik et al., 2001
  - Lake:2017b | spya-n7jnzn | 353 | Lake et al., 2017b [row already used by sibling work (same surname/year, other letter)]
  - Orhan:2020 | spya-n7jnzn | 353 | Orhan et al., 2020
  - Riochet:2019 | spya-n7jnzn | 353 | Riochet et al., 2019
  - Mattar:2022 | spya-nt9g2d | 354 | Mattar and Lengyel, 2022
  - Ho:2022 | spya-nt9g2d | 354 | Ho et al., 2022
  - Marcus:2019 | spya-g69p3r | 385 | Marcus and Davis, 2019
  - Vincent:2010 | spya-ud5m7m | 388 | Vincent et al., 2010
  - Devlin:2018 | spya-ud5m7m | 388 | Devlin et al., 2018
  - Carreira:2005 | spya-pf465v | 435 | Carreira-Perpiñán and Hinton, 2005

### 2 JMLR Srivastava (Dropout)
- Style: author-year (Natbib), incl. inside tables; reference list NOT in blocks
- N=36, covered=36, missed=0, recall=100.0%, capped=false, rows=35, rows with no in-text cite=0
- Missed: none

### 3 arXiv Vaswani (Attention)
- Style: numbered, bracketed [12] / [35, 2, 5]; reference list IS in blocks (ord 114-154)
- N=40, covered=40, missed=0, recall=100.0%, capped=false, rows=40, rows with no in-text cite=0
- Missed: none

### 4 Sci Rep Layfield (rearing)
- Style: numbered superscripts flattened to glued digits ("memory1-7", "Wells et al.18"); reference list NOT in blocks (only in row entries)
- N=70, covered=69, missed=1, recall=98.6%, capped=false, rows=69, rows with no in-text cite=0
- Missed works (key | first block | ordinal | citing words):
  - 43 | spya-w3u6mu | 23 | ...baited arms in the first four choices at test41–43. S

### 5 Clark & Chalmers 1998
- Style: author-year without parentheses around year ("Kirsh 1995", "(Hutchins 1995)") plus 5 footnotes; no reference list
- N=17, covered=17, missed=0, recall=100.0%, capped=false, rows=17, rows with no in-text cite=0
- Missed: none

### 6 Synesthesia (Wikipedia)
- Style: numbered Wikipedia bracket refs [12], footnote blocks at end (ord 168-319); reference list in footnotes
- N=152, covered=42, missed=110, recall=27.6%, capped=true, rows=44, rows with no in-text cite=2
- Missed works (key | first block | ordinal | citing words):
  - 1 | spya-xvxrn5 | 0 | ...ence, neurology, psychology Frequency 4%[1]
  - 6 | spya-adpz5b | 1 | ...nsory or cognitive pathways.[2][3][4][5][6] Syne
  - 7 | spya-adpz5b | 1 | ...ption, chronoception, and interoception.[7] Peop
  - 8 | spya-adpz5b | 1 | ...esthesia are referred to as synesthetes.[8]
  - 9 | spya-zrk2q4 | 2 | ...ific type of synesthesia that they have.[9][10]
  - 10 | spya-zrk2q4 | 2 | ...c type of synesthesia that they have.[9][10] In o
  - 14 | spya-zrk2q4 | 2 | ...map (clockwise or counterclockwise).[13][14] Syne
  - 15 | spya-zrk2q4 | 2 | ... number of senses or cognitive pathways.[15]
  - 17 | spya-af7gu5 | 4 | ...et when he heard the sound of a trumpet.[17] Howe
  - 19 | spya-af7gu5 | 4 | ...n Georg Tobias Ludwig Sachs in 1812.[18][19][20]
  - 20 | spya-af7gu5 | 4 | ...org Tobias Ludwig Sachs in 1812.[18][19][20] The
  - 22 | spya-fq3acq | 10 | ...synesthesia that linked all five senses.[22] Type
  - 23 | spya-ae8zpn | 13 | ...f the least common forms of synesthesia,[23] a si
  - 24 | spya-ae8zpn | 13 | ... be evoked in many people known as ASMR.[24][25]
  - 25 | spya-ae8zpn | 13 | ...evoked in many people known as ASMR.[24][25]
  - 26 | spya-bbpuk6 | 15 | ... aids them in identifying notes or keys.[26]
  - 27 | spya-he8nty | 16 | ...xperiences, are referred to as photisms.[27]
  - 32 | spya-zdt4ne | 26 | ... rarest documented forms of synesthesia.[32] This
  - 33 | spya-f83nda | 28 | ...ation whenever he hears the name spoken.[33][34]
  - 34 | spya-f83nda | 28 | ...n whenever he hears the name spoken.[33][34] It i
  - 35 | spya-f83nda | 28 | ...esia, making it one of the rarest forms.[35]
  - 37 | spya-zgt7zu | 30 | ...n, which some research links to empathy.[37] Howe
  - 40 | spya-f6bv2z | 35 | ...ssociated with personalities or genders.[40] Alth
  - 41 | spya-f6bv2z | 35 | ...ia was documented as early as the 1890s,[41][42]
  - 42 | spya-f6bv2z | 35 | ...as documented as early as the 1890s,[41][42] rese
  - 43 | spya-f6bv2z | 35 | ...terature by Julia Simner and colleagues,[43] alth
  - 44 | spya-tzh2js | 37 | ...le triggers (usually) consistent colors.[44]
  - 45 | spya-z0tbkd | 39 | ...cupying space in front and through them.[45][46][
  - 46 | spya-z0tbkd | 39 | ...ing space in front and through them.[45][46][47]
  - 47 | spya-z0tbkd | 39 | ...space in front and through them.[45][46][47]
  - 48 | spya-md3f5f | 41 | ... sometimes on imaginary strips of paper.[48] It h
  - 49 | spya-md3f5f | 41 | ...a" would better describe the phenomenon.[49] Rese
  - 50 | spya-md3f5f | 41 | ...e synesthesia may help explain dyslexia.[50]
  - 51 | spya-kkbnsb | 44 | ...ia, or if a new type will be considered.[51]
  - 53 | spya-g9aq2t | 48 | ...t noticed early in synesthesia research.[53] Some
  - 54 | spya-g9aq2t | 48 | ... creative processes, and daily life.[52][54]
  - 55 | spya-u5ys88 | 49 | ...y to participate in creative activities.[55] It h
  - 56 | spya-u5ys88 | 49 | ... reference their spatial visualizations.[56]
  - 60 | spya-yb6zd8 | 54 | ...tain conditions: temporal lobe epilepsy,[60] head
  - 61 | spya-tg4nax | 55 | ... and the problem of the explanatory gap.[61]
  - 64 | spya-vzccrx | 58 | ...interfere with normal daily functioning.[64] Inde
  - 68 | spya-pxa63e | 73 | ...ic–color is also prevalent at 18[7]–41%.[68] Some
  - 69 | spya-ssrh29 | 74 | ...roposing a female bias of around 6 to 1.[69] Howe
  - 72 | spya-cw8fv5 | 75 | ...ng synesthesia is greater in autism.[71][72] Anot
  - 76 | spya-nx89ky | 76 | ...ts that sensory hyperresponsiveness,[75][76] and
  - 77 | spya-nx89ky | 76 | ...n evoke distressing emotional responses.[77] A st
  - 79 | spya-f0sbfq | 78 | ...o the vocabulary of color in visual art.[79] Isaa
  - 80 | spya-f0sbfq | 78 | ...id Goethe in his book Theory of Colours.[80] Ther
  - 81 | spya-f0sbfq | 78 | ... perform colored music in concert halls.[81][82]
  - 82 | spya-f0sbfq | 78 | ...form colored music in concert halls.[81][82]
  - 83 | spya-w699xx | 79 | ...man physician Georg Tobias Ludwig Sachs.[83][18][
  - 85 | spya-w699xx | 79 | ...otisms among 73 synesthetes in 1876,[84][85] foll
  - 86 | spya-w699xx | 79 | ...owed in the 1880s by Francis Galton.[13][86][87]
  - 87 | spya-w699xx | 79 | ... in the 1880s by Francis Galton.[13][86][87] Carl
  - 88 | spya-w699xx | 79 | ...n his Symbols of Transformation in 1912.[88]
  - 89 | spya-uepc65 | 80 | ...n composer Arnold Schönberg (1874–1951).[89] She
  - 90 | spya-uepc65 | 80 | ...mburg in the late 1920s and early 1930s.[90]
  - 91 | spya-mep8nh | 87 | ...colors, he called them "Martian colors".[91]
  - 92 | spya-gxvhdt | 89 | ... art, abstract film, and intermedia.[52][92][93][
  - 94 | spya-gxvhdt | 89 | ...stract film, and intermedia.[52][92][93][94][79][
  - 95 | spya-gxvhdt | 89 | ...ilm, and intermedia.[52][92][93][94][79][95] Dist
  - 96 | spya-gxvhdt | 89 | ...tiple stimuli in one gestalt experience.[96] Neur
  - 97 | spya-usrc0y | 91 | ... at length in his memoir, Speak, Memory:[97]
  - 99 | spya-zmq9s9 | 93 | ...o says she experiences colors as scents.[99] Her
  - 100 | spya-ep7pdh | 96 | ...9–1921), using music–color associations.[100] Cont
  - 101 | spya-ep7pdh | 96 | ...ts with synesthesia, such as Carol Steen[101] (a p
  - 102 | spya-ep7pdh | 96 | ...eriences during severe migraine attacks.[102][103]
  - 103 | spya-ep7pdh | 96 | ...ces during severe migraine attacks.[102][103] Bran
  - 104 | spya-ep7pdh | 96 | ...and transmit these personal experiences.[104][105]
  - 105 | spya-ep7pdh | 96 | ...ransmit these personal experiences.[104][105][106]
  - 106 | spya-ep7pdh | 96 | ...it these personal experiences.[104][105][106] Davi
  - 107 | spya-ssae2z | 101 | ...-directional sound–color synesthesia.[4][107] For
  - 108 | spya-ssae2z | 101 | ...rted synesthesia include Duke Ellington,[108] Niko
  - 109 | spya-ssae2z | 101 | ...Ellington,[108] Nikolai Rimsky-Korsakov,[109] and
  - 110 | spya-g73pm0 | 102 | ...olors with music, or music with colors".[110]
  - 111 | spya-fgf6gr | 103 | ...esent the eleven main tube line colours.[111] Each
  - 112 | spya-fgf6gr | 103 | ... the colour of the tube line on the map.[112]
  - 113 | spya-ha3fm5 | 105 | ...ything he sonically makes is a painting.[113] Othe
  - 114 | spya-ha3fm5 | 105 | ...nclude musicians Thom Yorke, Billy Joel,[114]: 89,
  - 115 | spya-ha3fm5 | 105 | ...Billy Joel,[114]: 89, 91 Andy Partridge,[115] Itzh
  - 116 | spya-ha3fm5 | 105 | ...ge,[115] Itzhak Perlman,[114]: 53 Lorde,[116] Bill
  - 117 | spya-ha3fm5 | 105 | ...man,[114]: 53 Lorde,[116] Billie Eilish,[117] Char
  - 118 | spya-ha3fm5 | 105 | ...de,[116] Billie Eilish,[117] Charli xcx,[118] Bren
  - 119 | spya-ha3fm5 | 105 | ...ish,[117] Charli xcx,[118] Brendon Urie,[119][120]
  - 120 | spya-ha3fm5 | 105 | ...117] Charli xcx,[118] Brendon Urie,[119][120] Ida
  - 121 | spya-ha3fm5 | 105 | ...[118] Brendon Urie,[119][120] Ida Maria,[121] Bria
  - 122 | spya-ha3fm5 | 105 | ...,[119][120] Ida Maria,[121] Brian Chase,[122][123]
  - 123 | spya-ha3fm5 | 105 | ...][120] Ida Maria,[121] Brian Chase,[122][123] and
  - 124 | spya-ha3fm5 | 105 | ...cian Kristin Hersh sees music in colors.[124] Drum
  - 125 | spya-ha3fm5 | 105 | ...biography Drumming at the Edge of Magic.[125] John
  - 126 | spya-ha3fm5 | 105 | ...ynesthesia in a podcast with Rick Rubin.[126] Phar
  - 127 | spya-ha3fm5 | 105 | ...d N.E.R.D., also experiences synesthesia[127][128]
  - 128 | spya-ha3fm5 | 105 | ....R.D., also experiences synesthesia[127][128] and
  - 129 | spya-ha3fm5 | 105 | ...ia and reports colored days of the week.[129] Awst
  - 130 | spya-ha3fm5 | 105 | ...ces many of the band's artistic choices.[130]
  - 131 | spya-g4snty | 107 | ...ave been taken from Madame Blavatsky.[4][131] The
  - 132 | spya-gm7wxu | 108 | ... (I invented the colors of the vowels!).[132]
  - 133 | spya-njt934 | 110 | ...chnologists, like inventor Nikola Tesla,[133] and
  - 135 | spya-njt934 | 110 | ... n's, and dark brown x's flying around."[135]
  - 136 | spya-crgtw9 | 112 | ... is a 13-year-old girl with synesthesia.[136]
  - 137 | spya-kn5v9c | 113 | ...l student with person-color synesthesia.[137]
  - 138 | spya-p5qf7k | 115 | ...acters have been used in modern fiction.[138][139]
  - 142 | spya-kuc05p | 123 | ...eption or multisensory integration.[141][142]
  - 144 | spya-g86z7b | 124 | ...ffect may operate a form of ideasthesia.[144]
  - 145 | spya-wk243x | 125 | ... the philosophical problem of qualia,[5][145] give
  - 146 | spya-wk243x | 125 | ...lead to different conscious experiences.[146]
  - 148 | spya-sbajxd | 127 | ...echnology,[147] and sensory prosthetics.[148]
  - 149 | spya-b7f5fq | 129 | ...emented using low-cost hardware in 1991.[149] The
  - 151 | spya-b7f5fq | 129 | ...ed by pitch, and brightness by loudness.[151] The
  - 152 | spya-b7f5fq | 129 | ...ty into stimuli in a remaining modality.[152]
