// Familiekalender ↔ Google Kalender «Family».
// Leser avtaler og skriver sjåfør tilbake, med en tjenestekonto som kalenderen er delt med.
// Bare enheter som er paret med familien (Supabase-innlogging) får svar.
//
//   GET  /api/kalender?fra=2026-10-26&til=2026-11-30   → { kalender, avtaler: [...] }
//   POST /api/kalender  { handling: "sjåfør", id, sjåfør }  → { avtale }
//
// Miljøvariabel i Netlify: GOOGLE_SERVICE_ACCOUNT = hele JSON-nøkkelen til tjenestekontoen.
// Kalender-ID ligger i Supabase (household_settings.gcal_calendar_id).
import crypto from 'node:crypto';

const SUPABASE_URL = 'https://wvpvaczktzbtdbfetepi.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Zx7NYqNzMzP1-IjtsIda4A_DZ3KjnZm';
const TZ = 'Europe/Oslo';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const MAX_DAYS = 120;

export const config = { path: '/api/kalender' };

// ---------- Svar ----------
function json(status, body){
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}});
}
function feil(status, kode, melding){ return json(status, {feil:kode, melding}); }

// ---------- Hvem spør? (Supabase-økten til enheten) ----------
function jwtSub(token){
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub || null; } catch { return null; }
}
async function supa(path, auth){
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {headers:{apikey:SUPABASE_KEY, Authorization:auth, Accept:'application/json'}});
  if (!res.ok) return {ok:false, status:res.status};
  return {ok:true, data: await res.json()};
}
// PostgREST sjekker signaturen på tokenet; uten gyldig token blir svaret 401.
export async function hvemSpør(req){
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return null;
  const uid = jwtSub(auth.slice(7));
  if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) return null;
  const me = await supa('household_users?select=household_id,role,member_id&user_id=eq.' + uid, auth);
  if (!me.ok || !me.data.length) return null;
  const hh = me.data[0].household_id;
  const s = await supa('household_settings?select=gcal_calendar_id&household_id=eq.' + hh, auth);
  return {uid, household:hh, role:me.data[0].role, member:me.data[0].member_id, calendarId: s.ok && s.data[0] ? s.data[0].gcal_calendar_id : null};
}

// ---------- Google ----------
let tokenCache = null;
function b64url(x){ return Buffer.from(x).toString('base64url'); }
function serviceAccount(){
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw);
    if (!sa.client_email || !sa.private_key) return null;
    sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    return sa;
  } catch { return null; }
}
async function googleToken(sa){
  if (tokenCache && tokenCache.email === sa.client_email && tokenCache.exp > Date.now() + 60000) return tokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({alg:'RS256', typ:'JWT'}));
  const claim = b64url(JSON.stringify({iss:sa.client_email, scope:SCOPE, aud:'https://oauth2.googleapis.com/token', iat:now, exp:now + 3600}));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + b64url(sig)})
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw Object.assign(new Error('Google-innlogging feilet: ' + (body.error_description || body.error || res.status)), {status:502, kode:'google_innlogging'});
  tokenCache = {email:sa.client_email, token:body.access_token, exp:Date.now() + (body.expires_in || 3600) * 1000};
  return tokenCache.token;
}
async function gcal(sa, method, path, body){
  const token = await googleToken(sa);
  const res = await fetch('https://www.googleapis.com/calendar/v3/' + path, {
    method, headers:{Authorization:'Bearer ' + token, 'Content-Type':'application/json'}, body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok){
    const msg = (data.error && data.error.message) || ('HTTP ' + res.status);
    const kode = res.status === 404 ? 'kalender_ikke_funnet' : res.status === 403 ? 'ingen_tilgang' : 'google';
    throw Object.assign(new Error(msg), {status:502, kode});
  }
  return data;
}

// ---------- Avtaler ----------
// Beskrivelser redigert i Google Kalender på nett kan inneholde HTML. Appen vil ha ren tekst.
export function renTekst(s){
  if (!s) return '';
  if (!/[<&]/.test(s)) return s;
  return s
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}
export function tilAvtale(e){
  return {
    id: e.id,
    tittel: e.summary || '(uten tittel)',
    heleDagen: !!(e.start && e.start.date),
    start: e.start ? (e.start.dateTime || e.start.date) : null,
    slutt: e.end ? (e.end.dateTime || e.end.date) : null,
    sted: e.location || '',
    beskrivelse: renTekst(e.description || ''),
    gjentas: !!e.recurringEventId
  };
}
// «Sjåfør: …»-linja byttes eller legges til; resten av beskrivelsen står urørt.
export function medSjåfør(beskrivelse, navn){
  const linjer = renTekst(beskrivelse || '').split('\n');
  const i = linjer.findIndex(l => /^\s*(sjåfør|sjafør|sjafor|skyss|kjører)\s*:/i.test(l));
  const ny = navn ? 'Sjåfør: ' + navn : null;
  if (i > -1){ if (ny) linjer[i] = ny; else linjer.splice(i, 1); }
  else if (ny) linjer.unshift(ny);
  return linjer.join('\n').replace(/^\n+|\n+$/g, '');
}
function gyldigDato(s){ return /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s + 'T00:00:00Z')); }

async function hentAvtaler(sa, calendarId, fra, til){
  const avtaler = [];
  let pageToken = '';
  let navn = null;
  for (let side = 0; side < 10; side++){
    const q = new URLSearchParams({
      // Litt romslig i begge ender (tidssoner); appen sorterer på lokal dato selv
      timeMin: new Date(Date.parse(fra + 'T00:00:00Z') - 864e5).toISOString(),
      timeMax: new Date(Date.parse(til + 'T00:00:00Z') + 864e5).toISOString(),
      singleEvents:'true', orderBy:'startTime', maxResults:'2500', timeZone:TZ, showDeleted:'false'
    });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await gcal(sa, 'GET', 'calendars/' + encodeURIComponent(calendarId) + '/events?' + q, null);
    navn = navn || data.summary || null;
    (data.items || []).forEach(e => { if (e.status !== 'cancelled') avtaler.push(tilAvtale(e)); });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return {kalender:navn, avtaler};
}

export default async function handler(req){
  try {
    const sa = serviceAccount();
    const who = await hvemSpør(req);
    if (!who) return feil(401, 'ikke_paret', 'Denne enheten er ikke koblet til familien.');
    if (!who.calendarId) return feil(409, 'ikke_satt_opp', 'Google Kalender er ikke koblet til ennå.');
    if (!sa) return feil(409, 'mangler_nokkel', 'Nøkkelen til Google mangler i Netlify (GOOGLE_SERVICE_ACCOUNT).');
    const cal = encodeURIComponent(who.calendarId);

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
        const navn = typeof b.sjåfør === 'string' ? b.sjåfør.trim().slice(0, 40) : '';
        const e = await gcal(sa, 'GET', 'calendars/' + cal + '/events/' + encodeURIComponent(b.id), null);
        const ny = await gcal(sa, 'PATCH', 'calendars/' + cal + '/events/' + encodeURIComponent(b.id), {description: medSjåfør(e.description, navn)});
        return json(200, {avtale: tilAvtale(ny)});
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
