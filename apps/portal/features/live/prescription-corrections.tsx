'use client';
// Prescription corrections (migration 022). Business rules: docs/BUSINESS_RULES.md section 7.
// The server enforces every rule; these screens only offer the actions that can succeed.
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Field, Notice } from '@hms/ui';
import { human, message, when } from './client';
import { v3 } from './v3-client';

export type RxItem = {
  medicine: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string;
};
export type RxCorrectable = {
  id: string;
  version: number;
  status: string;
  issuedAt: string | null;
  followUp: string | null;
  items: RxItem[];
  replaces?: { version: number; issuedAt: string } | null;
  amendUntil?: string | null;
  mine?: boolean;
  withdrawalPending?: boolean;
};
type HistoryEntry = RxCorrectable & {
  amendReason: string | null;
  amendNote: string | null;
  amendedBy: string | null;
  supersededAt: string | null;
  withdrawnAt: string | null;
  withdrawals: {
    status: string;
    reason: string;
    note: string | null;
    requestedAt: string;
    decidedAt: string | null;
    decisionNote: string | null;
    decidedBy: string | null;
  }[];
};

export const amendReasons: [string, string][] = [
  ['typo', 'Typing error'],
  ['dose_change', 'Dose or frequency change'],
  ['wrong_medicine', 'Wrong medicine'],
  ['instructions', 'Instructions change'],
  ['follow_up', 'Follow-up date change'],
  ['other', 'Other (explain)'],
];
export const withdrawReasons: [string, string][] = [
  ['wrong_patient', 'Issued to the wrong patient'],
  ['issued_in_error', 'Issued in error'],
  ['duplicate', 'Duplicate prescription'],
  ['other', 'Other (explain)'],
];
const label = (list: [string, string][], key: string | null) =>
  list.find(([k]) => k === key)?.[1] || human(key || '');

function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState('');
  const lock = useRef(false);
  const run = async (task: () => Promise<string>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setDone('');
    try {
      setDone(await task());
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const feedback = (
    <>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {done && <Notice tone="success">{done}</Notice>}
    </>
  );
  return { busy, run, feedback };
}

/** Status line shown on every prescription: version, what it replaces, and validity. */
export function RxStatusBadges({ rx }: { rx: RxCorrectable }) {
  return (
    <>
      {rx.status === 'superseded' && <Badge tone="amber">Superseded · not valid</Badge>}
      {rx.status === 'void' && <Badge tone="red">Withdrawn · not valid</Badge>}
      {rx.withdrawalPending && <Badge tone="amber">Withdrawal pending</Badge>}
      {rx.replaces && (
        <Badge tone="blue">
          Updated · replaces version {rx.replaces.version} of {when(rx.replaces.issuedAt)}
        </Badge>
      )}
    </>
  );
}

/** Doctor actions on one prescription: amend, request withdrawal, view history. */
export function RxCorrections({
  rx,
  demo = false,
  onChanged,
}: {
  rx: RxCorrectable;
  demo?: boolean;
  onChanged: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'' | 'amend' | 'withdraw' | 'history'>(''),
    [items, setItems] = useState<RxItem[]>(
      rx.items.map((i) => ({ ...i, instructions: i.instructions || '' })),
    ),
    [follow, setFollow] = useState(rx.followUp || ''),
    [reason, setReason] = useState(''),
    [note, setNote] = useState(''),
    [attest, setAttest] = useState(false),
    [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const t = useTask();
  // Captured once per mount; the server re-checks the window on submit anyway.
  const [openedAt] = useState(() => Date.now());
  const windowOpen = !!rx.amendUntil && new Date(rx.amendUntil).getTime() > openedAt;
  const canCorrect = rx.status === 'signed' && !!rx.mine && !rx.withdrawalPending;
  const needNote = reason === 'other';
  const reset = () => {
    setMode('');
    setReason('');
    setNote('');
    setAttest(false);
  };
  return (
    <div className="stack">
      <div className="form-grid">
        {canCorrect && windowOpen && (
          <Button variant="secondary" onClick={() => setMode(mode === 'amend' ? '' : 'amend')}>
            Amend
          </Button>
        )}
        {canCorrect && (
          <Button variant="secondary" onClick={() => setMode(mode === 'withdraw' ? '' : 'withdraw')}>
            Withdraw
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            if (mode === 'history') return setMode('');
            setMode('history');
            void t.run(async () => {
              setHistory(demo ? [] : await v3<HistoryEntry[]>(`prescription/history?id=${rx.id}`));
              return '';
            });
          }}
        >
          Version history
        </Button>
      </div>
      {canCorrect && !windowOpen && rx.amendUntil && (
        <p className="ops-muted">
          Amendment window closed on {when(rx.amendUntil)}. Write a new prescription for further changes.
        </p>
      )}
      {canCorrect && windowOpen && rx.amendUntil && (
        <p className="ops-muted">You can amend this prescription until {when(rx.amendUntil)}.</p>
      )}

      {mode === 'amend' && (
        <div className="ops-item stack" role="group" aria-label={`Amend prescription version ${rx.version}`}>
          <Notice>
            Amending creates version {rx.version + 1}. Version {rx.version} stays in the record, marked as
            superseded. The patient sees only the new version and is notified.
          </Notice>
          {items.map((r, i) => (
            <div className="ops-prescription-row" key={i}>
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
              {items.length > 1 && (
                <Button variant="ghost" onClick={() => setItems((v) => v.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="secondary"
            disabled={items.length >= 25}
            onClick={() =>
              setItems((v) => [
                ...v,
                { medicine: '', dose: '', frequency: '', duration: '', instructions: '' },
              ])
            }
          >
            Add medicine
          </Button>
          <Field label="Follow-up date">
            <input type="date" value={follow} onChange={(e) => setFollow(e.target.value)} />
          </Field>
          <Field label="Reason for amendment">
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose reason</option>
              {amendReasons.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label={needNote ? 'Explanation (required)' : 'Note (optional)'}>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <label className="check-field">
            <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> I have
            reviewed the complete amended prescription and authorize issuance.
          </label>
          <div className="form-grid">
            <Button variant="secondary" onClick={reset}>
              Back
            </Button>
            <Button
              disabled={
                t.busy ||
                !attest ||
                !reason ||
                (needNote && !note.trim()) ||
                items.some(
                  (x) => !x.medicine.trim() || !x.dose.trim() || !x.frequency.trim() || !x.duration.trim(),
                )
              }
              onClick={() =>
                void t.run(async () => {
                  if (demo) {
                    reset();
                    return 'Demo only: no prescription changed.';
                  }
                  const r = await v3<{ version: number; paperCopyToRecall: boolean }>('prescription/amend', {
                    id: rx.id,
                    items,
                    followUp: follow || null,
                    reason,
                    note: note.trim() || null,
                    attest: true,
                  });
                  reset();
                  await onChanged();
                  return r.paperCopyToRecall
                    ? `Version ${r.version} issued. A paper copy of the old version was handed out: reception will see it in the recall list.`
                    : `Version ${r.version} issued.`;
                })
              }
            >
              Attest & issue amendment
            </Button>
          </div>
        </div>
      )}

      {mode === 'withdraw' && (
        <div
          className="ops-item stack"
          role="group"
          aria-label={`Withdraw prescription version ${rx.version}`}
        >
          <Notice tone="warning">
            Withdrawal needs confirmation by another doctor or an administrator. Until then the prescription
            is hidden from the patient portal. Use this only when the prescription should not exist; use Amend
            to correct it.
          </Notice>
          <Field label="Reason for withdrawal">
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">Choose reason</option>
              {withdrawReasons.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label={needNote ? 'Explanation (required)' : 'Note (optional)'}>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Button variant="secondary" onClick={reset}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={t.busy || !reason || (needNote && !note.trim())}
              onClick={() =>
                void t.run(async () => {
                  if (!demo)
                    await v3('prescription/withdraw', { id: rx.id, reason, note: note.trim() || null });
                  reset();
                  await onChanged();
                  return demo
                    ? 'Demo only: nothing requested.'
                    : 'Withdrawal requested. It takes effect once another doctor or an administrator confirms.';
                })
              }
            >
              Request withdrawal
            </Button>
          </div>
        </div>
      )}

      {mode === 'history' && history && (
        <div className="ops-item stack" aria-label="Prescription version history">
          {history.length === 0 && <p>No earlier versions.</p>}
          {history.map((h) => (
            <div key={h.id} className="stack">
              <strong>
                Version {h.version} · {human(h.status === 'void' ? 'withdrawn' : h.status)} ·{' '}
                {h.issuedAt ? when(h.issuedAt) : ''}
              </strong>
              {h.amendReason && (
                <p>
                  Amended by {h.amendedBy || 'doctor'}: {label(amendReasons, h.amendReason)}
                  {h.amendNote ? ` (${h.amendNote})` : ''}
                </p>
              )}
              <ul>
                {h.items.map((i, k) => (
                  <li key={k}>
                    {i.medicine}: {i.dose}, {i.frequency}, {i.duration}
                    {i.instructions ? ` (${i.instructions})` : ''}
                  </li>
                ))}
              </ul>
              {h.withdrawals.map((w, k) => (
                <p key={k} className="ops-muted">
                  Withdrawal {human(w.status)}: {label(withdrawReasons, w.reason)}
                  {w.note ? ` (${w.note})` : ''} · requested {when(w.requestedAt)}
                  {w.decidedAt ? ` · decided ${when(w.decidedAt)} by ${w.decidedBy || 'reviewer'}` : ''}
                  {w.decisionNote ? ` (${w.decisionNote})` : ''}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}
      {t.feedback}
    </div>
  );
}

type PendingWithdrawal = {
  id: string;
  reason: string;
  note: string | null;
  requestedAt: string;
  requestedBy: string;
  mine: boolean;
  version: number;
  issuedAt: string;
  patient: string;
  mrn: string;
  doctor: string;
  items: RxItem[] | null;
};
const demoPending: PendingWithdrawal[] = [
  {
    id: 'demo-w1',
    reason: 'wrong_patient',
    note: 'Selected the wrong patient record',
    requestedAt: '2026-11-24T05:30:00Z',
    requestedBy: 'Dr. Ananya Sharma',
    mine: false,
    version: 1,
    issuedAt: '2026-11-24T05:00:00Z',
    patient: 'Sample Patient B',
    mrn: 'PT-000102',
    doctor: 'Dr. Ananya Sharma',
    items: [
      {
        medicine: 'Sample medicine',
        dose: '1 tablet',
        frequency: 'Daily',
        duration: '3 days',
        instructions: '',
      },
    ],
  },
];

function WithdrawalRow({
  w,
  demo,
  onDone,
}: {
  w: PendingWithdrawal;
  demo: boolean;
  onDone: () => Promise<void>;
}) {
  const [decision, setDecision] = useState<'' | 'approve' | 'reject'>(''),
    [note, setNote] = useState('');
  const t = useTask();
  return (
    <div className="ops-item stack">
      <div>
        <strong>
          {w.patient} ({w.mrn})
        </strong>{' '}
        · prescription version {w.version} of {when(w.issuedAt)} by {w.doctor}
        <p>
          Reason: {label(withdrawReasons, w.reason)}
          {w.note ? ` (${w.note})` : ''} · requested by {w.requestedBy} on {when(w.requestedAt)}
        </p>
        {w.items && (
          <ul>
            {w.items.map((i, k) => (
              <li key={k}>
                {i.medicine}: {i.dose}, {i.frequency}, {i.duration}
              </li>
            ))}
          </ul>
        )}
      </div>
      {w.mine ? (
        <>
          <p className="ops-muted">You requested this. Another doctor or an administrator must confirm it.</p>
          <Button
            variant="secondary"
            disabled={t.busy}
            onClick={() =>
              void t.run(async () => {
                if (!demo) await v3('prescription/withdraw/cancel', { id: w.id });
                await onDone();
                return demo
                  ? 'Demo only.'
                  : 'Request cancelled. The prescription is visible to the patient again.';
              })
            }
          >
            Cancel my request
          </Button>
        </>
      ) : !decision ? (
        <div className="form-grid">
          <Button variant="danger" onClick={() => setDecision('approve')}>
            Confirm withdrawal
          </Button>
          <Button variant="secondary" onClick={() => setDecision('reject')}>
            Reject request
          </Button>
        </div>
      ) : (
        <div className="stack" role="group" aria-label="Withdrawal decision">
          <p>
            {decision === 'approve'
              ? 'The prescription becomes permanently withdrawn: hidden from the patient (who is notified) and kept in the clinical record.'
              : 'The prescription stays valid and becomes visible to the patient again.'}
          </p>
          <Field label={decision === 'reject' ? 'Reason for rejecting (required)' : 'Note (optional)'}>
            <textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Button variant="secondary" onClick={() => setDecision('')}>
              Back
            </Button>
            <Button
              variant={decision === 'approve' ? 'danger' : 'primary'}
              disabled={t.busy || (decision === 'reject' && !note.trim())}
              onClick={() =>
                void t.run(async () => {
                  if (!demo)
                    await v3('prescription/withdraw/decide', {
                      id: w.id,
                      approve: decision === 'approve',
                      note: note.trim() || null,
                    });
                  await onDone();
                  return demo
                    ? 'Demo only: nothing changed.'
                    : decision === 'approve'
                      ? 'Withdrawal confirmed.'
                      : 'Request rejected.';
                })
              }
            >
              {decision === 'approve' ? 'Confirm withdrawal' : 'Reject request'}
            </Button>
          </div>
        </div>
      )}
      {t.feedback}
    </div>
  );
}

/** Pending withdrawal requests for doctors (second opinion) and administrators. */
export function RxWithdrawals({ demo = false }: { demo?: boolean }) {
  const [rows, setRows] = useState<PendingWithdrawal[] | null>(null);
  const t = useTask();
  const load = async () =>
    setRows(demo ? demoPending : await v3<PendingWithdrawal[]>('prescription/withdrawals'));
  useEffect(() => {
    void t.run(async () => {
      await load();
      return '';
    });
    // Reload only when switching demo/live; `load` and `t` are recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  return (
    <section className="surface ops-panel stack">
      <h2>Prescription withdrawal requests</h2>
      <Notice>
        A withdrawal needs a second person: you cannot confirm a request you made. Administrators see the
        reason but not the medicines.
      </Notice>
      {rows === null ? (
        <p aria-busy="true">Loading…</p>
      ) : rows.length === 0 ? (
        <Notice tone="success">No pending requests.</Notice>
      ) : (
        rows.map((w) => (
          <WithdrawalRow
            key={w.id}
            w={w}
            demo={demo}
            onDone={async () => (demo ? setRows((x) => (x || []).filter((y) => y.id !== w.id)) : load())}
          />
        ))
      )}
      {t.feedback}
    </section>
  );
}
