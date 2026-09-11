import handler from 'vinext/server/fetch-handler';
import {identity,HttpError} from './lib/access';
import type {SigmaEnv} from './lib/server';

// Protect every route, including the data API, even before the edge Access
// application is configured. No caller-supplied user ID is trusted.
export default {
 async fetch(request:Request,env:SigmaEnv,ctx:ExecutionContext){
  try{
   await identity(request,env);
   const response=await handler.fetch(request,env,ctx);
   const headers=new Headers(response.headers);
   headers.set('Cache-Control','private, no-store');
   headers.set('X-Content-Type-Options','nosniff');
   headers.set('Referrer-Policy','same-origin');
   return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
  }catch(error){
   return new Response(error instanceof HttpError?error.message:'Sigma is temporarily unavailable.',{status:error instanceof HttpError?error.status:500,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}});
  }
 }
};
