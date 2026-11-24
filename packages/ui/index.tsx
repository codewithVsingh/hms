import * as React from 'react';
import { L, Localized, LanguageLink } from './locale';
export { L, Localized, LanguageSwitch, LanguageLink, useLanguage, translate, changeLanguage } from './locale';
const paths: Record<string, React.ReactNode> = {
  cross: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  logo: (
    <>
      <path d="M12 3v18M3 12h18" strokeWidth="4" strokeLinecap="round" />
      <path d="M5 5l14 14M19 5L5 19" strokeWidth="1.4" opacity=".45" />
    </>
  ),
  arrow: (
    <>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  down: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18M8 15h2m4 0h2" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  phone: (
    <path d="M7 3H4a1 1 0 0 0-1 1 17 17 0 0 0 17 17 1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5z" />
  ),
  map: (
    <>
      <path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  heart: <path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1C-1 10 7 17 12 21c5-4 13-11 8-16z" />,
  pulse: <path d="M2 12h5l3-7 4 14 3-7h5" />,
  shield: (
    <>
      <path d="M12 3 3 7v6c0 4 5 7 9 9 4-2 9-5 9-9V7z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  stethoscope: (
    <>
      <path d="M6 3H4v7a5 5 0 0 0 10 0V3h-2M9 15v2a5 5 0 0 0 10 0v-3" />
      <circle cx="19" cy="12" r="2" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-3-5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  home: (
    <>
      <path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  file: (
    <>
      <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h8" />
    </>
  ),
  pill: (
    <>
      <path d="M4 20a5 5 0 0 1 0-7l9-9a5 5 0 0 1 7 7l-9 9a5 5 0 0 1-7 0zM8 9l7 7" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="2" />
      <path d="M21 10h-6a3 3 0 0 0 0 6h6M16 13h1" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M6 15h5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M10 3h4l1 3 3 1 3 3v4l-3 1-1 3-3 3h-4l-1-3-3-1-3-3v-4l3-1 1-3z" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  bell: (
    <>
      <path d="M5 17h14l-2-4V8a5 5 0 0 0-10 0v5zM10 21h4" />
    </>
  ),
  logout: (
    <>
      <path d="M11 4H4v16h7M10 12h11m-5-5 5 5-5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 4v6h-6M20 10a8 8 0 1 0-1 7" />
    </>
  ),
  edit: (
    <>
      <path d="m14 5 5 5M4 20l5-1L21 7l-5-5L4 14z" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="6" width="16" height="15" rx="1" />
      <path d="M9 6V3h6v3M8 10h2m4 0h2M8 14h2m4 0h2M10 21v-4h4v4" />
    </>
  ),
  book: (
    <>
      <path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-4-1-7-1-10 1v15" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  alert: (
    <>
      <path d="m12 3 10 18H2zM12 9v5m0 3v.1" />
    </>
  ),
  dots: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
};
export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.cross}
    </svg>
  );
}
export function Brand({
  href = '/',
  sub = 'Care & wellness',
  name,
}: {
  href?: string;
  sub?: string;
  name?: string;
}) {
  return (
    <a className="brand" href={href} aria-label={`${name || 'Aarogya Care'} home`}>
      <span className="brand-mark">
        <Icon name="logo" size={26} />
      </span>
      <span>
        <strong>
          {name || (
            <>
              aarogya<span className="brand-accent">care.</span>
            </>
          )}
        </strong>
        <small>
          <L en={sub} />
        </small>
      </span>
    </a>
  );
}
export function Button({
  children,
  href,
  variant = 'primary',
  icon,
  onClick,
  type = 'button',
  disabled = false,
  className = '',
}: {
  children: React.ReactNode;
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: string;
  onClick?: () => void;
  type?: 'button' | 'submit';
  disabled?: boolean;
  className?: string;
}) {
  const c = `btn btn-${variant} ${className}`;
  return href ? (
    <LanguageLink className={c} href={href}>
      {icon && <Icon name={icon} size={18} />} <Localized>{children}</Localized>
    </LanguageLink>
  ) : (
    <button className={c} onClick={onClick} type={type} disabled={disabled}>
      {icon && <Icon name={icon} size={18} />} <Localized>{children}</Localized>
    </button>
  );
}
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'green' | 'amber' | 'blue' | 'red' | 'teal';
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <Localized>{children}</Localized>
    </span>
  );
}
export function Empty({
  title,
  description,
  icon = 'file',
}: {
  title: string;
  description: string;
  icon?: string;
}) {
  return (
    <div className="empty">
      <span className="icon-tile">
        <Icon name={icon} size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export function Notice({
  children,
  tone = 'info',
}: {
  children: React.ReactNode;
  tone?: 'info' | 'success' | 'warning';
}) {
  return (
    <div className={`notice notice-${tone}`} role="status">
      <Icon name={tone === 'success' ? 'check' : tone === 'warning' ? 'alert' : 'info'} size={19} />
      <div>
        <Localized>{children}</Localized>
      </div>
    </div>
  );
}
export function Avatar({
  initials,
  color = 'mint',
  size = 'md',
}: {
  initials: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span className={`avatar avatar-${color} avatar-${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>
        <L en={label} />
      </span>
      {children}
      {hint && (
        <small>
          <L en={hint} />
        </small>
      )}
    </label>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && (
          <span className="eyebrow">
            <L en={eyebrow} />
          </span>
        )}
        <h2>
          <L en={title} />
        </h2>
        {description && (
          <p>
            <L en={description} />
          </p>
        )}
      </div>
      {action}
    </div>
  );
}
