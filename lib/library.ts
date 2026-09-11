import {parseRules,type Rules} from './rules';
import {universes,type UniverseId} from './universes';
import type {Signal} from './strategy';
export type StoredSignal=Omit<Signal,'history'> & {history:{c:number}[]};
export type Snapshot={
 schema:1;universeId:UniverseId;rulesMarkdown:string;rules:Rules;
 stocks:{symbol:string;name:string;sector:string}[];
 signals:Record<string,StoredSignal>;marketDate:string|null;complete:boolean;processed:number;
};
export type ScanSummary={id:string;created_at:string;market_date:string|null;universe_id:UniverseId;rules_name:string;compatibility_key:string;complete:number;processed:number;total:number;qualified:number};
export type SavedScan=ScanSummary & {snapshot:Snapshot};
export type WatchItem={symbol:string;note:string;added_at:string;updated_at:string;market_date:string|null;rules_name:string|null;signal:StoredSignal|null};
export function makeSnapshot(universeId:UniverseId,rulesMarkdown:string,signals:Record<string,Signal>,marketDate:string|null,complete:boolean,processed:number):Snapshot{
 return {schema:1,universeId,rulesMarkdown,rules:parseRules(rulesMarkdown),stocks:universes[universeId].stocks,
  signals:Object.fromEntries(Object.entries(signals).map(([symbol,s])=>[symbol,{...s,history:s.history.map(b=>({c:b.c}))}])),marketDate,complete,processed};
}
const statuses=['Qualified','Watch','Not qualified','No data','Stale data','Insufficient data'];
export function validateSnapshot(value:unknown):Snapshot{
 const v=value as Snapshot;
 const bad=()=>{throw new Error('Invalid scan snapshot. Run a new scan and try again.');};
 if(!v||v.schema!==1||!Object.hasOwn(universes,v.universeId)||typeof v.rulesMarkdown!=='string'||v.rulesMarkdown.length>65536||typeof v.complete!=='boolean')return bad();
 const rules=parseRules(v.rulesMarkdown),expected=universes[v.universeId].stocks;
 if(!Number.isInteger(v.processed)||v.processed<1||v.processed>expected.length||(v.complete&&v.processed!==expected.length))return bad();
 if(v.marketDate!==null&&(typeof v.marketDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.marketDate)||!Number.isFinite(Date.parse(v.marketDate))))return bad();
 if(!Array.isArray(v.stocks)||v.stocks.length!==expected.length||v.stocks.some((s,i)=>s.symbol!==expected[i].symbol))return bad();
 if(!v.signals||typeof v.signals!=='object'||Array.isArray(v.signals)||Object.keys(v.signals).length!==v.processed)return bad();
 const clean:Record<string,StoredSignal>={};
 const nums=['close','rsi','rvol','atr','ema','smaFast','smaSlow','level','entry','stop','target'] as const;
 for(const [symbol,s] of Object.entries(v.signals)){
  if(!expected.some(stock=>stock.symbol===symbol)||!s||!statuses.includes(s.status)||!Number.isInteger(s.score)||s.score<0||s.score>rules.enabled_checks.length)return bad();
  if(!Array.isArray(s.checks)||s.checks.length>rules.enabled_checks.length||!Array.isArray(s.history)||s.history.length>63)return bad();
  if(s.checks.some((c,i)=>!c||c.id!==rules.enabled_checks[i]||typeof c.pass!=='boolean'||typeof c.label!=='string'||c.label.length>200||typeof c.value!=='string'||c.value.length>300))return bad();
  if(s.score!==s.checks.filter(c=>c.pass).length||(s.status==='Qualified'&&(s.score!==rules.enabled_checks.length||!s.entry||!s.stop||!s.target)))return bad();
  if(s.history.some(b=>!b||!Number.isFinite(b.c)||b.c<=0))return bad();
  if(nums.some(n=>s[n]!==undefined&&!Number.isFinite(s[n])))return bad();
  if(s.reason!==undefined&&(typeof s.reason!=='string'||s.reason.length>500))return bad();
  if(s.date!==undefined&&(typeof s.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.date)))return bad();
  clean[symbol]={status:s.status,score:s.score,checks:s.checks.map(c=>({id:c.id,label:c.label,value:c.value,pass:c.pass})),history:s.history.map(b=>({c:b.c})),...(s.reason?{reason:s.reason}:{}),...(s.date?{date:s.date}:{}),...Object.fromEntries(nums.filter(n=>s[n]!==undefined).map(n=>[n,s[n]]))};
 }
 return {schema:1,universeId:v.universeId,rulesMarkdown:v.rulesMarkdown,rules,stocks:expected,signals:clean,marketDate:v.marketDate,complete:v.complete,processed:v.processed};
}
export async function compatibilityKey(snapshot:Snapshot){
 const canonical=JSON.stringify({model:'sigma-breakout-v1',universe:snapshot.universeId,symbols:snapshot.stocks.map(s=>s.symbol).sort(),rules:Object.fromEntries(Object.entries(snapshot.rules).sort(([a],[b])=>a.localeCompare(b)))});
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
}
export function compareScans(current:SavedScan,previous:SavedScan){
 if(!current.complete||!previous.complete||current.compatibility_key!==previous.compatibility_key||!current.market_date||!previous.market_date||previous.market_date>=current.market_date)return null;
 const now=new Set(Object.entries(current.snapshot.signals).filter(([,s])=>s.status==='Qualified').map(([symbol])=>symbol));
 const before=new Set(Object.entries(previous.snapshot.signals).filter(([,s])=>s.status==='Qualified').map(([symbol])=>symbol));
 // Changes involving missing/stale data are kept separate from disqualification.
 const valid=(s?:StoredSignal)=>!!s&&['Qualified','Watch','Not qualified'].includes(s.status);
 return {
  newly:[...now].filter(s=>!before.has(s)&&valid(previous.snapshot.signals[s])),
  still:[...now].filter(s=>before.has(s)),
  lost:[...before].filter(s=>!now.has(s)&&valid(current.snapshot.signals[s])),
  unavailable:current.snapshot.stocks.filter(s=>!valid(current.snapshot.signals[s.symbol])||!valid(previous.snapshot.signals[s.symbol])).map(s=>s.symbol)
 };
}
