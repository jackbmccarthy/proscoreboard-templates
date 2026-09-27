import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {CORE_FIELDS,inspectTemplate,neutralizeScoreboardTemplateHTML,readTemplateHTMLTags} from '../contract/index.mjs';
import manifest from '../templates/html-replications/manifest.json' with {type:'json'};
const entries=manifest.filter(entry=>entry.styleID==='open-corner-grid');
test('open corner batch has two compositions per sport without painted image surfaces or invented live counters',async()=>{
  assert.equal(entries.length,14);
  assert.equal(new Set(entries.map(entry=>entry.styleFingerprint)).size,1);
  for(const sport of ['tableTennis','pickleball','baseball','softball','basketball','soccer','volleyball'])assert.deepEqual(entries.filter(entry=>entry.sport===sport).map(entry=>entry.variant).sort(),[1,2]);
  for(const entry of entries){
    const html=await readFile(new URL('../templates/'+entry.output,import.meta.url),'utf8');
    assert.deepEqual(inspectTemplate(html).errors,[],entry.output);
    assert.equal(neutralizeScoreboardTemplateHTML(html),html,entry.output);
    const tags=readTemplateHTMLTags(html).filter(tag=>!tag.closing);
    for(const field of CORE_FIELDS)assert.equal(tags.filter(tag=>tag.attributes['data-osb-field']===field).length,1,entry.output+' '+field);
    assert.doesNotMatch(html,/<img|@import|https?:|linear-gradient|radial-gradient/);
    for(const tag of tags.filter(tag=>tag.attributes['data-sport-stat'])){
      assert.equal(tag.attributes['data-osb-static'],'true');
      assert.equal(tag.attributes['data-osb-field'],undefined);
      const text=html.slice(tag.end,html.indexOf('</'+tag.name+'>',tag.end)).trim();
      assert.match(text,/^(0|00|00:00)$/);
    }
    assert.equal(entry.runtimeSupport.sportRules,['tableTennis','pickleball'].includes(entry.sport));
  }
});
