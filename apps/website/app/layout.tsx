import { publicLive,indexLive,hospitalName,hospitalDescription } from '../lib/live';
import { WhatsAppContact } from '../components/whatsapp';
import type { Metadata } from 'next';
import '@hms/ui/styles.css';
import './website.css';
import { WebsiteHeader, WebsiteFooter } from '../components/chrome';
import { siteUrl } from '../lib/config';
export const metadata:Metadata={metadataBase:new URL(siteUrl),title:{default:publicLive?hospitalName:'Aarogya Care | Hospital website preview',template:publicLive?`%s | ${hospitalName}`:'%s | Aarogya Care'},description:publicLive?hospitalDescription:'A fictional hospital website and appointment booking experience for UI review.',robots:{index:indexLive,follow:indexLive},openGraph:{siteName:publicLive?hospitalName:'Aarogya Care',type:'website',locale:'en_IN',images:publicLive?[]:['/og.svg']}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en-IN"><body><a className="skip-link" href="#main">Skip to content</a><WebsiteHeader/><main id="main">{children}</main><WebsiteFooter/><WhatsAppContact/></body></html>}
