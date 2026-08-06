import { chromium } from 'playwright';

const BIN = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ headless: true, executablePath: BIN, args: ['--no-sandbox'] });
const page = await browser.newPage();

page.on('console', m => console.log('  [browser]', m.text().slice(0, 200)));
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0, 200)));

await page.goto('http://localhost:3030/login', { waitUntil: 'domcontentloaded' });

const ergebnis = await page.evaluate(async () => {
  try {
    const mod = await import('/localaudio.js');
    const pruef = mod.lokalPruefen();
    if (!pruef.ok) return { schritt: 'pruefung', fehler: pruef.grund };

    // Winzige WAV-Datei erzeugen (1 Sek. Stille, 8 kHz mono)
    const rate = 8000, n = rate;
    const buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
    s(0,'RIFF'); dv.setUint32(4, 36 + n*2, true); s(8,'WAVEfmt ');
    dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
    dv.setUint32(24,rate,true); dv.setUint32(28,rate*2,true);
    dv.setUint16(32,2,true); dv.setUint16(34,16,true); s(36,'data');
    dv.setUint32(40, n*2, true);
    for (let i=0;i<n;i++) dv.setInt16(44+i*2, Math.sin(i/8)*3000, true);
    const datei = new File([buf], 'test.wav', { type: 'audio/wav' });

    const meldungen = [];
    const out = await mod.lokalAufbereiten(
      datei,
      { enhance: { enabled: true, strength: 50 }, trimSilence: { enabled: true, seconds: 2 } },
      (text, pct) => meldungen.push(`${text}${pct != null ? ' ' + pct + '%' : ''}`)
    );
    return { schritt: 'fertig', groesse: out.size, typ: out.type, meldungen: meldungen.slice(-4) };
  } catch (e) {
    return { schritt: 'ausnahme', fehler: e && e.message ? e.message : String(e) };
  }
});

console.log('\n=== ERGEBNIS ===');
console.log(JSON.stringify(ergebnis, null, 2));
await browser.close();
