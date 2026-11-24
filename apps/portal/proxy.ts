import { createServerClient } from '@supabase/ssr';
import { NextResponse,type NextRequest } from 'next/server';
export async function proxy(request:NextRequest){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(process.env.HMS_DEMO_MODE==='true'||!url||!key)return NextResponse.next();
 let response=NextResponse.next({request});
 const supabase=createServerClient(url,key,{cookies:{getAll:()=>request.cookies.getAll(),setAll:(values)=>{values.forEach(({name,value})=>request.cookies.set(name,value));response=NextResponse.next({request});values.forEach(({name,value,options})=>response.cookies.set(name,value,{...options,httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'}));}}});
 await supabase.auth.getUser();
 response.headers.set('Cache-Control','private, no-store');return response;
}
// API handlers manage their own cookie refresh; webhook requests never need session cookies.
export const config={matcher:['/doctor/:path*','/staff/:path*','/admin/:path*','/login','/book','/my-bookings','/manage-booking','/patient','/forgot-password','/reset-password']};
