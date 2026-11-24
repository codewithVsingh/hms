import { Button, Empty } from '@hms/ui';
import { demoEnabled } from '../lib/config';
export default function NotFound() {
  return (
    <main id="main" className="disabled-preview">
      <Empty
        title="Workspace not found"
        description={
          demoEnabled
            ? 'This section is not available for the selected demo role.'
            : 'This page does not exist or is not available for your account.'
        }
      />
      <Button href="/login">{demoEnabled ? 'Choose demo role' : 'Back to sign in'}</Button>
    </main>
  );
}
