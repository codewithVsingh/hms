import { LiveLogin } from '../../features/live/login';
import { Brand, Button, Icon, Notice } from '@hms/ui';
import { demoEnabled, websiteUrl } from '../../lib/config';
const roles = [
  {
    role: 'doctor',
    icon: 'stethoscope',
    title: 'Doctor',
    desc: 'Appointments, consultations and prescriptions',
  },
  {
    role: 'staff',
    icon: 'users',
    title: 'Reception & staff',
    desc: 'Patient registration, scheduling and billing',
  },
  {
    role: 'admin',
    icon: 'shield',
    title: 'Super admin',
    desc: 'Hospital operations, permissions and content',
  },
];
export default function Login() {
  if (!demoEnabled) return <LiveLogin websiteUrl={websiteUrl} />;
  return (
    <main id="main" className="login-shell">
      <div className="login-art">
        <Brand href={websiteUrl} sub="Hospital management" />
        <div className="login-message animate-in">
          <span className="eyebrow">One connected workspace</span>
          <h1>Better care starts with a better workflow.</h1>
          <p>
            Manage appointments, patient care and hospital operations in one thoughtfully designed platform.
          </p>
          <div className="login-illustration" aria-hidden="true">
            <div className="login-grid-art">
              <div className="glass-tile">
                <Icon name="calendar" size={29} />
                <span>Appointments</span>
                <div className="fake-line" />
                <div className="fake-line short" />
              </div>
              <div className="glass-tile">
                <Icon name="users" size={29} />
                <span>Care team</span>
                <div className="fake-line" />
                <div className="fake-line short" />
              </div>
              <div className="glass-tile wide">
                <div className="flex">
                  <Icon name="pulse" size={26} />
                  <span>Connected care</span>
                </div>
                <svg viewBox="0 0 250 62" width="100%">
                  <path
                    d="M0 37H52L65 20 82 48 103 10 125 38h35l12-16 13 18h65"
                    fill="none"
                    stroke="#a6e5cc"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
        <small>UI preview • No live authentication or medical data</small>
      </div>
      <div className="login-form-wrap">
        <div className="login-form animate-in delay-1">
          <a className="back-link" href={websiteUrl}>
            <Icon name="arrow" size={16} /> Back to website
          </a>
          <div className="mobile-login-brand">
            <Brand href={websiteUrl} />
          </div>
          <span className="eyebrow">HMS workspace</span>
          <h2>Welcome back.</h2>
          <p>
            Select a demo role to explore its dashboard. No credentials are required for this isolated
            preview.
          </p>
          <div className="role-options">
            {roles.map((r) => (
              <a className="role-card" href={`/${r.role}`} key={r.role}>
                <span className="icon-tile">
                  <Icon name={r.icon} size={24} />
                </span>
                <div className="grow">
                  <strong>{r.title}</strong>
                  <p>{r.desc}</p>
                </div>
                <Icon name="chevron" size={19} />
              </a>
            ))}
          </div>
          <Notice tone="warning">
            Demo role selection is not authentication. Real login, MFA and RBAC enforcement will be added with
            Supabase.
          </Notice>
          <div className="login-foot">
            <span>Looking to book a visit?</span>
            <a href="/book">
              Patient booking <Icon name="arrow" size={15} />
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
