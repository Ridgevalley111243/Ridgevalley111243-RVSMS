-- Class report dates (report page → "Report dates" screen and "Adjust dates")
--
-- The class teacher sets the date of vacation (the report's "Date") and the
-- date of reopening ("Next Term Begins") once for the whole class and term,
-- instead of typing them on every report.
--
-- 1. report_term_dates: one row per class, academic year and term. Read by
--    the admin and by the teacher of that class. Changed only through
--    set_report_term_dates.
-- 2. set_report_term_dates: saves the two dates (empty = not known yet) and
--    writes them into every saved report of that class and term, so all
--    students' reports change together when a date changes.
--
-- Safe to run more than once. Nothing is dropped or deleted.

create table if not exists public.report_term_dates (
  class_id       uuid not null,
  academic_year  text not null,
  term           text not null,
  vacation_date  date,
  reopening_date date,
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  primary key (class_id, academic_year, term)
);
alter table public.report_term_dates enable row level security;
revoke all on public.report_term_dates from anon, authenticated;
grant select on public.report_term_dates to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'report_term_dates'
                 and policyname = 'report_term_dates: admin or class teacher read') then
    create policy "report_term_dates: admin or class teacher read" on public.report_term_dates
      for select to authenticated
      using (private.is_admin() or class_id in (select private.teacher_class_ids()));
  end if;
end $$;

-- Reads report JSON text safely (bad or empty text becomes an empty object)
create or replace function private.report_json(p_text text)
returns jsonb language plpgsql immutable set search_path = '' as $fn$
begin
  if p_text is null or btrim(p_text) = '' then return '{}'::jsonb; end if;
  return case when jsonb_typeof(p_text::jsonb) = 'object' then p_text::jsonb else '{}'::jsonb end;
exception when others then
  return '{}'::jsonb;
end;
$fn$;
revoke all on function private.report_json(text) from public, anon, authenticated;

-- Returns how many saved reports were updated
create or replace function public.set_report_term_dates(
  p_class_id uuid, p_academic_year text, p_term text, p_vacation date, p_reopening date
) returns int language plpgsql security definer set search_path = '' as $fn$
declare
  v_count int;
begin
  if not (private.is_admin() or p_class_id in (select private.teacher_class_ids())) then
    raise exception 'Only the class teacher or the administrator can set report dates' using errcode = '42501';
  end if;
  if coalesce(btrim(p_academic_year), '') = '' or coalesce(btrim(p_term), '') = '' then
    raise exception 'Academic year and term are required' using errcode = '22023';
  end if;
  if p_vacation is not null and p_reopening is not null and p_reopening <= p_vacation then
    raise exception 'The reopening date must be after the date of vacation' using errcode = '22023';
  end if;

  insert into public.report_term_dates (class_id, academic_year, term, vacation_date, reopening_date, updated_at, updated_by)
  values (p_class_id, btrim(p_academic_year), btrim(p_term), p_vacation, p_reopening, now(), auth.uid())
  on conflict (class_id, academic_year, term) do update
    set vacation_date  = excluded.vacation_date,
        reopening_date = excluded.reopening_date,
        updated_at     = now(),
        updated_by     = auth.uid();

  update public.reports r
     set data = (private.report_json(r.data) || jsonb_build_object(
                   'date',             coalesce(to_char(p_vacation,  'YYYY-MM-DD'), ''),
                   'next_term_begins', coalesce(to_char(p_reopening, 'YYYY-MM-DD'), '')))::text,
         last_modified = now()::text
   where r.class_id = p_class_id
     and r.term = btrim(p_term)
     and r.academic_year = btrim(p_academic_year);
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.set_report_term_dates(uuid, text, text, date, date) from public, anon;
grant execute on function public.set_report_term_dates(uuid, text, text, date, date) to authenticated;
