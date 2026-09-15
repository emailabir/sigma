import {decodeProtectedHeader,importX509,jwtVerify} from 'jose';
import {HttpError} from './access';
import {type AuthConfig,normalizeEmail,randomToken,tokenHash} from './session';

const certURL='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let certCache:{certs:Record<string,string>;expires:number;fetched:number}|undefined;
let fetching:Promise<Record<string,string>>|undefined;
async function certificates(kid:string){
 const now=Date.now();
 if(certCache&&now<certCache.expires&&(certCache.certs[kid]||now-certCache.fetched<60000))return certCache.certs;
 if(!fetching)fetching=(async()=>{
  const response=await fetch(certURL,{redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new HttpError(503,'Identity verification is temporarily unavailable. Try again shortly.');
  const certs=await response.json() as Record<string,string>;
  if(!certs||Array.isArray(certs)||typeof certs!=='object'||!Object.values(certs).every(v=>typeof v==='string'&&v.includes('BEGIN CERTIFICATE')))throw new Error('Invalid verification keys');
  const seconds=Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1]??300);
  certCache={certs,expires:Date.now()+Math.min(seconds,3600)*1000,fetched:Date.now()};return certs;
 })().finally(()=>{fetching=undefined;});
 return fetching;
}
export async function verifyFirebaseToken(token:string,config:AuthConfig){
 if(!token||token.length>8192)throw new HttpError(401,'Sign in again to continue.');
 try{
  const header=decodeProtectedHeader(token);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200)throw new Error('Invalid token header');
  const cert=(await certificates(header.kid))[header.kid];if(!cert)throw new Error('Unknown signing key');
  const {payload}=await jwtVerify(token,await importX509(cert,'RS256'),{algorithms:['RS256'],issuer:`https://securetoken.google.com/${config.SIGMA_FIREBASE_PROJECT_ID}`,audience:config.SIGMA_FIREBASE_PROJECT_ID,requiredClaims:['sub','exp','iat','auth_time']});
  const now=Math.floor(Date.now()/1000),email=typeof payload.email==='string'?normalizeEmail(payload.email):null;
  const firebase=payload.firebase as {sign_in_provider?:unknown;tenant?:unknown}|undefined;
  if(!payload.sub||payload.sub.length>128||typeof payload.iat!=='number'||payload.iat>now||typeof payload.auth_time!=='number'||payload.auth_time>now||payload.auth_time<0||typeof payload.exp!=='number'||!email||payload.email_verified!==true||firebase?.tenant||!['password','google.com'].includes(String(firebase?.sign_in_provider)))throw new Error('Invalid identity');
  return {uid:payload.sub,email,expires:Math.min(payload.exp,now+3600)};
 }catch(error){
  if(error instanceof HttpError&&error.status===503)throw error;
  throw new HttpError(401,'Sign in with a verified email address to continue.');
 }
}
export async function firebaseRateLimit(request:Request,config:AuthConfig){
 const now=Math.floor(Date.now()/1000),bucket='firebase:'+await tokenHash(request.headers.get('cf-connecting-ip')??'unknown')+':'+Math.floor(now/600);
 const row=await config.SIGMA_DB!.prepare('INSERT INTO auth_limits (bucket,count,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,now+600).first<{count:number}>();
 if(!row||row.count>60)throw new HttpError(429,'Too many sign-in attempts. Try again in ten minutes.');
 await config.SIGMA_DB!.prepare('DELETE FROM auth_limits WHERE expires_at <= ?').bind(now).run();
}
export async function createFirebaseSession(config:AuthConfig,user:{uid:string;email:string;expires:number},oldToken:string|null){
 const db=config.SIGMA_DB!,project=config.SIGMA_FIREBASE_PROJECT_ID!,now=Math.floor(Date.now()/1000);
 const invitation=await db.prepare('SELECT user_id FROM email_identities WHERE email = ? AND enabled = 1').bind(user.email).first<{user_id:string}>();
 if(!invitation)throw new HttpError(403,'This email has not been invited to Sigma. Ask the owner for access.');
 // Only a verified email may claim an invitation. UID ownership is then pinned:
 // recreating a Firebase account or reusing an email never silently reassigns data.
 await db.prepare('INSERT INTO firebase_accounts (project_id,firebase_uid,user_id) SELECT ?,?,user_id FROM email_identities WHERE email = ? AND user_id = ? AND enabled = 1 ON CONFLICT DO NOTHING').bind(project,user.uid,user.email,invitation.user_id).run();
 const account=await db.prepare('SELECT user_id FROM firebase_accounts WHERE project_id = ? AND firebase_uid = ?').bind(project,user.uid).first<{user_id:string}>();
 if(account?.user_id!==invitation.user_id)throw new HttpError(403,'This email is linked to another sign-in identity. Contact the Sigma owner.');
 const token=randomToken(),hash=await tokenHash(token);
 const result=await db.batch([
  db.prepare('DELETE FROM firebase_sessions WHERE expires_at <= ? OR token_hash = ?').bind(now,oldToken?await tokenHash(oldToken):''),
  db.prepare('INSERT INTO firebase_sessions (token_hash,project_id,firebase_uid,user_id,email,created_at,expires_at) SELECT ?,?,?,user_id,email,?,? FROM email_identities WHERE email = ? AND user_id = ? AND enabled = 1').bind(hash,project,user.uid,now,user.expires,user.email,account.user_id),
  db.prepare('DELETE FROM firebase_sessions WHERE project_id = ? AND user_id = ? AND token_hash != ? AND token_hash NOT IN (SELECT token_hash FROM firebase_sessions WHERE project_id = ? AND user_id = ? AND token_hash != ? ORDER BY created_at DESC,token_hash DESC LIMIT 4)').bind(project,account.user_id,hash,project,account.user_id,hash)
 ]);
 if(result[1].meta.changes!==1)throw new HttpError(403,'This invitation is no longer active.');
 return {token,maxAge:Math.max(0,user.expires-now)};
}
