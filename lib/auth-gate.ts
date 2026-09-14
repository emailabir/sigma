import {identity,HttpError} from './access';
import {authRoute,privateHeaders} from './auth-routes';
import type {AuthConfig} from './session';

export async function authGate(request:Request,config:AuthConfig & {ASSETS?:Fetcher},next:()=>Promise<Response>){
 try{
  const auth=await authRoute(request,config);if(auth)return auth;
  await identity(request,config);
  // run_worker_first keeps assets private, so the Worker must explicitly serve
  // them after authentication instead of sending them to the application router.
  const path=new URL(request.url).pathname;
  const asset=path.startsWith('/_next/static/')||path==='/RULES.md'||path==='/favicon.svg';
  const response=asset&&config.ASSETS?await config.ASSETS.fetch(request):await next(),headers=new Headers(response.headers);
  for(const [name,value] of privateHeaders())headers.set(name,value);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }catch(error){
  const status=error instanceof HttpError?error.status:500;
  const message=error instanceof HttpError?error.message:'Sigma is temporarily unavailable.';
  const headers=privateHeaders();
  if(request.method==='GET'&&new URL(request.url).pathname==='/'&&(status===401||status===503)){
   headers.set('Location','/auth/login');return new Response(null,{status:303,headers});
  }
  if(new URL(request.url).pathname.startsWith('/api/'))return Response.json({error:message},{status,headers});
  headers.set('Content-Type','text/plain; charset=utf-8');return new Response(message,{status,headers});
 }
}
