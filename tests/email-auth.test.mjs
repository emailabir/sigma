import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
fs.mkdirSync('.test-build',{recursive:true});
for(const name of ['session','access','auth-http','email-login','email-routes','firebase-client','firebase-login','firebase-routes','auth-routes','auth-gate']){
 const source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${path}.js'`);
 fs.writeFileSync(`.test-build/${name}.js`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {authRoute}=await import('../.test-build/auth-routes.js');
const {authGate}=await import('../.test-build/auth-gate.js');
const {identity}=await import('../.test-build/access.js');
const {normalizeEmail,SESSION_COOKIE}=await import('../.test-build/session.js');
const {EMAIL_FLOW_COOKIE}=await import('../.test-build/email-login.js');
const raw=new DatabaseSync(':memory:');
for(const migration of ['0002_sessions.sql','0003_email_login.sql'])raw.exec(fs.readFileSync('migrations/'+migration,'utf8'));
const db={prepare(sql){return {bind(...args){return {
 async first(){return raw.prepare(sql).get(...args)??null;},
 async all(){return {results:raw.prepare(sql).all(...args)};},
 async run(){const result=raw.prepare(sql).run(...args);return {meta:{changes:Number(result.changes)}};}
};}};},async batch(statements){raw.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
raw.prepare('INSERT INTO email_identities VALUES (?,?,1)').run('owner@example.test','github:43187933');
raw.prepare('INSERT INTO email_identities VALUES (?,?,1)').run('guest@example.test','email:guest');
const config={SIGMA_DB:db,SIGMA_AUTH_ORIGIN:'https://sigma.test',SIGMA_AUTH_MODE:'email',SIGMA_BREVO_API_KEY:'fake-email-key',SIGMA_EMAIL_FROM:'sender@example.test'};
const req=(path,options={})=>new Request(config.SIGMA_AUTH_ORIGIN+path,options);
const post=(path,data={},cookies='',origin=config.SIGMA_AUTH_ORIGIN)=>req(path,{method:'POST',headers:{origin,cookie:cookies,'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.1'},body:new URLSearchParams(data)});
const pair=(response,name)=>response.headers.getSetCookie().find(c=>c.startsWith(name+'='))?.split(';')[0];
const clearLimits=()=>raw.exec('DELETE FROM auth_limits');
const nativeFetch=globalThis.fetch;let delivered=[],sendStatus=201;
globalThis.fetch=async(url,options)=>{
 assert.equal(url,'https://api.brevo.com/v3/smtp/email');assert.equal(options.redirect,'manual');assert.equal(options.headers['api-key'],'fake-email-key');
 const body=JSON.parse(options.body);assert.equal(body.sender.email,'sender@example.test');
 const code=body.textContent.match(/code is: (\d{8})/)[1];
 delivered.push({email:body.to[0].email,code});
 return new Response(sendStatus===201?'{}':'fake-email-key provider private message',{status:sendStatus,headers:{Location:'https://untrusted.test'}});
};
async function start(email='owner@example.test',reset=true){
 if(reset)clearLimits();
 const response=await authRoute(post('/auth/start',{email}),config);assert.equal(response.status,303);
 assert.equal(response.headers.get('location'),'/auth/verify');
 assert.match(response.headers.getSetCookie()[0],/HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
 return {cookie:pair(response,EMAIL_FLOW_COOKIE),code:delivered.at(-1)?.code};
}
const verify=(flow,code=flow.code)=>authRoute(post('/auth/verify',{code},flow.cookie),config);
try{
 assert.equal(normalizeEmail(' Owner@Example.Test '),'owner@example.test');
 for(const bad of ['x\r\n@example.test','a..b@example.test','.a@example.test','a.@example.test','a@b','a@-b.test'])assert.equal(normalizeEmail(bad),null);
 assert.equal(normalizeEmail('a.b+tag@gmail.com'),'a.b+tag@gmail.com','Never merge aliases automatically');
 const login=await authRoute(req('/auth/login'),config);assert.equal(login.status,200);assert.equal(login.headers.get('Referrer-Policy'),'same-origin');
 const html=await login.text();assert.match(html,/type="email"/);assert.doesNotMatch(html,/Sign in with GitHub/);assert.ok(!html.includes(config.SIGMA_BREVO_API_KEY));
 for(const path of ['/auth/start','/auth/verify','/auth/logout']){
  assert.equal((await authRoute(post(path,{},'','https://evil.test'),config)).status,403);
  assert.equal((await authRoute(post(path,{},'','null'),config)).status,403);
 }
 assert.equal((await authRoute(req('/auth/start'),config)).status,405);
 assert.equal((await authRoute(post('/auth/start',{email:'bad'}),config)).status,400);
 assert.equal((await authRoute(post('/auth/start',{email:'a'.repeat(2500)}),config)).status,413);
 assert.equal((await authRoute(post('/auth/start',{email:'owner@example.test'}),{...config,SIGMA_BREVO_API_KEY:''})).status,503);
 assert.equal((await authGate(req('/api/library'),{...config,SIGMA_AUTH_MODE:'typo'},()=>new Response())).status,503);
 const previous=delivered.length,unknown=await start('unknown@example.test');
 assert.equal(delivered.length,previous);assert.equal(raw.prepare('SELECT count(*) AS n FROM email_challenges').get().n,0);
 assert.equal((await verify(unknown,'12345678')).status,400);
 const flow=await start('OWNER@example.test');
 assert.equal(delivered.at(-1).email,'owner@example.test');
 const stored=JSON.stringify(raw.prepare('SELECT * FROM email_challenges').all());
 assert.ok(!stored.includes(flow.code));assert.ok(!stored.includes(flow.cookie.split('=')[1]));
 assert.equal((await verify({...flow,cookie:''})).status,400);
 assert.equal((await verify({...flow,cookie:flow.cookie+'; '+flow.cookie})).status,400);
 const success=await verify(flow);assert.equal(success.status,303);assert.equal(success.headers.get('location'),'/');
 const session=pair(success,SESSION_COOKIE);assert.ok(session);
 assert.equal((await verify(flow)).status,400,'A code works once');
 const sessionReq=req('/api/library',{headers:{cookie:session}});
 assert.deepEqual(await identity(sessionReq,config),{id:'github:43187933',name:'owner@example.test'},'Existing scan and watchlist owner ID is preserved');
 assert.ok(!JSON.stringify(raw.prepare('SELECT * FROM email_sessions').all()).includes(session.split('=')[1]));
 assert.equal((await authGate(req('/api/library'),config,()=>new Response())).status,401);
 assert.equal((await authGate(req('/RULES.md'),config,()=>new Response())).status,401);
 raw.prepare('UPDATE email_identities SET enabled=0 WHERE email=?').run('owner@example.test');
 await assert.rejects(identity(sessionReq,config));
 raw.prepare('UPDATE email_identities SET enabled=1 WHERE email=?').run('owner@example.test');
 const logout=await authRoute(post('/auth/logout',{},session),config);assert.equal(logout.status,303);await assert.rejects(identity(sessionReq,config));
 const expired=await start();raw.exec('UPDATE email_challenges SET expires_at=1');assert.equal((await verify(expired)).status,400);
 const exhausted=await start(),wrong=exhausted.code==='00000000'?'11111111':'00000000';
 for(let i=0;i<5;i++)assert.equal((await verify(exhausted,wrong)).status,400);
 assert.equal((await verify(exhausted)).status,400,'Five guesses exhaust a challenge');
 const superseded=await start(),replacement=await start();assert.equal((await verify(superseded)).status,400);assert.equal((await verify(replacement)).status,303);
 const simultaneous=await start();const concurrent=await Promise.all([verify(simultaneous),verify(simultaneous)]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[303,400]);
 const revoked=await start();raw.exec("UPDATE email_identities SET enabled=0 WHERE email='owner@example.test'");assert.equal((await verify(revoked)).status,403);raw.exec("UPDATE email_identities SET enabled=1 WHERE email='owner@example.test'");
 const guest=await verify(await start('guest@example.test'));
 for(let i=0;i<7;i++)assert.equal((await verify(await start())).status,303);
 assert.equal(raw.prepare("SELECT count(*) AS n FROM email_sessions WHERE user_id='github:43187933'").get().n,5);
 assert.equal((await identity(req('/',{headers:{cookie:pair(guest,SESSION_COOKIE)}}),config)).id,'email:guest');
 raw.exec('UPDATE email_sessions SET expires_at=1');await assert.rejects(identity(req('/',{headers:{cookie:pair(guest,SESSION_COOKIE)}}),config));
 clearLimits();await start('owner@example.test',false);const sends=delivered.length;
 assert.equal((await authRoute(post('/auth/start',{email:'owner@example.test'}),config)).status,429);assert.equal(delivered.length,sends);
 clearLimits();for(let i=0;i<20;i++)await start('unknown@example.test',false);
 assert.equal((await authRoute(post('/auth/start',{email:'unknown@example.test'}),config)).status,429);
 for(const status of [302,500]){clearLimits();sendStatus=status;const failed=await authRoute(post('/auth/start',{email:'owner@example.test'}),config);assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('fake-email-key'));assert.equal(raw.prepare("SELECT count(*) AS n FROM email_challenges WHERE email='owner@example.test'").get().n,0);}
 assert.equal((await authRoute(req('/auth/callback?code=anything'),config)).status,404,'GitHub cannot authenticate while email mode is active');
 console.log('PASS: email delivery, invitation-only access, preserved ownership, one-time browser-bound codes, concurrency, expiry, attempt/rate limits, revocation, session isolation and safe provider failures.');
}finally{globalThis.fetch=nativeFetch;raw.close();}
