import { L } from '@hms/ui';
import { CallbackForm } from '../../components/callback';
import { publicLive } from '../../lib/live';
import { portalUrl } from '../../lib/config';
export const metadata = {
  title: 'Request a callback',
  description: 'Contact hospital reception for booking and general inquiries.',
};
export default function Page() {
  return (
    <section className="site-container section callback-page">
      <div>
        <span className="eyebrow">
          <L en={'We are here to help'} />
        </span>
        <h1>
          <L en={'Request a callback'} />
        </h1>
        <p>
          <L
            en={
              'Leave your contact information for a non-urgent inquiry. The reception team can help you with appointments, opening hours and billing.'
            }
          />
        </p>
      </div>
      <CallbackForm demo={!publicLive} portalUrl={portalUrl} />
    </section>
  );
}
