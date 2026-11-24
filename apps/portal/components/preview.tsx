import { Brand, Button, Notice, Icon, L } from '@hms/ui';
export function PreviewDisabled({ websiteUrl }: { websiteUrl: string }) {
  return (
    <main id="main" className="disabled-preview">
      <Brand href={websiteUrl} />
      <div className="surface disabled-card">
        <span className="icon-tile">
          <Icon name="lock" size={25} />
        </span>
        <h1>
          <L en={'Preview disabled'} />
        </h1>
        <p>
          <L
            en={
              'Live authentication, appointment booking and payments are not connected. This portal is intentionally unavailable outside explicitly enabled demo mode.'
            }
          />
        </p>
        <Notice>For an isolated preview, configure HMS_DEMO_MODE=true. Never enter real patient data.</Notice>
        <Button href={websiteUrl} variant="secondary">
          Return to website
        </Button>
      </div>
    </main>
  );
}
