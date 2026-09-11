import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';

fs.mkdirSync('.test-build',{recursive:true});
for(const name of ['rules','universes','library','library-store','access']){
 let source=fs.readFileSync(`lib/${name}.ts`,'utf8');
 source=source.replace(/import (\w+) from '(\.\/[\w-]+\.json)';/g,(_,name,path)=>`const ${name}=${fs.readFileSync('lib/'+path.slice(2),'utf8')};`);
 source=source.replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${path}.js'`);
 fs.writeFileSync(`.test-build/${name}.js`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {parseRules}=await import('../.test-build/rules.js');
const {universes}=await import('../.test-build/universes.js');
const {validateSnapshot,compatibilityKey,compareScans}=await import('../.test-build/library.js');
const {LibraryStore}=await import('../.test-build/library-store.js');
const {identity,sameOrigin}=await import('../.test-build/access.js');
const raw=new DatabaseSync(':memory:');raw.exec(fs.readFileSync('migrations/0001_library.sql','utf8'));
const db={prepare(sql){return {bind(...args){return {async first(){return raw.prepare(sql).get(...args)??null;},async all(){return {results:raw.prepare(sql).all(...args)};},async run(){return raw.prepare(sql).run(...args);}};}}},async batch(statements){raw.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
const markdown=fs.readFileSync('public/RULES.md','utf8'),rules=parseRules(markdown),stocks=universes.nasdaq100.stocks;
const signal={status:'Qualified',score:rules.enabled_checks.length,checks:rules.enabled_checks.map(id=>({id,label:id,value:'passes',pass:true})),history:[{c:100}],close:100,entry:101,stop:95,target:113,date:'2026-09-10'};
const fixture={schema:1,universeId:'nasdaq100',rulesMarkdown:markdown,rules,stocks,signals:Object.fromEntries(stocks.map(s=>[s.symbol,structuredClone(signal)])),marketDate:'2026-09-10',complete:true,processed:stocks.length};
const clean=validateSnapshot(fixture);
assert.equal(clean.processed,stocks.length);
assert.throws(()=>validateSnapshot({...fixture,processed:1}));
assert.throws(()=>validateSnapshot({...fixture,signals:{AAPL:signal}}));
assert.throws(()=>validateSnapshot({...fixture,rulesMarkdown:'bad'}));
assert.throws(()=>validateSnapshot({...fixture,signals:{...fixture.signals,AAPL:{...signal,history:Array(64).fill({c:100})}}}));
const extra=validateSnapshot({...fixture,user_id:'victim',key:'do-not-save',signals:{...fixture.signals,AAPL:{...signal,secret:'do-not-save'}}});
assert.ok(!JSON.stringify(extra).includes('do-not-save'));
assert.equal(await compatibilityKey(clean),await compatibilityKey({...clean,rules:{...rules}}));
assert.notEqual(await compatibilityKey(clean),await compatibilityKey({...clean,rules:{...rules,volume_min:2}}));

const alice=new LibraryStore(db,'alice'),bob=new LibraryStore(db,'bob'),id=crypto.randomUUID();
await alice.save(id,clean);assert.equal((await alice.list()).length,1);assert.equal(await bob.get(id),null);assert.equal((await bob.list()).length,0);
assert.equal(await bob.save(id,clean),null);await bob.remove(id);assert.ok(await alice.get(id));
await alice.save(id,{...clean,marketDate:'2026-09-11'});assert.equal((await alice.get(id)).market_date,'2026-09-10');
await alice.watch('AAPL','private note');assert.equal((await bob.watchlist()).length,0);
await bob.watch('AAPL','Bobs note');await bob.unwatch('AAPL');assert.equal((await alice.watchlist())[0].note,'private note');
await alice.watch('AAPL');assert.equal((await alice.watchlist())[0].note,'private note');
await alice.watch('AAPL','updated');assert.equal((await alice.watchlist())[0].note,'updated');assert.equal((await alice.watchlist())[0].signal.status,'Qualified');
// Dotted tickers must be addressed as literal JSON keys.
const dotted={...clean,signals:{'BRK.B':signal}};await alice.save(crypto.randomUUID(),dotted);await alice.watch('BRK.B');assert.equal((await alice.watchlist()).find(s=>s.symbol==='BRK.B').signal.close,100);
for(let i=0;i<35;i++)await alice.save(crypto.randomUUID(),clean);
for(let i=0;i<8;i++)await alice.save(crypto.randomUUID(),{...clean,complete:false});
assert.equal((await alice.list()).filter(s=>s.complete).length,30);assert.equal((await alice.list()).filter(s=>!s.complete).length,5);
assert.equal((await bob.list()).length,0);
const current={...await alice.get((await alice.list()).find(s=>s.complete).id),market_date:'2026-09-10'};
const previous=structuredClone(current);previous.market_date='2026-09-09';
previous.snapshot.signals.AAPL.status='Watch';current.snapshot.signals.NVDA.status='Not qualified';current.snapshot.signals.AMDBAD={...signal,status:'Stale data'};
const comparison=compareScans(current,previous);assert.ok(comparison.newly.includes('AAPL'));assert.ok(comparison.lost.includes('NVDA'));assert.ok(comparison.still.includes('MSFT'));
previous.snapshot.signals.AAPL.status='Stale data';assert.ok(!compareScans(current,previous).newly.includes('AAPL'));
assert.equal(compareScans(current,{...previous,complete:0}),null);assert.equal(compareScans(current,{...previous,compatibility_key:'other'}),null);assert.equal(compareScans(current,{...previous,market_date:current.market_date}),null);
console.log('PASS: snapshot validation, immutable retries, cross-user isolation, notes, dotted symbols, retention and compatible scan comparisons.');

const config={CF_ACCESS_TEAM_DOMAIN:'https://sigma-test.cloudflareaccess.com',CF_ACCESS_AUD:'sigma-test-audience'};
const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);jwk.kid='test';jwk.alg='RS256';jwk.use='sig';
const nativeFetch=globalThis.fetch;
globalThis.fetch=async url=>{assert.equal(String(url),config.CF_ACCESS_TEAM_DOMAIN+'/cdn-cgi/access/certs');return Response.json({keys:[jwk]});};
const token=async(overrides={},key=privateKey)=>new SignJWT({sub:'alice',email:'alice@example.test',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+300,iss:config.CF_ACCESS_TEAM_DOMAIN,aud:config.CF_ACCESS_AUD,...overrides}).setProtectedHeader({alg:'RS256',kid:'test'}).sign(key);
const req=t=>new Request('https://sigma.test/api/library',{headers:t?{'cf-access-jwt-assertion':t,'x-user-id':'bob','cf-access-authenticated-user-email':'bob@example.test'}:{}});
try{
 assert.deepEqual(await identity(req(await token()),config),{id:'alice',email:'alice@example.test'});
 await assert.rejects(identity(req(),config));await assert.rejects(identity(req(await token()),{}));
 await assert.rejects(identity(req(await token({aud:'wrong'})),config));await assert.rejects(identity(req(await token({iss:'https://other.cloudflareaccess.com'})),config));
 await assert.rejects(identity(req(await token({exp:1})),config));await assert.rejects(identity(req(await token({sub:''})),config));
 const other=await generateKeyPair('RS256');await assert.rejects(identity(req(await token({},other.privateKey)),config));
 assert.throws(()=>sameOrigin(new Request('https://sigma.test/api/library',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'}})));
 assert.throws(()=>sameOrigin(new Request('https://sigma.test/api/library',{method:'POST'})));
 sameOrigin(new Request('https://sigma.test/api/library',{method:'POST',headers:{origin:'https://sigma.test','content-type':'application/json'}}));
}finally{globalThis.fetch=nativeFetch;raw.close();}
console.log('PASS: signed Access identity, missing/forged/expired/wrong-audience tokens, spoofed identity headers and cross-origin writes.');
