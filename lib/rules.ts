export const checkIds=['trend','breakout','volume','rsi','extension','relative_strength','market'] as const;
export type CheckId=typeof checkIds[number];
export type Rules={
 schema_version:1;name:string;enabled_checks:CheckId[];
 sma_fast:number;sma_slow:number;breakout_period:number;volume_period:number;volume_min:number;
 rsi_period:number;rsi_min:number;rsi_max:number;ema_period:number;atr_period:number;
 max_extension_atr:number;relative_strength_period:number;relative_strength_min_pp:number;market_sma_period:number;
 entry_buffer_atr:number;stop_atr:number;target_atr:number;max_data_age_days:number;
};
const bounds:Record<string,[number,number,boolean]>={
 sma_fast:[2,250,true],sma_slow:[2,250,true],breakout_period:[2,250,true],volume_period:[2,250,true],volume_min:[.01,100,false],
 rsi_period:[2,250,true],rsi_min:[0,100,false],rsi_max:[0,100,false],ema_period:[2,250,true],atr_period:[2,250,true],
 max_extension_atr:[0,20,false],relative_strength_period:[2,250,true],relative_strength_min_pp:[-100,100,false],market_sma_period:[2,250,true],
 entry_buffer_atr:[0,20,false],stop_atr:[.01,100,false],target_atr:[.01,100,false],max_data_age_days:[1,30,true]
};
export function parseRules(markdown:string):Rules{
 if(markdown.length>65536)throw new Error('Rules file must be smaller than 64 KB.');
 const blocks=[...markdown.matchAll(/^```json[ \t]*\r?\n([\s\S]*?)^```[ \t]*\r?$/gm)];
 if(blocks.length!==1)throw new Error('Include exactly one fenced json block in the Markdown file.');
 let value:unknown;try{value=JSON.parse(blocks[0][1]);}catch{throw new Error('The rules JSON is invalid. Check commas, quotes and numbers.');}
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Rules must be a JSON object.');
 const v=value as Record<string,unknown>,allowed=['schema_version','name','enabled_checks',...Object.keys(bounds)];
 for(const k of Object.keys(v))if(!allowed.includes(k))throw new Error(`Unknown setting: ${k}.`);
 if(v.schema_version!==1)throw new Error('schema_version must be 1.');
 if(typeof v.name!=='string'||!v.name.trim()||v.name.length>100)throw new Error('name must contain 1–100 characters.');
 if(!Array.isArray(v.enabled_checks)||!v.enabled_checks.length||new Set(v.enabled_checks).size!==v.enabled_checks.length||!v.enabled_checks.every(x=>checkIds.includes(x)))throw new Error('enabled_checks must contain unique supported check names, with at least one enabled.');
 for(const [k,[min,max,integer]] of Object.entries(bounds)){const n=v[k];if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw new Error(`${k} must be ${integer?'an integer':'a number'} between ${min} and ${max}.`);}
 if((v.sma_fast as number)>=(v.sma_slow as number))throw new Error('sma_fast must be smaller than sma_slow.');
 if((v.rsi_min as number)>(v.rsi_max as number))throw new Error('rsi_min cannot exceed rsi_max.');
 return v as Rules;
}
export function requiredBars(r:Rules){return Math.max(r.sma_fast,r.sma_slow,r.breakout_period,r.volume_period,r.rsi_period,r.ema_period,r.atr_period,r.relative_strength_period,r.market_sma_period)+1;}
export function ruleLabels(r:Rules):Record<CheckId,string>{return {
 trend:`Price > SMA ${r.sma_fast} > SMA ${r.sma_slow}`,
 breakout:`Close above prior ${r.breakout_period}-day high`,
 volume:`Relative volume ≥ ${r.volume_min}×`,
 rsi:`RSI (${r.rsi_period}) between ${r.rsi_min} and ${r.rsi_max}`,
 extension:`Close ≤ EMA ${r.ema_period} + ${r.max_extension_atr} ATR`,
 relative_strength:`${r.relative_strength_period}-day return beats SPY by > ${r.relative_strength_min_pp} pp`,
 market:`SPY above SMA ${r.market_sma_period}`
 };}
