import { chromium } from 'playwright';
let pass=0,fail=0;
const check=(n,ok,x)=>{ok?pass++:fail++;console.log((ok?'  PASS  ':'  FAIL  ')+n+(ok?'':'   << '+JSON.stringify(x)));};
const seed = await fetch('http://127.0.0.1:8787/itinerary').then(r=>r.json());
const us = seed.trips.find(t=>t.id==='us2026');
const byDate = Object.fromEntries(us.days.map(d=>[d.date,d]));

const ROUTE = [
  ['2026-11-11','LA → Grand Canyon South Rim','-4–23°C','cold'],
  ['2026-11-12','Grand Canyon','-4–12°C','cold'],
  ['2026-11-13','Grand Canyon → Horseshoe Bend → Page','-4–12°C','cold'],
  ['2026-11-14','Antelope Canyon → Las Vegas','1–19°C','mild'],
  ['2026-11-15','Las Vegas → LA','8–23°C','mild'],
];
for(const [date,title,temp,tone] of ROUTE){
  const d = byDate[date];
  check(`${date} ${title}`, d?.title===title, d?.title);
  check(`  temp ${temp} (${tone})`, us.wear[d.n]?.t===temp && us.wear[d.n]?.tone===tone, us.wear[d?.n]);
}
check('11/16 and 11/17 also have temps', ['19','20'].every(n=>us.wear[n]), Object.keys(us.wear));
check('every road-trip day now has a temperature',
  us.days.filter(d=>d.date>='2026-11-11').every(d=>us.wear[d.n]), 
  us.days.filter(d=>d.date>='2026-11-11'&&!us.wear[d.n]).map(d=>d.date));
check('no day is left as 待安排 inside the road trip',
  !ROUTE.some(([date])=>byDate[date].title==='美國公路之旅'));
check('11/17 is still the return day', byDate['2026-11-17'].title==='返台');
// the Vegas show days and LA office days must not have been disturbed
check('Vegas show days untouched', ['2026-11-02','2026-11-06'].every(d=>byDate[d].title==='拉斯維加斯參展'));
check('LA office days untouched', ['2026-11-09','2026-11-10'].every(d=>byDate[d].title==='LA 進辦公室'));
check('every tone is one the CSS knows',
  Object.values(us.wear).every(w=>['warm','mild','cool','cold'].includes(w.tone)));
// sub-zero days must actually say so, since nothing in Europe went below zero overnight
check('the freezing days carry a cold-weather instruction',
  ['15','16'].every(n=>/羽絨|保暖|結冰/.test(us.wear[n].w)), ['15','16'].map(n=>us.wear[n].w));
check('flying day keeps the long-trousers rule', us.wear['20'].w.includes('搭飛機一律長褲'));

const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const pg=await b.newPage({viewport:{width:390,height:844}});
const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
await pg.addInitScript(()=>localStorage.setItem('trip-auth-ok-v1','1'));
await pg.route('**/*', r => /127\.0\.0\.1|localhost/.test(r.request().url()) ? r.continue() : r.abort());
await pg.goto('http://127.0.0.1:8080/',{waitUntil:'domcontentloaded'});
await pg.waitForTimeout(2500);
await pg.evaluate(()=>openTrip('us2026'));
await pg.waitForTimeout(2000);
const cal = await pg.evaluate(()=>document.getElementById('rail-list').innerText);
check('calendar shows the Grand Canyon days', cal.includes('Grand Canyon South Rim'));
check('calendar shows Horseshoe Bend', cal.includes('Horseshoe Bend'));
check('calendar shows Antelope Canyon', cal.includes('Antelope Canyon'));
check('calendar shows the sub-zero range', cal.includes('-4–12°C'), cal.match(/.{0,16}°C/g)?.slice(0,8));
check('calendar still shows the Vegas show', cal.includes('拉斯維加斯參展'));
check('no page errors', errs.length===0, errs);
console.log('\n'+(fail?`RESULT: ${pass} passed, ${fail} FAILED`:`RESULT: all ${pass} passed`));
await b.close(); process.exit(fail?1:0);
