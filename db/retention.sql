-- Install after schema.sql. This file defines the daily job without running it.
create or replace function public.shattana_prune_retention()
returns void language sql set search_path = pg_catalog, public as $$
  delete from public.report where created_at<=now()-interval '90 days';
  delete from public.message m using public.chat c, public.guest g
    where m.chat_id=c.id and m.sender=g.id
    and (g.deleted_at is not null or (c.closed and coalesce(c.ended_at,c.created_at)<=now()-interval '30 days'))
    and not public.shattana_pending_chat_evidence(c.id,m.created_at,coalesce(c.ended_at,c.created_at));
  delete from public.meetup_invite i using public.chat c
    where i.chat_id=c.id
    and ((c.closed and coalesce(c.ended_at,c.created_at)<=now()-interval '30 days')
      or exists (select 1 from public.guest g where g.id in (c.a,c.b) and g.deleted_at is not null))
    and not public.shattana_pending_chat_evidence(c.id,i.updated_at,coalesce(c.ended_at,c.created_at));
  delete from public.guest_photo_view where expires_at<=now();
  delete from public.guest_rate_limit where expires_at<=now();
$$;
revoke execute on function public.shattana_prune_retention() from public;
