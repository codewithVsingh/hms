'use client';
import { useEffect, useRef, useState } from 'react';
import { Brand, Button, Field, Notice, Badge, Icon, L } from '@hms/ui';
import { api, localDay, when, rupees, human, message, type BookingRecord } from './client';
import { CancelBookingButton, PolicyExplanation } from './manage-booking';
import { v3, type CancellationPolicy } from './v3-client';
import { Captcha } from './captcha';
import { MoveAppointment, InvoiceButton } from './extended';
type Doctor = { id: string; slug: string; name: string; specialty: string; feePaise: number };
type Slot = { id: string; startsAt: string; endsAt: string };
type Catalog = { branchId: string; bookingEnabled: boolean; onlineEnabled: boolean; doctors: Doctor[] };
type GatewayOrder = { keyId: string; orderId: string; amount: number; currency: string };
type CheckoutResult = { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string };
type Checkout = { open: () => void; on: (event: string, cb: () => void) => void };
type CheckoutCtor = new (options: Record<string, unknown>) => Checkout;
let loadingScript: Promise<void> | null = null;
function loadCheckout() {
  if ((window as unknown as { Razorpay?: CheckoutCtor }).Razorpay) return Promise.resolve();
  if (loadingScript) return loadingScript;
  loadingScript = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loadingScript = null;
      s.remove();
      reject(new Error('Payment checkout could not be loaded.'));
    };
    document.head.appendChild(s);
  });
  return loadingScript;
}
async function checkout(id: string, onUpdate: () => Promise<void>, onError: (m: string) => void) {
  await loadCheckout();
  const order = await api<GatewayOrder>('payments/order', { appointmentId: id });
  const Razorpay = (window as unknown as { Razorpay?: CheckoutCtor }).Razorpay;
  if (!Razorpay) throw new Error('Payment checkout could not be loaded.');
  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (!finished) {
        finished = true;
        resolve();
      }
    };
    const instance = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'Hospital appointment',
      description: 'Consultation fee',
      theme: { color: '#096b66' },
      handler: async (r: CheckoutResult) => {
        try {
          await api('payments/verify', {
            orderId: r.razorpay_order_id,
            paymentId: r.razorpay_payment_id,
            signature: r.razorpay_signature,
          });
        } catch (e) {
          onError(message(e));
        } finally {
          await onUpdate().catch(() => {});
          finish();
        }
      },
      modal: {
        ondismiss: () => {
          void onUpdate()
            .catch(() => {})
            .finally(finish);
        },
      },
      retry: { enabled: true },
    });
    instance.on('payment.failed', () =>
      onError('Payment attempt was unsuccessful. Check the booking status before retrying.'),
    );
    instance.open();
  });
}
export function BookingRecords({
  rows,
  refresh,
  externalBusy = false,
}: {
  rows: BookingRecord[];
  refresh: () => Promise<void>;
  externalBusy?: boolean;
}) {
  const [busy, setBusy] = useState(''),
    [err, setErr] = useState('');
  const locked = useRef(false);
  async function action(row: BookingRecord, kind: 'pay' | 'recover') {
    if (locked.current || externalBusy) return;
    locked.current = true;
    setBusy(row.id);
    setErr('');
    try {
      if (kind === 'pay') await checkout(row.id, refresh, setErr);
      else if (row.orderId) await api('payments/recover', { orderId: row.orderId });
      await refresh();
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy('');
      locked.current = false;
    }
  }
  return (
    <div className="stack">
      {err && (
        <div role="alert" className="form-error">
          {err}
        </div>
      )}
      {rows.length === 0 && (
        <Notice>
          <L en="No bookings yet." />
        </Notice>
      )}
      {rows.map((r) => (
        <article className="surface live-record" key={r.id}>
          <div className="live-card-head">
            <div>
              <h3>{r.doctor}</h3>
              <p>
                {when(r.startsAt)} · {r.patient}
              </p>
            </div>
            <Badge tone={r.status === 'confirmed' ? 'green' : r.status === 'held' ? 'amber' : 'neutral'}>
              {human(r.status)}
            </Badge>
          </div>
          <dl className="live-dl">
            <dt>
              <L en="Booking reference" />
            </dt>
            <dd>{r.reference}</dd>
            <dt>
              <L en="Patient number" />
            </dt>
            <dd>{r.mrn || '—'}</dd>
            <dt>
              <L en="Consultation" />
            </dt>
            <dd>{rupees(r.feePaise)}</dd>
            <dt>
              <L en="Payment" />
            </dt>
            <dd>{human(r.paymentStatus)}</dd>
            <dt>
              <L en="Invoice reference" />
            </dt>
            <dd>{r.invoiceNumber}</dd>
          </dl>
          {r.status === 'held' && r.expiresAt && (
            <p className="text-sm">
              Slot held until {when(r.expiresAt)}. Confirmation requires captured payment.
            </p>
          )}
          {['needs_review', 'order_pending_review'].includes(r.paymentStatus) && (
            <Notice tone="warning">
              Payment requires review. Do not make another payment until reception has checked your booking.
            </Notice>
          )}
          <div className="live-actions">
            {r.status === 'held' && r.paymentStatus === 'unpaid' && r.paymentChoice === 'online' && (
              <Button disabled={!!busy || externalBusy} onClick={() => void action(r, 'pay')}>
                {busy === r.id ? 'Processing…' : 'Pay securely'}
              </Button>
            )}
            {r.orderId && r.paymentStatus !== 'paid' && (
              <Button
                disabled={!!busy || externalBusy}
                variant="secondary"
                onClick={() => void action(r, 'recover')}
              >
                <L en="Check payment" />
              </Button>
            )}
            <CancelBookingButton row={r} onDone={refresh} disabled={!!busy || externalBusy} />
            {r.status === 'confirmed' && (
              <Button variant="secondary" onClick={() => window.print()}>
                <L en="Print confirmation" />
              </Button>
            )}
            <InvoiceButton id={r.id} />
            {r.status === 'confirmed' && <MoveAppointment id={r.id} onDone={refresh} />}
          </div>
        </article>
      ))}
    </div>
  );
}
export function LiveBooking({
  websiteUrl,
  initialDoctor,
  noticeVersion,
  noticeUrl,
}: {
  websiteUrl: string;
  initialDoctor?: string;
  noticeVersion: string;
  noticeUrl: string;
}) {
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null),
    [policyAccepted, setPolicyAccepted] = useState(false);
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [doctor, setDoctor] = useState(''),
    [date, setDate] = useState(localDay),
    [slots, setSlots] = useState<Slot[]>([]),
    [slot, setSlot] = useState(''),
    [name, setName] = useState(''),
    [phone, setPhone] = useState('+91'),
    [code, setCode] = useState(''),
    [sent, setSent] = useState(false),
    [verified, setVerified] = useState(false),
    [captcha, setCaptcha] = useState(''),
    [reset, setReset] = useState(0),
    [consent, setConsent] = useState(false),
    [adult, setAdult] = useState(false),
    [birthDate, setBirthDate] = useState(''),
    [payment, setPayment] = useState<'online' | 'hospital'>('hospital'),
    [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [slotLoading, setSlotLoading] = useState(false),
    [error, setError] = useState(''),
    [records, setRecords] = useState<BookingRecord[]>([]);
  const request = useRef(''),
    locked = useRef(false);
  const refresh = async () => setRecords(await api<BookingRecord[]>('bookings'));
  useEffect(() => {
    let active = true;
    v3<CancellationPolicy | null>('policy')
      .then((p) => {
        if (active) setPolicy(p);
      })
      .catch((e) => active && setError(message(e)));
    api<Catalog | null>('catalog')
      .then((c) => {
        if (!active) return;
        setCatalog(c);
        setDoctor(c?.doctors.find((d) => d.slug === initialDoctor)?.id || c?.doctors[0]?.id || '');
      })
      .catch((e) => active && setError(message(e)));
    api<{ phoneVerified: boolean }>('auth/session')
      .then((s) => {
        if (active) setVerified(s.phoneVerified);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initialDoctor]);
  useEffect(() => {
    setSlot('');
    setSlots([]);
    if (!doctor || !date) return;
    let active = true;
    setSlotLoading(true);
    api<Slot[]>(`slots?doctor=${encodeURIComponent(doctor)}&date=${encodeURIComponent(date)}`)
      .then((v) => active && setSlots(v))
      .catch((e) => active && setError(message(e)))
      .finally(() => active && setSlotLoading(false));
    return () => {
      active = false;
    };
  }, [doctor, date]);
  async function run(task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(message(e));
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const d = catalog?.doctors.find((d) => d.id === doctor),
    chosen = slots.find((s) => s.id === slot);
  async function reserve() {
    if (
      !d ||
      !slot ||
      !name.trim() ||
      !birthDate ||
      !adult ||
      !consent ||
      !verified ||
      !policy ||
      !policyAccepted
    )
      return;
    await run(async () => {
      if (!request.current) request.current = crypto.randomUUID();
      const booking = await api<BookingRecord>('bookings/create', {
        slotId: slot,
        name,
        payment,
        requestId: request.current,
        expectedFeePaise: d.feePaise,
        policyVersion: policy.version,
        adult,
        consent,
        birthDate,
      });
      setRecords([booking]);
      setStep(3);
      await refresh().catch(() => {});
      if (payment === 'online' && booking.status === 'held') await checkout(booking.id, refresh, setError);
    });
  }
  // Latest date of birth allowed for an adult self-booking (18 years ago, IST). The server re-checks.
  const [latestAdultBirth] = useState(() => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    return `${Number(today.slice(0, 4)) - 18}${today.slice(4)}`;
  });
  const [maxDate] = useState(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() + 30 * 86400000)),
  );
  return (
    <div className="booking-page">
      <header className="booking-header">
        <div className="booking-header-inner">
          <Brand
            name={process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'Hospital'}
            href={websiteUrl}
            sub="Appointments"
          />
          <div className="live-actions">
            <a className="back-link" href="/manage-booking">
              <L en="Manage booking" />
            </a>
            <a className="back-link" href="/my-bookings">
              <L en="My bookings" />
            </a>
            <a className="back-link" href={websiteUrl}>
              <L en="Website" />
            </a>
          </div>
        </div>
      </header>
      <main id="main" className="booking-container">
        <div className="booking-intro">
          <span className="eyebrow">
            <L en="Appointments" />
          </span>
          <h1>
            <L en="Book your visit" />
          </h1>
          <p>
            <L en="Choose an available appointment and verify your mobile number." />
          </p>
        </div>
        <ol className="booking-steps">
          {['Doctor & time', 'Verify identity', 'Review & payment', 'Your booking'].map((s, i) => (
            <li className={i === step ? 'active' : i < step ? 'done' : ''} key={s}>
              <span>{i < step ? <Icon name="check" size={15} /> : i + 1}</span>
              <strong>
                <L en={s} />
              </strong>
            </li>
          ))}
        </ol>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {catalog === null && (
          <Notice>Loading booking availability. If this persists, contact reception.</Notice>
        )}
        {catalog && !catalog.bookingEnabled && (
          <Notice tone="warning">
            <L en="Online booking is currently closed. Contact the hospital." />
          </Notice>
        )}
        {catalog?.bookingEnabled && (
          <div className="booking-grid">
            <section className="surface booking-panel stack">
              <h2>
                <L
                  en={
                    [
                      'Choose your appointment',
                      'Verify your mobile',
                      'Review and reserve',
                      'Your appointments',
                    ][step]
                  }
                />
              </h2>
              {step === 0 && (
                <>
                  <Field label="Doctor">
                    <select value={doctor} onChange={(e) => setDoctor(e.target.value)}>
                      <option value="">
                        <L en="Select doctor" />
                      </option>
                      {catalog.doctors.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} — {x.specialty}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Appointment date">
                    <input
                      type="date"
                      min={localDay()}
                      max={maxDate}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <h3>
                    <L en="Available times" />
                  </h3>
                  <div className="slot-grid">
                    {slots.map((s) => (
                      <button
                        type="button"
                        className={`slot-btn ${slot === s.id ? 'selected' : ''}`}
                        aria-pressed={slot === s.id}
                        key={s.id}
                        onClick={() => setSlot(s.id)}
                      >
                        {new Intl.DateTimeFormat('en-IN', {
                          timeZone: 'Asia/Kolkata',
                          timeStyle: 'short',
                        }).format(new Date(s.startsAt))}
                      </button>
                    ))}
                  </div>
                  {slotLoading ? (
                    <p>Checking availability…</p>
                  ) : (
                    slots.length === 0 && (
                      <Notice>
                        <L en="No available appointments on this date." />
                      </Notice>
                    )
                  )}
                  <Button
                    disabled={!slot}
                    onClick={() => {
                      setStep(1);
                      setError('');
                    }}
                  >
                    <L en="Continue" />
                  </Button>
                </>
              )}
              {step === 1 && (
                <>
                  {verified ? (
                    <Notice tone="success">
                      <L en="Mobile verified. Use your own account for an adult self-booking." />
                    </Notice>
                  ) : (
                    <>
                      <Field label="Mobile number (with country code)">
                        <input
                          type="tel"
                          autoComplete="tel"
                          value={phone}
                          disabled={sent || busy}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </Field>
                      {!sent ? (
                        <>
                          <Captcha onToken={setCaptcha} resetKey={reset} />
                          <Button
                            disabled={busy || !captcha || !/^\+[1-9]\d{7,14}$/.test(phone)}
                            onClick={() =>
                              void run(async () => {
                                try {
                                  await api('auth/otp', { phone, captchaToken: captcha });
                                  setSent(true);
                                } finally {
                                  setCaptcha('');
                                  setReset((v) => v + 1);
                                }
                              })
                            }
                          >
                            <L en="Send verification code" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Field label="6-digit SMS code">
                            <input
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              value={code}
                              maxLength={6}
                              onChange={(e) => setCode(e.target.value)}
                            />
                          </Field>
                          <Button
                            disabled={busy || !/^\d{6}$/.test(code)}
                            onClick={() =>
                              void run(async () => {
                                await api('auth/verify-otp', { phone, code });
                                setVerified(true);
                              })
                            }
                          >
                            <L en="Verify code" />
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              setSent(false);
                              setCode('');
                            }}
                          >
                            <L en="Change number / resend" />
                          </Button>
                        </>
                      )}
                    </>
                  )}
                  <Field label="Patient full name">
                    <input
                      required
                      maxLength={100}
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Date of birth"
                    hint="Helps the hospital find your existing record and avoid duplicates."
                  >
                    <input
                      required
                      type="date"
                      autoComplete="bday"
                      min="1900-01-01"
                      max={latestAdultBirth}
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                    />
                  </Field>
                  <label className="check-field">
                    <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />{' '}
                    <L
                      en="I am at least 18 and booking for myself. For minors or family members, contact reception."
                      hi="मेरी उम्र कम से कम 18 वर्ष है और मैं अपने लिए बुकिंग कर रहा/रही हूँ। नाबालिगों या परिवार के सदस्यों के लिए रिसेप्शन से संपर्क करें।"
                    />
                  </label>
                  <label className="check-field">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>
                      <L en="I acknowledge the" hi="मैं स्वीकार करता/करती हूँ" />{' '}
                      <a className="back-link" href={noticeUrl} target="_blank" rel="noopener noreferrer">
                        <L en="privacy and booking notice" hi="गोपनीयता और बुकिंग सूचना" />
                      </a>{' '}
                      ({noticeVersion}){' '}
                      <L
                        en="and authorize processing for this appointment."
                        hi="और इस अपॉइंटमेंट के लिए डेटा उपयोग की अनुमति देता/देती हूँ।"
                      />
                    </span>
                  </label>
                  <div className="live-actions">
                    <Button variant="secondary" onClick={() => setStep(0)}>
                      <L en="Back" />
                    </Button>
                    <Button
                      disabled={
                        !verified ||
                        !adult ||
                        !consent ||
                        name.trim().length < 2 ||
                        !birthDate ||
                        birthDate > latestAdultBirth
                      }
                      onClick={() => setStep(2)}
                    >
                      <L en="Continue" />
                    </Button>
                  </div>
                </>
              )}
              {step === 2 && (
                <>
                  <div className="review-row">
                    <span>
                      <L en="Patient" />
                    </span>
                    <strong>{name}</strong>
                  </div>
                  <div className="review-row">
                    <span>
                      <L en="Visit" />
                    </span>
                    <strong>{chosen && when(chosen.startsAt)}</strong>
                  </div>
                  <div className="review-row">
                    <span>
                      <L en="Consultation" />
                    </span>
                    <strong>{d && rupees(d.feePaise)}</strong>
                  </div>
                  <label className="payment-option">
                    <input
                      type="radio"
                      name="pay"
                      checked={payment === 'hospital'}
                      onChange={() => setPayment('hospital')}
                    />
                    <L en="Pay at hospital" />
                  </label>
                  {catalog.onlineEnabled && !!d?.feePaise && (
                    <label className="payment-option">
                      <input
                        type="radio"
                        name="pay"
                        checked={payment === 'online'}
                        onChange={() => setPayment('online')}
                      />
                      <L en="Pay online using Razorpay" />
                    </label>
                  )}
                  <div className="stack">
                    {policy ? (
                      <>
                        <PolicyExplanation policy={policy} />
                        <label className="check-field">
                          <input
                            type="checkbox"
                            checked={policyAccepted}
                            onChange={(e) => setPolicyAccepted(e.target.checked)}
                          />
                          <L
                            en="I have read and accept this cancellation and refund policy."
                            hi="मैंने रद्दीकरण और धनवापसी नीति पढ़ ली है और इसे स्वीकार करता/करती हूँ।"
                          />
                        </label>
                      </>
                    ) : (
                      <Notice tone="warning">
                        <L
                          en="Cancellation policy is unavailable. Booking is disabled."
                          hi="रद्दीकरण नीति उपलब्ध नहीं है। बुकिंग बंद है।"
                        />
                      </Notice>
                    )}
                  </div>
                  <Notice>
                    <L en="Online payment reserves the selected slot for up to ten minutes. If payment is delayed, check your booking before paying again." />
                  </Notice>
                  <div className="live-actions">
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        request.current = '';
                        setStep(1);
                      }}
                    >
                      <L en="Back" />
                    </Button>
                    <Button disabled={busy || !policy || !policyAccepted} onClick={() => void reserve()}>
                      {busy ? 'Reserving…' : payment === 'online' ? 'Reserve & pay' : 'Confirm appointment'}
                    </Button>
                  </div>
                </>
              )}
              {step === 3 && (
                <>
                  <BookingRecords rows={records} refresh={refresh} externalBusy={busy} />
                  <div className="live-actions">
                    <Button disabled={busy} variant="secondary" onClick={() => void run(refresh)}>
                      <L en="Refresh status" />
                    </Button>
                    <Button href="/my-bookings">
                      <L en="My bookings" />
                    </Button>
                  </div>
                </>
              )}
            </section>
            <aside className="surface booking-summary stack">
              <h3>
                <L en="Appointment summary" />
              </h3>
              <p>{d?.name || 'Select a doctor'}</p>
              <p>{d?.specialty}</p>
              <div className="review-row">
                <span>
                  <L en="Date" />
                </span>
                <strong>{date}</strong>
              </div>
              <div className="review-row">
                <span>
                  <L en="Time" />
                </span>
                <strong>{chosen ? when(chosen.startsAt) : 'Not selected'}</strong>
              </div>
              <div className="summary-total">
                <span>
                  <L en="Consultation" />
                </span>
                <strong>{d ? rupees(d.feePaise) : '—'}</strong>
              </div>
              <Notice>
                <L en="For emergencies or urgent symptoms, contact local emergency services instead of online booking." />
              </Notice>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
export function MyBookings({ websiteUrl }: { websiteUrl: string }) {
  const [rows, setRows] = useState<BookingRecord[]>([]),
    [error, setError] = useState(''),
    [loaded, setLoaded] = useState(false);
  const refresh = async () => {
    setRows(await api<BookingRecord[]>('bookings'));
    setLoaded(true);
    setError('');
  };
  useEffect(() => {
    void refresh().catch((e) => {
      setLoaded(true);
      setError(message(e));
    });
  }, []);
  return (
    <main id="main" className="booking-container stack">
      <a className="back-link" href="/patient">
        Patient records &amp; preferences
      </a>
      <Brand name={process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'Hospital'} href={websiteUrl} />
      <div className="live-card-head">
        <h1>
          <L en="My appointments" />
        </h1>
        <div className="live-actions">
          <Button href="/book">
            <L en="Book a visit" />
          </Button>
          <Button
            variant="secondary"
            onClick={async () => {
              await api('auth/logout', {});
              window.location.replace('/book');
            }}
          >
            <L en="Sign out" />
          </Button>
        </div>
      </div>
      {error && (
        <Notice tone="warning">
          {error}{' '}
          <a href="/book" className="back-link">
            <L en="Verify your mobile to continue." />
          </a>
        </Notice>
      )}
      {loaded && !error && (
        <>
          <BookingRecords rows={rows} refresh={refresh} />
          <Button variant="secondary" onClick={() => void refresh().catch((e) => setError(message(e)))}>
            <L en="Refresh status" />
          </Button>
        </>
      )}
    </main>
  );
}
