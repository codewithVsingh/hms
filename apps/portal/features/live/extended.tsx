'use client';
import { useEffect, useState, useRef } from 'react';
import { Brand, Button, Field, Notice, Badge, Icon, L } from '@hms/ui';
import { api, localDay, when, rupees, human, message } from './client';
import { PatientTimeline, PrescriptionRegister, CancellationPolicySettings } from './patient-history';
import { v2 } from './v2-client';
import type { StaffContext } from '../../lib/server/supabase';
import type { Role } from '@hms/types';
import { extendedNav } from '../../lib/extended-nav';
import { RxCorrections, RxStatusBadges, RxWithdrawals } from './prescription-corrections';
type Item = { medicine: string; dose: string; frequency: string; duration: string; instructions: string };
type Rx = {
  id: string;
  version: number;
  status: string;
  issuedAt: string | null;
  doctor: string;
  registration: string;
  patient: string;
  mrn: string;
  followUp: string | null;
  released: boolean;
  items: Item[];
  replaces?: { version: number; issuedAt: string } | null;
  amendUntil?: string | null;
  mine?: boolean;
  withdrawalPending?: boolean;
};
type Visit = {
  reference: string;
  status: string;
  created_at: string;
  note: string;
  vitals: Record<string, number>[];
  diagnoses: string[];
};
type Care = {
  patient: string;
  mrn: string;
  status: string;
  history: { kind: string; detail: string; recorded_at: string }[];
  visits: Visit[];
  prescriptions: Rx[];
};
type Apt = {
  id: string;
  reference: string;
  patient: string;
  doctor: string;
  status: string;
  startsAt: string;
};
type Doc = {
  id: string;
  original_name: string;
  document_type: string;
  mime_type: string;
  byte_size: number;
  created_at: string;
  patient_visible: boolean;
};
type Invoice = {
  number: string;
  reference: string;
  status: string;
  issuedAt: string;
  totalPaise: number;
  items: { description: string; quantity: number; unitPaise: number; totalPaise: number }[];
};
const blank = (): Item => ({ medicine: '', dose: '', frequency: '', duration: '', instructions: '' });
const now = '2026-11-24T05:30:00Z';
const sampleRx: Rx = {
  id: 'DEMO-RX-01',
  version: 1,
  status: 'signed',
  issuedAt: now,
  doctor: 'Dr. Ananya Sharma',
  registration: 'DEMO ONLY',
  patient: 'Sample Patient B',
  mrn: 'MRN-00102',
  followUp: '2026-12-01',
  released: true,
  items: [
    {
      medicine: 'Example medicine (not medical advice)',
      dose: 'Sample only',
      frequency: 'Sample only',
      duration: 'Sample only',
      instructions: 'Fictional record for design review',
    },
  ],
  // Demo: issued by the demo doctor, amendment window open for two more days.
  mine: true,
  amendUntil: new Date(Date.now() + 2 * 86400000).toISOString(),
};
const sampleCare: Care = {
  patient: 'Sample Patient B',
  mrn: 'MRN-00102',
  status: 'in_consultation',
  history: [
    { kind: 'allergy', detail: 'Demo allergy entry', recorded_at: now },
    { kind: 'history', detail: 'Previous visit recorded for preview', recorded_at: now },
  ],
  visits: [
    {
      reference: 'APT-1002',
      status: 'in_consultation',
      created_at: now,
      note: 'Fictional consultation note',
      vitals: [{ pulse: 76, systolic: 120, diastolic: 80, spo2: 98 }],
      diagnoses: ['Demo observation'],
    },
  ],
  prescriptions: [sampleRx],
};
const sampleApts: Apt[] = [
  {
    id: 'demo-1',
    reference: 'APT-1002',
    patient: 'Sample Patient B',
    doctor: 'Dr. Ananya Sharma',
    status: 'in_consultation',
    startsAt: now,
  },
  {
    id: 'demo-2',
    reference: 'APT-1003',
    patient: 'Sample Patient C',
    doctor: 'Dr. Ananya Sharma',
    status: 'checked_in',
    startsAt: now,
  },
];
function useAction() {
  const [busy, setBusy] = useState(false),
    [msg, setMsg] = useState(''),
    [error, setError] = useState('');
  const lock = useRef(false);
  // `success` may be a function so the message can use values produced by the task.
  const run = async (task: () => Promise<void>, success: string | (() => string) = '') => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMsg('');
    try {
      await task();
      setMsg(typeof success === 'function' ? success() : success);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  return {
    busy,
    run,
    feedback: (
      <>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        {msg && <Notice tone="success">{msg}</Notice>}
      </>
    ),
  };
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface ops-panel stack">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function PrintPrescription({ rx, demo = false }: { rx: Rx; demo?: boolean }) {
  return (
    <div className="ops-print">
      <span className="eyebrow">
        {demo ? 'Fictional sample · not for medical use' : 'Clinical record · clinician attestation'}
      </span>
      <h2>{process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'Aarogya Care'}</h2>
      <p>
        Prescription · version {rx.version} · {rx.id}
      </p>
      {rx.replaces && (
        <p>
          <strong>
            Replaces version {rx.replaces.version} issued on {when(rx.replaces.issuedAt)}. Earlier copies are
            no longer valid.
          </strong>
        </p>
      )}
      {rx.status !== 'signed' && rx.issuedAt && (
        <p>
          <strong>
            {rx.status === 'void' ? 'WITHDRAWN' : 'SUPERSEDED'}: this version is not valid. Do not dispense
            from it.
          </strong>
        </p>
      )}
      <h3>{rx.doctor}</h3>
      <p>Medical registration: {rx.registration}</p>
      <p>
        {rx.patient} · {rx.mrn} · {rx.issuedAt ? when(rx.issuedAt) : 'Draft'}
      </p>
      <table>
        <thead>
          <tr>
            <th>Medicine</th>
            <th>Dose</th>
            <th>Frequency</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          {rx.items.map((r, i) => (
            <tr key={i}>
              <td>
                {r.medicine}
                <small style={{ display: 'block' }}>{r.instructions}</small>
              </td>
              <td>{r.dose}</td>
              <td>{r.frequency}</td>
              <td>{r.duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Follow-up: {rx.followUp || 'Not scheduled'}</p>
      <p className="ops-muted">
        Authenticated clinician attestation; not a certified digital signature. Follow the hospital's approved
        signing and issuance procedure.
      </p>
      <Button variant="secondary" onClick={() => window.print()}>
        Print / save as PDF
      </Button>
    </div>
  );
}
export function InvoiceButton({ id, demo = false }: { id: string; demo?: boolean }) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const a = useAction();
  return (
    <div className="stack">
      <Button
        variant="secondary"
        disabled={a.busy}
        onClick={() =>
          invoice
            ? setInvoice(null)
            : void a.run(async () =>
                setInvoice(
                  demo
                    ? {
                        number: 'DEMO-INV-01',
                        reference: 'APT-1002',
                        status: 'settled',
                        issuedAt: now,
                        totalPaise: 50000,
                        items: [
                          { description: 'Consultation', quantity: 1, unitPaise: 50000, totalPaise: 50000 },
                        ],
                      }
                    : await v2<Invoice>('invoice?id=' + id),
                ),
              )
        }
      >
        {invoice ? 'Close invoice' : 'View invoice'}
      </Button>
      {a.feedback}
      {invoice && (
        <div className="ops-print">
          <h2>{process.env.NEXT_PUBLIC_HOSPITAL_NAME || 'Aarogya Care'}</h2>
          <p>
            {demo ? 'Sample invoice' : 'Invoice'} · {invoice.number}
          </p>
          <p>
            {invoice.reference} · {human(invoice.status)} · {when(invoice.issuedAt)}
          </p>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((r, i) => (
                <tr key={i}>
                  <td>{r.description}</td>
                  <td>{r.quantity}</td>
                  <td>{rupees(r.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Total: {rupees(invoice.totalPaise)}</h3>
          <Button variant="secondary" onClick={() => window.print()}>
            Print / save as PDF
          </Button>
        </div>
      )}
    </div>
  );
}
export function MoveAppointment({
  id,
  onDone,
  demo = false,
}: {
  id: string;
  onDone: () => Promise<void>;
  demo?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [date, setDate] = useState(localDay),
    [slots, setSlots] = useState<{ id: string; startsAt: string }[]>([]),
    [slot, setSlot] = useState('');
  const a = useAction();
  return (
    <div className="stack">
      <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
        {open ? 'Close rescheduling' : 'Reschedule'}
      </Button>
      {open && (
        <div className="ops-item stack">
          <Field label="New date">
            <input
              type="date"
              min={localDay()}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSlots([]);
                setSlot('');
              }}
            />
          </Field>
          <Button
            variant="secondary"
            disabled={a.busy}
            onClick={() =>
              void a.run(async () => {
                setSlot('');
                setSlots(
                  demo
                    ? [{ id: 'demo-slot', startsAt: date + 'T06:00:00Z' }]
                    : await v2(`move-slots?id=${id}&date=${date}`),
                );
              }, 'Available times loaded.')
            }
          >
            Find times
          </Button>
          <Field label="Same doctor, new time">
            <select value={slot} onChange={(e) => setSlot(e.target.value)}>
              <option value="">Select time</option>
              {slots.map((s) => (
                <option key={s.id} value={s.id}>
                  {when(s.startsAt)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            disabled={a.busy || !slot}
            onClick={() =>
              void a.run(
                async () => {
                  if (!demo) {
                    await v2('reschedule', { id, slotId: slot });
                    await onDone();
                  }
                  setSlot('');
                  setSlots([]);
                },
                demo
                  ? 'Demo time selected; no booking changed.'
                  : 'Appointment moved. Existing invoice retained.',
              )
            }
          >
            Confirm new time
          </Button>
          {a.feedback}
        </div>
      )}
    </div>
  );
}
function Documents({
  appointment,
  demo = false,
  patient = false,
}: {
  appointment?: string;
  demo?: boolean;
  patient?: boolean;
}) {
  const [docs, setDocs] = useState<Doc[]>([]),
    [file, setFile] = useState<File | null>(null),
    [type, setType] = useState('report'),
    [release, setRelease] = useState(false),
    [err, setErr] = useState('');
  const a = useAction();
  const load = async () =>
    setDocs(
      demo
        ? [
            {
              id: 'demo',
              original_name: 'Example report.pdf',
              document_type: 'report',
              mime_type: 'application/pdf',
              byte_size: 20480,
              created_at: now,
              patient_visible: true,
            },
          ]
        : await v2('documents' + (appointment ? '?appointment=' + appointment : '')),
    );
  useEffect(() => {
    setDocs([]);
    if (appointment || patient) void load().catch((e) => setErr(message(e)));
  }, [appointment, patient, demo]);
  return (
    <Panel title="Medical documents">
      <p>
        Private, access-controlled patient documents. PDF, PNG or JPG, up to 4 MB; malware screening required.
      </p>
      {err && <Notice tone="warning">{err}</Notice>}
      {docs.map((d) => (
        <div className="ops-item" key={d.id}>
          <strong>{d.original_name}</strong>
          <p>
            {human(d.document_type)} · {Math.ceil(d.byte_size / 1024)} KB
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              void a.run(async () => {
                if (demo) throw new Error('Sample file only; no clinical document attached.');
                const result = await v2<{ url: string }>('documents/download?id=' + d.id);
                window.location.assign(result.url);
              })
            }
          >
            Download securely
          </Button>
        </div>
      ))}
      {!patient && appointment && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(
              async () => {
                if (!file) throw new Error('Choose a file');
                if (!demo) {
                  const data = new FormData();
                  data.set('appointment', appointment);
                  data.set('file', file);
                  data.set('type', type);
                  data.set('release', String(release));
                  await v2('documents/upload', data);
                  await load();
                }
                setFile(null);
              },
              demo ? 'Preview only; file was not uploaded.' : 'Scanned document saved.',
            );
          }}
        >
          <Field label="Document category">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {['report', 'image', 'referral', 'other'].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Select report">
            <input
              type="file"
              accept="application/pdf,image/png,image/jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <label className="check-field">
            <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} /> Release
            document to patient
          </label>
          <Button type="submit" disabled={!file || a.busy}>
            Scan and upload
          </Button>
        </form>
      )}
      {a.feedback}
    </Panel>
  );
}
function CarePanel({ demo }: { demo: boolean }) {
  const [apts, setApts] = useState<Apt[]>(demo ? sampleApts : []),
    [id, setId] = useState(demo ? 'demo-1' : ''),
    [care, setCare] = useState<Care | null>(demo ? sampleCare : null),
    [kind, setKind] = useState('diagnosis'),
    [detail, setDetail] = useState(''),
    [vitals, setVitals] = useState<Record<string, string>>({}),
    [items, setItems] = useState<Item[]>([blank()]),
    [follow, setFollow] = useState(''),
    [release, setRelease] = useState(false),
    [attest, setAttest] = useState(false),
    [printed, setPrinted] = useState<Rx | null>(null),
    [err, setErr] = useState('');
  const a = useAction();
  const load = async () => {
    if (!demo && id) setCare(await v2('care?id=' + id));
  };
  useEffect(() => {
    if (!demo)
      api<Apt[]>('staff/appointments')
        .then((r) => setApts(r.filter((x) => ['in_consultation', 'completed'].includes(x.status))))
        .catch((e) => setErr(message(e)));
  }, [demo]);
  useEffect(() => {
    setPrinted(null);
    setItems([blank()]);
    setAttest(false);
    if (!demo) {
      setCare(null);
      void load().catch((e) => setErr(message(e)));
    }
  }, [id, demo]);
  const editable = care?.status === 'in_consultation';
  return (
    <>
      <Panel title="Patient care workspace">
        <p>
          Open an assigned active or completed consultation. Only the treating clinician can issue
          prescriptions.
        </p>
        <Field label="Consultation">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">Choose visit</option>
            {apts.map((x) => (
              <option key={x.id} value={x.id}>
                {x.patient} · {x.reference}
              </option>
            ))}
          </select>
        </Field>
        {err && <Notice tone="warning">{err}</Notice>}
        {care && (
          <div className="ops-item">
            <h3>{care.patient}</h3>
            <p>
              {care.mrn} · {human(care.status)}
            </p>
          </div>
        )}
      </Panel>
      {care && (
        <>
          <div className="ops-grid">
            <Panel title="History & allergies">
              {care.history.map((h, i) => (
                <div className="ops-item" key={i}>
                  <Badge>{human(h.kind)}</Badge>
                  <p>{h.detail}</p>
                </div>
              ))}
              {editable && (
                <form
                  className="stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void a.run(
                      async () => {
                        if (demo)
                          setCare(
                            (c) => c && { ...c, history: [...c.history, { kind, detail, recorded_at: now }] },
                          );
                        else {
                          await v2('care/record', { id, kind, data: { detail } });
                          await load();
                        }
                        setDetail('');
                      },
                      demo ? 'Demo entry added.' : 'Record saved.',
                    );
                  }}
                >
                  <Field label="Record type">
                    <select value={kind} onChange={(e) => setKind(e.target.value)}>
                      {['diagnosis', 'allergy', 'condition', 'history'].map((k) => (
                        <option key={k} value={k}>
                          {human(k)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Clinical observation">
                    <textarea
                      required
                      maxLength={1000}
                      rows={3}
                      value={detail}
                      onChange={(e) => setDetail(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" disabled={a.busy || !detail.trim()}>
                    Add record
                  </Button>
                </form>
              )}
            </Panel>
            <Panel title="Vitals">
              <div className="form-grid">
                {[
                  ['pulse', 'Pulse (bpm)'],
                  ['systolic', 'Systolic BP'],
                  ['diastolic', 'Diastolic BP'],
                  ['temperatureC', 'Temperature °C'],
                  ['spo2', 'SpO₂ (%)'],
                  ['weightKg', 'Weight (kg)'],
                  ['heightCm', 'Height (cm)'],
                ].map(([k, label]) => (
                  <Field key={k} label={label}>
                    <input
                      type="number"
                      min="0.1"
                      step="any"
                      max={k === 'spo2' ? 100 : k === 'temperatureC' ? 50 : 500}
                      value={vitals[k] || ''}
                      disabled={!editable}
                      onChange={(e) => setVitals((v) => ({ ...v, [k]: e.target.value }))}
                    />
                  </Field>
                ))}
              </div>
              <Button
                disabled={a.busy || !editable || !Object.values(vitals).some(Boolean)}
                onClick={() =>
                  void a.run(async () => {
                    const data = Object.fromEntries(
                      Object.entries(vitals)
                        .filter(([, v]) => v !== '')
                        .map(([k, v]) => [k, Number(v)]),
                    );
                    if (demo)
                      setCare(
                        (c) =>
                          c && {
                            ...c,
                            visits: c.visits.map((v, i) =>
                              i === 0 ? { ...v, vitals: [data, ...v.vitals] } : v,
                            ),
                          },
                      );
                    else {
                      await v2('care/record', { id, kind: 'vitals', data });
                      await load();
                    }
                    setVitals({});
                  }, 'Vitals recorded.')
                }
              >
                Save vitals
              </Button>
            </Panel>
          </div>
          <Panel title="Visit timeline">
            {care.visits.map((v, i) => (
              <div className="ops-item" key={i}>
                <strong>
                  {v.reference} · {human(v.status)}
                </strong>
                <p>{when(v.created_at)}</p>
                <p>{v.note || 'No note'}</p>
                {v.diagnoses.map((d, j) => (
                  <Badge key={j}>{d}</Badge>
                ))}
                {v.vitals.map((r, j) => (
                  <p key={j}>
                    {Object.entries(r)
                      .map(([k, val]) => `${human(k)}: ${val}`)
                      .join(' · ')}
                  </p>
                ))}
              </div>
            ))}
          </Panel>
          <Panel title="Electronic prescription">
            {editable && (
              <>
                <Notice>
                  Review each medication. This workflow records clinician attestation, not a certified digital
                  signature.
                </Notice>
                {items.map((r, i) => (
                  <div className="ops-item stack" key={i}>
                    <div className="ops-prescription-row">
                      {(['medicine', 'dose', 'frequency', 'duration', 'instructions'] as const).map((k) => (
                        <Field key={k} label={human(k)}>
                          <input
                            value={r[k]}
                            onChange={(e) =>
                              setItems((v) => v.map((x, j) => (i === j ? { ...x, [k]: e.target.value } : x)))
                            }
                          />
                        </Field>
                      ))}
                    </div>
                    {items.length > 1 && (
                      <Button
                        variant="secondary"
                        onClick={() => setItems((v) => v.filter((_, j) => i !== j))}
                      >
                        Remove item
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="secondary"
                  disabled={items.length >= 25}
                  onClick={() => setItems((v) => [...v, blank()])}
                >
                  Add medicine
                </Button>
                <Field label="Follow-up date">
                  <input
                    type="date"
                    min={localDay()}
                    value={follow}
                    onChange={(e) => setFollow(e.target.value)}
                  />
                </Field>
                <label className="check-field">
                  <input type="checkbox" checked={release} onChange={(e) => setRelease(e.target.checked)} />{' '}
                  Release to verified patient portal
                </label>
                <label className="check-field">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> I
                  have reviewed the complete prescription and authorize issuance.
                </label>
                <Button
                  disabled={
                    a.busy ||
                    !attest ||
                    items.some(
                      (x) =>
                        !x.medicine.trim() || !x.dose.trim() || !x.frequency.trim() || !x.duration.trim(),
                    )
                  }
                  onClick={() =>
                    void a.run(async () => {
                      if (!confirm('Issue this prescription? It cannot be overwritten.')) return;
                      const rx = demo
                        ? {
                            ...sampleRx,
                            id: 'DEMO-RX-' + Date.now(),
                            items,
                            followUp: follow || null,
                            released: release,
                          }
                        : await v2<Rx>('care/prescription', {
                            id,
                            items,
                            followUp: follow || null,
                            release,
                            attest,
                          });
                      setPrinted(rx);
                      if (demo) setCare((c) => c && { ...c, prescriptions: [rx, ...c.prescriptions] });
                      else await load();
                      setItems([blank()]);
                      setAttest(false);
                    }, 'Prescription recorded.')
                  }
                >
                  Attest & issue
                </Button>
              </>
            )}
            {care.prescriptions.map((rx) => (
              <div className="ops-item stack" key={rx.id}>
                <div className="live-card-head">
                  <span>
                    Version {rx.version} · {human(rx.status === 'void' ? 'withdrawn' : rx.status)}{' '}
                    <RxStatusBadges rx={rx} />
                  </span>
                  <Button variant="secondary" onClick={() => setPrinted(rx)}>
                    View printable copy
                  </Button>
                </div>
                <RxCorrections rx={rx} demo={demo} onChanged={async () => (demo ? undefined : load())} />
              </div>
            ))}
            {printed && <PrintPrescription rx={printed} demo={demo} />}
          </Panel>
          <Documents appointment={id} demo={demo} />
        </>
      )}
      {a.feedback}
    </>
  );
}
function QueuePanel({ demo }: { demo: boolean }) {
  const [date, setDate] = useState(localDay),
    [rows, setRows] = useState<
      { id: string; token: number; patient: string; doctor: string; status: string; checked_in_at: string }[]
    >([]);
  const a = useAction();
  const refresh = async () =>
    setRows(
      demo
        ? sampleApts.map((x, i) => ({ ...x, token: i + 1, checked_in_at: now }))
        : await v2('queue?date=' + date),
    );
  useEffect(() => {
    void a.run(refresh);
  }, [date, demo]);
  return (
    <Panel title="OPD queue">
      <p>
        Tokens are allocated automatically at check-in. Use the appointment screen for clinical status
        transitions.
      </p>
      <Field label="Queue date">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Button variant="secondary" onClick={() => void a.run(refresh)}>
        Refresh queue
      </Button>
      <div className="ops-grid">
        {rows.map((r) => (
          <div key={r.id} className="ops-item">
            <span className="eyebrow">Token {String(r.token).padStart(3, '0')}</span>
            <h3>{r.patient}</h3>
            <p>{r.doctor}</p>
            <Badge tone="teal">{human(r.status)}</Badge>
          </div>
        ))}
      </div>
      {!rows.length && <Notice>No tokens for this date.</Notice>}
      {a.feedback}
    </Panel>
  );
}
function Leaves({ demo }: { demo: boolean }) {
  const [data, setData] = useState<{
      doctors: { id: string; name: string }[];
      leaves: { id: string; doctor: string; starts_at: string; ends_at: string }[];
    }>({ doctors: [], leaves: [] }),
    [doctor, setDoctor] = useState(''),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [reason, setReason] = useState<LeaveReason>('leave');
  const a = useAction();
  const load = async () =>
    setData(
      demo
        ? {
            doctors: [{ id: 'demo', name: 'Dr. Ananya Sharma' }],
            leaves: [
              {
                id: 'd',
                doctor: 'Dr. Ananya Sharma',
                starts_at: '2026-12-02T03:30:00Z',
                ends_at: '2026-12-02T12:30:00Z',
              },
            ],
          }
        : await v2('leaves'),
    );
  useEffect(() => {
    void a.run(load);
  }, [demo]);
  const asIST = (s: string) => new Date(s + ':00+05:30').toISOString();
  return (
    <Panel title="Doctor leave calendar">
      <Notice>
        Times are in IST. Saving blocks new bookings in this period straight away. Patients already booked
        appear under Affected bookings, where reception can move them or cancel with a full refund.
      </Notice>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          let affected = 0;
          void a.run(
            async () => {
              if (demo)
                setData((d) => ({
                  ...d,
                  leaves: [
                    ...d.leaves,
                    {
                      id: String(Date.now()),
                      doctor: d.doctors.find((x) => x.id === doctor)?.name || 'Doctor',
                      starts_at: asIST(start),
                      ends_at: asIST(end),
                    },
                  ],
                }));
              else {
                const r = await v2<{ affected: number }>('leaves', {
                  doctorId: doctor,
                  start: asIST(start),
                  end: asIST(end),
                  reason,
                });
                affected = r.affected;
                await load();
              }
              setStart('');
              setEnd('');
            },
            () =>
              affected > 0
                ? `Leave saved. ${affected} booked patient${affected === 1 ? '' : 's'} need action under Affected bookings.`
                : 'Leave saved. No existing bookings are affected.',
          );
        }}
      >
        <Field label="Doctor">
          <select required value={doctor} onChange={(e) => setDoctor(e.target.value)}>
            <option value="">Choose doctor</option>
            {data.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="From (IST)">
            <input type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Until (IST)">
            <input type="datetime-local" required value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason (internal)">
          <select value={reason} onChange={(e) => setReason(e.target.value as LeaveReason)}>
            {leaveReasons.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={a.busy || !doctor || !start || !end || start >= end}>
          Block availability
        </Button>
      </form>
      {data.leaves.map((l) => (
        <div className="ops-item" key={l.id}>
          <strong>{l.doctor}</strong>
          <p>
            {when(l.starts_at)} – {when(l.ends_at)}
          </p>
        </div>
      ))}
      {a.feedback}
    </Panel>
  );
}
type LeaveReason = 'leave' | 'unwell' | 'emergency' | 'training' | 'holiday' | 'other';
const leaveReasons: [LeaveReason, string][] = [
  ['leave', 'Planned leave'],
  ['unwell', 'Unwell'],
  ['emergency', 'Emergency'],
  ['training', 'Training / conference'],
  ['holiday', 'Hospital holiday'],
  ['other', 'Other'],
];
const methodLabel: Record<string, string> = {
  razorpay: 'online',
  cash: 'cash',
  upi_offline: 'UPI at desk',
  card_offline: 'card at desk',
  bank_transfer: 'bank transfer',
};
type Affected = {
  id: string;
  reference: string;
  status: string;
  startsAt: string;
  doctor: string;
  patient: string;
  mrn: string;
  phone: string | null;
  leaveReason: LeaveReason;
  leaveEndsAt: string;
  paidPaise: number;
  paymentMethod: string | null;
};
const demoAffected: Affected[] = [
  {
    id: 'demo-a1',
    reference: 'BK-7K2M9QX',
    status: 'confirmed',
    startsAt: now,
    doctor: 'Dr. Ananya Sharma',
    patient: 'Sample Patient D',
    mrn: 'PT-000104',
    phone: '+910000000000',
    leaveReason: 'unwell',
    leaveEndsAt: now,
    paidPaise: 50000,
    paymentMethod: 'razorpay',
  },
  {
    id: 'demo-a2',
    reference: 'BK-H4TN8PW',
    status: 'confirmed',
    startsAt: now,
    doctor: 'Dr. Ananya Sharma',
    patient: 'Sample Patient E',
    mrn: 'PT-000105',
    phone: '+910000000000',
    leaveReason: 'unwell',
    leaveEndsAt: now,
    paidPaise: 0,
    paymentMethod: null,
  },
];
function refundLine(r: Affected) {
  if (r.paidPaise <= 0) return 'Not paid yet: nothing to refund.';
  return r.paymentMethod === 'razorpay'
    ? `Full refund of ${rupees(r.paidPaise)} to the original online payment after administrator approval (usually 5–7 working days once sent).`
    : `Full refund of ${rupees(r.paidPaise)} due at the desk (paid by ${methodLabel[r.paymentMethod || ''] || 'desk payment'}). Billing records it under Desk refunds.`;
}
function AffectedRow({ row, demo, onDone }: { row: Affected; demo: boolean; onDone: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false),
    [reason, setReason] = useState<'doctor_unavailable' | 'hospital_closure' | 'other'>('doctor_unavailable');
  const a = useAction();
  return (
    <div className="ops-item stack">
      <div>
        <strong className="break-ref">{row.reference}</strong> · {row.patient} ({row.mrn})
        <p>
          {when(row.startsAt)} with {row.doctor} ·{' '}
          <Badge tone={row.paidPaise > 0 ? 'green' : 'amber'}>
            {row.paidPaise > 0
              ? `Paid ${rupees(row.paidPaise)} ${methodLabel[row.paymentMethod || ''] || ''}`
              : row.status === 'held'
                ? 'Payment pending'
                : 'Pay at hospital'}
          </Badge>
        </p>
        {row.phone && (
          <p>
            Call patient: <a href={`tel:${row.phone}`}>{row.phone}</a>
          </p>
        )}
      </div>
      {row.status === 'confirmed' && <MoveAppointment id={row.id} demo={demo} onDone={onDone} />}
      {!confirming ? (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Cancel with full refund
        </Button>
      ) : (
        <div className="ops-item stack" role="group" aria-label={`Confirm cancellation of ${row.reference}`}>
          <strong>Cancel {row.reference}?</strong>
          <p>
            {row.patient} · {when(row.startsAt)} · {row.doctor}
          </p>
          <p>{refundLine(row)}</p>
          <p className="ops-muted">
            No cancellation fee applies to hospital-initiated cancellations. The patient is notified on their
            opted-in channels.
          </p>
          <Field label="Reason">
            <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="doctor_unavailable">Doctor unavailable</option>
              <option value="hospital_closure">Hospital closure</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <div className="form-grid">
            <Button variant="secondary" disabled={a.busy} onClick={() => setConfirming(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={a.busy}
              onClick={() =>
                void a.run(
                  async () => {
                    if (!demo) await v2('appointments/hospital-cancel', { id: row.id, reason });
                    await onDone();
                  },
                  demo ? 'Demo only: no booking was cancelled.' : 'Booking cancelled.',
                )
              }
            >
              Confirm cancellation
            </Button>
          </div>
        </div>
      )}
      {a.feedback}
    </div>
  );
}
function AffectedBookings({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<Affected[] | null>(null);
  const a = useAction();
  const load = async () => setRows(demo ? demoAffected : await v2<Affected[]>('leaves/affected'));
  useEffect(() => {
    void a.run(load);
    // Reload only when switching demo/live; `load` and `a` are recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  return (
    <Panel title="Bookings affected by doctor unavailability">
      <Notice>
        These patients are booked while their doctor is unavailable. Call them, then move the visit to another
        time with the same doctor, or cancel with a full refund.
      </Notice>
      {rows === null ? (
        <p aria-busy="true">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice tone="success">No bookings need action.</Notice>
      ) : (
        rows.map((r) => (
          <AffectedRow
            key={r.id}
            row={r}
            demo={demo}
            onDone={async () => (demo ? setRows((x) => (x || []).filter((y) => y.id !== r.id)) : load())}
          />
        ))
      )}
      {a.feedback}
    </Panel>
  );
}
type DeskRefund = {
  id: string;
  amountPaise: number;
  paidBy: string;
  reference: string;
  patient: string;
  mrn: string;
  reason: string;
  requestedAt: string;
};
function DeskRefunds({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<DeskRefund[] | null>(null),
    [method, setMethod] = useState<Record<string, string>>({});
  const a = useAction();
  const load = async () =>
    setRows(
      demo
        ? [
            {
              id: 'demo-r1',
              amountPaise: 50000,
              paidBy: 'cash',
              reference: 'BK-H4TN8PW',
              patient: 'Sample Patient E',
              mrn: 'PT-000105',
              reason: 'doctor_unavailable',
              requestedAt: now,
            },
          ]
        : await v2<DeskRefund[]>('refunds/desk'),
    );
  useEffect(() => {
    void a.run(load);
    // Reload only when switching demo/live; `load` and `a` are recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  return (
    <Panel title="Refunds due at the desk">
      <Notice>
        Hand the full amount back to the patient, then record how it was returned. Online payments are
        refunded through Razorpay and do not appear here.
      </Notice>
      {rows === null ? (
        <p aria-busy="true">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice tone="success">No desk refunds pending.</Notice>
      ) : (
        rows.map((r) => (
          <div className="ops-item stack" key={r.id}>
            <div>
              <strong>{rupees(r.amountPaise)}</strong> to {r.patient} ({r.mrn}) · {r.reference}
              <p>
                Paid by {methodLabel[r.paidBy] || r.paidBy} · cancelled {when(r.requestedAt)} (
                {human(r.reason)})
              </p>
            </div>
            <Field label="Returned by">
              <select
                value={method[r.id] || r.paidBy}
                onChange={(e) => setMethod((m) => ({ ...m, [r.id]: e.target.value }))}
              >
                <option value="cash">Cash</option>
                <option value="upi_offline">UPI</option>
                <option value="card_offline">Card reversal</option>
                <option value="bank_transfer">Bank transfer</option>
              </select>
            </Field>
            <Button
              disabled={a.busy}
              onClick={() =>
                void a.run(
                  async () => {
                    if (demo) setRows((x) => (x || []).filter((y) => y.id !== r.id));
                    else {
                      await v2('refunds/desk', { id: r.id, method: method[r.id] || r.paidBy });
                      await load();
                    }
                  },
                  demo ? 'Demo only: nothing recorded.' : 'Refund recorded.',
                )
              }
            >
              Record refund given
            </Button>
          </div>
        ))
      )}
      {a.feedback}
    </Panel>
  );
}
function Reports({ demo }: { demo: boolean }) {
  const [from, setFrom] = useState(localDay().slice(0, 8) + '01'),
    [to, setTo] = useState(localDay),
    [data, setData] = useState<{
      visits: {
        day: string;
        visits: number;
        completed: number;
        cancelled: number;
        no_show: number;
        online: number;
      }[];
      collections: { method: string; total: number; transactions: number }[];
      refundPaise: number;
    } | null>(null);
  const a = useAction();
  const load = async () =>
    setData(
      demo
        ? {
            visits: [
              { day: '2026-11-23', visits: 24, completed: 18, cancelled: 2, no_show: 1, online: 12 },
              { day: '2026-11-24', visits: 18, completed: 10, cancelled: 1, no_show: 0, online: 9 },
            ],
            collections: [
              { method: 'razorpay', total: 450000, transactions: 9 },
              { method: 'cash', total: 350000, transactions: 7 },
            ],
            refundPaise: 50000,
          }
        : await v2(`reports?from=${from}&to=${to}`),
    );
  useEffect(() => {
    void a.run(load);
  }, [demo]);
  const total = data?.collections.reduce((s, c) => s + Number(c.total), 0) || 0;
  const exportCSV = () => {
    if (!data) return;
    const csv = [
      'day,visits,completed,cancelled,no_show,online',
      ...data.visits.map((v) => [v.day, v.visits, v.completed, v.cancelled, v.no_show, v.online].join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'appointment-report.csv';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <Panel title="Operational report">
        <div className="form-grid">
          <Field label="From">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <Button disabled={a.busy || from > to} onClick={() => void a.run(load)}>
          Apply date range
        </Button>
        {a.feedback}
      </Panel>
      {data && (
        <>
          <div className="live-kpis">
            {[
              ['Appointments', data.visits.reduce((n, v) => n + Number(v.visits), 0)],
              ['Completed', data.visits.reduce((n, v) => n + Number(v.completed), 0)],
              ['Gross captured', rupees(total)],
              ['Refunds (request date)', rupees(data.refundPaise)],
            ].map(([t, v]) => (
              <div className="surface live-kpi" key={t}>
                <p>{t}</p>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <Panel title="Appointment trends">
            {data.visits.map((v) => (
              <div className="ops-item" key={v.day}>
                <strong>{v.day}</strong>
                <p>
                  {v.visits} appointments · {v.completed} completed · {v.online} online
                </p>
                <progress
                  value={v.completed}
                  max={Math.max(1, v.visits)}
                  style={{ width: '100%', accentColor: '#096b66' }}
                />
              </div>
            ))}
            <Button variant="secondary" onClick={exportCSV}>
              Export visits CSV
            </Button>
          </Panel>
          <Panel title="Collections by method">
            {data.collections.map((c) => (
              <div className="ops-item live-card-head" key={c.method}>
                <span>
                  {human(c.method)} · {c.transactions} transactions
                </span>
                <strong>{rupees(c.total)}</strong>
              </div>
            ))}
            <Notice>
              Gross captured amounts are not bank settlements or accounting revenue. Refunds grouped by
              request date; reconcile with gateway statements.
            </Notice>
          </Panel>
        </>
      )}
    </>
  );
}
const roles = ['doctor', 'receptionist', 'billing', 'nurse', 'content_manager', 'super_admin'];
function Team({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<
      { id: string; name: string; active: boolean; self: boolean; roles: string[] }[]
    >([]),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [role, setRole] = useState('receptionist');
  const a = useAction();
  const load = async () =>
    setRows(
      demo
        ? [
            { id: '1', name: 'Demo Administrator', active: true, self: true, roles: ['super_admin'] },
            {
              id: '2',
              name: 'Demo Receptionist',
              active: true,
              self: false,
              roles: ['receptionist', 'billing'],
            },
          ]
        : await v2('team'),
    );
  useEffect(() => {
    void a.run(load);
  }, [demo]);
  return (
    <>
      <Panel title="Invite a staff member">
        <Notice>
          Invitations are for non-clinical staff. Doctor registration and profile verification remain
          administrator-provisioned.
        </Notice>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(
              async () => {
                if (demo)
                  setRows((r) => [
                    ...r,
                    { id: String(Date.now()), name, active: true, self: false, roles: [role] },
                  ]);
                else {
                  await v2('team/invite', { name, email, role });
                  await load();
                }
                setName('');
                setEmail('');
              },
              demo ? 'Demo invitation created; no email sent.' : 'Invitation requested.',
            );
          }}
        >
          <Field label="Name">
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Work email">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Initial role">
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {roles
                .filter((r) => !['doctor', 'super_admin'].includes(r))
                .map((r) => (
                  <option key={r} value={r}>
                    {human(r)}
                  </option>
                ))}
            </select>
          </Field>
          <Button type="submit" disabled={a.busy}>
            <L en="Invite staff" />
          </Button>
        </form>
      </Panel>
      <Panel title="Branch role assignments">
        {rows.map((r) => (
          <div className="ops-item stack" key={r.id}>
            <strong>
              {r.name} {r.self ? '(you)' : ''}
            </strong>
            {roles.map((role) => (
              <label className="check-field" key={role}>
                <input
                  type="checkbox"
                  disabled={r.self || !r.active || a.busy}
                  checked={r.roles.includes(role)}
                  onChange={(e) =>
                    setRows((old) =>
                      old.map((x) =>
                        x.id !== r.id
                          ? x
                          : {
                              ...x,
                              roles: e.target.checked
                                ? [...x.roles, role]
                                : x.roles.filter((y) => y !== role),
                            },
                      ),
                    )
                  }
                />
                {human(role)}
              </label>
            ))}
            {!r.self && (
              <Button
                variant="secondary"
                disabled={a.busy || !r.active}
                onClick={() =>
                  void a.run(async () => {
                    if (!confirm('Replace this member’s branch roles?')) return;
                    if (!demo) {
                      await v2('team/roles', { member: r.id, roles: r.roles });
                      await load();
                    }
                  }, 'Roles saved.')
                }
              >
                <L en="Save roles" />
              </Button>
            )}
          </div>
        ))}
        {a.feedback}
      </Panel>
    </>
  );
}
function Notifications({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<
    {
      channel: string;
      template_key: string;
      state: string;
      attempts: number;
      last_error_code: string | null;
      created_at: string;
    }[]
  >([]);
  const a = useAction();
  const load = async () =>
    setRows(
      demo
        ? [
            {
              channel: 'whatsapp',
              template_key: 'appointment_confirmed',
              state: 'sent',
              attempts: 1,
              last_error_code: null,
              created_at: now,
            },
            {
              channel: 'sms',
              template_key: 'reminder_24h',
              state: 'queued',
              attempts: 0,
              last_error_code: null,
              created_at: now,
            },
            {
              channel: 'email',
              template_key: 'reminder_1h',
              state: 'dead_letter',
              attempts: 1,
              last_error_code: 'delivery_review',
              created_at: now,
            },
          ]
        : await v2('notifications'),
    );
  useEffect(() => {
    void a.run(load);
  }, [demo]);
  return (
    <Panel title="Notification delivery queue">
      <Notice>
        Provider acceptance is not confirmed delivery. Failed or ambiguous deliveries need review. No
        sensitive diagnosis or treatment is included in messages.
      </Notice>
      <Button variant="secondary" onClick={() => void a.run(load)}>
        <L en="Refresh jobs" />
      </Button>
      {rows.map((r, i) => (
        <div className="ops-item live-card-head" key={i}>
          <div>
            <strong>{human(r.template_key)}</strong>
            <p>
              {human(r.channel)} · {r.attempts} attempt(s) · {r.last_error_code || 'No error'}
            </p>
          </div>
          <Badge tone={r.state === 'sent' ? 'green' : r.state === 'dead_letter' ? 'amber' : 'neutral'}>
            {human(r.state)}
          </Badge>
        </div>
      ))}
      {a.feedback}
    </Panel>
  );
}
function Inquiries({ demo }: { demo: boolean }) {
  const [rows, setRows] = useState<
    { id: string; full_name: string; phone: string; category: string; state: string; created_at: string }[]
  >([]);
  const a = useAction();
  const load = async () =>
    setRows(
      demo
        ? [
            {
              id: 'demo',
              full_name: 'Sample visitor',
              phone: '+910000000000',
              category: 'appointment',
              state: 'new',
              created_at: now,
            },
          ]
        : await v2('inquiries'),
    );
  useEffect(() => {
    void a.run(load);
  }, [demo]);
  return (
    <Panel title="Website callback requests">
      <Notice>
        Only use contact details to respond to the requested inquiry. Do not solicit unrelated marketing.
      </Notice>
      {rows.map((r) => (
        <div className="ops-item stack" key={r.id}>
          <div className="live-card-head">
            <strong>{r.full_name}</strong>
            <Badge>{human(r.state)}</Badge>
          </div>
          <p>
            {r.phone} · {human(r.category)}
          </p>
          {r.state !== 'closed' && (
            <div className="live-actions">
              {['contacted', 'closed'].map((s) => (
                <Button
                  key={s}
                  variant="secondary"
                  disabled={a.busy}
                  onClick={() =>
                    void a.run(async () => {
                      if (demo) setRows((v) => v.map((x) => (x.id === r.id ? { ...x, state: s } : x)));
                      else setRows(await v2('inquiries', { id: r.id, state: s }));
                    }, 'Inquiry updated.')
                  }
                >
                  {human(s)}
                </Button>
              ))}
            </div>
          )}
        </div>
      ))}
      {!rows.length && <Notice>No inquiries.</Notice>}
      {a.feedback}
    </Panel>
  );
}
function PatientEdit({ demo }: { demo: boolean }) {
  const [q, setQ] = useState(''),
    [rows, setRows] = useState<{ id: string; name: string; mrn: string; birthDate: string | null }[]>([]),
    [id, setId] = useState(''),
    [name, setName] = useState(''),
    [birth, setBirth] = useState(''),
    [gender, setGender] = useState('');
  const a = useAction();
  return (
    <Panel title="Patient demographic corrections">
      <Notice>
        Check the MRN and identity before changing demographics. Contact verification and record merges are
        intentionally separate.
      </Notice>
      <Field label="Search by name, UHID, mobile or booking reference">
        <input value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Button
        variant="secondary"
        onClick={() =>
          void a.run(async () =>
            setRows(
              demo
                ? [{ id: 'demo', name: 'Sample Patient B', mrn: 'MRN-00102', birthDate: '1984-03-01' }]
                : await api('staff/patients?q=' + encodeURIComponent(q)),
            ),
          )
        }
      >
        <L en="Search" />
      </Button>
      <Field label="Patient">
        <select
          value={id}
          onChange={(e) => {
            const row = rows.find((r) => r.id === e.target.value);
            setId(e.target.value);
            setName(row?.name || '');
            setBirth(row?.birthDate || '');
            setGender('');
          }}
        >
          <option value="">Choose record</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {r.mrn}
            </option>
          ))}
        </select>
      </Field>
      {id && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void a.run(async () => {
              if (!demo) await v2('patient/edit', { id, name, birth: birth || null, gender: gender || null });
            }, 'Demographics saved.');
          }}
        >
          <Field label="Corrected name">
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Birth date">
            <input type="date" max={localDay()} value={birth} onChange={(e) => setBirth(e.target.value)} />
          </Field>
          <Field label="Gender (optional)">
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Not recorded</option>
              {['female', 'male', 'other', 'not_disclosed'].map((g) => (
                <option key={g} value={g}>
                  {human(g)}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" disabled={a.busy}>
            <L en="Save corrections" />
          </Button>
        </form>
      )}
      {a.feedback}
    </Panel>
  );
}
export function ExtendedPanel({ section, demo = false }: { section: string; demo?: boolean }) {
  switch (section) {
    case 'history':
      return <PatientTimeline demo={demo} />;
    case 'prescription-register':
      return <PrescriptionRegister demo={demo} />;
    case 'cancellation-policy':
      return <CancellationPolicySettings demo={demo} />;
    case 'care':
      return <CarePanel demo={demo} />;
    case 'opd':
      return <QueuePanel demo={demo} />;
    case 'leave':
      return <Leaves demo={demo} />;
    case 'affected-bookings':
      return <AffectedBookings demo={demo} />;
    case 'desk-refunds':
      return <DeskRefunds demo={demo} />;
    case 'rx-withdrawals':
      return <RxWithdrawals demo={demo} />;
    case 'analytics':
      return <Reports demo={demo} />;
    case 'team-management':
      return <Team demo={demo} />;
    case 'communications':
      return <Notifications demo={demo} />;
    case 'inquiries':
      return <Inquiries demo={demo} />;
    case 'patient-edit':
      return <PatientEdit demo={demo} />;
    default:
      return <Notice>Module unavailable.</Notice>;
  }
}
export function ExtendedWorkspace({
  section,
  role,
  demo = false,
  context,
}: {
  section: string;
  role: Role;
  demo?: boolean;
  context?: StaffContext;
}) {
  const nav = extendedNav.filter(
    (x) => x.roles.includes(role) && (demo || x.perms.some((p) => context?.permissions.includes(p))),
  );
  return (
    <div className="live-shell">
      <aside className="live-sidebar">
        <Brand href="/login" sub="HMS workspace" />
        <p className="eyebrow">{human(role)} workspace</p>
        <nav aria-label="Workspace navigation">
          <a href={'/' + role}>
            <Icon name="grid" />
            <L en="Overview" />
          </a>
          <a href={'/' + role + '/appointments'}>
            <Icon name="calendar" />
            <L en="Appointments" />
          </a>
          {nav.map((n) => (
            <a key={n.id} className={n.id === section ? 'active' : ''} href={`/${role}/${n.id}`}>
              <Icon name={n.icon} />
              <L en={n.label} />
            </a>
          ))}
        </nav>
        <a href="/login">
          <L en="Return to sign in" />
        </a>
      </aside>
      <main id="main" className="live-main">
        <header className="live-card-head">
          <div>
            <span className="eyebrow">{demo ? 'Interactive preview' : 'Secure hospital operations'}</span>
            <h1>
              <L en={nav.find((n) => n.id === section)?.label || 'Restricted module'} />
            </h1>
            <p>{demo ? 'Fictional data — no live writes' : context?.name}</p>
          </div>
          <Badge tone="teal">{demo ? 'Demo' : 'MFA verified'}</Badge>
        </header>
        {nav.some((n) => n.id === section) ? (
          <ExtendedPanel section={section} demo={demo} />
        ) : (
          <Notice tone="warning">Access not permitted.</Notice>
        )}
      </main>
    </div>
  );
}
export function PatientRecords({ demo = false }: { demo?: boolean }) {
  const [records, setRecords] = useState<{
      profile: { name: string; mrn: string; birthDate: string | null } | null;
      prescriptions: Rx[];
      invoices: {
        invoice_number: string;
        reference: string;
        status: string;
        total_paise: number;
        issued_at: string;
      }[];
    } | null>(null),
    [prefs, setPrefs] = useState<Record<string, boolean>>({}),
    [rx, setRx] = useState<Rx | null>(null);
  const a = useAction();
  useEffect(() => {
    void a.run(async () => {
      if (demo) {
        setRecords({
          profile: { name: 'Sample Patient B', mrn: 'MRN-00102', birthDate: null },
          prescriptions: [sampleRx],
          invoices: [
            {
              invoice_number: 'DEMO-INV-01',
              reference: 'APT-1002',
              status: 'settled',
              total_paise: 50000,
              issued_at: now,
            },
          ],
        });
        setPrefs({ whatsapp: true, sms: false, email: false });
      } else {
        const r = await v2<NonNullable<typeof records>>('patient/records');
        setRecords(r);
        if (r.profile) setPrefs(await v2('patient/preferences'));
      }
    });
  }, [demo]);
  return (
    <main id="main" className="booking-container stack">
      <div className="live-card-head">
        <Brand href="/login" sub="Patient services" />
        <a href="/my-bookings">
          <L en="My appointments" />
        </a>
      </div>
      <h1>
        <L en="My health records" />
      </h1>
      {demo && <Notice>Fictional records for preview.</Notice>}
      {a.feedback}
      {records && !records.profile ? (
        <Notice>Verify your phone and book a visit before using patient records.</Notice>
      ) : (
        records && (
          <>
            <Panel title="My profile">
              <h3>{records.profile?.name}</h3>
              <p>{records.profile?.mrn}</p>
              <p>Request identity corrections through hospital reception.</p>
              <Button href="/my-bookings">
                <L en="View appointments" />
              </Button>
            </Panel>
            <Panel title="Released prescriptions">
              {records.prescriptions.map((r) => (
                <div className="ops-item live-card-head" key={r.id}>
                  <span>
                    {r.doctor} · version {r.version}
                  </span>
                  <Button variant="secondary" onClick={() => setRx(r)}>
                    <L en="View prescription" />
                  </Button>
                </div>
              ))}
              {rx && <PrintPrescription rx={rx} demo={demo} />}
            </Panel>
            <Panel title="Invoices">
              {records.invoices.map((i) => (
                <div className="ops-item" key={i.invoice_number}>
                  <strong>{i.invoice_number}</strong>
                  <p>
                    {rupees(i.total_paise)} · {human(i.status)}
                  </p>
                  <p>{i.reference}</p>
                </div>
              ))}
            </Panel>
            <Documents patient demo={demo} />
            <Panel title="Communication preferences">
              <p>
                Opt in to generic appointment updates. Only verified contact channels are eligible; no
                marketing consent is implied.
              </p>
              {['whatsapp', 'sms', 'email'].map((channel) => (
                <label key={channel} className="check-field">
                  <input
                    type="checkbox"
                    disabled={a.busy}
                    checked={!!prefs[channel]}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      void a.run(
                        async () =>
                          setPrefs(
                            demo
                              ? { ...prefs, [channel]: enabled }
                              : await v2('patient/preferences', { channel, enabled }),
                          ),
                        'Preference updated.',
                      );
                    }}
                  />
                  {human(channel)}
                </label>
              ))}
            </Panel>
          </>
        )
      )}
    </main>
  );
}
