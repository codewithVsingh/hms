import {createHmac,timingSafeEqual,createHash} from 'node:crypto';
export function signatureValid(message:string,signature:string,secret:string){if(!/^[a-f0-9]{64}$/i.test(signature))return false;const expected=createHmac('sha256',secret).update(message).digest();return timingSafeEqual(expected,Buffer.from(signature,'hex'));}
export function digest(raw:string){return createHash('sha256').update(raw).digest('hex');}
export function allowedPaymentKey(key:string,mode:string,enableReal:boolean){return mode==='test'&&key.startsWith('rzp_test_')||mode==='live'&&enableReal&&key.startsWith('rzp_live_');}
