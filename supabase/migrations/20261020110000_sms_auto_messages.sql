-- Automatic SMS (Settings → SMS to parents → Choose messages)
--
-- When something happens in the portal, the database itself decides whether
-- to text and to whom, from the real records, and puts the message in an
-- outbox. The sms-dispatch Edge Function then sends it through httpSMS.
-- Browsers never choose the recipients or the wording, so nobody can use the
-- school's SIM to text arbitrary people.
--
--   Event               Sent to                                   Default
--   announcement        the chosen group (not the sender)         on
--   payment_submitted   receipt to the parent who paid, and an    on
--                       alert to the accounts office
--   payment_reviewed    the student's parents (approved/rejected, on
--                       or cash recorded by the office)
--   class_reports_done  the admin(s), when a teacher completes    on
--                       every report in the class
--   report_published    the student's parents (admin upload)      on
--   child_link          the parent (link approved/declined)       on
--   absent              the student's parents (today only)        off
--   new_bill            the student's parents                     off
--
-- "Parents" = linked parent accounts plus the parent phone on the student's
-- record. Nothing is sent unless Settings → SMS is switched on, set up, and
-- the message type is on. Each event is texted at most once. Anything that
-- goes wrong with SMS never blocks the action itself.
--
-- Also fixes admin_set_sms_config: leaving the key empty keeps the saved key
-- (same change as 20261020100000_sms_keep_saved_key.sql).
--
-- Safe to run more than once. Nothing is dropped or deleted.

-- ── 1. Which messages are sent ──────────────────────────────────────────────
alter table public.sms_config add column if not exists events jsonb not null default '{}'::jsonb;

-- ── 2. Outbox (server only, like sms_config) ────────────────────────────────
create table if not exists public.sms_outbox (
  id          uuid primary key default gen_random_uuid(),
  event       text not null,
  ref         text not null,
  body        text not null,
  recipients  text[] not null,
  actor       uuid,
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  finished_at timestamptz,
  sent        int,
  failed      int,
  errors      jsonb,
  unique (event, ref)
);
alter table public.sms_outbox enable row level security;
revoke all on public.sms_outbox from anon, authenticated;
create index if not exists sms_outbox_created_idx on public.sms_outbox (created_at desc);
create index if not exists sms_outbox_actor_idx on public.sms_outbox (actor, event, created_at desc);

-- ── 3. Helpers ───────────────────────────────────────────────────────────────
create or replace function private.sms_event_on(p_event text)
returns boolean language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_events jsonb;
  v_flags  jsonb;
begin
  select events into v_events from public.sms_config where id = 1;
  if not found then return false; end if;
  begin
    select value::jsonb into v_flags from public.app_settings where key = 'features_academic';
  exception when others then
    return false;
  end;
  if coalesce((v_flags ->> 'sms')::boolean, false) is not true then return false; end if;
  return coalesce((v_events ->> p_event)::boolean, p_event not in ('absent', 'new_bill'));
end;
$fn$;

-- Phones saved for one person (profile, or their parent record)
create or replace function private.sms_user_phones(p_user uuid)
returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(distinct ph), '{}') from (
    select nullif(btrim(phone), '') as ph from public.profiles where id = p_user
    union
    select nullif(btrim(phone), '') from public.parents where profile_id = p_user
  ) x where ph is not null;
$fn$;

-- Parents of one student: linked parent accounts + the phone on the student record
create or replace function private.sms_parent_phones(p_student_id text)
returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(distinct ph), '{}') from (
    select coalesce(nullif(btrim(p.phone), ''), nullif(btrim(pr.phone), '')) as ph
      from public.parents p
      left join public.profiles pr on pr.id = p.profile_id
     where p_student_id = any (p.children_ids::text[])
    union
    select nullif(btrim(s.parent_phone), '') from public.students s where s.id = p_student_id
  ) x where ph is not null;
$fn$;

-- Approved staff of one role
create or replace function private.sms_role_phones(p_role text)
returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(distinct nullif(btrim(phone), '')) filter (where nullif(btrim(phone), '') is not null), '{}')
    from public.profiles
   where role = p_role and (coalesce(approved, false) or (role = 'admin' and coalesce(is_super_admin, false)));
$fn$;

-- Every parent: parent accounts + parent phones of current (not graduated) students
create or replace function private.sms_all_parent_phones()
returns text[] language sql stable security definer set search_path = '' as $fn$
  select coalesce(array_agg(distinct ph), '{}') from (
    select coalesce(nullif(btrim(p.phone), ''), nullif(btrim(pr.phone), '')) as ph
      from public.parents p
      left join public.profiles pr on pr.id = p.profile_id
    union
    select nullif(btrim(parent_phone), '') from public.students where coalesce(status, 'active') = 'active'
  ) x where ph is not null;
$fn$;

create or replace function private.sms_student_name(p_student_id text, p_fallback text default null)
returns text language sql stable security definer set search_path = '' as $fn$
  select coalesce((select nullif(btrim(name), '') from public.students where id = p_student_id),
                  nullif(btrim(p_fallback), ''), 'your child');
$fn$;

create or replace function private.sms_money(p_amount numeric)
returns text language sql stable set search_path = '' as $fn$
  select 'GHS ' || to_char(coalesce(p_amount, 0), 'FM999,999,990.00');
$fn$;

-- Puts one message in the outbox and asks sms-dispatch to send it.
-- p_hourly_cap limits how many of this event one person can cause per hour.
create or replace function private.sms_enqueue(p_event text, p_ref text, p_body text, p_recipients text[], p_hourly_cap int default null)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_id   uuid;
  v_to   text[];
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
begin
  if not private.sms_event_on(p_event) then return; end if;
  select array_agg(distinct btrim(r)) into v_to from unnest(p_recipients) r where nullif(btrim(r), '') is not null;
  if v_to is null or v_body = '' then return; end if;
  if p_hourly_cap is not null and auth.uid() is not null and (
       select count(*) from public.sms_outbox
        where actor = auth.uid() and event = p_event and created_at > now() - interval '1 hour'
     ) >= p_hourly_cap then
    return;
  end if;
  -- At most 2 SMS parts; longer messages point to the portal
  if length(v_body) > 306 then v_body := left(v_body, 282) || '... More in the portal.'; end if;

  insert into public.sms_outbox (event, ref, body, recipients, actor)
  values (p_event, left(p_ref, 200), v_body, v_to, auth.uid())
  on conflict (event, ref) do nothing
  returning id into v_id;
  if v_id is null then return; end if;

  perform net.http_post(
    url     := 'https://dcdqmxsdazwattnrbjyb.supabase.co/functions/v1/sms-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := jsonb_build_object('id', v_id)
  );
exception when others then
  raise warning 'sms_enqueue(%): %', p_event, sqlerrm;
end;
$fn$;

-- ── 4. Events ────────────────────────────────────────────────────────────────
-- Announcements, class reports completed, child links
create or replace function private.sms_on_notification()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_to     text[];
  v_target text := lower(coalesce(new.target, 'all'));
  v_title  text := regexp_replace(btrim(coalesce(new.title, '')), '[.!?:;,]+$', '');
begin
  if new.type = 'announcement' and new.user_id is null and private.is_finance() then
    v_to := case
      when v_target in ('teacher', 'teachers')       then private.sms_role_phones('teacher')
      when v_target in ('accountant', 'accountants') then private.sms_role_phones('accountant')
      when v_target in ('parent', 'parents')         then private.sms_all_parent_phones()
      when v_target in ('admin', 'admins')           then private.sms_role_phones('admin')
      else private.sms_role_phones('teacher') || private.sms_role_phones('accountant')
        || private.sms_role_phones('admin') || private.sms_all_parent_phones()
    end;
    -- Not to the person who sent it
    v_to := array(select x from unnest(v_to) x except select y from unnest(private.sms_user_phones(auth.uid())) y);
    perform private.sms_enqueue('announcement', new.id::text,
      'Ridge Valley School: ' || case when v_title <> '' then v_title || '. ' else '' end || coalesce(new.message, ''),
      v_to);

  elsif new.type = 'report_submitted' and new.user_id is not null and private.my_role() = 'teacher' then
    perform private.sms_enqueue('class_reports_done', new.id::text,
      'Ridge Valley School: ' || coalesce(nullif(btrim(new.message), ''), v_title),
      private.sms_user_phones(new.user_id), 6);

  elsif new.type = 'system' and new.user_id is not null and private.is_admin()
        and new.title in ('Child Link Approved', 'Child Link Declined') then
    perform private.sms_enqueue('child_link', new.id::text,
      'Ridge Valley School: ' || coalesce(new.message, ''),
      private.sms_user_phones(new.user_id));
  end if;
  return new;
exception when others then
  raise warning 'sms_on_notification: %', sqlerrm;
  return new;
end;
$fn$;

create or replace trigger sms_on_notification after insert on public.notifications
  for each row execute function private.sms_on_notification();

-- Payments: submitted, approved, rejected, or recorded by the office
create or replace function private.sms_on_transaction()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  v_student text;
  v_amount  text;
  v_payer   uuid;
  v_name    text;
  v_office  text[];
  v_method  text;
begin
  if coalesce(new.type, '') <> 'payment' then return new; end if;
  v_student := private.sms_student_name(new.student_id);
  v_amount  := private.sms_money(new.amount);
  if new.parent_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_payer := new.parent_id::uuid;
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    -- Receipt to the parent who paid
    if v_payer is not null then
      perform private.sms_enqueue('payment_submitted', new.id::text || ':payer',
        'Ridge Valley School: We received your payment of ' || v_amount || ' for ' || v_student
          || '. The accounts office will confirm it shortly.',
        private.sms_user_phones(v_payer), 10);
    end if;
    -- Alert to the accounts office (the admin when there is no accountant)
    v_office := private.sms_role_phones('accountant');
    if cardinality(v_office) = 0 then v_office := private.sms_role_phones('admin'); end if;
    select nullif(btrim(full_name), '') into v_name from public.profiles where id = v_payer;
    v_method := case lower(coalesce(new.method, ''))
                  when 'momo' then 'Mobile Money' when 'paystack' then 'Paystack'
                  when 'cash' then 'cash' else nullif(new.method, '') end;
    perform private.sms_enqueue('payment_submitted', new.id::text || ':office',
      'Ridge Valley School: New payment of ' || v_amount || ' for ' || v_student
        || coalesce(' from ' || v_name, '') || coalesce(' by ' || v_method, '')
        || ' is waiting for approval in the portal.',
      v_office, 10);

  elsif new.status in ('confirmed', 'rejected')
        and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform private.sms_enqueue('payment_reviewed', new.id::text || ':' || new.status,
      'Ridge Valley School: ' || case when new.status = 'confirmed'
        then 'Your payment of ' || v_amount || ' for ' || v_student || ' has been confirmed. Thank you.'
        else 'Your payment of ' || v_amount || ' for ' || v_student || ' was not approved. Please contact the accounts office.'
      end,
      private.sms_parent_phones(new.student_id)
        || case when v_payer is not null then private.sms_user_phones(v_payer) else '{}'::text[] end);
  end if;
  return new;
exception when others then
  raise warning 'sms_on_transaction: %', sqlerrm;
  return new;
end;
$fn$;

create or replace trigger sms_on_transaction after insert or update of status on public.transactions
  for each row execute function private.sms_on_transaction();

-- Report file uploaded by the admin
create or replace function private.sms_on_report()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.file_url is null or not private.is_admin() then return new; end if;
  if tg_op = 'UPDATE' and old.file_url is not distinct from new.file_url then return new; end if;
  perform private.sms_enqueue('report_published', new.id::text,
    'Ridge Valley School: The report for ' || private.sms_student_name(new.student_id, new.student_name)
      || ' is now available. Sign in to the parent portal to view it.',
    private.sms_parent_phones(new.student_id));
  return new;
exception when others then
  raise warning 'sms_on_report: %', sqlerrm;
  return new;
end;
$fn$;

create or replace trigger sms_on_report after insert or update of file_url on public.reports
  for each row execute function private.sms_on_report();

-- Student marked absent (today's register only, once per student per day)
create or replace function private.sms_on_attendance()
returns trigger language plpgsql security definer set search_path = '' as $fn$
begin
  if new.status is distinct from 'absent' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  if new.date is distinct from (now() at time zone 'Africa/Accra')::date then return new; end if;
  perform private.sms_enqueue('absent', new.student_id || ':' || new.date::text,
    'Ridge Valley School: ' || private.sms_student_name(new.student_id) || ' was marked absent today ('
      || to_char(new.date, 'FMDD Mon YYYY') || '). Please contact the class teacher if this is unexpected.',
    private.sms_parent_phones(new.student_id));
  return new;
exception when others then
  raise warning 'sms_on_attendance: %', sqlerrm;
  return new;
end;
$fn$;

create or replace trigger sms_on_attendance after insert or update of status on public.attendance
  for each row execute function private.sms_on_attendance();

-- New bill assigned to a student by the accounts office
create or replace function private.sms_on_bill()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  b public.bills;
begin
  if not private.is_finance() then return new; end if;
  select * into b from public.bills where id = new.bill_id;
  if not found then return new; end if;
  perform private.sms_enqueue('new_bill', new.id::text,
    'Ridge Valley School: A new bill has been added for ' || private.sms_student_name(new.student_id)
      || ': ' || coalesce(nullif(btrim(b.bill_name), ''), 'school bill') || ', ' || private.sms_money(b.amount)
      || coalesce(', due ' || to_char(b.due_date, 'FMDD Mon YYYY'), '') || '. Details in the parent portal.',
    private.sms_parent_phones(new.student_id));
  return new;
exception when others then
  raise warning 'sms_on_bill: %', sqlerrm;
  return new;
end;
$fn$;

create or replace trigger sms_on_bill after insert on public.bill_assignments
  for each row execute function private.sms_on_bill();

revoke all on function private.sms_event_on(text), private.sms_user_phones(uuid), private.sms_parent_phones(text),
  private.sms_role_phones(text), private.sms_all_parent_phones(), private.sms_student_name(text, text),
  private.sms_enqueue(text, text, text, text[], int) from public, anon, authenticated;

-- ── 5. Admin: setup, message choices, recent messages ───────────────────────
create or replace function public.admin_set_sms_config(p_api_key text, p_from_number text)
returns void language plpgsql security definer set search_path = '' as $fn$
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
  update public.sms_config
     set api_key     = coalesce(v_key, api_key),
         from_number = v_from,
         updated_at  = now(),
         updated_by  = auth.uid()
   where id = 1;
  if found then return; end if;
  if v_key is null then
    raise exception 'Enter the httpSMS API key' using errcode = '22023';
  end if;
  insert into public.sms_config (id, api_key, from_number, updated_at, updated_by)
  values (1, v_key, v_from, now(), auth.uid());
end;
$fn$;

create or replace function public.admin_sms_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $fn$
declare
  c public.sms_config;
  v_events jsonb := '{}'::jsonb;
  e text;
begin
  if not private.is_admin() then
    raise exception 'Only the administrator can view the SMS setup' using errcode = '42501';
  end if;
  select * into c from public.sms_config where id = 1;
  if not found then
    return jsonb_build_object('configured', false);
  end if;
  foreach e in array array['announcement', 'payment_submitted', 'payment_reviewed', 'class_reports_done',
                           'report_published', 'child_link', 'absent', 'new_bill'] loop
    v_events := v_events || jsonb_build_object(e, coalesce((c.events ->> e)::boolean, e not in ('absent', 'new_bill')));
  end loop;
  return jsonb_build_object(
    'configured',  true,
    'from_number', c.from_number,
    'key_hint',    right(c.api_key, 4),
    'updated_at',  c.updated_at,
    'events',      v_events
  );
end;
$fn$;

create or replace function public.admin_set_sms_events(p_events jsonb)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  v_clean jsonb := '{}'::jsonb;
  e text;
begin
  if not private.is_admin() then
    raise exception 'Only the administrator can choose SMS messages' using errcode = '42501';
  end if;
  if not exists (select 1 from public.sms_config where id = 1) then
    raise exception 'Set up SMS first' using errcode = '22023';
  end if;
  foreach e in array array['announcement', 'payment_submitted', 'payment_reviewed', 'class_reports_done',
                           'report_published', 'child_link', 'absent', 'new_bill'] loop
    if jsonb_typeof(p_events -> e) = 'boolean' then
      v_clean := v_clean || jsonb_build_object(e, p_events -> e);
    end if;
  end loop;
  update public.sms_config set events = events || v_clean, updated_at = now(), updated_by = auth.uid() where id = 1;
end;
$fn$;

-- The last messages, for Settings (no phone numbers or keys)
create or replace function public.admin_sms_recent(p_limit int default 15)
returns table (event text, created_at timestamptz, recipients int, sent int, failed int,
               finished_at timestamptz, status text, error text)
language plpgsql stable security definer set search_path = '' as $fn$
begin
  if not private.is_admin() then
    raise exception 'Only the administrator can view SMS history' using errcode = '42501';
  end if;
  return query
    select o.event, o.created_at, cardinality(o.recipients), o.sent, o.failed, o.finished_at,
           case when o.finished_at is not null then 'done'
                when o.claimed_at is not null then 'sending'
                when o.created_at < now() - interval '15 minutes' then 'not sent'
                else 'queued' end,
           o.errors -> 0 ->> 'error'
      from public.sms_outbox o
     order by o.created_at desc
     limit least(greatest(coalesce(p_limit, 15), 1), 50);
end;
$fn$;

revoke all on function public.admin_set_sms_events(jsonb), public.admin_sms_recent(int) from public, anon;
grant execute on function public.admin_set_sms_events(jsonb), public.admin_sms_recent(int) to authenticated;
