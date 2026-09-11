import {EncryptJWT,jwtDecrypt} from 'jose';
import {HttpError} from './access';
import {type AuthConfig,allowedIds,authOrigin,configured,cookie,cookieValue,createSession,deleteSession,digest,randomToken,tokenHash,SESSION_COOKIE,SESSION_SECONDS} from './session';

const FLOW_COOKIE='__Host-sigma-oauth';
const flowAudience='sigma-github-oauth';
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function privateHeaders(){return new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});}
export function loginPage(config:AuthConfig,message='',status=200){
 const nonce=randomToken(),headers=privateHeaders();headers.set('Content-Type','text/html; charset=utf-8');
 headers.set('Content-Security-Policy',`default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
 const ready=configured(config);
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Sigma</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f8f7;color:#18322d;font:16px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,440px);background:white;padding:40px;border:1px solid #dce6e2;border-radius:16px;box-shadow:0 12px 40px #163c2410}.brand{color:#167557;font-weight:750;font-size:28px}.eyebrow{color:#647d74;font-size:12px;letter-spacing:.12em;margin-top:28px}h1{font-size:28px;line-height:1.2;margin:12px 0}p{color:#526b63}button{font:inherit;font-weight:650;color:white;background:#167557;border:0;border-radius:8px;padding:13px 18px;width:100%;cursor:pointer}button:hover{background:#105e45}button:focus-visible{outline:3px solid #75b9a1;outline-offset:3px}.small{font-size:13px;margin-bottom:0}.notice{background:#fff7e4;border:1px solid #ead9aa;padding:12px;border-radius:8px;color:#67552c}</style><main><div class="brand">Σ Sigma</div><div class="eyebrow">YOUR PRIVATE MARKET WORKSPACE</div><h1>Welcome back.</h1><p>Screen your stocks. Save your scans.<br>Keep an eye on your watchlist.</p>${message?`<p class="notice" role="alert">${escapeHtml(message)}</p>`:''}${ready?'<form action="/auth/start" method="post"><button type="submit">Sign in with GitHub</button></form>':'<p class="notice" role="status">Sign-in is being set up. Please try again shortly.</p>'}<p class="small">Invitation only. Your saved scans and notes are private to your account.</p><p class="small">GitHub shares your public profile identity with Sigma. No repository access is requested.</p></main></html>`,{status,headers});
}
function redirect(location:string,cookies:string[]=[]){const headers=privateHeaders();headers.set('Location',location);for(const value of cookies)headers.append('Set-Cookie',value);return new Response(null,{status:303,headers});}
function requirePost(request:Request){
 if(request.method!=='POST')throw new HttpError(405,'Use the sign-in or sign-out button.');
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-origin request rejected.');
}
async function flowKey(config:AuthConfig){return digest('sigma/oauth-cookie/v1:'+config.SIGMA_GITHUB_CLIENT_SECRET);}

// These are the only unauthenticated routes. OAuth access/refresh tokens never
// leave this request or get stored; Sigma issues its own revocable session.
export async function authRoute(request:Request,config:AuthConfig):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/auth/'))return null;
 if(url.origin!==authOrigin(config))return new Response('Use the Sigma application address.',{status:403,headers:privateHeaders()});
 const clearFlow=cookie(FLOW_COOKIE,'',0);
 try{
  if(url.pathname==='/auth/login'&&request.method==='GET')return loginPage(config);
  if(url.pathname==='/auth/logout'){
   requirePost(request);await deleteSession(request,config);
   return redirect('/auth/login',[cookie(SESSION_COOKIE,'',0),clearFlow]);
  }
  if(!configured(config))return loginPage(config,'',503);
  const callback=authOrigin(config)+'/auth/callback';
  if(url.pathname==='/auth/start'){
   requirePost(request);
   const state=randomToken(),verifier=randomToken();
   const flow=await new EncryptJWT({state,verifier}).setProtectedHeader({alg:'dir',enc:'A256GCM'}).setIssuedAt().setIssuer(authOrigin(config)!).setAudience(flowAudience).setExpirationTime('10m').encrypt(await flowKey(config));
   const authorize=new URL('https://github.com/login/oauth/authorize');
   authorize.search=new URLSearchParams({client_id:config.SIGMA_GITHUB_CLIENT_ID!,redirect_uri:callback,scope:'',state,code_challenge:await tokenHash(verifier),code_challenge_method:'S256',allow_signup:'false',prompt:'select_account'}).toString();
   return redirect(authorize.toString(),[cookie(FLOW_COOKIE,flow,600)]);
  }
  if(url.pathname==='/auth/callback'&&request.method==='GET'){
   const flow=cookieValue(request,FLOW_COOKIE),code=url.searchParams.get('code'),state=url.searchParams.get('state');
   if(!flow||flow.length>2048||!code||code.length>512||!state||url.searchParams.getAll('code').length!==1||url.searchParams.getAll('state').length!==1)throw new HttpError(400,'Sign-in was cancelled or expired. Please try again.');
   let payload;
   try{({payload}=await jwtDecrypt(flow,await flowKey(config),{issuer:authOrigin(config)!,audience:flowAudience,keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM'],requiredClaims:['iat','exp'],maxTokenAge:'10m'}));}catch{throw new HttpError(400,'Sign-in expired. Please try again.');}
   if(payload.state!==state||typeof payload.verifier!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(payload.verifier))throw new HttpError(400,'Sign-in could not be verified. Please try again.');
   const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.SIGMA_GITHUB_CLIENT_ID!,client_secret:config.SIGMA_GITHUB_CLIENT_SECRET!,code,redirect_uri:callback,code_verifier:payload.verifier}),signal:AbortSignal.timeout(15000),redirect:'error'});
   const token=await exchange.json() as {access_token?:unknown;token_type?:unknown};
   if(!exchange.ok||typeof token.access_token!=='string'||!token.access_token||String(token.token_type).toLowerCase()!=='bearer')throw new HttpError(400,'GitHub sign-in could not be completed. Please try again.');
   const profile=await fetch('https://api.github.com/user',{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token.access_token,'User-Agent':'Sigma-login','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000),redirect:'error'});
   const user=await profile.json() as {id?:unknown;login?:unknown};
   if(!profile.ok||!Number.isSafeInteger(user.id)||Number(user.id)<=0||typeof user.login!=='string'||!/^[A-Za-z0-9-]{1,39}$/.test(user.login))throw new HttpError(502,'GitHub identity could not be verified. Please try again.');
   if(!allowedIds(config).has(String(user.id)))throw new HttpError(403,'This GitHub account has not been invited. Ask the Sigma owner for access.');
   const session=await createSession(config,String(user.id),user.login,cookieValue(request,SESSION_COOKIE));
   return redirect('/',[cookie(SESSION_COOKIE,session,SESSION_SECONDS),clearFlow]);
  }
  throw new HttpError(404,'Page not found.');
 }catch(error){
  const response=loginPage(config,error instanceof HttpError?error.message:'Sign-in is temporarily unavailable. Please try again.',error instanceof HttpError?error.status:502);
  response.headers.append('Set-Cookie',clearFlow);return response;
 }
}
