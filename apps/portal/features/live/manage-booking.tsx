'use client';
import { useEffect, useState, useRef } from 'react';
import { Brand, Button, Field, Notice, Badge, Icon, L, useLanguage, LanguageLink } from '@hms/ui';
import { api, message, rupees, when, human, type BookingRecord } from './client';
import { v3, type CancellationQuote, type CancellationPolicy } from './v3-client';
import { Captcha } from './captcha';
export function PolicyExplanation({ policy }: { policy: CancellationPolicy }) {
  const lang = useLanguage();
  return (
    <div className="policy-explanation">
      <strong>
        <L en="Cancellation policy" />
      </strong>
      <p>
        {lang === 'hi'
          ? `अपॉइंटमेंट से कम से कम ${policy.freeHours} घंटे पहले रद्द करने पर कोई शुल्क नहीं। इसके बाद भुगतान की गई राशि से अधिकतम ${rupees(policy.feePaise)} काटे जा सकते हैं। बिना भुगतान वाली बुकिंग पर कोई कटौती नहीं।`
          : `Cancel at least ${policy.freeHours} hours before the appointment with no deduction. After that, up to ${rupees(policy.feePaise)} may be deducted from the amount paid. No deduction for unpaid bookings.`}
      </p>
      <small>
        <L
          en="Normal online refunds usually take 5–7 working days after initiation, depending on the bank/payment method."
          hi="सामान्य ऑनलाइन धनवापसी शुरू होने के बाद आम तौर पर 5–7 कार्य दिवस लगते हैं; समय बैंक और भुगतान के तरीके पर निर्भर करता है।"
        />
      </small>
    </div>
  );
}
const example: BookingRecord = {
  id: 'demo-booking',
  reference: 'BK-00012A7',
  mrn: 'PT-000127',
  doctor: 'Dr. Ananya Sharma',
  patient: 'Sample Patient',
  startsAt: '2026-12-02T05:30:00Z',
  status: 'confirmed',
  paymentChoice: 'online',
  feePaise: 50000,
  paymentStatus: 'paid',
  invoiceNumber: 'DEMO-INV-01',
  expiresAt: null,
};
const demoQuote: CancellationQuote = {
  eligible: true,
  paidPaise: 50000,
  deductionPaise: 5000,
  refundPaise: 45000,
  policyVersion: 1,
  slotId: 'demo-slot',
  feePaise: 5000,
  freeHours: 24,
};
function MoneyBreakdown({ q }: { q: CancellationQuote }) {
  return (
    <dl className="cancel-money">
      <div>
        <dt>
          <L en="Amount paid" hi="भुगतान की गई राशि" />
        </dt>
        <dd>{rupees(q.paidPaise || 0)}</dd>
      </div>
      <div>
        <dt>
          <L en="Cancellation deduction" hi="रद्दीकरण कटौती" />
        </dt>
        <dd className="deduction">− {rupees(q.deductionPaise || 0)}</dd>
      </div>
      <div className="refund-total">
        <dt>
          <L en="Amount to be refunded" hi="वापस की जाने वाली राशि" />
        </dt>
        <dd>{rupees(q.refundPaise || 0)}</dd>
      </div>
    </dl>
  );
}
export function CancelBookingButton({
  row,
  demo = false,
  onDone,
  disabled = false,
}: {
  row: BookingRecord;
  demo?: boolean;
  onDone?: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [quote, setQuote] = useState<CancellationQuote | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<CancellationQuote | null>(null);
  const lock = useRef(false),
    dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) {
      dialog.current.showModal();
    } else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  async function readQuote(show: boolean) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const q = demo
        ? result || demoQuote
        : await v3<CancellationQuote>('cancel/quote?id=' + encodeURIComponent(row.id));
      setQuote(q);
      if (q.cancelled) {
        setResult(q);
        setOpen(false);
      } else if (show) setOpen(true);
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    setResult(null);
    setQuote(null);
  }, [row.id]);
  useEffect(() => {
    if (row.status === 'cancelled' && !demo) void readQuote(false);
  }, [row.id, row.status]);
  async function submit() {
    if (lock.current || !quote?.eligible) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const q = demo
        ? { ...quote, eligible: false, cancelled: true, refundStatus: 'requested' }
        : await v3<CancellationQuote>('cancel/confirm', {
            id: row.id,
            paidPaise: quote.paidPaise,
            deductionPaise: quote.deductionPaise,
            refundPaise: quote.refundPaise,
            policyVersion: quote.policyVersion,
            slotId: quote.slotId,
          });
      setResult(q);
      setQuote(q);
      setOpen(false);
      await onDone?.();
    } catch (e) {
      setError(message(e));
      setQuote(null);
      setOpen(false);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const showButton = !result && ['confirmed', 'held'].includes(row.status);
  return (
    <div className="cancel-wrap stack">
      {showButton && (
        <Button variant="danger" disabled={busy || disabled} onClick={() => void readQuote(true)}>
          <L en="Cancel booking" hi="बुकिंग रद्द करें" />
        </Button>
      )}
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {result?.cancelled && (
        <section className="cancel-result stack" aria-live="polite">
          <Notice tone="success">
            <L
              en={demo ? 'Demo booking cancelled. No money was moved.' : 'Booking cancelled.'}
              hi={demo ? 'डेमो बुकिंग रद्द हुई। कोई वास्तविक भुगतान नहीं हुआ।' : 'बुकिंग रद्द हो गई।'}
            />
          </Notice>
          <MoneyBreakdown q={result} />
          <p>
            <L en="Refund status" hi="धनवापसी की स्थिति" />:{' '}
            <Badge tone={result.refundStatus === 'processed' ? 'green' : 'amber'}>
              {human(result.refundStatus || 'not_required')}
            </Badge>
          </p>
          {(result.refundPaise || 0) > 0 && (
            <p className="text-sm">
              <L
                en="Normal refunds are estimated at 5–7 working days after initiation. A requested refund is not yet processed."
                hi="धनवापसी शुरू होने के बाद सामान्यतः 5–7 कार्य दिवस लगते हैं। अनुरोधित धनवापसी अभी पूरी नहीं हुई है।"
              />
            </p>
          )}
          {!demo && (
            <Button variant="secondary" disabled={busy} onClick={() => void readQuote(false)}>
              <L en="Refresh refund status" hi="धनवापसी की स्थिति अपडेट करें" />
            </Button>
          )}
        </section>
      )}
      <dialog
        ref={dialog}
        className="cancel-dialog"
        aria-labelledby={'cancel-title-' + row.id}
        onCancel={(e) => {
          e.preventDefault();
          if (!busy) setOpen(false);
        }}
      >
        <div className="cancel-dialog-inner stack">
          <span className="cancel-icon">
            <Icon name="alert" size={27} />
          </span>
          <h2 id={'cancel-title-' + row.id}>
            <L en="Cancel this appointment?" hi="क्या यह अपॉइंटमेंट रद्द करें?" />
          </h2>
          <p className="muted">
            {row.reference} · {row.doctor}
          </p>
          {quote?.eligible ? (
            <>
              <p>
                <L
                  en="Your reserved slot will be released. Review the exact amounts before confirming."
                  hi="आपका आरक्षित स्लॉट खाली हो जाएगा। पुष्टि करने से पहले राशि की जाँच करें।"
                />
              </p>
              <MoneyBreakdown q={quote} />
              {(quote.refundPaise || 0) > 0 && (
                <Notice tone="warning">
                  <L
                    en="Refund to the original payment method: usually 5–7 working days after initiation. Bank processing time may vary."
                    hi="धनवापसी मूल भुगतान माध्यम में होगी: शुरू होने के बाद सामान्यतः 5–7 कार्य दिवस। बैंक के अनुसार समय बदल सकता है।"
                  />
                </Notice>
              )}
              <p className="text-sm">
                <L
                  en="Cancellation cannot be undone. You can make a new booking if needed."
                  hi="रद्दीकरण वापस नहीं लिया जा सकता। ज़रूरत होने पर नई बुकिंग करें।"
                />
              </p>
              <div className="cancel-dialog-actions">
                <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
                  <L en="Keep appointment" hi="अपॉइंटमेंट रखें" />
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void submit()}>
                  <L
                    en={busy ? 'Processing…' : 'Confirm cancellation'}
                    hi={busy ? 'प्रक्रिया जारी…' : 'रद्दीकरण की पुष्टि करें'}
                  />
                </Button>
              </div>
            </>
          ) : (
            <>
              <Notice tone="warning">
                <L
                  en="This booking cannot be cancelled online in its current state. Contact reception; no deduction or refund is assumed."
                  hi="इस बुकिंग को अभी ऑनलाइन रद्द नहीं किया जा सकता। रिसेप्शन से संपर्क करें; कोई कटौती या धनवापसी तय नहीं है।"
                />
              </Notice>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Close
              </Button>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
export function ManageBooking({ websiteUrl, demo = false }: { websiteUrl: string; demo?: boolean }) {
  const [phone, setPhone] = useState('+91'),
    [code, setCode] = useState(''),
    [token, setToken] = useState(''),
    [reset, setReset] = useState(0),
    [sent, setSent] = useState(false),
    [verified, setVerified] = useState(demo),
    [reference, setReference] = useState(demo ? example.reference : ''),
    [identity, setIdentity] = useState(demo ? example.mrn || '' : ''),
    [row, setRow] = useState<BookingRecord | null>(null),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (!demo)
      api<{ phoneVerified: boolean }>('auth/session')
        .then((s) => setVerified(s.phoneVerified))
        .catch(() => {});
  }, [demo]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function find() {
    setRow(null);
    setSearched(false);
    await run(async () => {
      const r = demo
        ? reference.trim().toUpperCase() === example.reference &&
          (identity.trim().toUpperCase() === example.mrn ||
            identity.trim().toLowerCase() === example.patient.toLowerCase())
          ? example
          : null
        : await v3<BookingRecord | null>('booking/find', { reference, identity });
      setRow(r);
      setSearched(true);
    });
  }
  return (
    <div className="booking-page">
      <header className="booking-header">
        <div className="booking-header-inner">
          <Brand
            name={process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'Aarogya Care'}
            href={websiteUrl}
            sub="Patient services"
          />
          <LanguageLink href={websiteUrl}>
            <L en="Website" />
          </LanguageLink>
        </div>
      </header>
      <main id="main" className="booking-container stack manage-booking">
        <div className="booking-intro">
          <span className="eyebrow">
            <L en="Patient services" />
          </span>
          <h1>
            <L en="Manage booking" />
          </h1>
          <p>
            <L
              en="Find, review or cancel your appointment securely."
              hi="अपना अपॉइंटमेंट सुरक्षित रूप से खोजें, देखें या रद्द करें।"
            />
          </p>
        </div>
        {demo && (
          <Notice tone="warning">
            <L
              en="Preview only. Use the pre-filled fictional booking; no OTP, appointment or refund is real."
              hi="केवल डेमो। पहले से भरी काल्पनिक बुकिंग का उपयोग करें; कोई वास्तविक ओटीपी, अपॉइंटमेंट या धनवापसी नहीं होगी।"
            />
          </Notice>
        )}
        <section className="surface booking-panel stack">
          <h2>
            <L en="1. Verify your mobile" hi="1. मोबाइल नंबर सत्यापित करें" />
          </h2>
          {verified ? (
            <Notice tone="success">
              <L en="Mobile verified" hi="मोबाइल सत्यापित" />
            </Notice>
          ) : (
            <>
              <Field label="Mobile number (with country code)">
                <input
                  type="tel"
                  value={phone}
                  autoComplete="tel"
                  disabled={sent || busy}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
              {!sent ? (
                <>
                  <Captcha onToken={setToken} resetKey={reset} />
                  <Button
                    disabled={busy || !token || !/^\+[1-9]\d{7,14}$/.test(phone)}
                    onClick={() =>
                      void run(async () => {
                        try {
                          await api('auth/otp', { phone, captchaToken: token });
                          setSent(true);
                        } finally {
                          setToken('');
                          setReset((v) => v + 1);
                        }
                      })
                    }
                  >
                    Send verification code
                  </Button>
                </>
              ) : (
                <>
                  <Field label="6-digit SMS code">
                    <input
                      value={code}
                      inputMode="numeric"
                      autoComplete="one-time-code"
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
                    Verify code
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setSent(false);
                      setCode('');
                    }}
                  >
                    Change number / resend
                  </Button>
                </>
              )}
            </>
          )}
          {verified && !demo && (
            <Button
              variant="ghost"
              onClick={() =>
                void run(async () => {
                  await api('auth/logout', {});
                  setVerified(false);
                  setRow(null);
                  setSent(false);
                  setSearched(false);
                })
              }
            >
              <L en="Use a different mobile number" hi="दूसरा मोबाइल नंबर उपयोग करें" />
            </Button>
          )}
        </section>
        <section className="surface booking-panel stack">
          <h2>
            <L en="2. Find your booking" hi="2. अपनी बुकिंग खोजें" />
          </h2>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void find();
            }}
          >
            <Field label="Booking number" hint="Example: BK-00012A7">
              <input
                required
                maxLength={40}
                autoComplete="off"
                value={reference}
                disabled={!verified || busy}
                onChange={(e) => {
                  setReference(e.target.value);
                  setRow(null);
                  setSearched(false);
                }}
                placeholder="BK-00012A7"
              />
            </Field>
            <Field label="Patient number or full name">
              <input
                required
                maxLength={100}
                autoComplete="off"
                value={identity}
                disabled={!verified || busy}
                onChange={(e) => {
                  setIdentity(e.target.value);
                  setRow(null);
                  setSearched(false);
                }}
                placeholder="PT-000127"
              />
            </Field>
            <Button
              type="submit"
              disabled={!verified || busy || reference.trim().length < 4 || identity.trim().length < 2}
              icon="search"
            >
              <L en="Find booking" hi="बुकिंग खोजें" />
            </Button>
          </form>
          {searched && !row && (
            <Notice tone="warning">
              <L
                en="No matching booking for this verified account. Check the details or contact reception."
                hi="इस सत्यापित खाते में मेल खाने वाली बुकिंग नहीं मिली। विवरण जाँचें या रिसेप्शन से संपर्क करें।"
              />
            </Notice>
          )}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
        </section>
        {row && (
          <section className="surface booking-panel stack">
            <div className="live-card-head">
              <div>
                <span className="eyebrow">
                  <L en="Booking number" />
                </span>
                <h2>{row.reference}</h2>
              </div>
              <Badge tone={row.status === 'confirmed' ? 'green' : 'neutral'}>{human(row.status)}</Badge>
            </div>
            <h3>{row.doctor}</h3>
            <dl className="live-dl">
              <dt>
                <L en="Patient" />
              </dt>
              <dd>{row.patient}</dd>
              <dt>
                <L en="Patient number" />
              </dt>
              <dd>{row.mrn}</dd>
              <dt>
                <L en="Date" />
              </dt>
              <dd>{when(row.startsAt)}</dd>
              <dt>
                <L en="Payment" />
              </dt>
              <dd>
                {rupees(row.feePaise)} · <L en={human(row.paymentStatus)} />
              </dd>
            </dl>
            <CancelBookingButton
              row={row}
              demo={demo}
              onDone={async () => {
                if (!demo) {
                  const r = await v3<BookingRecord | null>('booking/find', { reference, identity });
                  setRow(r);
                } else setRow((v) => (v ? { ...v, status: 'cancelled' } : v));
              }}
            />
          </section>
        )}
        <div className="live-actions">
          <Button href="/book" variant="secondary">
            Book a visit
          </Button>
          <Button href="/my-bookings" variant="secondary">
            My appointments
          </Button>
        </div>
      </main>
    </div>
  );
}
