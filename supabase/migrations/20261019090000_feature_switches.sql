-- Feature switches (Settings)
--
-- The switches live in app_settings as two rows: features_academic (changed by
-- the administrator) and features_finance (changed by the accountant).
--
-- 1. Every signed-in user can READ those two rows, so menus for teachers and
--    parents follow the switches. Other app_settings rows (such as the finance
--    verification email) stay readable only by the admin and accountant.
-- 2. Only the administrator may change features_academic, and only the
--    accountant may change features_finance. These are "restrictive" policies,
--    so they narrow the existing admin/accountant write access to app_settings
--    without changing anything else.
--
-- Safe to run more than once. Nothing is dropped or deleted.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'
                 and policyname = 'app_settings: everyone reads feature switches') then
    create policy "app_settings: everyone reads feature switches" on public.app_settings
      for select to authenticated
      using (key in ('features_academic', 'features_finance'));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'
                 and policyname = 'app_settings: switch owners insert') then
    create policy "app_settings: switch owners insert" on public.app_settings
      as restrictive for insert to authenticated
      with check ((key <> 'features_academic' or private.is_admin())
              and (key <> 'features_finance'  or private.is_accountant()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'
                 and policyname = 'app_settings: switch owners update') then
    create policy "app_settings: switch owners update" on public.app_settings
      as restrictive for update to authenticated
      using      ((key <> 'features_academic' or private.is_admin())
              and (key <> 'features_finance'  or private.is_accountant()))
      with check ((key <> 'features_academic' or private.is_admin())
              and (key <> 'features_finance'  or private.is_accountant()));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_settings'
                 and policyname = 'app_settings: switch owners delete') then
    create policy "app_settings: switch owners delete" on public.app_settings
      as restrictive for delete to authenticated
      using ((key <> 'features_academic' or private.is_admin())
         and (key <> 'features_finance'  or private.is_accountant()));
  end if;
end $$;
