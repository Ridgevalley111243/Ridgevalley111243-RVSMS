-- Class teachers may edit the basic details (name, age, date of birth,
-- admission number, sex) of students in their own class -- nothing else.
-- A SECURITY DEFINER function keeps the students table's RLS admin-only for
-- writes while allowing exactly these columns for the teacher's own students.

create or replace function public.teacher_update_student(
  p_student_id       text,
  p_name             text,
  p_admission_number text,
  p_gender           text,
  p_age              text,
  p_dob              text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    private.is_admin()
    or p_student_id in (select private.teacher_student_ids())
  ) then
    raise exception 'You can only edit students in your own class'
      using errcode = '42501';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Student name is required' using errcode = '22023';
  end if;

  if nullif(btrim(p_gender), '') is not null
     and btrim(p_gender) not in ('Male', 'Female', 'Other') then
    raise exception 'Sex must be Male or Female' using errcode = '22023';
  end if;

  update public.students
     set name             = btrim(p_name),
         admission_number = nullif(btrim(p_admission_number), ''),
         gender           = nullif(btrim(p_gender), ''),
         age              = nullif(btrim(p_age), ''),
         dob              = nullif(btrim(p_dob), '')
   where id = p_student_id;
end;
$$;

revoke all on function public.teacher_update_student(text, text, text, text, text, text) from public, anon;
grant execute on function public.teacher_update_student(text, text, text, text, text, text) to authenticated;
