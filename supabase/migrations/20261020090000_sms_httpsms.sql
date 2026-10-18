-- SMS to parents through httpSMS (an Android phone used as the SMS gateway)
--
-- 1. sms_config: the httpSMS API key and the sending phone's number. No API
--    access at all (like push_config); only the send-sms Edge Function, which
--    runs with the service role, reads it. The key is never sent back to a
--    browser, not even to the admin.
-- 2. admin_set_sms_config: the admin saves the sending number and, when given,
--    a new API key (leave the key empty to keep the saved one).
-- 3. admin_sms_status: what the Settings screen shows: whether SMS is set up,
--    the sending number and the last 4 characters of the key.
--
-- Safe to run more than once. Nothing is dropped or deleted.

create table if not exists public.sms_config (
  id          int primary key default 1 check (id = 1),
  api_key     text not null,
  from_number text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.sms_config enable row level security;
revoke all on public.sms_config from anon, authenticated;

create or replace function public.admin_set_sms_config(p_api_key text, p_from_number text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_key  text := nullif(btrim(coalesce(p_api_key, '')), '');
  v_from text := regexp_replace(coalesce(p_from_number, ''), '[^0-9+]', '', 'g');
begin
  if not private.is_admin() then
    raise exception 'Only the administrator can set up SMS' using errcode = '42501';
  end if;
  if v_from !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the sending phone number in international format, e.g. +233241234567'
      using errcode = '22023';
  end if;
  if v_key is null and not exists (select 1 from public.sms_config where id = 1) then
    raise exception 'Enter the httpSMS API key' using errcode = '22023';
  end if;

  insert into public.sms_config (id, api_key, from_number, updated_at, updated_by)
  values (1, v_key, v_from, now(), auth.uid())
  on conflict (id) do update
    set api_key     = coalesce(v_key, public.sms_config.api_key),
        from_number = excluded.from_number,
        updated_at  = now(),
        updated_by  = auth.uid();
end;
$$;

create or replace function public.admin_sms_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.sms_config;
begin
  if not private.is_admin() then
    raise exception 'Only the administrator can view the SMS setup' using errcode = '42501';
  end if;
  select * into c from public.sms_config where id = 1;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  return jsonb_build_object(
    'configured',  true,
    'from_number', c.from_number,
    'key_hint',    right(c.api_key, 4),
    'updated_at',  c.updated_at
  );
end;
$$;

revoke all on function public.admin_set_sms_config(text, text) from public, anon;
revoke all on function public.admin_sms_status() from public, anon;
grant execute on function public.admin_set_sms_config(text, text) to authenticated;
grant execute on function public.admin_sms_status() to authenticated;
