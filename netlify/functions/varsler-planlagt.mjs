// Sender varsler som har forfalt. Kjøres av Netlify hvert 15. minutt (06–23).
// Regner ut med appens egen kode (netlify/lib/kjerne.mjs), så det som sendes er det samme som vises
// under Innstillinger → Varsler → «Varsler i dag». push_log hindrer at noe sendes to ganger.
import { admin, serverKey } from '../lib/supabase.mjs';
import { serviceAccount, hentAvtaler } from '../lib/google.mjs';
import { lastKjerne } from '../lib/kjerne.mjs';
import { serverSecrets, signer, send } from '../lib/push.mjs';

// Hvert 15. minutt, og ingenting om natta: gratisplanen på Netlify har en fast kvote for kjøretid.
export const config = { schedule: '*/15 * * * *' };
const VINDU = 30;            // minutter: tar igjen et varsel hvis en kjøring ble hoppet over
const GJORT = ['prep', 'chore', 'dinner', 'escalate'];

const pad = n => String(n).padStart(2, '0');
const isoDag = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const tilMin = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

export async function kjørFamilie(hh, nå){
  const subs = await admin('push_subscriptions?select=endpoint,member_id,p256dh,auth,phone&household_id=eq.' + hh);
  if (!subs.length) return {sendt:0, grunn:'ingen abonnement'};
  const dag = isoDag(nå);
  const fraDag = isoDag(new Date(nå.getFullYear(), nå.getMonth(), nå.getDate() - 2));
  const fraTid = new Date(nå.getTime() - 60 * 864e5).toISOString();
  const q = t => admin(t + (t.includes('?') ? '&' : '?') + 'household_id=eq.' + hh);
  const [members, chore_rules, prep_rules, settingsRows, dinners, completions, swaps, event_owners, rides] = await Promise.all([
    q('members?select=*'), q('chore_rules?select=*'), q('prep_rules?select=*'), q('household_settings?select=*'),
    q('dinners?select=*&day=gte.' + fraDag), q('completions?select=task_key&done_at=gte.' + encodeURIComponent(fraTid)),
    q('swaps?select=*'), q('event_owners?select=scope,match,who'), q('rides?select=event_id,value')
  ]);
  const settings = settingsRows[0] || null;
  let avtaler = [];
  const sa = serviceAccount();
  if (settings && settings.gcal_calendar_id && sa){
    try {
      const til = isoDag(new Date(nå.getFullYear(), nå.getMonth(), nå.getDate() + 9));
      avtaler = (await hentAvtaler(sa, settings.gcal_calendar_id, isoDag(new Date(nå.getFullYear(), nå.getMonth(), nå.getDate() - 1)), til)).avtaler;
    } catch (e){ console.warn('[varsler] Google', e.message); }   // oppgaver og middag sendes uansett
  }
  const api = lastKjerne();
  api.load({household:hh, members, chore_rules, prep_rules, settings, dinners, completions, swaps, event_owners, rides, avtaler});
  const nåMin = nå.getHours() * 60 + nå.getMinutes();
  const forfalt = api.notificationsFor(api.today()).filter(n => !n.done && tilMin(n.time) <= nåMin && tilMin(n.time) > nåMin - VINDU);
  if (!forfalt.length) return {sendt:0, grunn:'ingenting forfalt'};

  const {hmac} = await serverSecrets();
  let sendt = 0;
  for (const n of forfalt){
    const mine = subs.filter(s => s.member_id === n.who);
    if (!mine.length) continue;
    const nøkkel = [n.kind, n.key || n.rideKey || '', n.who, n.time].join('|');
    const ny = await admin('push_log?on_conflict=household_id,notif_key,sent_on', {method:'POST',
      body:{household_id:hh, notif_key:nøkkel, sent_on:dag}, prefer:'resolution=ignore-duplicates,return=representation'});
    if (!ny || !ny.length) continue;   // sendt før
    const exp = Date.now() + 36 * 3600e3;
    let actions = [], token = null;
    if (GJORT.includes(n.kind) && n.key){ actions = [{action:'gjort', title:'Gjort'}]; token = signer(hmac, {a:'gjort', h:hh, k:n.key, m:n.who, exp}); }
    else if (n.kind === 'ride' && n.rideKey){ actions = [{action:'kjorer', title:'Jeg kjører'}]; token = signer(hmac, {a:'kjorer', h:hh, e:n.rideKey.slice(n.rideKey.indexOf('|') + 1), m:n.who, exp}); }
    sendt += await send(mine, s => ({title:n.title, body:n.body, tag:nøkkel, url:'/', token, actions: s.phone === 'iphone' ? [] : actions}));
  }
  return {sendt};
}

export default async function handler(){
  if (!serverKey()){ console.warn('[varsler] SUPABASE_SERVICE_KEY mangler'); return; }
  process.env.TZ = 'Europe/Oslo';
  const nå = new Date();
  if (nå.getHours() < 6 || nå.getHours() >= 23) return;   // ingen varsler om natta (seneste er 22:00, morgenoversikten 07:00)
  const familier = await admin('households?select=id');
  for (const f of familier){
    try { console.log('[varsler]', f.id, JSON.stringify(await kjørFamilie(f.id, nå))); }
    catch (e){ console.error('[varsler]', f.id, e); }
  }
}
