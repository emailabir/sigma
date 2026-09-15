export const SESSION_COOKIE='__Host-sigma-session';
export const SESSION_SECONDS=60*60*24*7;
export type AuthConfig={
 SIGMA_DB?:D1Database;
 SIGMA_AUTH_ORIGIN?:string;
 SIGMA_GITHUB_CLIENT_ID?:string;
 SIGMA_GITHUB_CLIENT_SECRET?:string;
 SIGMA_GITHUB_USER_IDS?:string;
 SIGMA_AUTH_MODE?:string;
 SIGMA_BREVO_API_KEY?:string;
 SIGMA_EMAIL_FROM?:string;
 SIGMA_FIREBASE_PROJECT_ID?:string;
 SIGMA_FIREBASE_API_KEY?:string;
};
export function allowedIds(config:AuthConfig):Set<string>{
 const ids=(config.SIGMA_GITHUB_USER_IDS??'').split(',').map(s=>s.trim());
 return ids.length&&ids.every(s=>/^[1-9][0-9]{0,19}$/.test(s))?new Set(ids):new Set();
}
export function authOrigin(config:AuthConfig){
 try{const url=new URL(config.SIGMA_AUTH_ORIGIN??'');return url.protocol==='https:'&&url.origin===config.SIGMA_AUTH_ORIGIN?url.origin:null;}catch{return null;}
}
export function normalizeEmail(value:string){
 const email=value.trim().toLowerCase();
 return email.length<=254&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)&&!email.startsWith('.')&&!email.includes('..')&&!email.includes('.@')?email:null;
}
export function configured(config:AuthConfig){
 if(config.SIGMA_AUTH_MODE==='firebase')return !!(config.SIGMA_DB&&authOrigin(config)&&/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.SIGMA_FIREBASE_PROJECT_ID??'')&&/^[A-Za-z0-9_-]{20,100}$/.test(config.SIGMA_FIREBASE_API_KEY??''));
 if(config.SIGMA_AUTH_MODE==='email')return !!(config.SIGMA_DB&&authOrigin(config)&&config.SIGMA_BREVO_API_KEY?.trim()&&normalizeEmail(config.SIGMA_EMAIL_FROM??''));
 if(config.SIGMA_AUTH_MODE&&config.SIGMA_AUTH_MODE!=='github')return false;
 return !!(config.SIGMA_DB&&authOrigin(config)&&config.SIGMA_GITHUB_CLIENT_ID?.trim()&&config.SIGMA_GITHUB_CLIENT_SECRET?.trim()&&allowedIds(config).size);
}
export function randomToken(){return base64url(crypto.getRandomValues(new Uint8Array(32)));}
export function base64url(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
export async function digest(value:string){return new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));}
export async function tokenHash(value:string){return base64url(await digest(value));}
export function cookieValue(request:Request,name:string){
 const values=(request.headers.get('cookie')??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(name+'='));
 return values.length===1?values[0].slice(name.length+1):null;
}
export function cookie(name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;}
export async function readSession(request:Request,config:AuthConfig){
 const token=cookieValue(request,SESSION_COOKIE);
 if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token)||!config.SIGMA_DB)return null;
 if(config.SIGMA_AUTH_MODE==='firebase'){
  const row=await config.SIGMA_DB.prepare('SELECT s.user_id, s.email FROM firebase_sessions s JOIN firebase_accounts a ON a.project_id = s.project_id AND a.firebase_uid = s.firebase_uid AND a.user_id = s.user_id JOIN email_identities i ON i.email = s.email AND i.user_id = s.user_id AND i.enabled = 1 WHERE s.token_hash = ? AND s.project_id = ? AND s.expires_at > ?').bind(await tokenHash(token),config.SIGMA_FIREBASE_PROJECT_ID,Math.floor(Date.now()/1000)).first<{user_id:string;email:string}>();
  return row?{id:row.user_id,name:row.email}:null;
 }
 if(config.SIGMA_AUTH_MODE==='email'){
  const row=await config.SIGMA_DB.prepare('SELECT s.user_id, s.email FROM email_sessions s JOIN email_identities i ON i.email = s.email AND i.user_id = s.user_id AND i.enabled = 1 WHERE s.token_hash = ? AND s.expires_at > ?').bind(await tokenHash(token),Math.floor(Date.now()/1000)).first<{user_id:string;email:string}>();
  return row?{id:row.user_id,name:row.email}:null;
 }
 const row=await config.SIGMA_DB.prepare('SELECT github_id, login FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').bind(await tokenHash(token),Math.floor(Date.now()/1000)).first<{github_id:string;login:string}>();
 if(!row||!allowedIds(config).has(row.github_id))return null;
 return {id:'github:'+row.github_id,name:row.login};
}
export async function createSession(config:AuthConfig,githubId:string,login:string,oldToken:string|null){
 if(!config.SIGMA_DB||!allowedIds(config).has(githubId))throw new Error('Not invited');
 const token=randomToken(),hash=await tokenHash(token),now=Math.floor(Date.now()/1000),db=config.SIGMA_DB;
 await db.batch([
  db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ? OR token_hash = ?').bind(now,oldToken?await tokenHash(oldToken):''),
  db.prepare('INSERT INTO auth_sessions (token_hash, github_id, login, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').bind(hash,githubId,login,now,now+SESSION_SECONDS),
  db.prepare('DELETE FROM auth_sessions WHERE github_id = ? AND token_hash != ? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE github_id = ? AND token_hash != ? ORDER BY created_at DESC, token_hash DESC LIMIT 4)').bind(githubId,hash,githubId,hash)
 ]);
 return token;
}
export async function deleteSession(request:Request,config:AuthConfig){
 const token=cookieValue(request,SESSION_COOKIE);
 const table=config.SIGMA_AUTH_MODE==='firebase'?'firebase_sessions':config.SIGMA_AUTH_MODE==='email'?'email_sessions':'auth_sessions';
 if(token&&config.SIGMA_DB)await config.SIGMA_DB.prepare(`DELETE FROM ${table} WHERE token_hash = ?`).bind(await tokenHash(token)).run();
}
