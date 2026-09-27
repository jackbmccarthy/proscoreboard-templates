import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {CORE_FIELDS,inspectTemplate,neutralizeScoreboardTemplateHTML,readTemplateHTMLTags} from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with {type:'json'};
const entries=manifest.filter(entry=>entry.styleID==='carbon-copy-ticket');
test('ticket batch covers seven sports with two original compositions and neutral supported fields',async()=>{
  assert.equal(entries.length,14);
  assert.equal(new Set(entries.map(entry=>entry.styleFingerprint)).size,1);
  for(const sport of ['tableTennis','pickleball','baseball','softball','basketball','soccer','volleyball']){
    assert.deepEqual(entries.filter(entry=>entry.sport===sport).map(entry=>entry.variant).sort(),[1,2]);
  }
  for(const entry of entries){
    const html=await readFile(new URL('../templates/'+entry.output,import.meta.url),'utf8');
    const inspection=inspectTemplate(html);
    assert.deepEqual(inspection.errors,[],entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(html),html,entry.output);
    const tags=readTemplateHTMLTags(html).filter(tag=>!tag.closing);
    for(const field of CORE_FIELDS){
      const selected=tags.filter(tag=>tag.attributes['data-osb-field']===field);
      assert.equal(selected.length,1,entry.output+' '+field);
      assert.equal(selected[0].attributes['data-osb-component'],'field');
    }
    for(const tag of tags.filter(tag=>tag.attributes['data-sport-stat'])){
      assert.equal(tag.attributes['data-osb-static'],'true');
      assert.equal(tag.attributes['data-osb-field'],undefined);
      const value=html.slice(tag.end,html.indexOf('</'+tag.name+'>',tag.end)).trim();
      assert.match(value,/^(0|00|00:00)$/);
    }
    const native=['tableTennis','pickleball'].includes(entry.sport);
    assert.equal(entry.runtimeSupport.sportRules,native);
    if(native)for(const field of ['isACurrentlyServing','isBCurrentlyServing'])assert.equal(tags.filter(tag=>tag.attributes['data-osb-field']===field).length,1);
    assert.doesNotMatch(html,/<img|@import|https?:/);
  }
});
