import {NextRequest,NextResponse} from 'next/server';
import {env,sessionClient} from '../../../lib/server/supabase';
import {demoEnabled} from '../../../lib/config';
export async function GET(req:NextRequest){const base=env('NEXT_PUBLIC_PORTAL_URL'),hash=req.nextUrl.searchParams.get('token_hash'),type=req.nextUrl.searchParams.get('type');if(!demoEnabled&&hash&&hash.length<500&&(type==='invite'||type==='recovery')){const c=await sessionClient();const {error}=await c.auth.verifyOtp({token_hash:hash,type});if(!error)return NextResponse.redirect(new URL('/reset-password',base));}return NextResponse.redirect(new URL('/forgot-password?failed=1',base));}
