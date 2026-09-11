import {configured,readSession,authOrigin,type AuthConfig} from './session';

export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export type AccessConfig=AuthConfig;
export async function identity(request:Request,config:AuthConfig):Promise<{id:string;name:string}>{
 if(!configured(config))throw new HttpError(503,'Sign-in is being set up. Please try again shortly.');
 if(new URL(request.url).origin!==authOrigin(config))throw new HttpError(403,'Use the Sigma application address to sign in.');
 const user=await readSession(request,config);
 if(!user)throw new HttpError(401,'Your session expired. Sign in again.');
 return user;
}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');
 if(!origin||origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-origin request rejected.');
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new HttpError(415,'Send JSON content.');
}
