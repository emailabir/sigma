import {HttpError} from './access';
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function privateHeaders(){return new Headers({'Cache-Control':'private, no-store','Referrer-Policy':'same-origin','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'});}
export function redirect(location:string,cookies:string[]=[]){const headers=privateHeaders();headers.set('Referrer-Policy','no-referrer');headers.set('Location',location);for(const value of cookies)headers.append('Set-Cookie',value);return new Response(null,{status:303,headers});}
export function requirePost(request:Request){
 if(request.method!=='POST')throw new HttpError(405,'Use the sign-in or sign-out button.');
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-origin request rejected.');
}
