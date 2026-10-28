-- Vær per familie: stedet været hentes for ({name, lat, lon}). Tomt = været vises ikke.
-- Kollektivstrekningene ligger allerede i household_settings.transit.
alter table public.household_settings add column if not exists weather jsonb;

-- Familier som fantes før dette, beholder været de hadde (Heimdal)
update public.household_settings set weather = '{"name":"Heimdal","lat":63.35,"lon":10.36}'::jsonb where weather is null;
