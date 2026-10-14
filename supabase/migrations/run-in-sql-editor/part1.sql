-- PART 1 of 3 — run this first
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

select 'PART 1 OK' as result;
