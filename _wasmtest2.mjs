import { chromium } from 'playwright';
const BIN = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ headless: true, executablePath: BIN, args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('  [pageerror]', e.message.slice(0,200)));
await page.goto('http://localhost:3031/login', { waitUntil: 'domcontentloaded' });

const r = await page.evaluate(async () => {
  try {
    const mod = await import('/localaudio.js');
    const mkWav = (sek, freq) => {
      const rate = 8000, n = rate * sek;
      const buf = new ArrayBuffer(44 + n*2), dv = new DataView(buf);
      const s = (o,t)=>{for(let i=0;i<t.length;i++)dv.setUint8(o+i,t.charCodeAt(i));};
      s(0,'RIFF'); dv.setUint32(4,36+n*2,true); s(8,'WAVEfmt ');
      dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
      dv.setUint32(24,rate,true); dv.setUint32(28,rate*2,true);
      dv.setUint16(32,2,true); dv.setUint16(34,16,true); s(36,'data'); dv.setUint32(40,n*2,true);
      for(let i=0;i<n;i++) dv.setInt16(44+i*2, Math.sin(i/freq)*3000, true);
      return new File([buf],'x.wav',{type:'audio/wav'});
    };
    // zwei "Teile" aufbereiten
    const opts = { enhance:{enabled:true,strength:50}, trimSilence:{enabled:true,seconds:2} };
    const t1 = await mod.lokalAufbereiten(mkWav(2, 8), opts, ()=>{});
    const t2 = await mod.lokalAufbereiten(mkWav(2, 12), opts, ()=>{});
    // zusammenbauen mit Intro/Outro aus der App
    const schritte = [];
    const folge = await mod.lokalZusammenbauen(
      [t1, t2],
      { introUrl: '/media/assets/intro.wav', outroUrl: '/media/assets/outro.wav' },
      (text,pct)=>schritte.push(text)
    );
    return { ok:true, teil1:t1.size, teil2:t2.size, folge:folge.size, typ:folge.type,
             schritte:[...new Set(schritte)] };
  } catch(e){ return { ok:false, fehler: e&&e.message?e.message:String(e) }; }
});
console.log('\n=== ZUSAMMENBAU ===');
console.log(JSON.stringify(r, null, 2));
await browser.close();
