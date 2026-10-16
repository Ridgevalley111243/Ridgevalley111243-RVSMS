-- =============================================================================
-- Web push: alert people about new notifications even when the site is closed.
--
--  * push_subscriptions: one row per device that allowed notifications. Users
--    can see their own rows; writes go through the two RPCs below.
--  * push_config: the VAPID key pair. No API access at all; only the send-push
--    Edge Function (service role) reads it. The key values are inserted
--    separately and are not stored in this repository.
--  * notifications.push_sent_at + an insert trigger that asks the send-push
--    Edge Function to deliver each new notification exactly once. The request
--    carries only the notification id; the function re-reads the row and
--    claims it, so it needs no credentials from the database.
-- =============================================================================

create extension if not exists pg_net;

alter table public.notifications add column if not exists push_sent_at timestamptz;

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;
revoke insert, update, delete on public.push_subscriptions from authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'push_subscriptions' and policyname = 'push_subscriptions: own read') then
    create policy "push_subscriptions: own read" on public.push_subscriptions
      for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;

create table if not exists public.push_config (
  id            int primary key default 1 check (id = 1),
  vapid_public  text not null,
  vapid_private text not null,
  subject       text not null
);
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;

-- Save this device for the signed-in user (a shared device moves to whoever
-- signed in last, so the previous user stops getting alerts on it).
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Invalid push subscription';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

-- Ask send-push to deliver every new notification. Never blocks saving it.
create or replace function private.push_on_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform net.http_post(
    url     := 'https://dcdqmxsdazwattnrbjyb.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('id', new.id)
  );
  return new;
exception when others then
  return new;
end;
$$;

create or replace trigger push_on_notification
  after insert on public.notifications
  for each row execute function private.push_on_notification();
