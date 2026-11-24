import {NextRequest,NextResponse} from 'next/server';
import {timingSafeEqual} from 'node:crypto';
import {processPolicyRefunds} from '../../../../lib/server/policy-refunds';
import {runMaintenance,reconcileKnownPayments} from '../../../../lib/server/notifications';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(req:NextRequest){const secret=process.env.CRON_SECRET||'',provided=req.headers.get('authorization')||'';const expected='Bearer '+secret;if(process.env.HMS_DEMO_MODE!=='false'||secret.length<32||Buffer.byteLength(provided)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(provided),Buffer.from(expected)))return NextResponse.json({error:'Unauthorized'},{status:401});try{return NextResponse.json({maintenance:await runMaintenance(),reconciliation:await reconcileKnownPayments(),policyRefunds:await processPolicyRefunds()},{headers:{'Cache-Control':'no-store'}})}catch{return NextResponse.json({error:'Maintenance failed'},{status:503})}}
