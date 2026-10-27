// Supabase fra Netlify-funksjonene: som enheten (med dens økt) eller som server (hemmelig nøkkel).
export const SUPABASE_URL = 'https://wvpvaczktzbtdbfetepi.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Zx7NYqNzMzP1-IjtsIda4A_DZ3KjnZm';

function jwtSub(token){
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub || null; } catch { return null; }
}
async function asUser(path, auth){
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {headers:{apikey:SUPABASE_KEY, Authorization:auth, Accept:'application/json'}});
  if (!res.ok) return {ok:false, status:res.status};
  return {ok:true, data: await res.json()};
}
// Hvem spør? PostgREST sjekker signaturen på tokenet; uten gyldig token blir svaret 401.
export async function hvemSpør(req){
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer \S+$/.test(auth)) return null;
  const uid = jwtSub(auth.slice(7));
  if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) return null;
  const me = await asUser('household_users?select=household_id,role,member_id&user_id=eq.' + uid, auth);
  if (!me.ok || !me.data.length) return null;
  const hh = me.data[0].household_id;
  const s = await asUser('household_settings?select=gcal_calendar_id&household_id=eq.' + hh, auth);
  return {uid, household:hh, role:me.data[0].role, member:me.data[0].member_id, calendarId: s.ok && s.data[0] ? s.data[0].gcal_calendar_id : null};
}

// Som server: bare i Netlify-funksjoner, med SUPABASE_SERVICE_KEY (hemmelig, aldri i nettleseren)
export function serverKey(){ return process.env.SUPABASE_SERVICE_KEY || ''; }
export async function admin(path, {method = 'GET', body, prefer} = {}){
  const key = serverKey();
  if (!key) throw Object.assign(new Error('SUPABASE_SERVICE_KEY mangler i Netlify.'), {kode:'mangler_servernokkel', status:409});
  const headers = {apikey:key, Accept:'application/json'};
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;   // gammel service_role-nøkkel
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {method, headers, body: body !== undefined ? JSON.stringify(body) : undefined});
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error('Supabase ' + res.status + ': ' + (data && (data.message || data.hint) || text)), {status:502, kode:'supabase'});
  return data;
}
