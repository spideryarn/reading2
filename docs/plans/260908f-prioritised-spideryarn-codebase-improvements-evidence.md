# Audit command evidence

Baseline: `4adcdfd62703b6565a27a03c50f20f8a215f1bd8`, 2026-09-08.

Companion to [the plan](260908f-prioritised-spideryarn-codebase-improvements.md).
These are command outcomes, not an application correctness verdict. Product-only scope applies
to clone/complexity runs; the existing typecheck and test commands are repo-wide.

## Unused-code analysis

Command: `npm run knip`. Full output:

```text
> spideryarn@1.0.0 knip
> knip

ERROR: Error loading vite.api.config.ts (Client shell is not from this build: dist/build.json says commit "dea7bf69124150cea647860756d6a9a34f8c1ac3" and this API build says "4adcdfd62703b6565a27a03c50f20f8a215f1bd8". Re-run `npm run build`, which does both passes in order — the API build compiles dist/index.html into the function, so a stale one ships a stale page with no other symptom. (Note that "unknown" never matches, including itself.))
ERROR: Please fix or visit https://knip.dev/reference/known-issues
Unused files (13)
.tmp-smoke.mts                   
src/web/preview-callout.tsx      
src/web/preview-chat-markdown.tsx
src/web/preview-colour.tsx       
src/web/preview-composer.tsx     
src/web/preview-diagram-wait.tsx 
src/web/preview-illustrated.tsx  
src/web/preview-live.tsx         
src/web/preview-profile.tsx      
src/web/preview-sharing.tsx      
src/web/preview-sketch.tsx       
src/web/preview-timeline.tsx     
vitest.witness.config.ts         
Unlisted dependencies (1)
@tailwindcss/oxide  tests/tailwind-utilities-resolve.test.ts:106:25
Unlisted binaries (9)
cloc        scripts/count-lines.ts                
tofu        scripts/gjd-remote.ts                 
script      scripts/gjd-remote.ts                 
osascript   scripts/gjd-remote.ts                 
ssh-keygen  scripts/gjd-remote.ts                 
ss          scripts/worktree-check.ts             
mkfifo      tests/gjd-remote-prompt.test.ts       
mkfifo      tests/gjd-remote-tab-lifecycle.test.ts
jq          tests/statusline.test.ts              
Unresolved imports (1)
<whatever the page said>  src/extract.ts:380:4
Unused exports (190)
Refused                      class     scripts/changelog/changelog.ts:209:14  
deployRows                   function  scripts/changelog/changelog.ts:351:17  
productionDeploys            function  scripts/changelog/changelog.ts:362:17  
readSolAnswer                function  scripts/changelog/changelog.ts:840:17  
applyVerdicts                function  scripts/changelog/changelog.ts:958:17  
PDF_FIGURE_SELECTOR                    src/assets.ts:391:14                   
CALLOUT_ATTR                           src/callouts.ts:90:14                  
VERDICTS                               src/changelog.ts:66:14                 
chainProblems                function  src/changelog.ts:469:17                
loadThreads                  function  src/chat.ts:84:23                      
IMAGE_TIMEOUT_MS                       src/collect-assets.ts:138:14           
CONCURRENCY                            src/collect-assets.ts:140:14           
PDF_FIGURES_BUDGET_MS                  src/collect-pdf-figures.ts:196:14      
jobFor                                 src/converse.ts:138:14                 
defaultModel                           src/converse.ts:153:14                 
CANDIDATES_TIMEOUT_MS                  src/converse.ts:182:14                 
CHAT_STALL_MS                          src/converse.ts:194:14                 
citedBlockIds                function  src/converse.ts:1320:17                
ANSWER_TOKENS                          src/debate.ts:238:14                   
readDebate                   function  src/debate.ts:309:23                   
MIN_TITLE_EVIDENCE_CHARS               src/debate.ts:636:14                   
defaultModel                           src/explain.ts:93:14                   
EXPLAIN_STALL_MS                       src/explain.ts:132:14                  
FEEDBACK_TAG_KEYS                      src/feedback-envelope.ts:93:14         
USER_AGENT                             src/fetch.ts:718:14                    
readGlossary                 function  src/glossary.ts:830:23                 
HEADING_TREE_GENERATOR                 src/heading-tree.ts:93:14              
MIN_SEGMENT_PROSE_WORDS                src/heading-tree.ts:110:14             
readIdeas                    function  src/ideas.ts:536:23                    
PLATE_MEDIA_TYPES                      src/illustrated-image.ts:90:14         
MIN_QUOTE_WORDS                        src/illustrated-plate.ts:199:14        
MIN_QUOTE_CHARS                        src/illustrated-plate.ts:200:14        
MAX_QUOTE_WORDS                        src/illustrated-plate.ts:201:14        
MAX_QUOTE_CHARS                        src/illustrated-plate.ts:212:14        
MAX_PROMPT_CHARS                       src/illustrated-plate.ts:214:14        
MAX_STYLE_CHARS                        src/illustrated-plate.ts:215:14        
MAX_TITLE_CHARS                        src/illustrated-plate.ts:216:14        
MAX_NODE_CHARS                         src/illustrated-plate.ts:218:14        
MAX_VIGNETTE_TITLE_CHARS               src/illustrated-plate.ts:239:14        
MAX_CAPTION_WHERE_CHARS                src/illustrated-plate.ts:250:14        
drawnPlates                  function  src/illustrated-plate.ts:1044:17       
sceneSemantics               function  src/illustrated.ts:608:17              
renderPrompt                 function  src/illustrated.ts:679:17              
plateLettering               function  src/illustrated.ts:714:17              
MAX_FINDING_TEXT                       src/injection-scan.ts:133:14           
VISIBLE_INSTRUCTION_CAVEAT             src/injection-scan.ts:1273:14          
LabelsShifted                class     src/labels.ts:177:14                   
cameBackShort                function  src/labels.ts:194:17                   
LABEL_HEADROOM                         src/labels.ts:245:14                   
oversizedSets                function  src/labels.ts:733:17                   
parseShortfall               function  src/labels.ts:1209:17                  
assertInsideCoverageFloor    function  src/labels.ts:1565:17                  
renderShortfall              function  src/labels.ts:1869:17                  
droppedBudget                function  src/labels.ts:2021:17                  
PREVIEW_MAX_BYTES                      src/link-previews.ts:110:14            
PREVIEW_TIMEOUT_MS                     src/link-previews.ts:120:14            
PREVIEW_CLAIM_LEASE_MS                 src/link-previews.ts:129:14            
PREVIEW_EXCERPT_CHARS                  src/link-previews.ts:277:14            
LINK_SUMMARY_PROMPT_VERSION            src/link-summary.ts:113:14             
SUMMARY_PASSAGE_CHARS                  src/link-summary.ts:132:14             
SUMMARY_PROFILE_CHARS                  src/link-summary.ts:135:14             
SUMMARY_TIMEOUT_MS                     src/link-summary.ts:145:14             
SUMMARY_STALL_MS                       src/link-summary.ts:156:14             
SUMMARY_LIFETIME_MS                    src/link-summary.ts:176:14             
SUMMARY_CLAIM_LEASE_MS                 src/link-summary.ts:184:14             
SYSTEM                                 src/link-summary.ts:365:14             
LIVE_VOICE                             src/live.ts:81:14                      
NOISE_REDUCTION                        src/live.ts:132:14                     
DEFAULT_PLACEMENT                      src/live.ts:138:14                     
TOKEN_SECONDS                          src/live.ts:148:14                     
LIVE_SYSTEM                            src/live.ts:174:14                     
REALTIME_MAX_OUTPUT_TOKENS             src/live.ts:694:14                     
REALTIME_STATUSES                      src/live.ts:697:14                     
GATEWAY                                src/models.ts:826:14                   
providerSpokeNonsense        function  src/openrouter-stream.ts:610:17        
dropTrailingCommas           function  src/parse-json.ts:374:17               
FIGURE_OBJECT_TIMEOUT_MS               src/pdf-figure-read.ts:137:14          
PDFJS_GRAYSCALE_1BPP                   src/pdf-figures.ts:118:14              
PDFJS_RGB_24BPP                        src/pdf-figures.ts:119:14              
PDFJS_RGBA_32BPP                       src/pdf-figures.ts:120:14              
CHANNELS                               src/pdf-figures.ts:160:14              
PDF_FIGURE_REF_VERSION                 src/pdf-figures.ts:800:14              
SYSTEM                                 src/pdf-frontmatter.ts:177:14          
SCHEMA                                 src/pdf-frontmatter.ts:209:14          
frontMatterFingerprint       function  src/pdf-frontmatter.ts:240:17          
LEGACY_UNCONVERTED_STEPS               src/pipeline.ts:624:14                 
PRICE_CHECKED                          src/pricing.ts:116:14                  
PRICE_SOURCE                           src/pricing.ts:119:14                  
GEO_PRICE_SOURCE                       src/pricing.ts:122:14                  
US_INFERENCE_MULTIPLIER                src/pricing.ts:148:14                  
MODEL_ALIASES                          src/pricing.ts:213:14                  
REALTIME_PRICES                        src/pricing.ts:527:14                  
TRANSCRIPTION_PRICES                   src/pricing.ts:567:14                  
REALTIME_PRICE_SOURCE                  src/pricing.ts:572:14                  
REALTIME_PRICE_CHECKED                 src/pricing.ts:575:14                  
defaultModel                           src/quiz-mark.ts:104:14                
MARK_TIMEOUT_MS                        src/quiz-mark.ts:114:14                
MARK_STALL_MS                          src/quiz-mark.ts:125:14                
MARK_MAX_TOKENS                        src/quiz-mark.ts:136:14                
buildMarkMessages            function  src/quiz-mark.ts:407:17                
toQuestions                  function  src/quiz.ts:480:17                     
readQuiz                     function  src/quiz.ts:764:23                     
renderPrompt                 function  src/quiz.ts:1052:17                    
ANSWER_TOKENS                          src/quiz.ts:1083:14                    
occurrences                  function  src/quotes.ts:341:18                   
authorVoice                  function  src/quotes.ts:438:17                   
readQuotes                   function  src/quotes.ts:831:23                   
QuotesBaselineUnusable       class     src/quotes.ts:848:14                   
isMetadataPair               function  src/read-address.ts:131:17             
defaultModel                           src/referee-criteria-run.ts:130:14     
REFEREE_CRITERION_KINDS                src/referee-criteria.ts:67:14          
MAX_CITATIONS                          src/referee-criteria.ts:405:14         
defaultModel                           src/referee-mirror.ts:210:14           
MIRROR_TIMEOUT_MS                      src/referee-mirror.ts:220:14           
MIRROR_STALL_MS                        src/referee-mirror.ts:223:14           
mirrorCriteria               function  src/referee-mirror.ts:353:17           
isUnexplainedPlacement       function  src/referee-mirror.ts:688:17           
MIRROR_SYSTEM                          src/referee-mirror.ts:886:14           
isAllowedEmbed               function  src/sanitize-policy.ts:114:17          
defaultModel                           src/search.ts:102:14                   
SEARCH_STALL_MS                        src/search.ts:126:14                   
SHINGLE_WORDS                          src/shingles.ts:78:14                  
SHINGLE_MIN_CHARS                      src/shingles.ts:80:14                  
MIN_CANVAS_H                           src/sketch-scene.ts:68:14              
MAX_CANVAS_H                           src/sketch-scene.ts:69:14              
TONES                                  src/sketch-scene.ts:107:14             
MIN_REGION_BLOCKS                      src/sketch-scene.ts:788:14             
MIN_REGION_COVER                       src/sketch-scene.ts:790:14             
inferRegionOpens             function  src/sketch-scene.ts:832:17             
charsThatFit                 function  src/sketch-scene.ts:1050:17            
linesInBox                   function  src/sketch-scene.ts:1055:17            
MIN_OVERVIEW_NODES                     src/sketch-scene.ts:1298:14            
MIN_LINKED_SHARE                       src/sketch-scene.ts:1300:14            
MAX_OVERLAP                            src/sketch-scene.ts:1302:14            
MIN_FLOW                               src/sketch-scene.ts:1304:14            
OVERVIEW_MIN                           src/sketch.ts:85:14                    
OVERVIEW_MAX                           src/sketch.ts:86:14                    
readSketchFile               function  src/sketch.ts:133:23                   
renderPrompt                 function  src/sketch.ts:454:17                   
readArtefactOutcome          function  src/store/artifacts-pg.ts:587:23       
COMMENT_ANSWER_LEASE_MS                src/store/pg-comments.ts:83:14         
PREVIEW_RETENTION_MS                   src/store/pg-link-previews.ts:436:14   
deriveLibraryScalars                   src/store/pg-revisions.ts:394:10       
sweepAbandonedDrafts         function  src/store/pg-revisions.ts:2519:23      
readsOf                      function  src/store/session.ts:319:17            
MAX_PHRASE_CHARS                       src/timeline-time.ts:108:14            
MAX_PHRASE_ATOMS                       src/timeline-time.ts:110:14            
whenOf                       function  src/timeline.ts:204:17                 
TimelineBaselineUnusable     class     src/timeline.ts:855:14                 
readTimeline                 function  src/timeline.ts:907:23                 
ANSWER_TOKENS                          src/timeline.ts:1164:14                
asVisibilityState            function  src/web/AccessSharing.tsx:116:17       
activationForDiagram         function  src/web/activation.ts:502:17           
spokenMessages               function  src/web/chat/project.ts:69:17          
buttonVariants                         src/web/components/ui/button.tsx:101:18
toggleVariants                         src/web/components/ui/toggle.tsx:66:18 
hostOf                       function  src/web/DebatePanel.tsx:457:17         
emptyGroupNote               function  src/web/DebatePanel.tsx:495:17         
floorToGateStep              function  src/web/GlossaryPanel.tsx:656:17       
SKETCH_THEN_PAINT_COST                 src/web/IllustratedView.tsx:112:14     
wasDismissed                 function  src/web/install-hint.ts:112:17         
STAMP_KEY                              src/web/jump-history.ts:83:14          
measureOrigin                function  src/web/keynav.ts:287:17               
readLastView                 function  src/web/last-view.ts:302:17            
writeLastView                function  src/web/last-view.ts:324:17            
HttpError                    class     src/web/lib/api.ts:206:14              
directionLabel               function  src/web/lib/DataTable.tsx:120:17       
CALLBACK_PATH                          src/web/lib/supabase.ts:80:14          
PLACEMENT_LABEL                        src/web/live/mic-placement.ts:197:14   
CAME_FROM_ATTR                         src/web/notes-view.ts:77:14            
isMode                                 src/web/params.ts:306:10               
DEFAULT_REFEREE_VIEW                   src/web/params.ts:323:10               
isRefereeView                          src/web/params.ts:323:32               
RANKS                                  src/web/params.ts:467:14               
MATCHERS                               src/web/params.ts:621:14               
PLACE_HEADING                          src/web/PlaceOnCriterion.tsx:184:14    
NO_CRITERIA_TO_PLACE_ON                src/web/PlaceOnCriterion.tsx:185:14    
PLACING_IS_OPTIONAL                    src/web/PlaceOnCriterion.tsx:187:14    
SignUp                       function  src/web/PublicChrome.tsx:242:17        
VisitorPage                  function  src/web/PublicPages.tsx:244:17         
QUOTE_HEAVY_AT                         src/web/QuotesPanel.tsx:256:14         
NO_COMMENTS                            src/web/reader-capability.ts:187:14    
searchWithout                function  src/web/router.ts:1096:17              
NO_INSETS                              src/web/safe-area.ts:55:14             
QUOTES_RUN                             src/web/search-hits.ts:735:14          
RUNGS_A                                src/web/structure.ts:57:14             
RUNGS_B                                src/web/structure.ts:58:14             
ONE_UPLOAD_AT_A_TIME                   src/web/uploadEngine.ts:214:14         
mergedArrival                          src/web/useChat.ts:71:10               
ZOOMABLE_SELECTOR                      src/web/zoomable.ts:60:14              
Unused exported types (136)
ImageReference             interface  src/ai-call.ts:1526:18                    
PendingCall                interface  src/ai-spend.ts:217:18                    
CostSource                 type       src/ai-spend.ts:279:13                    
SpendSink                  type       src/ai-spend.ts:697:13                    
Resync                     type       src/billing/admission.ts:117:13           
SubscriptionState          interface  src/billing/subscription.ts:47:18         
ListSubscriptions          type       src/billing/sync.ts:91:13                 
TierId                     type       src/billing/tiers.ts:40:13                
ChangelogProvenance        interface  src/changelog.ts:83:18                    
Limits                     interface  src/collect-assets.ts:492:18              
ChatWireMessage            type       src/converse.ts:295:13                    
BillLine                   interface  src/cost-report.ts:326:18                 
ActualColumn               type       src/db/schema-drift.ts:37:13              
DebateResponseBody         interface  src/debate-journal.ts:175:18              
DebateResponseRefused      interface  src/debate-journal.ts:189:18              
DebateAttemptFinished      interface  src/debate-journal.ts:200:18              
AttemptReconciliation      interface  src/debate-journal.ts:249:18              
DebateCounts               type       src/debate.ts:177:3                       
DebateLean                 type       src/debate.ts:179:3                       
DebateRelation             type       src/debate.ts:181:3                       
ScreenshotRefusal          type       src/feedback-image.ts:86:13               
CascadeStatus              type       src/hierarchy-cascade.ts:287:13           
CapReached                 interface  src/hierarchy-cascade.ts:355:18           
RefusedTarget              interface  src/hierarchy-cascade.ts:394:18           
OversizedTarget            interface  src/hierarchy-cascade.ts:1002:18          
IllustratedVignette        interface  src/illustrated-plate.ts:269:18           
IllustratedPlateBrief      interface  src/illustrated-plate.ts:310:18           
PlateDraw                  interface  src/illustrated.ts:802:18                 
HiddenTextFinding          interface  src/injection-scan-types.ts:93:18         
VisibleInstructionFinding  interface  src/injection-scan-types.ts:104:18        
NothingExamined            interface  src/injection-scan-types.ts:143:18        
BlindSpot                  type       src/injection-scan.ts:111:3               
HiddenTextFinding          type       src/injection-scan.ts:113:3               
NothingExamined            type       src/injection-scan.ts:116:3               
OrdinaryExplanation        type       src/injection-scan.ts:117:3               
VisibleInstructionFinding  type       src/injection-scan.ts:120:3               
JobDisplayState            type       src/job-state.ts:63:13                    
BatchCameBackShort         type       src/labels.ts:192:13                      
SiblingSet                 interface  src/labels.ts:364:18                      
MessageStream              type       src/messages-stream.ts:168:13             
CallMeter                  interface  src/messages-stream.ts:179:18             
EvalAiJob                  type       src/models.ts:595:13                      
LiveAiJob                  type       src/models.ts:620:13                      
ToolAiJob                  type       src/models.ts:644:13                      
ImageAiJob                 type       src/models.ts:670:13                      
NoteShape                  type       src/notes.ts:205:13                       
PageSkip                   type       src/pdf-figure-read.ts:144:13             
UnreadReason               type       src/pdf-figure-read.ts:154:13             
RasterKind                 type       src/pdf-figures.ts:157:13                 
RasterRefusal              type       src/pdf-figures.ts:191:13                 
LegacyUnconvertedStep      type       src/pipeline.ts:627:13                    
RealtimePrice              interface  src/pricing.ts:486:18                     
RealtimePriceRow           interface  src/pricing.ts:502:18                     
QuizBand                   type       src/quiz.ts:259:21                        
QuizQuestionId             type       src/quiz.ts:259:59                        
Dropped                    type       src/quiz.ts:268:13                        
Placement                  interface  src/quotes.ts:303:18                      
MirrorRemarkKind           type       src/referee-mirror.ts:160:3               
ArticleWindow              interface  src/shingles.ts:96:18                     
PaintedRegion              interface  src/sketch-paint.ts:138:18                
SketchShape                type       src/sketch-scene.ts:82:13                 
SketchLine                 type       src/sketch-scene.ts:83:13                 
SketchArrow                type       src/sketch-scene.ts:84:13                 
SketchRegionStyle          type       src/sketch-scene.ts:86:13                 
SourceOrigin               type       src/source.ts:77:13                       
RawDocument                interface  src/source.ts:110:18                      
LedgerShortfall            interface  src/store/ai-calls.ts:181:18              
StoreOutcome               type       src/store/blobs.ts:337:13                 
Turn                       interface  src/store/contracts.ts:810:18             
FeedbackDiagnostics        type       src/store/contracts.ts:1661:3             
FeedbackEnvironment        type       src/store/contracts.ts:1662:3             
FeedbackKind               type       src/store/contracts.ts:1663:3             
BundleEntry                interface  src/store/export-bundle.ts:101:18         
ShelfTally                 interface  src/store/pg-admin.ts:113:18              
CountRow                   interface  src/store/pg-admin.ts:122:18              
IngestTally                interface  src/store/pg-admin.ts:136:18              
Admitted                   interface  src/store/pg-billing.ts:116:18            
ShareCandidate             interface  src/store/pg-billing.ts:132:18            
Eligible                   interface  src/store/pg-billing.ts:594:18            
LibraryScalars             type       src/store/pg-revisions.ts:394:37          
ClaimFailure               type       src/store/uploads.ts:113:13               
TimelineOccurrence         type       src/timeline.ts:193:65                    
StepStatus                 type       src/types.ts:2450:13                      
QuizMarkBody               interface  src/types.ts:3461:18                      
ClaimFailure               type       src/upload-records.ts:40:15               
ModeActivation             type       src/web/activation.ts:198:13              
MarkKind                   type       src/web/annotate.ts:87:13                 
Intent                     type       src/web/chat/model.ts:131:13              
LoadPhase                  type       src/web/chat/model.ts:479:13              
CommentAccess              type       src/web/CommentDialog.tsx:49:13           
DebateAccess               type       src/web/DebatePanel.tsx:654:13            
ModesMissingFromDock       type       src/web/Dock.tsx:806:13                   
ScreenshotProblem          type       src/web/feedback-screenshot.ts:76:13      
ProseSection               interface  src/web/GlossaryPanel.tsx:935:18          
EdgeKind                   type       src/web/graph.ts:98:13                    
GraphEdge                  interface  src/web/graph.ts:100:18                   
IdeasAccess                type       src/web/IdeasPanel.tsx:71:13              
JobsSnapshot               interface  src/web/jobEngine.ts:127:18               
SpineMode                  type       src/web/layout.ts:250:13                  
LibraryMatch               interface  src/web/link-facts.ts:142:18              
AnchorPreview              interface  src/web/link-preview.ts:46:18             
Citation                   interface  src/web/link-preview.ts:73:18             
OtherPreview               interface  src/web/link-preview.ts:113:18            
LivePhase                  type       src/web/live/useLiveConversation.ts:100:13
LiveLine                   interface  src/web/live/useLiveConversation.ts:103:18
LivePointer                interface  src/web/live/useLiveConversation.ts:113:18
LiveToolRun                interface  src/web/live/useLiveConversation.ts:120:18
LiveToolResult             interface  src/web/live/wiring.ts:67:18              
ApiOutcome                 type       src/web/log-buffer.ts:104:13              
UploadLogEntry             interface  src/web/log-buffer.ts:162:18              
ClientErrorSource          type       src/web/log-buffer.ts:177:13              
FigureOutcome              type       src/web/PdfFigureNote.tsx:84:13           
QuotesAccess               type       src/web/QuotesPanel.tsx:81:13             
ImagePlacement             type       src/web/rehost.ts:383:13                  
StoredSrc                  interface  src/web/rehost.ts:585:18                  
SearchAccess               type       src/web/SearchPanel.tsx:141:13            
SketchAccess               type       src/web/SketchView.tsx:167:13             
RungA                      type       src/web/structure.ts:54:13                
RungB                      type       src/web/structure.ts:55:13                
RowKind                    type       src/web/structure.ts:95:13                
TimelineAccess             type       src/web/TimelinePanel.tsx:303:13          
UploadSnapshot             type       src/web/uploadEngine.ts:139:13            
ArcStatus                  type       src/web/useArc.ts:69:13                   
CheckoutReturn             type       src/web/useBilling.ts:41:13               
SpokenLanded               type       src/web/useChat.ts:53:15                  
Begun                      type       src/web/useChat.ts:72:15                  
SendOptions                interface  src/web/useChat.ts:109:18                 
NewCommentInput            interface  src/web/useComments.ts:72:18              
DictationPhase             type       src/web/useDictation.ts:188:13            
MeterKind                  type       src/web/useDictation.ts:191:13            
IllustratedStatus          type       src/web/useIllustrated.ts:55:13           
SketchReadiness            type       src/web/useIllustrated.ts:67:13           
AlreadyAnArticle           interface  src/web/useJobs.ts:36:18                  
MirrorStatus               type       src/web/useMirror.ts:48:13                
MarkStatus                 type       src/web/useQuiz.ts:137:13                 
SketchStatus               type       src/web/useSketch.ts:38:13                
Duplicate exports (1)
QUOTE_BAR_DEFAULT|QUOTE_HEAVY_AT  src/web/QuotesPanel.tsx
```

## Product complexity

Command: `node_modules/.bin/biome lint --only=complexity/noExcessiveCognitiveComplexity --max-diagnostics=none src api`. Relevant output excerpt (not the full log):

```text
Checked 580 files in 351ms. No fixes applied.
Found 84 infos.
```

## Product duplicates

Command: `node_modules/.bin/jscpd src api --min-lines 5 --min-tokens 50 --format typescript,tsx --reporters console`. Relevant output excerpt (not the full log):

```text
│ Total:     │ 516            │ 296494      │ 764165       │ 250          │ 4532 (1.53%)     │ 19039 (2.49%)     │
Found 250 clones.
```

## Typecheck through the same script, bypassing CLI IPC

Command: `node --import tsx scripts/typecheck.ts`. Full output:

```text
✓ src/web/tsconfig.json  (341 files)
✓ tests/tsconfig.json  (1588 files)
✓ tools/fleet/web/tsconfig.json  (29 files)
✓ tsconfig.json  (469 files)
✓ all 1666 source files are covered by some project
```

## Full suite attempt

Command: `npm test`. Relevant output excerpt (not the full log):

```text
[private lane] could not scavenge (carrying on): connect EPERM 127.0.0.1:54362 - Local (undefined:undefined)
No test files found, exiting with code 1
Error: No database, and every test that touches the store needs one.
```

## Full check attempt

Command: `npm run check`. Relevant output excerpt (not the full log):

```text
Error: listen EPERM: operation not permitted /tmp/tsx-1000/15.pipe
  code: 'EPERM',
  syscall: 'listen',
  address: '/tmp/tsx-1000/15.pipe',
```

## Documentation links

Command: `npx vitest run --project unit tests/doc-links.test.ts`. Full output:

```text
RUN  v4.1.11 /home/greg/code/spideryarn2


 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  13:20:58
   Duration  13.43s (transform 1.93s, setup 724ms, import 8.03s, tests 4.12s, environment 0ms)
```

## Interpretation

Knip reported a config-load error but continued printing findings; its potentially incomplete
graph makes those findings unsafe deletion evidence. The test/check attempts were blocked by the sandbox, not shown
to pass; no database was reset or reconfigured. The typecheck script and all 14 doc-link tests
passed. No production data operations or application inference calls were made. Agent/reviewer
invocations are separate from those application checks.

## Final targeted validation after the postmortems and plan revisions

Command: `npx vitest run --project unit tests/doc-links.test.ts tests/no-raw-nul-bytes.test.ts`.
The first sandboxed attempt passed doc links but the raw-NUL suite could not spawn read-only
`git ls-files` (`spawnSync git EPERM`). The same two-file command outside the sandbox completed:

```text
 Test Files  2 passed (2)
      Tests  16 passed (16)
   Start at  13:28:42
   Duration  6.74s (transform 1.23s, setup 1.26s, import 2.43s, tests 5.93s, environment 0ms)
```

## Final manifest validation after full Sol review

Created a disposable snapshot from `git archive HEAD` at
`22f801b40c5724beb204331d9690474ea3f07057` (the shared branch had advanced since the audit).
Copied only the eight files in the review prompt's final manifest and linked the installed
`node_modules`. No other untracked files were included. Ran the existing document-link suite
there with `node node_modules/vitest/vitest.mjs run --project unit tests/doc-links.test.ts`:

```text
 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  13:49:34
   Duration  9.52s (transform 502ms, setup 464ms, import 4.01s, tests 4.45s, environment 0ms)
```

The two-file command above was then repeated in the shared checkout outside the sandbox:

```text
 Test Files  2 passed (2)
      Tests  16 passed (16)
   Start at  13:49:39
   Duration  6.93s (transform 714ms, setup 790ms, import 2.95s, tests 5.28s, environment 1ms)
```

A mechanical check found eight unique manifest paths, all sixteen priority rows carrying one of
the defined evidence states, and exactly one Stripe reconciliation row. These checks establish
artifact completeness and link/label consistency, not application behaviour. The summary of
these results was appended after the run; it introduces no new file dependencies.
