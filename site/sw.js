// Familiekalender: service worker bare for varsler (ingen mellomlagring av appen)
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function(e){
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err){ d = {title:'Familiekalender', body: e.data ? e.data.text() : ''}; }
  // Må alltid vise et varsel når push kommer, ellers trekker iPhone tilbake tillatelsen
  e.waitUntil(self.registration.showNotification(d.title || 'Familiekalender', {
    body: d.body || '',
    tag: d.tag || undefined,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    lang: 'nb',
    data: {url: d.url || '/', token: d.token || null},
    actions: Array.isArray(d.actions) ? d.actions : []
  }));
});

self.addEventListener('notificationclick', function(e){
  var data = e.notification.data || {};
  e.notification.close();
  // «Gjort» / «Jeg kjører» (Android): lagres uten å åpne appen
  if (e.action && data.token){
    e.waitUntil(fetch('/api/varsler', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({handling:e.action, token:data.token})}).catch(function(){}));
    return;
  }
  e.waitUntil(self.clients.matchAll({type:'window', includeUncontrolled:true}).then(function(list){
    for (var i=0;i<list.length;i++){ if ('focus' in list[i]) return list[i].focus(); }
    return self.clients.openWindow(data.url || '/');
  }));
});
