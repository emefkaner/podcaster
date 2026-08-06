import { chromium } from 'playwright';
const BIN='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ headless:true, executablePath:BIN, args:['--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', e=>console.log('  [pageerror]', e.message.slice(0,160)));
await p.goto('http://localhost:3034/login',{waitUntil:'domcontentloaded'});
await p.fill('#password','pw'); await p.click('button[type=submit]');
await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const mod = await import('/localaudio.js');
  const s = await (await fetch('/api/settings')).json();
  const mkWav=(sek)=>{const rate=8000,n=rate*sek;const buf=new ArrayBuffer(44+n*2),dv=new DataView(buf);
    const w=(o,t)=>{for(let i=0;i<t.length;i++)dv.setUint8(o+i,t.charCodeAt(i));};
    w(0,'RIFF');dv.setUint32(4,36+n*2,true);w(8,'WAVEfmt ');dv.setUint32(16,16,true);
    dv.setUint16(20,1,true);dv.setUint16(22,1,true);dv.setUint32(24,rate,true);
    dv.setUint32(28,rate*2,true);dv.setUint16(32,2,true);dv.setUint16(34,16,true);
    w(36,'data');dv.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)dv.setInt16(44+i*2,Math.sin(i/8)*3000,true);
    return new File([buf],'t.wav',{type:'audio/wav'});};
  try{
    const opts={enhance:{enabled:true,strength:50},trimSilence:{enabled:true,seconds:2}};
    const t1=await mod.lokalAufbereiten(mkWav(2),opts,()=>{});
    const t2=await mod.lokalAufbereiten(mkWav(2),opts,()=>{});
    const folge=await mod.lokalZusammenbauen([t1,t2],{introUrl:s.introUrl,outroUrl:s.outroUrl},()=>{});
    return {ok:true, teile:[t1.size,t2.size], folgeBytes:folge.size, typ:folge.type};
  }catch(e){return {ok:false, fehler:e.message};}
});
console.log('\n=== DURCHLAUF ===');
console.log(JSON.stringify(r,null,2));
await b.close();
