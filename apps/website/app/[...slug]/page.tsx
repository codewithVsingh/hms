import { publicLive, indexLive, hospitalName, publicCatalog, publicContent } from '../../lib/live';
import { LivePage } from '../../components/live';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { doctors, services, articles } from '@hms/types';
import { Button, Icon, Notice, SectionHeading, Badge, L } from '@hms/ui';
import { DoctorsGrid, ServicesGrid, ArticlesGrid, DoctorPortrait, FAQ } from '../../components/catalog';
import { portalUrl } from '../../lib/config';
const policies: Record<string, { title: string; sections: [string, string][] }> = {
  privacy: {
    title: 'Privacy notice',
    sections: [
      [
        'Preview only',
        'This software preview uses fictional sample data. Do not enter medical records, real patient identifiers or payment information.',
      ],
      [
        'Future data collection',
        'The hospital must publish its approved privacy notice, lawful processing purposes, patient rights, contact and retention details before launch.',
      ],
      [
        'Analytics',
        'The preview does not include advertising pixels, tracking scripts or production analytics.',
      ],
    ],
  },
  booking: {
    title: 'Booking & cancellation',
    sections: [
      [
        'Preview only',
        'No appointment is reserved in a real hospital. Demo booking states are not clinical or financial commitments.',
      ],
      [
        'Appointments',
        'The hospital will define consultation fees, slot duration, availability, cancellation and rescheduling terms.',
      ],
      [
        'Emergencies',
        'Do not use appointment booking for urgent medical needs. Contact local emergency services.',
      ],
    ],
  },
  refund: {
    title: 'Refund policy',
    sections: [
      ['No real payments', 'The preview never charges money. All payment steps are simulated.'],
      [
        'Future refunds',
        'The hospital will publish approved refund rules, timeframes, eligible payment methods and support contacts before enabling Razorpay.',
      ],
    ],
  },
};
function titleFor(parts: string[]) {
  const [section, slug] = parts;
  if (section === 'doctors') return slug ? doctors.find((d) => d.slug === slug)?.name : 'Our doctors';
  if (section === 'services')
    return slug ? services.find((d) => d.slug === slug)?.title : 'Specialties & services';
  if (section === 'health-library')
    return slug ? articles.find((d) => d.slug === slug)?.title : 'Health library';
  if (section === 'policies' && slug) return policies[slug]?.title;
  return parts.length === 1
    ? (
        {
          about: 'About us',
          contact: 'Contact & visit information',
          facilities: 'Our facilities',
          faq: 'Frequently asked questions',
        } as Record<string, string>
      )[section]
    : undefined;
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const parts = (await params).slug ?? [];
  if (publicLive) {
    const [section, slug] = parts;
    const entries = await publicContent();
    const kind: Record<string, string> = {
      services: 'service',
      'health-library': 'article',
      faq: 'faq',
      pages: 'page',
      campaigns: 'landing',
    };
    const entry = entries.find((c) => c.kind === (kind[section] || 'page') && c.slug === (slug || section));
    const doctor =
      section === 'doctors' && slug ? (await publicCatalog())?.doctors.find((d) => d.slug === slug) : null;
    return {
      title: entry?.seoTitle || entry?.title || doctor?.name || section.replaceAll('-', ' '),
      description: entry?.seoDescription || entry?.summary || doctor?.specialty || hospitalName,
      alternates: { canonical: `/${parts.join('/')}` },
      robots: { index: indexLive, follow: indexLive },
    };
  }
  const title = titleFor(parts);
  return {
    title: title ?? 'Page not found',
    description: title
      ? `${title} — Aarogya Care hospital website preview. Fictional content for review.`
      : 'Page not found',
    alternates: { canonical: `/${parts.join('/')}` },
    robots: { index: false, follow: false },
    openGraph: { title, description: 'Hospital website preview' },
  };
}
export function generateStaticParams() {
  if (publicLive) return [];
  return [
    ['about'],
    ['contact'],
    ['facilities'],
    ['faq'],
    ['doctors'],
    ['services'],
    ['health-library'],
    ...doctors.map((d) => ['doctors', d.slug]),
    ...services.map((d) => ['services', d.slug]),
    ...articles.map((d) => ['health-library', d.slug]),
    ...Object.keys(policies).map((s) => ['policies', s]),
  ].map((slug) => ({ slug }));
}
function InnerHero({ title, description, parts }: { title: string; description: string; parts: string[] }) {
  return (
    <section className="inner-hero">
      <div className="site-container animate-in">
        <nav className="breadcrumbs" aria-label="Breadcrumb">
          <a href="/">
            <L en="Home" />
          </a>
          <Icon name="chevron" size={13} />
          {parts.length > 1 && (
            <>
              <a href={parts[0] === 'policies' ? '/contact' : `/${parts[0]}`}>{parts[0].replace('-', ' ')}</a>
              <Icon name="chevron" size={13} />
            </>
          )}
          <span>{title}</span>
        </nav>
        <span className="eyebrow">Aarogya Care</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </section>
  );
}
export default async function PublicPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const parts = (await params).slug ?? [];
  if (publicLive) return <LivePage parts={parts} />;
  const [section, slug] = parts;
  const title = titleFor(parts);
  if (!title || parts.length > 2) notFound();
  let content: React.ReactNode;
  let desc = 'Explore the hospital website experience and prepare for your next visit.';
  if (section === 'doctors' && !slug) {
    desc = 'Browse fictional doctor profiles, specialties and sample availability.';
    content = <DoctorsGrid />;
  } else if (section === 'doctors' && slug) {
    const d = doctors.find((x) => x.slug === slug)!;
    desc = d.bio;
    content = (
      <div className="detail-grid">
        <article className="surface detail-card">
          <Badge tone="teal">{d.specialty}</Badge>
          <h2 style={{ marginTop: 16 }}>About this profile</h2>
          <p>
            {d.bio} Qualifications, registration number, experience and actual credentials must be verified by
            the hospital before publication.
          </p>
          <h3>Consultation information</h3>
          <p>Sample availability: {d.availability}. Consultation fee shown is for demonstration only.</p>
          <Notice tone="warning">This is not a real doctor's profile.</Notice>
        </article>
        <aside className="surface detail-card">
          <DoctorPortrait doctor={d} />
          <h2>
            <L en="Schedule a visit" />
          </h2>
          <p>
            <strong>₹{d.fee}</strong> · sample consultation fee
          </p>
          <Button href={`${portalUrl}/book?doctor=${d.slug}`} icon="calendar">
            Book a demo visit
          </Button>
        </aside>
      </div>
    );
  } else if (section === 'services' && !slug) {
    desc = 'A preview of specialty pages and available care pathways.';
    content = <ServicesGrid />;
  } else if (section === 'services' && slug) {
    const s = services.find((x) => x.slug === slug)!;
    desc = s.description;
    content = (
      <div className="detail-grid">
        <article className="surface detail-card">
          <span className="icon-tile">
            <Icon name={s.icon} />
          </span>
          <h2>About this service</h2>
          <p>{s.detail}</p>
          <h3>Preparing for your appointment</h3>
          <p>
            Bring relevant records and discuss your concerns with your clinician. Actual service information
            requires clinical approval.
          </p>
        </article>
        <aside className="surface detail-card">
          <h2>
            <L en="Find a doctor" />
          </h2>
          <p>Explore doctor profiles or start the sample booking flow.</p>
          <Button href="/doctors" variant="secondary">
            View doctors
          </Button>
          <Button href={`${portalUrl}/book`}>
            <L en="Book a visit" />
          </Button>
        </aside>
      </div>
    );
  } else if (section === 'health-library' && !slug) {
    desc = 'Patient-friendly information. Each article is a placeholder pending medical review.';
    content = <ArticlesGrid />;
  } else if (section === 'health-library' && slug) {
    const a = articles.find((x) => x.slug === slug)!;
    desc = a.intro;
    content = (
      <div className="detail-grid">
        <article className="surface detail-card">
          <Badge tone="teal">{a.category}</Badge>
          <h2 style={{ marginTop: 16 }}>Patient guide</h2>
          <p>{a.minutes} min read · Draft content</p>
          {a.body.map((p, i) => (
            <div key={p}>
              <h3>
                {i + 1}. {['Prepare', 'Discuss', 'Next steps'][i]}
              </h3>
              <p>{p}</p>
            </div>
          ))}
          <div style={{ marginTop: 22 }}>
            <Notice>
              <L en="General information only. Not a substitute for individual medical advice." />
            </Notice>
          </div>
        </article>
        <aside className="surface detail-card">
          <h2>More resources</h2>
          {articles
            .filter((x) => x.slug !== slug)
            .map((x) => (
              <p key={x.slug}>
                <a className="learn-link" href={`/health-library/${x.slug}`}>
                  {x.title} <Icon name="arrow" size={15} />
                </a>
              </p>
            ))}
          <Button href={`${portalUrl}/book`}>Book a demo visit</Button>
        </aside>
      </div>
    );
  } else if (section === 'about') {
    desc = 'A patient-first digital experience designed for a growing outpatient hospital.';
    content = (
      <>
        <div className="detail-grid">
          <article className="surface detail-card">
            <h2>A connected care journey</h2>
            <p>
              Aarogya Care is the fictional brand used to demonstrate a modern hospital website and connected
              management portal. Replace this content with approved hospital information before launch.
            </p>
            <h3>Our proposed approach</h3>
            <p>
              Clear information, straightforward appointments and thoughtful privacy controls across every
              patient touchpoint.
            </p>
          </article>
          <aside className="surface detail-card">
            <h2>Explore the hospital</h2>
            <p>Learn about the planned services, team and facilities.</p>
            <Button href="/facilities" variant="secondary">
              View facilities
            </Button>
            <Button href="/doctors">
              <L en="Meet the team" />
            </Button>
          </aside>
        </div>
        <div className="info-grid" style={{ marginTop: 22 }}>
          {[
            ['heart', 'Patient-first', 'Clear information and simple booking.'],
            ['shield', 'Privacy-aware', 'Private clinical workspace by design.'],
            ['users', 'Connected team', 'Doctor, staff and administration workflows.'],
          ].map(([i, t, d]) => (
            <div key={t} className="surface info-card">
              <span className="icon-tile">
                <Icon name={i} />
              </span>
              <h3>{t}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </>
    );
  } else if (section === 'contact') {
    desc = 'Plan your visit. Real hospital contact details will be configured before launch.';
    content = (
      <div className="contact-grid">
        <div className="stack">
          <div className="surface info-card">
            <span className="icon-tile">
              <Icon name="map" />
            </span>
            <h3>
              <L en="Hospital address" />
            </h3>
            <p>Address and directions not configured.</p>
          </div>
          <div className="surface info-card">
            <span className="icon-tile">
              <Icon name="phone" />
            </span>
            <h3>Reception & hours</h3>
            <p>Phone, email and opening hours will be added after hospital verification.</p>
            <Button href={`${portalUrl}/book`}>Try booking</Button>
          </div>
        </div>
        <div className="contact-map">
          <div>
            <span className="icon-tile">
              <Icon name="map" size={28} />
            </span>
            <h2 style={{ marginTop: 14 }}>Location preview</h2>
            <p>Map integration pending verified address.</p>
          </div>
        </div>
      </div>
    );
  } else if (section === 'facilities') {
    content = (
      <div className="info-grid">
        {[
          ['building', 'Outpatient reception'],
          ['stethoscope', 'Consultation rooms'],
          ['file', 'Patient records workspace'],
        ].map(([i, t]) => (
          <div key={t} className="surface info-card">
            <span className="icon-tile">
              <Icon name={i} />
            </span>
            <h3>{t}</h3>
            <p>Illustrative facility listing; replace with verified details.</p>
          </div>
        ))}
      </div>
    );
  } else if (section === 'faq') {
    content = <FAQ />;
  } else if (section === 'policies' && slug) {
    const p = policies[slug];
    desc = 'Draft policy information for this software preview.';
    content = (
      <article className="surface policy-content">
        <Notice tone="warning">Draft only. Requires hospital approval and legal review before use.</Notice>
        {p.sections.map(([h, d]) => (
          <section key={h}>
            <h2>{h}</h2>
            <p>{d}</p>
          </section>
        ))}
      </article>
    );
  } else notFound();
  return (
    <>
      <InnerHero title={title} description={desc} parts={parts} />
      <div className="site-container site-section">{content}</div>
    </>
  );
}
