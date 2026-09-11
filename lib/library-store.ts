import {compatibilityKey,type Snapshot,type ScanSummary,type SavedScan,type WatchItem} from './library';
const summaryColumns='id,created_at,market_date,universe_id,rules_name,compatibility_key,complete,processed,total,qualified';
export class LibraryStore{
 constructor(private db:D1Database,private userId:string){}
 async list(){return (await this.db.prepare(`SELECT ${summaryColumns} FROM scans WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 35`).bind(this.userId).all<ScanSummary>()).results;}
 async get(id:string):Promise<SavedScan|null>{
  const row=await this.db.prepare(`SELECT ${summaryColumns},payload FROM scans WHERE user_id=? AND id=?`).bind(this.userId,id).first<ScanSummary & {payload:string}>();
  if(!row)return null;const {payload,...summary}=row;return {...summary,snapshot:JSON.parse(payload)};
 }
 async save(id:string,snapshot:Snapshot){
  const created=new Date().toISOString(),key=await compatibilityKey(snapshot),payload=JSON.stringify(snapshot);
  if(new TextEncoder().encode(payload).length>1800000)throw new Error('Snapshot exceeds storage size.');
  // Atomic save + retention. The caller's UUID makes network retries idempotent.
  // A conflict can never overwrite another user's record.
  await this.db.batch([
   this.db.prepare('INSERT INTO scans (id,user_id,created_at,market_date,universe_id,rules_name,compatibility_key,complete,processed,total,qualified,payload) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,this.userId,created,snapshot.marketDate,snapshot.universeId,snapshot.rules.name,key,snapshot.complete?1:0,snapshot.processed,snapshot.stocks.length,Object.values(snapshot.signals).filter(s=>s.status==='Qualified').length,payload),
   this.db.prepare('DELETE FROM scans WHERE user_id=? AND complete=1 AND id NOT IN (SELECT id FROM scans WHERE user_id=? AND complete=1 ORDER BY created_at DESC,id DESC LIMIT 30)').bind(this.userId,this.userId),
   this.db.prepare('DELETE FROM scans WHERE user_id=? AND complete=0 AND id NOT IN (SELECT id FROM scans WHERE user_id=? AND complete=0 ORDER BY created_at DESC,id DESC LIMIT 5)').bind(this.userId,this.userId)
  ]);
  return this.get(id);
 }
 async remove(id:string){await this.db.prepare('DELETE FROM scans WHERE user_id=? AND id=?').bind(this.userId,id).run();}
 async watchlist():Promise<WatchItem[]>{
  const rows=await this.db.prepare(`SELECT w.symbol,w.note,w.added_at,w.updated_at,s.market_date,s.rules_name,json_extract(s.payload,'$.signals."'||w.symbol||'"') AS signal
   FROM watchlist w LEFT JOIN scans s ON s.id=(SELECT id FROM scans WHERE user_id=w.user_id AND complete=1 AND json_type(payload,'$.signals."'||w.symbol||'"') IS NOT NULL ORDER BY market_date DESC,created_at DESC,id DESC LIMIT 1)
   WHERE w.user_id=? ORDER BY w.added_at DESC,w.symbol`).bind(this.userId).all<Omit<WatchItem,'signal'> & {signal:string|null}>();
  return rows.results.map(r=>({...r,signal:r.signal?JSON.parse(r.signal):null}));
 }
 async watch(symbol:string,note?:string){
  const now=new Date().toISOString();
  // Omitted notes preserve existing text when the screener's star is clicked.
  await this.db.prepare(`INSERT INTO watchlist(user_id,symbol,note,added_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,symbol) DO UPDATE SET note=COALESCE(?,watchlist.note),updated_at=excluded.updated_at`).bind(this.userId,symbol,note??'',now,now,note??null).run();
 }
 async unwatch(symbol:string){await this.db.prepare('DELETE FROM watchlist WHERE user_id=? AND symbol=?').bind(this.userId,symbol).run();}
}
