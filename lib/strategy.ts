export type Bar={t:string;o:number;h:number;l:number;c:number;v:number};
export type Check={label:string;pass:boolean;value:string};
export type Signal={status:string;reason?:string;close?:number;rsi?:number;rvol?:number;atr?:number;ema?:number;sma50?:number;sma200?:number;level?:number;entry?:number;stop?:number;target?:number;date?:string;checks:Check[];score:number;history:Bar[]};
const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
export function cleanBars(bars:Bar[]){
 const seen=new Set<string>();
 return [...bars].sort((a,b)=>a.t.localeCompare(b.t)).filter(b=>{const day=b.t.slice(0,10);if(seen.has(day)||!Number.isFinite(Date.parse(b.t))||![b.o,b.h,b.l,b.c,b.v].every(Number.isFinite)||Math.min(b.o,b.h,b.l,b.c)<=0||b.v<0||b.h<Math.max(b.o,b.c,b.l)||b.l>Math.min(b.o,b.c,b.h))return false;seen.add(day);return true});
}
export function analyze(input:Bar[],benchmark:Bar[],now=Date.now()):Signal{
 const b=cleanBars(input),spy=cleanBars(benchmark),last=b.at(-1);
 const empty=(reason:string,status='Insufficient data'):Signal=>({status,reason,close:last?.c,date:last?.t.slice(0,10),checks:[],score:0,history:b.slice(-63)});
 if(b.length<201||spy.length<201)return empty('At least 201 valid daily bars for this stock and SPY are required.');
 const s=spy.at(-1)!;if(last!.t.slice(0,10)!==s.t.slice(0,10))return empty('Stock and SPY dates do not match.','Stale data');
 const age=(now-Date.parse(last!.t))/86400000;
 if(age>4||age<0)return empty('Latest completed daily bar is more than four days old or has an invalid future date.','Stale data');
 const days=new Set(b.map(x=>x.t.slice(0,10)));
 if(spy.slice(-201).some(x=>!days.has(x.t.slice(0,10))))return empty('Missing daily bars within the latest 201 benchmark sessions.');
 const c=b.map(x=>x.c),close=c.at(-1)!,sma50=mean(c.slice(-50)),sma200=mean(c.slice(-200));
 let ema=mean(c.slice(0,20));for(let i=20;i<c.length;i++)ema=c[i]*2/21+ema*19/21;
 let gain=0,loss=0,atr=0;
 for(let i=1;i<=14;i++){const d=c[i]-c[i-1];gain+=Math.max(d,0)/14;loss+=Math.max(-d,0)/14;atr+=Math.max(b[i].h-b[i].l,Math.abs(b[i].h-c[i-1]),Math.abs(b[i].l-c[i-1]))/14;}
 for(let i=15;i<c.length;i++){const d=c[i]-c[i-1];gain=(gain*13+Math.max(d,0))/14;loss=(loss*13+Math.max(-d,0))/14;atr=(atr*13+Math.max(b[i].h-b[i].l,Math.abs(b[i].h-c[i-1]),Math.abs(b[i].l-c[i-1])))/14;}
 const rsi=gain===0&&loss===0?50:loss===0?100:100-100/(1+gain/loss);
 const avgVol=mean(b.slice(-21,-1).map(x=>x.v));if(!avgVol||!atr)return empty('Volume or volatility is insufficient to calculate a setup.');
 const rvol=last!.v/avgVol,level=Math.max(...b.slice(-21,-1).map(x=>x.h));
 const refDate=spy.at(-64)!.t.slice(0,10),ref=b.find(x=>x.t.slice(0,10)===refDate)!;
 const relative=(close/ref.c-1)-(s.c/spy.at(-64)!.c-1),market=s.c>mean(spy.slice(-200).map(x=>x.c));
 const checks:Check[]=[
 {label:'Price > SMA 50 > SMA 200',pass:close>sma50&&sma50>sma200,value:`${close.toFixed(2)} / ${sma50.toFixed(2)} / ${sma200.toFixed(2)}`},
 {label:'Close above prior 20-day high',pass:close>level,value:`Breakout level $${level.toFixed(2)}`},
 {label:'Relative volume ≥ 1.5×',pass:rvol>=1.5,value:`${rvol.toFixed(2)}× prior 20-day average`},
 {label:'RSI (14) between 50 and 70',pass:rsi>=50&&rsi<=70,value:rsi.toFixed(1)},
 {label:'Close ≤ EMA 20 + 1 ATR',pass:close<=ema+atr,value:`${((close-ema)/atr).toFixed(2)} ATR above EMA`},
 {label:'63-day return stronger than SPY',pass:relative>0,value:`${(relative*100).toFixed(2)} percentage points`},
 {label:'SPY above SMA 200',pass:market,value:market?'Market filter passes':'Market filter fails'}];
 const score=checks.filter(x=>x.pass).length;
 const status=score===7?'Qualified':checks[0].pass&&checks[3].pass&&checks[4].pass&&checks[5].pass&&market?'Watch':'Not qualified';
 const entry=Math.ceil((last!.h+.1*atr)*100)/100,stop=Math.floor((entry-2*atr)*100)/100,target=Math.ceil((entry+4*atr)*100)/100;
 return {status,close,rsi,rvol,atr,ema,sma50,sma200,level,...(status==='Qualified'&&stop>0?{entry,stop,target}:{}),date:last!.t.slice(0,10),checks,score,history:b.slice(-63)};
}
