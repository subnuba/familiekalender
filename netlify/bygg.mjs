// Byggesteg på Netlify: legger appens kode inn i funksjonene, så varslene regnes ut med samme kode som appen.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../site/app.js', import.meta.url), 'utf8');
fs.writeFileSync(new URL('./lib/app-kilde.mjs', import.meta.url),
  '// Generert av netlify/bygg.mjs ved hver publisering. Ikke rediger.\nexport default ' + JSON.stringify(src) + ';\n');
console.log('app-kilde.mjs: ' + src.length + ' tegn');
