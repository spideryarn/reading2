-- C7 first-application preflight, reviewed HEAD d4bbcd76e plus uncommitted review fixes.
-- Read-only; not executed in this review. Run on production's SESSION connection
-- using the migration credential. It expects the complete original 153-row ledger,
-- followed by exactly these nine pending files. Rebuild this ledger literal if
-- the final deployment commit contains additional migrations.
-- The eighth, 20261007053304_billing_voucher_recipient_name, is another
-- session's (plan 261007f-gift-voucher-recipient-name-and-a-starter-article-written-up),
-- which landed on dev first; its only checks here are its two objects in the
-- "absent before" block.
-- The ninth, 20261007073504_drop_queue_state_running_job_id, was added on
-- 2026-10-07: a column drop Greg approved that day (plan 261007g § 2). Its checks
-- are the queue_state blocks below, and queue_state and jobs in the lock and
-- ownership inspections. It was generated as 20261007065807_… and regenerated
-- after the voucher migration when the two branches met.
-- Every query labelled VIOLATIONS must return ZERO rows. Counts may grow since
-- the recorded investigation: only the violation counts must remain zero.
-- A different catalog definition is a stop for inspection, even if it is equivalent.
-- Do not replace a mismatch with IF EXISTS or insert/restamp production ledger rows.
BEGIN READ ONLY;

SELECT current_database() AS database, current_user AS role,
       inet_server_addr() AS server, current_setting('server_version') AS version,
       current_setting('lock_timeout') AS connection_lock_timeout,
       current_setting('statement_timeout') AS connection_statement_timeout;
SET LOCAL statement_timeout = '30s';

-- Must report 153 rows and watermark 1791297828720.
SELECT count(*) AS applied_rows, max(created_at) AS watermark
FROM spideryarn_migrations.__drizzle_migrations;

-- VIOLATIONS: verify every earlier file's exact timestamp/hash once, plus no extras.
WITH expected(stamp, hash, tag) AS (VALUES
  (1787672809494::bigint, 'cd49f3e45b9bce3f5ff0c09ceed9240adf3aca97f787538a5438d9b9dc33ae17', '0000_initial_schema'),
  (1787672856050::bigint, 'd48ca058f56d24269bb6bf8f526ca761b5e866298f70dc8fdf2cff80a5d2e784', '0001_auth_fks_and_guards'),
  (1787702006732::bigint, 'c31fd629f72fe1d04ea7ae1a72450bc7e6fe9c5711e4e896052d69de79f70465', '0002_reader_state_and_missing_columns'),
  (1787702007732::bigint, '691d2dc224e2243424dbc4896e145fb4d44020c2ee8879db491337ae6c5e7388', '0003_reader_state_owner_fks'),
  (1787727453114::bigint, '3a89129b5b00754c1a0f746d1cb180a48979fb0ec249717f701f0c34bf20dd74', '0004_shelf_state_and_block_fts'),
  (1787745570629::bigint, '0f30c9830ffd9d3ad0e953ba5dec0a67db079ec01f641ba1bf4b91a5b5951b3d', '0005_reader_state_writes'),
  (1787747080171::bigint, '2aad56c2bdd0e7e5b78abdef2a6707479e1830a87ed5edd847817ab5cfd77f75', '0006_chat_attempt_fence'),
  (1787747856697::bigint, '10db6bc2e7b85552998c61c7428f6e2cf7407af65ca8c803eb3f6aa66d41ec97', '0007_chat_message_tools'),
  (1787756959853::bigint, '11182eb63c14bd757bcae85ce0e45c4777ef974aa82b24b401866082503e2b1d', '0008_pdf_provenance'),
  (1787758030020::bigint, '503749c3f8d056eafa7bf57190fbd58e65f372d7cd0efa65c6d1e12c730bee85', '0009_search_source_hash'),
  (1787758144693::bigint, '10066c40208b3f71c324d84aff6c055b1f9efff3e665d44e3b0e4d44893331a5', '0010_job_owned_draft_and_fixture'),
  (1787762561139::bigint, '495244c861935f90e346b8a14250e66f7a075e2bdcb068d5c699d1d2d4aa8ac9', '0011_reader_profile'),
  (1787766518824::bigint, '0815b3cf0ba8d969ccd5bdba6313adfe9f4983d1c4eed78520d8ae5451e97adf', '0012_chat_thread_anchor'),
  (1787770358484::bigint, '2ecbf9209bd9f8fcf05b7f6194dedceaa26c628b23c6317e894e0d3c2cc8abb7', '0013_ideas'),
  (1787813915927::bigint, 'f8caa2462b44f8c344335d6b4acab61ebe7b66282f18a8c593b2534ead01b829', '0014_uploads_and_job_work_key'),
  (1787813925519::bigint, '442f801250937abf59d5bb7416ed74a67cc3e389ee7fd917336976e637d5f759', '0015_uploads_auth_fk'),
  (1787816498311::bigint, '6cc7af4b64000a6518be355db5db65569339cef2814b57dc5f163eea2e9b949c', '0016_search_colour'),
  (1787834476293::bigint, '47d1d277e146fc6567b373d5166838dc291165b7d23ee7eebbf47a9fa1cd5c72', '0017_step_run_attempt'),
  (1787842631615::bigint, '6ce2f17c5f5581cbc125bbac68f9ab5c2975f0acb4c7f5f9fdf948e89346a34c', '0018_raw_sources'),
  (1787860625775::bigint, '345702f51fd8317147f44cbbd752b984b705a78036ddd5a8f29198d8ab47690d', '0019_nebulous_romulus'),
  (1787865824815::bigint, '93bceec35004c9294df4bb7aa8e0897c33aa8afc237d73948feb1cc98c19f00f', '0020_comment_body'),
  (1787865825815::bigint, '3b040b09ca1b76962c11b6b80a00475401b974b9cda17267ba70057558cd49ea', '0021_ai_calls_ledger'),
  (1787867857885::bigint, 'd97f9bed57a42c50fa3caa4f93f3b7d5c89d991fe8b1791fbf8cac903e3584cb', '0022_raw_provenance_columns'),
  (1787867857886::bigint, 'b7ea01994edacd784442f349b38ca46ac5d61efafdc303dab4f3f48f5025b957', '0023_ai_calls_cost_provenance'),
  (1787899438564::bigint, 'd96f27b28ce3600614426cf73490819f504f6d3f022d2236c5f716367d03b5e7', '0024_article_visibility'),
  (1787899438565::bigint, '5d79724dc187e01cbe824c97f630ff8ae329a76fb0a02671529e709fdbfd3a8a', '0025_ai_calls_price_version'),
  (1787908197710::bigint, '192e4ab35d35fdb27eb06aa951d79412759b8dbf94e874010bc61bed68a69fb1', '0026_visibility_audit_survives_deletion'),
  (1787920535845::bigint, 'c28ef8661d7c1daa52d6ab9fb159211c2ccbb1a830381fe390724bb41268990e', '0027_block_roles'),
  (1787983944815::bigint, '481f5b74a15626a48b333ccb50d19777c028d718287e6545a4e01ecca7bab149', '0028_foamy_cassandra_nova'),
  (1788070344815::bigint, '417da87a2f3d46bce3fc4c6926618f069a75ff3352652a584ba747f2d1cff978', '0029_assets'),
  (1788084884213::bigint, '65ad661d147f226caf4856ce31fcd02fe05dcfe2c434d9848141ee1cfab3ee60', '0030_drop_summary_steer'),
  (1788088195352::bigint, '8eb7c399c2050c057e1c87ea35063e4e5b52813add45eee23556a4601a1f5357', '0031_sketch'),
  (1788118212636::bigint, '60bbe71166181ee8a025cce1e37a3387d90fca20ca41cd2886e766484f9d709f', '0032_jobs_concurrency_cap'),
  (1788159937926::bigint, '7315ea02a019f086966d21f73326704d5545bb52960192fe29aacff7b652b2f9', '0033_quotes'),
  (1788163164707::bigint, '59f9efaed147dfd143e3a82ced63c13e5bbd0a411987d7537fa97e1466bca8c0', '0034_flowery_wolfsbane'),
  (1788200000000::bigint, '46a89778a88f59fd2701a58624da00b2afadf9b83469731b3e7fb65c46bbc9bd', '0035_timeline'),
  (1788175229610::bigint, 'ffb07079bc4699fbec77f9862ceac2be30205fbfdc1cd5935538bc938b1ba3cb', '0036_drop_summary_column'),
  (1788206280872::bigint, 'da37bfa824f1df41ebf44be5aedcbf576ca75a6d72eabcff19f891ff82b9eb05', '0037_experimental_features_and_callout_blocks'),
  (1788206483339::bigint, '6c786be52126daf9b1c601d11a34edd82c7e02bd3f3b10b375c0328e0ee38dc1', '0038_block_contexts'),
  (1788211543261::bigint, '283e28ecfedbddc532bbddca045c1eaeeb5ecd4cccd081b88771119c292294ad', '0039_feedback'),
  (1788211557997::bigint, '0541773e59c2f937f1b95c3a0fc034565e37c942bb8751880966218793e04947', '0040_feedback_owner_fk'),
  (1788214221651::bigint, '33000f1453cfdc22cd8ce20049d64a1667b804e938e036911aea237878e82d2a', '0041_rename_toc_step_to_hierarchy'),
  (1788215711359::bigint, 'acb836d4385d2dcef86d58ce5a94bd9ab4e84d9c8aa1aa257195ea3246d2c1da', '0042_referee_criteria'),
  (1788215712359::bigint, 'a59b9c3473f6503bc00dbb2959f1999dfe7b85aadc34b23d82f33b54d6f51f0e', '0043_referee_criteria_owner_fk'),
  (1788217585300::bigint, 'b7c0fecb220dec923a08984df0352b0420edb9419b98bd4fc52da054af2209a1', '0044_article_short_id'),
  (1788218295519::bigint, '249c3485d28bcfac7ab1d9d0d987891de63272a22c8f322bdbd0b4493f260603', '0045_feedback_mirror_attempted'),
  (1788219000000::bigint, 'ef770ab6820acbddeb2e0db57661bbca522eeb5f71062f0d5b330a54215bd37d', '0046_quiz'),
  (1788241363734::bigint, 'c80438783d30be90055abbd119a861c6d2f42c9d8d45b68cd89138973bce1dac', '0047_based_on_revision_id'),
  (1788251106639::bigint, 'fbda9d4d23cf50e66ad841b73f9da378ee13db9914332c85aa2e3cf5b151e042', '0048_rename_review_thread_kind'),
  (1788259177335::bigint, '9200afa41f1bb413fd94939da89e47d4a4de72517f1e3b9e0e2a921dc465a121', '0049_drop_raw_bytes'),
  (1788263313445::bigint, 'ab6a62610de16d0512a2c692d4ac703f0782227643ca3b8ce23f9dbb861d69fd', '0050_candidates_thread_kind'),
  (1788271506934::bigint, '0ad01418d4b25923f4f1836d6ae9fd1632a5624af0ca6b25bef71c7be4a0f2d6', '0051_referee_claims'),
  (1788351034981::bigint, 'c9f0dcf33a2c1841968d2c50a0114e42ef1781b3fd3d5d214cfa220873d88825', '0052_per_article_job_queue'),
  (1788358263301::bigint, '7d520949ca9c9ffd6b696fb1726c8aecae0d675cc217d415cc603f60418b3d2a', '20260902141103_byok_upstream_nanos'),
  (1788361792046::bigint, 'a5e25e89caa0d37346f3c505822ab8cafae095af5b9d674597e775654508f64f', '20260902150952_realtime_sessions_and_usage'),
  (1788365729661::bigint, '07abfde5e29ea8a384a6741940a28068137468f3f911c1eb4881d9dccfe7beb7', '20260902161529_feedback_body_and_kind'),
  (1788365753441::bigint, 'a34b5ae067678fb7730be4eeaa259405837696aa481af4e9a8538f87cb720755', '20260902161553_feedback_one_body'),
  (1788370093105::bigint, '4c6e69928481c6633f354f0674ee3fcdff76541151a9ba068ae206c9104b5e84', '20260902172813_billing_quota'),
  (1788370118538::bigint, '1aefef6c5e725f67355d774972aa0fa65e69e00fdfa7031937ac8421c6184b34', '20260902172838_billing_owner_and_event_fks'),
  (1788372592443::bigint, '0477450fd02be60f732a61d2ddad5dae98247c9e10e28277832bde2b0b5a3434', '20260902180952_billing_tiers'),
  (1788372604824::bigint, 'a981c38ba8fb9d34c2419cc92eae39458b1a853ba21daff482e3011b7897dc16', '20260902181004_seed_billing_tiers'),
  (1788373408888::bigint, '647833a3ae1d5c84dd74d588863a343d74db792bb42137969d251e5d6bcd732e', '20260902182328_feedback_url_replaces_route_kind'),
  (1788395683930::bigint, '12e6dba26e81fabf9b3c6d885886ab170810ced5e2a4c39336214bd84f663a55', '20260903003443_ai_calls_costs_not_negative'),
  (1788413825686::bigint, '94ea842646b035df23a4531a6cc81c71471991b29342412355f38c178fc647ca', '20260903053705_illustrated'),
  (1788425000000::bigint, '86dd02ab814d432bac77bb90c910821a092b938271b4e26783646bbc68243430', '20260903090000_tier_descriptions_stop_restating_the_allowance'),
  (1788455980840::bigint, 'c8011bbd6304f50c8a02de14236763b400855664c4c4ea6807e918e81475b3a5', '20260903171940_jobs_requeues'),
  (1788505820903::bigint, '7638008cfc715f718a9229e79e8c1713ea8a17255f9b436db3bdbe0409d6990a', '20260904071020_billing_cancel_at_and_quota_delta'),
  (1788522663938::bigint, '78e8bcbdaab9dd5d4aa37423703ad043432b3d0aab79cf5a35dc5654ec4b0490', '20260904115103_checkpoints_hierarchy_structure'),
  (1788544682883::bigint, 'b6a11da1ee9d5352b297df08f81cc649cbcbe3b6777acb4a957ac420ae84eedd', '20260904175802_articles_public_listing'),
  (1788563287554::bigint, '64e793798354175c6a5d95909040ccbb64d91d5e9f7657329ece73a63ea8b9bd', '20260904230807_billing_subscription_fields_need_subscription'),
  (1788565876280::bigint, '1351145d7b6ed405c28613032fd943ffdb2acb9d4f14f77484f8d85ed0d453f8', '20260904235116_ingest_events_article_id'),
  (1788578139327::bigint, '62e2f3731140a4248217310f87f07454530b74b99afafd2a2df0bbc271e2bb8e', '20260905031539_checkpoints_hierarchy_deepen'),
  (1788604694640::bigint, '232d80183a3771249e18aee78313cdbcfe911980009710e31ba1b72cf8003979', '20260905103814_chat_messages_help'),
  (1788618673085::bigint, '2796c1da51033d938f8cc934a359724ad5e965a7b13dc5172470ce71bb1b71be', '20260905143113_debate'),
  (1788629172387::bigint, '45cb53721e81d68abc9080e11f1c950ec92919e120611da179700b1daaca59a1', '20260905172612_link_previews_and_rate_limit_events'),
  (1788629210854::bigint, '23ae198f04dfe0a9c58d0bce303caee30b44ab0c8b7133fd29f274c05485a450', '20260905172650_rate_limit_events_owner_fk'),
  (1788635381862::bigint, '6e55543afbfe4912da5e7124df6c81c3d16827ace3e271917441dbe4d77f3465', '20260905190941_link_summaries_and_excerpt'),
  (1788635417860::bigint, '6992322e041049e94d8842291778aadd9b88d596575550aea9e83bdd444866a4', '20260905191017_link_summaries_owner_fk'),
  (1788646079356::bigint, 'e19d4d81ff133d93c1297435bcb2fd7f348054af02d5fab5ff04c12ed7cd55ea', '20260905220759_link_summaries_block_id'),
  (1788678017527::bigint, '6894d6bc6b291d264b41565e500bb9311d7c70392076714a2f4a483abf90ebc8', '20260906070017_nav_label_status'),
  (1788735600000::bigint, 'c0fc0eaca74e25e4e49df2df833eb508b7eaa31284ec163b71e937e0ef0e9703', '20260906190000_labels_step'),
  (1788735900000::bigint, 'db5161144cd7ddc15c9d02be9343ead0aabaf8b99f4f5aa9df304a845d50b245', '20260906230500_ingest_events_freeze_price_at_delete'),
  (1788811680868::bigint, '8a5c9b4c500add16a7139f84ae620c6be88560f6fb5d264dcc22613144714a2c', '20260907200800_ingest_events_unlink_atomically'),
  (1789164132065::bigint, '166406dcba7128adac6325559375516eaae013f27480bff0aa0718562b114fa3', '20260911220212_citations'),
  (1789171352950::bigint, 'e78e1f2a7016d59d5ce19d09421119d5f7f82874d6b2f92ae7db08a7386f94ea', '20260912000232_citation_finds'),
  (1789171371338::bigint, '559514104352f31e290b30f905be80ae9482876dbb4a517201da2a4e470c9c33', '20260912000251_citation_finds_owner_fk'),
  (1789204307936::bigint, 'f591e8c95eb5a477ae0172e9e0b2682c10a8f2e0a68568a7df236b2af2c7b642', '20260912091147_citation_find_rate_bucket'),
  (1789228066827::bigint, '5d0f38d219603ef3e16265676e63dfeb3ad0437869b49d8d14a82d2b063accb1', '20260912154746_comments_whole_block_bookmark'),
  (1789556818682::bigint, '22aebbb381bae982917e763705afb35bb9b7803d8dc7377b02c9bba0d38c4f05', '20260916110658_reading_time'),
  (1789571139769::bigint, '1093497634f145bc553eed3b7b34861047543cbb4d32488680d57f79c05af9ab', '20260916150539_faq'),
  (1790558805538::bigint, '2d7a7cf2a039a0149e0ec1cd6f0b0350bd13695825b2b46b6bbd2567444bc25a', '20260928012645_trajectory'),
  (1790561035685::bigint, 'a0bfaab5187af62f143f9bea304722e9afd523f378b9cca67d5568012ab3a790', '20260928020355_jobs_reset'),
  (1790562849166::bigint, 'f34f1d3e396ecb694709c71a4c3df86e3e0e34f109a47278a740e71aba82a54f', '20260928023409_shelf_terms_revision_phrase_runs'),
  (1790659725677::bigint, '1de5486da971627876aabbcf7df013d89bfabdad2a34383d21059a3a6ef36765', '20260929052845_drop_jobs_one_running_per_slug'),
  (1790664631985::bigint, '302e5c4d4c45a079ea97db8ea3aa3d5b4ee693351c106256fd089b5776d1e519', '20260929065031_shelf_topic_scores'),
  (1790685440667::bigint, 'e13b63bf17dab33f93ea8475d07cb520d65327bff123b4d3073a67decb0f6ee5', '20260929123720_revision_authors'),
  (1790705554670::bigint, 'f566b36e3e8c3b370bd636852f3af41ce745de9eedfaf9a880ec5f99c2d96719', '20260929181234_upload_source_guesses'),
  (1790711743632::bigint, 'ea88a98e698d8e67863faf26bf6b985f76d71a1f5758e1f94195134e7561a964', '20260929195543_citation_find_lookup'),
  (1790730441960::bigint, '278810720b1ec2524279e37293eb51caa2fc2b23576be5d8489c67b316d3cecc', '20260930010721_citation_investigations'),
  (1790730462862::bigint, 'bc0cbecfe9e39c683ce8766339edcd4520d4309b702d912f30db2ee21635de55', '20260930010742_citation_investigations_owner_fk'),
  (1790763831944::bigint, '7cd27eea4a2c1f36ffbb33ce038fd1eb73787d27591a824df5acc7cf0b6315a3', '20260930102351_ai_calls_article_index'),
  (1790771082035::bigint, '8c5ea9324128796f414c971cb643e0ebd5ac4ef782029ba92a81adc553e473a3', '20260930122442_crossrefs'),
  (1790776404153::bigint, 'bef5ec07475ecbc0454967dbf4b5549762244cac4561e180843441621f399fa6', '20260930135324_article_high_power_since'),
  (1790779383987::bigint, 'd3956513f24f133d2d9c6e044b8f0fe56b796dce459f64dcf6d51cb043f619a7', '20260930144303_reader_arrivals'),
  (1790786220989::bigint, 'a2ef0af36f9e8371f0069c6d0eb231f7e336b924c6450a90e478e8dd2eea3894', '20260930163700_simple_summary'),
  (1790810574653::bigint, 'fdaa12f64e9d0ae962df50d8de309facc1a7c081d9db7a073d216a3c4973a755', '20260930232254_bibliographic_lookup'),
  (1790815217643::bigint, 'e295c6b18a0f1c856a79056362c4d47214f8a32703a38cab74b22ddddf5cd7d3', '20261001004017_ingest_events_kind'),
  (1790818355223::bigint, 'a5e70921716328d9252da9fd856760a556d435e0118a1df4141122845ad15b69', '20261001013235_citation_investigation_paper'),
  (1790819611763::bigint, '38cc6917405c93a6fa5a1f58adae9f73da01b65655d838c0a67cea7a4d47bb2f', '20261001015331_citation_investigation_no_extract_with_paper'),
  (1790865541515::bigint, 'dcd68a9b768a72aa3d7287883618cb1fe994190d0cac3eda4455e32878c1ef18', '20261001143901_remember_one_thread'),
  (1790872485314::bigint, '3f1d04c94fe12657db8d2e5632b0509a1ed3030a40f4e34bd0b4c8a827a1ff4f', '20261001163445_billing_vouchers'),
  (1790878615390::bigint, '460ea58394f751491a6e04767d98b9026ce23d338bb962b5bebdc6e9729e0cad', '20261001181655_dig_deeper_bucket'),
  (1790881990471::bigint, '6f57d45020e897d5848d77cfbe7701d1f85adf19d054d5f0e34a5195d0f42744', '20261001191310_billing_voucher_emails'),
  (1790889145689::bigint, '31892f93240bf0f6ef7f27d17ae2210462ee8caba8c38a2de45ec693eaef0b60', '20261001211225_bulk_import_minimal'),
  (1790894879320::bigint, '91f17a49b7293e8378da0bfba18136143d90eaf6b608c970f3740309ae460e54', '20261001224759_skim'),
  (1790904474151::bigint, '00b1d51e223b150e1fd299c220647222be6d549ae8a8197a55d164f769272bd1', '20261002012754_billing_voucher_recipient_note'),
  (1790935253093::bigint, '7cb04e1b18a2bf0acf3445e826d3a350a51bf89bc955e5b7a74884f03f5cf80c', '20261002100053_job_dismissed_at'),
  (1790948725148::bigint, '7de6cd8c896f05059e20ba5e9241cd10749cb7e1b567395f76168a36d483612b', '20261002134525_glossary_hidden_entries'),
  (1790950083061::bigint, '800f5dacf94a346692ce34d80714b6bcd96772719fe7f9f69d4540032a00221c', '20261002140803_structure_step'),
  (1790955356334::bigint, '2fb60b01c460583efcc87d4c5c9e363b52ad28b020efbe94f5b9ee48e7a4df81', '20261002153556_search_runs_kind'),
  (1790960562607::bigint, '90fcfc6435bf86bc02e8155833f22fae13b15c6a579a6cfed769f3e887f04f64', '20261002170242_glossary_lookups_added_name'),
  (1790961041994::bigint, 'fb40fe31b50c6066af62892135332caeb499f8766fb5e48e7cb154495de6d766', '20261002171041_feedback_shipped_emails'),
  (1790978015520::bigint, '2b76b3e1110f8b8207a1ba726a56d0136680417c2758b8234029ff1a2c297951', '20261002215335_feedback_notice_bucket'),
  (1790983257034::bigint, '50e465f69d3df7e6f78b131d851aae908f13a0b9f0fa6bdca477e0116d6b1abe', '20261002232057_tutorial_thread_kind'),
  (1790983475832::bigint, 'ed89542940d092aa7838b34f8b85da04da7219e5f77f0300b96b019a4f678fe2', '20261002232435_jobs_illustration_note'),
  (1790999967914::bigint, 'f361ac477ac3f8eda5434d574f843e18fc0bfb3f627d4d5daf850384d787bc5f', '20261003035927_article_tags'),
  (1791003650211::bigint, '142047b740e9a6bc4d0a030325b7fab99aa1cdfb5cc81f57a4e6961c6c1d14a1', '20261003050050_comments_colour'),
  (1791023822141::bigint, '640a6fba4074de3d93155cea17f8cccf1c40dde46beeb24f77427eb0d4764c1d', '20261003103702_relations'),
  (1791031844970::bigint, '79c0170c82c59de1c88fa5047642e89b8c4f281108b519ac7193a0612efcff5d', '20261003125044_referee_claims_attempt'),
  (1791036835759::bigint, 'c8488e344132da09160b129d6b1fcb28b3cc47003a6384ef0bdaa1bd307af05c', '20261003141355_feedback_ignored_at'),
  (1791038790468::bigint, 'c53e2de6c4558fbe1c7b30cda9478319221fd8d13d2aa1ece952366880117760', '20261003144630_gpt_live_sessions_and_usage'),
  (1791044346385::bigint, '8f547cbbf561ff9c163397b41daba828da8c0e10b7183caf7e090754f5b5802a', '20261003161906_shelf_topic_sets'),
  (1791044831510::bigint, '22ec152c251b5f5f08d0e0660f60e74e4df98e795ace04b422b7bc05928b09a9', '20261003162711_feedback_screenshot_size_two_megabytes'),
  (1791047027128::bigint, '0570c6bbba71a8f79907992edd4637eab9ca50d0c1397207b62d4196bb9a9d66', '20261003170347_store_when_it_happened'),
  (1791053039383::bigint, '11c3ef907d57444a16ce001dc9ea10cc6cf174a86c666bf7debd747c6c137d6e', '20261003184359_explore_thread_kind'),
  (1791059362776::bigint, '2718ba691b05b46bae8eaadcc617f62a37c8f77f5977c36c7dc52f031a7c816d', '20261003202922_citation_investigation_influence'),
  (1791071462375::bigint, 'eb9a10e4a9c2e49e4bb6721e6b51a187d2a60aa0e1cf6e767021f0d1bf0f117a', '20261003235102_article_journal_and_registry_published_day'),
  (1791073083443::bigint, '573fa5b47832652256ad4b0238d6da755e0367da94022b0fd26b08d68a3bf3d7', '20261004001803_registry_published_day_only_on_found'),
  (1791122141705::bigint, '9fd9d3795a8c9d2ecb8f739692a25e9ead38cbcc0ea257a39d114885ca5b00a9', '20261004135541_reader_auto_modes_off_at'),
  (1791127731956::bigint, '644f089695dcd165da69cfe14ffa58e5a0c9053d927fd0175519011b1b8430c0', '20261004152851_chat_message_hint_opened_at'),
  (1791132435770::bigint, '3ccf8176d460e4f2b63c3732f697e39d81324228dc346cf31a91d15f6b24a9cc', '20261004164715_citation_index_and_openalex_service'),
  (1791132884945::bigint, '47bbf6ab0c9befbdbdedb84a1fb4d094d1a40db5216f1c8acf09fa43f97a37b9', '20261004165444_article_published_year'),
  (1791170995636::bigint, '468f2a4d87523558cf21713abc4fa6e030df7437e24b2bdf3e7ee1d9428f6a81', '20261005032955_quiz_attempts'),
  (1791197477254::bigint, 'be6f602454cb67498869c77fee480c088772e77346669339848a181c721c6f07', '20261005105117_article_title_original'),
  (1791213565901::bigint, '789d36b2757c6cbb9ea2766f938b95e0ff65aef78bbf7b6aeccd08be2ce2d3d4', '20261005151925_bibliographic_records_cited_by_count'),
  (1791223810797::bigint, '83ca1bea5332e4e3debcbaa3db644b01dd53e186ff680fbca0d0c3466900e8fe', '20261005181010_chat_thread_origin'),
  (1791225647582::bigint, '6fd962cd4ffca726f1373e4dca35661a9081cf327c49e14b1836f4b6147bc461', '20261005184047_article_share_link'),
  (1791230788281::bigint, '192289d32c71e18da58dc0de9c8cb09b7f3f293169816b3231afb73400f7f481', '20261005200628_reading_difficulty'),
  (1791232554680::bigint, '1e81bd1468e11273a32da61bbf79cf055a96c9bb0b1bb311ccbf03aacbae9b5d', '20261005203554_chat_thread_origin_lens'),
  (1791250876486::bigint, '806bbb4a91a52a7029f266893b8c3cb92225dae7e3e3960b50a2fba756d5d80f', '20261006014116_ai_calls_attempt_and_failure'),
  (1791258835782::bigint, '4ea28a248e4a107d41c3d7d031edebcb96a80f2fb770c825dba553689be49f16', '20261006035355_rename_remember_thread_kind_to_learn'),
  (1791260412860::bigint, '43e4114858a6b8d2cf15ba721754893c8df74878b71e0aa4be17d5e81434e864', '20261006042012_chat_thread_origin_item'),
  (1791297828720::bigint, '4ff8852dbf2232662606eb946cbcbae512bf773475608230edaa30941ae0318e', '20261006144348_articles_asked_url')
), actual AS (
 SELECT created_at, hash FROM spideryarn_migrations.__drizzle_migrations
)
SELECT e.tag AS migration, e.stamp, 'missing, duplicate, or different hash' AS problem
FROM expected e
WHERE (SELECT count(*) FROM actual a WHERE a.created_at = e.stamp AND a.hash = e.hash) <> 1
UNION ALL
SELECT NULL, a.created_at, 'unexpected ledger row or different hash'
FROM actual a
WHERE NOT EXISTS (SELECT 1 FROM expected e WHERE e.stamp = a.created_at AND e.hash = a.hash);

-- Must list all nine tags below, crosses_watermark=true for each; none applied.
WITH pending(stamp, tag) AS (VALUES
  (1791334488929::bigint, '20261007005448_revision_blocks_article_block_index'),
  (1791334950895::bigint, '20261007010230_referee_criteria_shape_all_or_none'),
  (1791335394856::bigint, '20261007010954_referee_claims_empty_unless_done'),
  (1791335787375::bigint, '20261007011627_upload_source_guesses_created_at'),
  (1791336047829::bigint, '20261007012047_drop_duplicate_chat_messages_index'),
  (1791336414855::bigint, '20261007012654_declare_migration_only_indexes_and_checks'),
  (1791337115199::bigint, '20261007013835_ledger_indexes_declared_as_made'),
  (1791351184402::bigint, '20261007053304_billing_voucher_recipient_name'),
  (1791358504947::bigint, '20261007073504_drop_queue_state_running_job_id')
)
SELECT tag, stamp,
       stamp > (SELECT max(created_at) FROM spideryarn_migrations.__drizzle_migrations) AS crosses_watermark,
       (SELECT count(*) FROM spideryarn_migrations.__drizzle_migrations m WHERE m.created_at=p.stamp) AS ledger_rows
FROM pending p ORDER BY stamp;

-- VIOLATIONS: new objects must be absent before this first application.
SELECT 'revision_blocks_article_block already exists' AS problem
WHERE to_regclass('spideryarn.revision_blocks_article_block') IS NOT NULL
UNION ALL
SELECT 'upload_source_guesses.created_at already exists'
WHERE EXISTS (SELECT 1 FROM pg_attribute
 WHERE attrelid='spideryarn.upload_source_guesses'::regclass
   AND attname='created_at' AND NOT attisdropped)
UNION ALL
SELECT 'referee_claims_empty_unless_done already exists'
WHERE EXISTS (SELECT 1 FROM pg_constraint
 WHERE conrelid='spideryarn.referee_claims'::regclass AND conname='referee_claims_empty_unless_done')
UNION ALL
SELECT 'billing_vouchers.recipient_name already exists'
WHERE EXISTS (SELECT 1 FROM pg_attribute
 WHERE attrelid='spideryarn.billing_vouchers'::regclass
   AND attname='recipient_name' AND NOT attisdropped)
UNION ALL
SELECT 'billing_vouchers_recipient_name_length already exists'
WHERE EXISTS (SELECT 1 FROM pg_constraint
 WHERE conrelid='spideryarn.billing_vouchers'::regclass AND conname='billing_vouchers_recipient_name_length');

-- VIOLATIONS: the column the ninth migration drops, and its foreign key, must be
-- there exactly as 0000 made them, and the column must hold nothing. A missing
-- one means the drop would fail; a value means it would throw away a fact.
SELECT 'queue_state.running_job_id is missing' AS problem
WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
 WHERE attrelid='spideryarn.queue_state'::regclass
   AND attname='running_job_id' AND NOT attisdropped)
UNION ALL
SELECT 'queue_state_running_job_id_jobs_id_fk is missing or different'
WHERE (SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid='spideryarn.queue_state'::regclass
   AND conname='queue_state_running_job_id_jobs_id_fk')
  IS DISTINCT FROM 'FOREIGN KEY (running_job_id) REFERENCES spideryarn.jobs(id) ON DELETE SET NULL'
UNION ALL
SELECT 'queue_state.running_job_id holds a value'
WHERE EXISTS (SELECT 1 FROM spideryarn.queue_state WHERE running_job_id IS NOT NULL);
-- Must report exactly one row: the singleton the claim locks, which stays.
SELECT count(*) AS queue_state_rows FROM spideryarn.queue_state;

-- Both invalid counts, and non_array_claims, must be zero. CASE prevents a
-- non-array from raising jsonb_array_length before its count can be reported.
SELECT count(*) AS rows,
       count(*) FILTER (WHERE num_nonnulls(pole_against,pole_favour,scale)
         <> CASE WHEN kind='diverging' THEN 3 ELSE 0 END) AS invalid_shapes
FROM spideryarn.referee_criteria;
SELECT count(*) AS rows,
       count(*) FILTER (WHERE jsonb_typeof(claims) IS DISTINCT FROM 'array') AS non_array_claims,
       count(*) FILTER (WHERE status <> 'done' AND
         CASE WHEN jsonb_typeof(claims)='array' THEN jsonb_array_length(claims) <> 0 ELSE true END
       ) AS invalid_pending_or_error_claims
FROM spideryarn.referee_claims;
SELECT count(*) AS existing_rows_to_keep_null FROM spideryarn.upload_source_guesses;
SELECT count(*) AS block_rows,
       pg_size_pretty(pg_relation_size('spideryarn.revision_blocks')) AS heap_size
FROM spideryarn.revision_blocks;

-- VIOLATIONS: all nine required old indexes must exist with their exact recorded
-- definitions and be ready/live/valid. Comment-only migrations cannot repair them.
WITH expected(name, definition) AS (VALUES
  ('jobs_queued_idx', 'CREATE INDEX jobs_queued_idx ON spideryarn.jobs USING btree (created_at) WHERE (status = ''queued''::text)'),
  ('jobs_lease_idx', 'CREATE INDEX jobs_lease_idx ON spideryarn.jobs USING btree (lease_expires_at) WHERE (status = ''running''::text)'),
  ('jobs_owner_created_idx', 'CREATE INDEX jobs_owner_created_idx ON spideryarn.jobs USING btree (owner_id, created_at DESC)'),
  ('chat_threads_article_updated_idx', 'CREATE INDEX chat_threads_article_updated_idx ON spideryarn.chat_threads USING btree (article_id, updated_at DESC)'),
  ('search_runs_article_created_idx', 'CREATE INDEX search_runs_article_created_idx ON spideryarn.search_runs USING btree (article_id, created_at DESC)'),
  ('ai_calls_owner_started', 'CREATE INDEX ai_calls_owner_started ON spideryarn.ai_calls USING btree (owner_id, started_at DESC)'),
  ('ai_calls_scope_started', 'CREATE INDEX ai_calls_scope_started ON spideryarn.ai_calls USING btree (scope_kind, started_at DESC)'),
  ('chat_messages_thread_ordinal', 'CREATE UNIQUE INDEX chat_messages_thread_ordinal ON spideryarn.chat_messages USING btree (article_id, thread_id, ordinal)'),
  ('chat_messages_thread_ordinal_idx', 'CREATE INDEX chat_messages_thread_ordinal_idx ON spideryarn.chat_messages USING btree (article_id, thread_id, ordinal)')
)
SELECT e.name, e.definition AS expected, p.indexdef AS actual,
       i.indisvalid, i.indisready, i.indislive
FROM expected e
LEFT JOIN pg_indexes p ON p.schemaname='spideryarn' AND p.indexname=e.name
LEFT JOIN pg_index i ON i.indexrelid=to_regclass('spideryarn.' || e.name)
WHERE p.indexdef IS DISTINCT FROM e.definition
   OR i.indisvalid IS DISTINCT FROM true OR i.indisready IS DISTINCT FROM true
   OR i.indislive IS DISTINCT FROM true;

-- VIOLATIONS: complete recorded CHECK text, not a name-only test; also confirm
-- the validated UNIQUE constraint that supports removal of the duplicate index.
WITH expected(on_table, name, definition) AS (VALUES
  ('ai_calls', 'ai_calls_byok_upstream_only', 'CHECK (((byok_upstream_nanos IS NULL) OR ((cost_source = ''provider''::text) AND (is_byok IS TRUE) AND (provider_account = ''openrouter''::text))))'),
  ('ai_calls', 'ai_calls_cost_source_known', 'CHECK ((cost_source = ANY (ARRAY[''provider''::text, ''computed''::text, ''none''::text])))'),
  ('ai_calls', 'ai_calls_one_cost_source', 'CHECK ((((cost_source = ''provider''::text) AND (credits_used_nanos IS NOT NULL) AND (computed_cost_nanos IS NULL)) OR ((cost_source = ''computed''::text) AND (credits_used_nanos IS NULL) AND (computed_cost_nanos IS NOT NULL)) OR ((cost_source = ''none''::text) AND (credits_used_nanos IS NULL) AND (computed_cost_nanos IS NULL))))'),
  ('ai_calls', 'ai_calls_price_version_iff_computed', 'CHECK ((((cost_source = ''computed''::text) AND (price_version IS NOT NULL)) OR ((cost_source <> ''computed''::text) AND (price_version IS NULL))))'),
  ('ai_calls', 'ai_calls_provider_account_known', 'CHECK ((provider_account = ANY (ARRAY[''openrouter''::text, ''anthropic''::text, ''openai''::text])))'),
  ('referee_criteria', 'referee_criteria_diverging_shape', 'CHECK (((kind = ''diverging''::text) = ((pole_against IS NOT NULL) AND (pole_favour IS NOT NULL) AND (scale IS NOT NULL))))'),
  ('chat_messages', 'chat_messages_thread_ordinal', 'UNIQUE (article_id, thread_id, ordinal)')
)
SELECT e.on_table, e.name, e.definition AS expected,
       pg_get_constraintdef(k.oid) AS actual, k.convalidated
FROM expected e
LEFT JOIN pg_constraint k ON k.conrelid=to_regclass('spideryarn.' || e.on_table) AND k.conname=e.name
WHERE pg_get_constraintdef(k.oid) IS DISTINCT FROM e.definition
   OR k.convalidated IS DISTINCT FROM true;

-- Must return one row with interchangeable_keys=true and unique_constraint_valid=true.
-- Include collations, INCLUDE columns and operator classes, not just column names.
SELECT (a.indrelid=b.indrelid AND ca.relam=cb.relam
    AND a.indkey::text=b.indkey::text AND a.indnkeyatts=b.indnkeyatts
    AND a.indclass::text=b.indclass::text AND a.indcollation::text=b.indcollation::text
    AND a.indoption::text=b.indoption::text
    AND a.indexprs IS NULL AND b.indexprs IS NULL
    AND a.indpred IS NULL AND b.indpred IS NULL
    AND a.indisunique AND NOT b.indisunique
    AND a.indisvalid AND b.indisvalid AND a.indisready AND b.indisready
   ) AS interchangeable_keys,
   k.convalidated AS unique_constraint_valid
FROM pg_index a
JOIN pg_class ca ON ca.oid=a.indexrelid
JOIN pg_index b ON b.indexrelid='spideryarn.chat_messages_thread_ordinal_idx'::regclass
JOIN pg_class cb ON cb.oid=b.indexrelid
JOIN pg_constraint k ON k.conindid=a.indexrelid AND k.contype='u'
WHERE a.indexrelid='spideryarn.chat_messages_thread_ordinal'::regclass
  AND k.conrelid='spideryarn.chat_messages'::regclass;

-- Inspect: migration role must own/be able to act as owner of these tables.
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
       pg_has_role(current_user,c.relowner,'USAGE') AS can_act_as_owner
FROM pg_class c
WHERE c.oid IN ('spideryarn.revision_blocks'::regclass,'spideryarn.referee_criteria'::regclass,
 'spideryarn.referee_claims'::regclass,'spideryarn.upload_source_guesses'::regclass,
 'spideryarn.chat_messages'::regclass,'spideryarn.queue_state'::regclass,'spideryarn.jobs'::regclass,
 'spideryarn.billing_vouchers'::regclass)
ORDER BY c.relname;

-- Inspect immediately before applying: SHARE conflicts with writers to blocks;
-- later ACCESS EXCLUSIVE locks conflict with readers too — including queue_state,
-- which every job claim locks FOR UPDATE NOWAIT. NOWAIT applies only to row locks;
-- claims wait for the table lock until commit/rollback and can occupy runtime pool
-- connections. Dropping the foreign key also locks jobs. This is a point-in-time
-- sample, not a guarantee: use finite lock_timeout and statement_timeout on the
-- migration connection. The voucher migration's ADD CHECK takes ACCESS EXCLUSIVE on
-- billing_vouchers and scans it, so that table is inspected here too.
-- pg_stat_activity text is intentionally not selected (reader data may appear in it).
SELECT l.relation::regclass AS relation, l.mode, l.granted, l.pid,
       a.state, clock_timestamp()-a.xact_start AS transaction_age,
       a.wait_event_type, a.wait_event
FROM pg_locks l LEFT JOIN pg_stat_activity a ON a.pid=l.pid
WHERE l.pid IS DISTINCT FROM pg_backend_pid()
  AND l.relation IN ('spideryarn.revision_blocks'::regclass,'spideryarn.referee_criteria'::regclass,
    'spideryarn.referee_claims'::regclass,'spideryarn.upload_source_guesses'::regclass,
    'spideryarn.chat_messages'::regclass,'spideryarn.chat_messages_thread_ordinal_idx'::regclass,
    'spideryarn.queue_state'::regclass,'spideryarn.jobs'::regclass,
    'spideryarn.billing_vouchers'::regclass)
ORDER BY a.xact_start NULLS FIRST, relation, l.mode;
SELECT pid, state, clock_timestamp()-xact_start AS transaction_age, wait_event_type, wait_event
FROM pg_stat_activity
WHERE datname=current_database() AND pid<>pg_backend_pid()
  AND xact_start < clock_timestamp()-interval '5 seconds'
ORDER BY xact_start;
SELECT transaction, prepared, owner, database FROM pg_prepared_xacts
WHERE database=current_database();

ROLLBACK;
