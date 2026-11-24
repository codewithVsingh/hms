import { MyBookings } from '../../features/live/booking';
import { demoEnabled, websiteUrl } from '../../lib/config';
import { PreviewDisabled } from '../../components/preview';
export const dynamic = 'force-dynamic';
export default function Page() {
  return demoEnabled ? <PreviewDisabled websiteUrl={websiteUrl} /> : <MyBookings websiteUrl={websiteUrl} />;
}
