-- Ord i tittelen som peker på en person når avtalen mangler kode («Heimdal», «håndball», «Spond» → Oliver)
alter table public.members add column if not exists title_words text not null default '';
-- Avtaler fra Google som skjules fordi appen viser dem som faste oppgaver («Ansvarlig middag», «Bytte sengetøy»)
alter table public.household_settings add column if not exists hide_words text not null default '';
