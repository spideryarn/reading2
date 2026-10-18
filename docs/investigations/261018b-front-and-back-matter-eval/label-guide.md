# Labelling guide: front and back matter

For each article, list the stretches of blocks that a careful reader would want folded away by
default because they are apparatus rather than the piece itself. Each stretch is a contiguous run
of blocks {from, to} (inclusive, by block id) with one or more kinds:

- title — the article's title repeated as body text (a paragraph or heading at the start that only repeats the title).
- authors — author names, affiliations, emails, correspondence lines, equal-contribution notes, ORCID, an "Authors" label and its list.
- abstract — the authors' abstract, including its "Abstract" label.
- keywords — keywords, subject codes, JEL/MSC codes.
- contents — the piece's own table of contents (a "Contents" label and its list of section names).
- dates — received/accepted/published dates, DOI line, licence, copyright, "cite this as" lines, journal furniture.
- acknowledgements — thanks.
- funding — funding, grants.
- declarations — author contributions, authorship statements, competing interests / conflicts, data or code availability, ethics approval, "Details" groups made of these.
- references — the reference list / bibliography, including its heading.

NOT matter (leave showing; these are the critical negatives):
- appendices, supplementary sections with real content, glossaries, footnotes/endnotes;
- a standfirst, dek, "Significance" or "Key points" box, executive summary, introduction;
- an essay's own opening lines even if they mention a university or a person;
- an epigraph or dedication that is part of the piece (if fused into an authors block, label the block authors and note it);
- figures, tables and captions of the content;
- Wikipedia's "See also", "External links", "Further reading", "Notes"/"References": label "References"/"External links"/"Further reading" as references; "See also" and "Notes" stay showing.

Rules:
- Stretches are contiguous and do not overlap. Prefer one stretch per visually separate group (e.g. title+authors as one; abstract as its own; a later "Details" group as its own).
- Include a label paragraph/heading ("Abstract", "References") in its stretch.
- When unsure whether a block is the piece's prose, it is NOT matter. Note the doubt.
- Articles with nothing to fold get an empty list.

Output per article: {"slug": ..., "stretches": [{"from": id, "to": id, "kinds": [...], "note": "..."}], "doubts": ["..."]}
