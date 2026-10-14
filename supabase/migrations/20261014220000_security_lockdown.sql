-- =============================================================================
-- Security lockdown (follow-up to the system audit)
--
--  1. Enable RLS on every public table and replace the permissive policies with
--     role-scoped ones. Anonymous users get no table access at all.
--  2. Make the `reports` and `payments` storage buckets private.
--  3. Profiles are created server-side on sign-up; users can no longer set their
--     own role / approved / is_super_admin.
--  4. Teachers need admin approval; parent->child links need admin approval.
--  5. The few things the logged-out screen needs (does an admin exist? which
--     email belongs to this parent phone number?) go through narrow RPCs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Private helper schema (not exposed through the REST API)
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and (approved or is_super_admin)
  )
$$;

create or replace function private.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_super_admin
  )
$$;

create or replace function private.is_teacher()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and approved
  )
$$;

-- Class ids assigned to the calling (approved) teacher.
create or replace function private.teacher_class_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select t.assigned_class from public.teachers t
  where t.profile_id = auth.uid() and t.assigned_class is not null and private.is_teacher()
$$;

-- Student ids in the calling teacher's class(es).
create or replace function private.teacher_student_ids()
returns setof text language sql stable security definer set search_path = '' as $$
  select s.id from public.students s
  where s.class_id in (select private.teacher_class_ids())
$$;

-- Admin-approved children of the calling parent (as text, matching students.id).
create or replace function private.parent_child_ids()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c::text), '{}')
  from public.parents p, unnest(p.children_ids) c
  where p.profile_id = auth.uid()
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated;

-- -----------------------------------------------------------------------------
-- 1. Remove leftover SECURITY DEFINER functions that anyone could call
--    (they reference tables that do not exist).
-- -----------------------------------------------------------------------------
drop function if exists public.link_parent_to_student(uuid);
drop function if exists public.link_teacher_to_class(uuid);

-- -----------------------------------------------------------------------------
-- 2. Pending child links
-- -----------------------------------------------------------------------------
alter table public.parents
  add column if not exists pending_children_ids uuid[] not null default '{}';

-- -----------------------------------------------------------------------------
-- 3. Profiles are created by the server on sign-up
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data->>'role', 'parent');
  v_name  text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_phone text := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  v_first_admin boolean := false;
begin
  if v_role not in ('admin', 'teacher', 'parent') then
    v_role := 'parent';
  end if;

  -- Only the very first admin account is auto-approved (system bootstrap).
  if v_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('rvsms_first_admin'));
    v_first_admin := not exists (select 1 from public.profiles where role = 'admin');
  end if;

  insert into public.profiles (id, email, full_name, role, phone, approved, is_super_admin)
  values (new.id, new.email, v_name, v_role, v_phone,
          v_role = 'parent' or v_first_admin,   -- teachers and admins wait for approval
          v_first_admin)
  on conflict (id) do nothing;

  if v_role = 'teacher' then
    insert into public.teachers (profile_id, email, full_name, assigned_class)
    select new.id, new.email, v_name, null
    where not exists (select 1 from public.teachers where profile_id = new.id);
  elsif v_role = 'parent' then
    insert into public.parents (profile_id, email, full_name, phone, children_ids)
    select new.id, new.email, v_name, v_phone, '{}'
    where not exists (select 1 from public.parents where profile_id = new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users may edit their own name/phone, but never their own role, approval or
-- super-admin flag. Only admins change role/approved; only the super admin
-- changes anything about admin accounts or the is_super_admin flag.
create or replace function private.guard_profile_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    return new;  -- service role / dashboard / SQL editor
  end if;

  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed';
  end if;

  if new.is_super_admin is distinct from old.is_super_admin
     and not private.is_super_admin() then
    raise exception 'Only the super admin can change super-admin status';
  end if;

  if new.role is distinct from old.role or new.approved is distinct from old.approved then
    if not private.is_admin() then
      raise exception 'Only an administrator can change role or approval';
    end if;
    if old.id = auth.uid() then
      raise exception 'You cannot change your own role or approval';
    end if;
    if (old.role = 'admin' or new.role = 'admin') and not private.is_super_admin() then
      raise exception 'Only the super admin can approve or change admin accounts';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_update on public.profiles;
create trigger guard_profile_update
  before update on public.profiles
  for each row execute function private.guard_profile_update();

-- -----------------------------------------------------------------------------
-- 4. Enable RLS everywhere and drop every existing public policy
-- -----------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
  for r in select tablename, policyname from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Anonymous users get no direct table access (they only use the RPCs below).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- -----------------------------------------------------------------------------
-- 5. Policies
-- -----------------------------------------------------------------------------

-- profiles ---------------------------------------------------------------------
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or private.is_admin());

create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or private.is_admin())
  with check (id = (select auth.uid()) or private.is_admin());

create policy "profiles: admin delete" on public.profiles
  for delete to authenticated
  using (private.is_admin() and (role <> 'admin' or private.is_super_admin()) and id <> (select auth.uid()));
-- (no INSERT policy: profiles are created by private.handle_new_user)

-- teachers ---------------------------------------------------------------------
create policy "teachers: read own or admin" on public.teachers
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_admin());

create policy "teachers: admin write" on public.teachers
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- parents ----------------------------------------------------------------------
create policy "parents: read own or admin" on public.parents
  for select to authenticated
  using (profile_id = (select auth.uid()) or private.is_admin());

-- A parent may (re)create their own empty row; links only come via review_child_link.
create policy "parents: insert own empty row" on public.parents
  for insert to authenticated
  with check (
    private.is_admin()
    or (profile_id = (select auth.uid())
        and private.my_role() = 'parent'
        and coalesce(cardinality(children_ids), 0) = 0
        and cardinality(pending_children_ids) = 0)
  );

create policy "parents: admin update" on public.parents
  for update to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy "parents: admin delete" on public.parents
  for delete to authenticated
  using (private.is_admin());

-- students ---------------------------------------------------------------------
create policy "students: read by role" on public.students
  for select to authenticated
  using (
    private.is_admin()
    or class_id in (select private.teacher_class_ids())
    or id = any (private.parent_child_ids())
  );

create policy "students: admin write" on public.students
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- graduated_students / promotion history: admin only --------------------------
create policy "graduated_students: admin" on public.graduated_students
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "promotion_logs: admin" on public.promotion_logs
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "student_promotions: admin" on public.student_promotions
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- reference data: any signed-in user reads, admins write ------------------------
create policy "academic_years: read" on public.academic_years for select to authenticated using (true);
create policy "academic_years: admin write" on public.academic_years for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "classes: read" on public.classes for select to authenticated using (true);
create policy "classes: admin write" on public.classes for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "fees: read" on public.fees for select to authenticated using (true);
create policy "fees: admin write" on public.fees for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "bills: read" on public.bills for select to authenticated using (true);
create policy "bills: admin write" on public.bills for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "weeks: read" on public.weeks for select to authenticated using (true);
create policy "weeks: admin write" on public.weeks for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "school_settings: read" on public.school_settings for select to authenticated using (true);
create policy "school_settings: admin write" on public.school_settings for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- app_settings holds the finance verification email: admin only ----------------
create policy "app_settings: admin" on public.app_settings
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- bill_assignments --------------------------------------------------------------
create policy "bill_assignments: read by role" on public.bill_assignments
  for select to authenticated
  using (
    private.is_admin()
    or student_id = any (private.parent_child_ids())
    or student_id in (select private.teacher_student_ids())
  );
create policy "bill_assignments: admin write" on public.bill_assignments
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- attendance --------------------------------------------------------------------
create policy "attendance: read by role" on public.attendance
  for select to authenticated
  using (
    private.is_admin()
    or student_id in (select private.teacher_student_ids())
    or teacher_id = (select auth.uid())::text
    or student_id = any (private.parent_child_ids())
  );
create policy "attendance: admin or class teacher write" on public.attendance
  for all to authenticated
  using (private.is_admin() or student_id in (select private.teacher_student_ids()))
  with check (private.is_admin() or student_id in (select private.teacher_student_ids()));

-- transactions ------------------------------------------------------------------
create policy "transactions: read by role" on public.transactions
  for select to authenticated
  using (
    private.is_admin()
    or parent_id = (select auth.uid())::text
    or student_id = any (private.parent_child_ids())
  );
create policy "transactions: parent submits pending payment" on public.transactions
  for insert to authenticated
  with check (
    private.is_admin()
    or (parent_id = (select auth.uid())::text
        and student_id = any (private.parent_child_ids())
        and status = 'pending'
        and verified_by is null)
  );
create policy "transactions: admin update" on public.transactions
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "transactions: admin delete" on public.transactions
  for delete to authenticated using (private.is_admin());

-- reports -----------------------------------------------------------------------
create policy "reports: read by role" on public.reports
  for select to authenticated
  using (
    private.is_admin()
    or teacher_id = (select auth.uid())::text
    or student_id in (select private.teacher_student_ids())
    or (status = 'published' and student_id = any (private.parent_child_ids()))
  );
create policy "reports: admin or own-class teacher insert" on public.reports
  for insert to authenticated
  with check (
    private.is_admin()
    or (teacher_id = (select auth.uid())::text and student_id in (select private.teacher_student_ids()))
  );
create policy "reports: admin or class teacher update" on public.reports
  for update to authenticated
  using (
    private.is_admin()
    or (private.is_teacher() and teacher_id = (select auth.uid())::text)
    or student_id in (select private.teacher_student_ids())
  )
  with check (
    private.is_admin()
    or (private.is_teacher() and teacher_id = (select auth.uid())::text)
    or student_id in (select private.teacher_student_ids())
  );
create policy "reports: admin or owning teacher delete" on public.reports
  for delete to authenticated
  using (private.is_admin() or (private.is_teacher() and teacher_id = (select auth.uid())::text));

-- received_reports (teacher submissions) -----------------------------------------
create policy "received_reports: read admin or own" on public.received_reports
  for select to authenticated
  using (private.is_admin() or (private.is_teacher() and teacher_id = (select auth.uid())::text));
create policy "received_reports: teacher submits own" on public.received_reports
  for insert to authenticated
  with check (private.is_admin() or (private.is_teacher() and teacher_id = (select auth.uid())::text));
create policy "received_reports: admin update" on public.received_reports
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "received_reports: admin delete" on public.received_reports
  for delete to authenticated using (private.is_admin());

-- notifications -----------------------------------------------------------------
create policy "notifications: read own and role announcements" on public.notifications
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or created_by = (select auth.uid())
    or (user_id is null and type = 'announcement'
        and (target is null or target = 'all'
             or target = private.my_role() or target = private.my_role() || 's'))
  );
-- Admins may send anything (incl. broadcasts); others only direct messages as themselves.
create policy "notifications: insert" on public.notifications
  for insert to authenticated
  with check (
    private.is_admin()
    or (created_by = (select auth.uid()) and user_id is not null)
  );
create policy "notifications: recipient or admin update" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()) or private.is_admin())
  with check (user_id = (select auth.uid()) or private.is_admin());
create policy "notifications: recipient or admin delete" on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

-- -----------------------------------------------------------------------------
-- 6. RPCs used by the app
-- -----------------------------------------------------------------------------

-- Login screen: "does an admin exist?" without exposing profiles.
create or replace function public.admin_exists()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where role = 'admin')
$$;

-- Parent phone-number login: resolve a parent's phone to their login email.
create or replace function public.login_email_for_phone(p_phone text)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select email from public.profiles where role = 'parent' and phone = p_phone limit 1),
    (select email from public.parents  where phone = p_phone limit 1)
  )
$$;

-- Parents search for their child by name (min 3 chars, max 10 results,
-- only id/name/class returned).
create or replace function public.search_students_for_link(p_query text)
returns table (id text, name text, class text)
language plpgsql stable security definer set search_path = '' as $$
declare q text := trim(coalesce(p_query, ''));
begin
  if private.my_role() is distinct from 'parent' then
    raise exception 'Only parent accounts can search for children';
  end if;
  if length(q) < 3 then
    raise exception 'Enter at least 3 letters of your child''s name';
  end if;
  q := replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_');
  return query
    select s.id, s.name, s.class from public.students s
    where s.name ilike '%' || q || '%'
      and coalesce(s.status, 'active') = 'active'
    order by s.name
    limit 10;
end;
$$;

-- Parent asks for a child link; an admin must approve it.
create or replace function public.request_child_link(p_student_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.parents%rowtype;
  v_sid uuid;
  v_student_name text;
begin
  if private.my_role() is distinct from 'parent' then
    raise exception 'Only parent accounts can link children';
  end if;

  select * into v_parent from public.parents where profile_id = auth.uid() limit 1;
  if not found then
    raise exception 'Parent record not found';
  end if;

  select s.id::uuid, s.name into v_sid, v_student_name from public.students s where s.id = p_student_id;
  if v_sid is null then
    raise exception 'Student not found';
  end if;

  if v_sid = any (coalesce(v_parent.children_ids, '{}')) then
    raise exception 'This child is already linked to your account';
  end if;
  if v_sid = any (v_parent.pending_children_ids) then
    raise exception 'A request for this child is already waiting for approval';
  end if;
  if exists (select 1 from public.parents p where p.id <> v_parent.id and v_sid = any (coalesce(p.children_ids, '{}'))) then
    raise exception 'This child is already linked to another parent account';
  end if;

  update public.parents
     set pending_children_ids = array_append(pending_children_ids, v_sid)
   where id = v_parent.id;

  insert into public.notifications (user_id, title, message, type, read, created_by)
  select pr.id, 'Child Link Request',
         coalesce(v_parent.full_name, 'A parent') || ' asked to link ' || coalesce(v_student_name, 'a student') || '. Review it under Approvals.',
         'child_linked', false, auth.uid()
  from public.profiles pr
  where pr.role = 'admin' and (pr.approved or pr.is_super_admin);
end;
$$;

-- Admin approves or rejects a pending child link.
create or replace function public.review_child_link(p_parent_id uuid, p_student_id text, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_parent public.parents%rowtype;
  v_sid uuid := p_student_id::uuid;
  v_student_name text;
begin
  if not private.is_admin() then
    raise exception 'Only administrators can review child links';
  end if;

  select * into v_parent from public.parents where id = p_parent_id for update;
  if not found then
    raise exception 'Parent not found';
  end if;
  if not (v_sid = any (v_parent.pending_children_ids)) then
    raise exception 'No pending request for this child';
  end if;

  if p_approve and exists (select 1 from public.parents p where p.id <> p_parent_id and v_sid = any (coalesce(p.children_ids, '{}'))) then
    raise exception 'This child is already linked to another parent account';
  end if;

  update public.parents
     set pending_children_ids = array_remove(pending_children_ids, v_sid),
         children_ids = case
           when p_approve and not (v_sid = any (coalesce(children_ids, '{}')))
             then array_append(coalesce(children_ids, '{}'), v_sid)
           else children_ids end
   where id = p_parent_id;

  select name into v_student_name from public.students where id = p_student_id;
  if v_parent.profile_id is not null then
    insert into public.notifications (user_id, title, message, type, read, created_by)
    values (v_parent.profile_id,
            case when p_approve then 'Child Link Approved' else 'Child Link Declined' end,
            case when p_approve
              then coalesce(v_student_name, 'Your child') || ' is now linked to your account.'
              else 'Your request to link ' || coalesce(v_student_name, 'a student') || ' was declined. Please contact the school.'
            end,
            'system', false, auth.uid());
  end if;
end;
$$;

-- Lets parents/teachers notify the admins without being able to read admin profiles.
create or replace function public.notify_admins(p_title text, p_message text, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_type not in ('payment', 'report_submitted', 'child_linked', 'report_correction') then
    raise exception 'Invalid notification type';
  end if;
  insert into public.notifications (user_id, title, message, type, read, created_by)
  select pr.id, left(p_title, 200), left(p_message, 1000), p_type, false, auth.uid()
  from public.profiles pr
  where pr.role = 'admin' and (pr.approved or pr.is_super_admin);
end;
$$;

revoke all on function public.admin_exists() from public;
revoke all on function public.login_email_for_phone(text) from public;
revoke all on function public.search_students_for_link(text) from public;
revoke all on function public.request_child_link(text) from public;
revoke all on function public.review_child_link(uuid, text, boolean) from public;
revoke all on function public.notify_admins(text, text, text) from public;

grant execute on function public.admin_exists() to anon, authenticated;
grant execute on function public.login_email_for_phone(text) to anon, authenticated;
grant execute on function public.search_students_for_link(text) to authenticated;
grant execute on function public.request_child_link(text) to authenticated;
grant execute on function public.review_child_link(uuid, text, boolean) to authenticated;
grant execute on function public.notify_admins(text, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Storage: private buckets + scoped policies
--    (report-templates stays public: it only holds blank .docx templates)
-- -----------------------------------------------------------------------------
update storage.buckets set public = false where id in ('reports', 'payments');

drop policy if exists "Allow authenticated deletes mv7okt_0" on storage.objects;
drop policy if exists "Allow authenticated uploads mv7okt_0" on storage.objects;
drop policy if exists "Allow public read mv7okt_0"           on storage.objects;
drop policy if exists "Authenticated users can delete reports" on storage.objects;
drop policy if exists "Authenticated users can read reports"   on storage.objects;
drop policy if exists "Authenticated users can update reports" on storage.objects;
drop policy if exists "Authenticated users can upload reports" on storage.objects;

-- payments: parents upload proof, uploader and admins can view, admins delete
create policy "payments: parent or admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payments' and (private.is_admin() or private.my_role() = 'parent'));
create policy "payments: uploader or admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'payments' and (private.is_admin() or owner_id = (select auth.uid())::text));
create policy "payments: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payments' and private.is_admin());

-- reports: admins and teachers upload; teachers see their own files; parents
-- see files of their children's published reports.
create policy "reports: admin or teacher upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reports' and (private.is_admin() or private.is_teacher()));
create policy "reports: admin or owning teacher update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reports' and (
      private.is_admin()
      or (private.is_teacher() and (
            owner_id = (select auth.uid())::text
            or exists (
              select 1 from public.reports r
              where split_part(r.file_url, '/object/public/reports/', 2) = storage.objects.name
                and r.student_id in (select private.teacher_student_ids())
            )))
    )
  )
  with check (bucket_id = 'reports' and (private.is_admin() or private.is_teacher()));
create policy "reports: read by role" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reports' and (
      private.is_admin()
      or (private.is_teacher() and owner_id = (select auth.uid())::text)
      or exists (
        select 1 from public.reports r
        where split_part(r.file_url, '/object/public/reports/', 2) = storage.objects.name
          and (
            (r.status = 'published' and r.student_id = any (private.parent_child_ids()))
            or r.teacher_id = (select auth.uid())::text
            or r.student_id in (select private.teacher_student_ids())
          )
      )
    )
  );
create policy "reports: admin or owning teacher delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'reports' and (private.is_admin() or (private.is_teacher() and owner_id = (select auth.uid())::text)));
