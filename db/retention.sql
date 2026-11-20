-- Run daily after schema.sql. Keep report-linked evidence while a report is pending,
-- up to 90 days. Closed chat records stay as rematch and moderation tombstones.
begin;
delete from report where created_at <= now()-interval '90 days';
delete from message m using chat c
where m.chat_id=c.id and c.closed and coalesce(c.ended_at,c.created_at)<=now()-interval '30 days'
  and (coalesce(c.ended_at,c.created_at)<=now()-interval '90 days'
    or not exists (select 1 from report r where r.chat_id=c.id and r.review_status='pending'));
delete from message m using guest g
where m.sender=g.id and g.deleted_at is not null and not exists
  (select 1 from report r where r.chat_id=m.chat_id and r.review_status='pending');
delete from meetup_invite i using chat c
where i.chat_id=c.id and c.closed and coalesce(c.ended_at,c.created_at)<=now()-interval '30 days';
delete from guest_rate_limit where expires_at<=now();
commit;
