'use client';
import { useState, useEffect, useRef } from 'react';
import { Button, Field, Notice, Badge, L, translate, useLanguage, When, useT } from '@hms/ui';
import { v3, type CancellationPolicy } from './v3-client';
import { v2 } from './v2-client';
import { message, when, human } from './client';
import { PolicyExplanation } from './manage-booking';
const sampleMrn = 'PT-000127';
type RxItem = {
  medicine: string;
  dose: string;
  frequency: string;
  duration: string;
  instructions: string | null;
};
type Rx = {
  id: string;
  version: number;
  doctor: string;
  registration: string;
  issuedAt: string;
  followUp: string | null;
  items: RxItem[];
};
type Paper = { id: string; name: string; verifiedAt: string | null; uploadedAt: string; canVerify: boolean };
type Visit = {
  id: string;
  reference: string;
  status: string;
  starts_at: string;
  doctor: string;
  encounter_status: string | null;
  note: string;
  vitals: Record<string, number>[];
  diagnoses: string[];
  prescriptions: Rx[];
  paper: Paper[];
};
type Timeline = {
  name: string;
  mrn: string;
  offset: number;
  history: { kind: string; detail: string; recorded_at: string }[];
  visits: Visit[];
  // Migration 023: UHIDs merged into this record, and whether an unresolved duplicate flag exists.
  formerUhids?: string[];
  possibleDuplicate?: boolean;
};
type Register = {
  patient: string;
  mrn: string;
  visits: { id: string; reference: string; status: string; doctor: string; starts_at: string }[];
  prescriptions: {
    id: string;
    reference: string;
    appointment_id: string;
    signed_at: string;
    doctor: string;
    version: number;
    handed_over_at: string | null;
    method: string | null;
    amended?: boolean;
  }[];
  // Paper copies of superseded or withdrawn versions that reception must collect back.
  recall?: {
    id: string;
    reference: string;
    version: number;
    status: string;
    method: string;
    handed_over_at: string;
    doctor: string;
  }[];
  paper: { document_id: string; reference: string; uploaded_at: string; verified_at: string | null }[];
};
const demoDate = '2026-11-24T05:30:00Z';
const sample: Timeline = {
  formerUhids: ['PT-000391'],
  possibleDuplicate: true,
  name: 'Sample Patient',
  mrn: sampleMrn,
  offset: 0,
  history: [
    { kind: 'allergy', detail: 'Fictional allergy record — not for clinical use', recorded_at: demoDate },
  ],
  visits: [
    {
      id: 'visit-2',
      reference: 'BK-00012A7',
      status: 'completed',
      starts_at: demoDate,
      doctor: 'Dr. Ananya Sharma',
      encounter_status: 'signed',
      note: 'Fictional follow-up note for UI review.',
      vitals: [{ pulse: 76, systolic: 120, diastolic: 80 }],
      diagnoses: ['Demo observation'],
      prescriptions: [
        {
          id: 'DEMO-RX-002',
          version: 1,
          doctor: 'Dr. Ananya Sharma',
          registration: 'DEMO',
          issuedAt: demoDate,
          followUp: '2026-12-01',
          items: [
            {
              medicine: 'Example medicine — demo only',
              dose: 'Sample',
              frequency: 'Sample',
              duration: 'Sample',
              instructions: 'Not medical advice',
            },
          ],
        },
      ],
      paper: [
        {
          id: 'paper-1',
          name: 'Sample paper prescription.pdf',
          verifiedAt: null,
          uploadedAt: demoDate,
          canVerify: true,
        },
      ],
    },
    {
      id: 'visit-1',
      reference: 'BK-00000K2',
      status: 'completed',
      starts_at: '2026-10-15T06:00:00Z',
      doctor: 'Dr. Ananya Sharma',
      encounter_status: 'signed',
      note: 'Earlier fictional visit.',
      vitals: [],
      diagnoses: [],
      prescriptions: [],
      paper: [],
    },
  ],
};
const sampleRegister: Register = {
  patient: sample.name,
  mrn: sample.mrn,
  visits: sample.visits.map((v) => ({
    id: v.id,
    reference: v.reference,
    status: v.status,
    doctor: v.doctor,
    starts_at: v.starts_at,
  })),
  prescriptions: [
    {
      id: 'DEMO-RX-002',
      reference: 'BK-00012A7',
      appointment_id: 'visit-2',
      signed_at: demoDate,
      doctor: 'Dr. Ananya Sharma',
      version: 2,
      handed_over_at: null,
      method: null,
      amended: true,
    },
  ],
  recall: [
    {
      id: 'DEMO-RX-001',
      reference: 'BK-00012A7',
      version: 1,
      status: 'superseded',
      method: 'printed',
      handed_over_at: demoDate,
      doctor: 'Dr. Ananya Sharma',
    },
  ],
  paper: [{ document_id: 'paper-1', reference: 'BK-00012A7', uploaded_at: demoDate, verified_at: null }],
};
function useWork() {
  const [busy, setBusy] = useState(false),
    [err, setErr] = useState(''),
    [ok, setOk] = useState('');
  const lock = useRef(false);
  async function run(task: () => Promise<void>, success = '') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      await task();
      setOk(success);
    } catch (e) {
      setErr(message(e));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return {
    busy,
    run,
    feedback: (
      <>
        {err && (
          <p role="alert" className="form-error">
            <L en={err} />
          </p>
        )}
        {ok && <Notice tone="success">{ok}</Notice>}
      </>
    ),
  };
}
function SearchBox({
  value,
  onChange,
  onSearch,
  busy,
}: {
  value: string;
  onChange: (s: string) => void;
  onSearch: () => void;
  busy: boolean;
}) {
  const tx = useT();
  return (
    <form
      className="mrn-search"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch();
      }}
    >
      <Field label="Patient number" hint="Example: PT-000127 (existing MRN numbers also work)">
        <input
          value={value}
          required
          maxLength={40}
          placeholder={tx('PT-000127')}
          autoComplete="off"
          disabled={busy}
          onChange={(e) => onChange(e.target.value)}
        />
      </Field>
      <Button type="submit" icon="search" disabled={busy || value.trim().length < 3}>
        Search
      </Button>
    </form>
  );
}
export function PatientTimeline({ demo = false }: { demo?: boolean }) {
  const [mrn, setMrn] = useState(demo ? sampleMrn : ''),
    [data, setData] = useState<Timeline | null>(null),
    [searched, setSearched] = useState(false),
    [offset, setOffset] = useState(0);
  const w = useWork();
  const lang = useLanguage();
  async function search(next = 0) {
    await w.run(async () => {
      const result = demo
        ? mrn.trim().toUpperCase() === sampleMrn && next === 0
          ? sample
          : null
        : await v3<Timeline | null>('timeline', { mrn, offset: next });
      setData(result);
      setOffset(next);
      setSearched(true);
    });
  }
  function verify(p: Paper) {
    void w.run(
      async () => {
        if (!demo) await v3('prescription/verify', { id: p.id });
        setData((old) =>
          old
            ? {
                ...old,
                visits: old.visits.map((v) => ({
                  ...v,
                  paper: v.paper.map((x) =>
                    x.id === p.id ? { ...x, verifiedAt: new Date().toISOString() } : x,
                  ),
                })),
              }
            : old,
        );
      },
      lang === 'hi' ? 'प्रति सत्यापित की गई।' : 'Paper copy marked verified.',
    );
  }
  return (
    <section className="surface ops-panel stack">
      <div>
        <span className="eyebrow">
          <L en="Clinical records" hi="चिकित्सा रिकॉर्ड" />
        </span>
        <h2>
          <L en="Patient history search" />
        </h2>
        <p>
          <L
            en="Find a patient's longitudinal record by permanent patient number. Access is limited to assigned care within this branch."
            hi="स्थायी रोगी संख्या से रोगी का पूरा उपलब्ध इतिहास खोजें। केवल इस शाखा में अधिकृत देखभाल के रिकॉर्ड उपलब्ध हैं।"
          />
        </p>
      </div>
      <Notice>
        <L
          en="Clinical text, medication names and instructions remain in the original recorded language."
          hi="चिकित्सा विवरण, दवाओं के नाम और निर्देश मूल दर्ज भाषा में ही दिखाए जाते हैं।"
        />
      </Notice>
      <SearchBox
        value={mrn}
        onChange={(s) => {
          setMrn(s);
          setData(null);
          setSearched(false);
        }}
        busy={w.busy}
        onSearch={() => void search()}
      />
      {w.feedback}
      {searched && !data && (
        <Notice tone="warning">
          <L en="No authorized patient record found." hi="कोई अधिकृत रोगी रिकॉर्ड नहीं मिला।" />
        </Notice>
      )}
      {data && (
        <>
          <div className="history-card live-card-head">
            <div>
              <h2>{data.name}</h2>
              <p>
                <L en="Patient number" /> · {data.mrn}
              </p>
              {!!data.formerUhids?.length && (
                <p>
                  <L en="Also recorded as" hi="इन नंबरों से भी दर्ज" /> · {data.formerUhids.join(', ')}
                </p>
              )}
            </div>
            <Badge tone="teal">
              <L en="Care access verified" hi="देखभाल अनुमति सत्यापित" />
            </Badge>
          </div>
          {data.possibleDuplicate && (
            <Notice tone="warning">
              <L
                en="This patient may have another record. History from that record is not shown here. Ask reception to review it under Duplicate patients."
                hi="इस रोगी का एक और रिकॉर्ड हो सकता है। उस रिकॉर्ड का इतिहास यहाँ नहीं दिखता। रिसेप्शन से 'डुप्लिकेट रोगी' में जाँच करने को कहें।"
              />
            </Notice>
          )}
          <div className="history-card stack">
            <h3>
              <L en="Allergies & medical history" hi="एलर्जी और चिकित्सा इतिहास" />
            </h3>
            {!data.history.length && (
              <p>
                <L en="No entries recorded" hi="कोई जानकारी दर्ज नहीं है" />
              </p>
            )}
            {data.history.map((h, i) => (
              <div className="ops-item" key={i}>
                <Badge>{human(h.kind)}</Badge>
                <p>{h.detail}</p>
                <small>
                  <When iso={h.recorded_at} />
                </small>
              </div>
            ))}
          </div>
          <h3>
            <L en="Visit timeline" hi="मुलाकातों का इतिहास" />
          </h3>
          {!data.visits.length && (
            <Notice>
              <L en="No visits in this page" hi="इस पृष्ठ में कोई मुलाकात नहीं है" />
            </Notice>
          )}
          {data.visits.map((v) => (
            <article className="history-card stack" key={v.id}>
              <div className="live-card-head">
                <div>
                  <h3>{v.reference}</h3>
                  <p>
                    <When iso={v.starts_at} /> · {v.doctor}
                  </p>
                </div>
                <Badge tone={v.status === 'completed' ? 'green' : 'neutral'}>{human(v.status)}</Badge>
              </div>
              {v.note && (
                <details>
                  <summary>
                    <L en="Consultation notes" hi="परामर्श नोट्स" />
                  </summary>
                  <p className="note">{v.note}</p>
                </details>
              )}
              {v.diagnoses.length > 0 && (
                <details>
                  <summary>
                    <L en="Recorded diagnoses" hi="दर्ज निदान" />
                  </summary>
                  {v.diagnoses.map((d, i) => (
                    <p key={i}>{d}</p>
                  ))}
                </details>
              )}
              {v.vitals.length > 0 && (
                <details>
                  <summary>
                    <L en="Vitals" hi="शारीरिक माप" />
                  </summary>
                  {v.vitals.map((x, i) => (
                    <dl className="live-dl" key={i}>
                      {Object.entries(x).map(([k, val]) => (
                        <div className="history-row" key={k}>
                          <dt>{k}</dt>
                          <dd>{val}</dd>
                        </div>
                      ))}
                    </dl>
                  ))}
                </details>
              )}
              {v.prescriptions.map((r) => (
                <details key={r.id} open={v.id === data.visits[0]?.id}>
                  <summary>
                    <L en="Doctor-issued prescription" hi="डॉक्टर द्वारा जारी प्रिस्क्रिप्शन" /> · {r.version}
                  </summary>
                  <p className="text-sm">
                    {r.doctor} · {r.registration} · <When iso={r.issuedAt} />
                  </p>
                  <div className="rx-table">
                    {r.items.map((x, i) => (
                      <div className="rx-item" key={i}>
                        <strong>{x.medicine}</strong>
                        <p>
                          {x.dose} · {x.frequency} · {x.duration}
                        </p>
                        {x.instructions && <p>{x.instructions}</p>}
                      </div>
                    ))}
                  </div>
                  {r.followUp && (
                    <p>
                      <L en="Follow-up" hi="अगली मुलाकात" />: {r.followUp}
                    </p>
                  )}
                </details>
              ))}
              {v.paper.map((p) => (
                <div className="ops-item stack" key={p.id}>
                  <div className="live-card-head">
                    <div>
                      <strong>
                        <L en="Paper prescription" hi="कागज़ी प्रिस्क्रिप्शन" />
                      </strong>
                      <p>{p.name}</p>
                    </div>
                    <Badge tone={p.verifiedAt ? 'green' : 'amber'}>
                      <L
                        en={p.verifiedAt ? 'Verified' : 'Awaiting clinician review'}
                        hi={p.verifiedAt ? 'सत्यापित' : 'डॉक्टर की समीक्षा बाकी'}
                      />
                    </Badge>
                  </div>
                  <div className="live-actions">
                    <Button
                      variant="secondary"
                      disabled={w.busy}
                      onClick={() =>
                        void w.run(async () => {
                          if (demo) throw new Error('Preview only — no real file.');
                          const r = await v2<{ url: string }>(
                            'documents/download?id=' + encodeURIComponent(p.id),
                          );
                          window.location.assign(r.url);
                        })
                      }
                    >
                      <L en="View private copy" hi="निजी प्रति देखें" />
                    </Button>
                    {p.canVerify && !p.verifiedAt && (
                      <Button
                        disabled={w.busy}
                        onClick={() => {
                          if (
                            confirm(
                              lang === 'hi'
                                ? 'मूल प्रिस्क्रिप्शन की जाँच करके ही पुष्टि करें।'
                                : 'Confirm only after checking the original prescription.',
                            )
                          )
                            verify(p);
                        }}
                      >
                        <L en="Verify copy" hi="प्रति सत्यापित करें" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </article>
          ))}
          <div className="live-actions">
            <Button
              variant="secondary"
              disabled={w.busy || offset === 0}
              onClick={() => void search(Math.max(0, offset - 25))}
            >
              <L en="Previous visits" hi="पिछला पृष्ठ" />
            </Button>
            <Button
              variant="secondary"
              disabled={w.busy || data.visits.length < 25}
              onClick={() => void search(offset + 25)}
            >
              <L en="Older visits" hi="पुरानी मुलाकातें" />
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
export function PrescriptionRegister({ demo = false }: { demo?: boolean }) {
  const tx = useT();
  const [mrn, setMrn] = useState(demo ? sampleMrn : ''),
    [data, setData] = useState<Register | null>(null),
    [searched, setSearched] = useState(false),
    [visit, setVisit] = useState(''),
    [file, setFile] = useState<File | null>(null);
  const w = useWork();
  const lang = useLanguage();
  async function load() {
    const result = demo
      ? mrn.trim().toUpperCase() === sampleMrn
        ? sampleRegister
        : null
      : await v3<Register | null>('prescription-register', { mrn });
    setData(result);
    setSearched(true);
    setVisit('');
  }
  return (
    <section className="surface ops-panel stack">
      <h2>
        <L en="Prescription register" />
      </h2>
      <p>
        <L
          en="Doctor-issued prescriptions are saved automatically. Reception can record handover or archive a scanned copy of a paper prescription."
          hi="डॉक्टर द्वारा जारी प्रिस्क्रिप्शन अपने आप सहेजे जाते हैं। रिसेप्शन प्रिस्क्रिप्शन देने का रिकॉर्ड रख सकता है या कागज़ी प्रिस्क्रिप्शन की स्कैन प्रति सहेज सकता है।"
        />
      </p>
      <Notice>
        <L
          en="Reception cannot read or modify medication instructions. A paper copy is not a new prescription and requires clinician verification."
          hi="रिसेप्शन दवा निर्देश पढ़ या बदल नहीं सकता। स्कैन प्रति नया प्रिस्क्रिप्शन नहीं है और डॉक्टर की पुष्टि आवश्यक है।"
        />
      </Notice>
      <SearchBox
        value={mrn}
        onChange={(s) => {
          setMrn(s);
          setData(null);
          setSearched(false);
        }}
        busy={w.busy}
        onSearch={() => void w.run(load)}
      />
      {w.feedback}
      {searched && !data && (
        <Notice tone="warning">
          <L en="No patient found in this branch." hi="इस शाखा में रोगी नहीं मिला।" />
        </Notice>
      )}
      {data && (
        <>
          <div className="history-card">
            <h2>{data.patient}</h2>
            <p>{data.mrn}</p>
          </div>
          <h3>
            <L en="Issued prescriptions" hi="जारी प्रिस्क्रिप्शन" />
          </h3>
          {!data.prescriptions.length && (
            <Notice>
              <L en="No signed prescriptions yet." hi="अभी कोई जारी प्रिस्क्रिप्शन नहीं है।" />
            </Notice>
          )}
          {data.prescriptions.map((r) => (
            <div className="history-card stack" key={r.id}>
              <div className="live-card-head">
                <div>
                  <strong>{r.reference}</strong>
                  <p>
                    {r.doctor} · <When iso={r.signed_at} />
                    {r.amended && (
                      <>
                        {' '}
                        · <L en={`Amended (version ${r.version})`} hi={`संशोधित (संस्करण ${r.version})`} />
                      </>
                    )}
                  </p>
                </div>
                <Badge tone={r.handed_over_at ? 'green' : 'amber'}>
                  <L
                    en={r.handed_over_at ? 'Handed over' : 'Not handed over'}
                    hi={r.handed_over_at ? 'प्रिस्क्रिप्शन दिया गया' : 'प्रिस्क्रिप्शन देना बाकी'}
                  />
                </Badge>
              </div>
              {r.handed_over_at ? (
                <p>
                  <When iso={r.handed_over_at} /> · <L en={human(r.method || 'printed')} />
                </p>
              ) : (
                <Button
                  disabled={w.busy}
                  variant="secondary"
                  onClick={() =>
                    void w.run(
                      async () => {
                        if (demo)
                          setData((old) =>
                            old
                              ? {
                                  ...old,
                                  prescriptions: old.prescriptions.map((x) =>
                                    x.id === r.id
                                      ? { ...x, handed_over_at: new Date().toISOString(), method: 'printed' }
                                      : x,
                                  ),
                                }
                              : old,
                          );
                        else {
                          await v3('prescription/handover', { id: r.id, method: 'printed' });
                          await load();
                        }
                      },
                      lang === 'hi' ? 'प्रिस्क्रिप्शन देने का रिकॉर्ड सहेजा गया।' : 'Handover recorded.',
                    )
                  }
                >
                  <L en="Record printed handover" hi="प्रिंट किया हुआ प्रिस्क्रिप्शन देने का रिकॉर्ड रखें" />
                </Button>
              )}
            </div>
          ))}
          {!!data.recall?.length && (
            <>
              <h3>
                <L en="Paper copies to recall" hi="वापस लेने वाली कागज़ी प्रतियाँ" />
              </h3>
              <Notice tone="warning">
                <L
                  en="These printed copies were replaced or withdrawn by the doctor and are no longer valid. Collect them from the patient (or confirm they were destroyed), then mark them recalled."
                  hi="डॉक्टर ने ये छपी प्रतियाँ बदल दी हैं या वापस ले ली हैं और अब मान्य नहीं हैं। रोगी से वापस लें (या नष्ट होने की पुष्टि करें), फिर वापस ली गई चिह्नित करें।"
                />
              </Notice>
              {data.recall.map((r) => (
                <div className="history-card stack" key={r.id}>
                  <div className="live-card-head">
                    <div>
                      <strong>{r.reference}</strong>
                      <p>
                        {r.doctor} · <L en={`Version ${r.version}`} hi={`संस्करण ${r.version}`} /> ·{' '}
                        <When iso={r.handed_over_at} />
                      </p>
                    </div>
                    <Badge tone="red">
                      <L
                        en={r.status === 'void' ? 'Withdrawn' : 'Replaced'}
                        hi={r.status === 'void' ? 'वापस लिया गया' : 'बदला गया'}
                      />
                    </Badge>
                  </div>
                  <Button
                    disabled={w.busy}
                    variant="secondary"
                    onClick={() =>
                      void w.run(
                        async () => {
                          if (demo)
                            setData((old) =>
                              old ? { ...old, recall: (old.recall || []).filter((x) => x.id !== r.id) } : old,
                            );
                          else {
                            await v3('prescription/recall', { id: r.id });
                            await load();
                          }
                        },
                        lang === 'hi' ? 'वापसी दर्ज की गई।' : 'Recall recorded.',
                      )
                    }
                  >
                    <L en="Mark paper copy recalled" hi="कागज़ी प्रति वापस ली गई चिह्नित करें" />
                  </Button>
                </div>
              ))}
            </>
          )}
          <h3>
            <L en="Archive a paper prescription" hi="कागज़ी प्रिस्क्रिप्शन की प्रति सहेजें" />
          </h3>
          <form
            className="history-card stack"
            onSubmit={(e) => {
              e.preventDefault();
              void w.run(
                async () => {
                  if (!visit || !file) return;
                  if (demo) {
                    setData((old) =>
                      old
                        ? {
                            ...old,
                            paper: [
                              {
                                document_id: 'demo-' + Date.now(),
                                reference: old.visits.find((v) => v.id === visit)?.reference || '',
                                uploaded_at: new Date().toISOString(),
                                verified_at: null,
                              },
                              ...old.paper,
                            ],
                          }
                        : old,
                    );
                  } else {
                    const form = new FormData();
                    form.set('appointment', visit);
                    form.set('file', file);
                    await v3('prescription/paper', form);
                    await load();
                  }
                  setFile(null);
                },
                lang === 'hi'
                  ? 'प्रति सहेजी गई; डॉक्टर की समीक्षा बाकी है।'
                  : 'Copy archived; clinician review pending.',
              );
            }}
          >
            <Field label="Visit">
              <select value={visit} required onChange={(e) => setVisit(e.target.value)}>
                <option value="">{translate('Select an appointment', lang)}</option>
                {data.visits.map((v) => (
                  <option key={v.id} value={v.id}>
                    {tx(String(v.reference))} · {when(v.starts_at)} · {tx(String(v.doctor))}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Prescription copy (PDF, PNG or JPEG)"
              hint="Max 4 MB. Secure malware scanning is mandatory."
            >
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                required
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </Field>
            <Button
              type="submit"
              disabled={!visit || !file || file.size > 4 * 1024 * 1024 || w.busy}
              icon="file"
            >
              <L en="Archive private copy" hi="निजी प्रति सहेजें" />
            </Button>
          </form>
          {data.paper.map((p) => (
            <div className="history-card live-card-head" key={p.document_id}>
              <div>
                <strong>{p.reference}</strong>
                <p>
                  <When iso={p.uploaded_at} />
                </p>
              </div>
              <Badge tone={p.verified_at ? 'green' : 'amber'}>
                <L
                  en={p.verified_at ? 'Verified' : 'Awaiting clinician review'}
                  hi={p.verified_at ? 'सत्यापित' : 'डॉक्टर की समीक्षा बाकी'}
                />
              </Badge>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
export function CancellationPolicySettings({ demo = false }: { demo?: boolean }) {
  const [policy, setPolicy] = useState<CancellationPolicy | null>(null),
    [fee, setFee] = useState(''),
    [hours, setHours] = useState('24'),
    [accept, setAccept] = useState(false);
  const w = useWork();
  const lang = useLanguage();
  useEffect(() => {
    void w.run(async () => {
      const p = demo ? { feePaise: 5000, freeHours: 24, version: 1 } : await v3<CancellationPolicy>('policy');
      setPolicy(p);
      setFee((p.feePaise / 100).toFixed(2));
      setHours(String(p.freeHours));
    });
  }, [demo]);
  return (
    <section className="surface ops-panel stack">
      <h2>
        <L en="Cancellation policy" />
      </h2>
      <Notice tone="warning">
        <L
          en="Live default is zero deduction. Set a fee only after approval of the hospital's published cancellation terms. Changes apply to new bookings only."
          hi="लाइव डिफ़ॉल्ट कटौती शून्य है। अस्पताल की प्रकाशित रद्दीकरण नीति की मंज़ूरी के बाद ही शुल्क तय करें। बदलाव केवल नई बुकिंग पर लागू होंगे।"
        />
      </Notice>
      {policy && (
        <>
          <PolicyExplanation policy={policy} />
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void w.run(
                async () => {
                  const next = {
                    feePaise: Math.round(Number(fee) * 100),
                    freeHours: Number(hours),
                    version: policy.version,
                  };
                  const result = demo
                    ? { ...next, version: policy.version + 1 }
                    : await v3<CancellationPolicy>('policy', next);
                  setPolicy(result);
                  setAccept(false);
                },
                lang === 'hi' ? 'नई नीति सहेजी गई।' : 'Policy saved for future bookings.',
              );
            }}
          >
            <Field label="Late cancellation fee (₹)">
              <input
                type="number"
                min="0"
                max="100000"
                step="0.01"
                required
                value={fee}
                onChange={(e) => {
                  setFee(e.target.value);
                  setAccept(false);
                }}
              />
            </Field>
            <Field label="Free cancellation cutoff (hours before appointment)">
              <input
                type="number"
                min="0"
                max="720"
                step="1"
                required
                value={hours}
                onChange={(e) => {
                  setHours(e.target.value);
                  setAccept(false);
                }}
              />
            </Field>
            <label className="check-field">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <L
                en="I confirm this policy has been approved and will be disclosed before payment."
                hi="मैं पुष्टि करता/करती हूँ कि नीति स्वीकृत है और भुगतान से पहले दिखाई जाएगी।"
              />
            </label>
            <Button
              type="submit"
              disabled={!accept || w.busy || !fee || !hours || Number(fee) < 0 || Number(hours) < 0}
            >
              <L en="Save policy" hi="नीति सहेजें" />
            </Button>
          </form>
        </>
      )}
      {w.feedback}
    </section>
  );
}
