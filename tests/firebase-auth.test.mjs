import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {SignJWT,importPKCS8,generateKeyPair} from 'jose';
fs.mkdirSync('.test-build',{recursive:true});
for(const name of ['session','access','auth-http','email-login','email-routes','firebase-client','firebase-login','firebase-routes','auth-routes','auth-gate']){
 const source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${path}.js'`);
 fs.writeFileSync(`.test-build/${name}.js`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {authRoute}=await import('../.test-build/auth-routes.js');
const {authGate}=await import('../.test-build/auth-gate.js');
const {identity}=await import('../.test-build/access.js');
const {SESSION_COOKIE}=await import('../.test-build/session.js');
const raw=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('migrations').sort())if(file.endsWith('.sql'))raw.exec(fs.readFileSync('migrations/'+file,'utf8'));
const db={prepare(sql){return {bind(...args){return {
 async first(){return raw.prepare(sql).get(...args)??null;},
 async all(){return {results:raw.prepare(sql).all(...args)};},
 async run(){const result=raw.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}
};}};},async batch(statements){raw.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
raw.prepare('INSERT INTO email_identities VALUES (?,?,1)').run('owner@example.test','github:43187933');
raw.prepare('INSERT INTO email_identities VALUES (?,?,1)').run('guest@example.test','email:guest');
const config={SIGMA_DB:db,SIGMA_AUTH_MODE:'firebase',SIGMA_AUTH_ORIGIN:'https://sigma.test',SIGMA_FIREBASE_PROJECT_ID:'sigma-test-project',SIGMA_FIREBASE_API_KEY:'fake-public-firebase-web-key'};
const fixture=JSON.parse(fs.readFileSync('tests/firebase-test-key.json'));
const key=await importPKCS8(fixture.privateKey,'RS256');
const wrongKey=(await generateKeyPair('RS256')).privateKey;
let certFetches=0;const nativeFetch=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
 assert.equal(options.redirect,'manual');certFetches++;
 return Response.json({'test-only':fixture.certificate},{headers:{'cache-control':'public,max-age=3600'}});
};
const now=()=>Math.floor(Date.now()/1000);
const token=async(overrides={},signingKey=key)=>new SignJWT({sub:'owner-uid',email:'owner@example.test',email_verified:true,auth_time:now()-10,iat:now()-1,exp:now()+3600,iss:'https://securetoken.google.com/sigma-test-project',aud:'sigma-test-project',firebase:{sign_in_provider:'password'},...overrides}).setProtectedHeader({alg:'RS256',kid:'test-only'}).sign(signingKey);
const req=(path,options={})=>new Request(config.SIGMA_AUTH_ORIGIN+path,options);
const post=(path,data={},cookie='',origin=config.SIGMA_AUTH_ORIGIN)=>req(path,{method:'POST',headers:{origin,cookie,'content-type':'application/json','cf-connecting-ip':'192.0.2.1'},body:JSON.stringify(data)});
const exchange=async(overrides={},cookie='')=>authRoute(post('/auth/firebase/session',{idToken:await token(overrides)},cookie),config);
const pair=response=>response.headers.getSetCookie().find(v=>v.startsWith(SESSION_COOKIE+'='))?.split(';')[0];
try{
 const page=await authRoute(req('/auth/login'),config),html=await page.text();
 assert.equal(page.status,200);assert.match(html,/Continue with Google/);assert.match(html,/Forgot password/);assert.match(html,/Create account/);
 assert.doesNotMatch(html,/SIGMA_BREVO|Sign in with GitHub/);
 assert.equal(page.headers.get('Cross-Origin-Opener-Policy'),'same-origin-allow-popups');
 assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal((await authRoute(req('/auth/firebase.js'),config)).status,200);
 for(const path of ['/api/library','/api/bars','/RULES.md','/_next/static/app.js'])assert.equal((await authGate(req(path),config,()=>new Response())).status,401);
 for(const path of ['/auth/start','/auth/callback','/auth/verify'])assert.equal((await authRoute(req(path),config)).status,404);
 assert.equal((await authRoute(post('/auth/firebase/session',{},'','https://evil.test'),config)).status,403);
 assert.equal((await authRoute(req('/auth/firebase/session'),config)).status,405);
 assert.equal((await authRoute(post('/auth/firebase/session',{idToken:'x'.repeat(11000)}),config)).status,413);
 assert.equal((await authRoute(post('/auth/firebase/session',{}),config)).status,400);
 for(const invalid of [
  {email_verified:false},{email:'other@example.test',email_verified:false},{aud:'wrong-project'},
  {iss:'https://evil.test'},{sub:''},{sub:'x'.repeat(129)},{exp:now()-1},
  {iat:now()+100},{auth_time:now()+100},{firebase:{sign_in_provider:'anonymous'}},
  {firebase:{sign_in_provider:'custom'}},{firebase:{sign_in_provider:'google.com',tenant:'tenant'}}
 ])assert.equal((await exchange(invalid)).status,401,JSON.stringify(invalid));
 assert.equal((await authRoute(post('/auth/firebase/session',{idToken:await token({},wrongKey)}),config)).status,401,'Forged signature rejected');
 assert.equal((await exchange({email:'stranger@example.test',sub:'stranger'})).status,403,'Verified but uninvited identity denied');
 const success=await exchange(),session=pair(success);assert.equal(success.status,200);assert.ok(session);
 assert.match(success.headers.getSetCookie()[0],/HttpOnly; Secure; SameSite=Lax; Max-Age=3\d{3}/);
 assert.deepEqual(await identity(req('/api/library',{headers:{cookie:session}}),config),{id:'github:43187933',name:'owner@example.test'});
 assert.ok(!JSON.stringify(raw.prepare('SELECT * FROM firebase_sessions').all()).includes(session.split('=')[1]),'No raw session token stored');
 assert.equal((await exchange({sub:'recreated-owner-uid'})).status,403,'Recreated Firebase UID cannot seize existing data');
 assert.equal((await exchange({email:'guest@example.test'})).status,403,'Existing UID cannot claim a second invitation');
 const google=await exchange({sub:'guest-uid',email:'guest@example.test',firebase:{sign_in_provider:'google.com'}});
 assert.equal(google.status,200);const guestSession=pair(google);
 assert.equal((await identity(req('/api/library',{headers:{cookie:guestSession}}),config)).id,'email:guest');
 for(let i=0;i<7;i++)assert.equal((await exchange()).status,200);
 assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM firebase_sessions WHERE user_id='github:43187933'").get().n,5);
 const active=pair(await exchange());
 raw.exec("UPDATE email_identities SET enabled=0 WHERE user_id='github:43187933'");
 assert.equal((await authGate(req('/api/library',{headers:{cookie:active}}),config,()=>new Response())).status,401,'Invitation revocation blocks active sessions');
 assert.equal((await exchange()).status,403);
 raw.exec("UPDATE email_identities SET enabled=1 WHERE user_id='github:43187933'");
 const latest=pair(await exchange());
 assert.equal((await authRoute(post('/auth/logout',{},latest),config)).headers.get('location'),'/auth/login?signedOut=1');
 assert.equal((await authGate(req('/api/library',{headers:{cookie:latest}}),config,()=>new Response())).status,401);
 assert.equal((await authGate(req('/api/library',{headers:{cookie:guestSession}}),{...config,SIGMA_FIREBASE_PROJECT_ID:'different-project'},()=>new Response())).status,401,'Project switch cannot reuse sessions');
 raw.exec('UPDATE firebase_sessions SET expires_at=0');
 assert.equal((await authGate(req('/api/library',{headers:{cookie:guestSession}}),config,()=>new Response())).status,401);
 raw.exec('UPDATE auth_limits SET count=60');assert.equal((await exchange()).status,429);
 assert.equal((await authGate(req('/api/library'),{...config,SIGMA_FIREBASE_API_KEY:''},()=>new Response())).status,503);
 assert.equal(certFetches,1,'Google certificates cached across token checks');
 console.log('Firebase tests passed: signed tokens, project/provider boundaries, invitations, UID pinning, data continuity, revocation, expiry, logout and rate limits.');
}finally{globalThis.fetch=nativeFetch;raw.close();}
