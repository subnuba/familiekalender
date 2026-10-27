// Kjører appens egen kode (site/app.js) uten nettleser, så varslene regnes ut nøyaktig som i appen.
// app.js ser window.__FK_SERVER og gir fra seg utregningen i stedet for å starte appen.
import vm from 'node:vm';
import kilde from './app-kilde.mjs';   // lages av netlify/bygg.mjs ved hver publisering

// Et «DOM» som godtar alt og ikke gjør noe (appen kobler opp knapper og felter når den lastes)
function stub(){
  const fn = function(){};
  const p = new Proxy(fn, {
    get(t, k){
      if (k === Symbol.toPrimitive) return () => '';
      if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function*(){};
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'length') return 0;
      return p;
    },
    set(){ return true; },
    apply(){ return p; },
    construct(){ return p; },
    has(){ return true; }
  });
  return p;
}

export function lastKjerne(){
  process.env.TZ = 'Europe/Oslo';   // familiens tid, ikke serverens
  let api = null;
  const noop = () => 0;
  const g = {
    console, URL, URLSearchParams, AbortController, TextEncoder, TextDecoder, atob, btoa,
    crypto: globalThis.crypto,
    setTimeout: noop, clearTimeout: noop, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    fetch: () => Promise.reject(new Error('ikke på serveren')),
    document: stub(), navigator: stub(), localStorage: stub(), sessionStorage: stub(),
    location: {host:'familiekalender-np.netlify.app', href:'https://familiekalender-np.netlify.app/'},
    FK_CONFIG: {}, supabase: undefined, matchMedia: undefined, visualViewport: undefined,
    __FK_SERVER: (a) => { api = a; }
  };
  g.window = g; g.self = g; g.globalThis = g;
  vm.runInContext(kilde, vm.createContext(g), {filename:'app.js'});
  if (!api) throw new Error('app.js ga ikke fra seg utregningen');
  return api;
}
