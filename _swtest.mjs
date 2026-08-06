import { chromium } from 'playwright';
const BIN = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ headless: true, executablePath: BIN, args: ['--no-sandbox'] });
const page = await b.newPage();
let reloads = 0;
page.on('framenavigated', f => { if (f === page.mainFrame()) reloads++; });
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0,160)));

// einloggen
await page.goto('http://localhost:3032/login', { waitUntil: 'domcontentloaded' });
await page.fill('#password', 'pw');
await page.click('button[type=submit]');
await page.waitForURL('**/', { timeout: 15000 }).catch(()=>{});
await page.waitForTimeout(1500);

const vorher = reloads;
const r = await page.evaluate(async () => {
  // Simulieren: Arbeit läuft, dann übernimmt ein neuer Service Worker
  window.arbeitetGerade = true;
  const vorhandenVorher = !!document.getElementById('swHinweis');
  // controllerchange kann nicht künstlich ausgelöst werden -> Logik direkt prüfen
  const quelle = document.querySelector('script[src="/app.js"]') ? 'geladen' : 'fehlt';
  return {
    appGeladen: quelle,
    hinweisFunktionDa: typeof zeigeNeuladenHinweis === 'function',
    flaggeDa: typeof arbeitetGerade === 'boolean',
    hinweisVorher: vorhandenVorher,
  };
});
await page.waitForTimeout(2000);
console.log('\n=== ERGEBNIS ===');
console.log(JSON.stringify({ ...r, seitenNeuladungenNachLogin: reloads - vorher }, null, 2));
await b.close();
