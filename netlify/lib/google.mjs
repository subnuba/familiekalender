// Google Kalender via tjenestekonto (GOOGLE_SERVICE_ACCOUNT i Netlify).
import crypto from 'node:crypto';

export const TZ = 'Europe/Oslo';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
let tokenCache = null;

function b64url(x){ return Buffer.from(x).toString('base64url'); }
export function serviceAccount(){
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
export async function gcal(sa, method, path, body){
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
// Hvor avtalen kommer fra, f.eks. «spond» når Spond har lagt den inn. Brukes til å plassere avtaler uten kode.
export function kildeAv(e){
  const spor = [e.iCalUID, e.creator && e.creator.email, e.organizer && e.organizer.email, e.source && e.source.url,
    e.description, e.extendedProperties && JSON.stringify(e.extendedProperties)].filter(Boolean).join(' ').toLowerCase();
  if (spor.includes('spond')) return 'spond';
  return '';
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
    gjentas: !!e.recurringEventId,
    kilde: kildeAv(e)
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
export async function hentAvtaler(sa, calendarId, fra, til){
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
export async function settSjåfør(sa, calendarId, id, navn){
  const cal = encodeURIComponent(calendarId);
  const e = await gcal(sa, 'GET', 'calendars/' + cal + '/events/' + encodeURIComponent(id), null);
  const ny = await gcal(sa, 'PATCH', 'calendars/' + cal + '/events/' + encodeURIComponent(id), {description: medSjåfør(e.description, navn)});
  return tilAvtale(ny);
}
