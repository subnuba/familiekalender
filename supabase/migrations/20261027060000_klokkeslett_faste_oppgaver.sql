-- Faste oppgaver kan ha et klokkeslett («Ta ut søppel kl. 07:00»). Tom = hele dagen.
-- Middagsansvar bruker middagstiden fra middagsplanen, ikke denne.
alter table public.chore_rules add column if not exists at_time time;
