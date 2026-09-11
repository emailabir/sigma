import {env} from 'cloudflare:workers';
import {identity,HttpError,type AccessConfig} from './access';
export type SigmaEnv=AccessConfig & {SIGMA_DB?:D1Database;ALPACA_API_KEY_ID?:string;ALPACA_API_SECRET_KEY?:string};
export async function context(request:Request){
 const bindings=env as unknown as SigmaEnv;
 const user=await identity(request,bindings);
 if(!bindings.SIGMA_DB)throw new HttpError(503,'Saved scans and watchlists are not configured yet.');
 return {user,db:bindings.SIGMA_DB};
}
export const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export function failure(error:unknown){return json({error:error instanceof HttpError?error.message:'Could not complete this request. Please retry.'},error instanceof HttpError?error.status:500);}
export async function readJson(request:Request,maxBytes=1800000):Promise<unknown>{
 if(Number(request.headers.get('content-length')??0)>maxBytes)throw new HttpError(413,'Scan is too large to save.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Request body is missing.');
 const parts:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new HttpError(413,'Scan is too large to save.');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new HttpError(400,'Invalid JSON request.');}
}
