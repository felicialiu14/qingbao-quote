-- Application maintenance: remove expired records hourly, independently of visits.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('qingbao-analytics-retention','17 * * * *',$job$
  delete from public.quote_analytics_events where created_at < now() - interval '30 days';
  delete from public.quote_analytics_limits where bucket_start < now() - interval '2 days';
$job$);
