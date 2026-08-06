import { chromium } from 'playwright';
const BIN='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({headless:true,executablePath:BIN,args:['--no-sandbox']});
const p=await b.newPage();
p.on('pageerror',e=>console.log('  [pageerror]',e.message.slice(0,180)));
p.on('console',m=>{if(m.type()==='error')console.log('  [console]',m.text().slice(0,180));});

await p.goto('http://localhost:3040/login',{waitUntil:'domcontentloaded'});
await p.fill('#password','pw'); await p.click('button[type=submit]');
await p.waitForTimeout(1500);
await p.goto('http://localhost:3040/episode/e1',{waitUntil:'domcontentloaded'});
await p.waitForTimeout(1500);

const sichtbar = await p.evaluate(()=>({
  speichernDa: !!document.querySelector('#saveBtn'),
  speichernText: document.querySelector('#saveBtn')?.textContent?.trim(),
  textfeldDa: !!document.querySelector('#epDesc'),
  regenDa: !!document.querySelector('#regenBtn'),
  inhaltVorher: document.querySelector('#epDesc')?.value?.slice(0,40),
}));
console.log('  Zustand:', JSON.stringify(sichtbar));

// 1) Text ändern und speichern
await p.fill('#epDesc','MEIN HANDGESCHRIEBENER TEXT');
await p.fill('#epTitle','Geänderter Titel');
await p.click('#saveBtn');
await p.waitForTimeout(1200);
// neu laden und prüfen ob gespeichert
await p.reload({waitUntil:'domcontentloaded'});
await p.waitForTimeout(1500);
const nachReload = await p.evaluate(()=>({
  titel: document.querySelector('#epTitle')?.value,
  text: document.querySelector('#epDesc')?.value,
}));
console.log('  Nach Neuladen:', JSON.stringify(nachReload));

// 2) Neuen Text erzeugen lassen
const vorher = await p.inputValue('#epDesc');
await p.click('#regenBtn');
await p.waitForTimeout(3000);
const nachher = await p.inputValue('#epDesc');
console.log('  Textfeld vorher: ', JSON.stringify(vorher.slice(0,50)));
console.log('  Textfeld nachher:', JSON.stringify(nachher.slice(0,50)));
console.log('  -> Feld aktualisiert:', vorher !== nachher);
await b.close();
