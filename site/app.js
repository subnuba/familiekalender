(function(){
  'use strict';

  /* ---------- Farger og familiemedlemmer ---------- */
  var PALETTE = [
    {k:'blue',n:'Blå'},{k:'red',n:'Tyttebær'},{k:'green',n:'Grønn'},{k:'amber',n:'Rav'},
    {k:'purple',n:'Lilla'},{k:'teal',n:'Turkis'},{k:'pink',n:'Rosa'},{k:'olive',n:'Oliven'},
    {k:'brown',n:'Brun'},{k:'slate',n:'Skifer'},{k:'coral',n:'Korall'},{k:'navy',n:'Marine'}
  ];
  var MAX_MEMBERS = 6;
  var COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);   // berøringsskjerm
  var WD_LONG = ['mandag','tirsdag','onsdag','torsdag','fredag','lørdag','søndag'];
  var WD_SHORT = ['Ma','Ti','On','To','Fr','Lø','Sø'];

  /* ---------- Hjelpere ---------- */
  function $(id){ return document.getElementById(id); }
  function clone(x){ return JSON.parse(JSON.stringify(x)); }
  function pad(n){ return String(n).padStart(2,'0'); }
  function startOfDay(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function addDays(d,n){ var x = new Date(d); x.setDate(x.getDate()+n); return x; }
  function iso(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function fromIso(s){ var p = s.split('-').map(Number); return new Date(p[0], p[1]-1, p[2]); }
  function wd(d){ return (d.getDay()+6)%7; }
  function mondayOf(d){ return addDays(startOfDay(d), -wd(d)); }
  function toMin(s){ var p = s.split(':').map(Number); return p[0]*60+p[1]; }
  function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
  function today(){ return startOfDay(new Date()); }
  function isToday(d){ return iso(d) === iso(new Date()); }
  function dayName(d){ return cap(d.toLocaleDateString('nb-NO',{weekday:'long'})); }
  function dateLong(d){ return d.toLocaleDateString('nb-NO',{day:'numeric', month:'long'}); }
  function dateShort(d){ return d.toLocaleDateString('nb-NO',{day:'numeric', month:'short'}); }
  function nowMin(){ var n = new Date(); return n.getHours()*60+n.getMinutes(); }
  function hhmm(d){ return pad(d.getHours())+':'+pad(d.getMinutes()); }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function dayDiff(d){ return Math.round((startOfDay(d) - today())/864e5); }
  function weeksBetween(a,d){ return Math.round((mondayOf(d) - mondayOf(a))/(7*864e5)); }
  function isoWeek(d){
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1));
    return Math.ceil(((t - y0)/864e5 + 1)/7);
  }
  function weekLabel(d){ return 'Uke '+pad(isoWeek(d)); }
  function rel(mins){
    if (mins < 60) return 'om '+mins+' min';
    var h = Math.floor(mins/60), m = mins%60;
    return m ? 'om '+h+' t '+m+' min' : 'om '+h+' t';
  }
  function joinNo(list){ return list.length > 1 ? list.slice(0,-1).join(', ')+' og '+list[list.length-1] : (list[0] || ''); }
  function hash(s){ var h = 0; for (var i=0;i<s.length;i++){ h = (h*31 + s.charCodeAt(i)) | 0; } return Math.abs(h); }

  /* ---------- Database (Supabase) ---------- */
  // All familiedata ligger i Supabase. Appen holder en lokal kopi i de samme strukturene som prototypen,
  // skriver endringer tilbake (litt forsinket for tekstfelt) og henter på nytt når en annen enhet endrer noe.
  var CFG = window.FK_CONFIG || {};
  var sb = (window.supabase && CFG.supabaseUrl)
    ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false}})
    : null;
  var DB = {household:null, role:null, myMember:null, uid:null, label:null, settings:null, channel:null, devices:null,
            known:{members:{}, rules:{}, preps:{}}, timers:{}, gen:{}, dirty:{}, pending:0};
  function canAdmin(){ return DB.role === 'adult' || DB.role === 'tablet'; }
  function newId(){
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){ var r = Math.random()*16|0; return (c === 'x' ? r : (r&3|8)).toString(16); });
  }
  function t5(s){ return s ? String(s).slice(0,5) : s; }
  function syncStatus(text, bad){
    var el = $('syncStatus'); if (!el) return;
    el.textContent = text || ''; el.classList.toggle('bad', !!bad);
  }
  function dbDone(p, what){
    DB.pending++; syncStatus('Lagrer …');
    return Promise.resolve(p).then(function(res){
      if (res && res.error) throw res.error;
      DB.pending--; if (!DB.pending) syncStatus('');
      return res;
    }).catch(function(err){
      DB.pending--;
      console.warn('[familiekalender] '+what, err);
      syncStatus('Kunne ikke lagre '+what+'. Sjekk nettet og prøv igjen.', true);
      return null;
    });
  }
  // Lagring venter litt (tekstfelt). Så lenge noe venter på å bli lagret, hentes ikke samme tabell på nytt,
  // ellers kunne en oppdatering fra en annen enhet (eller ekkoet av egen lagring) overskrive det som nettopp ble skrevet.
  var DIRTY_FOR = {members:['members','notif'], chore_rules:['rules'], prep_rules:['preps'], household_settings:['preps','notif']};
  function later(name, fn, ms){
    clearTimeout(DB.timers[name]);
    var gen = DB.gen[name] = (DB.gen[name] || 0) + 1;
    DB.dirty[name] = true;
    DB.timers[name] = setTimeout(function(){
      Promise.resolve(fn()).then(function(){ if (DB.gen[name] === gen) DB.dirty[name] = false; });
    }, ms == null ? 600 : ms);
  }
  function isDirty(t){ return (DIRTY_FOR[t] || []).some(function(n){ return DB.dirty[n]; }); }
  function reloadTable(t){
    clearTimeout(DB.timers['reload-'+t]);
    DB.timers['reload-'+t] = setTimeout(function(){
      if (isDirty(t)) return reloadTable(t);   // prøv igjen når egne endringer er lagret
      LOADERS[t]().then(afterRemoteChange, function(e){ console.warn('[familiekalender] '+t, e); });
    }, 400);
  }

  // Fra databasen til appens strukturer
  function bySort(a,b){ return (a.sort_order||0) - (b.sort_order||0); }
  function applyMembers(rows){
    rows = rows.slice().sort(bySort);
    members = rows.map(function(r){ return {id:r.id, name:r.name, color:r.color, kid:r.is_kid, code:r.gcal_code, alias:r.gcal_alias}; });
    DB.known.members = {};
    notif.people = {};
    rows.forEach(function(r){
      DB.known.members[r.id] = true;
      notif.people[r.id] = {on:r.notif_on, time:t5(r.notif_time), phone:r.phone, start:r.start_view};
    });
    syncMembers();
  }
  function applyRules(rows){
    rules = rows.slice().sort(bySort).map(function(r){
      return {id:r.id, title:r.title, who:r.who, mode:r.mode, days:r.days || [], freq:r.freq, anchor:r.anchor,
              dinner:r.is_dinner, from:r.valid_from, past:Array.isArray(r.history) ? r.history : [], ended:r.ended || undefined};
    });
    DB.known.rules = {}; rows.forEach(function(r){ DB.known.rules[r.id] = true; });
  }
  function applyPreps(rows){
    preps.rules = rows.slice().sort(bySort).map(function(r){ return {id:r.id, title:r.title, words:r.words, who:r.who, offset:r.day_offset, pack:r.pack}; });
    DB.known.preps = {}; rows.forEach(function(r){ DB.known.preps[r.id] = true; });
  }
  function applySettings(s){
    if (!s) return;
    DB.settings = s;
    preps.fallback = s.prep_fallback !== false;
    var n = s.notif || {};
    ['prep','chores','dinner','ride','morning','escalate'].forEach(function(k){ if (typeof n[k] === 'boolean') notif[k] = n[k]; });
    if (NOTIF_LEADS.indexOf(n.dinnerLead) > -1) notif.dinnerLead = n.dinnerLead;
    if (validTime(t5(s.default_dinner_time))) DEFAULT_TIME = t5(s.default_dinner_time);
    if (Array.isArray(s.transit) && s.transit.length) TRANSIT.routes = s.transit.map(function(r){ return Object.assign({lines:[]}, r); });
  }
  function applyDinners(rows){ dinnerEdits = {}; rows.forEach(function(r){ dinnerEdits[r.day] = {dish:r.dish, time:t5(r.at_time)}; }); }
  function applyCompletions(rows){ state.done = new Set(rows.map(function(r){ return r.task_key; })); }
  function applySwaps(rows){ state.swaps = {}; rows.forEach(function(r){ state.swaps[r.task_key] = r.member_id; }); }

  function q(p){ return p.then(function(res){ if (res.error) throw res.error; return res.data; }); }
  var LOADERS = {
    members: function(){ return q(sb.from('members').select('*').eq('household_id', DB.household)).then(applyMembers); },
    chore_rules: function(){ return q(sb.from('chore_rules').select('*').eq('household_id', DB.household)).then(applyRules); },
    prep_rules: function(){ return q(sb.from('prep_rules').select('*').eq('household_id', DB.household)).then(applyPreps); },
    household_settings: function(){ return q(sb.from('household_settings').select('*').eq('household_id', DB.household).maybeSingle()).then(applySettings); },
    dinners: function(){ return q(sb.from('dinners').select('*').eq('household_id', DB.household).gte('day', iso(addDays(today(), -60)))).then(applyDinners); },
    completions: function(){ return q(sb.from('completions').select('task_key').eq('household_id', DB.household).gte('done_at', addDays(today(), -60).toISOString())).then(applyCompletions); },
    swaps: function(){ return q(sb.from('swaps').select('*').eq('household_id', DB.household)).then(applySwaps); }
  };
  function loadAll(){
    // Medlemmer først: de andre tabellene viser til dem. Tabeller med endringer som ikke er lagret ennå, hoppes over.
    return (isDirty('members') ? Promise.resolve() : LOADERS.members()).then(function(){
      return Promise.all(Object.keys(LOADERS).filter(function(k){ return k !== 'members' && !isDirty(k); }).map(function(k){ return LOADERS[k](); }));
    });
  }
  function afterRemoteChange(){
    var a = document.activeElement;
    var typingInSettings = a && $('settings').contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
    if (!$('settings').hidden && !typingInSettings) renderSettings();
    if (!$('dinners').hidden && !state.dinnerEdit) renderDinnerList();
    render();
  }
  function subscribe(){
    if (DB.channel) sb.removeChannel(DB.channel);
    var ch = sb.channel('familie-'+DB.household);
    Object.keys(LOADERS).forEach(function(t){
      ch.on('postgres_changes', {event:'*', schema:'public', table:t, filter:'household_id=eq.'+DB.household}, function(){ reloadTable(t); });
    });
    ch.subscribe();
    DB.channel = ch;
  }

  // Skriving
  function saveMembersNow(){
    if (!canAdmin()) return;
    var rows = members.map(function(m, i){
      return {id:m.id, household_id:DB.household, name:m.name, color:m.color, is_kid:!!m.kid, gcal_code:normCode(m.code), gcal_alias:m.alias || '', sort_order:i};
    });
    var gone = Object.keys(DB.known.members).filter(function(id){ return !P[id]; });
    DB.known.members = {}; members.forEach(function(m){ DB.known.members[m.id] = true; });
    return dbDone(sb.from('members').upsert(rows), 'familiemedlemmene').then(function(){
      if (gone.length) return dbDone(sb.from('members').delete().in('id', gone), 'familiemedlemmene');
    });
  }
  function saveRulesNow(){
    if (!canAdmin()) return;
    var rows = rules.map(function(r, i){
      return {id:r.id, household_id:DB.household, title:r.title, who:r.who, mode:r.mode, days:r.days, freq:r.freq, anchor:r.anchor,
              is_dinner:!!r.dinner, valid_from:r.from || '2000-01-01', ended:r.ended || null, history:r.past || [], sort_order:i};
    });
    var ids = {}; rules.forEach(function(r){ ids[r.id] = true; });
    var gone = Object.keys(DB.known.rules).filter(function(id){ return !ids[id]; });
    DB.known.rules = ids;
    return dbDone(sb.from('chore_rules').upsert(rows), 'de faste oppgavene').then(function(){
      if (gone.length) return dbDone(sb.from('chore_rules').delete().in('id', gone), 'de faste oppgavene');
    });
  }
  function savePrepsNow(){
    if (!canAdmin()) return;
    var rows = preps.rules.map(function(r, i){
      return {id:r.id, household_id:DB.household, title:r.title, words:r.words, who:r.who, day_offset:r.offset, pack:!!r.pack, sort_order:i};
    });
    var ids = {}; preps.rules.forEach(function(r){ ids[r.id] = true; });
    var gone = Object.keys(DB.known.preps).filter(function(id){ return !ids[id]; });
    DB.known.preps = ids;
    return Promise.all([
      dbDone(sb.from('prep_rules').upsert(rows), 'forberedelsene').then(function(){
        if (gone.length) return dbDone(sb.from('prep_rules').delete().in('id', gone), 'forberedelsene');
      }),
      saveSettingsNow({prep_fallback:!!preps.fallback})
    ]);
  }
  function saveSettingsNow(fields){
    if (!canAdmin()) return;
    return dbDone(sb.from('household_settings').update(Object.assign({updated_at:new Date().toISOString()}, fields)).eq('household_id', DB.household), 'innstillingene');
  }
  function saveNotifNow(){
    if (canAdmin()){
      return Promise.all(members.map(function(m){
        var pn = personNotif(m.id);
        return dbDone(sb.from('members').update({notif_on:pn.on, notif_time:pn.time, phone:pn.phone, start_view:pn.start}).eq('id', m.id), 'varslene');
      }).concat([saveSettingsNow({notif:{prep:notif.prep, chores:notif.chores, dinner:notif.dinner, dinnerLead:notif.dinnerLead, ride:notif.ride, morning:notif.morning, escalate:notif.escalate}})]));
    } else if (DB.myMember){
      var pn = personNotif(DB.myMember);
      return dbDone(sb.rpc('update_my_prefs', {p_start_view:pn.start, p_notif_on:pn.on, p_notif_time:pn.time, p_phone:pn.phone}), 'valgene dine');
    }
  }
  function setDone(key, on){
    if (on) state.done.add(key); else state.done.delete(key);
    if (on) dbDone(sb.from('completions').upsert({household_id:DB.household, task_key:key, done_by:DB.myMember || null, done_at:new Date().toISOString()}), 'avkrysningen');
    else dbDone(sb.from('completions').delete().eq('household_id', DB.household).eq('task_key', key), 'avkrysningen');
  }
  function setSwap(key, who){
    if (who){
      state.swaps[key] = who;
      dbDone(sb.from('swaps').upsert({household_id:DB.household, task_key:key, member_id:who}), 'byttet');
    } else {
      delete state.swaps[key];
      dbDone(sb.from('swaps').delete().eq('household_id', DB.household).eq('task_key', key), 'byttet');
    }
  }

  /* ---------- Medlemmer ---------- */
  function validMember(m){
    return m && typeof m.id === 'string' && typeof m.name === 'string' && typeof m.kid === 'boolean' &&
      PALETTE.some(function(p){ return p.k === m.color; });
  }
  function saveMembers(){ later('members', saveMembersNow); }
  var members = [];   // fylles fra databasen
  var P = {};
  function syncMembers(){ P = {}; members.forEach(function(m){ P[m.id] = m; }); }
  syncMembers();

  function nameOf(id){ var m = P[id]; if (!m) return ''; return m.name.trim() || 'Uten navn'; }
  function initialOf(m){ var n = m.name.trim(); return n ? n.charAt(0).toUpperCase() : '?'; }
  function names(ids){ var n = ids.filter(function(i){ return P[i]; }).map(nameOf); return n.length ? joinNo(n) : 'Ingen'; }
  function drivers(){ return members.filter(function(m){ return !m.kid; }).map(function(m){ return m.id; }); }
  function colorOf(who){ return who === 'all' ? 'var(--accent)' : 'var(--pal-'+P[who].color+')'; }
  function whoName(who){ return who === 'all' ? 'Alle' : nameOf(who); }

  /* ---------- Google Kalender: kode i tittel, sjåfør og pakkeliste i beskrivelse ---------- */
  // «OL - Håndball» → Oliver. «AM+OL - Tannlege» → begge. Uten kode: navn i tittelen, ellers hele familien.
  function normCode(s){ return String(s || '').toUpperCase().replace(/[^A-ZÆØÅ0-9]/g, '').slice(0,4); }
  function defaultCode(name){ return normCode(name).replace(/[0-9]/g, '').slice(0,2); }
  function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function codesOf(m){
    return [normCode(m.code)].concat(String(m.alias || '').split(/[\s,;]+/).map(normCode))
      .filter(function(c,i,a){ return c && a.indexOf(c) === i; });
  }
  function codeMap(){
    var map = {};
    members.forEach(function(m){ codesOf(m).forEach(function(c){ (map[c] = map[c] || []).push(m.id); }); });
    return map;
  }
  function writeCode(id){ var m = P[id]; return m ? (normCode(m.code) || defaultCode(m.name) || '?') : '?'; }
  var PREFIX_RE = /^\s*([A-Za-zÆØÅæøå0-9]{1,4}(?:\s*[+\/&,]\s*[A-Za-zÆØÅæøå0-9]{1,4})*)\s*[-–—:]\s*(\S.*)$/;
  function parseTitle(t){
    t = String(t || '');
    var map = codeMap(), m = PREFIX_RE.exec(t);
    if (m){
      var raw = m[1].split(/\s*[+\/&,]\s*/), ids = [], unknown = [];
      raw.forEach(function(c){
        var hit = map[normCode(c)];
        if (hit){ if (ids.indexOf(hit[0]) < 0) ids.push(hit[0]); } else unknown.push(c);
      });
      if (!unknown.length) return {whos:ids, title:m[2].trim()};
      // Ser ut som en kode (store bokstaver), men ingen i familien har den
      if (raw.every(function(c){ return c.length <= 3 && c === c.toUpperCase() && /[A-ZÆØÅ]/.test(c); })) return {whos:['all'], title:m[2].trim(), unknown:unknown};
    }
    // Uten kode: let etter navn i tittelen («Håndballkamp for Oliver», slik Gemini ofte skriver)
    var byName = members.filter(function(mm){
      var n = mm.name.trim();
      return n && new RegExp('(^|[^\\p{L}])'+escRe(n)+'(?=$|[^\\p{L}])', 'iu').test(t);
    }).map(function(mm){ return mm.id; });
    if (byName.length) return {whos:byName, title:t.trim(), byName:true};
    return {whos:['all'], title:t.trim()};
  }
  function memberFromText(v){
    var low = v.trim().toLowerCase();
    var hit = members.filter(function(m){ return m.name.trim().toLowerCase() === low; })[0];
    if (hit) return hit.id;
    var map = codeMap(), c = normCode(v);
    return v.trim().length <= 4 && map[c] ? map[c][0] : null;
  }
  // Beskrivelse: «Sjåfør: Magne» (eller «?» når noen må kjøre) og «Husk: drakt, innesko». Annen tekst beholdes urørt.
  function parseDesc(desc){
    var out = {needsRide:false, driverId:null, driverName:'', bring:[], other:[]};
    String(desc || '').split(/\r?\n/).forEach(function(line){
      var m;
      if ((m = /^\s*(sjåfør|sjafør|sjafor|skyss|kjører)\s*:\s*(.*)$/i.exec(line))){
        out.needsRide = true;
        var v = m[2].trim();
        if (v && v !== '?' && !/^(ingen|ukjent|-+)$/i.test(v)){
          out.driverId = memberFromText(v);
          out.driverName = out.driverId ? nameOf(out.driverId) : v;   // kan også være bestemor e.l.
        }
      } else if ((m = /^\s*(husk|pakk|pakkeliste|ta med)\s*:\s*(.*)$/i.exec(line))){
        out.bring = out.bring.concat(m[2].split(/\s*[,;]\s*|\s+og\s+/).map(function(s){ return s.trim(); }).filter(Boolean));
      } else if (line.trim()) out.other.push(line);
    });
    return out;
  }
  function buildDesc(other, driverName, needsRide, bring){
    var lines = (other || []).slice();
    if (needsRide) lines.push('Sjåfør: '+(driverName || '?'));
    if (bring && bring.length) lines.push('Husk: '+bring.join(', '));
    return lines.join('\n');
  }
  function isFor(e, id){ return e.whos.indexOf(id) > -1; }
  function evColor(e){ return e.who === 'all' ? 'var(--accent)' : 'var(--pal-'+P[e.whos[0]].color+')'; }
  function evWho(e){ return e.who === 'all' ? 'Alle' : names(e.whos); }

  /* ---------- Faste oppgaver ---------- */
  function saveRules(){ later('rules', saveRulesNow, 300); }
  var rules = [];   // fylles fra databasen
  function ruleById(id){ return rules.filter(function(r){ return r.id === id; })[0]; }
  function activeRules(){ return rules.filter(function(r){ return !r.ended; }); }

  // Endringer i hvem/når gjelder fra i dag. Det gamle oppsettet tas vare på for dagene før,
  // så det som er gjort eller glemt tidligere ikke regnes om.
  var SCHED = ['who','mode','days','freq','anchor'];
  function beginEdit(r){
    var t = iso(today());
    if (r.from < t){
      var snap = {from:r.from, to:iso(addDays(today(),-1))};
      SCHED.forEach(function(k){ snap[k] = clone(r[k]); });
      r.past.push(snap);
      r.from = t;
    }
  }
  function versionFor(r, d){
    var s = iso(d);
    if (r.ended && s >= r.ended) return null;
    if (s >= r.from) return r;
    for (var i=0;i<r.past.length;i++){
      var v = r.past[i];
      if (s >= v.from && s <= v.to) return Object.assign({}, r, v);
    }
    return null;
  }

  function rulePeople(r){ return r.who === 'all' ? members.map(function(m){ return m.id; }) : r.who.filter(function(id){ return P[id]; }); }
  function onBiweek(r,d){ var w = weeksBetween(fromIso(r.anchor), d); return ((w % 2) + 2) % 2 === 0; }
  function ruleOnDay(r,d){
    if (r.days.indexOf(wd(d)) < 0) return false;
    return r.freq === 'biweekly' ? onBiweek(r,d) : true;
  }
  function occIndex(r,d){
    var w = weeksBetween(fromIso(r.anchor), d);
    if (r.freq === 'biweekly') w = Math.floor(w/2);
    var days = r.days.slice().sort(function(a,b){ return a-b; });
    return w*days.length + days.indexOf(wd(d));
  }
  function nextOcc(r){
    var t = today();
    for (var i=0;i<28;i++){ var d = addDays(t,i); if (ruleOnDay(r,d)) return d; }
    return null;
  }

  /* ---------- Eksempeldata: avtaler, middager, bursdager ---------- */
  // Ukemal slik avtalene ser ut i Google Kalender «familie», indeks 0 = mandag.
  // Tittel starter med kode, beskrivelsen har «Sjåfør:» og «Husk:». Blandet skrivemåte («El», «M») er med med vilje.
  var WEEK = [
    [
      {id:'m-gym', title:'OL - Gym', start:'08:15', end:'09:00', place:'Skolen', desc:'Husk: gymtøy'},
      {id:'m-turn', title:'AM - Turn', start:'17:30', end:'19:00', place:'Turnhallen', desc:'Sjåfør: Ellen\nHusk: drikkeflaske'},
      {id:'m-yoga', title:'El - Yoga', start:'18:30', end:'19:45', place:'Studioet'},
      {id:'m-padel', title:'M - Padel', start:'20:00', end:'21:30', place:'Padelhallen'}
    ],
    [
      {id:'ti-frisor', title:'El - Frisør', start:'16:00', end:'17:00', place:'Sentrum'},
      {id:'ti-turn', title:'AM - Turn', start:'17:30', end:'19:00', place:'Turnhallen', desc:'Sjåfør: ?\nHusk: drikkeflaske'},
      {id:'ti-hb', title:'OL - Håndballtrening', start:'17:45', end:'19:15', place:'Hallen', desc:'Sjåfør: ?\nHusk: innesko, drikkeflaske'}
    ],
    [
      {id:'o-gym', title:'OL - Gym', start:'08:15', end:'09:00', place:'Skolen', desc:'Husk: gymtøy'},
      {id:'o-tann', title:'AM+OL - Tannlege', start:'14:30', end:'15:15', place:'Tannklinikken', desc:'Sjåfør: Ellen'},
      {id:'o-piano', title:'AM - Pianotime', start:'17:00', end:'17:45', place:'Kulturskolen', desc:'Sjåfør: Magne\nHusk: notebok'},
      {id:'o-fm', title:'M - Foreldremøte håndball', start:'19:00', end:'20:30', place:'Klubbhuset'}
    ],
    [
      {id:'to-turn', title:'AM - Turn', start:'17:30', end:'19:00', place:'Turnhallen', desc:'Sjåfør: Ellen\nHusk: drikkeflaske'},
      {id:'to-hb', title:'OL - Håndballtrening', start:'18:00', end:'19:30', place:'Hallen', desc:'Sjåfør: Magne\nHusk: innesko'},
      {id:'to-bok', title:'El - Bokklubb', start:'19:30', end:'21:30', place:'Hos Kari'}
    ],
    [
      {id:'f-lunsj', title:'El - Lunsj med Kari', start:'12:00', end:'13:00', place:'Byen'},
      {id:'f-pakke', title:'M - Hente pakke', start:'15:30', end:null, place:'Posten'},
      {id:'f-bday', title:'AM - Bursdag hos Nora', start:'16:00', end:'18:00', place:'Hos Nora', desc:'Sjåfør: Magne\nHusk: gave'},
      {id:'f-kino', title:'OL - Kino med klassen', start:'18:30', end:'21:00', place:'Kinoen', desc:'Sjåfør: ?'}
    ],
    [
      {id:'l-dugnad', title:'M - Dugnad: kiosk i hallen', start:'10:00', end:'14:00', place:'Hallen'},
      {id:'l-svom', title:'Svømming for Amalie', start:'11:00', end:'12:00', place:'Svømmehallen', desc:'Sjåfør: Ellen\nHusk: badetøy, håndkle'},
      {id:'l-kaffe', title:'El - Kaffe hos bestemor', start:'14:30', end:'16:00', place:'Hos bestemor'}
    ],
    [
      {id:'s-tur', title:'Tur i Bymarka', start:'12:00', end:'15:00', place:'Bymarka', desc:'Husk: kakao, sitteunderlag'},
      {id:'s-bday', title:'El - Bursdag hos Hilde', start:'18:30', end:'21:30', place:'Hos Hilde'}
    ]
  ];
  var DISHES = ['Fiskegrateng','Kyllingwok','Pasta bolognese','Fiskekaker med potet','Fredagstaco','Hjemmelaget pizza','Ovnsbakt kylling'];
  var DEFAULT_TIME = '17:30';
  // Middagsplan per dato, fra databasen
  var dinnerEdits = {};
  function saveDinnerEdits(k){
    var e = dinnerEdits[k]; if (!e) return;
    dbDone(sb.from('dinners').upsert({household_id:DB.household, day:k, dish:e.dish || '', at_time:e.time || DEFAULT_TIME, updated_at:new Date().toISOString()}), 'middagen');
  }
  function validTime(s){ return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s); }
  function dinnerFor(d){
    var e = dinnerEdits[iso(d)];
    return e && typeof e.dish === 'string' && e.dish.trim() ? {dish:e.dish.trim(), time: validTime(e.time) ? e.time : DEFAULT_TIME} : null;
  }
  function recentDishes(){
    var seen = {}, out = [];
    Object.keys(dinnerEdits).sort().reverse().map(function(k){ return dinnerEdits[k] && dinnerEdits[k].dish; }).concat(DISHES).forEach(function(x){
      if (typeof x !== 'string') return;
      var v = x.trim(); if (!v || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = true; out.push(v);
    });
    return out.slice(0,8);
  }
  var BDAYS = [];   // kommer fra Google Kalender

  var ICON_CAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16v-5l2-5h10l2 5v5"/><path d="M3 16h18"/><circle cx="7.5" cy="18.5" r="1.5"/><circle cx="16.5" cy="18.5" r="1.5"/></svg>';
  var ICON_WARN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>';
  var ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  var ICON_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  var ICON_CHECK ='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
  var ICON_OPEN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>';
  var ICON_MISSED = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/></svg>';

  /* ---------- Tilstand ---------- */
  var state = { view:'day', cursor:today(), extras:{}, drivers:{}, swaps:{}, done:new Set(), picker:null, confirm:null, stab:'family', editRule:null, editPrep:null, dinnerDays:28, dinnerEdit:null, forceEvening:false, notifList:[], toast:null, me:null, pair:null };

  function choresFor(d){
    var day = iso(d);
    var out = [];
    rules.forEach(function(rule){
      var r = versionFor(rule, d);
      if (!r || !ruleOnDay(r,d)) return;
      var people = rulePeople(r);
      if (!people.length) return;
      var bases;
      if (r.mode === 'rotate' && people.length > 1){
        var n = people.length;
        var i = ((occIndex(r,d) % n) + n) % n;
        bases = [{key:day+'|'+r.id, base:people[i]}];
      } else {
        bases = people.map(function(id){ return {key:day+'|'+r.id+'|'+id, base:id}; });
      }
      bases.forEach(function(b){
        var who = state.swaps[b.key];
        if (!who || !P[who]) who = b.base;
        out.push({key:b.key, rule:r, who:who, base:b.base, swapped:who !== b.base, done:state.done.has(b.key), date:d});
      });
    });
    return out;
  }
  function choreLabel(c){
    var t = c.rule.title.trim() || 'Uten navn';
    var din = c.rule.dinner ? dinnerFor(c.date) : null;
    return din ? t+': '+din.dish : t;
  }
  function cooksFor(d){ return choresFor(d).filter(function(c){ return c.rule.dinner; }).map(function(c){ return c.who; }); }

  /* ---------- Forberedelser: oppgaver som utløses av avtaler som nærmer seg ---------- */
  // Ord i tittelen → oppgave til den avtalen gjelder, N dager før. Passer flere regler, vinner det lengste ordet
  // («svømmetrening» slår «trening»). Ingen regel, men «Husk:» i beskrivelsen → «Pakke» dagen før.
  var PREP_OFFSETS = [{n:0, l:'Samme dag'}, {n:1, l:'Dagen før'}, {n:2, l:'2 dager før'}, {n:3, l:'3 dager før'}, {n:7, l:'1 uke før'}];
  var FALLBACK_PREP = {id:'pakk', title:'Pakke', offset:1, pack:true, fallback:true};
  var preps = {fallback:true, rules:[]};   // fylles fra databasen
  function savePreps(){ later('preps', savePrepsNow, 400); }
  function prepById(id){ return preps.rules.filter(function(r){ return r.id === id; })[0]; }
  function prepWords(r){ return r.words.split(',').map(function(s){ return s.trim().toLowerCase(); }).filter(Boolean); }
  function prepPeople(r){
    if (r.who === 'all') return members.map(function(m){ return m.id; });
    if (r.who === 'kids') return members.filter(function(m){ return m.kid; }).map(function(m){ return m.id; });
    return r.who.filter(function(id){ return P[id]; });
  }
  function prepApplies(r, p){
    if (r.who === 'all') return true;                       // også avtaler for hele familien
    if (p === 'all') return false;
    return r.who === 'kids' ? !!(P[p] && P[p].kid) : r.who.indexOf(p) > -1;
  }
  function prepWhoText(r){ return r.who === 'all' ? 'Alle' : r.who === 'kids' ? 'Barna' : (prepPeople(r).length ? names(prepPeople(r)) : 'Ingen valgt'); }
  function offsetLabel(n){ var o = PREP_OFFSETS.filter(function(x){ return x.n === n; })[0]; return o ? o.l : n+' dager før'; }
  function bestPrep(e, p){
    var t = e.title.toLowerCase(), best = null, len = 0;
    preps.rules.forEach(function(r){
      if (!prepApplies(r, p)) return;
      prepWords(r).forEach(function(w){ if (w.length > len && t.indexOf(w) > -1){ best = r; len = w.length; } });
    });
    if (!best && preps.fallback && e.bring && e.bring.length) best = FALLBACK_PREP;
    return best;
  }
  function whenRel(target, from){
    var n = Math.round((startOfDay(target) - startOfDay(from))/864e5);
    if (n === 0) return 'i dag';
    if (n === 1) return 'i morgen';
    return n > 0 && n < 7 ? WD_LONG[wd(target)] : WD_LONG[wd(target)]+' '+dateShort(target);
  }
  function prepTasksFor(d){
    var offs = {};
    preps.rules.forEach(function(r){ offs[r.offset] = true; });
    if (preps.fallback) offs[1] = true;
    var out = [];
    Object.keys(offs).map(Number).forEach(function(n){
      var target = addDays(d, n);
      eventsFor(target).forEach(function(e){
        e.whos.forEach(function(p){
          var r = bestPrep(e, p);
          if (!r || r.offset !== n) return;
          var key = 'prep|'+e.key+'|'+p;
          out.push({kind:'prep', key:key, who:p, rule:r, event:e, target:target, date:d, done:state.done.has(key)});
        });
      });
    });
    return out;
  }
  /* ---------- Varsler: hva hver person får på mobilen i dag ---------- */
  // Ferdig app: en planlagt jobb på Netlify regner ut dette hvert kvarter og sender web push.
  // Det som er krysset av sendes ikke. Prototypen viser bare hva som ville blitt sendt.
  var NOTIF_TIMES = ['18:00','19:00','20:00','21:00'];
  var NOTIF_LEADS = [30, 60, 90];
  function defaultNotif(){
    return {people:{}, prep:true, chores:true, dinner:true, dinnerLead:60, ride:true, morning:false, escalate:false};
  }
  var notif = defaultNotif();   // fylles fra databasen (personvalg ligger på hvert familiemedlem)
  function saveNotif(){ later('notif', saveNotifNow, 400); }
  function personNotif(id){
    if (!notif.people[id]) notif.people[id] = {on:true, time: P[id] && P[id].kid ? '19:00' : '20:00'};
    if (!notif.people[id].phone) notif.people[id].phone = 'android';
    if (!notif.people[id].start) notif.people[id].start = P[id] && P[id].kid ? 'me' : 'family';      // hva mobilen åpner på
    return notif.people[id];
  }
  function hm(min){ min = ((Math.round(min) % 1440) + 1440) % 1440; return pad(Math.floor(min/60))+':'+pad(min%60); }
  function notificationsFor(d){
    var out = [];
    var chores = choresFor(d), dayPreps = prepTasksFor(d), evts = eventsFor(d), tomorrow = eventsFor(addDays(d,1));
    var adults = drivers().filter(function(a){ return personNotif(a).on; });
    members.forEach(function(m){
      var pn = personNotif(m.id);
      if (!pn.on) return;
      if (notif.prep) dayPreps.filter(function(t){ return t.who === m.id; }).forEach(function(t){
        out.push({who:m.id, time:pn.time, kind:'prep', title:prepTitle(t), body:prepSub(t), key:t.key, done:t.done});
      });
      if (notif.chores) chores.filter(function(c){ return c.who === m.id && !c.rule.dinner; }).forEach(function(c){
        out.push({who:m.id, time:pn.time, kind:'chore', title:choreLabel(c), body:'Fast oppgave i dag', key:c.key, done:c.done});
      });
      if (notif.dinner) chores.filter(function(c){ return c.who === m.id && c.rule.dinner; }).forEach(function(c){
        var din = dinnerFor(d);
        out.push({who:m.id, time:hm(toMin(din ? din.time : DEFAULT_TIME) - notif.dinnerLead), kind:'dinner', title:'Du har middag i dag',
          body: din ? din.dish+' kl. '+din.time : 'Middagen er ikke bestemt ennå', key:c.key, done:c.done});
      });
      if (notif.morning){
        var mine = evts.filter(function(e){ return isFor(e, m.id); });
        if (mine.length) out.push({who:m.id, time:'07:00', kind:'morning', title:'I dag', body:mine.map(function(e){ return e.start+' '+e.title; }).join(' · '), done:false});
      }
    });
    adults.forEach(function(a){
      var pn = personNotif(a);
      if (notif.prep) dayPreps.filter(function(t){ return t.who === 'all'; }).forEach(function(t){
        out.push({who:a, time:pn.time, kind:'prep', title:prepTitle(t)+' (hele familien)', body:prepSub(t), key:t.key, done:t.done});
      });
      if (notif.ride){
        tomorrow.filter(function(e){ return e.needsRide && !e.driverName; }).forEach(function(e){
          out.push({who:a, time:pn.time, kind:'ride', title:'Ingen kjører ennå', body:evWho(e)+': '+e.title+' i morgen kl. '+e.start, rideKey:e.key, done:false});
        });
        evts.filter(function(e){ return e.needsRide && !e.driverName && e.startMin >= 120; }).forEach(function(e){
          out.push({who:a, time:hm(e.startMin - 120), kind:'ride', title:'Ingen kjører ennå', body:evWho(e)+': '+e.title+' i dag kl. '+e.start, rideKey:e.key, done:false});
        });
      }
      if (notif.escalate) dayPreps.filter(function(t){ return t.who !== 'all' && P[t.who] && P[t.who].kid; }).forEach(function(t){
        out.push({who:a, time:hm(toMin(personNotif(t.who).time) + 60), kind:'escalate', title:nameOf(t.who)+' har ikke krysset av', body:prepTitle(t)+' '+prepSub(t), key:t.key, done:t.done});
      });
    });
    var order = members.map(function(m){ return m.id; });
    return out.sort(function(x,y){ return x.time < y.time ? -1 : x.time > y.time ? 1 : order.indexOf(x.who) - order.indexOf(y.who); });
  }

  function prepTitle(t){ return t.rule.title.trim() || 'Forberede'; }
  function prepSub(t){
    var e = t.event;
    var s = 'til '+e.title+' '+whenRel(t.target, t.date)+(e.start ? ' kl. '+e.start : '');
    if (t.rule.pack && e.bring && e.bring.length) s += ' · Husk: '+e.bring.join(', ');
    return s;
  }

  function eventsFor(d){
    var key = iso(d);
    var list = WEEK[wd(d)].concat(state.extras[key] || []);
    return list.map(function(e){
      var k = key+'|'+e.id;
      var pt = parseTitle(e.title);
      var pd = parseDesc(e.desc);
      var driverId = pd.driverId, driverName = pd.driverName;
      if (state.drivers[k] !== undefined){
        driverId = state.drivers[k] && P[state.drivers[k]] ? state.drivers[k] : null;
        driverName = driverId ? nameOf(driverId) : '';
      }
      var s = toMin(e.start);
      return {
        id:e.id, key:k, raw:e.title, title:pt.title, whos:pt.whos, who: pt.whos.length === 1 ? pt.whos[0] : 'many',
        unknown:pt.unknown || null, byName:!!pt.byName,
        start:e.start, end:e.end, place:e.place, startMin:s, endMin: e.end ? toMin(e.end) : s+60,
        needsRide:pd.needsRide, driver:driverId, driverName:driverName, bring:pd.bring, other:pd.other
      };
    }).sort(function(a,b){ return a.startMin - b.startMin; });
  }

  function statusOf(e,d){
    var diff = dayDiff(d);
    if (diff < 0) return 'past';
    if (diff > 0) return 'future';
    var n = nowMin();
    if (e.endMin <= n) return 'past';
    if (e.startMin <= n) return 'now';
    return 'future';
  }

  function issues(d, evts){
    var out = [];
    var rides = evts.filter(function(e){ return e.needsRide && e.who !== 'all'; });
    for (var i=0;i<rides.length;i++){
      for (var j=i+1;j<rides.length;j++){
        var a = rides[i], b = rides[j];
        if (!(a.startMin < b.endMin + 15 && b.startMin < a.endMin + 15)) continue;
        if (!a.driverName && !b.driverName) out.push(evWho(a)+' ('+a.start+') og '+evWho(b)+' ('+b.start+') trenger skyss samtidig, og ingen kjører er satt.');
        else if (a.driverName && a.driverName.toLowerCase() === (b.driverName || '').toLowerCase()) out.push(a.driverName+' er satt til å kjøre både '+evWho(a)+' ('+a.start+') og '+evWho(b)+' ('+b.start+').');
      }
    }
    // Middagsansvar: lager mat fra 75 min før, spiser til 30 min etter middagstid
    var din = dinnerFor(d);
    var tm = toMin(din ? din.time : DEFAULT_TIME);
    choresFor(d).filter(function(c){ return c.rule.dinner; }).forEach(function(c){
      evts.filter(function(e){ return isFor(e, c.who) && e.startMin < tm+30 && e.endMin > tm-75; }).forEach(function(e){
        out.push(nameOf(c.who)+' har middagsansvar, men står oppført med «'+e.title+'» '+e.start+(e.end ? '–'+e.end : '')+'. Trykk «Bytt» på middagsoppgaven for å gi den til noen andre denne dagen.');
      });
    });
    return out;
  }

  // Eksempel (til Google Kalender er koblet til): en klassetur førstkommende torsdag (enkeltavtale, ikke ukentlig)
  function seedDemoEvents(){
    var t = today();
    var thu = addDays(t, ((3 - wd(t) + 7) % 7) || 7);
    state.extras[iso(thu)] = [{id:'x-klassetur', title:'OL - Klassetur til Ringve museum', start:'08:30', end:'14:30', place:'Skolen', desc:'Husk: matpakke, drikkeflaske, regntøy'}];
  }

  /* ---------- Tegning: dag ---------- */
  function eventHTML(e,d,laneId){
    var st = statusOf(e,d);
    var others = laneId && e.who !== 'all' && e.whos.length > 1 ? e.whos.filter(function(x){ return x !== laneId; }) : [];
    if (laneId && e.who === 'all') others = null;   // vises som «Hele familien» i Min dag
    var time = '<div class="time"><span class="t-start">'+e.start+'</span>'+(e.end ? '<span class="t-end">'+e.end+'</span>' : '')+'</div>';
    var ride = '';
    if (e.needsRide){
      var dr = drivers();
      if (state.picker === 'ride:'+e.key){
        ride = '<span class="lbl-sm">Hvem kjører?</span>' + (dr.length ? dr.map(function(x){
          return '<button type="button" class="chip'+(e.driver===x?' sel':'')+'" data-act="setdriver" data-key="'+e.key+'" data-who="'+x+'">'+esc(nameOf(x))+'</button>';
        }).join('') : '<span class="lbl-sm">Ingen voksne er satt opp i innstillingene.</span>');
      } else if (e.driverName){
        ride = '<button type="button" class="chip" data-act="pickride" data-key="'+e.key+'" aria-label="'+esc(e.driverName)+' kjører. Trykk for å endre.">'+ICON_CAR+esc(e.driverName)+' kjører</button>';
      } else {
        ride = '<button type="button" class="chip warn" data-act="pickride" data-key="'+e.key+'">'+ICON_CAR+'Hvem kjører?</button>';
      }
    }
    var bring = e.bring && e.bring.length ? '<div class="bring"><span>Husk:</span> '+e.bring.map(esc).join(', ')+'</div>' : '';
    return '<li class="event '+st+'">'+time+'<div class="body">'+
      '<div class="title">'+esc(e.title)+(st==='now' ? '<span class="nowtag">Nå</span>' : '')+'</div>'+
      (e.place ? '<div class="place">'+esc(e.place)+'</div>' : '')+
      (others === null ? '<div class="place">Hele familien</div>' : others.length ? '<div class="place">Sammen med '+esc(names(others))+'</div>' : '')+bring+
      (ride ? '<div class="ride">'+ride+'</div>' : '')+
      '</div></li>';
  }

  function choreTag(c){
    if (c.swapped) return 'byttet fra '+nameOf(c.base);
    if (c.rule.mode === 'rotate' && rulePeople(c.rule).length > 1) return 'bytter på';
    if (c.rule.freq === 'biweekly') return 'annenhver uke';
    return '';
  }

  function choreRowHTML(c){
    var id = 'ch-'+c.key.replace(/[^a-z0-9]/gi,'-');
    var tag = choreTag(c);
    var open = state.picker === 'swap:'+c.key;
    var html = '<div class="chore'+(c.done?' done':'')+'">'+
      '<label class="chore-l" for="'+id+'"><input type="checkbox" id="'+id+'" data-act="chore" data-key="'+c.key+'"'+(c.done?' checked':'')+'>'+
      '<span class="ct"><span>'+esc(choreLabel(c))+'</span>'+(tag ? '<small>'+esc(tag)+'</small>' : '')+'</span></label>'+
      '<button type="button" class="swapbtn" data-act="pickswap" data-key="'+c.key+'" aria-expanded="'+open+'">Bytt</button></div>';
    if (open){
      html += '<div class="swaprow"><span class="lbl-sm">Gi til</span>'+members.filter(function(m){ return m.id !== c.who; }).map(function(m){
        var label = m.id === c.base ? 'Tilbake til '+nameOf(m.id) : nameOf(m.id);
        return '<button type="button" class="chip" data-act="setswap" data-key="'+c.key+'" data-who="'+m.id+'" data-base="'+c.base+'">'+esc(label)+'</button>';
      }).join('')+'</div>';
    }
    return html;
  }

  function prepRowHTML(t){
    var id = 'pr-'+t.key.replace(/[^a-z0-9]/gi,'-');
    return '<div class="chore prep'+(t.done?' done':'')+'">'+
      '<label class="chore-l" for="'+id+'"><input type="checkbox" id="'+id+'" data-act="chore" data-key="'+esc(t.key)+'"'+(t.done?' checked':'')+'>'+
      '<span class="ct"><span>'+esc(prepTitle(t))+'</span><small>'+esc(prepSub(t))+'</small></span></label></div>';
  }

  function laneHTML(m, evts, chores, d, prepList){
    prepList = prepList || [];
    var sub;
    if (isToday(d)){
      var n = nowMin();
      var cur = evts.find(function(e){ return e.startMin <= n && n < e.endMin; });
      var nxt = evts.find(function(e){ return e.startMin > n; });
      sub = cur ? 'Nå: '+cur.title : nxt ? 'Neste: '+nxt.title+' '+rel(nxt.startMin - n) : (evts.length ? 'Ferdig for i dag' : 'Ingen avtaler i dag');
    } else {
      sub = evts.length ? evts.length+' '+(evts.length === 1 ? 'avtale' : 'avtaler') : 'Ingen avtaler';
    }
    var all = chores.concat(prepList);
    var doneN = all.filter(function(c){ return c.done; }).length;
    var prog = all.length ? '<span class="prog" title="Oppgaver gjort">'+doneN+' av '+all.length+'</span>' : '';
    return '<section class="lane" style="--c:var(--pal-'+m.color+')" aria-label="'+esc(nameOf(m.id))+'">'+
      '<header class="lane-head"><button type="button" class="who-btn" data-act="me" data-id="'+m.id+'" aria-label="Vis Min dag for '+esc(nameOf(m.id))+'">'+
        '<span class="avatar" aria-hidden="true">'+esc(initialOf(m))+'</span>'+
        '<span class="who"><span class="lname">'+esc(nameOf(m.id))+'</span><span class="sub">'+esc(sub)+'</span></span></button>'+prog+'</header>'+
      '<div class="lane-body">'+
        (evts.length ? '<ol class="events">'+evts.map(function(e){ return eventHTML(e,d,m.id); }).join('')+'</ol>'
                     : '<p class="empty">Ingen avtaler '+(isToday(d) ? 'i dag' : 'denne dagen')+'</p>')+
        (all.length ? '<div class="chores"><h3 class="label">Oppgaver</h3>'+chores.map(choreRowHTML).join('')+prepList.map(prepRowHTML).join('')+'</div>' : '')+
      '</div></section>';
  }

  /* ---------- Tegning: Min dag ---------- */
  function renderMe(){
    var id = state.me, m = P[id], d = state.cursor;
    if (!m){ state.view = 'day'; return renderDay(); }
    var evts = eventsFor(d).filter(function(e){ return isFor(e, id) || e.who === 'all'; });
    var chores = choresFor(d).filter(function(c){ return c.who === id; });
    var dayPreps = prepTasksFor(d).filter(function(t){ return t.who === id || (!m.kid && t.who === 'all'); });
    var tasks = chores.length + dayPreps.length;
    var doneN = chores.concat(dayPreps).filter(function(c){ return c.done; }).length;
    var tomorrow = eventsFor(addDays(d,1)).filter(function(e){ return isFor(e, id) || e.who === 'all'; });
    var cooks = cooksFor(d), din = dinnerFor(d);
    var sub;
    if (isToday(d)){
      var n = nowMin();
      var cur = evts.find(function(e){ return e.startMin <= n && n < e.endMin; });
      var nxt = evts.find(function(e){ return e.startMin > n; });
      sub = cur ? 'Nå: '+cur.title : nxt ? 'Neste: '+nxt.title+' '+rel(nxt.startMin - n) : (evts.length ? 'Ferdig med avtalene for i dag' : 'Ingen avtaler i dag');
    } else sub = evts.length ? evts.length+' '+(evts.length === 1 ? 'avtale' : 'avtaler') : 'Ingen avtaler';
    var dinner = din
      ? '<div class="me-row"><span class="t">'+din.time+'</span><span>'+esc(din.dish)+
          (cooks.indexOf(id) > -1 ? ' · <b>du lager middag</b>' : cooks.length ? ' <small>· '+esc(names(cooks))+' lager</small>' : '')+'</span></div>'
      : '<p class="empty">Ikke bestemt ennå</p>';
    var tm = tomorrow.length ? tomorrow.map(function(e){
      return '<div class="me-row"><span class="t">'+e.start+'</span><span>'+esc(e.title)+(e.who === 'all' ? ' <small>· hele familien</small>' : '')+
        (e.bring.length ? ' <small>· husk '+esc(e.bring.join(', '))+'</small>' : '')+'</span></div>';
    }).join('') : '<p class="empty">Ingen avtaler</p>';
    $('me').style.setProperty('--c', 'var(--pal-'+m.color+')');
    $('me').innerHTML =
      '<header class="me-head"><span class="avatar" aria-hidden="true">'+esc(initialOf(m))+'</span>'+
        '<div class="who"><h2>'+(isToday(d) ? 'Min dag' : esc(dayName(d)))+' · '+esc(nameOf(id))+'</h2><span class="sub">'+esc(sub)+'</span></div>'+
        '<button type="button" class="btn back" data-act="view" data-view="day">Familien</button></header>'+
      (tasks ? '<section class="me-card"><h3 class="label">Oppgaver · '+doneN+' av '+tasks+' gjort</h3><div class="chores">'+
        chores.map(choreRowHTML).join('')+dayPreps.map(prepRowHTML).join('')+'</div></section>' : '')+
      '<section class="me-card"><h3 class="label">Avtaler</h3>'+
        (evts.length ? '<ol class="events">'+evts.map(function(e){ return eventHTML(e, d, id); }).join('')+'</ol>' : '<p class="empty">Ingen avtaler '+(isToday(d) ? 'i dag' : 'denne dagen')+'</p>')+'</section>'+
      '<section class="me-card"><h3 class="label">Middag</h3>'+dinner+'</section>'+
      '<section class="me-card"><h3 class="label">I morgen</h3>'+tm+'</section>';
  }
  // Tegner det som vises nå (dag eller Min dag) etter små endringer som avkrysning
  function renderMain(){ if (state.view === 'me') renderMe(); else if (state.view === 'day') renderDay(); else render(); }

  function renderDay(){
    var d = state.cursor;
    var evts = eventsFor(d);
    var chores = choresFor(d);
    var fam = evts.filter(function(e){ return e.who === 'all'; });
    var dayPreps = prepTasksFor(d);
    var famPreps = dayPreps.filter(function(t){ return t.who === 'all'; });
    var famEl = $('family');
    famEl.hidden = !fam.length && !famPreps.length;
    var dots = '<span class="fam-dots" aria-hidden="true">'+members.map(function(m){ return '<i style="background:var(--pal-'+m.color+')"></i>'; }).join('')+'</span>';
    famEl.innerHTML = fam.map(function(e){
      return '<div class="fam-item">'+dots+
        '<span class="fam-label">Hele familien</span><span class="t">'+e.start+(e.end ? '–'+e.end : '')+'</span>'+
        '<span class="ti">'+esc(e.title)+'</span>'+(e.place ? '<span class="muted">'+esc(e.place)+'</span>' : '')+
        (e.bring && e.bring.length ? '<span class="muted">Husk: '+e.bring.map(esc).join(', ')+'</span>' : '')+
        (e.unknown ? '<span class="fam-unknown">Ukjent kode «'+esc(e.unknown.join('+'))+'»</span>' : '')+'</div>';
    }).join('') + famPreps.map(function(t){
      var id = 'fp-'+t.key.replace(/[^a-z0-9]/gi,'-');
      return '<label class="fam-item fam-prep'+(t.done ? ' done' : '')+'" for="'+id+'">'+
        '<input type="checkbox" id="'+id+'" data-act="chore" data-key="'+esc(t.key)+'"'+(t.done ? ' checked' : '')+'>'+
        '<span class="fam-label">Forberede</span><span class="ti">'+esc(prepTitle(t))+'</span><span class="muted">'+esc(prepSub(t))+'</span></label>';
    }).join('');
    var lanes = $('lanes');
    lanes.style.setProperty('--n', String(members.length));
    lanes.innerHTML = members.map(function(m){
      return laneHTML(m, evts.filter(function(e){ return isFor(e, m.id); }), chores.filter(function(c){ return c.who === m.id; }), d,
        dayPreps.filter(function(t){ return t.who === m.id; }));
    }).join('');
    // Kveldssjekk på nettbrettet: forberedelser som ikke er gjort, fra første påminnelsestid
    var ev = $('evening');
    var pending = isToday(d) ? dayPreps.filter(function(t){ return !t.done; }) : [];
    var times = pending.map(function(t){ return t.who === 'all' ? '20:00' : personNotif(t.who).time; });
    var first = times.length ? times.sort()[0] : null;
    var showEv = pending.length && (state.forceEvening || (first && nowMin() >= toMin(first)));
    ev.hidden = !showEv;
    ev.innerHTML = showEv ? ICON_BELL+'<div><strong>Kveldssjekk.</strong>Ikke gjort ennå: '+
      pending.map(function(t){ return esc((t.who === 'all' ? 'Alle' : nameOf(t.who))+': '+prepTitle(t).toLowerCase()); }).join(' · ')+'</div>' : '';
    var list = issues(d, evts);
    var al = $('alert');
    al.hidden = !list.length;
    al.innerHTML = list.length ? ICON_WARN+'<div>'+list.map(function(t,i){ return '<p>'+(i===0 ? '<strong>Må avklares.</strong>' : '')+esc(t)+'</p>'; }).join('')+'</div>' : '';
  }

  /* ---------- Tegning: uke ---------- */
  function renderWeek(){
    var mon = mondayOf(state.cursor);
    var html = '';
    for (var i=0;i<7;i++){
      var d = addDays(mon,i);
      var items = eventsFor(d).map(function(e){
        var warn = e.needsRide && !e.driverName ? '<span class="dc-warn" title="Mangler sjåfør">?</span>' : '';
        return '<li class="dc-item"><span class="dot" style="background:'+evColor(e)+'"></span><span><span class="t">'+e.start+'</span> '+esc(e.title)+warn+'<span class="dc-who">'+esc(evWho(e))+'</span></span></li>';
      }).join('');
      var cooks = cooksFor(d);
      var din = dinnerFor(d);
      html += '<div class="daycard'+(isToday(d) ? ' today' : '')+'" role="button" tabindex="0" data-act="goto" data-date="'+iso(d)+'" aria-label="Vis '+dayName(d)+' '+dateLong(d)+'">'+
        '<div class="dc-head"><span class="dc-day">'+dayName(d)+'</span><span class="dc-date">'+d.getDate()+'.</span></div>'+
        '<ul class="dc-list">'+(items || '<li class="dc-empty">Ingen avtaler</li>')+'</ul>'+
        '<div class="dc-dinner"><small>Middag'+(din ? ' '+din.time : '')+(cooks.length ? ' · '+esc(names(cooks)) : '')+'</small>'+(din ? esc(din.dish) : '<span class="muted">Ikke bestemt</span>')+'</div></div>';
    }
    $('weekgrid').innerHTML = html;
  }

  /* ---------- Tegning: oppgaver (status) ---------- */
  function cchipHTML(c,d){
    var diff = dayDiff(d);
    var st = c.done ? 'done' : diff < 0 ? 'missed' : diff === 0 ? 'today' : 'future';
    var icon = st === 'done' ? ICON_CHECK : st === 'missed' ? ICON_MISSED : ICON_OPEN;
    var label, tag;
    if (c.kind === 'prep'){
      label = prepTitle(c);
      tag = 'til '+c.event.title+' '+whenRel(c.target, d);
    } else {
      var dd = c.rule.dinner ? dinnerFor(d) : null;
      label = c.rule.dinner ? 'Middag: '+(dd ? dd.dish : 'ikke bestemt') : (c.rule.title.trim() || 'Uten navn');
      tag = choreTag(c);
    }
    var stText = {done:'gjort', missed:'glemt', today:'ikke gjort ennå', future:'kommer'}[st];
    return '<button type="button" class="cchip '+st+'" data-act="toggle" data-key="'+esc(c.key)+'"'+(st==='future' ? ' disabled' : '')+
      ' aria-pressed="'+c.done+'" aria-label="'+esc(label)+', '+stText+'">'+icon+'<span>'+esc(label)+(tag ? '<small>'+esc(tag)+'</small>' : '')+'</span></button>';
  }

  function renderChores(){
    var mon = mondayOf(state.cursor);
    var days = []; for (var i=0;i<7;i++) days.push(addDays(mon,i));
    var byDay = days.map(function(d){ return choresFor(d).concat(prepTasksFor(d)); });
    var head = '<colgroup><col class="pcol">'+days.map(function(){ return '<col>'; }).join('')+'</colgroup>'+
      '<thead><tr><th scope="col">Hvem</th>'+days.map(function(d){
        return '<th scope="col" class="'+(isToday(d)?'today':'')+'">'+dayName(d)+' <span>'+d.getDate()+'.</span></th>';
      }).join('')+'</tr></thead>';
    var rows = members.map(function(m){
      var due = 0, done = 0, left = 0;
      var cells = days.map(function(d,i){
        var items = byDay[i].filter(function(c){ return c.who === m.id; });
        items.forEach(function(c){ if (dayDiff(d) <= 0){ due++; if (c.done) done++; } else left++; });
        return '<td class="'+(isToday(d)?'today':'')+'">'+items.map(function(c){ return cchipHTML(c,d); }).join('')+'</td>';
      }).join('');
      var pct = due ? Math.round(done/due*100) : 0;
      var count = due ? done+' av '+due+' gjort' : 'Ingenting ennå';
      return '<tr style="--c:var(--pal-'+m.color+')"><th scope="row">'+
        '<div class="prow"><span class="avatar sm" aria-hidden="true">'+esc(initialOf(m))+'</span><div><div class="pname">'+esc(nameOf(m.id))+'</div>'+
        '<div class="pcount">'+count+(left ? ' · '+left+' igjen' : '')+'</div></div></div>'+
        '<div class="pbar" aria-hidden="true"><i style="width:'+pct+'%"></i></div></th>'+cells+'</tr>';
    }).join('');
    $('cgrid').innerHTML = head+'<tbody>'+rows+'</tbody>';
  }

  /* ---------- Tegning: topp og bunn ---------- */
  function renderHeader(){
    var d = state.cursor;
    var isDay = state.view === 'day' || state.view === 'me';
    if (isDay){
      $('bigday').textContent = dayName(d);
      $('smalldate').textContent = dateLong(d);
    } else {
      var mon = mondayOf(d);
      $('bigday').textContent = weekLabel(d);
      $('smalldate').textContent = dateShort(mon)+' – '+dateShort(addDays(mon,6));
    }
    $('weekpill').textContent = weekLabel(d);
    $('weekpill').hidden = !isDay;
    ['day','week','chores'].forEach(function(v){ $('v-'+v).setAttribute('aria-pressed', String(state.view === v)); });
    $('todayBtn').disabled = isDay ? isToday(d) : iso(mondayOf(today())) === iso(mondayOf(d));
    $('prevBtn').setAttribute('aria-label', isDay ? 'Forrige dag' : 'Forrige uke');
    $('nextBtn').setAttribute('aria-label', isDay ? 'Neste dag' : 'Neste uke');
  }

  function renderStrip(){
    var sd = state.view === 'day' ? state.cursor : today();
    var label = isToday(sd) ? 'i dag' : dayDiff(sd) === 1 ? 'i morgen' : dayName(sd).toLowerCase();
    var cooks = cooksFor(sd);
    var din = dinnerFor(sd);
    $('dinnerTile').innerHTML = '<h3 class="label">Middag '+label+'</h3>'+
      '<button type="button" class="tile-btn" data-act="dinner-open" aria-label="Åpne middagsplanen" title="Middagsplan">'+
        '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h8M8 17h5"/></svg></button>'+
      '<div class="dinner-name'+(din ? '' : ' none')+'">'+(din ? esc(din.dish) : 'Ikke bestemt')+'</div>'+
      '<div class="dinner-meta">'+(cooks.length ? esc(names(cooks))+' lager' : 'Ingen har middagsansvar')+(din ? ' · kl. '+din.time : '')+'</div>';

    var t = today();
    $('bdayTile').innerHTML = '<h3 class="label">Bursdager</h3>'+(BDAYS.length ? '<ul class="bd">'+BDAYS.map(function(b){
      var bd = addDays(t, b.inDays);
      return '<li><span>'+esc(b.name)+' fyller '+b.age+'</span><span class="in">'+dateShort(bd)+' · om '+b.inDays+' d</span></li>';
    }).join('')+'</ul>' : '<div class="muted">Kommer når Google Kalender «Family» er koblet til</div>');

    var packs = [];
    eventsFor(sd).forEach(function(e){ (e.bring || []).forEach(function(item){ packs.push({item:item, e:e}); }); });
    $('packTile').innerHTML = '<h3 class="label">Pakkeliste '+label+'</h3>'+
      (packs.length ? '<div class="packs">'+packs.map(function(p){
        return '<span class="pack"><i style="background:'+evColor(p.e)+'"></i>'+esc(cap(p.item))+' <small>'+esc(evWho(p.e))+'</small></span>';
      }).join('')+'</div>' : '<div class="muted">Ingenting å pakke</div>');
  }

  function render(){
    renderHeader();
    $('dayView').hidden = state.view !== 'day';
    $('meView').hidden = state.view !== 'me';
    $('weekView').hidden = state.view !== 'week';
    $('choreView').hidden = state.view !== 'chores';
    $('strip').hidden = state.view === 'me';
    if (state.view === 'day') renderDay();
    else {
      $('alert').hidden = true; $('evening').hidden = true;
      if (state.view === 'me') renderMe(); else if (state.view === 'week') renderWeek(); else renderChores();
    }
    renderStrip();
  }

  /* ---------- Innstillinger: familie ---------- */
  function codeHint(m){
    var map = codeMap(), codes = codesOf(m);
    if (!normCode(m.code)) return {warn:true, text:'Mangler kode. Avtaler for '+nameOf(m.id)+' gjenkjennes bare hvis navnet står i tittelen.'};
    var clash = codes.filter(function(c){ return map[c] && map[c].length > 1; });
    if (clash.length){
      var others = [];
      clash.forEach(function(c){ map[c].forEach(function(id){ if (id !== m.id && others.indexOf(id) < 0) others.push(id); }); });
      return {warn:true, text:joinNo(clash.map(function(c){ return '«'+c+'»'; }))+' brukes også av '+names(others)+'. Gi én av dem en annen kode.'};
    }
    return {warn:false, text:joinNo(codes.map(function(c){ return '«'+c+' - …»'; }))+' havner hos '+nameOf(m.id)+'.'};
  }
  function codeHintHTML(m){ var h = codeHint(m); return '<p class="chint'+(h.warn ? ' warn' : '')+'" id="cw-'+m.id+'" role="status">'+esc(h.text)+'</p>'; }
  function updateCodeHints(){
    members.forEach(function(m){
      var el = $('cw-'+m.id); if (!el) return;
      var h = codeHint(m); el.textContent = h.text; el.classList.toggle('warn', h.warn);
    });
  }
  function gcalInfoHTML(){
    var kid = members.filter(function(m){ return m.kid; })[0] || members[0];
    var kid2 = members.filter(function(m){ return m.kid && m.id !== kid.id; })[0];
    var adult = drivers()[0];
    return '<div class="gcal-info"><h3 class="label">Google Kalender</h3>'+
      '<p>Avtaler hentes fra «familie»-kalenderen. Start tittelen med koden til personen, for eksempel <b>«'+esc(writeCode(kid.id))+' - Håndball»</b>'+
      (kid2 ? '. Flere personer: <b>«'+esc(writeCode(kid.id))+'+'+esc(writeCode(kid2.id))+' - Tannlege»</b>' : '')+
      '. Store eller små bokstaver spiller ingen rolle. Uten kode havner avtalen hos hele familien, med mindre et navn står i tittelen.</p>'+
      '<p>Sjåfør og pakkeliste står i beskrivelsen: <b>Sjåfør: '+esc(adult ? nameOf(adult) : 'Magne')+'</b> og <b>Husk: drakt, innesko</b>. «Sjåfør: ?» betyr at noen må kjøre.</p></div>';
  }
  function memberCardHTML(m, i){
    var confirming = state.confirm === 'remove:'+m.id;
    var swatches = PALETTE.map(function(p){
      var takenBy = members.filter(function(o){ return o.id !== m.id && o.color === p.k; })[0];
      var title = p.n + (takenBy ? ' (brukes av '+nameOf(takenBy.id)+')' : '');
      return '<button type="button" class="sw'+(m.color===p.k?' on':'')+(takenBy?' taken':'')+'" role="radio" aria-checked="'+(m.color===p.k)+'" '+
        'data-act="color" data-id="'+m.id+'" data-color="'+p.k+'" style="background:var(--pal-'+p.k+')" title="'+esc(title)+'" aria-label="'+esc(title)+'"></button>';
    }).join('');
    return '<div class="mcard" style="--c:var(--pal-'+m.color+')">'+
      '<div class="mrow">'+
        '<span class="avatar sm" id="av-'+m.id+'" aria-hidden="true">'+esc(initialOf(m))+'</span>'+
        '<input class="tinput mname" id="name-'+m.id+'" data-id="'+m.id+'" value="'+esc(m.name)+'" maxlength="16" placeholder="Navn" aria-label="Navn på familiemedlem '+(i+1)+'">'+
        '<div class="morder">'+
          '<button type="button" class="iconbtn" data-act="move" data-id="'+m.id+'" data-dir="-1" aria-label="Flytt én kolonne til venstre"'+(i===0?' disabled':'')+'>'+ICON_UP+'</button>'+
          '<button type="button" class="iconbtn" data-act="move" data-id="'+m.id+'" data-dir="1" aria-label="Flytt én kolonne til høyre"'+(i===members.length-1?' disabled':'')+'>'+ICON_DOWN+'</button>'+
        '</div>'+
      '</div>'+
      '<div class="swatches" role="radiogroup" aria-label="Farge">'+swatches+'</div>'+
      '<div class="mcodes">'+
        '<div class="field"><label class="label" for="code-'+m.id+'">Kode</label>'+
          '<input class="tinput codein mcodein" id="code-'+m.id+'" data-id="'+m.id+'" value="'+esc(m.code)+'" maxlength="4" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="'+esc(defaultCode(m.name) || 'AB')+'"></div>'+
        '<div class="field"><label class="label" for="alias-'+m.id+'">Gjenkjenn også</label>'+
          '<input class="tinput maliasin" id="alias-'+m.id+'" data-id="'+m.id+'" value="'+esc(m.alias)+'" maxlength="20" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="F.eks. eldre koder"></div>'+
      '</div>'+
      codeHintHTML(m)+
      '<div class="mfoot">'+
        '<label class="toggle" for="kid-'+m.id+'"><input type="checkbox" id="kid-'+m.id+'" data-act="kid" data-id="'+m.id+'"'+(m.kid?' checked':'')+'>Barn <small>kjører ikke</small></label>'+
        (members.length > 1 ? '<button type="button" class="linkbtn danger'+(confirming?' confirm':'')+'" data-act="remove" data-id="'+m.id+'">'+(confirming ? 'Trykk igjen for å fjerne' : 'Fjern')+'</button>' : '')+
      '</div>'+
    '</div>';
  }

  /* ---------- Innstillinger: faste oppgaver ---------- */
  function ruleSummary(r){
    var people = rulePeople(r);
    var who = r.who === 'all' ? 'Alle' : (people.length ? names(people) : 'Ingen valgt');
    if (r.mode === 'rotate' && people.length > 1) who = 'Bytter på: '+(r.who === 'all' ? 'alle' : names(people));
    var when;
    if (!r.days.length) when = 'ingen dager valgt';
    else if (r.days.length === 7) when = r.freq === 'biweekly' ? 'hver dag annenhver uke' : 'hver dag';
    else when = (r.freq === 'biweekly' ? 'annenhver ' : 'hver ') + joinNo(r.days.slice().sort(function(a,b){ return a-b; }).map(function(i){ return WD_LONG[i]; }));
    var s = who+' · '+when;
    if (r.freq === 'biweekly'){
      var n = nextOcc(r);
      if (n) s += ' · neste '+(isToday(n) ? 'i dag' : WD_LONG[wd(n)]+' '+dateShort(n));
    }
    return s;
  }

  function ruleEditorHTML(r){
    var people = rulePeople(r);
    var all = r.who === 'all';
    var whoChips = '<button type="button" class="chip" data-act="r-all" data-id="'+r.id+'" aria-pressed="'+all+'">Alle</button>'+
      members.map(function(m){
        return '<button type="button" class="chip person" style="--c:var(--pal-'+m.color+')" data-act="r-who" data-id="'+r.id+'" data-who="'+m.id+'" aria-pressed="'+(!all && r.who.indexOf(m.id) > -1)+'">'+esc(nameOf(m.id))+'</button>';
      }).join('');
    var mode = people.length > 1 ?
      '<div class="field"><span class="label">Fordeling</span><div class="seg sm" role="group" aria-label="Fordeling">'+
        '<button type="button" data-act="r-mode" data-id="'+r.id+'" data-mode="each" aria-pressed="'+(r.mode==='each')+'">Alle gjør den</button>'+
        '<button type="button" data-act="r-mode" data-id="'+r.id+'" data-mode="rotate" aria-pressed="'+(r.mode==='rotate')+'">Bytter på</button>'+
      '</div><span class="hint">'+(r.mode === 'rotate' ? 'Én person per gang, i fast rekkefølge.' : 'Hver person får oppgaven i sin kolonne.')+'</span></div>' : '';
    var dayChips = WD_SHORT.map(function(s,i){
      return '<button type="button" class="chip daychip" data-act="r-day" data-id="'+r.id+'" data-day="'+i+'" aria-pressed="'+(r.days.indexOf(i) > -1)+'" aria-label="'+WD_LONG[i]+'">'+s+'</button>';
    }).join('') + '<button type="button" class="chip" data-act="r-everyday" data-id="'+r.id+'" aria-pressed="'+(r.days.length===7)+'">Hver dag</button>';
    var thisWeek = onBiweek(r, today());
    var start = r.freq === 'biweekly' ?
      '<div class="field"><span class="label">Første gang</span><div class="seg sm" role="group" aria-label="Første gang">'+
        '<button type="button" data-act="r-start" data-id="'+r.id+'" data-start="this" aria-pressed="'+thisWeek+'">Denne uka</button>'+
        '<button type="button" data-act="r-start" data-id="'+r.id+'" data-start="next" aria-pressed="'+(!thisWeek)+'">Neste uke</button>'+
      '</div></div>' : '';
    var confirming = state.confirm === 'rule:'+r.id;
    return '<div class="rule-edit">'+
      '<div class="field"><label class="label" for="title-'+r.id+'">Oppgave</label><input class="tinput rtitle" id="title-'+r.id+'" data-rid="'+r.id+'" value="'+esc(r.title)+'" maxlength="40" placeholder="F.eks. Bytte sengetøy"></div>'+
      '<div class="field"><span class="label">Hvem</span><div class="chips">'+whoChips+'</div></div>'+
      mode+
      '<div class="field"><span class="label">Dager</span><div class="chips">'+dayChips+'</div></div>'+
      '<div class="field"><span class="label">Hvor ofte</span><div class="seg sm" role="group" aria-label="Hvor ofte">'+
        '<button type="button" data-act="r-freq" data-id="'+r.id+'" data-freq="weekly" aria-pressed="'+(r.freq==='weekly')+'">Hver uke</button>'+
        '<button type="button" data-act="r-freq" data-id="'+r.id+'" data-freq="biweekly" aria-pressed="'+(r.freq==='biweekly')+'">Annenhver uke</button>'+
      '</div></div>'+
      start+
      '<label class="toggle" for="dinner-'+r.id+'"><input type="checkbox" id="dinner-'+r.id+'" data-act="r-dinner" data-id="'+r.id+'"'+(r.dinner?' checked':'')+'>Middagsansvar <small>vises i middagsfeltet</small></label>'+
      '<div class="rule-actions"><button type="button" class="btn" data-act="r-close" data-id="'+r.id+'">Ferdig</button>'+
        '<button type="button" class="linkbtn danger'+(confirming?' confirm':'')+'" data-act="r-delete" data-id="'+r.id+'">'+(confirming ? 'Trykk igjen for å slette' : 'Slett oppgaven')+'</button></div>'+
    '</div>';
  }

  function ruleHTML(r){
    var people = rulePeople(r);
    var open = state.editRule === r.id;
    var dots = people.slice(0,4).map(function(id){ return '<i style="background:var(--pal-'+P[id].color+')"></i>'; }).join('');
    return '<div class="rule'+(open?' open':'')+'">'+
      '<button type="button" class="rule-head" data-act="r-edit" data-id="'+r.id+'" aria-expanded="'+open+'">'+
        '<span class="rule-dots" aria-hidden="true">'+dots+'</span>'+
        '<span class="rule-txt"><span class="rule-title"><span id="rt-'+r.id+'">'+esc(r.title.trim() || 'Uten navn')+'</span>'+(r.dinner ? '<span class="dtag">Middag</span>' : '')+'</span>'+
        '<span class="rule-sum">'+esc(ruleSummary(r))+'</span></span>'+ICON_DOWN+
      '</button>'+(open ? ruleEditorHTML(r) : '')+'</div>';
  }

  /* ---------- Innstillinger: forberedelser ---------- */
  function prepSummary(r){
    var w = prepWords(r);
    return (w.length ? 'Tittel med: '+w.join(', ') : 'Ingen ord valgt')+' · '+prepWhoText(r)+' · '+offsetLabel(r.offset).toLowerCase();
  }
  function prepPreviewHTML(r){
    var t = today(), hits = [];
    for (var i = r.offset; i < r.offset + 21 && hits.length < 3; i++){
      var day = addDays(t, i);
      eventsFor(day).forEach(function(e){
        e.whos.forEach(function(p){
          if (hits.length < 3 && bestPrep(e, p) === r) hits.push({p:p, e:e, day:day, task:addDays(day, -r.offset)});
        });
      });
    }
    if (!hits.length) return '<span class="hint">Ingen avtaler de neste tre ukene passer.</span>';
    return '<ul class="pvl">'+hits.map(function(h){
      return '<li><b>'+esc(h.p === 'all' ? 'Hele familien' : nameOf(h.p))+'</b> · '+esc(h.e.title)+' '+esc(WD_LONG[wd(h.day)]+' '+dateShort(h.day))+
        ' → oppgave '+esc(whenRel(h.task, t))+'</li>';
    }).join('')+'</ul>';
  }
  function prepEditorHTML(r){
    var who = r.who;
    var chips = '<button type="button" class="chip" data-act="p-who" data-id="'+r.id+'" data-who="all" aria-pressed="'+(who==='all')+'">Alle</button>'+
      '<button type="button" class="chip" data-act="p-who" data-id="'+r.id+'" data-who="kids" aria-pressed="'+(who==='kids')+'">Barna</button>'+
      members.map(function(m){
        return '<button type="button" class="chip person" style="--c:var(--pal-'+m.color+')" data-act="p-who" data-id="'+r.id+'" data-who="'+m.id+'" aria-pressed="'+(Array.isArray(who) && who.indexOf(m.id) > -1)+'">'+esc(nameOf(m.id))+'</button>';
      }).join('');
    var offs = PREP_OFFSETS.map(function(o){
      return '<button type="button" class="chip" data-act="p-off" data-id="'+r.id+'" data-n="'+o.n+'" aria-pressed="'+(r.offset===o.n)+'">'+o.l+'</button>';
    }).join('');
    var confirming = state.confirm === 'prep:'+r.id;
    return '<div class="rule-edit">'+
      '<div class="field"><label class="label" for="ptitle-'+r.id+'">Oppgave</label><input class="tinput ptitle" id="ptitle-'+r.id+'" data-pid="'+r.id+'" value="'+esc(r.title)+'" maxlength="40" placeholder="F.eks. Pakke sekken"></div>'+
      '<div class="field"><label class="label" for="pwords-'+r.id+'">Når tittelen inneholder</label><input class="tinput pwords" id="pwords-'+r.id+'" data-pid="'+r.id+'" value="'+esc(r.words)+'" maxlength="200" autocomplete="off" placeholder="F.eks. trening, kamp">'+
        '<span class="hint">Skill ordene med komma. Store og små bokstaver spiller ingen rolle, og ordet kan stå inni et annet («trening» finner «Håndballtrening»).</span></div>'+
      '<div class="field"><span class="label">Gjelder</span><div class="chips">'+chips+'</div></div>'+
      '<div class="field"><span class="label">Når</span><div class="chips">'+offs+'</div></div>'+
      '<label class="toggle" for="ppack-'+r.id+'"><input type="checkbox" id="ppack-'+r.id+'" data-act="p-pack" data-id="'+r.id+'"'+(r.pack?' checked':'')+'>Vis pakkelista <small>fra «Husk:» i beskrivelsen</small></label>'+
      '<div class="field"><span class="label">Neste treff</span><div id="pv-'+r.id+'">'+prepPreviewHTML(r)+'</div></div>'+
      '<div class="rule-actions"><button type="button" class="btn" data-act="p-close" data-id="'+r.id+'">Ferdig</button>'+
        '<button type="button" class="linkbtn danger'+(confirming?' confirm':'')+'" data-act="p-delete" data-id="'+r.id+'">'+(confirming ? 'Trykk igjen for å slette' : 'Slett regelen')+'</button></div>'+
    '</div>';
  }
  function prepRuleHTML(r){
    var open = state.editPrep === r.id;
    var dots = prepPeople(r).slice(0,4).map(function(id){ return '<i style="background:var(--pal-'+P[id].color+')"></i>'; }).join('');
    return '<div class="rule'+(open?' open':'')+'">'+
      '<button type="button" class="rule-head" data-act="p-edit" data-id="'+r.id+'" aria-expanded="'+open+'">'+
        '<span class="rule-dots" aria-hidden="true">'+dots+'</span>'+
        '<span class="rule-txt"><span class="rule-title" id="pt-'+r.id+'">'+esc(r.title.trim() || 'Uten navn')+'</span>'+
        '<span class="rule-sum" id="ps-'+r.id+'">'+esc(prepSummary(r))+'</span></span>'+ICON_DOWN+
      '</button>'+(open ? prepEditorHTML(r) : '')+'</div>';
  }
  function prepsChanged(){ savePreps(); renderSettings(); render(); }

  /* ---------- Innstillinger: varsler ---------- */
  function ntoggle(act, on, label, small){
    return '<label class="toggle" for="'+act+'"><input type="checkbox" id="'+act+'" data-act="'+act+'"'+(on ? ' checked' : '')+'>'+label+(small ? ' <small>'+small+'</small>' : '')+'</label>';
  }
  function notifPreviewHTML(){
    var list = notificationsFor(today());
    state.notifList = list;
    if (!list.length) return '<p class="hint">Ingen varsler i dag med disse innstillingene.</p>';
    return members.map(function(m){
      var mine = list.map(function(n,i){ return {n:n, i:i}; }).filter(function(x){ return x.n.who === m.id; });
      if (!mine.length) return '';
      return '<div class="npv"><h4>'+esc(nameOf(m.id))+' · '+mine.length+' '+(mine.length === 1 ? 'varsel' : 'varsler')+'</h4><ul>'+mine.map(function(x){
        var n = x.n;
        return '<li class="nrow'+(n.done ? ' done' : '')+'"><span class="ntime">'+n.time+'</span>'+
          '<span class="nbody"><b>'+esc(n.title)+'</b><small>'+esc(n.body)+'</small></span>'+
          (n.done ? '<span class="nstate">Gjort, sendes ikke</span>' : '<button type="button" class="chip" data-act="n-show" data-i="'+x.i+'">Vis</button>')+'</li>';
      }).join('')+'</ul></div>';
    }).join('');
  }
  function notifSettingsHTML(){
    var own = !canAdmin();
    var people = members.filter(function(m){ return !own || m.id === DB.myMember; }).map(function(m){
      var pn = personNotif(m.id);
      return '<div class="ncard" style="--c:var(--pal-'+m.color+')"><div class="mrow">'+
          '<span class="avatar sm" aria-hidden="true">'+esc(initialOf(m))+'</span>'+
          '<span class="ntxt"><b>'+esc(nameOf(m.id))+'</b><small>'+(pn.phone === 'iphone' ? 'iPhone' : 'Android')+' · '+phoneStatus(m.id)+'</small></span>'+
          '<label class="toggle" for="non-'+m.id+'"><input type="checkbox" id="non-'+m.id+'" data-act="n-on" data-id="'+m.id+'"'+(pn.on ? ' checked' : '')+'>Varsler</label>'+
        '</div>'+
        '<div class="field"><span class="label">Telefon</span><div class="chips">'+
          '<button type="button" class="chip" data-act="n-phone" data-id="'+m.id+'" data-p="android" aria-pressed="'+(pn.phone === 'android')+'">Android</button>'+
          '<button type="button" class="chip" data-act="n-phone" data-id="'+m.id+'" data-p="iphone" aria-pressed="'+(pn.phone === 'iphone')+'">iPhone</button>'+
        '</div></div>'+
        '<div class="field"><span class="label">Appen åpner på</span><div class="chips">'+
          '<button type="button" class="chip" data-act="n-start" data-id="'+m.id+'" data-s="family" aria-pressed="'+(pn.start === 'family')+'">Familien</button>'+
          '<button type="button" class="chip" data-act="n-start" data-id="'+m.id+'" data-s="me" aria-pressed="'+(pn.start === 'me')+'">Min dag</button>'+
          '<button type="button" class="linkbtn" data-act="me" data-id="'+m.id+'">Se Min dag</button>'+
        '</div></div>'+
        (pn.on ? '<div class="field"><span class="label">Påminnelse om kvelden</span><div class="chips">'+NOTIF_TIMES.map(function(t){
          return '<button type="button" class="chip" data-act="n-time" data-id="'+m.id+'" data-t="'+t+'" aria-pressed="'+(pn.time === t)+'">'+t+'</button>';
        }).join('')+'</div></div>' : '')+
      '</div>';
    }).join('');
    var leads = notif.dinner ? '<div class="chips" style="padding-left:28px">'+NOTIF_LEADS.map(function(l){
      return '<button type="button" class="chip" data-act="n-lead" data-l="'+l+'" aria-pressed="'+(notif.dinnerLead === l)+'">'+(l === 90 ? '1 t 30 min' : l === 60 ? '1 time' : l+' min')+' før</button>';
    }).join('')+'</div>' : '';
    if (own) return '<h3 class="label">Dine valg</h3><p class="hint">Gjelder mobilen din. Nettbrettet viser alltid familien.</p>'+people+setupHTML();
    return '<h3 class="label">Mobilene</h3><p class="hint">Nettbrettet viser alltid familien. På mobilen åpner appen der hver person har valgt, og varselet åpner samme sted.</p>'+people+
      '<h3 class="label">Hva det varsles om</h3><div class="ntoggles">'+
        ntoggle('n-prep', notif.prep, 'Forberedelser som ikke er gjort', 'om kvelden, med «Gjort»-knapp')+
        ntoggle('n-chores', notif.chores, 'Faste oppgaver som ikke er gjort', 'om kvelden')+
        ntoggle('n-dinner', notif.dinner, 'Middagsansvar', 'før middag')+leads+
        ntoggle('n-ride', notif.ride, 'Skyss som mangler', 'til de voksne, kvelden før og to timer før')+
        ntoggle('n-morning', notif.morning, 'Morgenoversikt kl. 07:00', 'dagens avtaler')+
        ntoggle('n-escalate', notif.escalate, 'Si fra til de voksne', 'en time etter barnets påminnelse, hvis forberedelsen ikke er gjort')+
      '</div>'+
      '<h3 class="label">Varsler i dag</h3><div id="npreview">'+notifPreviewHTML()+'</div>'+
      '<button type="button" class="btn" data-act="n-evening">'+ICON_BELL+'Vis kveldssjekken på nettbrettet nå</button>'+
      setupHTML();
  }
  function setupHTML(){
    var on = members.filter(function(m){ return personNotif(m.id).on && (canAdmin() || m.id === DB.myMember); });
    var andr = on.filter(function(m){ return personNotif(m.id).phone === 'android'; }).map(function(m){ return m.id; });
    var iph = on.filter(function(m){ return personNotif(m.id).phone === 'iphone'; }).map(function(m){ return m.id; });
    if (!andr.length && !iph.length) return '';
    return '<h3 class="label">Slik kobles mobilen til</h3>'+
      (andr.length ? '<div class="setup"><h4>Android · '+esc(names(andr))+'</h4><ol>'+
        '<li>Åpne familiekalenderen i Chrome og koble til med en kode fra nettbrettet (Innstillinger → Enheter).</li>'+
        '<li>Trykk på menyen ⋮ og velg «Installer app» eller «Legg til på startskjermen».</li>'+
        '<li>Åpne appen og trykk «Slå på varsler». Velg «Tillat».</li></ol>'+
        '<p class="hint">Varselet har knappen «Gjort», så oppgaven kan krysses av uten å åpne appen.</p></div>' : '')+
      (iph.length ? '<div class="setup"><h4>iPhone · '+esc(names(iph))+'</h4><ol>'+
        '<li>Åpne familiekalenderen i Safari.</li>'+
        '<li>Trykk på Del-knappen og velg «Legg til på Hjem-skjerm».</li>'+
        '<li>Åpne appen fra ikonet på Hjem-skjermen, ikke fra Safari, og koble til med en kode fra nettbrettet der. En kobling gjort i Safari følger ikke med til ikonet.</li>'+
        '<li>Trykk «Slå på varsler» og velg «Tillat».</li></ol>'+
        '<p class="hint">Krever iOS 16.4 eller nyere. Velges «Ikke tillat», kommer spørsmålet ikke igjen; da må ikonet fjernes og legges til på nytt. iPhone viser ikke knapper i varselet. Et trykk på varselet åpner appen på «Min dag», der oppgaven krysses av.</p></div>' : '');
  }
  function notifChanged(){ saveNotif(); renderSettings(); render(); }
  function refreshNotifPreview(){ var el = $('npreview'); if (el && !$('settings').hidden && state.stab === 'notif') el.innerHTML = notifPreviewHTML(); }

  var toastTimer = null;
  function showToast(n){
    state.toast = n;
    var iphone = personNotif(n.who).phone === 'iphone';
    var acts = '';
    if (iphone){
      acts += '<button type="button" data-act="nt-open">Åpne</button>';
    } else {
      if (n.key && !n.done) acts += '<button type="button" data-act="nt-done">Gjort</button>';
      if (n.rideKey) acts += '<button type="button" data-act="nt-ride">Jeg kjører</button>';
    }
    acts += '<button type="button" data-act="nt-close">Lukk</button>';
    var el = $('ntoast');
    el.innerHTML = '<div class="nt-app"><span class="nt-icon" aria-hidden="true"></span>Familiekalender · '+esc(n.time)+' · til '+esc(nameOf(n.who))+' ('+(iphone ? 'iPhone' : 'Android')+')</div>'+
      '<div class="nt-title">'+esc(n.title)+'</div><div class="nt-body">'+esc(n.body)+'</div>'+
      (iphone ? '<div class="nt-hint">iPhone viser ikke knapper i varselet. Et trykk åpner appen på '+(personNotif(n.who).start === 'me' ? '«Min dag»' : 'familievisningen')+', der oppgaven krysses av.</div>' : '')+
      '<div class="nt-actions">'+acts+'</div>';
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 12000);
  }
  function hideToast(){ $('ntoast').hidden = true; state.toast = null; clearTimeout(toastTimer); }

  var SETTINGS_TABS = ['family','chores','prep','notif','devices'];
  function settingsTabs(){ return canAdmin() ? SETTINGS_TABS : ['notif','devices']; }   // barna endrer bare sine egne valg
  function renderSettings(){
    var tabs = settingsTabs();
    if (tabs.indexOf(state.stab) < 0) state.stab = tabs[0];
    var tab = state.stab;
    var fam = tab === 'family';
    SETTINGS_TABS.forEach(function(t){ $('st-'+t).hidden = tabs.indexOf(t) < 0; $('st-'+t).setAttribute('aria-pressed', String(tab === t)); });
    $('addBtn').hidden = tab === 'notif' || tab === 'devices';
    $('resetBtn').hidden = true;
    if (tab === 'devices'){
      $('settingsBody').innerHTML = devicesHTML();
      $('settingsNote').textContent = canAdmin()
        ? 'Hver enhet kobles til én gang med en kode. Fjernes en enhet, må den få en ny kode for å komme inn igjen.'
        : 'Vil du bruke en annen telefon, får du en ny kode fra nettbrettet eller en voksen.';
    } else if (tab === 'notif'){
      $('settingsBody').innerHTML = notifSettingsHTML();
      $('settingsNote').textContent = 'Varslene sendes ikke til mobilene ennå; det kommer når mobilene kobles til. Her ser du hva som vil bli sendt, og «Vis» viser hvordan det ser ut.';
    } else if (tab === 'prep'){
      $('settingsBody').innerHTML =
        '<p class="hint">Oppgaver som dukker opp av seg selv når en avtale nærmer seg, i kolonnen til den avtalen gjelder. Passer flere regler, gjelder den med det lengste ordet.</p>'+
        preps.rules.map(prepRuleHTML).join('')+
        '<label class="toggle" for="pfallback"><input type="checkbox" id="pfallback" data-act="p-fallback"'+(preps.fallback?' checked':'')+'>Alt med «Husk:» i beskrivelsen gir «Pakke» dagen før <small>når ingen regel passer</small></label>';
      $('addLabel').textContent = 'Ny forberedelse';
      $('addBtn').disabled = false;
      $('settingsNote').textContent = 'Avtaler for hele familien får én felles oppgave i linja for hele familien.';
    } else if (fam){
      $('settingsBody').innerHTML = '<h3 class="label">Familiemedlemmer · '+members.length+' av '+MAX_MEMBERS+'</h3>'+members.map(memberCardHTML).join('')+gcalInfoHTML();
      $('addLabel').textContent = 'Legg til familiemedlem';
      $('addBtn').disabled = members.length >= MAX_MEMBERS;
      $('settingsNote').textContent = 'Rekkefølgen her er rekkefølgen på kolonnene. Endringer lagres for hele familien og vises på alle enheter med en gang.';
    } else {
      var dinnerRules = activeRules().filter(function(r){ return r.dinner; });
      var other = activeRules().filter(function(r){ return !r.dinner; });
      $('settingsBody').innerHTML =
        (dinnerRules.length ? '<h3 class="label">Middagsansvar</h3>'+dinnerRules.map(ruleHTML).join('') : '')+
        '<h3 class="label">Andre oppgaver</h3>'+(other.length ? other.map(ruleHTML).join('') : '<p class="hint">Ingen andre oppgaver ennå.</p>');
      $('addLabel').textContent = 'Ny oppgave';
      $('addBtn').disabled = false;
      $('settingsNote').textContent = 'Endringer gjelder fra i dag. Det som er gjort eller glemt tidligere, står som før. Én gangs bytter gjøres med «Bytt» på oppgaven i dagsvisningen.';
    }
    var rc = state.confirm === 'reset';
    $('resetBtn').textContent = rc ? 'Trykk igjen for å tilbakestille' : 'Tilbakestill';
    $('resetBtn').className = 'linkbtn' + (rc ? ' danger confirm' : '');
  }

  function selectorFor(b){
    return Object.keys(b.dataset).map(function(k){
      var attr = k.replace(/[A-Z]/g, function(c){ return '-'+c.toLowerCase(); });
      return '[data-'+attr+'="'+String(b.dataset[k]).replace(/"/g,'\\"')+'"]';
    }).join('');
  }
  function refocus(sel){ var el = sel && document.querySelector('#settings '+sel); if (el && !el.disabled) el.focus(); }

  function membersChanged(){ syncMembers(); saveMembers(); renderSettings(); render(); }
  function rulesChanged(){ saveRules(); renderSettings(); render(); }

  /* ---------- Tidshjul ---------- */
  // Hjulene går rundt: tallrekka gjentas mange ganger, og når hjulet stopper
  // flyttes det usynlig tilbake til midtre kopi med samme verdi.
  var ITEM_H = 44;
  var COPIES = {h:11, m:21};
  function wheelN(kind){ return kind === 'h' ? 24 : 12; }
  function wheelStep(kind){ return kind === 'h' ? 1 : 5; }
  function midAbs(kind, v){ return Math.floor(COPIES[kind]/2)*wheelN(kind) + v; }
  function reduceMotion(){ return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function wheelHTML(k, kind, idx){
    var n = wheelN(kind), step = wheelStep(kind), total = n*COPIES[kind], abs = midAbs(kind, idx), v = idx*step;
    var items = '';
    for (var a=0;a<total;a++) items += '<div class="witem'+(a===abs ? ' on' : '')+'" data-act="wpick" data-a="'+a+'" aria-hidden="true">'+pad((a % n)*step)+'</div>';
    return '<div class="wcol"><div class="wheel" id="w'+kind+'-'+k+'" role="spinbutton" tabindex="0" data-wheel="'+kind+'" data-date="'+k+'" data-idx="'+idx+'" data-abs="'+abs+'" data-total="'+total+'" '+
      'aria-label="'+(kind === 'h' ? 'Time' : 'Minutter')+'" aria-valuemin="0" aria-valuemax="'+(kind === 'h' ? 23 : 55)+'" aria-valuenow="'+v+'" aria-valuetext="'+pad(v)+'">'+
      '<div class="wpad"></div>'+items+'<div class="wpad"></div></div>'+
      '<span class="wcap" aria-hidden="true">'+(kind === 'h' ? 'Time' : 'Min')+'</span></div>';
  }
  function timeFieldHTML(k, time){
    var p = (validTime(time) ? time : DEFAULT_TIME).split(':').map(Number);
    var hi = p[0], mi = Math.min(11, Math.round(p[1]/5));
    return '<div class="field"><span class="label" id="tl-'+k+'">Klokkeslett</span>'+
      '<div class="wheels" role="group" aria-labelledby="tl-'+k+'"><div class="wsel" aria-hidden="true"></div>'+
        wheelHTML(k,'h',hi)+'<span class="wcolon" aria-hidden="true">:</span>'+wheelHTML(k,'m',mi)+
      '</div><input type="hidden" id="time-'+k+'" value="'+pad(hi)+':'+pad(mi*5)+'"></div>';
  }
  function clampAbs(w, a){ return Math.max(0, Math.min(Number(w.dataset.total)-1, a)); }
  function markWheel(w, abs){
    var kind = w.dataset.wheel, n = wheelN(kind);
    var idx = ((abs % n) + n) % n, v = idx*wheelStep(kind);
    var prev = w.querySelector('.witem.on'); if (prev) prev.classList.remove('on');
    var it = w.children[abs+1]; if (it) it.classList.add('on');   // +1: første barn er topp-luften
    w.dataset.abs = String(abs);
    w.dataset.idx = String(idx);
    w.setAttribute('aria-valuenow', String(v));
    w.setAttribute('aria-valuetext', pad(v));
    var k = w.dataset.date, h = $('wh-'+k), m = $('wm-'+k), hid = $('time-'+k);
    if (h && m && hid) hid.value = pad(Number(h.dataset.idx))+':'+pad(Number(m.dataset.idx)*5);
  }
  function setWheel(w, abs, smooth){
    abs = clampAbs(w, abs);
    markWheel(w, abs);
    var top = abs*ITEM_H;
    if (typeof w.scrollTo === 'function') w.scrollTo({top:top, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto'});
    else w.scrollTop = top;
  }
  function recenter(w){
    var target = midAbs(w.dataset.wheel, Number(w.dataset.idx));
    if (Number(w.dataset.abs) !== target){ markWheel(w, target); w.scrollTop = target*ITEM_H; }
  }
  function initWheels(k){
    ['h','m'].forEach(function(kind){
      var w = $('w'+kind+'-'+k);
      if (!w) return;
      w.scrollTop = Number(w.dataset.abs)*ITEM_H;
      var timer = null;
      w.addEventListener('scroll', function(){
        var a = clampAbs(w, Math.round(w.scrollTop/ITEM_H));
        if (a !== Number(w.dataset.abs)) markWheel(w, a);
        clearTimeout(timer);
        timer = setTimeout(function(){ recenter(w); }, 160);
      }, {passive:true});
      w.addEventListener('scrollend', function(){ clearTimeout(timer); recenter(w); });
    });
  }

  /* ---------- Middagsplan ---------- */
  function dinnerRowHTML(d){
    var k = iso(d);
    var din = dinnerFor(d);
    var cooks = cooksFor(d);
    var editing = state.dinnerEdit === k;
    var html = '<button type="button" class="drow'+(isToday(d) ? ' today' : '')+(din ? '' : ' empty')+'" data-act="dinner-edit" data-date="'+k+'" aria-expanded="'+editing+'">'+
      '<span class="d-date">'+pad(d.getDate())+'.'+pad(d.getMonth()+1)+'.</span>'+
      '<span class="d-wd">'+dayName(d)+'</span>'+
      '<span class="d-text"><span>'+(din ? esc(din.dish) : 'Ikke bestemt')+'</span>'+(cooks.length ? '<small>'+esc(names(cooks))+' lager</small>' : '')+'</span>'+
      '<span class="d-time">'+(din ? din.time : '–')+'</span></button>';
    if (editing){
      html += '<div class="dedit">'+
        '<div class="field"><label class="label" for="dish-'+k+'">Middag '+dayName(d).toLowerCase()+' '+dateLong(d)+'</label>'+
          '<input class="tinput" id="dish-'+k+'" maxlength="60" value="'+esc(din ? din.dish : '')+'" placeholder="Hva blir det?" enterkeyhint="done"></div>'+
        timeFieldHTML(k, din ? din.time : DEFAULT_TIME)+
        '<div class="field"><span class="label">Forslag</span><div class="chips">'+recentDishes().map(function(x){
          return '<button type="button" class="chip" data-act="dinner-pick" data-date="'+k+'" data-dish="'+esc(x)+'">'+esc(x)+'</button>';
        }).join('')+'</div></div>'+
        '<div class="rule-actions"><span class="btnrow">'+
          '<button type="button" class="btn primary" data-act="dinner-save" data-date="'+k+'">Lagre</button>'+
          '<button type="button" class="btn" data-act="dinner-cancel" data-date="'+k+'">Avbryt</button></span>'+
          (din ? '<button type="button" class="linkbtn danger" data-act="dinner-clear" data-date="'+k+'">Fjern middagen</button>' : '')+
        '</div></div>';
    }
    return html;
  }

  function renderDinnerList(){
    var t = today();
    var html = '', lastWeek = null;
    for (var i=0; i<state.dinnerDays; i++){
      var d = addDays(t, i);
      var wk = isoWeek(d);
      if (wk !== lastWeek){ html += '<h3 class="label dweek">'+weekLabel(d)+'</h3>'; lastWeek = wk; }
      html += dinnerRowHTML(d);
    }
    $('dinnerList').innerHTML = html;
    $('dinnerMore').disabled = state.dinnerDays >= 91;
    if (state.dinnerEdit) initWheels(state.dinnerEdit);
  }

  function focusDinnerRow(k){ var b = document.querySelector('.drow[data-date="'+k+'"]'); if (b) b.focus(); }

  function saveDinner(k, dish, time){
    dish = (dish || '').trim();
    dinnerEdits[k] = dish ? {dish:dish, time: validTime(time) ? time : DEFAULT_TIME} : {dish:''};
    saveDinnerEdits(k);
    state.dinnerEdit = null;
    renderDinnerList(); render();
    focusDinnerRow(k);
  }

  /* ---------- Klokke og buss ---------- */
  function renderClock(){
    $('clock').textContent = hhmm(new Date());
  }

  /* ---------- Kollektiv: sanntid fra Entur (AtB og tog) ---------- */
  // Faste strekninger. Holdeplass-ID-er finnes på stoppested.entur.org. lines: tom liste = alle linjer på strekningen.
  // Entur er gratis, uten nøkkel, men krever ET-Client-Name. Kun reiser uten bytte vises.
  var TRANSIT = {
    api:'https://api.entur.io/journey-planner/v3/graphql',
    client:'nervikpetersen-familiekalender',
    refreshSec:60,
    count:4,
    routes:[
      {badge:'16', type:'bus', fromName:'Marcus Thranes vei', toName:'City Syd',
       from:'NSR:StopPlace:42422', to:'NSR:StopPlace:44032', lines:['ATB:Line:2_16'],
       demo:{every:15, offset:4, travel:6, towards:'Torgård via Tillerringen'}},
      {badge:'Tog', type:'rail', fromName:'Heimdal stasjon', toName:'Trondheim S',
       from:'NSR:StopPlace:60640', to:'NSR:StopPlace:59977', lines:[],
       demo:{every:30, offset:9, travel:14, towards:'', platform:'2'}}
    ]
  };
  var transit = { data:null, fetchedAt:null, failed:false };

  function transitQuery(){
    return '{ '+TRANSIT.routes.map(function(r,i){
      var wl = r.lines.length ? ', whiteListed: { lines: '+JSON.stringify(r.lines)+' }' : '';
      return 'r'+i+': trip(from: { place: "'+r.from+'" }, to: { place: "'+r.to+'" }, numTripPatterns: 8, searchWindow: 180, '+
        'modes: { accessMode: foot, egressMode: foot, transportModes: [{ transportMode: '+r.type+' }] }'+wl+') '+
        '{ tripPatterns { legs { mode realtime aimedStartTime expectedStartTime aimedEndTime expectedEndTime '+
        'fromPlace { quay { publicCode } } line { id publicCode } serviceJourney { id } '+
        'fromEstimatedCall { cancellation destinationDisplay { frontText } } } } }';
    }).join(' ')+' }';
  }

  function parseTransit(json){
    return TRANSIT.routes.map(function(r,i){
      var pats = (json.data && json.data['r'+i] && json.data['r'+i].tripPatterns) || [];
      var seen = {}, deps = [];
      pats.forEach(function(p){
        var legs = (p.legs || []).filter(function(l){ return l.mode !== 'foot'; });
        if (legs.length !== 1) return;                                   // bare direkte reiser
        var l = legs[0];
        if (r.lines.length && (!l.line || r.lines.indexOf(l.line.id) < 0)) return;
        var id = (l.serviceJourney && l.serviceJourney.id) || l.aimedStartTime;
        if (seen[id]) return; seen[id] = true;
        var call = l.fromEstimatedCall || {};
        deps.push({
          dep:new Date(l.expectedStartTime), aimed:new Date(l.aimedStartTime), arr:new Date(l.expectedEndTime),
          realtime:!!l.realtime, cancelled:!!call.cancellation,
          line:(l.line && l.line.publicCode) || '',
          towards:(call.destinationDisplay && call.destinationDisplay.frontText) || '',
          platform:(l.fromPlace && l.fromPlace.quay && l.fromPlace.quay.publicCode) || ''
        });
      });
      deps.sort(function(a,b){ return a.dep - b.dep; });
      return {route:r, deps:deps};
    });
  }

  function transitLive(){ return !!transit.data; }
  function transitView(){ return transit.data || TRANSIT.routes.map(function(r){ return {route:r, deps:[], waiting:true}; }); }
  function upcoming(deps){ var now = Date.now(); return deps.filter(function(a){ return a.dep - now > -30000; }); }
  function omText(d){
    var ms = d - Date.now();
    if (ms < 60000) return 'nå';
    var m = Math.floor(ms/60000);
    return m < 60 ? m+' min' : hhmm(d);
  }

  function fetchTransit(){
    if (typeof fetch !== 'function'){ transit.failed = true; renderTransit(); return; }
    var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function(){ ctrl.abort(); }, 10000) : null;
    fetch(TRANSIT.api, {
      method:'POST',
      headers:{'Content-Type':'application/json', 'ET-Client-Name':TRANSIT.client},
      body:JSON.stringify({query:transitQuery()}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function(res){
      if (!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    }).then(function(json){
      if (json.errors && json.errors.length) throw new Error(json.errors[0].message);
      transit.data = parseTransit(json);
      transit.fetchedAt = new Date();
      transit.failed = false;
    }).catch(function(){
      transit.failed = true;
    }).then(function(){
      if (timer) clearTimeout(timer);
      renderTransit();
    });
  }

  function renderTransitWidget(){
    var spoken = [];
    $('transitBtn').innerHTML = transitView().map(function(x){
      var r = x.route;
      var ok = upcoming(x.deps).filter(function(a){ return !a.cancelled; });
      var first = ok[0], second = ok[1];
      var badge = '<span class="tbadge '+r.type+'">'+esc(r.badge)+'</span>';
      var label = r.type === 'bus' ? 'buss '+r.badge : 'tog';
      if (x.waiting){ spoken.push(label+': '+(transit.failed ? 'ingen kontakt' : 'henter')); return '<div class="trow">'+badge+'<span class="tnone">'+(transit.failed ? 'Ingen kontakt' : 'Henter …')+'</span></div>'; }
      if (!first){ spoken.push(label+': ingen direkte avganger'); return '<div class="trow">'+badge+'<span class="tnone">Ingen direkte avganger</span></div>'; }
      var late = transitLive() && first.realtime && Math.round((first.dep - first.aimed)/60000) >= 2;
      var om = omText(first.dep);
      var far = first.dep - Date.now() >= 3600000;
      spoken.push(label+' '+(far ? 'kl. '+om : om === 'nå' ? 'går nå' : 'om '+om));
      return '<div class="trow">'+badge+
        (transitLive() && first.realtime ? '<span class="tlive" aria-hidden="true"></span>' : '')+
        '<span class="tmin">'+om+'</span>'+
        (far ? '' : '<span class="tclock'+(late ? ' late' : '')+'">'+hhmm(first.dep)+'</span>')+
        (second ? '<span class="tnext">· '+hhmm(second.dep)+'</span>' : '')+'</div>';
    }).join('');
    $('transitBtn').setAttribute('aria-label', 'Avganger: '+spoken.join(', ')+'. Trykk for hele tavla.');
  }

  function depHTML(a, r){
    var live = transitLive();
    var late = Math.round((a.dep - a.aimed)/60000);
    var status;
    if (a.cancelled) status = '<span class="t-status bad">Innstilt</span>';
    else if (a.realtime && late >= 2) status = '<span class="t-status late">+'+late+' min</span>';
    else if (a.realtime) status = '<span class="t-status live">Sanntid</span>';
    else status = '<span class="t-status">Rutetid</span>';
    var planned = live && a.realtime && late >= 2 && !a.cancelled ? '<s>'+hhmm(a.aimed)+'</s>' : '';
    var far = a.dep - Date.now() >= 3600000;
    var det = [];
    if (r.type === 'rail' && a.line) det.push('<b>'+esc(a.line)+'</b>');
    if (a.towards) det.push('mot '+esc(a.towards));
    if (r.type === 'rail' && a.platform) det.push('spor '+esc(a.platform));
    return '<li class="tdep'+(a.cancelled ? ' cancelled' : '')+'"><span class="t-om">'+omText(a.dep)+'</span>'+
      '<span class="t-times">'+planned+(far ? '' : hhmm(a.dep)+' ')+'<span class="arr">→ fremme '+hhmm(a.arr)+'</span></span>'+
      status+(det.length ? '<span class="t-detail">'+det.join(' · ')+'</span>' : '')+'</li>';
  }

  function renderTransitDrawer(){
    $('transitBody').innerHTML = transitView().map(function(x){
      var r = x.route;
      var list = upcoming(x.deps).slice(0, TRANSIT.count);
      var running = list.filter(function(a){ return !a.cancelled; })[0];
      var travel = running ? Math.floor(running.arr/60000) - Math.floor(running.dep/60000) : null;
      var sub = (r.type === 'bus' ? 'Buss '+r.badge : 'Tog')+(travel ? ' · ca. '+travel+' min' : '');
      return '<article class="troute"><header class="troute-head"><span class="tbadge lg '+r.type+'" aria-hidden="true">'+esc(r.badge)+'</span>'+
        '<div><h3>'+esc(r.fromName)+' <span class="muted">→</span> '+esc(r.toName)+'</h3><p>'+esc(sub)+'</p></div></header>'+
        (x.waiting ? '<p class="hint">'+(transit.failed ? 'Ingen kontakt med Entur ennå.' : 'Henter avganger …')+'</p>' :
         list.length ? '<ol class="tlist">'+list.map(function(a){ return depHTML(a, r); }).join('')+'</ol>'
                     : '<p class="hint">Ingen direkte avganger de neste tre timene.</p>')+'</article>';
    }).join('');
    var note;
    if (transitLive() && !transit.failed) note = 'Sanntid fra Entur og AtB. Oppdatert '+hhmm(transit.fetchedAt)+', hentes hvert minutt.';
    else if (transitLive()) note = 'Får ikke kontakt med Entur. Viser tider fra '+hhmm(transit.fetchedAt)+' og prøver igjen om ett minutt.';
    else if (transit.failed) note = 'Får ikke kontakt med Entur. Sjekk nettet; prøver igjen om ett minutt.';
    else note = 'Henter avganger fra Entur …';
    $('transitNote').textContent = note;
  }

  function renderTransit(){
    renderTransitWidget();
    if (!$('transit').hidden) renderTransitDrawer();
  }

  var lastMin = -1, lastDay = iso(new Date());
  function tick(){
    renderClock();
    renderTransit();
    var n = new Date();
    if (iso(n) !== lastDay){
      if (iso(state.cursor) === lastDay) state.cursor = today();
      lastDay = iso(n);
      render();
    } else if (n.getMinutes() !== lastMin){
      lastMin = n.getMinutes();
      if ((state.view === 'day' || state.view === 'me') && isToday(state.cursor)) renderMain();
    }
  }

  /* ---------- Snakk med kalenderen (demo) ---------- */
  var chat = { msgs:[{role:'bot', text:'Hei! Skriv det du vil legge inn eller spørre om. I prototypen svarer jeg på forslagene under.'}], typing:false };

  function renderChat(){
    var el = $('msgs');
    el.innerHTML = chat.msgs.map(function(m,i){
      return '<div class="msg '+m.role+'">'+esc(m.text)+
        (m.actions ? '<div class="msg-actions">'+m.actions.map(function(a,j){
          return '<button type="button" class="chip" data-act="chatact" data-i="'+i+'" data-j="'+j+'">'+esc(a.label)+'</button>';
        }).join('')+'</div>' : '')+'</div>';
    }).join('') + (chat.typing ? '<div class="msg bot typing" aria-label="Skriver"><span></span><span></span><span></span></div>' : '');
    el.scrollTop = el.scrollHeight;
  }

  function say(userText, replyFn){
    chat.msgs.push({role:'user', text:userText});
    chat.typing = true;
    renderChat();
    setTimeout(function(){
      chat.typing = false;
      chat.msgs.push(replyFn());
      renderChat();
      render();
    }, 650);
  }

  function nextSaturday(){ var t = today(); return addDays(t, (5 - wd(t) + 7) % 7 || 7); }
  function matchPlayer(){
    var ol = members.filter(function(m){ return m.name.toLowerCase() === 'oliver'; })[0];
    if (ol) return ol.id;
    var kid = members.filter(function(m){ return m.kid; })[0];
    return (kid || members[0]).id;
  }

  function demoMatch(){
    var who = matchPlayer();
    var sat = nextSaturday();
    var k = iso(sat);
    var when = WD_LONG[wd(sat)]+' '+dateLong(sat);
    state.extras[k] = state.extras[k] || [];
    var existing = state.extras[k].filter(function(e){ return e.id === 'x-kamp'; })[0];
    if (existing) return {role:'bot', text:'Kampen ligger allerede inne '+when+' kl. 12:00: «'+existing.title+'».'};
    var title = writeCode(who)+' - Håndballkamp';
    var bring = ['drakt','innesko','drikkeflaske'];
    state.extras[k].push({id:'x-kamp', title:title, start:'12:00', end:'13:30', place:'Hallen', desc:buildDesc([], '', true, bring)});
    var key = k+'|x-kamp';
    var dr = drivers();
    return {
      role:'bot',
      text:'Lagt inn i Google Kalender («familie»): «'+title+'» '+when+', 12:00–13:30 i hallen. Den vises nå også på mobilene deres.\n\nBeskrivelse:\n'+buildDesc([], '', true, bring)+(dr.length ? '\n\nHvem kjører?' : ''),
      actions: dr.length ? dr.map(function(x){
        return {label:nameOf(x), fn:function(){
          state.drivers[key] = x;
          var extra = nameOf(x).toLowerCase() === 'magne' ? '\n\n'+nameOf(x)+' er uansett i hallen på dugnad til kl. 14, så det passer fint.' : '';
          return {role:'bot', text:'Notert: '+nameOf(x)+' kjører '+nameOf(who)+' til kampen. Beskrivelsen i Google Kalender er oppdatert:\n'+buildDesc([], nameOf(x), true, bring)+extra};
        }};
      }) : null
    };
  }

  function demoTomorrow(){
    var t = addDays(today(), 1);
    var lines = eventsFor(t).map(function(e){
      var r = e.needsRide ? (e.driverName ? ' ('+e.driverName+' kjører)' : ' (mangler sjåfør)') : '';
      return '• '+e.start+' '+evWho(e)+': '+e.title+r;
    });
    var cooks = cooksFor(t);
    var din = dinnerFor(t);
    return {role:'bot', text:dayName(t)+' '+dateLong(t)+':\n'+(lines.join('\n') || 'Ingen avtaler.')+'\n\nMiddag: '+(din ? din.dish+' kl. '+din.time : 'ikke bestemt ennå')+(cooks.length ? ' ('+names(cooks)+' lager).' : '. Ingen har middagsansvar.')};
  }

  function demoDinners(){
    var t = today();
    var rows = [];
    for (var i=wd(t); i<7; i++){
      var d = addDays(t, i - wd(t));
      var cooks = cooksFor(d);
      var din = dinnerFor(d);
      rows.push('• '+dayName(d)+': '+(din ? din.dish+' kl. '+din.time : 'ikke bestemt')+' ('+(cooks.length ? names(cooks) : 'ingen satt')+')');
    }
    return {role:'bot', text:'Middager resten av uka:\n'+rows.join('\n')};
  }

  function suggestions(){
    return [
      {text:nameOf(matchPlayer())+' har kamp lørdag kl. 12 i hallen', fn:demoMatch},
      {text:'Hva skjer i morgen?', fn:demoTomorrow},
      {text:'Hva blir middag resten av uka?', fn:demoDinners}
    ];
  }

  function freeText(text){
    var t = text.toLowerCase();
    if (t.indexOf('kamp') > -1) return demoMatch;
    if (t.indexOf('i morgen') > -1) return demoTomorrow;
    if (t.indexOf('middag') > -1) return demoDinners;
    return function(){
      return {role:'bot', text:'I prototypen kan jeg bare svare på forslagene under. Når Claude er koblet på, forstår jeg vanlig tekst og tale, og legger det rett inn i kalenderen.'};
    };
  }

  /* ---------- Skuffer ---------- */
  var lastOpener = null;
  function openDrawer(id, opener){
    closeDrawers(true);
    lastOpener = opener || null;
    $(id).hidden = false; $('scrim').hidden = false;
    if (id === 'chat'){
      renderChat();
      $('suggest').innerHTML = suggestions().map(function(s,i){
        return '<button type="button" class="chip" data-act="suggest" data-i="'+i+'">'+esc(s.text)+'</button>';
      }).join('');
      // På nettbrett åpnes ikke tastaturet før man trykker i feltet
      setTimeout(function(){ if (!COARSE) $('chatInput').focus(); else { var c = document.querySelector('#chat [data-act="close-drawers"]'); if (c) c.focus({preventScroll:true}); } }, 30);
    } else if (id === 'transit'){
      renderTransitDrawer();
      fetchTransit();
      setTimeout(function(){ var c = document.querySelector('#transit [data-act="close-drawers"]'); if (c) c.focus(); }, 30);
    } else if (id === 'dinners'){
      state.dinnerEdit = null;
      renderDinnerList();
      $('dinnerList').scrollTop = 0;
      setTimeout(function(){ focusDinnerRow(iso(today())); }, 30);
    } else {
      state.confirm = null;
      renderSettings();
      loadDevices();
      if (state.pair && state.pair.code && !state.pair.used) watchCode();
      setTimeout(function(){ $('st-'+state.stab).focus(); }, 30);
    }
  }
  var DRAWERS = ['chat','settings','dinners','transit'];
  function anyDrawerOpen(){ return DRAWERS.some(function(id){ return !$(id).hidden; }); }
  function closeDrawers(silent){
    var wasOpen = anyDrawerOpen();
    DRAWERS.forEach(function(id){ $(id).hidden = true; });
    $('scrim').hidden = true;
    state.dinnerEdit = null;
    state.confirm = null;
    if (!silent && wasOpen && lastOpener){
      var target = lastOpener.isConnected ? lastOpener : document.querySelector('[data-act="'+lastOpener.dataset.act+'"]');
      if (target) target.focus();
    }
  }

  /* ---------- Hendelser ---------- */
  document.addEventListener('click', function(ev){
    var b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    var act = b.dataset.act;
    var id = b.dataset.id;
    var r = id ? ruleById(id) : null;
    var sel = selectorFor(b);

    if (act === 'view'){ state.view = b.dataset.view; state.picker = null; render(); }
    else if (act === 'nav'){
      var dir = Number(b.dataset.dir);
      if (dir === 0) state.cursor = today();
      else state.cursor = addDays(state.cursor, dir * (state.view === 'day' || state.view === 'me' ? 1 : 7));
      state.picker = null; render();
    }
    else if (act === 'pickride'){ state.picker = state.picker === 'ride:'+b.dataset.key ? null : 'ride:'+b.dataset.key; renderMain(); }
    else if (act === 'me' && P[id]){
      state.me = id; state.view = 'me'; state.picker = null;
      closeDrawers(true); render();
      var mv = $('meView'); if (mv) mv.scrollTop = 0;
    }
    else if (act === 'setdriver'){ state.drivers[b.dataset.key] = b.dataset.who; state.picker = null; render(); }
    else if (act === 'pickswap'){
      state.picker = state.picker === 'swap:'+b.dataset.key ? null : 'swap:'+b.dataset.key; renderMain();
      var again = document.querySelector('.swapbtn[data-key="'+b.dataset.key+'"]'); if (again) again.focus();
    }
    else if (act === 'setswap'){
      setSwap(b.dataset.key, b.dataset.who === b.dataset.base ? null : b.dataset.who);
      state.picker = null; render();
    }
    else if (act === 'toggle'){
      var k = b.dataset.key;
      setDone(k, !state.done.has(k));
      render();
      var t = document.querySelector('.cchip[data-key="'+k+'"]'); if (t) t.focus();
    }
    else if (act === 'goto'){ state.cursor = fromIso(b.dataset.date); state.view = 'day'; render(); }
    else if (act === 'chat-open'){ openDrawer('chat', $('chatBtn')); }
    else if (act === 'settings-open'){ openDrawer('settings', $('settingsBtn')); }
    else if (act === 'close-drawers'){ closeDrawers(false); }
    /* middagsplan */
    else if (act === 'dinner-open'){ openDrawer('dinners', b); }
    else if (act === 'transit-open'){ openDrawer('transit', b); }
    else if (act === 'dinner-more'){ state.dinnerDays = Math.min(91, state.dinnerDays + 14); renderDinnerList(); }
    else if (act === 'dinner-edit'){
      var dk = b.dataset.date;
      state.dinnerEdit = state.dinnerEdit === dk ? null : dk;
      renderDinnerList();
      if (state.dinnerEdit){
        var inp = $('dish-'+dk);
        if (inp && !COARSE){ inp.focus(); if (inp.scrollIntoView) inp.scrollIntoView({block:'nearest'}); }
        else {
          // Nettbrett: ikke åpne tastaturet; forslag og tidshjul trenger det ikke
          var rowEl = document.querySelector('.drow[data-date="'+dk+'"]');
          if (rowEl) rowEl.focus({preventScroll:true});
          var ed = rowEl && rowEl.nextElementSibling;
          if (ed && ed.scrollIntoView) ed.scrollIntoView({block:'nearest'});
        }
      }
      else focusDinnerRow(dk);
    }
    else if (act === 'wpick'){
      var wh = b.closest('.wheel');
      if (!wh) return;
      setWheel(wh, Number(b.dataset.a), true);
      // Time først, så minutter
      var nextW = wh.dataset.wheel === 'h' ? $('wm-'+wh.dataset.date) : wh;
      if (nextW) nextW.focus({preventScroll:true});
    }
    else if (act === 'dinner-pick'){ var di = $('dish-'+b.dataset.date); if (di){ di.value = b.dataset.dish; if (!COARSE) di.focus(); } }
    else if (act === 'dinner-save'){ var ds = b.dataset.date; saveDinner(ds, ($('dish-'+ds) || {}).value, ($('time-'+ds) || {}).value); }
    else if (act === 'dinner-clear'){ saveDinner(b.dataset.date, '', DEFAULT_TIME); }
    else if (act === 'dinner-cancel'){ state.dinnerEdit = null; renderDinnerList(); focusDinnerRow(b.dataset.date); }
    else if (act === 'suggest'){ var s = suggestions()[Number(b.dataset.i)]; say(s.text, s.fn); }
    else if (act === 'chatact'){
      var msg = chat.msgs[Number(b.dataset.i)];
      if (!msg || !msg.actions) return;
      var a = msg.actions[Number(b.dataset.j)];
      delete msg.actions;
      say(a.label, a.fn);
    }
    /* innstillinger */
    else if (act === 'stab'){
      state.stab = b.dataset.tab; state.confirm = null; state.editRule = null; state.editPrep = null;
      if (state.stab === 'devices') loadDevices();
      renderSettings(); refocus(sel);
    }
    else if (act === 'd-code'){ state.confirm = null; makeCode(b.dataset.who); refocus(sel); }
    else if (act === 'd-unpair'){
      if (state.confirm === 'unpair') unpairThis();
      else { state.confirm = 'unpair'; renderSettings(); refocus(sel); }
    }
    else if (act === 'd-remove'){
      var rk = 'rm:'+b.dataset.uid;
      if (state.confirm === rk) removeDevice(b.dataset.uid);
      else { state.confirm = rk; renderSettings(); refocus(sel); }
    }
    else if (act === 'gate-retry'){ boot(); }
    else if (act === 'n-time' && P[id]){ personNotif(id).time = b.dataset.t; notifChanged(); refocus(sel); }
    else if (act === 'n-lead'){ notif.dinnerLead = Number(b.dataset.l); notifChanged(); refocus(sel); }
    else if (act === 'n-show'){ var nn = state.notifList[Number(b.dataset.i)]; if (nn) showToast(nn); }
    else if (act === 'n-evening'){ state.forceEvening = true; state.view = 'day'; state.cursor = today(); closeDrawers(true); render(); }
    else if (act === 'nt-close'){ hideToast(); }
    else if (act === 'n-phone' && P[id]){ personNotif(id).phone = b.dataset.p; notifChanged(); refocus(sel); }
    else if (act === 'n-start' && P[id]){ personNotif(id).start = b.dataset.s; notifChanged(); refocus(sel); }
    else if (act === 'nt-open' && state.toast){
      // Simulerer at varselet åpner appen der personen har valgt (Familien eller Min dag), med oppgaven markert
      var on = state.toast; hideToast(); closeDrawers(true);
      state.cursor = today();
      if (personNotif(on.who).start === 'me'){ state.view = 'me'; state.me = on.who; } else state.view = 'day';
      render();
      var target = on.key ? document.querySelector('input[data-key="'+on.key.replace(/"/g,'\\"')+'"]') : null;
      if (target){
        var row = target.closest('.chore, .fam-item') || target;
        row.classList.add('flash');
        setTimeout(function(){ row.classList.remove('flash'); }, 3400);
        if (row.scrollIntoView) row.scrollIntoView({block:'nearest'});
        target.focus({preventScroll:true});
      }
    }
    else if (act === 'nt-done' && state.toast){ setDone(state.toast.key, true); hideToast(); render(); refreshNotifPreview(); }
    else if (act === 'nt-ride' && state.toast){ state.drivers[state.toast.rideKey] = state.toast.who; hideToast(); render(); refreshNotifPreview(); }
    else if (act === 'p-edit'){ state.editPrep = state.editPrep === id ? null : id; state.confirm = null; renderSettings(); refocus(sel); }
    else if (act === 'p-close'){ state.editPrep = null; state.confirm = null; renderSettings(); refocus('[data-act="p-edit"][data-id="'+id+'"]'); }
    else if (act === 'p-who' && prepById(id)){
      var pr = prepById(id), pw = b.dataset.who;
      if (pw === 'all' || pw === 'kids') pr.who = pw;
      else {
        var list = Array.isArray(pr.who) ? pr.who.slice() : [];
        pr.who = list.indexOf(pw) > -1 ? list.filter(function(x){ return x !== pw; }) : list.concat([pw]);
      }
      prepsChanged(); refocus(sel);
    }
    else if (act === 'p-off' && prepById(id)){ prepById(id).offset = Number(b.dataset.n); prepsChanged(); refocus(sel); }
    else if (act === 'p-delete' && prepById(id)){
      if (state.confirm === 'prep:'+id){ preps.rules = preps.rules.filter(function(x){ return x.id !== id; }); state.editPrep = null; state.confirm = null; prepsChanged(); }
      else { state.confirm = 'prep:'+id; renderSettings(); refocus(sel); }
    }
    else if (act === 'color'){ P[id].color = b.dataset.color; state.confirm = null; membersChanged(); refocus(sel); }
    else if (act === 'move'){
      var i = members.findIndex(function(m){ return m.id === id; });
      var j = i + Number(b.dataset.dir);
      if (i < 0 || j < 0 || j >= members.length) return;
      var tmp = members[i]; members[i] = members[j]; members[j] = tmp;
      state.confirm = null; membersChanged();
      var mv = document.querySelector('#settings '+sel);
      if (mv && !mv.disabled) mv.focus(); else { var nm = $('name-'+id); if (nm) nm.focus(); }
    }
    else if (act === 'remove'){
      if (state.confirm === 'remove:'+id){ members = members.filter(function(m){ return m.id !== id; }); state.confirm = null; membersChanged(); }
      else { state.confirm = 'remove:'+id; renderSettings(); refocus(sel); }
    }
    else if (act === 'add'){
      state.confirm = null;
      if (state.stab === 'family'){
        if (members.length >= MAX_MEMBERS) return;
        var used = members.map(function(m){ return m.color; });
        var free = PALETTE.filter(function(p){ return used.indexOf(p.k) < 0; })[0] || PALETTE[0];
        var nid = newId();
        members.push({id:nid, name:'', color:free.k, kid:false, code:'', alias:''});
        membersChanged();
        var input = $('name-'+nid); if (input){ input.focus(); input.scrollIntoView({block:'nearest'}); }
      } else if (state.stab === 'prep'){
        var pid = newId();
        preps.rules.push({id:pid, title:'', words:'', who:'all', offset:1, pack:true});
        state.editPrep = pid;
        prepsChanged();
        var pt = $('ptitle-'+pid); if (pt){ if (!COARSE) pt.focus(); if (pt.scrollIntoView) pt.scrollIntoView({block:'nearest'}); }
      } else {
        var rid = newId();
        rules.push({id:rid, title:'', who:[members[0].id], mode:'each', days:[wd(today())], freq:'weekly', anchor:iso(mondayOf(today())), dinner:false, from:iso(today()), past:[]});
        state.editRule = rid;
        rulesChanged();
        var ti = $('title-'+rid); if (ti){ ti.focus(); ti.scrollIntoView({block:'nearest'}); }
      }
    }
    else if (act === 'r-edit'){ state.editRule = state.editRule === id ? null : id; state.confirm = null; renderSettings(); refocus(sel); }
    else if (act === 'r-close'){ state.editRule = null; state.confirm = null; renderSettings(); refocus('[data-act="r-edit"][data-id="'+id+'"]'); }
    else if (r && act === 'r-all'){ beginEdit(r); r.who = r.who === 'all' ? [members[0].id] : 'all'; rulesChanged(); refocus(sel); }
    else if (r && act === 'r-who'){
      beginEdit(r);
      var w = b.dataset.who;
      if (r.who === 'all') r.who = [w];
      else if (r.who.indexOf(w) > -1) r.who = r.who.filter(function(x){ return x !== w; });
      else r.who = r.who.concat([w]);
      rulesChanged(); refocus(sel);
    }
    else if (r && act === 'r-mode'){ beginEdit(r); r.mode = b.dataset.mode; rulesChanged(); refocus(sel); }
    else if (r && act === 'r-day'){
      beginEdit(r);
      var dd = Number(b.dataset.day);
      r.days = r.days.indexOf(dd) > -1 ? r.days.filter(function(x){ return x !== dd; }) : r.days.concat([dd]).sort(function(a,b){ return a-b; });
      rulesChanged(); refocus(sel);
    }
    else if (r && act === 'r-everyday'){ beginEdit(r); r.days = r.days.length === 7 ? [] : [0,1,2,3,4,5,6]; rulesChanged(); refocus(sel); }
    else if (r && act === 'r-freq'){
      beginEdit(r);
      r.freq = b.dataset.freq;
      if (r.freq === 'biweekly') r.anchor = iso(mondayOf(today()));
      rulesChanged(); refocus(sel);
    }
    else if (r && act === 'r-start'){ beginEdit(r); r.anchor = iso(addDays(mondayOf(today()), b.dataset.start === 'next' ? 7 : 0)); rulesChanged(); refocus(sel); }
    else if (r && act === 'r-delete'){
      if (state.confirm === 'rule:'+id){
        // Oppgaver som har vært i bruk før i dag avsluttes i stedet for å slettes, så historikken står
        var hasHistory = r.from < iso(today()) || r.past.length;
        if (hasHistory) r.ended = iso(today());
        else rules = rules.filter(function(x){ return x.id !== id; });
        state.editRule = null; state.confirm = null; rulesChanged();
      }
      else { state.confirm = 'rule:'+id; renderSettings(); refocus(sel); }
    }
  });

  document.addEventListener('input', function(ev){
    var t = ev.target;
    if (!t.classList) return;
    if (t.classList.contains('mname')){
      var m = P[t.dataset.id];
      if (!m) return;
      var old = m.name;
      m.name = t.value;
      // Koden følger navnet så lenge den ikke er endret for hånd
      if (normCode(m.code) === defaultCode(old)){
        m.code = defaultCode(m.name);
        var ci = $('code-'+m.id); if (ci){ ci.value = m.code; ci.placeholder = defaultCode(m.name) || 'AB'; }
      }
      saveMembers();
      var av = $('av-'+m.id); if (av) av.textContent = initialOf(m);
      updateCodeHints();
      render();
    } else if (t.classList.contains('mcodein') || t.classList.contains('maliasin')){
      var mc = P[t.dataset.id];
      if (!mc) return;
      if (t.classList.contains('mcodein')){
        var v = normCode(t.value);
        if (t.value !== v) t.value = v;
        mc.code = v;
      } else mc.alias = t.value;
      saveMembers();
      updateCodeHints();
      render();
    } else if (t.classList.contains('ptitle') || t.classList.contains('pwords')){
      var pr = prepById(t.dataset.pid);
      if (!pr) return;
      if (t.classList.contains('ptitle')){
        pr.title = t.value;
        var ph = $('pt-'+pr.id); if (ph) ph.textContent = pr.title.trim() || 'Uten navn';
      } else {
        pr.words = t.value;
        var ps = $('ps-'+pr.id); if (ps) ps.textContent = prepSummary(pr);
        var pv = $('pv-'+pr.id); if (pv) pv.innerHTML = prepPreviewHTML(pr);
      }
      savePreps();
      render();
    } else if (t.classList.contains('rtitle')){
      var r = ruleById(t.dataset.rid);
      if (!r) return;
      r.title = t.value;
      saveRules();
      var rt = $('rt-'+r.id); if (rt) rt.textContent = r.title.trim() || 'Uten navn';
      render();
    }
  });

  document.addEventListener('change', function(ev){
    var t = ev.target;
    if (!t.dataset) return;
    var keep = t.id;
    if (t.dataset.act === 'chore'){
      setDone(t.dataset.key, t.checked);
      renderMain();
    } else if (t.dataset.act === 'kid'){
      var m = P[t.dataset.id]; if (!m) return;
      m.kid = t.checked; membersChanged();
    } else if (t.dataset.act === 'r-dinner'){
      var r = ruleById(t.dataset.id); if (!r) return;
      r.dinner = t.checked; rulesChanged();
    } else if (t.dataset.act === 'p-pack'){
      var pr = prepById(t.dataset.id); if (!pr) return;
      pr.pack = t.checked; prepsChanged();
    } else if (t.dataset.act === 'p-fallback'){
      preps.fallback = t.checked; prepsChanged();
    } else if (t.dataset.act === 'n-on' && P[t.dataset.id]){
      personNotif(t.dataset.id).on = t.checked; notifChanged();
    } else if (['n-prep','n-chores','n-dinner','n-ride','n-morning','n-escalate'].indexOf(t.dataset.act) > -1){
      notif[t.dataset.act.slice(2)] = t.checked; notifChanged();
    } else return;
    var again = document.getElementById(keep); if (again) again.focus();
  });

  document.addEventListener('keydown', function(ev){
    var tg = ev.target;
    if (tg.dataset && tg.dataset.wheel){
      var cur = Number(tg.dataset.abs), kind = tg.dataset.wheel, nx = null;
      if (ev.key === 'ArrowUp') nx = cur-1;
      else if (ev.key === 'ArrowDown') nx = cur+1;
      else if (ev.key === 'PageUp') nx = cur-3;
      else if (ev.key === 'PageDown') nx = cur+3;
      else if (ev.key === 'Home') nx = midAbs(kind, 0);
      else if (ev.key === 'End') nx = midAbs(kind, wheelN(kind)-1);
      else if (ev.key === 'ArrowRight' && tg.dataset.wheel === 'h'){ ev.preventDefault(); $('wm-'+tg.dataset.date).focus({preventScroll:true}); return; }
      else if (ev.key === 'ArrowLeft' && tg.dataset.wheel === 'm'){ ev.preventDefault(); $('wh-'+tg.dataset.date).focus({preventScroll:true}); return; }
      if (nx !== null){ ev.preventDefault(); setWheel(tg, nx, true); return; }
    }
    if (ev.key === 'Enter' && ((tg.id && tg.id.indexOf('dish-') === 0) || (tg.dataset && tg.dataset.wheel))){
      ev.preventDefault();
      var k = tg.dataset && tg.dataset.wheel ? tg.dataset.date : tg.id.slice(5);
      saveDinner(k, ($('dish-'+k) || {}).value, ($('time-'+k) || {}).value);
      return;
    }
    if (ev.key === 'Escape' && state.dinnerEdit && !$('dinners').hidden){ var ek = state.dinnerEdit; state.dinnerEdit = null; renderDinnerList(); focusDinnerRow(ek); return; }
    if (ev.key === 'Escape' && anyDrawerOpen()){ closeDrawers(false); return; }
    var card = ev.target.closest && ev.target.closest('.daycard');
    if (card && (ev.key === 'Enter' || ev.key === ' ')){ ev.preventDefault(); card.click(); }
  });

  $('composer').addEventListener('submit', function(ev){
    ev.preventDefault();
    var input = $('chatInput');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    say(text, freeText(text));
  });

  /* Fullskjerm og våken skjerm (nettbrett) */
  $('fsBtn').addEventListener('click', function(){
    try {
      var p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(function(){ $('fsBtn').title = 'Fullskjerm er ikke tilgjengelig her'; });
    } catch(e){ $('fsBtn').title = 'Fullskjerm er ikke tilgjengelig her'; }
  });

  var wakeLock = null;
  function keepAwake(){
    if (wakeLock || !('wakeLock' in navigator)) return;
    try {
      navigator.wakeLock.request('screen').then(function(l){
        wakeLock = l;
        $('wake').textContent = 'Skjermen holdes våken';
        l.addEventListener('release', function(){ wakeLock = null; $('wake').textContent = ''; });
      }).catch(function(){});
    } catch(e){}
  }
  document.addEventListener('pointerdown', keepAwake);
  document.addEventListener('visibilitychange', function(){ if (document.visibilityState === 'visible') keepAwake(); });

  /* Tastatur på nettbrett: hold skuffen over tastaturet og det aktive feltet synlig */
  var vvBase = 0;
  function syncViewport(){
    var vv = window.visualViewport;
    if (!vv) return;
    var root = document.documentElement;
    var a = document.activeElement;
    var typing = !!(a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && ['checkbox','hidden','radio'].indexOf(a.type) < 0)));
    if (!typing || !vvBase) vvBase = vv.height;
    var kb = typing && vv.height < vvBase*0.85;
    root.style.setProperty('--vv-h', vv.height+'px');
    root.style.setProperty('--vv-top', vv.offsetTop+'px');
    root.classList.toggle('kb', kb);
    if (kb && a.scrollIntoView) a.scrollIntoView({block:'nearest'});
  }
  if (window.visualViewport){
    window.visualViewport.addEventListener('resize', syncViewport);
    window.visualViewport.addEventListener('scroll', syncViewport);
    document.addEventListener('focusin', function(){ setTimeout(syncViewport, 60); });
    document.addEventListener('focusout', function(){ setTimeout(syncViewport, 60); });
    syncViewport();
  }

  /* ---------- Været (Meteorologisk institutt, api.met.no) ---------- */
  var WEATHER = {lat:63.35, lon:10.36, api:'https://api.met.no/weatherapi/locationforecast/2.0/compact', refreshMin:30};
  var WX_TEXT = {
    clearsky:'Klarvær', fair:'Lettskyet', partlycloudy:'Delvis skyet', cloudy:'Skyet', fog:'Tåke',
    lightrain:'Lett regn', rain:'Regn', heavyrain:'Kraftig regn',
    lightrainshowers:'Lette regnbyger', rainshowers:'Regnbyger', heavyrainshowers:'Kraftige regnbyger',
    lightsleet:'Lett sludd', sleet:'Sludd', heavysleet:'Kraftig sludd',
    lightsleetshowers:'Lette sluddbyger', sleetshowers:'Sluddbyger', heavysleetshowers:'Kraftige sluddbyger',
    lightsnow:'Lett snø', snow:'Snø', heavysnow:'Kraftig snø',
    lightsnowshowers:'Lette snøbyger', snowshowers:'Snøbyger', heavysnowshowers:'Kraftige snøbyger'
  };
  var WX_ICON = {
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
    part:'<path d="M8 3.5v1.5M3.5 8H5M4.8 4.8l1 1M12 5.6A4 4 0 0 0 5 9.2"/><path d="M8 19a4 4 0 1 1 .7-7.9A5 5 0 0 1 18 12a3.5 3.5 0 0 1 0 7H8z"/>',
    cloud:'<path d="M7 18a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18 11a3.5 3.5 0 0 1 0 7H7z"/>',
    fog:'<path d="M7 13a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18 6a3.5 3.5 0 0 1 0 7"/><path d="M4 17h16M6 21h12"/>',
    rain:'<path d="M7 15a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 0 7H7z"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>',
    snow:'<path d="M7 15a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 0 7H7z"/><path d="M8 19.5h.01M12 18.5h.01M16 19.5h.01M10 21.5h.01M14 21.5h.01"/>',
    storm:'<path d="M7 15a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18 8a3.5 3.5 0 0 1 0 7H7z"/><path d="M12.5 15l-2 3.5h3l-2 3.5"/>'
  };
  function wxBase(code){ return String(code || '').replace(/_(day|night|polartwilight)$/, ''); }
  function wxText(code){
    var b = wxBase(code);
    var thunder = /andthunder$/.test(b);
    var t = WX_TEXT[b.replace(/andthunder$/, '')] || '';
    return thunder ? (t ? t+' og torden' : 'Torden') : t;
  }
  function wxIcon(code){
    var b = wxBase(code), night = /_night$/.test(code || '');
    if (/thunder/.test(b)) return WX_ICON.storm;
    if (/snow|sleet/.test(b)) return WX_ICON.snow;
    if (/rain/.test(b)) return WX_ICON.rain;
    if (b === 'fog') return WX_ICON.fog;
    if (b === 'cloudy') return WX_ICON.cloud;
    if (b === 'partlycloudy' || b === 'fair') return night ? WX_ICON.cloud : WX_ICON.part;
    if (b === 'clearsky') return night ? WX_ICON.moon : WX_ICON.sun;
    return WX_ICON.cloud;
  }
  function wxAt(series, when){
    var best = null, bd = Infinity;
    series.forEach(function(e){ var d = Math.abs(new Date(e.time) - when); if (d < bd){ bd = d; best = e; } });
    return bd <= 90*60000 ? best : null;
  }
  function renderWeather(json){
    var series = (json && json.properties && json.properties.timeseries) || [];
    var now = wxAt(series, new Date());
    if (!now) return;
    var inst = now.data.instant.details;
    var next = now.data.next_1_hours || now.data.next_6_hours || {};
    var code = next.summary && next.summary.symbol_code;
    var temp = Math.round(inst.air_temperature);
    var n = new Date(), later, laterTxt;
    if (n.getHours() < 17){ later = new Date(n.getFullYear(), n.getMonth(), n.getDate(), 20); laterTxt = 'i kveld'; }
    else { later = new Date(n.getFullYear(), n.getMonth(), n.getDate()+1, 8); laterTxt = 'i morgen tidlig'; }
    var le = wxAt(series, later);
    var lt = le ? Math.round(le.data.instant.details.air_temperature) : null;
    var txt = wxText(code);
    $('weather').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'+wxIcon(code)+'</svg>'+
      '<div class="wmain"><b>'+temp+'°</b> '+esc(txt)+(lt !== null ? ' <span class="wextra">· '+lt+'° '+laterTxt+'</span>' : '')+'</div>';
    $('weather').setAttribute('aria-label', 'Været: '+temp+' grader'+(txt ? ', '+txt.toLowerCase() : '')+(lt !== null ? '. '+lt+' grader '+laterTxt : ''));
  }
  function fetchWeather(){
    if (typeof fetch !== 'function') return;
    fetch(WEATHER.api+'?lat='+WEATHER.lat+'&lon='+WEATHER.lon).then(function(res){
      if (!res.ok) throw new Error('HTTP '+res.status);
      return res.json();
    }).then(renderWeather).catch(function(e){
      console.warn('[familiekalender] været', e);
      var w = $('weather').querySelector('.wextra'); if (w && /Henter/.test(w.textContent)) w.textContent = 'Været er ikke tilgjengelig';
    });
  }

  /* ---------- Enheter: paring med kode ---------- */
  // Hver enhet logger inn anonymt og kobles til familien med en kode som en voksen eller nettbrettet lager.
  // Koden virker i 30 minutter og bare én gang.
  var SITE = location.host || 'familiekalender-np.netlify.app';
  function deviceLabel(){
    var ua = navigator.userAgent || '';
    var ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var dev = /iPhone/.test(ua) ? 'iPhone' : ipad ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android-mobil' : 'Android-nettbrett') :
      /Windows/.test(ua) ? 'PC' : /Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Enhet';
    var br = /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /EdgA?\/|Edg\//.test(ua) ? 'Edge' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' :
      /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
    return dev + (isStandalone() ? ' · app' : br ? ' · '+br : '');
  }
  function isStandalone(){ return !!((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone); }
  function isIOS(){ var ua = navigator.userAgent || ''; return /iPhone|iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); }
  function fmtCode(raw){ raw = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8); return raw.length > 4 ? raw.slice(0,4)+'-'+raw.slice(4) : raw; }
  function errText(e){
    var m = (e && (e.message || e.error_description || e.msg)) || '';
    if (/fetch|network|Load failed|NetworkError/i.test(m) || (e && e.name === 'TypeError')) return 'Får ikke kontakt. Sjekk nettet og prøv igjen.';
    return m || 'Noe gikk galt. Prøv igjen.';
  }
  function deviceWho(d){
    if (d.role === 'tablet') return 'Felles nettbrett';
    return d.member_id && P[d.member_id] ? nameOf(d.member_id) : 'Ukjent person';
  }
  function phoneStatus(id){
    var n = (DB.devices || []).filter(function(d){ return d.member_id === id; }).length;
    return n ? (n === 1 ? 'koblet til' : n+' enheter koblet til') : 'ikke koblet til ennå';
  }
  function loadDevices(){
    return q(sb.from('household_users').select('user_id, member_id, role, device_label, created_at').eq('household_id', DB.household).order('created_at'))
      .then(function(rows){ DB.devices = rows; if (!$('settings').hidden && (state.stab === 'devices' || state.stab === 'notif')) renderSettings(); })
      .catch(function(e){ console.warn('[familiekalender] enheter', e); });
  }
  function deviceRowHTML(d, mine){
    var color = d.member_id && P[d.member_id] ? 'var(--pal-'+P[d.member_id].color+')' : 'var(--accent)';
    var conf = state.confirm === 'rm:'+d.user_id;
    return '<div class="dev" style="--c:'+color+'"><span class="dev-dot" aria-hidden="true"></span>'+
      '<span class="ntxt"><b>'+esc(d.device_label || 'Enhet uten navn')+(mine ? ' <span class="dev-this">denne enheten</span>' : '')+'</b>'+
      '<small>'+esc(deviceWho(d))+(d.created_at ? ' · koblet til '+dateShort(new Date(d.created_at)) : '')+'</small></span>'+
      (!mine && canAdmin() ? '<button type="button" class="linkbtn danger'+(conf ? ' confirm' : '')+'" data-act="d-remove" data-uid="'+d.user_id+'">'+(conf ? 'Trykk igjen for å fjerne' : 'Fjern')+'</button>' : '')+
    '</div>';
  }
  function pairPanelHTML(){
    var pr = state.pair;
    if (!pr) return '';
    var who = pr.who ? nameOf(pr.who) : 'det felles nettbrettet';
    if (pr.busy) return '<div class="paircode" role="status"><p class="hint">Lager kode …</p></div>';
    if (pr.error) return '<div class="paircode bad" role="alert"><p>'+esc(pr.error)+'</p></div>';
    if (pr.used) return '<div class="paircode ok" role="status"><div class="pc-for">'+esc(who)+'</div><p class="pc-done">Enheten er koblet til.</p></div>';
    var expired = Date.now() > pr.expires;
    var iphone = pr.who && personNotif(pr.who).phone === 'iphone';
    return '<div class="paircode'+(expired ? ' old' : '')+'" role="status">'+
      '<div class="pc-for">Kode for '+esc(who)+'</div>'+
      '<div class="pc-code" aria-label="Koden er '+esc(pr.code.split('').join(' '))+'">'+esc(pr.code)+'</div>'+
      '<div class="pc-exp">'+(expired ? 'Koden er utløpt. Lag en ny.' : 'Gjelder til kl. '+hhmm(new Date(pr.expires))+', én gang')+'</div>'+
      (expired ? '' : '<ol><li>Åpne <b>'+esc(SITE)+'</b> på den nye enheten.</li><li>Skriv inn koden og trykk «Koble til».</li></ol>'+
        (iphone ? '<p class="hint">iPhone: Legg siden til på Hjem-skjermen først (Del → «Legg til på Hjem-skjerm»), åpne den fra ikonet og skriv inn koden der.</p>' : ''))+
    '</div>';
  }
  function devicesHTML(){
    var list = DB.devices || [];
    var mine = list.filter(function(d){ return d.user_id === DB.uid; })[0] ||
      {user_id:DB.uid, role:DB.role, member_id:DB.myMember, device_label:DB.label, created_at:null};
    var unconf = state.confirm === 'unpair';
    var html = '<h3 class="label">Denne enheten</h3>'+deviceRowHTML(mine, true)+
      '<div class="dev-actions"><button type="button" class="linkbtn danger'+(unconf ? ' confirm' : '')+'" data-act="d-unpair">'+
        (unconf ? 'Trykk igjen for å koble fra' : 'Koble fra denne enheten')+'</button></div>';
    if (!canAdmin()) return html;
    html += '<h3 class="label">Koble til en ny enhet</h3>'+
      '<p class="hint">Velg hvem den nye enheten tilhører, så får du en kode å skrive inn på den.</p>'+
      '<div class="chips"><button type="button" class="chip" data-act="d-code" data-who=""'+(state.pair && !state.pair.who ? ' aria-pressed="true"' : '')+'>Nettbrett (felles)</button>'+
      members.map(function(m){
        return '<button type="button" class="chip" data-act="d-code" data-who="'+m.id+'"'+(state.pair && state.pair.who === m.id ? ' aria-pressed="true"' : '')+'>'+esc(m.name || 'Uten navn')+'</button>';
      }).join('')+'</div>'+pairPanelHTML();
    var others = list.filter(function(d){ return d.user_id !== DB.uid; });
    html += '<h3 class="label">Andre enheter · '+others.length+'</h3>'+
      (others.length ? others.map(function(d){ return deviceRowHTML(d, false); }).join('') : '<p class="hint">Ingen andre enheter er koblet til ennå.</p>');
    return html;
  }
  var pairPoll = null;
  function makeCode(who){
    state.pair = {who:who || null, busy:true};
    renderSettings();
    sb.rpc('create_pairing_code', {p_member: who || null}).then(function(res){
      if (res.error) throw res.error;
      state.pair = {who:who || null, code:res.data, expires:Date.now() + 30*60000};
    }).catch(function(e){
      state.pair = {who:who || null, error:'Kunne ikke lage kode. '+errText(e)};
    }).then(function(){
      renderSettings();
      watchCode();
    });
  }
  // Sjekker om koden er brukt, så den som viser koden ser at det gikk
  function watchCode(){
    clearInterval(pairPoll);
    var pr = state.pair;
    if (!pr || !pr.code) return;
    pairPoll = setInterval(function(){
      if (state.pair !== pr || $('settings').hidden || Date.now() > pr.expires){ clearInterval(pairPoll); if (state.pair === pr) renderSettings(); return; }
      q(sb.from('pairing_codes').select('used_at').eq('code', pr.code.replace(/-/g,'')).maybeSingle()).then(function(row){
        if (row && row.used_at && state.pair === pr){ pr.used = true; clearInterval(pairPoll); loadDevices(); renderSettings(); }
      }).catch(function(){});
    }, 4000);
  }
  function removeDevice(uid){
    state.confirm = null;
    dbDone(sb.from('household_users').delete().eq('user_id', uid), 'enheten').then(loadDevices);
  }
  function unpairThis(){
    state.confirm = null;
    syncStatus('Kobler fra …');
    sb.from('household_users').delete().eq('user_id', DB.uid).then(function(res){
      if (res.error) throw res.error;
      return sb.auth.signOut();
    }).then(function(){
      resetSession();
      closeDrawers(true);
      syncStatus('');
      boot();
    }).catch(function(e){ syncStatus('Kunne ikke koble fra. '+errText(e), true); });
  }
  function resetSession(){
    if (DB.channel){ try { sb.removeChannel(DB.channel); } catch(e){} }
    DB.household = DB.role = DB.myMember = DB.label = null; DB.channel = null; DB.devices = null;
    members = []; syncMembers(); rules = []; preps.rules = []; dinnerEdits = {};
    state.done = new Set(); state.swaps = {}; state.pair = null; state.view = 'day'; state.me = null;
  }

  /* ---------- Oppstart ---------- */
  function gate(mode, msg){
    $('gate').hidden = false;
    document.querySelector('.app').setAttribute('aria-hidden', 'true');
    var body = $('gateBody');
    if (mode === 'loading'){
      body.innerHTML = '<p class="gate-wait" role="status">Kobler til …</p>';
      return;
    }
    if (mode === 'error'){
      body.innerHTML = '<p class="gate-err" role="alert">'+esc(msg)+'</p><button type="button" class="btn primary" data-act="gate-retry">Prøv igjen</button>';
      return;
    }
    var ios = isIOS() && !isStandalone();
    body.innerHTML =
      '<p class="gate-lead">Koble denne enheten til familien med en kode. Koden lages på nettbrettet eller av en voksen under Innstillinger → Enheter.</p>'+
      (ios ? '<div class="gate-ios"><b>På iPhone og iPad:</b> Legg siden til på Hjem-skjermen først. Trykk Del-knappen og velg «Legg til på Hjem-skjerm». Åpne Familiekalender fra ikonet og skriv inn koden der. En kobling gjort her i Safari følger ikke med til ikonet.</div>' : '')+
      '<form class="gate-form" id="pairForm" autocomplete="off" novalidate>'+
        '<label class="label" for="pairCode">Kode</label>'+
        '<input id="pairCode" class="gate-code" type="text" inputmode="text" autocapitalize="characters" autocomplete="one-time-code" autocorrect="off" spellcheck="false" maxlength="9" placeholder="ABCD-EFGH" aria-describedby="pairErr">'+
        '<p class="gate-err" id="pairErr" role="alert">'+(msg ? esc(msg) : '')+'</p>'+
        '<button type="submit" class="btn primary" id="pairBtn">Koble til</button>'+
      '</form>';
    var inp = $('pairCode');
    inp.addEventListener('input', function(){ inp.value = fmtCode(inp.value); $('pairErr').textContent = ''; });
    $('pairForm').addEventListener('submit', function(ev){
      ev.preventDefault();
      var code = inp.value.replace(/[^A-Za-z0-9]/g,'');
      if (code.length !== 8){ $('pairErr').textContent = 'Koden har åtte tegn, for eksempel ABCD-EFGH.'; inp.focus(); return; }
      var btn = $('pairBtn'); btn.disabled = true; btn.textContent = 'Kobler til …';
      sb.rpc('redeem_pairing_code', {p_code:code, p_label:deviceLabel()}).then(function(res){
        if (res.error) throw res.error;
        boot();
      }).catch(function(e){
        btn.disabled = false; btn.textContent = 'Koble til';
        $('pairErr').textContent = errText(e);
        inp.focus();
      });
    });
    if (!COARSE) inp.focus();
  }
  function gateHide(){ $('gate').hidden = true; document.querySelector('.app').removeAttribute('aria-hidden'); }

  function isAuthError(e){ return e && (e.status === 401 || e.code === 'PGRST301' || /JWT|refresh token|not authenticated/i.test(e.message || '')); }
  var booting = false, started = false, retriedAuth = false;
  function boot(){
    if (booting) return;
    if (!sb){ gate('error', 'Appen mangler oppsett for databasen (config.js).'); return; }
    booting = true;
    gate('loading');
    sb.auth.getSession().then(function(r){
      var s = r.data && r.data.session;
      if (s) return s;
      return sb.auth.signInAnonymously().then(function(r2){ if (r2.error) throw r2.error; return r2.data.session; });
    }).then(function(s){
      DB.uid = s.user.id;
      return q(sb.from('household_users').select('household_id, member_id, role, device_label').eq('user_id', DB.uid).maybeSingle());
    }).then(function(row){
      if (!row){ booting = false; gate('pair'); return; }
      DB.household = row.household_id; DB.role = row.role; DB.myMember = row.member_id; DB.label = row.device_label;
      return loadAll().then(function(){
        booting = false;
        retriedAuth = false;
        begin();
      });
    }).catch(function(e){
      booting = false;
      console.warn('[familiekalender] oppstart', e);
      if (isAuthError(e) && !retriedAuth){ retriedAuth = true; sb.auth.signOut().catch(function(){}).then(boot); return; }
      gate('error', 'Får ikke kontakt med familiekalenderen. '+errText(e));
    });
  }
  function begin(){
    subscribe();
    loadDevices();
    if (DB.role !== 'tablet' && DB.myMember && P[DB.myMember] && personNotif(DB.myMember).start === 'me'){ state.view = 'me'; state.me = DB.myMember; }
    gateHide();
    render();
    renderClock();
    renderTransit();
    if (started) return;
    started = true;
    fetchTransit();
    lastMin = new Date().getMinutes();
    setInterval(tick, 10000);
    setInterval(fetchTransit, TRANSIT.refreshSec*1000);
    setInterval(refreshAll, 10*60000);   // sikkerhetsnett i tillegg til sanntid
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState !== 'visible') return;
      fetchTransit();
      refreshAll();
    });
  }
  // Henter alt på nytt, og merker om enheten er fjernet av en voksen
  function refreshAll(){
    if (!DB.household || booting) return;
    q(sb.from('household_users').select('household_id').eq('user_id', DB.uid).maybeSingle()).then(function(row){
      if (!row){ resetSession(); closeDrawers(true); boot(); return; }
      return loadAll().then(function(){ syncStatus(''); afterRemoteChange(); });
    }).catch(function(e){
      console.warn('[familiekalender] oppdatering', e);
      syncStatus('Får ikke kontakt. Viser det som ble hentet sist.', true);
    });
  }

  seedDemoEvents();
  renderClock();
  fetchWeather();
  setInterval(fetchWeather, WEATHER.refreshMin*60000);
  boot();
})();
