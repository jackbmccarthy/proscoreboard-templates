import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import manifest from '../templates/html-replications/manifest.json' with { type:'json' };

const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
const { chromium }=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const entries=manifest.filter(x=>x.published===true&&x.tags?.includes('conditional-states'));
const firstPerStyle=new Map(entries.filter(x=>x.sport==='tableTennis'&&x.variant===1).map(x=>[x.styleID,x]));
const exceptions=new Set(['carbon-copy-ticket','linen-navy-sideconsole','pearl-ledger-side-index','pearl-graphite-rightdock','warm-paper-rightnote','sage-slate-data-console','oxblood-ivory-inrow-rail','wire-numeral','inverted-splitline','marine-parchment-terminal']);
const cases=[...firstPerStyle.values()].map(entry=>({entry,width:390}));
for(const entry of entries.filter(x=>exceptions.has(x.styleID)&&x.sport==='pickleball'&&x.variant===2))cases.push({entry,width:390});
for(const entry of entries.filter(x=>exceptions.has(x.styleID)&&x.sport==='tableTennis'&&x.variant===2))cases.push({entry,width:1280});

test('conditional clock, card and neutral point states remain readable across hourly styles',{timeout:120000},async()=>{
  assert.ok(firstPerStyle.size>=64);
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  try{
    for(const {entry,width} of cases){
      const height=width===390?844:720;
      const page=await browser.newPage({viewport:{width,height}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*',route=>route.abort());
      await page.setContent(await readFile(new URL(`../templates/${entry.output}`,import.meta.url),'utf8'));
      const before=await page.evaluate(()=>{
        const rail=document.querySelector('.osb-conditional-rail'),r=rail.getBoundingClientRect();
        const get=f=>document.querySelector(`[data-osb-field="${f}"]`);
        return{rail:{x:r.x,y:r.y,width:r.width,height:r.height},timeoutHidden:['isATimeOutActive','isBTimeOutActive','isATimeOutUsed','isBTimeOutUsed'].every(f=>getComputedStyle(get(f)).display==='none'),cardsHidden:['isAYellowCarded','isBYellowCarded','isARedCarded','isBRedCarded'].every(f=>getComputedStyle(get(f)).opacity==='0'),pointHidden:getComputedStyle(get('isGamePoint')).opacity==='0'&&getComputedStyle(get('isMatchPoint')).opacity==='0',bodyBg:getComputedStyle(document.body).backgroundColor};
      });
      assert.ok(before.timeoutHidden&&before.cardsHidden&&before.pointHidden,entry.output);
      assert.equal(before.bodyBg,'rgba(0, 0, 0, 0)',entry.output);
      await page.evaluate(()=>{
        for(const f of ['isATimeOutActive','isBTimeOutActive','isATimeOutUsed','isBTimeOutUsed']){const n=document.querySelector(`[data-osb-field="${f}"]`);n.style.display='flex';n.style.opacity='1'}
        for(const f of ['isAYellowCarded','isBYellowCarded','isARedCarded','isBRedCarded','isGamePoint','isMatchPoint'])document.querySelector(`[data-osb-field="${f}"]`).style.opacity='1';
      });
      const after=await page.evaluate(()=>{
        const rail=document.querySelector('.osb-conditional-rail'),r=rail.getBoundingClientRect();
        const get=f=>document.querySelector(`[data-osb-field="${f}"]`);
        const core=['combinedAName','combinedBName','currentAGameScore','currentBGameScore'].map(f=>get(f).getBoundingClientRect());
        const point=get('isMatchPoint');
        const active=get('isATimeOutActive'),used=get('isATimeOutUsed');
        return{rail:{x:r.x,y:r.y,width:r.width,height:r.height},pointFont:parseFloat(getComputedStyle(point).fontSize),pointOpacity:getComputedStyle(point).opacity,gameOpacity:getComputedStyle(get('isGamePoint')).opacity,timeoutVisible:['isATimeOutActive','isBTimeOutActive','isATimeOutUsed','isBTimeOutUsed'].every(f=>getComputedStyle(get(f)).display!=='none'),cardsVisible:['isAYellowCarded','isBYellowCarded','isARedCarded','isBRedCarded'].every(f=>getComputedStyle(get(f)).opacity==='1'),activeIcon:getComputedStyle(active,'::before').content,usedIcon:getComputedStyle(used,'::before').content,activeBackground:getComputedStyle(active).backgroundColor,usedBackground:getComputedStyle(used).backgroundColor,overlap:r.y<Math.max(...core.map(x=>x.bottom))-2,overflow:document.documentElement.scrollWidth>innerWidth};
      });
      for(const axis of ['x','y','width','height'])assert.ok(Math.abs(before.rail[axis]-after.rail[axis])<1,`${entry.output} ${width}: ${axis} shifted`);
      assert.ok(after.pointFont>=11,`${entry.output} ${width}: point text too small`);
      assert.equal(after.pointOpacity,'1',entry.output);
      assert.equal(after.gameOpacity,'0',`${entry.output}: match point must win`);
      assert.ok(after.timeoutVisible&&after.cardsVisible,entry.output);
      assert.equal(after.activeIcon,'""',`${entry.output}: active timeout clock missing`);
      assert.equal(after.usedIcon,'""',`${entry.output}: used timeout clock missing`);
      assert.notEqual(after.activeBackground,after.usedBackground,`${entry.output}: active and used timeout need distinct treatments`);
      assert.equal(after.overlap,false,entry.output);
      assert.equal(after.overflow,false,entry.output);
      assert.deepEqual(errors,[],entry.output);
      await page.close();
    }
  }finally{await browser.close()}
});
