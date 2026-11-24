import { publicLive } from '../lib/live';
import { LiveHome } from '../components/live';
import { Hero } from '../components/hero';
import { ServicesGrid, DoctorsGrid, ArticlesGrid, FAQ } from '../components/catalog';
import { Button, Icon, SectionHeading, L, LanguageLink } from '@hms/ui';
import { portalUrl } from '../lib/config';
export default function Home() {
  if (publicLive) return <LiveHome />;
  return (
    <>
      <Hero />
      <section className="quick-panel site-container animate-in delay-2" aria-label="Quick services">
        <LanguageLink href={`${portalUrl}/book`}>
          <span className="icon-tile">
            <Icon name="calendar" />
          </span>
          <div>
            <h3>
              <L en="Book a visit" />
            </h3>
            <p>
              <L en="Choose a time that suits you" />
            </p>
          </div>
          <Icon name="chevron" />
        </LanguageLink>
        <a href="/doctors">
          <span className="icon-tile">
            <Icon name="stethoscope" />
          </span>
          <div>
            <h3>
              <L en="Find a doctor" />
            </h3>
            <p>
              <L en="Browse by specialty" />
            </p>
          </div>
          <Icon name="chevron" />
        </a>
        <LanguageLink href={`${portalUrl}/manage-booking`}>
          <span className="icon-tile">
            <Icon name="file" />
          </span>
          <div>
            <h3>
              <L en="Manage booking" />
            </h3>
            <p>
              <L en="Find or cancel an appointment" hi="अपॉइंटमेंट खोजें या रद्द करें" />
            </p>
          </div>
          <Icon name="chevron" />
        </LanguageLink>
        <a href="/contact">
          <span className="icon-tile">
            <Icon name="map" />
          </span>
          <div>
            <h3>
              <L en="Plan your visit" />
            </h3>
            <p>
              <L en="Find hospital information" />
            </p>
          </div>
          <Icon name="chevron" />
        </a>
      </section>
      <section className="site-section site-container">
        <SectionHeading
          eyebrow="Our specialties"
          title="Care for every stage of life"
          description="Explore the services and care pathways available in this hospital website preview."
          action={
            <Button href="/services" variant="secondary">
              <L en="All specialties" />
              <Icon name="arrow" size={16} />
            </Button>
          }
        />
        <ServicesGrid />
      </section>
      <section className="section-tinted">
        <div className="site-section site-container">
          <SectionHeading
            eyebrow="Meet the team"
            title="Find the right doctor for you"
            description="Fictional profiles show how verified doctor information, availability and consultation booking will appear."
            action={
              <Button href="/doctors" variant="secondary">
                <L en="All doctors" />
                <Icon name="arrow" size={16} />
              </Button>
            }
          />
          <DoctorsGrid />
        </div>
      </section>
      <section className="site-section site-container">
        <div className="journey-grid">
          <div>
            <SectionHeading
              eyebrow="A simpler experience"
              title="Your visit, in three easy steps"
              description="From finding a doctor to checking in, our digital experience is designed to reduce unnecessary waiting."
            />
            <Button href={`${portalUrl}/book`}>
              <L en="Start booking" />
              <Icon name="arrow" size={17} />
            </Button>
          </div>
          <div className="journey-steps">
            {[
              ['01', 'stethoscope', 'Choose your doctor', 'Browse specialties and find a doctor.'],
              ['02', 'calendar', 'Select an appointment', 'Pick a convenient date and available time.'],
              ['03', 'check', 'Review and confirm', 'Review your details and receive a booking reference.'],
            ].map(([n, i, t, d]) => (
              <div className="journey-step" key={n}>
                <span className="step-number">{n}</span>
                <span className="icon-tile">
                  <Icon name={i} />
                </span>
                <div>
                  <h3>
                    <L en={t} />
                  </h3>
                  <p>
                    <L en={d} />
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="section-tinted">
        <div className="site-section site-container">
          <SectionHeading
            eyebrow="Health library"
            title="Information for a better visit"
            description="Patient-friendly guides and articles, ready for a medical review workflow."
            action={
              <Button href="/health-library" variant="secondary">
                <L en="Explore library" />
              </Button>
            }
          />
          <ArticlesGrid />
        </div>
      </section>
      <section className="site-section site-container">
        <FAQ />
      </section>
      <section className="site-container cta-wrap">
        <div className="cta-band">
          <div>
            <span className="eyebrow">
              <L en="Take the next step" />
            </span>
            <h2>
              <L en="Make time for your health." />
            </h2>
            <p>
              <L en="Explore the appointment booking experience." />
            </p>
          </div>
          <Button href={`${portalUrl}/book`} variant="secondary" icon="calendar">
            <L en="Book an appointment" />
            <Icon name="arrow" size={17} />
          </Button>
        </div>
      </section>
    </>
  );
}
