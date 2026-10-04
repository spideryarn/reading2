-- name: namespaces
select namespace, count(*) as n, count(distinct article_id) as articles,
       sum(pg_column_size(value)) as bytes
from spideryarn.checkpoints group by 1 order by 1
-- name: chunks
select c.article_id, c.namespace, c.key, c.value, c.created_at
from spideryarn.checkpoints c
where c.namespace like 'pdf%'
order by c.article_id, c.key
