const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const source=fs.readFileSync('primal.js','utf8');
const id='12345678-1234-4123-8123-123456789abc';

// ---------------------------------------------------------------------------
// THE HOP: the ad tag, the click ids and the visit id ride onto every link
// into the app's preview funnel, and nothing else does.
// ---------------------------------------------------------------------------
const hop=source.slice(source.indexOf('  var playbookJourney ='),source.indexOf('\n  function funnelBeacon'));
function runHop(links,search,params){
 const run=new Function('document','location','crypto','playbookAttributionParams','isHouseVisit',hop);
 run({querySelectorAll:()=>links},{search},{randomUUID:()=>id},()=>new URLSearchParams(params),()=>true);
}
test('playbook CTAs carry matching visit and ad tags, leaving other destinations alone',()=>{
 const a={href:'https://app.primalsales.ai/playbook-preview'},b={href:'https://example.com/'};
 runHop([a,b],'','fb_ad_id=42&adset_id=7&utm_campaign=Test');
 const u=new URL(a.href);assert.equal(u.searchParams.get('fb_ad_id'),'42');assert.equal(u.searchParams.get('adset_id'),'7');assert.equal(u.searchParams.get('pj'),id);assert.equal(u.searchParams.get('house'),'1');assert.equal(b.href,'https://example.com/');
});
test('the click ids ride the hop — fbclid is the only identifier a server-side Meta event from the app can carry',()=>{
 const a={href:'https://app.primalsales.ai/playbook-preview'};
 runHop([a],'','utm_content=t2_recording_gap_static_a&fbclid=IwAR0abcDEF-ghi_JKL&gclid=Cj0K');
 const u=new URL(a.href);assert.equal(u.searchParams.get('fbclid'),'IwAR0abcDEF-ghi_JKL');assert.equal(u.searchParams.get('gclid'),'Cj0K');assert.equal(u.searchParams.get('utm_content'),'t2_recording_gap_static_a');
});
test('the hop reads the PLAYBOOK reader, not the visit reader',()=>{
 assert.match(hop,/var q=playbookAttributionParams\(\)/,'the CTA decorator must read first touch');
});

// ---------------------------------------------------------------------------
// FIRST TOUCH: written once, never overwritten while it lives, gone at 30 days,
// and laid over the live url for the playbook funnel only.
// ---------------------------------------------------------------------------
const ft=source.slice(source.indexOf('  var FIRST_TOUCH_KEY ='),source.indexOf('\n  saveFirstTouch();'));
function firstTouch({search='',stored=null,allowed=true,now=1_800_000_000_000,visit=''}={}){
 const store=new Map();if(stored)store.set('primal_attribution_first',JSON.stringify(stored));
 const localStorage={getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const keys=['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','fbclid','gclid','fb_ad_id','adset_id','campaign_id'];
 const run=new Function('marketingStorageAllowed','location','ATTRIBUTION_KEYS','page','Date','localStorage','attributionParams',ft+';saveFirstTouch();return {playbookAttributionParams,storedFirstTouch};');
 const api=run(()=>allowed,{search},keys,'playbook',{now:()=>now},localStorage,()=>new URLSearchParams(visit||search));
 return {api,store};
}
test('a tagged landing writes first touch, with the entry page and a date',()=>{
 const {store}=firstTouch({search:'?utm_campaign=proof_before_platform&utm_content=t2_recording_gap_static_a&fbclid=IwAR0x'});
 const v=JSON.parse(store.get('primal_attribution_first'));
 assert.equal(v.utm_content,'t2_recording_gap_static_a');assert.equal(v.fbclid,'IwAR0x');assert.equal(v.primal_entry,'playbook-page');assert.equal(v.first_seen_at,1_800_000_000_000);
});
test('a second tagged arrival inside the window does NOT overwrite the first ad',()=>{
 const stored={utm_content:'cold_ad',utm_campaign:'proof_before_platform',first_seen_at:1_800_000_000_000-5*86400000};
 const {api,store}=firstTouch({search:'?utm_campaign=proof_before_platform&utm_content=retarget_ad',stored});
 assert.equal(JSON.parse(store.get('primal_attribution_first')).utm_content,'cold_ad');
 assert.equal(api.playbookAttributionParams().get('utm_content'),'cold_ad','first touch wins over the live url for the playbook funnel');
});
test('an expired first touch is dropped and the new arrival starts a window',()=>{
 const stored={utm_content:'old_ad',first_seen_at:1_800_000_000_000-31*86400000};
 const {api,store}=firstTouch({search:'?utm_content=new_ad',stored});
 assert.equal(JSON.parse(store.get('primal_attribution_first')).utm_content,'new_ad');
 assert.equal(api.playbookAttributionParams().get('utm_content'),'new_ad');
});
test('an untagged hop writes nothing and reads the stored first touch',()=>{
 const stored={utm_content:'cold_ad',fbclid:'IwAR0x',first_seen_at:1_800_000_000_000-1000};
 const {api,store}=firstTouch({search:'',stored});
 assert.equal(JSON.parse(store.get('primal_attribution_first')).utm_content,'cold_ad');
 const p=api.playbookAttributionParams();assert.equal(p.get('utm_content'),'cold_ad');assert.equal(p.get('fbclid'),'IwAR0x');
});
test('without marketing consent nothing is written and nothing is read',()=>{
 const stored={utm_content:'cold_ad',first_seen_at:1_800_000_000_000-1000};
 const {api,store}=firstTouch({search:'?utm_content=live_ad',stored,allowed:false});
 assert.equal(JSON.parse(store.get('primal_attribution_first')).utm_content,'cold_ad','the store is untouched');
 assert.equal(api.storedFirstTouch(),null);
 assert.equal(api.playbookAttributionParams().get('utm_content'),'live_ad','only the live url, as before this block existed');
});
test('the beacon reads first touch on the playbook pages and the visit reader everywhere else',()=>{
 const beacon=source.slice(source.indexOf('  function funnelBeacon'),source.indexOf('\n  /* Booking-link attribution'));
 assert.match(beacon,/PLAYBOOK_PAGES\.indexOf\(pageName\) >= 0 \? playbookAttributionParams\(\) : attributionParams\(\)/);
 assert.match(source,/var PLAYBOOK_PAGES = \['playbook', 'connected-experience'\]/);
});
