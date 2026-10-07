ALTER TABLE "spideryarn"."article_tags" DROP CONSTRAINT "article_tags_spelling";--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" DROP CONSTRAINT "bibliographic_records_id";--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" DROP CONSTRAINT "bibliographic_records_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_voucher_emails" DROP CONSTRAINT "billing_voucher_emails_detail_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" DROP CONSTRAINT "billing_vouchers_note_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" DROP CONSTRAINT "billing_vouchers_recipient_note_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" DROP CONSTRAINT "billing_vouchers_recipient_name_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_finds" DROP CONSTRAINT "citation_finds_lookup_lengths";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_citers" DROP CONSTRAINT "citation_index_citers_title";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" DROP CONSTRAINT "citation_index_lookups_work_id";--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" DROP CONSTRAINT "citation_index_lookups_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_url_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_body_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" DROP CONSTRAINT "feedback_screenshot_size";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_question_answers" DROP CONSTRAINT "feedback_question_answers_body_shape";--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_shipped_emails" DROP CONSTRAINT "feedback_shipped_emails_detail_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" DROP CONSTRAINT "glossary_lookups_added_name_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."quiz_attempts" DROP CONSTRAINT "quiz_attempts_answer_length";--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" DROP CONSTRAINT "realtime_sessions_close_reason_len";--> statement-breakpoint
ALTER TABLE "spideryarn"."article_tags" ADD CONSTRAINT "article_tags_spelling" CHECK (char_length("spideryarn"."article_tags"."tag") between 1 and 600 and "spideryarn"."article_tags"."tag" = btrim("spideryarn"."article_tags"."tag") and "spideryarn"."article_tags"."tag" = lower("spideryarn"."article_tags"."tag") and "spideryarn"."article_tags"."tag" !~ '[,[:cntrl:]]' and "spideryarn"."article_tags"."tag" !~ '\s\s');--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" ADD CONSTRAINT "bibliographic_records_id" CHECK (length("spideryarn"."bibliographic_records"."id") <= 600 and "spideryarn"."bibliographic_records"."id" = lower("spideryarn"."bibliographic_records"."id") and (
            "spideryarn"."bibliographic_records"."id" ~ '^doi:10[.][0-9]{4,9}/[^[:space:]"''<>?#]+$'
            or "spideryarn"."bibliographic_records"."id" ~ '^arxiv:([0-9]{4}[.][0-9]{4,5}|[a-z-]+([.][a-z]{2})?/[0-9]{7})$'
          ));--> statement-breakpoint
ALTER TABLE "spideryarn"."bibliographic_records" ADD CONSTRAINT "bibliographic_records_shape" CHECK (case
            when "spideryarn"."bibliographic_records"."state" = 'found' then "spideryarn"."bibliographic_records"."source" is not null and "spideryarn"."bibliographic_records"."title" is not null
              and length("spideryarn"."bibliographic_records"."title") between 1 and 10000
              and "spideryarn"."bibliographic_records"."authors_family" is not null and "spideryarn"."bibliographic_records"."doi" is not null and "spideryarn"."bibliographic_records"."fetched_at" is not null
            when "spideryarn"."bibliographic_records"."state" = 'not-found' then "spideryarn"."bibliographic_records"."fetched_at" is not null
              and num_nonnulls("spideryarn"."bibliographic_records"."source", "spideryarn"."bibliographic_records"."title", "spideryarn"."bibliographic_records"."authors_family", "spideryarn"."bibliographic_records"."authors_given", "spideryarn"."bibliographic_records"."year", "spideryarn"."bibliographic_records"."venue", "spideryarn"."bibliographic_records"."doi") = 0
            else "spideryarn"."bibliographic_records"."claimed_until" is not null and "spideryarn"."bibliographic_records"."fetched_at" is null
              and num_nonnulls("spideryarn"."bibliographic_records"."source", "spideryarn"."bibliographic_records"."title", "spideryarn"."bibliographic_records"."authors_family", "spideryarn"."bibliographic_records"."authors_given", "spideryarn"."bibliographic_records"."year", "spideryarn"."bibliographic_records"."venue", "spideryarn"."bibliographic_records"."doi") = 0
          end);--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_voucher_emails" ADD CONSTRAINT "billing_voucher_emails_detail_length" CHECK ("spideryarn"."billing_voucher_emails"."detail" is null or char_length("spideryarn"."billing_voucher_emails"."detail") <= 10000);--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" ADD CONSTRAINT "billing_vouchers_note_length" CHECK ("spideryarn"."billing_vouchers"."note" is null or char_length("spideryarn"."billing_vouchers"."note") <= 1000000);--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" ADD CONSTRAINT "billing_vouchers_recipient_note_length" CHECK ("spideryarn"."billing_vouchers"."recipient_note" is null or char_length("spideryarn"."billing_vouchers"."recipient_note") <= 1000000);--> statement-breakpoint
ALTER TABLE "spideryarn"."billing_vouchers" ADD CONSTRAINT "billing_vouchers_recipient_name_length" CHECK ("spideryarn"."billing_vouchers"."recipient_name" is null or char_length("spideryarn"."billing_vouchers"."recipient_name") <= 10000);--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_finds" ADD CONSTRAINT "citation_finds_lookup_lengths" CHECK (coalesce(char_length("spideryarn"."citation_finds"."lookup_paper_does"), 0) <= 1000000 and coalesce(char_length("spideryarn"."citation_finds"."lookup_support_quote"), 0) <= 1000000 and coalesce(char_length("spideryarn"."citation_finds"."lookup_paper_does_quote"), 0) <= 1000000 and coalesce("spideryarn"."citation_finds"."lookup_excerpt_words", 0) >= 0);--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_citers" ADD CONSTRAINT "citation_index_citers_title" CHECK (length("spideryarn"."citation_index_citers"."title") between 1 and 10000);--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" ADD CONSTRAINT "citation_index_lookups_work_id" CHECK (length("spideryarn"."citation_index_lookups"."work_id") <= 600 and "spideryarn"."citation_index_lookups"."work_id" = lower("spideryarn"."citation_index_lookups"."work_id")
          and "spideryarn"."citation_index_lookups"."work_id" ~ '^doi:10[.][0-9]{4,9}/[^[:space:]"''<>?#]+$');--> statement-breakpoint
ALTER TABLE "spideryarn"."citation_index_lookups" ADD CONSTRAINT "citation_index_lookups_shape" CHECK (case
            when "spideryarn"."citation_index_lookups"."state" = 'found' then
              "spideryarn"."citation_index_lookups"."openalex_id" is not null and "spideryarn"."citation_index_lookups"."openalex_id" ~ '^W[0-9]{1,15}$'
              and "spideryarn"."citation_index_lookups"."cited_by_count" is not null and "spideryarn"."citation_index_lookups"."cited_by_count" >= 0
              and "spideryarn"."citation_index_lookups"."returned" is not null and "spideryarn"."citation_index_lookups"."returned" >= 0
              and "spideryarn"."citation_index_lookups"."dropped" is not null and "spideryarn"."citation_index_lookups"."dropped" between 0 and "spideryarn"."citation_index_lookups"."returned"
              and "spideryarn"."citation_index_lookups"."capped" is not null
              and "spideryarn"."citation_index_lookups"."target_title" is not null and length("spideryarn"."citation_index_lookups"."target_title") between 1 and 10000
              and "spideryarn"."citation_index_lookups"."target_authors" is not null and cardinality("spideryarn"."citation_index_lookups"."target_authors") <= 20
              and array_position("spideryarn"."citation_index_lookups"."target_authors", null) is null
            else num_nonnulls("spideryarn"."citation_index_lookups"."openalex_id", "spideryarn"."citation_index_lookups"."cited_by_count", "spideryarn"."citation_index_lookups"."returned", "spideryarn"."citation_index_lookups"."dropped",
                              "spideryarn"."citation_index_lookups"."capped", "spideryarn"."citation_index_lookups"."target_title", "spideryarn"."citation_index_lookups"."target_authors") = 0
          end);--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_url_shape" CHECK ("spideryarn"."feedback"."url" is null or (length(btrim("spideryarn"."feedback"."url")) > 0 and length("spideryarn"."feedback"."url") <= 10000));--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_body_shape" CHECK (length(btrim("spideryarn"."feedback"."body")) > 0 and length("spideryarn"."feedback"."body") <= 1000000);--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback" ADD CONSTRAINT "feedback_screenshot_size" CHECK ("spideryarn"."feedback"."screenshot" is null or octet_length("spideryarn"."feedback"."screenshot") <= 52428800);--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_question_answers" ADD CONSTRAINT "feedback_question_answers_body_shape" CHECK (length(btrim("spideryarn"."feedback_question_answers"."body")) > 0 and length("spideryarn"."feedback_question_answers"."body") <= 1000000);--> statement-breakpoint
ALTER TABLE "spideryarn"."feedback_shipped_emails" ADD CONSTRAINT "feedback_shipped_emails_detail_length" CHECK ("spideryarn"."feedback_shipped_emails"."detail" is null or char_length("spideryarn"."feedback_shipped_emails"."detail") <= 10000);--> statement-breakpoint
ALTER TABLE "spideryarn"."glossary_lookups" ADD CONSTRAINT "glossary_lookups_added_name_length" CHECK ("spideryarn"."glossary_lookups"."added_name" is null or char_length("spideryarn"."glossary_lookups"."added_name") between 1 and 10000);--> statement-breakpoint
ALTER TABLE "spideryarn"."quiz_attempts" ADD CONSTRAINT "quiz_attempts_answer_length" CHECK (char_length("spideryarn"."quiz_attempts"."answer") between 1 and 1000000);--> statement-breakpoint
ALTER TABLE "spideryarn"."realtime_sessions" ADD CONSTRAINT "realtime_sessions_close_reason_len" CHECK (length("spideryarn"."realtime_sessions"."close_reason") <= 10000);