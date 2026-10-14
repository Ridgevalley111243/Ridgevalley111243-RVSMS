-- PART 3 of 3 — run after part 2
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

-- Supabase grants EXECUTE on new functions to anon directly; these four are
-- for signed-in users only.
revoke execute on function public.search_students_for_link(text) from anon;
revoke execute on function public.request_child_link(text) from anon;
revoke execute on function public.review_child_link(uuid, text, boolean) from anon;
revoke execute on function public.notify_admins(text, text, text) from anon;

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
select 'PART 3 OK' as result;
