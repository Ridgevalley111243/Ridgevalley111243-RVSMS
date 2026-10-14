-- PART 2 of 3 — run after part 1
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

select 'PART 2 OK' as result;
