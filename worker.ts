import handler from 'vinext/server/fetch-handler';
import {authGate} from './lib/auth-gate';
import type {SigmaEnv} from './lib/server';

// Only the login routes are public. All data, app routes and assets require
// a valid session belonging to an explicitly invited GitHub account.
export default {
 async fetch(request:Request,env:SigmaEnv,ctx:ExecutionContext){
  return authGate(request,env,()=>handler.fetch(request,env,ctx));
 }
};
