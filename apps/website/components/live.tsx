import { Button, Icon, SectionHeading, Notice, L } from '@hms/ui';
import {
  publicCatalog,
  publicContent,
  hospitalName,
  hospitalAddress,
  hospitalPhone,
  hospitalEmail,
  hospitalHours,
  hospitalDescription,
  contentPath,
  type PublicEntry,
  type PublicDoctor,
} from '../lib/live';
import { portalUrl } from '../lib/config';
import { notFound } from 'next/navigation';
export function PublicContact() {
  return (
    <div className="contact-grid">
      <div className="stack">
        <article className="surface info-card">
          <span className="icon-tile">
            <Icon name="map" />
          </span>
          <h3>
            <L en="Hospital address" />
          </h3>
          <p>{hospitalAddress || 'Contact the hospital for directions.'}</p>
          {hospitalAddress && (
            <a
              className="learn-link"
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hospitalName + ' ' + hospitalAddress)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <L en="Get directions" />
              <Icon name="arrow" size={15} />
            </a>
          )}
        </article>
        <article className="surface info-card">
          <span className="icon-tile">
            <Icon name="phone" />
          </span>
          <h3>
            <L en="Reception & opening hours" />
          </h3>
          {hospitalPhone && (
            <a className="learn-link" href={`tel:${hospitalPhone.replace(/[^+\d]/g, '')}`}>
              {hospitalPhone}
            </a>
          )}
          {hospitalEmail && (
            <a className="learn-link" href={`mailto:${hospitalEmail}`}>
              {hospitalEmail}
            </a>
          )}
          <p>{hospitalHours || 'Contact reception to confirm timings.'}</p>
        </article>
      </div>
      <article className="surface detail-card">
        <h2>
          <L en="Plan your visit" />
        </h2>
        <p>
          <L en="Use online appointment booking for routine outpatient visits. For an emergency, contact local emergency services." />
        </p>
        <Button href={`${portalUrl}/book`}>
          <L en="Check availability" />
        </Button>
        <Button href={`${portalUrl}/my-bookings`} variant="secondary">
          <L en="My appointments" />
        </Button>
      </article>
    </div>
  );
}
function DoctorCards({ doctors }: { doctors: PublicDoctor[] }) {
  return doctors.length ? (
    <div className="info-grid">
      {doctors.map((d) => (
        <article className="surface info-card" key={d.id}>
          <span className="icon-tile">
            <Icon name="stethoscope" size={26} />
          </span>
          <h3>{d.name}</h3>
          <p>{d.specialty}</p>
          <p>
            Consultation ·{' '}
            {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(d.feePaise / 100)}
          </p>
          <Button href={`/doctors/${d.slug}`} variant="secondary">
            <L en="View profile" />
          </Button>
          <Button href={`${portalUrl}/book?doctor=${encodeURIComponent(d.slug)}`}>
            <L en="Book appointment" />
          </Button>
        </article>
      ))}
    </div>
  ) : (
    <Notice>Doctor profiles will be available after verification and publication by the hospital.</Notice>
  );
}
function ContentCards({ entries }: { entries: PublicEntry[] }) {
  return entries.length ? (
    <div className="info-grid">
      {entries.map((c) => (
        <article className="surface info-card" key={`${c.kind}/${c.slug}`}>
          <span className="icon-tile">
            <Icon name={c.kind === 'service' ? 'heart' : 'book'} />
          </span>
          <h3>{c.title}</h3>
          <p>{c.summary || ''}</p>
          <a className="learn-link" href={contentPath(c)}>
            <L en="Read more" />
            <Icon name="arrow" size={15} />
          </a>
        </article>
      ))}
    </div>
  ) : (
    <Notice>More information will be available after publication.</Notice>
  );
}
function PageHero({ title, description }: { title: string; description?: string | null }) {
  return (
    <section className="inner-hero">
      <div className="site-container animate-in">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">
            <L en="Home" />
          </a>
          <Icon name="chevron" size={13} />
          <span>{title}</span>
        </nav>
        <span className="eyebrow">{hospitalName}</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    </section>
  );
}
export async function LiveHome() {
  const [catalog, entries] = await Promise.all([publicCatalog(), publicContent()]);
  const about = entries.find((c) => c.kind === 'page' && c.slug === 'about');
  const structured = {
    '@context': 'https://schema.org',
    '@type': 'Hospital',
    name: hospitalName,
    description: hospitalDescription,
    ...(hospitalAddress ? { address: hospitalAddress } : {}),
    ...(hospitalPhone ? { telephone: hospitalPhone } : {}),
    ...(hospitalEmail ? { email: hospitalEmail } : {}),
    ...(process.env.NEXT_PUBLIC_WEBSITE_URL ? { url: process.env.NEXT_PUBLIC_WEBSITE_URL } : {}),
  };
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structured).replace(/</g, '\\u003c') }}
      />
      <section className="inner-hero live-public-hero">
        <div className="site-container live-hero-grid">
          <div className="animate-in">
            <span className="eyebrow">
              <L en="Patient services" />
            </span>
            <h1>{hospitalName}</h1>
            <p>{hospitalDescription}</p>
            <div className="live-public-actions">
              <Button href={`${portalUrl}/book`} icon="calendar">
                <L en="Book appointment" />
              </Button>
              <Button href="/doctors" variant="secondary">
                <L en="Meet our doctors" />
              </Button>
              <Button href={`${portalUrl}/manage-booking`} variant="secondary">
                <L en="Manage booking" />
              </Button>
            </div>
          </div>
          <div className="live-public-art animate-in delay-1" aria-hidden="true">
            <div className="live-public-orb">
              <Icon name="stethoscope" size={76} />
            </div>
            <div className="live-public-art-card">
              <span className="icon-tile">
                <Icon name="calendar" />
              </span>
              <strong>
                <L en="Schedule a visit" />
              </strong>
            </div>
            <div className="live-public-art-card secondary">
              <span className="icon-tile">
                <Icon name="heart" />
              </span>
              <strong>
                <L en="Patient care" />
              </strong>
            </div>
          </div>
        </div>
      </section>
      <section className="site-container site-section">
        <SectionHeading
          eyebrow="Our team"
          title="Find your doctor"
          action={
            <Button href="/doctors" variant="secondary">
              <L en="All doctors" />
            </Button>
          }
        />
        <DoctorCards doctors={catalog?.doctors || []} />
      </section>
      <section className="section-tinted">
        <div className="site-container site-section">
          <SectionHeading eyebrow="Specialties" title="Hospital services" />
          <ContentCards entries={entries.filter((c) => c.kind === 'service')} />
        </div>
      </section>
      {about && (
        <section className="site-container site-section">
          <SectionHeading title={about.title} description={about.summary || undefined} />
          <Button href="/about" variant="secondary">
            About the hospital
          </Button>
        </section>
      )}
      <section className="site-container site-section">
        <SectionHeading eyebrow="Patient information" title="Health library" />
        <ContentCards entries={entries.filter((c) => c.kind === 'article').slice(0, 3)} />
      </section>
      <section className="site-container site-section">
        <SectionHeading title="Contact & directions" />
        <PublicContact />
      </section>
    </>
  );
}
export async function LivePage({ parts }: { parts: string[] }) {
  const [section, slug] = parts;
  if (parts.length > 2) notFound();
  const [catalog, entries] = await Promise.all([publicCatalog(), publicContent()]);
  if (section === 'contact' && !slug)
    return (
      <>
        <PageHero title="Contact & directions" />
        <div className="site-container site-section">
          <PublicContact />
        </div>
      </>
    );
  if (section === 'doctors') {
    if (!slug)
      return (
        <>
          <PageHero title="Our doctors" />
          <div className="site-container site-section">
            <DoctorCards doctors={catalog?.doctors || []} />
          </div>
        </>
      );
    const d = catalog?.doctors.find((x) => x.slug === slug);
    if (!d) notFound();
    return (
      <>
        <PageHero title={d.name} description={d.specialty} />
        <div className="site-container site-section detail-grid">
          <article className="surface detail-card">
            <h2>
              <L en="Professional profile" />
            </h2>
            <p>{d.specialty}</p>
            {d.registrationNumber && <p>Medical registration: {d.registrationNumber}</p>}
            {d.bio && <p>{d.bio}</p>}
          </article>
          <aside className="surface detail-card">
            <h2>
              <L en="Consultation" />
            </h2>
            <p>
              {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
                d.feePaise / 100,
              )}
            </p>
            <Button href={`${portalUrl}/book?doctor=${encodeURIComponent(d.slug)}`}>
              <L en="Book appointment" />
            </Button>
          </aside>
        </div>
      </>
    );
  }
  const kind: Record<string, string> = {
    services: 'service',
    'health-library': 'article',
    faq: 'faq',
    pages: 'page',
    campaigns: 'landing',
  };
  if (kind[section] && !slug)
    return (
      <>
        <PageHero
          title={
            section === 'health-library'
              ? 'Health library'
              : section === 'faq'
                ? 'Frequently asked questions'
                : section === 'services'
                  ? 'Specialties & services'
                  : 'Patient information'
          }
        />
        <div className="site-container site-section">
          <ContentCards entries={entries.filter((c) => c.kind === kind[section])} />
        </div>
      </>
    );
  const entry = entries.find((c) => c.kind === (kind[section] || 'page') && c.slug === (slug || section));
  if (!entry) notFound();
  return (
    <>
      <PageHero title={entry.title} description={entry.summary} />
      <div className="site-container site-section detail-grid">
        <article className="surface detail-card public-copy">
          {entry.body
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((p, i) => (
              <p key={i}>{p}</p>
            ))}
        </article>
        <aside className="surface detail-card">
          <h2>
            <L en="Need an appointment?" />
          </h2>
          <p>
            <L en="Check availability or contact the hospital." />
          </p>
          <Button href={`${portalUrl}/book`}>
            <L en="Book a visit" />
          </Button>
          <Button href="/contact" variant="secondary">
            <L en="Contact reception" />
          </Button>
        </aside>
      </div>
    </>
  );
}
