-- SMS setup: "leave the key empty to keep the saved one" (fix)
--
-- admin_set_sms_config built an INSERT … ON CONFLICT row with an empty key,
-- and the NOT NULL check on api_key rejects that row before ON CONFLICT can
-- keep the saved key. So Settings → Change setup with the key box left empty
-- failed. Now an existing setup is UPDATEd (keeping the key when none is
-- given) and only a first-time setup INSERTs, which still requires a key.
--
-- Same checks as before: administrator only, international number format.
-- Safe to run more than once. Nothing is dropped or deleted.

create or replace function public.admin_set_sms_config(p_api_key text, p_from_number text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_key  text := nullif(btrim(coalesce(p_api_key, '')), '');
  v_from text := regexp_replace(coalesce(p_from_number, ''), '[^0-9+]', '', 'g');
begin
  if not private.is_admin() then
    raise exception 'Only the administrator can set up SMS' using errcode = '42501';
  end if;
  if v_from !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Enter the sending phone number in international format, e.g. +233241234567'
      using errcode = '22023';
  end if;

  update public.sms_config
     set api_key     = coalesce(v_key, api_key),
         from_number = v_from,
         updated_at  = now(),
         updated_by  = auth.uid()
   where id = 1;
  if found then return; end if;

  if v_key is null then
    raise exception 'Enter the httpSMS API key' using errcode = '22023';
  end if;
  insert into public.sms_config (id, api_key, from_number, updated_at, updated_by)
  values (1, v_key, v_from, now(), auth.uid());
end;
$$;
