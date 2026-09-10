import {requiredBars,ruleLabels,type Rules,type CheckId} from './rules';
export type Bar={t:string;o:number;h:number;l:number;c:number;v:number};
export type Check={id:CheckId;label:string;pass:boolean;value:string};
export type Signal={status:string;reason?:string;close?:number;rsi?:number;rvol?:number;atr?:number;ema?:number;smaFast?:number;smaSlow?:number;level?:number;entry?:number;stop?:number;target?:number;date?:string;checks:Check[];score:number;history:Bar[]};
const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
export function cleanBars(bars:Bar[]){
 const seen=new Set<string>();
 return [...bars].sort((a,b)=>a.t.localeCompare(b.t)).filter(b=>{const day=b.t.slice(0,10);if(seen.has(day)||!Number.isFinite(Date.parse(b.t))||![b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||Math.min(b.o,b.h,b.l,b.c)<=0||b.v<0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h))return false;seen.add(day);return true});
}
export function analyze(input:Bar[],benchmark:Bar[],r:Rules,now=Date.now()):Signal{
 const b=cleanBars(input),spy=cleanBars(benchmark),last=b.at(-1),minimum=requiredBars(r);
 const empty=(reason:string,status='Insufficient data'):Signal=>({status,reason,close:last?.c,date:last?.t.slice(0,10),checks:[],score:0,history:b.slice(-63)});
 if(b.length<minimum||spy.length<minimum)return empty(`At least ${minimum} valid daily bars for this stock and SPY are required by the active rules.`);
 const s=spy.at(-1)!;if(last!.t.slice(0,10)!==s.t.slice(0,10))return empty('Stock and SPY dates do not match.','Stale data');
 const age=(now-Date.parse(last!.t))/86400000;
 if(age>r.max_data_age_days||age<0)return empty(`Latest daily bar exceeds the ${r.max_data_age_days}-calendar-day age limit or has an invalid future date.`,'Stale data');
 const days=new Set(b.map(x=>x.t.slice(0,10)));
 if(spy.slice(-minimum).some(x=>!days.has(x.t.slice(0,10))))return empty(`Missing daily bars within the latest ${minimum} benchmark sessions.`);
 const c=b.map(x=>x.c),close=c.at(-1)!,smaFast=mean(c.slice(-r.sma_fast)),smaSlow=mean(c.slice(-r.sma_slow));
 let ema=mean(c.slice(0,r.ema_period));const alpha=2/(r.ema_period+1);for(let i=r.ema_period;i<c.length;i++)ema=c[i]*alpha+ema*(1-alpha);
 let gain=0,loss=0,atr=0;
 for(let i=1;i<c.length;i++){
  const d=c[i]-c[i-1],tr=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-c[i-1]),Math.abs(b[i].l-c[i-1]));
  if(i<=r.rsi_period){gain+=Math.max(d,0)/r.rsi_period;loss+=Math.max(-d,0)/r.rsi_period;}else{gain=(gain*(r.rsi_period-1)+Math.max(d,0))/r.rsi_period;loss=(loss*(r.rsi_period-1)+Math.max(-d,0))/r.rsi_period;}
  atr=i<=r.atr_period?atr+tr/r.atr_period:(atr*(r.atr_period-1)+tr)/r.atr_period;
 }
 const rsi=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
 const avgVol=mean(b.slice(-r.volume_period-1,-1).map(x=>x.v));if(!avgVol||!atr)return empty('Volume or volatility is insufficient to calculate a setup.');
 const rvol=last!.v/avgVol,level=Math.max(...b.slice(-r.breakout_period-1,-1).map(x=>x.h));
 const refDate=spy.at(-r.relative_strength_period-1)!.t.slice(0,10),ref=b.find(x=>x.t.slice(0,10)===refDate)!;
 const relative=((close/ref.c-1)-(s.c/spy.at(-r.relative_strength_period-1)!.c-1))*100,market=s.c>mean(spy.slice(-r.market_sma_period).map(x=>x.c));
 const labels=ruleLabels(r);
 const all:Record<CheckId,Omit<Check,'id'|'label'>>={
 trend:{pass:close>smaFast&&smaFast>smaSlow,value:`${close.toFixed(2)} / ${smaFast.toFixed(2)} / ${smaSlow.toFixed(2)}`},
 breakout:{pass:close>level,value:`Breakout level $${level.toFixed(2)}`},
 volume:{pass:rvol>=r.volume_min,value:`${rvol.toFixed(2)}× prior ${r.volume_period}-day average`},
 rsi:{pass:rsi>=r.rsi_min&&rsi<=r.rsi_max,value:rsi.toFixed(1)},
 extension:{pass:close<=ema+r.max_extension_atr*atr,value:`${((close-ema)/atr).toFixed(2)} ATR above EMA`},
 relative_strength:{pass:relative>r.relative_strength_min_pp,value:`${relative.toFixed(2)} percentage points`},
 market:{pass:market,value:market?'Market filter passes':'Market filter fails'}};
 const checks=r.enabled_checks.map(id=>({id,label:labels[id],...all[id]})),score=checks.filter(x=>x.pass).length;
 let status=score===checks.length?'Qualified':checks.filter(x=>x.id!=='breakout'&&x.id!=='volume').every(x=>x.pass)?'Watch':'Not qualified';
 const entry=Math.ceil((last!.h+r.entry_buffer_atr*atr)*100)/100,stop=Math.floor((entry-r.stop_atr*atr)*100)/100,target=Math.ceil((entry+r.target_atr*atr)*100)/100;
 const invalidPlan=status==='Qualified'&&stop<=0;if(invalidPlan)status='Not qualified';
 return {status,...(invalidPlan?{reason:'Configured stop distance produces a nonpositive stop price.'}:{}),close,rsi,rvol,atr,ema,smaFast,smaSlow,level,...(status==='Qualified'?{entry,stop,target}:{}),date:last!.t.slice(0,10),checks,score,history:b.slice(-63)};
}
