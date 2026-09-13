const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=fs.readFileSync('primal.js','utf8');
const code=source.slice(source.indexOf('  var playbookJourney ='),source.indexOf('\n  function funnelBeacon'));
test('playbook CTAs carry matching visit and ad tags, leaving other destinations alone',()=>{
 const a={href:'https://app.primalsales.ai/playbook-preview'},b={href:'https://example.com/'};
 const run=new Function('document','location','crypto','attributionParams','isHouseVisit',code);
 run({querySelectorAll:()=>[a,b]},{search:''},{randomUUID:()=> '12345678-1234-4123-8123-123456789abc'},()=>new URLSearchParams('fb_ad_id=42&adset_id=7&utm_campaign=Test'),()=>true);
 const u=new URL(a.href);assert.equal(u.searchParams.get('fb_ad_id'),'42');assert.equal(u.searchParams.get('adset_id'),'7');assert.equal(u.searchParams.get('pj'),'12345678-1234-4123-8123-123456789abc');assert.equal(u.searchParams.get('house'),'1');assert.equal(b.href,'https://example.com/');
});
