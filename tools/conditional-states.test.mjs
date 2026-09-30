import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectTemplate, neutralizeScoreboardTemplateHTML, readTemplateHTMLTags } from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with { type:'json' };

const entries=manifest.filter(entry=>entry.published===true&&entry.tags?.includes('conditional-states'));
const states=['isATimeOutActive','isBTimeOutActive','isATimeOutUsed','isBTimeOutUsed',
  'isAYellowCarded','isBYellowCarded','isARedCarded','isBRedCarded'];
const paired=['isACurrentlyServing','isBCurrentlyServing','isGamePoint','isMatchPoint'];
const hasClass=(tag,name)=>(tag.attributes.class||'').split(/\s+/).includes(name);

test('all hourly racket styles retain stable, supported conditional bindings',async()=>{
  assert.ok(entries.length>=256,'expected all 64 hourly racket families');
  const byStyle=new Map();
  for(const entry of entries){
    assert.ok(['tableTennis','pickleball'].includes(entry.sport),entry.output);
    byStyle.set(entry.styleID,(byStyle.get(entry.styleID)||0)+1);
    assert.match(entry.description,/timeout clock icons/i,entry.output);
    assert.ok(entry.tags.includes('penalty-cards'),entry.output);
    const html=await readFile(new URL(`../templates/${entry.output}`,import.meta.url),'utf8');
    assert.deepEqual(inspectTemplate(html).errors,[],entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(html),html,entry.output);
    const tags=readTemplateHTMLTags(html).filter(tag=>!tag.closing);
    for(const field of [...states,...paired]){
      const matched=tags.filter(tag=>hasClass(tag,field));
      assert.equal(matched.length,1,`${entry.output}: exactly one ${field}`);
      assert.equal(matched[0].attributes['data-osb-component'],'field');
      assert.equal(matched[0].attributes['data-osb-field'],field);
      assert.match(matched[0].attributes.style||'',/opacity\s*:\s*0/,`${entry.output}: ${field} begins hidden`);
      if(field.includes('TimeOut')){
        assert.match(matched[0].attributes.style||'',/display\s*:\s*none/,`${entry.output}: timeout begins hidden`);
        assert.ok(hasClass(matched[0],'osb-timeout-icon'),`${entry.output}: timeout uses clock icon`);
        assert.equal(html.slice(matched[0].end,html.indexOf(`</${matched[0].name}>`,matched[0].end)).trim(),'','timeout has no timer text');
      }
    }
    assert.ok(tags.find(tag=>hasClass(tag,'isACurrentlyServing')).attributes.isa!==undefined,entry.output);
    assert.ok(tags.find(tag=>hasClass(tag,'isBCurrentlyServing')).attributes.isa===undefined,entry.output);
    const point=tags.find(tag=>hasClass(tag,'osb-shared-point'));
    assert.ok(point,entry.output);
    assert.match(html,/\.osb-conditional-rail\s+\.point-slot:has\([^}]*\.isMatchPoint[^}]*\.isGamePoint\s*\{opacity:0!important\}/,entry.output);
    assert.doesNotMatch(html,/data-osb-field="timeOutTimer[AB]"/,entry.output);
  }
  assert.ok(byStyle.size>=64);
  for(const [style,count]of byStyle)assert.equal(count,4,`${style}: two variants per racket sport`);
});
