// Web push: nøkler (lages første gang og lagres i Supabase), signerte knapper og utsending.
import crypto from 'node:crypto';
import webpush from 'web-push';
import { admin } from './supabase.mjs';

export const SITE = 'https://familiekalender-np.netlify.app';
let cache = null;

export async function serverSecrets(){
  if (cache) return cache;
  const les = async () => Object.fromEntries((await admin('server_secrets?select=name,value&name=in.(vapid,hmac)')).map(r => [r.name, r.value]));
  let have = await les();
  const nye = [];
  if (!have.vapid) nye.push({name:'vapid', value:JSON.stringify(webpush.generateVAPIDKeys())});
  if (!have.hmac) nye.push({name:'hmac', value:crypto.randomBytes(32).toString('base64url')});
  if (nye.length){
    await admin('server_secrets?on_conflict=name', {method:'POST', body:nye, prefer:'resolution=ignore-duplicates,return=minimal'});
    have = await les();   // to samtidige førstegangskjøringer: bruk den som faktisk ble lagret
  }
  cache = {vapid:JSON.parse(have.vapid), hmac:have.hmac};
  return cache;
}

// «Gjort» / «Jeg kjører» i varselet: signert, så knappen bare kan gjøre akkurat den ene tingen
export function signer(hmac, data){
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', hmac).update(body).digest('base64url');
}
export function lesSignert(hmac, token){
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = Buffer.from(crypto.createHmac('sha256', hmac).update(body).digest('base64url'));
  const got = Buffer.from(sig);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return d.exp && d.exp > Date.now() ? d : null;
  } catch { return null; }
}

// Sender til abonnementene; døde abonnement (mobilen har slått av) fjernes
export async function send(subs, lagPayload){
  const {vapid} = await serverSecrets();
  webpush.setVapidDetails(SITE, vapid.publicKey, vapid.privateKey);
  let sendt = 0;
  for (const s of subs){
    try {
      await webpush.sendNotification({endpoint:s.endpoint, keys:{p256dh:s.p256dh, auth:s.auth}}, JSON.stringify(lagPayload(s)), {TTL:4 * 3600, urgency:'high'});
      sendt++;
      admin('push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), {method:'PATCH', body:{last_ok_at:new Date().toISOString()}, prefer:'return=minimal'}).catch(() => {});
    } catch (e){
      if (e.statusCode === 404 || e.statusCode === 410){
        await admin('push_subscriptions?endpoint=eq.' + encodeURIComponent(s.endpoint), {method:'DELETE', prefer:'return=minimal'}).catch(() => {});
      } else console.error('[push]', e.statusCode || '', e.body || e.message);
    }
  }
  return sendt;
}
