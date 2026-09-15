import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {EncryptJWT} from 'jose';

fs.mkdirSync('.test-build',{recursive:true});
for(const name of ['session','access','auth-http','email-login','email-routes','firebase-client','firebase-login','firebase-routes','auth-routes','auth-gate']){
 const source=fs.readFileSync(`lib/${name}.ts`,'utf8').replace(/from '(\.\/[^']+)'/g,(_,path)=>`from '${path}.js'`);
 fs.writeFileSync(`.test-build/${name}.js`,ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {authRoute,loginPage}=await import('../.test-build/auth-routes.js');
const {authGate}=await import('../.test-build/auth-gate.js');
const {identity}=await import('../.test-build/access.js');
const {tokenHash,createSession,SESSION_COOKIE,digest}=await import('../.test-build/session.js');
const raw=new DatabaseSync(':memory:');raw.exec(fs.readFileSync('migrations/0002_sessions.sql','utf8'));
const db={prepare(sql){return {bind(...args){return {async first(){return raw.prepare(sql).get(...args)??null;},async all(){return {results:raw.prepare(sql).all(...args)};},async run(){return raw.prepare(sql).run(...args);}};}}},async batch(statements){raw.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());raw.exec('COMMIT');return results;}catch(e){raw.exec('ROLLBACK');throw e;}}};
const config={SIGMA_DB:db,SIGMA_AUTH_ORIGIN:'https://sigma.test',SIGMA_GITHUB_CLIENT_ID:'test-client',SIGMA_GITHUB_CLIENT_SECRET:'test-secret-not-a-real-credential',SIGMA_GITHUB_USER_IDS:'43187933,222'};
const req=(path,options={})=>new Request(config.SIGMA_AUTH_ORIGIN+path,options);
const post=(path,origin=config.SIGMA_AUTH_ORIGIN,cookies='')=>req(path,{method:'POST',headers:{origin,cookie:cookies}});
const next=async()=>new Response('protected');
const cookiePair=(response,name)=>response.headers.getSetCookie().find(c=>c.startsWith(name+'='))?.split(';')[0];
const nativeFetch=globalThis.fetch;let calls=0,profileId=43187933,providerFails=false,usedCodes=new Set();
let redirectEndpoint='';
let expectedChallenge='';
globalThis.fetch=async(input,options)=>{
 calls++;
 assert.equal(options.redirect,'manual');
 if(input===redirectEndpoint)return new Response(null,{status:302,headers:{Location:'https://untrusted.test'}});
 if(input==='https://github.com/login/oauth/access_token'){
  const body=new URLSearchParams(options.body),code=body.get('code');
  assert.equal(body.get('client_id'),config.SIGMA_GITHUB_CLIENT_ID);
  assert.equal(body.get('client_secret'),config.SIGMA_GITHUB_CLIENT_SECRET);
  assert.equal(body.get('redirect_uri'),'https://sigma.test/auth/callback');
  assert.equal(await tokenHash(body.get('code_verifier')),expectedChallenge);
  if(providerFails)throw new Error('provider failure test-secret-not-a-real-credential');
  if(usedCodes.has(code))return Response.json({error:'bad_verification_code'});
  usedCodes.add(code);return Response.json({access_token:'test-access-token',refresh_token:'test-refresh-token',token_type:'bearer'});
 }
 assert.equal(input,'https://api.github.com/user');assert.equal(options.headers.Authorization,'Bearer test-access-token');
 return Response.json({id:profileId,login:profileId===43187933?'emailabir':'another-user',email:'untrusted@example.test'});
};
async function start(){
 const response=await authRoute(post('/auth/start'),config);assert.equal(response.status,303);
 assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');
 const url=new URL(response.headers.get('location'));
 assert.equal(url.origin,'https://github.com');assert.equal(url.pathname,'/login/oauth/authorize');
 assert.equal(url.searchParams.get('scope'),'');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('redirect_uri'),'https://sigma.test/auth/callback');
 expectedChallenge=url.searchParams.get('code_challenge');
 const flow=response.headers.getSetCookie()[0];assert.match(flow,/HttpOnly; Secure; SameSite=Lax; Max-Age=600/);
 assert.ok(!flow.includes(config.SIGMA_GITHUB_CLIENT_SECRET));
 return {state:url.searchParams.get('state'),cookie:cookiePair(response,'__Host-sigma-oauth')};
}
const callback=(flow,code=crypto.randomUUID())=>req('/auth/callback?code='+code+'&state='+flow.state,{headers:{cookie:flow.cookie}});
try{
 assert.equal((await authRoute(req('/auth/login'),config)).status,200);
 assert.match(loginPage(config).headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
 assert.equal(loginPage(config).headers.get('Referrer-Policy'),'same-origin');
 assert.match(loginPage(config).headers.get('Content-Security-Policy'),/form-action 'self' https:\/\/github\.com;/);
 for(const path of ['/auth/start','/auth/logout']){
  assert.equal((await authRoute(req(path),config)).status,405);
  assert.equal((await authRoute(post(path,'https://evil.test'),config)).status,403);
  assert.equal((await authRoute(post(path,'null'),config)).status,403);
 }
 for(const path of ['/api/library','/api/bars','/RULES.md','/_next/static/anything.js']){
  assert.equal((await authGate(req(path),config,next)).status,401);
  assert.equal((await authGate(req(path,{headers:{'x-user-id':'github:43187933','cf-access-jwt-assertion':'forged','cf-access-authenticated-user-email':'owner@test'}}),config,next)).status,401);
 }
 assert.equal((await authGate(req('/'),config,next)).headers.get('location'),'/auth/login');
 assert.equal((await authGate(req('/api/library'),{},next)).status,503);
 assert.equal((await authRoute(new Request('https://evil.test/auth/start',{method:'POST',headers:{origin:'https://evil.test'}}),config)).status,403);
 for(const endpoint of ['https://github.com/login/oauth/access_token','https://api.github.com/user']){
  redirectEndpoint=endpoint;
  const attempt=await start(),previousCalls=calls;
  assert.equal((await authRoute(callback(attempt),config)).status,502);
  assert.equal(calls-previousCalls,endpoint.endsWith('/access_token')?1:2,'Redirects must stop without forwarding credentials');
 }
 redirectEndpoint='';
 const flow=await start();const before=calls;
 assert.equal((await authRoute(callback({...flow,state:'wrong'}),config)).status,400);
 assert.equal((await authRoute(callback({...flow,cookie:flow.cookie+'bad'}),config)).status,400);
 assert.equal((await authRoute(callback({...flow,cookie:''}),config)).status,400);
 const expired=await new EncryptJWT({state:flow.state,verifier:'x'.repeat(43)}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuer(config.SIGMA_AUTH_ORIGIN).setAudience('sigma-github-oauth').setIssuedAt(1).setExpirationTime(2).encrypt(await digest('sigma/oauth-cookie/v1:'+config.SIGMA_GITHUB_CLIENT_SECRET));
 assert.equal((await authRoute(callback({...flow,cookie:'__Host-sigma-oauth='+expired}),config)).status,400);
 assert.equal(calls,before,'Rejected state must never reach the provider');
 profileId=999;assert.equal((await authRoute(callback(flow),config)).status,403);assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get().count,0);
 profileId=43187933;const invited=await start(),code=crypto.randomUUID();const response=await authRoute(callback(invited,code),config);
 assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');
 const sessionCookie=cookiePair(response,SESSION_COOKIE);assert.ok(sessionCookie);assert.match(response.headers.getSetCookie()[0],/HttpOnly; Secure; SameSite=Lax; Max-Age=604800/);
 const sessionRequest=req('/api/library',{headers:{cookie:sessionCookie}});
 assert.deepEqual(await identity(sessionRequest,config),{id:'github:43187933',name:'emailabir'});
 assert.equal(await (await authGate(sessionRequest,config,next)).text(),'protected');
 assert.equal((await authGate(sessionRequest,config,next)).headers.get('Referrer-Policy'),'same-origin');
 let assetCalls=0;
 const assets={...config,ASSETS:{async fetch(){assetCalls++;return new Response('asset',{headers:{'Content-Type':'text/javascript'}});}}};
 for(const path of ['/_next/static/chunks/app.js','/RULES.md','/favicon.svg']){
  assert.equal((await authGate(req(path),assets,next)).status,401);
  assert.equal(assetCalls,0,'Unauthenticated requests must not reach the asset binding');
 }
 for(const path of ['/_next/static/chunks/app.js','/RULES.md','/favicon.svg']){
  const asset=await authGate(req(path,{headers:{cookie:sessionCookie}}),assets,next);
  assert.equal(await asset.text(),'asset');assert.equal(asset.headers.get('Cache-Control'),'private, no-store');
 }
 assert.equal(assetCalls,3);
 assert.equal(await (await authGate(sessionRequest,assets,next)).text(),'protected');
 assert.equal(assetCalls,3,'API routes must reach the application handler');
 assert.equal((await authRoute(callback(invited,code),config)).status,400,'Provider authorization codes cannot be replayed');
 const stored=JSON.stringify(raw.prepare('SELECT * FROM auth_sessions').all());
 assert.ok(!stored.includes(sessionCookie.split('=')[1]));assert.ok(!stored.includes('test-access-token'));assert.ok(!stored.includes('test-refresh-token'));
 await assert.rejects(identity(sessionRequest,{...config,SIGMA_GITHUB_USER_IDS:'222'}));
 await assert.rejects(identity(sessionRequest,{...config,SIGMA_GITHUB_USER_IDS:'*'}));
 const signedOut=await authRoute(post('/auth/logout',config.SIGMA_AUTH_ORIGIN,sessionCookie),config);assert.equal(signedOut.status,303);assert.match(signedOut.headers.getSetCookie()[0],/Max-Age=0/);await assert.rejects(identity(sessionRequest,config));
 const bob=await createSession(config,'222','bob',null);
 for(let i=0;i<8;i++)await createSession(config,'43187933','emailabir',null);
 assert.equal(raw.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE github_id = ?').get('43187933').count,5);
 assert.equal((await identity(req('/',{headers:{cookie:SESSION_COOKIE+'='+bob}}),config)).id,'github:222');
 raw.prepare('UPDATE auth_sessions SET expires_at = 1').run();await assert.rejects(identity(req('/',{headers:{cookie:SESSION_COOKIE+'='+bob}}),config));
 providerFails=true;const failure=await authRoute(callback(await start()),config);assert.equal(failure.status,502);assert.ok(!(await failure.text()).includes(config.SIGMA_GITHUB_CLIENT_SECRET));
 console.log('PASS: OAuth state/PKCE/expiry, invitation enforcement, no token disclosure, hashed sessions, expiry/revocation, CSRF, protected routes and session isolation.');
}finally{globalThis.fetch=nativeFetch;raw.close();}
