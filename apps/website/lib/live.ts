import 'server-only';
export const publicLive=process.env.HMS_PUBLIC_LIVE==='true';
export const hospitalName=process.env.NEXT_PUBLIC_HOSPITAL_NAME||'Hospital';
export const hospitalAddress=process.env.NEXT_PUBLIC_HOSPITAL_ADDRESS||'';
export const hospitalPhone=process.env.NEXT_PUBLIC_HOSPITAL_PHONE||'';
export const hospitalEmail=process.env.NEXT_PUBLIC_HOSPITAL_EMAIL||'';
export const hospitalHours=process.env.NEXT_PUBLIC_HOSPITAL_HOURS||'';
export const hospitalDescription=process.env.NEXT_PUBLIC_HOSPITAL_DESCRIPTION||'Find hospital information and book a visit.';
export const indexLive=publicLive&&process.env.HMS_ALLOW_INDEXING==='true'&&!!process.env.NEXT_PUBLIC_HOSPITAL_NAME&&!!hospitalAddress&&!!hospitalPhone;
export type PublicEntry={kind:string;slug:string;title:string;summary:string|null;body:string;seoTitle:string|null;seoDescription:string|null;updatedAt:string};
export type PublicDoctor={id:string;slug:string;name:string;specialty:string;feePaise:number;bio?:string|null;registrationNumber?:string|null};
export type Catalog={branchId:string;bookingEnabled:boolean;onlineEnabled:boolean;doctors:PublicDoctor[]};
async function getRPC<T>(name:string,params:Record<string,string>):Promise<T>{const base=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;if(!base||!key)throw new Error('Public website configuration required');const res=await fetch(`${base.replace(/\/$/,'')}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(key.startsWith('eyJ')?{Authorization:`Bearer ${key}`}:{})},body:JSON.stringify(params),cache:'no-store'});if(!res.ok)throw new Error('Public hospital content unavailable');return await res.json() as T;}
function scope(){const slug=process.env.HMS_ORGANIZATION_SLUG,branch=process.env.HMS_BRANCH_CODE;if(!slug||!branch)throw new Error('Public website configuration required');return {p_slug:slug,p_branch:branch};}
export const publicCatalog=()=>getRPC<Catalog|null>('hms_catalog',scope());
export const publicContent=()=>getRPC<PublicEntry[]>('hms_public_content',{p_slug:scope().p_slug});
export const contentPath=(c:PublicEntry)=>c.kind==='page'?`/pages/${c.slug}`:c.kind==='service'?`/services/${c.slug}`:c.kind==='article'?`/health-library/${c.slug}`:c.kind==='faq'?`/faq/${c.slug}`:`/campaigns/${c.slug}`;
