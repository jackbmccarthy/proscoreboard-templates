import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import manifest from '../templates/html-replications/manifest.json' with {type:'json'};
const modulePath=process.env.PLAYWRIGHT_MODULE_PATH;
const {chromium}=await import(modulePath?pathToFileURL(path.resolve(modulePath)).href:'playwright');
const entries=manifest.filter(entry=>entry.styleID==='carbon-copy-ticket');
test('fourteen ticket overlays keep readable live tracks, neutral states and transparent responsive roots',{timeout:120000},async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
  const evidence=[];
  try{
    for(const entry of entries){
      const key=entry.output.replace('html-replications/carbon-copy-ticket-','').replace('.html','');
      const html=await readFile(new URL('../templates/'+entry.output,import.meta.url),'utf8');
      for(const width of [1920,1280,390]){
        const page=await browser.newPage({viewport:{width,height:width===390?844:Math.round(width*9/16)}});
        const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.abort());
        await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
        assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgba(0, 0, 0, 0)');
        const snapshot=()=>page.evaluate(()=>{
          const fields=['combinedAName','combinedBName','currentAGameScore','currentBGameScore'];
          return Object.fromEntries(fields.map(field=>{
            const element=document.querySelector('[data-osb-field="'+field+'"]');
            const parent=field.includes('Score')?element.parentElement:element;
            const r=parent.getBoundingClientRect();return[field,{x:r.x,y:r.y,width:r.width,height:r.height}];
          }));
        });
        const before=await snapshot();
        if(process.env.SPORT_TEMPLATE_ARTIFACTS){
          await mkdir(process.env.SPORT_TEMPLATE_ARTIFACTS,{recursive:true});
          await page.evaluate(()=>{document.body.style.background='#000'});
          await page.locator('.ticket').screenshot({path:path.join(process.env.SPORT_TEMPLATE_ARTIFACTS,key+'-'+width+'.png')});
          await page.evaluate(()=>{document.body.style.background='transparent'});
        }
        await page.evaluate(({score})=>{
          for(const side of ['A','B']){
            document.querySelector('[data-osb-field="combined'+side+'Name"]').textContent='Team '+side+' With A Long Name That Must Truncate Without Moving Scores';
            document.querySelector('[data-osb-field="current'+side+'GameScore"]').textContent=score;
            document.querySelector('[data-osb-field="current'+side+'MatchScore"]').textContent='3';
          }
          for(const field of ['isACurrentlyServing','isMatchPoint']){
            const node=document.querySelector('[data-osb-field="'+field+'"]');if(node)node.style.opacity='1';
          }
        },{score:entry.sport==='basketball'?'128':'12'});
        const after=await snapshot();
        for(const field of Object.keys(before))for(const axis of ['x','y','width','height'])assert.ok(Math.abs(before[field][axis]-after[field][axis])<1,key+' '+width+' '+field+' '+axis+' shifted');
        const check=await page.evaluate(()=>{
          const visible=[...document.querySelectorAll('[data-osb-field]')].filter(node=>{const r=node.getBoundingClientRect();return r.width&&r.height});
          const outside=visible.filter(node=>{const r=node.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(node=>node.dataset.osbField);
          const scores=visible.filter(node=>/current[AB]GameScore/.test(node.dataset.osbField));
          const clipped=scores.filter(node=>node.scrollWidth>node.clientWidth+1||node.getBoundingClientRect().width>node.parentElement.getBoundingClientRect().width+1).map(node=>node.dataset.osbField);
          return {outside,clipped,overflow:document.documentElement.scrollWidth>innerWidth};
        });
        assert.deepEqual(check.outside,[],key+' '+width+' outside');
        assert.deepEqual(check.clipped,[],key+' '+width+' clipped');
        assert.equal(check.overflow,false,key+' '+width+' horizontal overflow');
        assert.deepEqual(errors,[]);
        evidence.push({key,width,passed:true});await page.close();
      }
    }
    if(process.env.SPORT_TEMPLATE_ARTIFACTS)await writeFile(path.join(process.env.SPORT_TEMPLATE_ARTIFACTS,'browser-evidence.json'),JSON.stringify(evidence,null,2));
  }finally{await browser.close()}
});
