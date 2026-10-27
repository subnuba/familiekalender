-- Web push: abonnement per enhet (mobil), logg over sendte varsler og serverhemmeligheter.

-- Én rad per mobil/nettleser som har slått på varsler. Knyttet til personen enheten er paret som.
create table public.push_subscriptions (
  endpoint text primary key check (length(endpoint) between 10 and 2000),
  household_id uuid not null references public.households(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  phone text not null default 'android' check (phone in ('android','iphone')),
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
create index push_subscriptions_household_idx on public.push_subscriptions(household_id);
create index push_subscriptions_member_idx on public.push_subscriptions(member_id);
create index push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
-- Familien ser hvem som har varsler på (for statusen i innstillingene); endres bare via funksjonene under.
create policy "familien ser varselabonnement" on public.push_subscriptions for select to authenticated
  using (household_id = (select private.my_household()));

-- Hindrer at samme varsel sendes to ganger samme dag. Bare serveren bruker den.
create table public.push_log (
  household_id uuid not null references public.households(id) on delete cascade,
  notif_key text not null,
  sent_on date not null,
  sent_at timestamptz not null default now(),
  primary key (household_id, notif_key, sent_on)
);
alter table public.push_log enable row level security;

-- Nøkler serveren lager selv (VAPID for web push, signatur for «Gjort»-knappen). Ingen tilgang utenfra.
create table public.server_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.server_secrets enable row level security;

-- Lagre abonnementet for denne enheten (personen hentes fra paringen, ikke fra klienten)
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_phone text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  hu public.household_users%rowtype;
begin
  select * into hu from public.household_users where user_id = (select auth.uid());
  if hu.user_id is null or hu.member_id is null then
    raise exception 'Varsler kan bare slås på på en enhet som tilhører en person' using errcode = '42501';
  end if;
  if p_phone not in ('android','iphone') then raise exception 'Ugyldig telefontype' using errcode = '22023'; end if;
  insert into public.push_subscriptions(endpoint, household_id, member_id, user_id, p256dh, auth, phone)
  values (p_endpoint, hu.household_id, hu.member_id, hu.user_id, p_p256dh, p_auth, p_phone)
  on conflict (endpoint) do update set household_id = excluded.household_id, member_id = excluded.member_id,
    user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, phone = excluded.phone;
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid());
end $$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;

alter publication supabase_realtime add table public.push_subscriptions;
