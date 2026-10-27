-- Familiekalender: grunnmur. Alt er knyttet til en husstand, og bare enheter som er paret med husstanden får se eller endre noe.
-- Kjørt mot Supabase-prosjektet wvpvaczktzbtdbfetepi (eu-north-1) 27.10.2026.

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null,
  color text not null default 'blue',
  is_kid boolean not null default false,
  gcal_code text not null default '',
  gcal_alias text not null default '',
  sort_order int not null default 0,
  phone text not null default 'android' check (phone in ('android','iphone')),
  start_view text not null default 'family' check (start_view in ('family','me')),
  notif_on boolean not null default true,
  notif_time time not null default '20:00',
  created_at timestamptz not null default now()
);
create index members_household_idx on public.members(household_id);

-- Hvilke innloggede enheter hører til hvilken husstand og person. Nettbrettet har rollen 'tablet' og ingen person.
create table public.household_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  role text not null check (role in ('adult','kid','tablet')),
  device_label text not null default '',
  created_at timestamptz not null default now()
);
create index household_users_household_idx on public.household_users(household_id);
create index household_users_member_idx on public.household_users(member_id);

create table public.pairing_codes (
  code text primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid references public.members(id) on delete cascade,
  role text not null check (role in ('adult','kid','tablet')),
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);
create index pairing_codes_household_idx on public.pairing_codes(household_id);
create index pairing_codes_member_idx on public.pairing_codes(member_id);
create index pairing_codes_created_by_idx on public.pairing_codes(created_by);
create index pairing_codes_used_by_idx on public.pairing_codes(used_by);

create table public.household_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  gcal_calendar_id text,
  default_dinner_time time not null default '17:30',
  prep_fallback boolean not null default true,
  notif jsonb not null default '{"prep":true,"chores":true,"dinner":true,"dinnerLead":60,"ride":true,"morning":false,"escalate":false}',
  transit jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Faste oppgaver. who = "all" eller liste med member-id. history = tidligere oppsett, så endringer gjelder fra valid_from.
create table public.chore_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null default '',
  who jsonb not null default '"all"',
  mode text not null default 'each' check (mode in ('each','rotate')),
  days int[] not null default '{}',
  freq text not null default 'weekly' check (freq in ('weekly','biweekly')),
  anchor date not null default current_date,
  is_dinner boolean not null default false,
  valid_from date not null default '2000-01-01',
  ended date,
  history jsonb not null default '[]',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index chore_rules_household_idx on public.chore_rules(household_id);

-- Forberedelser. who = "all", "kids" eller liste med member-id.
create table public.prep_rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null default '',
  words text not null default '',
  who jsonb not null default '"all"',
  day_offset int not null default 1 check (day_offset in (0,1,2,3,7)),
  pack boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index prep_rules_household_idx on public.prep_rules(household_id);

-- Middagsplan per dato. Tom rett = bevisst tømt.
create table public.dinners (
  household_id uuid not null references public.households(id) on delete cascade,
  day date not null,
  dish text not null default '',
  at_time time not null default '17:30',
  updated_at timestamptz not null default now(),
  primary key (household_id, day)
);

-- Avkrysninger (faste oppgaver og forberedelser), med samme nøkler som appen bruker.
create table public.completions (
  household_id uuid not null references public.households(id) on delete cascade,
  task_key text not null,
  done_by uuid references public.members(id) on delete set null,
  done_at timestamptz not null default now(),
  primary key (household_id, task_key)
);
create index completions_done_by_idx on public.completions(done_by);

-- Engangsbytter av oppgaver («Bytt»).
create table public.swaps (
  household_id uuid not null references public.households(id) on delete cascade,
  task_key text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  primary key (household_id, task_key)
);
create index swaps_member_idx on public.swaps(member_id);

-- Hjelpefunksjoner for tilgang, i et skjema som ikke er åpent mot nettet
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

create or replace function private.my_household() returns uuid
language sql stable security definer set search_path = ''
as $$ select household_id from public.household_users where user_id = (select auth.uid()) $$;

create or replace function private.can_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select role in ('adult','tablet') from public.household_users where user_id = (select auth.uid())), false) $$;

revoke all on function private.my_household() from public, anon;
revoke all on function private.can_admin() from public, anon;
grant execute on function private.my_household() to authenticated, service_role;
grant execute on function private.can_admin() to authenticated, service_role;

-- Slå på RLS overalt
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.household_users enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.household_settings enable row level security;
alter table public.chore_rules enable row level security;
alter table public.prep_rules enable row level security;
alter table public.dinners enable row level security;
alter table public.completions enable row level security;
alter table public.swaps enable row level security;

-- Husstand: alle i familien leser, voksne/nettbrett endrer navn
create policy "les egen husstand" on public.households for select to authenticated using (id = (select private.my_household()));
create policy "voksne endrer husstand" on public.households for update to authenticated using (id = (select private.my_household()) and (select private.can_admin())) with check (id = (select private.my_household()));

-- Oppsett som bare voksne og nettbrettet endrer: medlemmer, innstillinger, faste oppgaver, forberedelser
create policy "les medlemmer" on public.members for select to authenticated using (household_id = (select private.my_household()));
create policy "voksne legger til medlemmer" on public.members for insert to authenticated with check (household_id = (select private.my_household()) and (select private.can_admin()));
create policy "voksne endrer medlemmer" on public.members for update to authenticated using (household_id = (select private.my_household()) and (select private.can_admin())) with check (household_id = (select private.my_household()));
create policy "voksne sletter medlemmer" on public.members for delete to authenticated using (household_id = (select private.my_household()) and (select private.can_admin()));

create policy "les innstillinger" on public.household_settings for select to authenticated using (household_id = (select private.my_household()));
create policy "voksne endrer innstillinger" on public.household_settings for update to authenticated using (household_id = (select private.my_household()) and (select private.can_admin())) with check (household_id = (select private.my_household()));

create policy "les faste oppgaver" on public.chore_rules for select to authenticated using (household_id = (select private.my_household()));
create policy "voksne legger til faste oppgaver" on public.chore_rules for insert to authenticated with check (household_id = (select private.my_household()) and (select private.can_admin()));
create policy "voksne endrer faste oppgaver" on public.chore_rules for update to authenticated using (household_id = (select private.my_household()) and (select private.can_admin())) with check (household_id = (select private.my_household()));
create policy "voksne sletter faste oppgaver" on public.chore_rules for delete to authenticated using (household_id = (select private.my_household()) and (select private.can_admin()));

create policy "les forberedelser" on public.prep_rules for select to authenticated using (household_id = (select private.my_household()));
create policy "voksne legger til forberedelser" on public.prep_rules for insert to authenticated with check (household_id = (select private.my_household()) and (select private.can_admin()));
create policy "voksne endrer forberedelser" on public.prep_rules for update to authenticated using (household_id = (select private.my_household()) and (select private.can_admin())) with check (household_id = (select private.my_household()));
create policy "voksne sletter forberedelser" on public.prep_rules for delete to authenticated using (household_id = (select private.my_household()) and (select private.can_admin()));

-- Hverdagsting som alle i familien kan endre: middager, avkrysninger, bytter
create policy "familien leser middager" on public.dinners for select to authenticated using (household_id = (select private.my_household()));
create policy "familien legger inn middager" on public.dinners for insert to authenticated with check (household_id = (select private.my_household()));
create policy "familien endrer middager" on public.dinners for update to authenticated using (household_id = (select private.my_household())) with check (household_id = (select private.my_household()));
create policy "familien sletter middager" on public.dinners for delete to authenticated using (household_id = (select private.my_household()));

create policy "familien leser avkrysninger" on public.completions for select to authenticated using (household_id = (select private.my_household()));
create policy "familien krysser av" on public.completions for insert to authenticated with check (household_id = (select private.my_household()));
create policy "familien endrer avkrysninger" on public.completions for update to authenticated using (household_id = (select private.my_household())) with check (household_id = (select private.my_household()));
create policy "familien angrer avkrysninger" on public.completions for delete to authenticated using (household_id = (select private.my_household()));

create policy "familien leser bytter" on public.swaps for select to authenticated using (household_id = (select private.my_household()));
create policy "familien bytter" on public.swaps for insert to authenticated with check (household_id = (select private.my_household()));
create policy "familien endrer bytter" on public.swaps for update to authenticated using (household_id = (select private.my_household())) with check (household_id = (select private.my_household()));
create policy "familien angrer bytter" on public.swaps for delete to authenticated using (household_id = (select private.my_household()));

-- Enheter: familien ser hvilke enheter som er koblet til; voksne kan fjerne en enhet. Kobling skjer bare via koder.
create policy "familien ser enheter" on public.household_users for select to authenticated using (household_id = (select private.my_household()));
create policy "voksne fjerner enheter" on public.household_users for delete to authenticated using (household_id = (select private.my_household()) and (select private.can_admin()));

-- Koder: voksne ser og sletter koder for husstanden; de lages og brukes bare via funksjonene under
create policy "voksne ser koder" on public.pairing_codes for select to authenticated using (household_id = (select private.my_household()) and (select private.can_admin()));
create policy "voksne sletter koder" on public.pairing_codes for delete to authenticated using (household_id = (select private.my_household()) and (select private.can_admin()));

-- Lag en paringskode for et familiemedlem (eller for et nettbrett når member er null). Gyldig i 30 minutter.
create or replace function public.create_pairing_code(p_member uuid default null)
returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_household uuid := private.my_household();
  v_role text;
  v_kid boolean;
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text := '';
  i int;
begin
  if v_household is null or not private.can_admin() then
    raise exception 'Bare voksne og nettbrettet kan lage koder' using errcode = '42501';
  end if;
  if p_member is null then
    v_role := 'tablet';
  else
    select is_kid into v_kid from public.members where id = p_member and household_id = v_household;
    if not found then raise exception 'Ukjent familiemedlem' using errcode = '22023'; end if;
    v_role := case when v_kid then 'kid' else 'adult' end;
  end if;
  v_bytes := extensions.gen_random_bytes(8);
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  insert into public.pairing_codes(code, household_id, member_id, role, created_by, expires_at)
  values (v_code, v_household, p_member, v_role, auth.uid(), now() + interval '30 minutes');
  return substr(v_code,1,4) || '-' || substr(v_code,5,4);
end $$;

-- Bruk en kode: kobler den innloggede enheten til husstanden og personen.
create or replace function public.redeem_pairing_code(p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  r public.pairing_codes%rowtype;
begin
  if v_uid is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  select * into r from public.pairing_codes where code = v_code for update;
  if not found or r.used_at is not null or r.expires_at < now() then
    raise exception 'Koden er ugyldig eller utløpt. Lag en ny kode.' using errcode = '22023';
  end if;
  insert into public.household_users(user_id, household_id, member_id, role)
  values (v_uid, r.household_id, r.member_id, r.role)
  on conflict (user_id) do update set household_id = excluded.household_id, member_id = excluded.member_id, role = excluded.role;
  update public.pairing_codes set used_at = now(), used_by = v_uid where code = v_code;
  return jsonb_build_object('household_id', r.household_id, 'member_id', r.member_id, 'role', r.role);
end $$;

revoke all on function public.create_pairing_code(uuid) from public, anon;
revoke all on function public.redeem_pairing_code(text) from public, anon;
grant execute on function public.create_pairing_code(uuid) to authenticated;
grant execute on function public.redeem_pairing_code(text) to authenticated;

-- Sanntid: endringer vises på alle enheter med en gang
alter publication supabase_realtime add table public.members, public.household_settings, public.chore_rules, public.prep_rules, public.dinners, public.completions, public.swaps;
