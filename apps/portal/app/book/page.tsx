import { LiveBooking } from '../../features/live/booking';
import { Booking } from '../../features/booking';
import { demoEnabled, websiteUrl } from '../../lib/config';
import { PreviewDisabled } from '../../components/preview';
export default async function Book({
  searchParams,
}: {
  searchParams: Promise<{ doctor?: string | string[] }>;
}) {
  const q = await searchParams;
  if (!demoEnabled) {
    const noticeVersion = process.env.HMS_NOTICE_VERSION,
      noticeUrl = process.env.HMS_NOTICE_URL;
    if (!noticeVersion || !noticeUrl || !process.env.NEXT_PUBLIC_SUPABASE_URL)
      return <PreviewDisabled websiteUrl={websiteUrl} />;
    return (
      <LiveBooking
        websiteUrl={websiteUrl}
        initialDoctor={typeof q.doctor === 'string' ? q.doctor : undefined}
        noticeVersion={noticeVersion}
        noticeUrl={noticeUrl}
      />
    );
  }
  return (
    <Booking websiteUrl={websiteUrl} initialDoctor={typeof q.doctor === 'string' ? q.doctor : undefined} />
  );
}
