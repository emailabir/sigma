import {context,json,failure,readJson} from '@/lib/server';
import {sameOrigin,HttpError} from '@/lib/access';
import {LibraryStore} from '@/lib/library-store';
import {validateSnapshot} from '@/lib/library';
import {allStocks} from '@/lib/universes';
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export async function GET(request:Request){try{
 const {user,db}=await context(request),store=new LibraryStore(db,user.id),id=new URL(request.url).searchParams.get('id');
 if(id){if(!uuid(id))throw new HttpError(400,'Invalid scan ID.');const scan=await store.get(id);if(!scan)throw new HttpError(404,'Scan not found.');return json({scan});}
 const [scans,watchlist]=await Promise.all([store.list(),store.watchlist()]);return json({scans,watchlist,email:user.email});
 }catch(error){return failure(error);}}
export async function POST(request:Request){try{
 sameOrigin(request);const {user,db}=await context(request),store=new LibraryStore(db,user.id);
 const body=await readJson(request) as Record<string,unknown>;
 if(body?.action==='saveScan'){
  if(!uuid(body.id))throw new HttpError(400,'Invalid scan ID.');
  let snapshot;try{snapshot=validateSnapshot(body.snapshot);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'Invalid snapshot.');}
  const scan=await store.save(body.id,snapshot);if(!scan)throw new HttpError(409,'Scan ID is already used. Retry with a new scan.');return json({scan});
 }
 if(body?.action==='deleteScan'){if(!uuid(body.id))throw new HttpError(400,'Invalid scan ID.');await store.remove(body.id);return json({ok:true});}
 if(body?.action==='watch'||body?.action==='unwatch'){
  if(typeof body.symbol!=='string'||!allStocks.some(s=>s.symbol===body.symbol))throw new HttpError(400,'Choose a supported stock.');
  if(body.note!==undefined&&(typeof body.note!=='string'||body.note.length>2000))throw new HttpError(400,'Notes must be at most 2,000 characters.');
  if(body.action==='watch')await store.watch(body.symbol,body.note as string|undefined);else await store.unwatch(body.symbol);return json({ok:true});
 }
 throw new HttpError(400,'Unknown library action.');
 }catch(error){return failure(error);}}
