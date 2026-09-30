D1 fixed — 54k-token ceiling fits within the claim, and the 600s reservation covers the measured 452s run; focused test passes 8/8.  
D2 moot — both `budgetFor` and `truncationFailure` now use the shared 40k headroom, so the message arithmetic is correct.  
Verdict — commit `42cd5825` fixes the requested issue.