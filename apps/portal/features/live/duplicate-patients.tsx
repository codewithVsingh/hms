'use client';
// Duplicate patients and merges (migration 023). Business rules: docs/BUSINESS_RULES.md section 10.
// The server enforces every rule (permissions, second person, ID check, oldest UHID survives).
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Field, Notice } from '@hms/ui';
import { human, message, when } from './client';
import { v3 } from './v3-client';

type Summary = {
  id: string;
  mrn: string;
  name: string;
  birthDate: string | null;
  gender: string | null;
  registeredAt: string;
  phoneLast4: string | null;
  onlineAccount: boolean;
  lastVisit: string | null;
  visits: number;
};
type Flag = {
  id: string;
  level: 'likely' | 'possible';
  source: string;
  createdAt: string;
  patient: Summary;
  candidate: Summary;
  mergePending: boolean;
};
type Pending = {
  id: string;
  proposedAt: string;
  note: string | null;
  proposedBy: string;
  mine: boolean;
  survivor: Summary;
  merged: Summary;
};
type Recent = {
  id: string;
  status: 'approved' | 'undone';
  decidedAt: string;
  survivorMrn: string;
  survivorName: string;
  mergedMrn: string;
  idCheck: string | null;
  canUndo: boolean;
};
type Merges = { undoDays: number | null; pending: Pending[]; recent: Recent[] };

export const idDocuments: [string, string][] = [
  ['aadhaar', 'Aadhaar'],
  ['pan', 'PAN card'],
  ['passport', 'Passport'],
  ['driving_licence', 'Driving licence'],
  ['voter_id', 'Voter ID'],
  ['other_government_id', 'Other government ID'],
];
const sourceLabel: Record<string, string> = {
  online_booking: 'New online booking',
  review: 'Record check',
  registration: 'Registration',
};

const demoA: Summary = {
  id: 'demo-p1',
  mrn: 'PT-000214',
  name: 'Smt. Sunitha Sharma',
  birthDate: '1975-03-04',
  gender: 'female',
  registeredAt: '2026-06-02T05:00:00Z',
  phoneLast4: '0001',
  onlineAccount: false,
  lastVisit: '2026-10-12T05:30:00Z',
  visits: 3,
};
const demoB: Summary = {
  ...demoA,
  id: 'demo-p2',
  mrn: 'PT-000391',
  name: 'Sunita Sharma',
  gender: null,
  registeredAt: '2026-11-20T09:00:00Z',
  onlineAccount: true,
  lastVisit: null,
  visits: 0,
};

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

function Person({ p, label }: { p: Summary; label?: string }) {
  return (
    <div className="ops-item stack">
      {label && <span className="ops-muted">{label}</span>}
      <strong>
        {p.name} · <span className="break-ref">{p.mrn}</span>
      </strong>
      <p>
        DOB {p.birthDate || 'not recorded'} · {p.gender ? human(p.gender) : 'gender not recorded'} · mobile
        ending {p.phoneLast4 || '—'}
      </p>
      <p>
        Registered {when(p.registeredAt)} · {p.visits} visit{p.visits === 1 ? '' : 's'}
        {p.lastVisit ? `, last ${when(p.lastVisit)}` : ''}
        {p.onlineAccount && (
          <>
            {' '}
            <Badge tone="blue">Online account</Badge>
          </>
        )}
      </p>
    </div>
  );
}

function FlagRow({
  f,
  demo,
  onDone,
  say,
}: {
  f: Flag;
  demo: boolean;
  onDone: () => Promise<void>;
  say: (m: string) => void;
}) {
  const [mode, setMode] = useState<'' | 'merge' | 'dismiss'>(''),
    [note, setNote] = useState('');
  const t = useTask();
  const bothAccounts = f.patient.onlineAccount && f.candidate.onlineAccount;
  return (
    <div className="ops-item stack">
      <div className="live-card-head">
        <Badge tone={f.level === 'likely' ? 'red' : 'amber'}>
          {f.level === 'likely' ? 'Likely the same person' : 'Possibly the same person'}
        </Badge>
        <span className="ops-muted">
          {sourceLabel[f.source] || human(f.source)} · {when(f.createdAt)}
        </span>
      </div>
      <div className="form-grid">
        <Person p={f.candidate} />
        <Person p={f.patient} />
      </div>
      {f.mergePending ? (
        <Notice>A merge for one of these patients is waiting for approval.</Notice>
      ) : bothAccounts ? (
        <Notice>
          Both records have their own online account, so they are treated as two people and cannot be merged.
        </Notice>
      ) : null}
      {!mode && (
        <div className="form-grid">
          {!f.mergePending && !bothAccounts && (
            <Button onClick={() => setMode('merge')}>Propose merge</Button>
          )}
          <Button variant="secondary" onClick={() => setMode('dismiss')}>
            Not the same person
          </Button>
        </div>
      )}
      {mode && (
        <div className="stack" role="group" aria-label={mode === 'merge' ? 'Propose merge' : 'Dismiss match'}>
          {mode === 'merge' && (
            <p>
              The record registered first keeps its UHID. The other UHID will still find the patient. An
              administrator must approve after checking the patient&apos;s ID.
            </p>
          )}
          <Field
            label={
              mode === 'merge'
                ? 'Note for the approver (optional)'
                : 'Why these are different people (required)'
            }
          >
            <input
              maxLength={mode === 'merge' ? 500 : 300}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className="form-grid">
            <Button variant="secondary" onClick={() => setMode('')}>
              Back
            </Button>
            <Button
              disabled={t.busy || (mode === 'dismiss' && note.trim().length < 5)}
              onClick={() =>
                void t.run(async () => {
                  if (!demo) {
                    if (mode === 'merge')
                      await v3('patients/merges', {
                        a: f.patient.id,
                        b: f.candidate.id,
                        note: note.trim() || null,
                      });
                    else await v3('patients/duplicates/dismiss', { id: f.id, note: note.trim() });
                  }
                  const msg = demo
                    ? 'Demo only: nothing changed.'
                    : mode === 'merge'
                      ? 'Merge proposed. An administrator will review it.'
                      : 'Marked as different people.';
                  await onDone();
                  say(msg);
                  return '';
                })
              }
            >
              {mode === 'merge' ? 'Send for approval' : 'Confirm: different people'}
            </Button>
          </div>
        </div>
      )}
      {t.feedback}
    </div>
  );
}

function PendingRow({
  m,
  demo,
  canApprove,
  onDone,
  say,
}: {
  m: Pending;
  demo: boolean;
  canApprove: boolean;
  onDone: () => Promise<void>;
  say: (m: string) => void;
}) {
  const [decision, setDecision] = useState<'' | 'approve' | 'reject'>(''),
    [idCheck, setIdCheck] = useState(''),
    [choices, setChoices] = useState<Record<string, 'survivor' | 'merged'>>({}),
    [note, setNote] = useState('');
  const t = useTask();
  const differs = (
    [
      ['name', 'Name', m.survivor.name, m.merged.name],
      ['birthDate', 'Date of birth', m.survivor.birthDate, m.merged.birthDate],
      ['gender', 'Gender', m.survivor.gender, m.merged.gender],
    ] as const
  ).filter(([, , a, b]) => a && b && a !== b);
  return (
    <div className="ops-item stack">
      <p>
        Proposed by {m.proposedBy} on {when(m.proposedAt)}
        {m.note ? ` · "${m.note}"` : ''}
      </p>
      <div className="form-grid">
        <Person p={m.survivor} label="Keeps UHID" />
        <Person p={m.merged} label="Merged into it (UHID kept as alias)" />
      </div>
      {m.mine ? (
        <>
          <p className="ops-muted">You proposed this. A different administrator must approve it.</p>
          <Button
            variant="secondary"
            disabled={t.busy}
            onClick={() =>
              void t.run(async () => {
                if (!demo) await v3('patients/merges/cancel', { id: m.id });
                const msg = demo ? 'Demo only.' : 'Proposal cancelled.';
                await onDone();
                say(msg);
                return '';
              })
            }
          >
            Cancel my proposal
          </Button>
        </>
      ) : !canApprove ? (
        <p className="ops-muted">Waiting for an administrator to approve.</p>
      ) : !decision ? (
        <div className="form-grid">
          <Button onClick={() => setDecision('approve')}>Review and approve</Button>
          <Button variant="secondary" onClick={() => setDecision('reject')}>
            Reject
          </Button>
        </div>
      ) : (
        <div className="stack" role="group" aria-label="Merge decision">
          {decision === 'approve' && (
            <>
              <Notice tone="warning">
                All visits, prescriptions, documents and the online account move to {m.survivor.mrn}. Check
                the patient&apos;s identity document before approving. Record the document type only, never
                its number.
              </Notice>
              <Field label="Identity document checked">
                <select value={idCheck} onChange={(e) => setIdCheck(e.target.value)}>
                  <option value="">Choose document</option>
                  {idDocuments.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
              {differs.map(([key, label, a, b]) => (
                <Field key={key} label={`${label} to keep`}>
                  <select
                    value={choices[key] || 'survivor'}
                    onChange={(e) =>
                      setChoices((c) => ({ ...c, [key]: e.target.value as 'survivor' | 'merged' }))
                    }
                  >
                    <option value="survivor">{key === 'gender' ? human(a || '') : a}</option>
                    <option value="merged">{key === 'gender' ? human(b || '') : b}</option>
                  </select>
                </Field>
              ))}
            </>
          )}
          <Field label={decision === 'reject' ? 'Reason for rejecting (required)' : 'Note (optional)'}>
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Button variant="secondary" onClick={() => setDecision('')}>
              Back
            </Button>
            <Button
              variant={decision === 'approve' ? 'primary' : 'danger'}
              disabled={t.busy || (decision === 'approve' ? !idCheck : !note.trim())}
              onClick={() =>
                void t.run(async () => {
                  if (!demo)
                    await v3('patients/merges/decide', {
                      id: m.id,
                      approve: decision === 'approve',
                      idCheck: decision === 'approve' ? idCheck : null,
                      choices: decision === 'approve' && Object.keys(choices).length ? choices : null,
                      note: note.trim() || null,
                    });
                  const msg = demo
                    ? 'Demo only: nothing changed.'
                    : decision === 'approve'
                      ? `Merged into ${m.survivor.mrn}. ${m.merged.mrn} now finds the same patient.`
                      : 'Merge rejected.';
                  await onDone();
                  say(msg);
                  return '';
                })
              }
            >
              {decision === 'approve' ? 'Approve merge' : 'Reject merge'}
            </Button>
          </div>
        </div>
      )}
      {t.feedback}
    </div>
  );
}

function RecentRow({
  r,
  demo,
  canApprove,
  onDone,
  say,
}: {
  r: Recent;
  demo: boolean;
  canApprove: boolean;
  onDone: () => Promise<void>;
  say: (m: string) => void;
}) {
  const [undoing, setUndoing] = useState(false),
    [note, setNote] = useState('');
  const t = useTask();
  return (
    <div className="ops-item stack">
      <div className="live-card-head">
        <span>
          <strong className="break-ref">{r.mergedMrn}</strong> →{' '}
          <strong className="break-ref">{r.survivorMrn}</strong> {r.survivorName}
        </span>
        <Badge tone={r.status === 'approved' ? 'green' : 'neutral'}>
          {r.status === 'approved' ? 'Merged' : 'Undone'}
        </Badge>
      </div>
      <p className="ops-muted">
        {when(r.decidedAt)}
        {r.idCheck ? ` · ID checked: ${idDocuments.find(([k]) => k === r.idCheck)?.[1] || r.idCheck}` : ''}
      </p>
      {r.canUndo && canApprove && !undoing && (
        <Button variant="secondary" onClick={() => setUndoing(true)}>
          Undo merge
        </Button>
      )}
      {undoing && (
        <div className="stack" role="group" aria-label="Undo merge">
          <p>
            Everything that was moved returns to {r.mergedMrn}. Records added after the merge stay with{' '}
            {r.survivorMrn}.
          </p>
          <Field label="Reason for undoing (required)">
            <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="form-grid">
            <Button variant="secondary" onClick={() => setUndoing(false)}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={t.busy || note.trim().length < 5}
              onClick={() =>
                void t.run(async () => {
                  if (!demo) await v3('patients/merges/undo', { id: r.id, note: note.trim() });
                  setUndoing(false);
                  const msg = demo ? 'Demo only: nothing changed.' : 'Merge undone.';
                  await onDone();
                  say(msg);
                  return '';
                })
              }
            >
              Confirm undo
            </Button>
          </div>
        </div>
      )}
      {t.feedback}
    </div>
  );
}

/** Reception and administrators: review possible duplicates, propose, approve and undo merges. */
export function DuplicatePatients({ demo = false, canApprove }: { demo?: boolean; canApprove: boolean }) {
  const [flags, setFlags] = useState<Flag[] | null>(null),
    [merges, setMerges] = useState<Merges | null>(null),
    [outcome, setOutcome] = useState('');
  const t = useTask();
  const load = async () => {
    if (demo) {
      setFlags(
        (f) =>
          f ?? [
            {
              id: 'demo-f1',
              level: 'likely',
              source: 'online_booking',
              createdAt: demoB.registeredAt,
              patient: demoB,
              candidate: demoA,
              mergePending: false,
            },
          ],
      );
      setMerges((m) => m ?? { undoDays: null, pending: [], recent: [] });
      return;
    }
    const [f, m] = await Promise.all([v3<Flag[]>('patients/duplicates'), v3<Merges>('patients/merges')]);
    setFlags(f);
    setMerges(m);
  };
  useEffect(() => {
    void t.run(async () => {
      await load();
      return '';
    });
    // Reload only when switching demo/live; `load` and `t` are recreated every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);
  const demoPropose = (f: Flag) => {
    setFlags((x) => (x || []).filter((y) => y.id !== f.id));
    setMerges((m) => ({
      undoDays: null,
      recent: m?.recent || [],
      pending: [
        ...(m?.pending || []),
        {
          id: 'demo-m1',
          proposedAt: new Date().toISOString(),
          note: null,
          proposedBy: 'Reception (demo)',
          mine: false,
          survivor: f.candidate,
          merged: f.patient,
        },
      ],
    }));
  };
  return (
    <section className="surface ops-panel stack">
      <h2>Duplicate patients</h2>
      <Notice>
        Records are never merged automatically. A shared mobile number alone is not treated as a match,
        because families often share one phone. Merges need a second person (an administrator) who checks the
        patient&apos;s ID.
      </Notice>
      {outcome && (
        <Notice tone="success">
          <span role="status">{outcome}</span>
        </Notice>
      )}
      <h3>Possible duplicates</h3>
      {flags === null ? (
        <p aria-busy="true">Loading…</p>
      ) : flags.length === 0 ? (
        <Notice tone="success">No possible duplicates to review.</Notice>
      ) : (
        flags.map((f) => (
          <FlagRow
            key={f.id}
            f={f}
            demo={demo}
            say={setOutcome}
            onDone={async () => (demo ? demoPropose(f) : load())}
          />
        ))
      )}
      <h3>Merges waiting for approval</h3>
      {!merges ? null : merges.pending.length === 0 ? (
        <p className="ops-muted">None.</p>
      ) : (
        merges.pending.map((m) => (
          <PendingRow
            key={m.id}
            m={m}
            demo={demo}
            canApprove={canApprove}
            say={setOutcome}
            onDone={async () =>
              demo
                ? setMerges((x) => (x ? { ...x, pending: x.pending.filter((y) => y.id !== m.id) } : x))
                : load()
            }
          />
        ))
      )}
      <h3>Recent merges</h3>
      {merges && (
        <p className="ops-muted">
          {merges.undoDays === null
            ? 'Merges can currently be undone at any time.'
            : `Merges can be undone for ${merges.undoDays} days.`}
        </p>
      )}
      {merges?.recent.map((r) => (
        <RecentRow key={r.id} r={r} demo={demo} canApprove={canApprove} say={setOutcome} onDone={load} />
      ))}
      {t.feedback}
    </section>
  );
}
