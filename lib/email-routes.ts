import {HttpError} from './access';
import {type AuthConfig,authOrigin,configured,cookie,cookieValue,deleteSession,randomToken,SESSION_COOKIE,SESSION_SECONDS} from './session';
import {escapeHtml,privateHeaders,redirect,requirePost} from './auth-http';
import {CODE_SECONDS,EMAIL_FLOW_COOKIE,requestCode,verifyCode} from './email-login';

export function emailLoginPage(config:AuthConfig,message='',status=200,verify=false){
 const nonce=randomToken(),headers=privateHeaders();headers.set('Content-Type','text/html; charset=utf-8');
 headers.set('Content-Security-Policy',`default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
 const form=verify?`<form action="/auth/verify" method="post"><label for="code">Sign-in code</label><input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" minlength="8" maxlength="8" placeholder="8-digit code" required autofocus><button type="submit">Verify and sign in</button></form><p class="small">Codes expire after 10 minutes. Use the latest code in the browser where you requested it.</p><a href="/auth/login">Request a new code or use another email</a>`:`<form action="/auth/start" method="post"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" placeholder="you@example.com" required autofocus><button type="submit">Email me a sign-in code</button></form>`;
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · Sigma</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#f5f8f7;color:#18322d;font:16px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,460px);background:white;padding:40px;border:1px solid #dce6e2;border-radius:16px;box-shadow:0 12px 40px #163c2410}.brand{color:#167557;font-weight:750;font-size:28px}.eyebrow{color:#647d74;font-size:12px;letter-spacing:.12em;margin-top:28px}h1{font-size:28px;line-height:1.2;margin:12px 0}p{color:#526b63}label{display:block;font-weight:600;margin-top:24px}input{font:inherit;padding:12px;width:100%;border:1px solid #aec7bc;border-radius:8px;margin:8px 0 16px}button{font:inherit;font-weight:650;color:white;background:#167557;border:0;border-radius:8px;padding:13px 18px;width:100%;cursor:pointer}button:hover{background:#105e45}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #75b9a1;outline-offset:3px}a{color:#167557}.small{font-size:13px}.notice{background:#fff7e4;border:1px solid #ead9aa;padding:12px;border-radius:8px;color:#67552c}</style><main><div class="brand">Σ Sigma</div><div class="eyebrow">YOUR PRIVATE MARKET WORKSPACE</div><h1>${verify?'Check your email.':'Welcome back.'}</h1><p>${verify?'If this email is invited, we’ve sent a sign-in code. Check your inbox and spam folder.':'Sign in with your email. No password or GitHub account needed.'}</p>${message?`<p class="notice" role="alert">${escapeHtml(message)}</p>`:''}${configured(config)?form:'<p class="notice" role="status">Email sign-in is being set up. Please try again shortly.</p>'}<p class="small">Invitation only. Your saved scans and notes are private to your account.</p></main></html>`,{status,headers});
}
async function readForm(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))throw new HttpError(415,'Submit the sign-in form.');
 const reader=request.body?.getReader();let text='',size=0;
 if(!reader)throw new HttpError(400,'Submit the sign-in form.');
 const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();throw new HttpError(413,'Sign-in form is too large.');}text+=decoder.decode(value,{stream:true});}
 return new URLSearchParams(text+decoder.decode());
}
export async function emailAuthRoute(request:Request,config:AuthConfig):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/auth/'))return null;
 if(url.origin!==authOrigin(config))return new Response('Use the Sigma application address.',{status:403,headers:privateHeaders()});
 const verifying=url.pathname==='/auth/verify';
 try{
  if(request.method==='GET'&&url.pathname==='/auth/login')return emailLoginPage(config);
  if(request.method==='GET'&&verifying)return cookieValue(request,EMAIL_FLOW_COOKIE)?emailLoginPage(config,'',200,true):redirect('/auth/login');
  if(url.pathname==='/auth/logout'){
   requirePost(request);await deleteSession(request,config);
   return redirect('/auth/login',[cookie(SESSION_COOKIE,'',0),cookie(EMAIL_FLOW_COOKIE,'',0),cookie('__Host-sigma-oauth','',0)]);
  }
  if(!configured(config))return emailLoginPage(config,'',503);
  if(url.pathname==='/auth/start'||verifying){
   requirePost(request);const form=await readForm(request),field=verifying?'code':'email';
   if(form.getAll(field).length!==1)throw new HttpError(400,'Submit the sign-in form.');
   if(!verifying){const flow=await requestCode(request,config,form.get('email')!);return redirect('/auth/verify',[cookie(EMAIL_FLOW_COOKIE,flow,CODE_SECONDS)]);}
   const session=await verifyCode(request,config,form.get('code')!.trim());
   return redirect('/',[cookie(SESSION_COOKIE,session,SESSION_SECONDS),cookie(EMAIL_FLOW_COOKIE,'',0)]);
  }
  throw new HttpError(404,'Page not found.');
 }catch(error){return emailLoginPage(config,error instanceof HttpError?error.message:'Sign-in is temporarily unavailable. Please try again.',error instanceof HttpError?error.status:502,verifying);}
}
