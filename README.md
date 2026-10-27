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

## Status

Fase 1 pågår. `site/index.html` er foreløpig den klikkbare prototypen med eksempeldata. Neste steg er paring med kode og ekte data fra Supabase.
