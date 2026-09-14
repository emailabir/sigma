import {HttpError} from './access';
import {type AuthConfig,authOrigin,cookieValue,normalizeEmail,randomToken,tokenHash,SESSION_COOKIE,SESSION_SECONDS} from './session';

export const EMAIL_FLOW_COOKIE='__Host-sigma-email-flow';
export const CODE_SECONDS=600;
const seconds=()=>Math.floor(Date.now()/1000);

// Atomic counters apply across Worker instances. Keys contain hashes, not IPs
// or email addresses; expired counters and challenges are removed on requests.
async function limit(db:D1Database,key:string,max:number,window:number){
 const now=seconds(),slot=Math.floor(now/window);
 const row=await db.prepare('INSERT INTO auth_limits (bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count').bind(`${key}:${slot}`,(slot+1)*window,max).first();
 if(!row)throw new HttpError(429,'Too many attempts. Please wait before trying again.');
}
export function randomCode(){
 // Rejection sampling avoids modulo bias for eight decimal digits.
 const value=new Uint32Array(1);
 do{crypto.getRandomValues(value);}while(value[0]>=4200000000);
 return String(value[0]%100000000).padStart(8,'0');
}
async function deliver(config:AuthConfig,email:string,code:string){
 const response=await fetch('https://api.brevo.com/v3/smtp/email',{
  method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
  headers:{'Content-Type':'application/json',Accept:'application/json','api-key':config.SIGMA_BREVO_API_KEY!},
  body:JSON.stringify({sender:{name:'Sigma',email:normalizeEmail(config.SIGMA_EMAIL_FROM!)},to:[{email}],subject:'Your Sigma sign-in code',textContent:`Your Sigma sign-in code is: ${code}\n\nEnter it in the browser where you requested it at ${authOrigin(config)}. It expires in 10 minutes and works once.\n\nIf you did not request this code, you can ignore this email. Never share this code.`})
 });
 // Do not expose or persist provider responses, which can contain private data.
 if(response.status!==201){await response.body?.cancel();throw new Error('Email delivery failed');}
 await response.body?.cancel();
}
export async function requestCode(request:Request,config:AuthConfig,emailInput:string){
 const email=normalizeEmail(emailInput);if(!email)throw new HttpError(400,'Enter a valid email address.');
 const db=config.SIGMA_DB!,now=seconds();
 await limit(db,'requests',2000,86400);
 await limit(db,'send-ip:'+await tokenHash(request.headers.get('cf-connecting-ip')??'unknown'),20,3600);
 await db.batch([
  db.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').bind(now),
  db.prepare('DELETE FROM email_challenges WHERE expires_at <= ?').bind(now)
 ]);
 const flow=randomToken();
 const identity=await db.prepare('SELECT user_id FROM email_identities WHERE email = ? AND enabled = 1').bind(email).first<{user_id:string}>();
 // Same response and browser cookie for invited and uninvited addresses.
 if(!identity)return flow;
 const key=await tokenHash(email);
 await limit(db,'send-email-minute:'+key,1,60);
 await limit(db,'send-email-hour:'+key,5,3600);
 await limit(db,'emails',100,86400);
 const flowHash=await tokenHash(flow),code=randomCode(),codeHash=await tokenHash(flow+':'+code);
 await db.prepare('INSERT INTO email_challenges (flow_hash,email,user_id,code_hash,expires_at,attempts,consumed_at) VALUES (?,?,?,?,?,0,NULL) ON CONFLICT(email) DO UPDATE SET flow_hash=excluded.flow_hash,user_id=excluded.user_id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,consumed_at=NULL').bind(flowHash,email,identity.user_id,codeHash,now+CODE_SECONDS).run();
 try{await deliver(config,email,code);}catch{
  await db.prepare('DELETE FROM email_challenges WHERE flow_hash = ?').bind(flowHash).run();
  throw new HttpError(502,'We could not send a sign-in code. Please try again later.');
 }
 return flow;
}
export async function verifyCode(request:Request,config:AuthConfig,code:string){
 const db=config.SIGMA_DB!,flow=cookieValue(request,EMAIL_FLOW_COOKIE),now=seconds();
 await limit(db,'verify-ip:'+await tokenHash(request.headers.get('cf-connecting-ip')??'unknown'),40,600);
 if(!flow||!/^[A-Za-z0-9_-]{43}$/.test(flow)||!/^\d{8}$/.test(code))throw new HttpError(400,'Code is invalid or expired. Request a new code if needed.');
 // Validation, attempt increment and one-time consumption are one atomic write.
 // A concurrent request with the same correct code can never consume it twice.
 const row=await db.prepare('UPDATE email_challenges SET attempts=attempts+1,consumed_at=CASE WHEN code_hash = ? THEN ? ELSE NULL END WHERE flow_hash = ? AND consumed_at IS NULL AND expires_at > ? AND attempts < 5 RETURNING email,user_id,consumed_at').bind(await tokenHash(flow+':'+code),now,await tokenHash(flow),now).first<{email:string;user_id:string;consumed_at:number|null}>();
 if(!row?.consumed_at)throw new HttpError(400,'Code is invalid or expired. Request a new code if needed.');
 const token=randomToken(),hash=await tokenHash(token),old=cookieValue(request,SESSION_COOKIE);
 const results=await db.batch([
  db.prepare('DELETE FROM email_sessions WHERE expires_at <= ? OR token_hash = ?').bind(now,old?await tokenHash(old):''),
  db.prepare('INSERT INTO email_sessions (token_hash,email,user_id,created_at,expires_at) SELECT ?,email,user_id,?,? FROM email_identities WHERE email = ? AND user_id = ? AND enabled = 1').bind(hash,now,now+SESSION_SECONDS,row.email,row.user_id),
  db.prepare('DELETE FROM email_sessions WHERE user_id = ? AND token_hash != ? AND token_hash NOT IN (SELECT token_hash FROM email_sessions WHERE user_id = ? AND token_hash != ? ORDER BY created_at DESC,token_hash DESC LIMIT 4)').bind(row.user_id,hash,row.user_id,hash)
 ]);
 if(results[1].meta.changes!==1)throw new HttpError(403,'This account no longer has access.');
 return token;
}
