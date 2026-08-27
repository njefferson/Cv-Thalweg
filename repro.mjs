import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium',
  args:['--no-sandbox','--proxy-server=http://127.0.0.1:1','--proxy-bypass-list=127.0.0.1;localhost;[::1]'] });
// a phone, which is where this actually bites
const ctx = await b.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block',
  hasTouch:true, isMobile:true, deviceScaleFactor:2 });
await ctx.route(u=>!u.hostname.startsWith('127.0.0.1')&&u.hostname!=='localhost', async r=>{
  try{ const res=await fetch(r.request().url(),{redirect:'follow'});
    await r.fulfill({status:res.status,headers:{'content-type':res.headers.get('content-type')||'application/octet-stream','access-control-allow-origin':'*'},body:Buffer.from(await res.arrayBuffer())});
  }catch(e){ await r.abort(); }
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:8787/',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(14000);
await page.evaluate(()=>{const d=document.getElementById('welcome'); if(d&&d.open) d.querySelector('button').click();});
await page.waitForTimeout(1500);

const probe = async (label, place) => {
  await page.evaluate(place);
  await page.waitForTimeout(900);
  const before = await page.evaluate(()=>document.querySelectorAll('.leaflet-tooltip,.leaflet-popup').length);
  // tap the marker's screen position
  const pt = await page.evaluate(()=>{
    const m = state.gaugeLayer.getLayers()[0];
    const p = state.map.latLngToContainerPoint(m.getLatLng());
    const r = document.getElementById('map').getBoundingClientRect();
    return {x:r.left+p.x, y:r.top+p.y, mapTop:r.top, mapBottom:r.bottom, mapLeft:r.left, mapRight:r.right};
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(700);
  const res = await page.evaluate(()=>{
    const el = document.querySelector('.leaflet-tooltip, .leaflet-popup');
    if (!el) return {open:false};
    const t = el.getBoundingClientRect();
    const m = document.getElementById('map').getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {open:true, cls:el.className.split(' ')[0],
      text:(el.textContent||'').trim().slice(0,50),
      visible: cs.visibility!=='hidden' && cs.display!=='none' && +cs.opacity>0,
      rect:{t:Math.round(t.top),b:Math.round(t.bottom),l:Math.round(t.left),r:Math.round(t.right)},
      map:{t:Math.round(m.top),b:Math.round(m.bottom),l:Math.round(m.left),r:Math.round(m.right)},
      clippedTop: t.top < m.top, clippedLeft: t.left < m.left, clippedRight: t.right > m.right, clippedBottom: t.bottom > m.bottom};
  });
  console.log(label, JSON.stringify(res));
};
// 1. marker comfortably in the middle
await probe('centre  :', ()=>{ const m=state.gaugeLayer.getLayers()[0]; state.map.setView(m.getLatLng(), 11); });
// 2. same marker pushed hard against the top edge of the map
await probe('top edge:', ()=>{ const m=state.gaugeLayer.getLayers()[0];
  const p=state.map.latLngToContainerPoint(m.getLatLng());
  state.map.panBy([0, p.y - 8], {animate:false}); });
// 3. and against the left edge
await probe('left edge:', ()=>{ const m=state.gaugeLayer.getLayers()[0];
  const p=state.map.latLngToContainerPoint(m.getLatLng());
  state.map.panBy([p.x - 6, 0], {animate:false}); });
await page.screenshot({path:'/tmp/repro.png'});
await b.close();
