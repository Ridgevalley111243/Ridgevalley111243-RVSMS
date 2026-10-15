-- =============================================================================
-- Accountant role
--
-- Finance moves out of the admin dashboard into a dedicated "accountant" user.
--  1. profiles.role accepts 'accountant'. The first accountant to sign up is
--     approved automatically (bootstrap, like the first admin); every later
--     accountant waits for an existing accountant to approve them.
--  2. private.is_accountant() / private.is_finance() helpers.
--  3. Accountants get the finance tables (fees, bills, bill assignments,
--     transactions, payment-proof storage) plus read access to the people
--     data the finance screens need (students, parents). Admins keep their
--     existing database access; only their dashboard no longer shows finance.
--  4. Parent payment notifications go to the accountants (or to the admins
--     while no accountant has been approved yet).
-- =============================================================================

-- 1. Role ---------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['admin', 'teacher', 'parent', 'accountant']));

-- 2. Helpers --------------------------------------------------------------------
create or replace function private.is_accountant()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'accountant' and approved
  )
$$;

create or replace function private.is_finance()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() or private.is_accountant()
$$;

revoke all on function private.is_accountant() from public;
revoke all on function private.is_finance() from public;
grant execute on function private.is_accountant() to authenticated;
grant execute on function private.is_finance() to authenticated;

-- Sign-up: accept 'accountant'. The first accountant is approved on sign-up;
-- later ones wait for an approved accountant, who is notified.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role  text := coalesce(new.raw_user_meta_data->>'role', 'parent');
  v_name  text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_phone text := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  v_first_admin boolean := false;
  v_first_accountant boolean := false;
begin
  if v_role not in ('admin', 'teacher', 'parent', 'accountant') then
    v_role := 'parent';
  end if;

  -- With no approved accountant yet, this one is the first and is approved.
  if v_role = 'accountant' then
    perform pg_advisory_xact_lock(hashtext('rvsms_first_accountant'));
    v_first_accountant := not exists (
      select 1 from public.profiles where role = 'accountant' and approved
    );
  end if;

  -- Only the very first admin account is auto-approved (system bootstrap).
  if v_role = 'admin' then
    perform pg_advisory_xact_lock(hashtext('rvsms_first_admin'));
    v_first_admin := not exists (select 1 from public.profiles where role = 'admin');
  end if;

  insert into public.profiles (id, email, full_name, role, phone, approved, is_super_admin)
  values (new.id, new.email, v_name, v_role, v_phone,
          v_role = 'parent' or v_first_admin or v_first_accountant,
          v_first_admin)
  on conflict (id) do nothing;

  -- Tell the approved accountants that a new accountant is waiting.
  if v_role = 'accountant' and not v_first_accountant then
    insert into public.notifications (user_id, title, message, type, read, created_by)
    select pr.id, 'New Accountant Request',
           left(v_name || ' (' || new.email || ') registered as an accountant and is waiting for your approval.', 1000),
           'system', false, new.id
    from public.profiles pr
    where pr.role = 'accountant' and pr.approved;
  end if;

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

-- Accountants approve other accountants (approval only; never a role change).
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
    if old.id = auth.uid() then
      raise exception 'You cannot change your own role or approval';
    end if;
    if private.is_accountant() and old.role = 'accountant' and new.role = 'accountant' then
      return new;
    end if;
    if not private.is_admin() then
      raise exception 'Only an administrator can change role or approval';
    end if;
    if (old.role = 'admin' or new.role = 'admin') and not private.is_super_admin() then
      raise exception 'Only the super admin can approve or change admin accounts';
    end if;
  end if;

  return new;
end;
$$;

-- Accountants see, approve and reject other accountant accounts.
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (private.is_accountant() and role = 'accountant')
  );
drop policy if exists "profiles: update own or admin" on public.profiles;
create policy "profiles: update own or admin" on public.profiles
  for update to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (private.is_accountant() and role = 'accountant')
  )
  with check (
    id = (select auth.uid())
    or private.is_admin()
    or (private.is_accountant() and role = 'accountant')
  );
drop policy if exists "profiles: accountant rejects pending accountant" on public.profiles;
create policy "profiles: accountant rejects pending accountant" on public.profiles
  for delete to authenticated
  using (
    private.is_accountant()
    and role = 'accountant'
    and not approved
    and id <> (select auth.uid())
  );

-- 3. Finance tables: admin OR accountant ------------------------------------------
drop policy if exists "fees: admin write" on public.fees;
create policy "fees: finance write" on public.fees
  for all to authenticated using (private.is_finance()) with check (private.is_finance());

drop policy if exists "bills: admin write" on public.bills;
create policy "bills: finance write" on public.bills
  for all to authenticated using (private.is_finance()) with check (private.is_finance());

drop policy if exists "bill_assignments: admin write" on public.bill_assignments;
create policy "bill_assignments: finance write" on public.bill_assignments
  for all to authenticated using (private.is_finance()) with check (private.is_finance());
drop policy if exists "bill_assignments: read by role" on public.bill_assignments;
create policy "bill_assignments: read by role" on public.bill_assignments
  for select to authenticated
  using (
    private.is_finance()
    or student_id = any (private.parent_child_ids())
    or student_id in (select private.teacher_student_ids())
  );

drop policy if exists "transactions: admin delete" on public.transactions;
create policy "transactions: finance delete" on public.transactions
  for delete to authenticated using (private.is_finance());
drop policy if exists "transactions: admin update" on public.transactions;
create policy "transactions: finance update" on public.transactions
  for update to authenticated using (private.is_finance()) with check (private.is_finance());
drop policy if exists "transactions: parent submits pending payment" on public.transactions;
create policy "transactions: parent submits pending payment" on public.transactions
  for insert to authenticated
  with check (
    private.is_finance()
    or (parent_id = (select auth.uid())::text
        and student_id = any (private.parent_child_ids())
        and status = 'pending'
        and verified_by is null)
  );
drop policy if exists "transactions: read by role" on public.transactions;
create policy "transactions: read by role" on public.transactions
  for select to authenticated
  using (
    private.is_finance()
    or parent_id = (select auth.uid())::text
    or student_id = any (private.parent_child_ids())
  );

-- People data the finance screens read (no write access) -------------------------
drop policy if exists "students: accountant read" on public.students;
create policy "students: accountant read" on public.students
  for select to authenticated using (private.is_accountant());
drop policy if exists "parents: accountant read" on public.parents;
create policy "parents: accountant read" on public.parents
  for select to authenticated using (private.is_accountant());

-- Payment verification e-mail setting
drop policy if exists "app_settings: accountant" on public.app_settings;
create policy "app_settings: accountant" on public.app_settings
  for all to authenticated using (private.is_accountant()) with check (private.is_accountant());

-- Accountants send payment notices to the parents they deal with
drop policy if exists "notifications: insert" on public.notifications;
create policy "notifications: insert" on public.notifications
  for insert to authenticated
  with check (
    private.is_finance()
    or (created_by = (select auth.uid()) and user_id is not null)
  );

-- Payment-proof storage
drop policy if exists "payments: admin delete" on storage.objects;
create policy "payments: finance delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payments' and private.is_finance());
drop policy if exists "payments: parent or admin upload" on storage.objects;
create policy "payments: parent or finance upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payments' and (private.is_finance() or private.my_role() = 'parent'));
drop policy if exists "payments: uploader or admin read" on storage.objects;
create policy "payments: uploader or finance read" on storage.objects
  for select to authenticated
  using (bucket_id = 'payments' and (private.is_finance() or owner_id = ((select auth.uid()))::text));

-- 4. Payment notifications go to accountants ------------------------------------
create or replace function public.notify_admins(p_title text, p_message text, p_type text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_type not in ('payment', 'report_submitted', 'child_linked', 'report_correction') then
    raise exception 'Invalid notification type';
  end if;

  if p_type = 'payment'
     and exists (select 1 from public.profiles where role = 'accountant' and approved) then
    insert into public.notifications (user_id, title, message, type, read, created_by)
    select pr.id, left(p_title, 200), left(p_message, 1000), p_type, false, auth.uid()
    from public.profiles pr
    where pr.role = 'accountant' and pr.approved;
    return;
  end if;

  insert into public.notifications (user_id, title, message, type, read, created_by)
  select pr.id, left(p_title, 200), left(p_message, 1000), p_type, false, auth.uid()
  from public.profiles pr
  where pr.role = 'admin' and (pr.approved or pr.is_super_admin);
end;
$$;
