// /api/varsler
//   GET  ?nokkel=1                              → { publicKey }  (VAPID, for å slå på varsler)
//   POST { handling:"test" }  (paret enhet)     → { sendt }      prøvevarsel til denne enheten
//   POST { handling:"gjort"|"kjorer", token }   → { ok }         knappene i varselet (Android)
import { hvemSpør, admin } from '../lib/supabase.mjs';
import { serverSecrets, lesSignert, send } from '../lib/push.mjs';
import { serviceAccount, settSjåfør } from '../lib/google.mjs';

export const config = { path: '/api/varsler' };
function json(status, body){
  return new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}});
}
function feil(status, kode, melding){ return json(status, {feil:kode, melding}); }

export default async function handler(req){
  try {
    if (req.method === 'GET'){
      const {vapid} = await serverSecrets();
      return json(200, {publicKey:vapid.publicKey});
    }
    if (req.method !== 'POST') return feil(405, 'metode', 'Bare GET og POST.');
    const b = await req.json().catch(() => null);
    if (!b) return feil(400, 'ugyldig', 'Mangler innhold.');

    if (b.handling === 'test'){
      const who = await hvemSpør(req);
      if (!who) return feil(401, 'ikke_paret', 'Denne enheten er ikke koblet til familien.');
      const subs = await admin('push_subscriptions?select=endpoint,p256dh,auth,phone&user_id=eq.' + who.uid);
      const sendt = await send(subs, () => ({title:'Prøvevarsel', body:'Varsler fra familiekalenderen virker på denne mobilen.', tag:'test', url:'/'}));
      return json(200, {sendt});
    }

    if (b.handling === 'gjort' || b.handling === 'kjorer'){
      const {hmac} = await serverSecrets();
      const d = lesSignert(hmac, b.token);
      if (!d || d.a !== b.handling) return feil(403, 'ugyldig_knapp', 'Knappen er for gammel eller ugyldig. Åpne appen.');
      if (d.a === 'gjort'){
        await admin('completions?on_conflict=household_id,task_key', {method:'POST', prefer:'resolution=merge-duplicates,return=minimal',
          body:{household_id:d.h, task_key:d.k, done_by:d.m || null, done_at:new Date().toISOString()}});
      } else {
        const m = (await admin('members?select=name&id=eq.' + d.m + '&household_id=eq.' + d.h))[0];
        if (!m) return feil(404, 'ukjent', 'Fant ikke personen.');
        await admin('rides?on_conflict=household_id,event_id', {method:'POST', prefer:'resolution=merge-duplicates,return=minimal',
          body:{household_id:d.h, event_id:d.e, value:m.name, updated_at:new Date().toISOString()}});
        const s = (await admin('household_settings?select=gcal_calendar_id&household_id=eq.' + d.h))[0];
        const sa = serviceAccount();
        if (s && s.gcal_calendar_id && sa) await settSjåfør(sa, s.gcal_calendar_id, d.e, m.name).catch(e => console.warn('[varsler] sjåfør i Google', e.message));
      }
      return json(200, {ok:true});
    }
    return feil(400, 'ukjent_handling', 'Ukjent handling.');
  } catch (e){
    console.error('[varsler]', e);
    return feil(e.status || 500, e.kode || 'feil', String(e.message || e));
  }
}
