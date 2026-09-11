import {createRemoteJWKSet,jwtVerify} from 'jose';

export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export type AccessConfig={CF_ACCESS_TEAM_DOMAIN?:string;CF_ACCESS_AUD?:string};
const keySets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
export async function identity(request:Request,config:AccessConfig):Promise<{id:string;email:string}>{
 const domain=config.CF_ACCESS_TEAM_DOMAIN?.trim(),aud=config.CF_ACCESS_AUD?.trim();
 if(!domain||!aud||!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain))throw new HttpError(503,'Private access is not configured yet.');
 const token=request.headers.get('cf-access-jwt-assertion');
 if(!token)throw new HttpError(401,'Sign in through Cloudflare Access to use Sigma.');
 let keys=keySets.get(domain);if(!keys){keys=createRemoteJWKSet(new URL(domain+'/cdn-cgi/access/certs'));keySets.set(domain,keys);}
 try{
  const {payload}=await jwtVerify(token,keys,{issuer:domain,audience:aud,algorithms:['RS256'],requiredClaims:['sub','exp','iat','email'],clockTolerance:5});
  if(typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string'||!payload.email)throw new Error('No user identity');
  return {id:payload.sub,email:payload.email};
 }catch{throw new HttpError(401,'Your session could not be verified. Sign in again.');}
}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(!origin||origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-origin request rejected.');
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'Send JSON content.');
}
