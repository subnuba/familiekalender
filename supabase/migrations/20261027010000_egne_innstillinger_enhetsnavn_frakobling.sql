-- Fase 1, del 2: egne valg for barna, navn på enheter og «Koble fra denne enheten».

-- Hver person kan endre sine egne valg (startvisning, varsler, telefontype) fra sin egen enhet,
-- også barna, som ellers ikke kan endre oppsettet til familien.
create or replace function public.update_my_prefs(
  p_start_view text default null,
  p_notif_on boolean default null,
  p_notif_time time default null,
  p_phone text default null
) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_member uuid;
begin
  select member_id into v_member from public.household_users where user_id = (select auth.uid());
  if v_member is null then raise exception 'Denne enheten er ikke knyttet til en person' using errcode = '42501'; end if;
  if p_start_view is not null and p_start_view not in ('family','me') then raise exception 'Ugyldig startvisning' using errcode = '22023'; end if;
  if p_phone is not null and p_phone not in ('android','iphone') then raise exception 'Ugyldig telefontype' using errcode = '22023'; end if;
  update public.members set
    start_view = coalesce(p_start_view, start_view),
    notif_on   = coalesce(p_notif_on, notif_on),
    notif_time = coalesce(p_notif_time, notif_time),
    phone      = coalesce(p_phone, phone)
  where id = v_member;
end $$;

-- Paring som også lagrer et navn på enheten («iPhone · Safari»), så de voksne ser hvilke enheter som er koblet til.
create or replace function public.redeem_pairing_code(p_code text, p_label text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  v_label text := left(coalesce(p_label, ''), 60);
  r public.pairing_codes%rowtype;
begin
  if v_uid is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  select * into r from public.pairing_codes where code = v_code for update;
  if not found or r.used_at is not null or r.expires_at < now() then
    raise exception 'Koden er ugyldig eller utløpt. Lag en ny kode.' using errcode = '22023';
  end if;
  insert into public.household_users(user_id, household_id, member_id, role, device_label)
  values (v_uid, r.household_id, r.member_id, r.role, v_label)
  on conflict (user_id) do update set household_id = excluded.household_id, member_id = excluded.member_id,
    role = excluded.role, device_label = excluded.device_label;
  update public.pairing_codes set used_at = now(), used_by = v_uid where code = v_code;
  return jsonb_build_object('household_id', r.household_id, 'member_id', r.member_id, 'role', r.role);
end $$;

revoke all on function public.update_my_prefs(text, boolean, time, text) from public, anon;
revoke all on function public.redeem_pairing_code(text, text) from public, anon;
grant execute on function public.update_my_prefs(text, boolean, time, text) to authenticated;
grant execute on function public.redeem_pairing_code(text, text) to authenticated;

-- En enhet kan alltid koble seg selv fra.
create policy "enhet kobler seg fra" on public.household_users
  for delete to authenticated using (user_id = (select auth.uid()));
