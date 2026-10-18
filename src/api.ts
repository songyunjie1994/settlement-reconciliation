const origin='https://mabxdkjqilulkrmqrrgo.supabase.co';
// Publishable client key: database authorization is enforced by the RPC and RLS.
const publicKey='sb_publishable_lfHpd1y1gCaQIDXfRkD_8w_O1bPMWGx';
const storageKey='anbito_settlement_auth_v1';
let session:any;try{session=JSON.parse(localStorage.getItem(storageKey)||'null')}catch{session=null}
function save(value:any){session=value;if(value)localStorage.setItem(storageKey,JSON.stringify(value));else localStorage.removeItem(storageKey)}
export function signedIn(){return !!session?.refresh_token}
async function auth(path:string,body:any){const r=await fetch(origin+'/auth/v1/'+path,{method:'POST',headers:{apikey:publicKey,'Content-Type':'application/json'},body:JSON.stringify(body)}),b=await r.json();if(!r.ok)throw Error(b.error_description||b.msg||'登录失败，请检查账号和密码');b.expires_at=Math.floor(Date.now()/1000)+b.expires_in;save(b);return b}
export async function login(email:string,password:string){await auth('token?grant_type=password',{email,password})}
export async function logout(){const token=session?.access_token;save(null);if(token)await fetch(origin+'/auth/v1/logout',{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+token}}).catch(()=>{})}
let refreshing:Promise<any>|null=null;
export async function data(params:URLSearchParams){if(!session?.refresh_token)throw Error('请先登录');if(session.expires_at<Date.now()/1000+60){try{refreshing??=auth('token?grant_type=refresh_token',{refresh_token:session.refresh_token});await refreshing}catch{save(null);location.reload();throw Error('登录已过期')}finally{refreshing=null}}
 const r=await fetch(origin+'/rest/v1/rpc/settlement_dashboard',{method:'POST',headers:{apikey:publicKey,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({p_platform:params.get('platform')||'',p_shop:params.get('shop')||'',p_month:params.get('month')||'',p_open:params.get('open')==='1',p_q:params.get('q')||'',p_page:Number(params.get('page'))||1})}),b=await r.json();if(!r.ok)throw Error(r.status===401?'请重新登录':r.status===403?'当前账号没有结算系统权限':b.message||'读取失败');return b}
