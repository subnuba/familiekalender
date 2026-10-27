-- «Hvem gjelder dette?»: valg gjort ved å trykke på en avtale. Lagres her, ikke i Google,
-- så Spond og andre som oppdaterer avtalene ikke overskriver det.
--   scope 'event' = bare denne avtalen (Google-ID for akkurat den forekomsten)
--   scope 'title' = alle avtaler med samme tittel (små bokstaver, enkle mellomrom)
create table public.event_owners (
  household_id uuid not null references public.households(id) on delete cascade,
  scope text not null check (scope in ('event','title')),
  match text not null check (length(match) between 1 and 1024),
  who jsonb not null check (who = '"all"'::jsonb or jsonb_typeof(who) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (household_id, scope, match)
);
alter table public.event_owners enable row level security;
create policy "familien leser hvem avtaler gjelder" on public.event_owners for select to authenticated using (household_id = (select private.my_household()));
create policy "familien setter hvem avtaler gjelder" on public.event_owners for insert to authenticated with check (household_id = (select private.my_household()));
create policy "familien endrer hvem avtaler gjelder" on public.event_owners for update to authenticated using (household_id = (select private.my_household())) with check (household_id = (select private.my_household()));
create policy "familien fjerner hvem avtaler gjelder" on public.event_owners for delete to authenticated using (household_id = (select private.my_household()));
alter publication supabase_realtime add table public.event_owners;
