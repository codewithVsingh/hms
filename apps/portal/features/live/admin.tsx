'use client';
import { useEffect, useState, useRef } from 'react';
import { Button, Field, Notice, Badge, L, T, useT } from '@hms/ui';
import { api, human, message, rupees } from './client';
type Entry = {
  id: string;
  kind: string;
  slug: string;
  title: string;
  summary: string | null;
  body: string | null;
  status: string;
  seo_title: string | null;
  seo_description: string | null;
};
const empty = {
  id: null as string | null,
  kind: 'article',
  slug: '',
  title: '',
  summary: '',
  body: '',
  seoTitle: '',
  seoDescription: '',
};
export function LiveContent({ permissions }: { permissions: string[] }) {
  const tx = useT();
  const has = (p: string) => permissions.includes(p);
  const [items, setItems] = useState<Entry[]>([]),
    [draft, setDraft] = useState(empty),
    [error, setError] = useState(''),
    [success, setSuccess] = useState<React.ReactNode>(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refresh = async () => setItems(await api<Entry[]>('staff/content'));
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  async function run(fn: () => Promise<unknown>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await fn();
      await refresh();
      setSuccess(success);
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {error && (
        <div className="form-error" role="alert">
          <L en={error} />
        </div>
      )}
      {success && <Notice tone="success">{success}</Notice>}
      <Notice>
        Public content must not contain patient-identifying information. A clinician must review drafts before
        an administrator publishes them.
      </Notice>
      {has('cms.manage') && (
        <form
          className="surface live-panel stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('staff/content/save', draft);
              setDraft(empty);
            }, 'Draft saved.');
          }}
        >
          <h2>
            <L en={draft.id ? 'Edit draft' : 'New website content'} />
          </h2>
          <div className="form-grid">
            <Field label="Content type">
              <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                {['article', 'page', 'service', 'faq', 'landing'].map((k) => (
                  <option value={k} key={k}>
                    {tx(human(k))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="URL slug">
              <input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={80}
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Title">
            <input
              required
              maxLength={160}
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field label="Summary">
            <textarea
              rows={2}
              maxLength={400}
              value={draft.summary}
              onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            />
          </Field>
          <Field label="Content (plain text; paragraphs separated by blank lines)">
            <textarea
              required
              rows={8}
              maxLength={20000}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
          </Field>
          <div className="form-grid">
            <Field label="SEO title">
              <input
                maxLength={100}
                value={draft.seoTitle}
                onChange={(e) => setDraft({ ...draft, seoTitle: e.target.value })}
              />
            </Field>
            <Field label="SEO description">
              <textarea
                rows={2}
                maxLength={200}
                value={draft.seoDescription}
                onChange={(e) => setDraft({ ...draft, seoDescription: e.target.value })}
              />
            </Field>
          </div>
          <div className="live-actions">
            <Button type="submit" disabled={busy}>
              Save draft
            </Button>
            <Button variant="secondary" onClick={() => setDraft(empty)}>
              Clear
            </Button>
          </div>
        </form>
      )}
      <section className="surface live-panel stack">
        <h2>
          <L en={'Content workflow'} />
        </h2>
        {items.length === 0 && (
          <p>
            <L en={'No content entries yet.'} />
          </p>
        )}
        {items.map((item) => {
          const transition = (status: string) =>
            void run(
              () => api('staff/content/transition', { id: item.id, status }),
              `Content moved to ${human(status)}.`,
            );
          return (
            <article className="surface live-panel stack" key={item.id}>
              <div className="live-card-head">
                <div>
                  <h3>{item.title}</h3>
                  <p>
                    <L en={human(item.kind)} /> · /{item.slug}
                  </p>
                </div>
                <Badge>{human(item.status)}</Badge>
              </div>
              <details>
                <summary>
                  <L en={'Read content'} />
                </summary>
                <p>{item.summary}</p>
                <p className="live-content-body">{item.body}</p>
              </details>
              <div className="live-actions">
                {item.status === 'draft' && has('cms.manage') && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setDraft({
                          id: item.id,
                          kind: item.kind,
                          slug: item.slug,
                          title: item.title,
                          summary: item.summary || '',
                          body: item.body || '',
                          seoTitle: item.seo_title || '',
                          seoDescription: item.seo_description || '',
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button disabled={busy} onClick={() => transition('medical_review')}>
                      Submit for review
                    </Button>
                  </>
                )}
                {item.status === 'medical_review' && has('cms.review') && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (confirm(tx('Approve this medical content for public publication?')))
                          transition('approved');
                      }}
                    >
                      Approve content
                    </Button>
                    <Button disabled={busy} variant="secondary" onClick={() => transition('draft')}>
                      Return to draft
                    </Button>
                  </>
                )}
                {item.status === 'approved' && has('cms.publish') && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      if (confirm(tx('Publish this approved content publicly?'))) transition('published');
                    }}
                  >
                    Publish
                  </Button>
                )}
                {item.status === 'published' && has('cms.publish') && (
                  <Button disabled={busy} variant="secondary" onClick={() => transition('archived')}>
                    Archive
                  </Button>
                )}
                {item.status === 'archived' && has('cms.manage') && (
                  <Button disabled={busy} variant="secondary" onClick={() => transition('draft')}>
                    Restore draft
                  </Button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
type Config = {
  settings: { bookingEnabled: boolean; onlineEnabled: boolean } | null;
  doctors: { id: string; name: string; feePaise: number; published: boolean; specialty: string }[];
  schedules: {
    id: string;
    doctorId: string;
    weekday: number;
    start: string;
    end: string;
    minutes: number;
    active: boolean;
  }[];
};
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function LiveAdminSettings() {
  const tx = useT();
  const [data, setData] = useState<Config | null>(null),
    [booking, setBooking] = useState(false),
    [online, setOnline] = useState(false),
    [doctor, setDoctor] = useState(''),
    [fee, setFee] = useState(''),
    [published, setPublished] = useState(false),
    [weekday, setWeekday] = useState(1),
    [start, setStart] = useState('09:00'),
    [end, setEnd] = useState('13:00'),
    [minutes, setMinutes] = useState(30),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState<React.ReactNode>('');
  const lock = useRef(false);
  async function refresh() {
    const c = await api<Config>('staff/admin-config');
    setData(c);
    setBooking(c.settings?.bookingEnabled || false);
    setOnline(c.settings?.onlineEnabled || false);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  async function run(fn: () => Promise<unknown>, msg: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await fn();
      await refresh();
      setSuccess(typeof result === 'number' ? <T en="{0} slots generated." values={[result]} /> : msg);
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function selectDoctor(id: string) {
    setDoctor(id);
    const d = data?.doctors.find((x) => x.id === id);
    setFee(d ? String(d.feePaise / 100) : '');
    setPublished(d?.published || false);
  }
  return (
    <div className="stack">
      {error && (
        <div role="alert" className="form-error">
          <L en={error} />
        </div>
      )}
      {success && <Notice tone="success">{success}</Notice>}
      {data && (
        <>
          <section className="surface live-panel stack">
            <h2>
              <L en={'Booking controls'} />
            </h2>
            <Notice>
              Enable only after the hospital notice, actual doctor profiles, SMS and payment configuration
              have been verified.
            </Notice>
            <label className="check-field">
              <T
                en={'{0} Enable online appointment booking'}
                values={[
                  <input
                    key="v0"
                    type="checkbox"
                    checked={booking}
                    onChange={(e) => setBooking(e.target.checked)}
                  />,
                ]}
              />
            </label>
            <label className="check-field">
              <T
                en={'{0} Enable online Razorpay payments'}
                values={[
                  <input
                    key="v0"
                    type="checkbox"
                    checked={online}
                    onChange={(e) => setOnline(e.target.checked)}
                  />,
                ]}
              />
            </label>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() => api('staff/settings', { booking, online }), 'Booking settings saved.')
              }
            >
              Save settings
            </Button>
          </section>
          <section className="surface live-panel stack">
            <h2>
              <L en={'Doctor settings & weekly schedules'} />
            </h2>
            <Field label="Doctor">
              <select value={doctor} onChange={(e) => selectDoctor(e.target.value)}>
                <option value="">{tx('Select doctor')}</option>
                {data.doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {tx(String(d.name))} · {rupees(d.feePaise)}
                  </option>
                ))}
              </select>
            </Field>
            {doctor && (
              <>
                <Field label="Consultation fee (INR)">
                  <input
                    type="number"
                    min="0"
                    max="100000"
                    step="0.01"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                </Field>
                <label className="check-field">
                  <T
                    en={'{0} Publish verified doctor in booking directory'}
                    values={[
                      <input
                        key="v0"
                        type="checkbox"
                        checked={published}
                        onChange={(e) => setPublished(e.target.checked)}
                      />,
                    ]}
                  />
                </label>
                <Button
                  disabled={busy || fee === '' || Number(fee) < 0 || !Number.isFinite(Number(fee))}
                  onClick={() =>
                    void run(
                      () =>
                        api('staff/doctor-settings', {
                          id: doctor,
                          feePaise: Math.round(Number(fee) * 100),
                          published,
                        }),
                      'Doctor settings saved.',
                    )
                  }
                >
                  Save doctor settings
                </Button>
                <h3>
                  <L en={'Add weekly availability'} />
                </h3>
                <div className="form-grid">
                  <Field label="Day">
                    <select value={weekday} onChange={(e) => setWeekday(+e.target.value)}>
                      {weekdays.map((d, i) => (
                        <option key={d} value={i}>
                          {tx(String(d))}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="From">
                    <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
                  </Field>
                  <Field label="To">
                    <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
                  </Field>
                  <Field label="Minutes per slot">
                    <input
                      type="number"
                      min={5}
                      max={180}
                      value={minutes}
                      onChange={(e) => setMinutes(+e.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  disabled={busy || !start || !end || start >= end || minutes < 5 || minutes > 180}
                  onClick={() =>
                    void run(
                      () => api('staff/schedule/add', { doctorId: doctor, weekday, start, end, minutes }),
                      'Weekly schedule added. Generate slots to make it available.',
                    )
                  }
                >
                  Add schedule
                </Button>
                <div className="stack">
                  {data.schedules
                    .filter((s) => s.doctorId === doctor)
                    .map((s) => (
                      <div className="live-card-head" key={s.id}>
                        <div>
                          <strong>
                            <L en={weekdays[s.weekday]} /> · {s.start.slice(0, 5)}–{s.end.slice(0, 5)}
                          </strong>
                          <p>
                            <T
                              en={'{0} minutes · {1}'}
                              values={[s.minutes, <L key="v1" en={s.active ? 'Active' : 'Inactive'} />]}
                            />
                          </p>
                        </div>
                        {s.active && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              if (confirm(tx('Disable future empty slots? Existing bookings will remain.')))
                                void run(
                                  () => api('staff/schedule/disable', { id: s.id }),
                                  'Schedule disabled. Existing bookings require review.',
                                );
                            }}
                          >
                            Disable
                          </Button>
                        )}
                      </div>
                    ))}
                </div>
              </>
            )}
            <h3>
              <L en={'Generate availability'} />
            </h3>
            <Button
              disabled={busy}
              onClick={() => void run(() => api('staff/generate', {}), 'Slots generated.')}
            >
              Generate next 31 days
            </Button>
            <Notice>
              Existing reservations are never overwritten. Changing slot duration on an existing schedule may
              require manual inventory reconciliation.
            </Notice>
          </section>
        </>
      )}
    </div>
  );
}
type RefundRow = {
  id: string;
  provider_payment_id: string;
  amount_paise: number;
  payment_status: string;
  reference: string;
  appointment_status: string;
  refund_id: string | null;
  provider_refund_id: string | null;
  refund_status: string | null;
  refund_amount_paise?: number | null;
  cancellation_deduction_paise?: number | null;
};
export function LiveRefunds() {
  const tx = useT();
  const [rows, setRows] = useState<RefundRow[]>([]),
    [reason, setReason] = useState<Record<string, string>>({}),
    [providerId, setProviderId] = useState<Record<string, string>>({}),
    [error, setError] = useState(''),
    [success, setSuccess] = useState<React.ReactNode>(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const refresh = async () => setRows(await api<RefundRow[]>('staff/refunds'));
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, []);
  async function run(task: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await task();
      setSuccess('Refund status checked. Review the result below.');
    } catch (e) {
      setError(message(e));
    } finally {
      await refresh().catch(() => {});
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="surface live-panel stack">
      <h2>
        <L en={'Payment reconciliation & refunds'} />
      </h2>
      <Notice>
        Only cancelled visits, late captures and duplicate captures are eligible here. Patient-requested
        policy refunds use the saved deduction and refund amount. Other reviewed refunds return the original
        payment amount. Uncertain requests are never blindly retried. Offline refunds need manual review.
      </Notice>
      {error && (
        <div role="alert" className="form-error">
          <L en={error} />
        </div>
      )}
      {success && <Notice tone="success">{success}</Notice>}
      {rows.length === 0 && (
        <p>
          <L en={'No refund or reconciliation records.'} />
        </p>
      )}
      {rows.map((r) => (
        <article className="surface live-panel stack" key={r.id}>
          <div className="live-card-head">
            <div>
              <strong className="break-ref">{r.reference}</strong>
              <p>
                {rupees(r.amount_paise)} · <L en={human(r.appointment_status)} />
              </p>
              <p className="break-ref">{r.provider_payment_id}</p>
            </div>
            <Badge>{human(r.refund_status || r.payment_status)}</Badge>
          </div>
          {!r.refund_id || r.refund_status === 'requested' ? (
            <>
              <Field label="Refund reason">
                <select
                  value={reason[r.id] || 'cancelled_visit'}
                  onChange={(e) => setReason((v) => ({ ...v, [r.id]: e.target.value }))}
                >
                  <option value="cancelled_visit">{tx('Cancelled visit')}</option>
                  <option value="late_capture">{tx('Late payment capture')}</option>
                  <option value="duplicate_capture">{tx('Duplicate capture')}</option>
                  <option value="other_review">{tx('Other reviewed reason')}</option>
                </select>
              </Field>
              <Button
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      tx('Approve a Razorpay refund of {0} to the original payment method?').replace(
                        '{0}',
                        rupees(r.refund_amount_paise ?? r.amount_paise),
                      ),
                    )
                  )
                    void run(() =>
                      api('staff/refunds/create', {
                        paymentId: r.id,
                        reason: reason[r.id] || 'cancelled_visit',
                      }),
                    );
                }}
              >
                <T
                  en={'Approve & request {0} refund'}
                  values={[rupees(r.refund_amount_paise ?? r.amount_paise)]}
                />
              </Button>
            </>
          ) : r.refund_status !== 'processed' ? (
            <>
              <Field label="Provider refund ID (optional, for manual reconciliation)">
                <input
                  placeholder={tx('rfnd_…')}
                  value={providerId[r.id] || r.provider_refund_id || ''}
                  readOnly={!!r.provider_refund_id}
                  onChange={(e) => setProviderId((v) => ({ ...v, [r.id]: e.target.value }))}
                />
              </Field>
              <Button
                disabled={busy}
                variant="secondary"
                onClick={() =>
                  void run(() =>
                    api('staff/refunds/check', {
                      refundId: r.refund_id,
                      providerId: providerId[r.id] || undefined,
                    }),
                  )
                }
              >
                Verify refund with Razorpay
              </Button>
            </>
          ) : (
            <p>
              <L en={'Refund verified as processed.'} />
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
