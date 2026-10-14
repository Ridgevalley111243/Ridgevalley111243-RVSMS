-- =============================================================================
-- One-time data fix: undo the repeated promotions of September 2026.
--
-- The old promotion code had no once-per-year guard and kept no history, so
-- clicking "promote" more than once moved many students up 2-3 classes.
--
-- Source of truth for each student's class in 2025/2026: their Term 3
-- 2025/2026 report (every one of the 244 students has exactly one, and it
-- agrees with the class on their attendance records for all 187 students
-- who have attendance). The correct class now is exactly one step above it.
--
-- Also:
--   * marks every corrected student as promoted for 2026/2027 so the app's
--     (now durable) guard blocks a repeat promotion this year;
--   * records the move in student_promotions;
--   * removes the duplicate graduated_students row created by a second
--     graduation click;
--   * keeps a backup of the current class columns in backup.students_20261014.
-- =============================================================================
begin;

-- 1. Backup (schema "backup" is not exposed through the API)
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table backup.students_20261014 as
  select id, name, class, class_id, status, last_promoted_year, last_promoted_term, now() as backed_up_at
  from public.students;
create table backup.graduated_students_20261014 as select * from public.graduated_students;

-- 2. Correct class = one step above the Term 3 2025/2026 report class
create temp table promo_map (from_class text primary key, to_class_id uuid) on commit drop;
insert into promo_map values
  ('PRE-SCHOOL - NURSERY 1',         'eb0990e6-1c55-4c6d-9355-64b872cdf67b'),  -- -> NURSERY 2
  ('PRE-SCHOOL - NURSERY 2',         '1e1d325b-7349-415f-b430-e18661571513'),  -- -> KINDERGARTEN 1
  ('PRE-SCHOOL - KINDERGARTEN 1',    '983a9d6c-7c5f-4792-98d5-eb29c86fcdd6'),  -- -> KINDERGARTEN 2
  ('PRE-SCHOOL - KINDERGARTEN 2',    'd09818ba-11d1-4a07-a881-9d61be3fc231'),  -- -> BASIC 1
  ('LOWER PRIMARY - BASIC 1',        'e924ea59-e388-455d-9830-6514fefb7a4d'),  -- -> BASIC 2
  ('LOWER PRIMARY - BASIC 2',        'c6421216-f7b9-4874-95d2-42c4117a0c02'),  -- -> BASIC 3
  ('LOWER PRIMARY - BASIC 3',        'e63605d0-5d83-46c9-a001-418d4de32186'),  -- -> BASIC 4
  ('UPPER PRIMARY - BASIC 4',        '923776cf-963f-4707-9fa2-bf188440e1bc'),  -- -> BASIC 5
  ('UPPER PRIMARY - BASIC 5',        'f4d430a8-7431-486a-9971-efaec5a5810f');  -- -> BASIC 6
  -- BASIC 6 students were correctly graduated and are left as they are.

create temp table fix on commit drop as
select s.id, s.class as wrong_class, s.class_id as wrong_class_id,
       c.id as new_class_id,
       regexp_replace(c.level || ' - ' || c.grade, '\s+', ' ', 'g') as new_class
from public.students s
join public.reports r on r.student_id = s.id and r.academic_year = '2025/2026' and r.term = 'Term 3'
join promo_map m on m.from_class = regexp_replace(r.class, '\s+', ' ', 'g')
join public.classes c on c.id = m.to_class_id
where s.status = 'active';

update public.students s
   set class_id = f.new_class_id,
       class = f.new_class,
       last_promoted_year = '2026/2027',
       last_promoted_term = 'Term 1'
  from fix f
 where s.id = f.id;

insert into public.student_promotions
  (student_id, previous_class_id, previous_class_name, promoted_class_id, promoted_class_name, academic_year, promoted_term, promoted_by)
select f.id, r.class_id, regexp_replace(r.class, '\s+', ' ', 'g'), f.new_class_id, f.new_class, '2026/2027', 'Term 1', null
from fix f
join public.reports r on r.student_id = f.id and r.academic_year = '2025/2026' and r.term = 'Term 3';

-- Graduates: mark as handled for this year too
update public.students set last_promoted_year = '2026/2027', last_promoted_term = 'Term 1'
 where status = 'graduated';

-- 3. Remove duplicate graduation rows (keep the earliest per student)
delete from public.graduated_students g
 using public.graduated_students g2
 where g.student_id = g2.student_id
   and (g.graduated_at, g.id) > (g2.graduated_at, g2.id);

insert into public.promotion_logs (academic_year, term, total_students, total_promoted, total_graduated, notes)
select '2026/2027', 'Term 1', count(*), count(*), 0,
       'Data fix 2026-10-14: corrected repeated promotions using Term 3 2025/2026 report classes'
from fix;

commit;
