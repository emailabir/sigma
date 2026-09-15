import {HttpError} from './access';
import {privateHeaders,redirect,requirePost,escapeHtml} from './auth-http';
import {type AuthConfig,authOrigin,configured,cookie,cookieValue,deleteSession,randomToken,SESSION_COOKIE} from './session';
import {firebaseClient} from './firebase-client';
import {createFirebaseSession,firebaseRateLimit,verifyFirebaseToken} from './firebase-login';

export function firebaseLoginPage(config:AuthConfig,message='',status=200){
 const nonce=randomToken(),headers=privateHeaders(),ready=configured(config);
 const domain=ready?`${config.SIGMA_FIREBASE_PROJECT_ID}.firebaseapp.com`:'';
 headers.set('Content-Type','text/html; charset=utf-8');
 headers.set('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${nonce}' https://www.gstatic.com/firebasejs/12.19.0/ https://apis.google.com https://www.google.com/recaptcha/; style-src 'nonce-${nonce}'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com ${domain?'https://'+domain:''}; frame-src ${domain?'https://'+domain:''} https://accounts.google.com https://www.google.com; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
 // Popup OAuth needs the opener relationship to its Firebase-hosted auth helper.
 headers.set('Cross-Origin-Opener-Policy','same-origin-allow-popups');
 const json=JSON.stringify({apiKey:config.SIGMA_FIREBASE_API_KEY,projectId:config.SIGMA_FIREBASE_PROJECT_ID,authDomain:domain}).replace(/</g,'\\u003c');
 return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Sigma</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f8f7;color:#18322d;font:16px/1.55 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,460px);background:white;padding:36px;border:1px solid #dce6e2;border-radius:16px;box-shadow:0 12px 40px #163c2410}.brand{color:#167557;font-weight:750;font-size:28px}.eyebrow{color:#647d74;font-size:11px;letter-spacing:.12em;margin-top:22px}h1{font-size:28px;line-height:1.2;margin:12px 0}p{color:#526b63}.small{font-size:13px}label{display:block;font-size:14px;font-weight:600;margin-top:14px}input{display:block;width:100%;border:1px solid #b8cdc4;border-radius:8px;padding:11px;font:inherit;margin-top:5px}button{font:inherit;font-weight:650;color:white;background:#167557;border:1px solid #167557;border-radius:8px;padding:11px 14px;width:100%;cursor:pointer;margin-top:12px}button.secondary{background:white;color:#18322d;border-color:#bdcec6}button.link{background:none;border:0;color:#167557;padding:4px;font-size:14px}button:disabled{opacity:.55;cursor:wait}input:focus-visible,button:focus-visible{outline:3px solid #75b9a1;outline-offset:3px}.notice{background:#fff7e4;border:1px solid #ead9aa;padding:12px;border-radius:8px;color:#67552c;font-size:14px}.divider{display:flex;align-items:center;gap:12px;color:#647d74;font-size:12px;margin:22px 0 6px}.divider:before,.divider:after{content:"";height:1px;background:#dce6e2;flex:1}[hidden]{display:none!important}</style></head><body><main><div class="brand">Σ Sigma</div><div class="eyebrow">YOUR PRIVATE MARKET WORKSPACE</div><h1>Welcome back.</h1><p>Sign in to your screener, saved scans and watchlist.</p><p id="message" class="notice" role="status" aria-live="polite" ${message?'':'hidden'}>${escapeHtml(message)}</p>${ready?`<button id="google" class="secondary" disabled>Continue with Google</button><div class="divider">or use your email</div><form id="credentials"><label for="email">Email address</label><input id="email" type="email" autocomplete="username" required maxlength="254"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required maxlength="128"><button type="submit" disabled>Sign in</button><button type="button" id="create" class="secondary" disabled>Create account</button></form><button id="reset" class="link" disabled>Forgot password?</button><div id="verification" hidden><button id="verified" class="secondary" disabled>I verified my email</button><button id="resend" class="link" disabled>Resend verification email</button></div><p class="small">Invitation only. Creating an account does not grant access until the owner invites your email.</p><noscript><p class="notice">Enable JavaScript to use secure sign-in.</p></noscript><script id="firebase-config" type="application/json" nonce="${nonce}">${json}</script><script type="module" nonce="${nonce}" src="/auth/firebase.js"></script>`:'<p class="notice">Sign-in is being set up. Please try again shortly.</p>'}<p class="small">Your saved scans and notes are private to your account.</p></main></body></html>`,{status,headers});
}
async function readToken(request:Request){
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new HttpError(415,'Send JSON content.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Sign-in token is missing.');
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>10000){await reader.cancel();throw new HttpError(413,'Sign-in request is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{const data=JSON.parse(new TextDecoder().decode(bytes));if(typeof data?.idToken==='string')return data.idToken;}catch{/* Do not expose parsing details. */}
 throw new HttpError(400,'Sign-in token is missing.');
}
export async function firebaseAuthRoute(request:Request,config:AuthConfig):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/auth/'))return null;
 if(url.origin!==authOrigin(config))return new Response('Use the Sigma application address.',{status:403,headers:privateHeaders()});
 try{
  if(url.pathname==='/auth/login'&&request.method==='GET')return firebaseLoginPage(config);
  if(url.pathname==='/auth/logout'){
   requirePost(request);await deleteSession(request,config);
   return redirect('/auth/login?signedOut=1',[cookie(SESSION_COOKIE,'',0)]);
  }
  if(!configured(config))throw new HttpError(503,'Sign-in is being set up. Please try again shortly.');
  if(url.pathname==='/auth/firebase.js'&&request.method==='GET'){
   const headers=privateHeaders();headers.set('Content-Type','text/javascript; charset=utf-8');return new Response(firebaseClient,{headers});
  }
  if(url.pathname==='/auth/firebase/session'){
   requirePost(request);await firebaseRateLimit(request,config);
   const user=await verifyFirebaseToken(await readToken(request),config);
   const session=await createFirebaseSession(config,user,cookieValue(request,SESSION_COOKIE));
   const headers=privateHeaders();headers.append('Set-Cookie',cookie(SESSION_COOKIE,session.token,session.maxAge));
   return Response.json({ok:true},{headers});
  }
  throw new HttpError(404,'Page not found.');
 }catch(error){
  return Response.json({error:error instanceof HttpError?error.message:'Sign-in is temporarily unavailable. Please try again.'},{status:error instanceof HttpError?error.status:503,headers:privateHeaders()});
 }
}
