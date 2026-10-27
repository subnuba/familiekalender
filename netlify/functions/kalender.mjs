// Familiekalender ↔ Google Kalender «Family».
// Leser avtaler og skriver sjåfør tilbake, med en tjenestekonto som kalenderen er delt med.
// Bare enheter som er paret med familien (Supabase-innlogging) får svar.
//
//   GET  /api/kalender?fra=2026-10-26&til=2026-11-30   → { kalender, avtaler: [...] }
//   POST /api/kalender  { handling: "sjåfør", id, sjåfør }  → { avtale }
//
// Miljøvariabel i Netlify: GOOGLE_SERVICE_ACCOUNT = hele JSON-nøkkelen til tjenestekontoen.
// Kalender-ID ligger i Supabase (household_settings.gcal_calendar_id).
import { hvemSpør } from '../lib/supabase.mjs';
import { serviceAccount, hentAvtaler, settSjåfør } from '../lib/google.mjs';
export { renTekst, tilAvtale, medSjåfør, kildeAv } from '../lib/google.mjs';
export { hvemSpør };

const MAX_DAYS = 120;
export const config = { path: '/api/kalender' };

function json(status, body){
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}});
}
function feil(status, kode, melding){ return json(status, {feil:kode, melding}); }
function gyldigDato(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); }

export default async function handler(req){
  try {
    const sa = serviceAccount();
    const who = await hvemSpør(req);
    if (!who) return feil(401, 'ikke_paret', 'Denne enheten er ikke koblet til familien.');
    if (!who.calendarId) return feil(409, 'ikke_satt_opp', 'Google Kalender er ikke koblet til ennå.');
    if (!sa) return feil(409, 'mangler_nokkel', 'Nøkkelen til Google mangler i Netlify (GOOGLE_SERVICE_ACCOUNT).');

    if (req.method === 'GET'){
      const u = new URL(req.url);
      const fra = u.searchParams.get('fra'), til = u.searchParams.get('til');
      if (!gyldigDato(fra) || !gyldigDato(til) || til <= fra) return feil(400, 'ugyldig', 'Bruk ?fra=ÅÅÅÅ-MM-DD&til=ÅÅÅÅ-MM-DD.');
      if ((Date.parse(til) - Date.parse(fra)) / 864e5 > MAX_DAYS) return feil(400, 'for_lang', 'Høyst ' + MAX_DAYS + ' dager om gangen.');
      const r = await hentAvtaler(sa, who.calendarId, fra, til);
      return json(200, {kalender:r.kalender, fra, til, hentet:new Date().toISOString(), avtaler:r.avtaler});
    }

    if (req.method === 'POST'){
      const b = await req.json().catch(() => null);
      if (!b || typeof b.id !== 'string' || !b.id || b.id.length > 1024) return feil(400, 'ugyldig', 'Mangler id.');
      if (b.handling === 'sjåfør'){
        const navn = typeof b.sjåfør === 'string' ? b.sjåfør.trim().slice(0, 60) : '';
        return json(200, {avtale: await settSjåfør(sa, who.calendarId, b.id, navn)});
      }
      return feil(400, 'ukjent_handling', 'Ukjent handling.');
    }
    return feil(405, 'metode', 'Bare GET og POST.');
  } catch (e){
    console.error('[kalender]', e);
    return feil(e.status || 500, e.kode || 'feil', e.kode === 'kalender_ikke_funnet' ? 'Finner ikke kalenderen eller avtalen. Er kalenderen delt med tjenestekontoen?' :
      e.kode === 'ingen_tilgang' ? 'Tjenestekontoen har ikke tilgang til kalenderen. Del den med «Gjøre endringer i aktiviteter».' : String(e.message || e));
  }
}
