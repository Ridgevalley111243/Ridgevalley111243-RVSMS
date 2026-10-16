-- Record which version of the Terms of Use / Privacy Policy each user agreed
-- to, and when. The portal asks again whenever the version changes.

alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;

create or replace function public.accept_terms(p_version text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(btrim(p_version), '') = '' or length(p_version) > 40 then
    raise exception 'Invalid terms version';
  end if;
  update public.profiles
     set terms_version = btrim(p_version),
         terms_accepted_at = now()
   where id = auth.uid();
end;
$$;

revoke all on function public.accept_terms(text) from public, anon;
grant execute on function public.accept_terms(text) to authenticated;
