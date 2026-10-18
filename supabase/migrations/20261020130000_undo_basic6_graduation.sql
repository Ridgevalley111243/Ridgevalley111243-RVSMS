-- Undo the graduation of 15 Oct 2026, 12:49 UTC
--
-- Graduate All on the Promotion page was run one day after the year-end
-- promotion, so it graduated the 16 students who had just moved up from
-- Basic 5 into Basic 6. They are this year's Basic 6, not graduates.
-- (The 14 graduated on 17 Sep 2026 are last year's Basic 6 and stay graduated.)
--
-- 1. The 16 students become current students again (status 'active').
-- 2. Their entries in graduated_students are kept for the record but marked
--    'reverted'; the portal leaves reverted entries out of the Graduated
--    Students list. Nothing is deleted.
--
-- Only students who were promoted this academic year are touched, so a real
-- graduate can never be restored by mistake.

with wrong as (
  select g.student_id
    from public.graduated_students g
   where g.graduated_at = '2026-10-15 12:49:39.78+00'
     and coalesce(g.status, 'graduated') = 'graduated'
     and exists (select 1 from public.student_promotions sp
                  where sp.student_id = g.student_id and sp.academic_year = '2026/2027')
)
update public.students s
   set status = 'active'
  from wrong
 where s.id = wrong.student_id
   and s.status = 'graduated';

update public.graduated_students g
   set status = 'reverted'
 where g.graduated_at = '2026-10-15 12:49:39.78+00'
   and coalesce(g.status, 'graduated') = 'graduated'
   and exists (select 1 from public.student_promotions sp
                where sp.student_id = g.student_id and sp.academic_year = '2026/2027');
