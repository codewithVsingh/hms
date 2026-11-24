'use client';
import { useEffect, useRef, useState } from 'react';
import { Brand, Button, Field, Notice, Badge, Icon, Empty, L } from '@hms/ui';
import { api, localDay, when, rupees, human, message } from './client';
import type { StaffContext } from '../../lib/server/supabase';
import { MoveAppointment, InvoiceButton } from './extended';
import { extendedNav } from '../../lib/extended-nav';
import { LiveContent, LiveAdminSettings, LiveRefunds } from './admin';
import type { Role } from '@hms/types';
type Appointment = {
  id: string;
  reference: string;
  patient: string | null;
  patientId: string | null;
  doctor: string;
  startsAt: string;
  status: string;
  feePaise: number | null;
  paymentStatus: string | null;
  paymentChoice: string | null;
  invoiceNumber: string | null;
};
type Patient = { id: string; name: string; mrn: string; birthDate: string | null };
type DuplicateMatch = Patient & {
  level: 'likely' | 'possible';
  phoneLast4: string | null;
  visits: number;
  lastVisit: string | null;
};
type Slot = { id: string; doctor: string; startsAt: string };
type Team = { display_name: string; active: boolean; roles: string[] };
type Audit = {
  action: string;
  resource_type: string;
  result: string;
  occurred_at: string;
  resource_id: string;
};
const navigation = [
  { id: 'dashboard', label: 'Overview', icon: 'grid', perms: [] },
  {
    id: 'appointments',
    label: 'Appointments & queue',
    icon: 'calendar',
    perms: ['appointments.read', 'appointments.assigned.read'],
  },
  {
    id: 'patients',
    label: 'Patients',
    icon: 'users',
    perms: ['patients.demographics.read', 'patients.assigned.read'],
  },
  {
    id: 'consultations',
    label: 'Consultation drafts',
    icon: 'stethoscope',
    perms: ['clinical.assigned.write'],
  },
  { id: 'billing', label: 'Billing & payments', icon: 'wallet', perms: ['billing.read'] },
  { id: 'staff', label: 'Team & roles', icon: 'shield', perms: ['users.manage'] },
  {
    id: 'content',
    label: 'Website content',
    icon: 'book',
    perms: ['cms.manage', 'cms.review', 'cms.publish'],
  },
  { id: 'audit', label: 'Audit log', icon: 'lock', perms: ['audit.read'] },
  { id: 'settings', label: 'Settings', icon: 'settings', perms: [] },
];
export function LiveWorkspace({
  context,
  role,
  section,
  websiteUrl,
}: {
  context: StaffContext;
  role: Role;
  section: string;
  websiteUrl: string;
}) {
  const has = (p: string) => context.permissions.includes(p);
  const nav = [...navigation, ...extendedNav.filter((n) => n.roles.includes(role))].filter(
    (n) => !n.perms.length || n.perms.some(has),
  );
  const mapped: Record<string, string> = {
    queue: 'appointments',
    finance: 'billing',
    payments: 'billing',
    roles: 'staff',
    doctors: 'staff',
    reports: 'dashboard',
    schedule: 'settings',
  };
  const current = mapped[section] || section;
  const allowed = nav.some((n) => n.id === current);
  const [date, setDate] = useState(localDay),
    [allDays, setAllDays] = useState(false),
    [rows, setRows] = useState<Appointment[]>([]),
    [patients, setPatients] = useState<Patient[]>([]),
    [slots, setSlots] = useState<Slot[]>([]),
    [team, setTeam] = useState<Team[]>([]),
    [audit, setAudit] = useState<Audit[]>([]),
    [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [selected, setSelected] = useState(''),
    [newName, setNewName] = useState(''),
    [newPhone, setNewPhone] = useState(''),
    [birth, setBirth] = useState(''),
    [consent, setConsent] = useState(false),
    [gender, setGender] = useState(''),
    // Possible existing records found before registering (migration 023), and the override reason.
    [matches, setMatches] = useState<DuplicateMatch[] | null>(null),
    [override, setOverride] = useState(''),
    [bookingPatient, setBookingPatient] = useState(''),
    [bookingSlot, setBookingSlot] = useState(''),
    [bookConsent, setBookConsent] = useState(false),
    [note, setNote] = useState(''),
    [version, setVersion] = useState(0),
    [loadedNote, setLoadedNote] = useState(''),
    [payMethods, setPayMethods] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(''),
    [loading, setLoading] = useState(true);
  const lock = useRef(false),
    request = useRef('');
  const canReadAppointments = ['appointments.read', 'appointments.assigned.read', 'billing.read'].some(has),
    canReadPatients = ['patients.demographics.read', 'patients.assigned.read'].some(has);
  async function load() {
    if (!allowed) return;
    const tasks: Promise<unknown>[] = [];
    if (canReadAppointments && ['dashboard', 'appointments', 'consultations', 'billing'].includes(current))
      tasks.push(api<Appointment[]>(`staff/appointments${allDays ? '' : `?date=${date}`}`).then(setRows));
    if (canReadPatients && ['patients', 'appointments'].includes(current))
      tasks.push(api<Patient[]>(`staff/patients?q=${encodeURIComponent(query)}`).then(setPatients));
    if (has('appointments.create') && current === 'appointments')
      tasks.push(api<Slot[]>(`staff/slots?date=${date}`).then(setSlots));
    if (current === 'staff') tasks.push(api<Team[]>('staff/team').then(setTeam));
    if (current === 'audit') tasks.push(api<Audit[]>('staff/audit').then(setAudit));
    await Promise.all(tasks);
  }
  useEffect(() => {
    setLoading(true);
    setError('');
    setRows([]);
    setSlots([]);
    setPatients([]);
    setBookingSlot('');
    void load()
      .catch((e) => setError(message(e)))
      .finally(() => setLoading(false));
  }, [current, date, allDays, query]);
  // Server patient search waits until typing pauses: one request (and one audit entry) per search,
  // not per keystroke. The on-screen appointment filter still uses `search` instantly.
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);
  async function run(task: () => Promise<void>, msg: string | (() => string)) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await task();
      setSuccess(typeof msg === 'function' ? msg() : msg);
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const change = (a: Appointment, status: string) =>
    void run(async () => {
      await api('staff/status', { id: a.id, status });
    }, 'Appointment updated.');
  const visible = rows.filter(
    (r) =>
      !search ||
      [r.patient, r.reference, r.doctor, r.status, r.invoiceNumber]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const filtered =
    current === 'consultations'
      ? visible.filter((r) => ['in_consultation', 'completed'].includes(r.status))
      : visible;
  const noteAppt = rows.find((r) => r.id === selected);
  const table = (
    <div className="surface live-table">
      <div className="live-table-head">
        <h3>{current === 'billing' ? 'Invoices & collections' : 'Appointment list'}</h3>
        <p>Showing {filtered.length} records, up to 200 from the selected view.</p>
      </div>
      {filtered.length === 0 ? (
        <Empty title="No records" description="Try another date or search." />
      ) : (
        <div className="live-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Appointment</th>
                <th>Patient / doctor</th>
                <th>
                  <L en="Time" />
                </th>
                <th>Status</th>
                {has('billing.read') && (
                  <th>
                    <L en="Payment" />
                  </th>
                )}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id}>
                  <td>
                    <strong className="break-ref">{a.reference}</strong>
                  </td>
                  <td>
                    {a.patient || 'Restricted'}
                    <small>{a.doctor}</small>
                  </td>
                  <td>{when(a.startsAt)}</td>
                  <td>
                    <Badge tone={a.status === 'confirmed' || a.status === 'completed' ? 'green' : 'neutral'}>
                      {human(a.status)}
                    </Badge>
                  </td>
                  {has('billing.read') && (
                    <td>
                      {a.feePaise !== null ? rupees(a.feePaise) : '—'}
                      <small>{a.paymentStatus && human(a.paymentStatus)}</small>
                      <small className="break-ref">{a.invoiceNumber}</small>
                    </td>
                  )}
                  <td>
                    <div className="live-actions">
                      {current !== 'billing' &&
                        (has('appointments.create') || has('refunds.approve')) &&
                        ['confirmed', 'held'].includes(a.status) && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              if (
                                confirm(
                                  'Cancel this future visit? Any received payment must be reconciled separately.',
                                )
                              )
                                void run(
                                  () => api('staff/cancel', { id: a.id }).then(() => {}),
                                  'Appointment cancelled. Check finance for any refund.',
                                );
                            }}
                          >
                            Cancel visit
                          </Button>
                        )}
                      {current !== 'billing' && has('appointments.checkin') && a.status === 'confirmed' && (
                        <>
                          <Button disabled={busy} onClick={() => change(a, 'checked_in')}>
                            Check in
                          </Button>
                          <Button
                            disabled={busy}
                            variant="secondary"
                            onClick={() => {
                              if (confirm('Mark this visit as no-show?')) change(a, 'no_show');
                            }}
                          >
                            No-show
                          </Button>
                        </>
                      )}
                      {current !== 'billing' &&
                        has('clinical.assigned.write') &&
                        a.status === 'checked_in' && (
                          <Button disabled={busy} onClick={() => change(a, 'in_consultation')}>
                            Start visit
                          </Button>
                        )}
                      {current !== 'billing' &&
                        has('clinical.assigned.write') &&
                        ['in_consultation', 'completed'].includes(a.status) && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                const d = await api<{ note: string; version: number }>(
                                  `staff/clinical?id=${a.id}`,
                                );
                                setSelected(a.id);
                                setNote(d.note);
                                setVersion(d.version);
                                setLoadedNote(a.id);
                              }, 'Clinical draft loaded.')
                            }
                          >
                            Open notes
                          </Button>
                        )}
                      {current !== 'billing' &&
                        has('clinical.assigned.write') &&
                        a.status === 'in_consultation' && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => {
                              if (confirm('Complete this visit? Draft notes become read-only.'))
                                change(a, 'completed');
                            }}
                          >
                            Complete visit
                          </Button>
                        )}
                      {has('appointments.create') && a.status === 'confirmed' && (
                        <MoveAppointment id={a.id} onDone={load} />
                      )}{' '}
                      {has('billing.read') && <InvoiceButton id={a.id} />}{' '}
                      {has('payments.collect') &&
                        a.paymentChoice === 'hospital' &&
                        a.paymentStatus === 'unpaid' &&
                        !!a.feePaise &&
                        ['confirmed', 'checked_in', 'in_consultation', 'completed'].includes(a.status) && (
                          <>
                            <select
                              aria-label={`Payment method ${a.reference}`}
                              value={payMethods[a.id] || 'cash'}
                              onChange={(e) => setPayMethods((p) => ({ ...p, [a.id]: e.target.value }))}
                            >
                              <option value="cash">Cash</option>
                              <option value="upi_offline">UPI received</option>
                              <option value="card_offline">Card received</option>
                              <option value="bank_transfer">Bank transfer</option>
                            </select>
                            <Button
                              disabled={busy}
                              onClick={() => {
                                if (confirm('Confirm that the full amount has actually been received?'))
                                  void run(async () => {
                                    await api('staff/collect', {
                                      id: a.id,
                                      method: payMethods[a.id] || 'cash',
                                    });
                                  }, 'Payment recorded.');
                              }}
                            >
                              Record payment
                            </Button>
                          </>
                        )}
                      {a.paymentStatus === 'needs_review' && (
                        <span className="text-sm">Manual payment review required</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
  return (
    <div className="live-shell">
      <aside className="live-sidebar">
        <Brand
          name={process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'Hospital'}
          href={websiteUrl}
          sub="HMS workspace"
        />
        <p className="eyebrow">{human(role)} workspace</p>
        <nav aria-label="Workspace navigation">
          {nav.map((n) => (
            <a key={n.id} className={current === n.id ? 'active' : ''} href={`/${role}/${n.id}`}>
              <Icon name={n.icon} />
              <L en={n.label} />
            </a>
          ))}
        </nav>
        <div className="live-switch">
          {context.roles.includes('doctor') && role !== 'doctor' && <a href="/doctor">Doctor workspace</a>}
          {context.roles.includes('super_admin') && role !== 'admin' && <a href="/admin">Admin workspace</a>}
          {context.roles.some((r) => ['receptionist', 'billing', 'nurse', 'content_manager'].includes(r)) &&
            role !== 'staff' && <a href="/staff">Staff workspace</a>}
        </div>
        <Button
          variant="secondary"
          icon="logout"
          onClick={async () => {
            try {
              await api('auth/logout', {});
              window.location.replace('/login');
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          <L en="Sign out" />
        </Button>
      </aside>
      <main id="main" className="live-main">
        <header className="live-card-head live-top">
          <div>
            <span className="eyebrow">Secure operations</span>
            <h1>{nav.find((n) => n.id === current)?.label || 'Module not available'}</h1>
            <p>Welcome, {context.name}</p>
          </div>
          <Badge tone="teal">MFA verified</Badge>
        </header>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        {success && <Notice tone="success">{success}</Notice>}
        {!allowed ? (
          <Notice tone="warning">
            This module is not yet integrated or your role does not permit access. Use the available
            navigation.
          </Notice>
        ) : (
          <>
            {['dashboard', 'appointments', 'consultations', 'billing'].includes(current) &&
              canReadAppointments && (
                <div className="surface live-filter">
                  <Field label="Visit date">
                    <input
                      type="date"
                      value={date}
                      disabled={allDays}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <label className="check-field">
                    <input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} />{' '}
                    Recent records (all dates)
                  </label>
                  <Field label="Filter records">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Reference, doctor or patient"
                    />
                  </Field>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void run(async () => {}, 'Records refreshed.')}
                  >
                    Refresh
                  </Button>
                </div>
              )}
            {loading && <p role="status">Loading records…</p>}
            {current === 'dashboard' && (
              <>
                <div className="live-kpis">
                  {[
                    { label: 'Visits shown', value: rows.length },
                    { label: 'Confirmed', value: rows.filter((a) => a.status === 'confirmed').length },
                    {
                      label: 'Checked in / in consultation',
                      value: rows.filter((a) => ['checked_in', 'in_consultation'].includes(a.status)).length,
                    },
                    { label: 'Completed', value: rows.filter((a) => a.status === 'completed').length },
                  ].map((k) => (
                    <div className="surface live-kpi" key={k.label}>
                      <p>{k.label}</p>
                      <strong>{k.value}</strong>
                    </div>
                  ))}
                </div>
                {!canReadAppointments && (
                  <Notice>No appointment reporting permissions are assigned to this role.</Notice>
                )}
              </>
            )}
            {['dashboard', 'appointments', 'consultations', 'billing'].includes(current) &&
              canReadAppointments &&
              table}
            {current === 'appointments' && has('appointments.create') && (
              <section className="surface live-panel stack">
                <h2>Book at reception</h2>
                <p>
                  Use an existing registered patient, and choose an available time on {date}. Online and
                  reception bookings share the same slot inventory.
                </p>
                <div className="form-grid">
                  <Field label="Registered patient">
                    <select
                      value={bookingPatient}
                      onChange={(e) => {
                        setBookingPatient(e.target.value);
                        request.current = '';
                      }}
                    >
                      <option value="">Choose patient</option>
                      {patients.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.mrn}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Available slot">
                    <select
                      value={bookingSlot}
                      onChange={(e) => {
                        setBookingSlot(e.target.value);
                        request.current = '';
                      }}
                    >
                      <option value="">Choose slot</option>
                      {slots.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.doctor} · {when(s.startsAt)}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={bookConsent}
                    onChange={(e) => setBookConsent(e.target.checked)}
                  />{' '}
                  Patient has acknowledged the approved booking notice.
                </label>
                <Button
                  disabled={busy || !bookingPatient || !bookingSlot || !bookConsent || allDays}
                  onClick={() =>
                    void run(async () => {
                      if (!request.current) request.current = crypto.randomUUID();
                      await api('staff/book', {
                        slotId: bookingSlot,
                        patientId: bookingPatient,
                        requestId: request.current,
                        consent: true,
                      });
                      request.current = '';
                      setBookingSlot('');
                      setBookConsent(false);
                    }, 'Appointment confirmed; payment due at hospital.')
                  }
                >
                  Confirm reception booking
                </Button>
              </section>
            )}
            {current === 'patients' && (
              <>
                <section className="surface live-panel stack">
                  <h2>Patient directory</h2>
                  <Field label="Search by name, UHID, mobile or booking reference">
                    <input value={search} onChange={(e) => setSearch(e.target.value)} />
                  </Field>
                  {patients.length === 0 ? (
                    <Empty
                      title="No patients found"
                      description="Search or register a patient if authorized."
                    />
                  ) : (
                    <div className="live-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              <L en="Patient" />
                            </th>
                            <th>MRN</th>
                            <th>Date of birth</th>
                          </tr>
                        </thead>
                        <tbody>
                          {patients.map((p) => (
                            <tr key={p.id}>
                              <td>{p.name}</td>
                              <td className="break-ref">{p.mrn}</td>
                              <td>{p.birthDate || 'Not recorded'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                {has('patients.register') && (
                  <form
                    className="surface live-panel stack"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const details = {
                        name: newName,
                        phone: newPhone || undefined,
                        birthDate: birth || undefined,
                        gender: gender || undefined,
                      };
                      let registered = false;
                      void run(
                        async () => {
                          // Check for look-alikes first; registering anyway needs a recorded reason.
                          if (matches === null) {
                            const found = await api<DuplicateMatch[]>('staff/register/check', details);
                            if (found.length) {
                              setMatches(found);
                              return;
                            }
                          }
                          await api('staff/register', {
                            ...details,
                            consent,
                            override: matches?.length ? override.trim() : undefined,
                          });
                          registered = true;
                          setNewName('');
                          setNewPhone('');
                          setBirth('');
                          setGender('');
                          setConsent(false);
                          setMatches(null);
                          setOverride('');
                        },
                        () => (registered ? 'Patient registered.' : ''),
                      );
                    }}
                  >
                    <h2>Register patient</h2>
                    <Notice>
                      Search for an existing record before creating a new MRN. Registration does not verify
                      the supplied phone number.
                    </Notice>
                    <div className="form-grid">
                      <Field label="Full name">
                        <input
                          required
                          maxLength={100}
                          value={newName}
                          onChange={(e) => {
                            setNewName(e.target.value);
                            setMatches(null);
                          }}
                        />
                      </Field>
                      <Field label="Phone (optional, +91…)">
                        <input
                          type="tel"
                          value={newPhone}
                          onChange={(e) => {
                            setNewPhone(e.target.value);
                            setMatches(null);
                          }}
                        />
                      </Field>
                      <Field label="Date of birth (optional)">
                        <input
                          type="date"
                          max={localDay()}
                          value={birth}
                          onChange={(e) => {
                            setBirth(e.target.value);
                            setMatches(null);
                          }}
                        />
                      </Field>
                      <Field label="Gender (optional)">
                        <select
                          value={gender}
                          onChange={(e) => {
                            setGender(e.target.value);
                            setMatches(null);
                          }}
                        >
                          <option value="">Not recorded</option>
                          <option value="female">Female</option>
                          <option value="male">Male</option>
                          <option value="other">Other</option>
                        </select>
                      </Field>
                    </div>
                    {matches && matches.length > 0 && (
                      <div className="stack" role="group" aria-label="Possible existing records">
                        <Notice tone="warning">
                          This patient may already be registered. Check the records below with the patient
                          before creating a new UHID.
                        </Notice>
                        {matches.map((m) => (
                          <div className="ops-item live-card-head" key={m.id}>
                            <div>
                              <strong>
                                {m.name} · <span className="break-ref">{m.mrn}</span>
                              </strong>
                              <p>
                                {m.level === 'likely' ? 'Likely the same person' : 'Possibly the same person'}{' '}
                                · DOB {m.birthDate || 'not recorded'} · mobile ending {m.phoneLast4 || '—'} ·{' '}
                                {m.visits} visit{m.visits === 1 ? '' : 's'}
                                {m.lastVisit ? `, last ${when(m.lastVisit)}` : ''}
                              </p>
                            </div>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setSearch(m.mrn);
                                setMatches(null);
                                setNewName('');
                                setNewPhone('');
                                setBirth('');
                                setGender('');
                                setConsent(false);
                              }}
                            >
                              Use this patient
                            </Button>
                          </div>
                        ))}
                        <Field label="Reason for registering a new patient anyway">
                          <input
                            maxLength={300}
                            placeholder="e.g. Family member sharing the same mobile number"
                            value={override}
                            onChange={(e) => setOverride(e.target.value)}
                          />
                        </Field>
                      </div>
                    )}
                    <label className="check-field">
                      <input
                        type="checkbox"
                        checked={consent}
                        onChange={(e) => setConsent(e.target.checked)}
                      />{' '}
                      Patient or authorized guardian has acknowledged the registration notice.
                    </label>
                    <Button
                      type="submit"
                      disabled={
                        busy ||
                        !consent ||
                        newName.trim().length < 2 ||
                        (!!matches?.length && override.trim().length < 5)
                      }
                    >
                      {matches?.length ? 'Register new patient anyway' : 'Register patient'}
                    </Button>
                  </form>
                )}
              </>
            )}
            {selected && loadedNote === selected && noteAppt && has('clinical.assigned.write') && (
              <section className="surface live-panel stack">
                <h2>Consultation draft</h2>
                <p>
                  {noteAppt.patient} · {noteAppt.reference} · version {version}
                </p>
                <Notice>
                  Draft notes are versioned. This is not a signed prescription or a finalized medical record.
                </Notice>
                <Field label="Clinical note">
                  <textarea
                    rows={7}
                    maxLength={12000}
                    value={note}
                    disabled={noteAppt.status !== 'in_consultation'}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <Button
                  disabled={busy || noteAppt.status !== 'in_consultation' || !note.trim()}
                  onClick={() =>
                    void run(async () => {
                      const d = await api<{ note: string; version: number }>('staff/clinical', {
                        id: selected,
                        note,
                      });
                      setVersion(d.version);
                    }, 'Draft saved as a new version.')
                  }
                >
                  Save draft
                </Button>
              </section>
            )}
            {current === 'staff' && (
              <section className="surface live-panel stack">
                <h2>Branch team</h2>
                <Notice>
                  Membership changes and invitations are currently provisioned by the administrator in
                  Supabase. This screen reads the actual assignments.
                </Notice>
                {team.map((t, i) => (
                  <div className="live-card-head" key={`${t.display_name}-${i}`}>
                    <div>
                      <strong>{t.display_name}</strong>
                      <p>{t.roles.map(human).join(', ')}</p>
                    </div>
                    <Badge tone={t.active ? 'green' : 'neutral'}>{t.active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                ))}
              </section>
            )}
            {current === 'audit' && (
              <section className="surface live-panel">
                <h2>Recent audit events</h2>
                <div className="live-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Action</th>
                        <th>Resource</th>
                        <th>Result</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((a, i) => (
                        <tr key={`${a.resource_id}-${i}`}>
                          <td>{a.action}</td>
                          <td>{a.resource_type}</td>
                          <td>{a.result}</td>
                          <td>{when(a.occurred_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            {current === 'billing' && has('refunds.approve') && <LiveRefunds />}
            {current === 'content' && <LiveContent permissions={context.permissions} />}{' '}
            {current === 'settings' && has('settings.manage') && <LiveAdminSettings />}
            {current === 'settings' && (
              <section className="surface live-panel stack">
                <h2>My access</h2>
                <p>{context.roles.map(human).join(', ')}</p>
                <div className="live-actions">
                  {context.permissions.map((p) => (
                    <Badge key={p}>{p}</Badge>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
