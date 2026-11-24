'use client';
import * as React from 'react';
import { doctors } from '@hms/types';
import { Brand, Button, Icon, Badge, Notice, Avatar, Field, L, T, When, useT } from '@hms/ui';
import { dateKey, formatINR, isDemoName } from '@hms/validation';
const steps = ['Doctor & time', 'Demo details', 'Review & payment', 'Confirmation'];
const slots = [
  '09:00 AM',
  '09:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '02:00 PM',
  '02:30 PM',
  '03:00 PM',
];
// Day keys are local calendar dates; noon IST keeps the weekday stable when formatted in Asia/Kolkata.
const noonIST = (key: string) => `${key}T12:00:00+05:30`;
const fullDay: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
const shortDay: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
const sampleDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function makeDays() {
  const now = new Date();
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i + 1, 12);
    return {
      key: dateKey(d),
      day: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      dayNum: d.getDate(),
      month: d.toLocaleDateString('en-IN', { month: 'short' }),
    };
  });
}
type BookingState = {
  step: number;
  doctor: string;
  day: string;
  time: string;
  name: string;
  consent: boolean;
  payment: 'online' | 'hospital';
  confirmed: boolean;
  reference: string;
  error: string;
  days: ReturnType<typeof makeDays>;
};
type BookingProps = { websiteUrl: string; initialDoctor?: string };
/** Supplies the translator to the class component, which cannot call hooks itself. */
export function Booking(props: BookingProps) {
  const tx = useT();
  return <DemoBooking {...props} tx={tx} />;
}
class DemoBooking extends React.Component<BookingProps & { tx: (en: string) => string }, BookingState> {
  state: BookingState = {
    step: 0,
    doctor: doctors.some((d) => d.slug === this.props.initialDoctor)
      ? this.props.initialDoctor!
      : doctors[0].slug,
    day: '',
    time: '',
    name: 'Demo Patient',
    consent: false,
    payment: 'online',
    confirmed: false,
    reference: '',
    error: '',
    days: [],
  };
  componentDidMount() {
    this.setState({ days: makeDays() });
  }
  get doctor() {
    return doctors.find((d) => d.slug === this.state.doctor)!;
  }
  get availableDays() {
    const map: Record<string, string[]> = {
      'ananya-sharma': sampleDays.slice(0, 6),
      'arjun-mehta': ['Mon', 'Wed', 'Fri'],
      'meera-rao': ['Tue', 'Thu', 'Sat'],
    };
    return this.state.days.filter((d) => map[this.state.doctor].includes(d.day));
  }
  go = (step: number) => {
    this.setState({ step, error: '' }, () => {
      const el = document.getElementById('booking-step-title');
      el?.focus();
    });
  };
  next = () => {
    const s = this.state;
    if (s.step === 0 && (!s.day || !s.time)) {
      this.setState({ error: 'Choose an available date and time to continue.' });
      return;
    }
    if (s.step === 1 && (!isDemoName(s.name) || !s.consent)) {
      this.setState({ error: 'Select the sample details and acknowledge the demo notice.' });
      return;
    }
    if (s.step === 2) {
      this.setState({ confirmed: true, reference: 'BK-00012A7' });
    }
    this.go(Math.min(3, s.step + 1));
  };
  render() {
    const s = this.state,
      d = this.doctor;
    const selectedDate = s.days.find((x) => x.key === s.day);
    return (
      <div className="booking-page">
        <header className="booking-header">
          <div className="booking-header-inner">
            <Brand href={this.props.websiteUrl} sub="Patient appointment" />
            <a className="back-link" href={this.props.websiteUrl}>
              <L en="Return to website" />
              <Icon name="arrow" size={16} />
            </a>
          </div>
        </header>
        <main id="main" className="booking-container">
          <div className="booking-intro animate-in">
            <span className="eyebrow">
              <L en="Appointments" />
            </span>
            <h1>
              <L en="Book your visit" />
            </h1>
            <p>
              <L en="A guided preview of the online appointment experience." />
            </p>
          </div>
          <Notice tone="warning">
            <L en="Preview only. No real appointments, patient details or charges are created." />
          </Notice>
          <ol className="booking-steps" aria-label={this.props.tx('Booking progress')}>
            {steps.map((label, i) => (
              <li
                key={label}
                className={i === s.step ? 'active' : i < s.step ? 'done' : ''}
                aria-current={i === s.step ? 'step' : undefined}
              >
                <span>{i < s.step ? <Icon name="check" size={15} /> : i + 1}</span>
                <strong>
                  <L en={label} />
                </strong>
              </li>
            ))}
          </ol>
          <div className="booking-grid">
            <section className="surface booking-panel animate-in" key={s.step}>
              <h2 id="booking-step-title" tabIndex={-1}>
                <L
                  en={
                    [
                      'Choose your doctor & appointment',
                      'Confirm sample patient details',
                      'Review your booking',
                      'Your demo booking is complete',
                    ][s.step]
                  }
                />
              </h2>
              <p className="panel-intro">
                <L
                  en={
                    [
                      'Select a doctor and one of the sample available slots.',
                      'Use the fictional patient profile below; do not enter personal information.',
                      'Check the selected appointment and choose a simulated payment method.',
                      'Nothing has been scheduled or charged in the real world.',
                    ][s.step]
                  }
                />
              </p>
              {s.step === 0 && (
                <>
                  <h3 className="field-heading">
                    <L en="Select doctor" />
                  </h3>
                  <div className="booking-doctors">
                    {doctors.map((x) => (
                      <button
                        type="button"
                        key={x.slug}
                        className={`booking-doctor ${x.slug === s.doctor ? 'selected' : ''}`}
                        aria-pressed={x.slug === s.doctor}
                        onClick={() => this.setState({ doctor: x.slug, day: '', time: '', error: '' })}
                      >
                        <Avatar initials={x.initials} color={x.color} />
                        <div className="grow">
                          <strong>{x.name}</strong>
                          <small>{x.specialty}</small>
                        </div>
                        <span>{formatINR(x.fee)}</span>
                        <span className="select-dot" />
                      </button>
                    ))}
                  </div>
                  <h3 className="field-heading">
                    <L en="Available dates" />
                  </h3>
                  <div className="date-grid">
                    {this.availableDays.map((day) => (
                      <button
                        type="button"
                        key={day.key}
                        className={`date-btn ${s.day === day.key ? 'selected' : ''}`}
                        aria-pressed={s.day === day.key}
                        onClick={() => this.setState({ day: day.key, time: '', error: '' })}
                      >
                        <span>
                          <When iso={noonIST(day.key)} format={{ weekday: 'short' }} />
                        </span>
                        <strong>{day.dayNum}</strong>
                        <span>
                          <When iso={noonIST(day.key)} format={{ month: 'short' }} />
                        </span>
                      </button>
                    ))}
                  </div>
                  <h3 className="field-heading">
                    <L en="Available time slots" />
                  </h3>
                  {s.day ? (
                    <div className="slot-grid">
                      {slots.map((slot, i) => (
                        <button
                          type="button"
                          key={slot}
                          disabled={i === 2 || i === 6}
                          aria-pressed={s.time === slot}
                          className={`slot-btn ${s.time === slot ? 'selected' : ''}`}
                          onClick={() => this.setState({ time: slot, error: '' })}
                        >
                          {slot}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="slot-placeholder">
                      <L en="Select a date to see sample time slots." />
                    </div>
                  )}
                  <p className="text-sm muted" style={{ marginTop: 9 }}>
                    <L en={'Unavailable slots are disabled in the preview.'} />
                  </p>
                </>
              )}
              {s.step === 1 && (
                <div className="stack">
                  <div className="form-grid">
                    <Field label="Patient name">
                      <input value={s.name} readOnly />
                    </Field>
                    <Field label="Mobile verification">
                      <input value="Demo verified (no OTP sent)" readOnly />
                    </Field>
                    <Field label="Age group">
                      <select defaultValue="adult">
                        <option value="adult">{this.props.tx('Adult (sample)')}</option>
                        <option value="child">{this.props.tx('Child (sample)')}</option>
                      </select>
                    </Field>
                    <Field label="Visit type">
                      <select>
                        <option value="First visit">{this.props.tx('First visit')}</option>
                        <option value="Follow-up visit">{this.props.tx('Follow-up visit')}</option>
                      </select>
                    </Field>
                  </div>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={s.consent}
                      onChange={(e) => this.setState({ consent: e.target.checked, error: '' })}
                    />
                    <span>
                      <L en="I understand that this is a demonstration only and does not create a medical appointment." />
                    </span>
                  </label>
                </div>
              )}
              {s.step === 2 && (
                <div className="stack">
                  <div className="review-row">
                    <span>
                      <L en="Patient" />
                    </span>
                    <strong>{s.name}</strong>
                  </div>
                  <div className="review-row">
                    <span>
                      <L en={'Appointment'} />
                    </span>
                    <strong>
                      <When iso={selectedDate && noonIST(selectedDate.key)} format={fullDay} /> · {s.time}
                    </strong>
                  </div>
                  <div className="review-row">
                    <span>
                      <L en="Doctor" />
                    </span>
                    <strong>{d.name}</strong>
                  </div>
                  <h3 className="field-heading">
                    <L en="Payment method" />
                  </h3>
                  {(
                    [
                      {
                        id: 'online',
                        label: 'Online payment preview',
                        sub: 'Razorpay UI placeholder — no card or UPI details',
                        icon: 'card',
                      },
                      {
                        id: 'hospital',
                        label: 'Pay at hospital preview',
                        sub: 'Mark as unpaid in a future live workflow',
                        icon: 'wallet',
                      },
                    ] as const
                  ).map((method) => (
                    <label
                      key={method.id}
                      className={`payment-option ${s.payment === method.id ? 'selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="payment"
                        checked={s.payment === method.id}
                        onChange={() => this.setState({ payment: method.id })}
                      />
                      <span className="icon-tile">
                        <Icon name={method.icon} />
                      </span>
                      <span>
                        <strong>
                          <L en={method.label} />
                        </strong>
                        <small>{method.sub}</small>
                      </span>
                    </label>
                  ))}
                  <Notice>
                    <L en="Amount shown is illustrative. No Razorpay SDK or live payment API is loaded." />
                  </Notice>
                </div>
              )}
              {s.step === 3 && (
                <div className="confirmation">
                  <span className="confirmation-icon">
                    <Icon name="check" size={40} />
                  </span>
                  <Badge tone="green">
                    <L en="Demo confirmed" />
                  </Badge>
                  <h3>{s.reference}</h3>
                  <p>
                    <T en={'{0}: PT-000127'} values={[<L key="v0" en="Patient number" />]} />
                  </p>
                  <Button href="/manage-booking" variant="secondary">
                    <L en="Manage booking" />
                  </Button>
                  <p>
                    {d.name} · <When iso={selectedDate && noonIST(selectedDate.key)} format={shortDay} /> ·{' '}
                    {s.time}
                  </p>
                  <Notice tone="success">
                    {s.payment === 'online'
                      ? 'Simulated payment successful. No money was collected.'
                      : 'Simulated pay-at-hospital booking. No money was collected.'}
                  </Notice>
                  <Button href={this.props.websiteUrl} variant="secondary">
                    <L en="Return to website" />
                  </Button>
                  <Button
                    onClick={() =>
                      this.setState({
                        step: 0,
                        day: '',
                        time: '',
                        consent: false,
                        confirmed: false,
                        reference: '',
                        error: '',
                      })
                    }
                  >
                    <L en="Book another demo visit" />
                  </Button>
                </div>
              )}
              {s.error && (
                <div className="form-error" role="alert">
                  {s.error}
                </div>
              )}
              {s.step < 3 && (
                <div className="booking-actions">
                  {s.step > 0 ? (
                    <Button variant="secondary" onClick={() => this.go(s.step - 1)}>
                      <L en="Back" />
                    </Button>
                  ) : (
                    <a href={this.props.websiteUrl} className="text-sm muted">
                      <L en="Cancel" />
                    </a>
                  )}
                  <Button onClick={this.next}>
                    <L en={s.step === 2 ? 'Confirm demo booking' : 'Continue'} />{' '}
                    <Icon name="arrow" size={17} />
                  </Button>
                </div>
              )}
            </section>
            <aside className="surface booking-summary">
              <div className="summary-heading">
                <Icon name="calendar" />
                <h3>
                  <L en="Appointment summary" />
                </h3>
              </div>
              <div className="summary-doctor">
                <Avatar initials={d.initials} color={d.color} size="lg" />
                <div>
                  <strong>{d.name}</strong>
                  <p>{d.specialty}</p>
                </div>
              </div>
              <div className="review-row">
                <span>
                  <L en="Date" />
                </span>
                <strong>
                  {selectedDate ? (
                    <When iso={noonIST(selectedDate.key)} format={fullDay} />
                  ) : (
                    <L en={'Not selected'} />
                  )}
                </strong>
              </div>
              <div className="review-row">
                <span>
                  <L en="Time" />
                </span>
                <strong>{s.time || <L en={'Not selected'} />}</strong>
              </div>
              <div className="review-row">
                <span>
                  <L en="Consultation fee" />
                </span>
                <strong>{formatINR(d.fee)}</strong>
              </div>
              <div className="summary-total">
                <span>
                  <L en="Sample total" />
                </span>
                <strong>{formatINR(d.fee)}</strong>
              </div>
              <div className="summary-trust">
                <Icon name="shield" size={17} />
                <L en="No sensitive data or live payments." />
              </div>
            </aside>
          </div>
        </main>
      </div>
    );
  }
}
