-- Skyss per avtale (én forekomst): «Magne», «Buss» eller «Sitter på med Kari».
-- Lagres her i tillegg til «Sjåfør:»-linja i Google, så det ikke forsvinner om Spond oppdaterer avtalen.
create table public.rides (
  household_id uuid not null references public.households(id) on delete cascade,
  event_id text not null check (length(event_id) between 1 and 1024),
  value text not null check (length(value) <= 60),
  updated_at timestamptz not null default now(),
  primary key (household_id, event_id)
);
alter table public.rides enable row level security;
create policy "familien leser skyss" on public.rides for select to authenticated using (household_id = (select private.my_household()));
create policy "familien setter skyss" on public.rides for insert to authenticated with check (household_id = (select private.my_household()));
create policy "familien endrer skyss" on public.rides for update to authenticated using (household_id = (select private.my_household())) with check (household_id = (select private.my_household()));
create policy "familien fjerner skyss" on public.rides for delete to authenticated using (household_id = (select private.my_household()));
alter publication supabase_realtime add table public.rides;
