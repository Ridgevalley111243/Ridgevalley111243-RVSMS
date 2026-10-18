-- Paystack online payments
--
-- 1. transactions.reference: the Paystack reference for an online payment.
--    Unique, so the same payment can never be recorded twice.
-- 2. The Paystack PUBLIC key (app_settings.paystack_public_key) can be read by
--    every signed-in user (parents need it to open Paystack) and changed only
--    by the accountant. A public key is designed to be public; the SECRET key
--    is never stored here.
--
-- Safe to run more than once. Nothing is dropped or deleted.

alter table public.transactions add column if not exists reference text;
create unique index if not exists transactions_reference_key
  on public.transactions (reference) where reference is not null;

alter policy "app_settings: everyone reads feature switches" on public.app_settings
  using (key in ('features_academic', 'features_finance', 'paystack_public_key'));

alter policy "app_settings: switch owners insert" on public.app_settings
  with check ((key <> 'features_academic' or private.is_admin())
          and (key not in ('features_finance', 'paystack_public_key') or private.is_accountant()));

alter policy "app_settings: switch owners update" on public.app_settings
  using      ((key <> 'features_academic' or private.is_admin())
          and (key not in ('features_finance', 'paystack_public_key') or private.is_accountant()))
  with check ((key <> 'features_academic' or private.is_admin())
          and (key not in ('features_finance', 'paystack_public_key') or private.is_accountant()));

alter policy "app_settings: switch owners delete" on public.app_settings
  using ((key <> 'features_academic' or private.is_admin())
     and (key not in ('features_finance', 'paystack_public_key') or private.is_accountant()));
