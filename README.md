# Familiekalender

Familiekalender for nettbrettet på kjøkkenet og mobilene til familien Nervik Petersen.

- **Appen:** `site/` (HTML/JS, publiseres av Netlify på https://familiekalender-np.netlify.app)
- **Database og innlogging:** Supabase-prosjektet `wvpvaczktzbtdbfetepi` (Stockholm). Skjemaet ligger i `supabase/migrations/`.
- **Avtaler:** Google Kalender «Family» (kommer).
- **Kollektivtider:** Entur (AtB og tog).

## Publisering

Netlify bygger fra denne mappen ved hver push til `main`:

- Publish directory: `site`
- Build command: ingen

## Innlogging

Ingen passord. Hver enhet logger inn anonymt i Supabase og kobles til familien med en engangskode
(XXXX-XXXX, gyldig i 30 minutter) som lages under Innstillinger → Enheter på nettbrettet eller av en voksen.

- **Nettbrettet og de voksne** kan endre alt oppsett.
- **Barna** kan krysse av, bytte, sette middag og endre sine egne valg (startvisning, varsler), men ikke oppsettet.
- En voksen kan fjerne en enhet; den må da få ny kode.

## Status

Fase 1: ekte data fra Supabase med sanntid mellom enhetene, paring med kode, vær fra MET og avganger fra Entur.
Avtalene er fortsatt eksempler til Google Kalender «Family» er koblet til (neste steg).
