import {allStocks} from '@/lib/universes';
import {cleanBars,type Bar} from '@/lib/strategy';
const allowed=new Set([...allStocks.map(x=>x.symbol),'SPY']);
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function serverCredentials(){
 const key=process.env.ALPACA_API_KEY_ID?.trim(),secret=process.env.ALPACA_API_SECRET_KEY?.trim();
 return key&&secret?{key,secret}:null;
}
export async function GET(){return reply({serverConfigured:Boolean(serverCredentials())});}
export async function POST(request:Request){
 try{
  const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return reply({error:'Cross-origin request rejected.'},403);
  if(Number(request.headers.get('content-length')??0)>10000)return reply({error:'Request too large.'},413);
  const body=await request.json() as Record<string,unknown>;const {symbols}=body;
  const {key,secret}=serverCredentials()??body;
  if(typeof key!=='string'||typeof secret!=='string'||key.length<5||secret.length<5||key.length>200||secret.length>200)return reply({error:'Enter a valid Alpaca API key and secret.'},400);
  if(!Array.isArray(symbols)||!symbols.length||symbols.length>20||!symbols.every(s=>typeof s==='string'&&allowed.has(s)))return reply({error:'Only S&P 500 or Nasdaq-100 constituents and the SPY benchmark are supported (20 per request).'},400);
  const nyDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const end=nyDate+'T00:00:00Z'; // Exclude all bars from the current New York calendar day.
  const start=new Date(Date.parse(end)-520*86400000).toISOString();
  const result:Record<string,Bar[]>={};let token:string|null=null;
  for(let page=0;page<5;page++){
   const params=new URLSearchParams({symbols:symbols.join(','),timeframe:'1Day',start,end,adjustment:'split',feed:'sip',limit:'10000',sort:'asc'});if(token)params.set('page_token',token);
   const res=await fetch('https://data.alpaca.markets/v2/stocks/bars?'+params,{headers:{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret},signal:AbortSignal.timeout(25000)});
   if(!res.ok){const error=res.status===401?'Alpaca rejected these credentials. Check both key and secret.':res.status===403?'This account cannot access historical SIP data. Check your Alpaca market-data access.':res.status===429?'Alpaca rate limit reached. Wait a minute, then run the scan again.':'Alpaca is temporarily unavailable. Please try again.';return reply({error},res.status===429?429:502);}
   const data=await res.json() as {bars:Record<string,Bar[]>;next_page_token:string|null};
   for(const symbol of symbols){if(data.bars?.[symbol])result[symbol]=[...(result[symbol]??[]),...data.bars[symbol]];}
   token=data.next_page_token;if(!token)break;
  }
  if(token)return reply({error:'Data exceeded the pagination limit. Scan could not be completed.'},502);
  for(const symbol of symbols)result[symbol]=cleanBars(result[symbol]??[]).filter(b=>b.t.slice(0,10)<nyDate);
  return reply({bars:result,source:'Alpaca SIP · split-adjusted daily bars',fetchedAt:new Date().toISOString()});
 }catch{return reply({error:'Could not retrieve data. Check your connection and try again.'},502);}
}

