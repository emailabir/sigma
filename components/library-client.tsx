'use client';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import type {SavedScan,ScanSummary,WatchItem} from '@/lib/library';
export async function libraryRequest<T>(path='/api/library',body?:unknown):Promise<T>{
 const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(30000)});
 const data=await response.json().catch(()=>null) as (T & {error?:string})|null;
 if(!response.ok||!data)throw new Error(data?.error??(response.status===401?'Your session expired. Refresh to sign in.':'Your library is unavailable. Please retry.'));
 return data;
}
export function useLibrary(){
 const client=useQueryClient();
 const query=useQuery({queryKey:['library'],queryFn:()=>libraryRequest<{scans:ScanSummary[];watchlist:WatchItem[];account:string}>(),retry:false});
 const mutation=useMutation({mutationFn:(body:unknown)=>libraryRequest('/api/library',body),onSuccess:()=>client.invalidateQueries({queryKey:['library']})});
 return {...query,scans:query.data?.scans??[],watchlist:query.data?.watchlist??[],mutate:mutation.mutateAsync,mutating:mutation.isPending,mutationError:mutation.error,refresh:()=>client.invalidateQueries({queryKey:['library']})};
}
export type Library=ReturnType<typeof useLibrary>;
export function useSavedScan(id:string|null){return useQuery({queryKey:['scan',id],queryFn:()=>libraryRequest<{scan:SavedScan}>('/api/library?id='+encodeURIComponent(id!)),enabled:!!id,retry:false});}
