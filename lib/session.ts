export const SESSION_COOKIE='__Host-sigma-session';
export const SESSION_SECONDS=60*60*24*7;
export type AuthConfig={
 SIGMA_DB?:D1Database;
 SIGMA_AUTH_ORIGIN?:string;
 SIGMA_GITHUB_CLIENT_ID?:string;
 SIGMA_GITHUB_CLIENT_SECRET?:string;
 SIGMA_GITHUB_USER_IDS?:string;
};
export function allowedIds(config:AuthConfig):Set<string>{
 const ids=(config.SIGMA_GITHUB_USER_IDS??'').split(',').map(s=>s.trim());
 return ids.length&&ids.every(s=>/^[1-9][0-9]{0,19}$/.test(s))?new Set(ids):new Set();
}
export function authOrigin(config:AuthConfig){
 try{const url=new URL(config.SIGMA_AUTH_ORIGIN??'');return url.protocol==='https:'&&url.origin===config.SIGMA_AUTH_ORIGIN?url.origin:null;}catch{return null;}
}
export function configured(config:AuthConfig){return !!(config.SIGMA_DB&&authOrigin(config)&&config.SIGMA_GITHUB_CLIENT_ID?.trim()&&config.SIGMA_GITHUB_CLIENT_SECRET?.trim()&&allowedIds(config).size);}
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
 if(token&&config.SIGMA_DB)await config.SIGMA_DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await tokenHash(token)).run();
}
