'use client';
import * as React from 'react';
import { Brand, Button, Icon, Avatar, Badge, Notice, Field, Empty, L, T, useT } from '@hms/ui';
import {
  doctors,
  articles,
  services,
  type Role,
  type Appointment,
  type Patient,
  type AppointmentStatus,
} from '@hms/types';
import { formatINR } from '@hms/validation';
import {
  initialAppointments,
  initialPatients,
  roleLabels,
  roleUsers,
  roleNav,
  demoUsers,
  permissionRows,
} from '../lib/demo';
type Modal = {
  kind:
    | 'appointment'
    | 'patient'
    | 'newAppointment'
    | 'newPatient'
    | 'consultation'
    | 'prescription'
    | 'payment'
    | 'content'
    | 'user';
  id?: string;
  title: string;
};
type State = {
  appointments: Appointment[];
  patients: Patient[];
  search: string;
  filter: string;
  menu: boolean;
  modal: Modal | null;
  toast: React.ReactNode;
  notifications: boolean;
  draftName: string;
  draftDoctor: string;
  draftTime: string;
  draftDate: string;
  draftService: string;
  draftNote: string;
  draftDrug: string;
  draftStatus: string;
  draftAmount: string;
  draftContent: string;
  draftRole: string;
  draftName2: string;
  error: string;
  consults: { id: string; patient: string; status: string; note: string }[];
  prescriptions: { id: string; patient: string; status: string; item: string }[];
  audit: { event: React.ReactNode; actor: string; time: string }[];
  contentStates: Record<string, string>;
  staffStates: Record<string, string>;
  schedule: Record<string, boolean>;
  settings: { name: string; timezone: string; slot: string; email: boolean; sms: boolean };
};
const statusTone = (status: string): 'neutral' | 'green' | 'amber' | 'blue' | 'red' | 'teal' =>
  (
    ({
      Confirmed: 'blue',
      'Checked in': 'amber',
      'In consultation': 'teal',
      Completed: 'green',
      Cancelled: 'red',
      'No-show': 'neutral',
      Paid: 'green',
      Unpaid: 'amber',
      Refunded: 'neutral',
      Active: 'green',
      Inactive: 'neutral',
      Draft: 'amber',
      Published: 'green',
      Approved: 'teal',
      'Medical review': 'blue',
    }) as Record<string, 'neutral' | 'green' | 'amber' | 'blue' | 'red' | 'teal'>
  )[status] || 'neutral';
/** Translate plain strings from demo data; leave elements and numbers untouched. */
const lx = (v: React.ReactNode) => (typeof v === 'string' ? <L en={v} /> : v);
function Status({ value }: { value: string }) {
  return <Badge tone={statusTone(value)}>{value}</Badge>;
}
function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface work-card ${className}`}>
      <header className="card-head">
        <div>
          <h2>
            <L en={title} />
          </h2>
          {subtitle && (
            <p>
              <L en={subtitle} />
            </p>
          )}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}
function Metric({
  label,
  value,
  icon,
  sub,
  tone = 'mint',
}: {
  label: string;
  value: string | number;
  icon: string;
  sub: string;
  tone?: string;
}) {
  return (
    <div className="surface metric">
      <div className="metric-top">
        <span>
          <L en={label} />
        </span>
        <span className={`metric-icon metric-${tone}`}>
          <Icon name={icon} size={20} />
        </span>
      </div>
      <strong>{value}</strong>
      <small>{typeof sub === 'string' ? <L en={sub} /> : sub}</small>
    </div>
  );
}
function Table({
  headers,
  children,
  label,
}: {
  headers: string[];
  children: React.ReactNode;
  label: string;
}) {
  const tx = useT();
  return (
    <div
      className="table-wrap"
      tabIndex={0}
      role="region"
      aria-label={tx('{0} table, scroll horizontally if needed').replace('{0}', tx(label))}
    >
      <table>
        <caption className="sr-only">
          <L en={label} />
        </caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {lx(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
function initials(s: string) {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => x[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
const times = [
  '09:00 AM',
  '09:30 AM',
  '10:00 AM',
  '10:30 AM',
  '11:00 AM',
  '11:30 AM',
  '12:00 PM',
  '02:00 PM',
  '02:30 PM',
  '03:00 PM',
  '03:30 PM',
  '04:00 PM',
];
const sectionDescriptions: Record<string, string> = {
  dashboard: 'A clear view of your daily hospital operations.',
  appointments: 'Manage upcoming visits and track appointment status.',
  patients: 'Find and manage fictional patient records.',
  consultations: 'Review assigned visits and draft sample consultation notes.',
  prescriptions: 'Review sample prescription records. No real medicines are prescribed.',
  schedule: 'Preview your weekly consultation availability.',
  queue: 'Track arrivals, waiting patients and active consultations.',
  billing: 'Review consultation invoices and outstanding amounts.',
  payments: 'Track simulated collection and payment status.',
  doctors: 'Manage doctor directory and availability information.',
  staff: 'Review team memberships and role assignments.',
  roles: 'Preview the permission model for each role.',
  finance: 'View illustrative revenue and collections.',
  reports: 'Explore operational metrics from sample data.',
  content: 'Review website publishing workflows.',
  audit: 'Inspect local demo activity events.',
  settings: 'Review configuration and preferences.',
};
type WorkspaceProps = { role: Role; section: string; websiteUrl: string };
/** Supplies the translator to the class component, which cannot call hooks itself. */
export function Workspace(props: WorkspaceProps) {
  const tx = useT();
  return <DemoWorkspace {...props} tx={tx} />;
}
class DemoWorkspace extends React.Component<WorkspaceProps & { tx: (en: string) => string }, State> {
  state: State = {
    appointments: initialAppointments.map((a) => ({ ...a })),
    patients: initialPatients.map((p) => ({ ...p })),
    search: '',
    filter: 'All',
    menu: false,
    modal: null,
    toast: '',
    notifications: false,
    draftName: '',
    draftDoctor: doctors[0].name,
    draftTime: times[0],
    draftDate: 'Today',
    draftService: 'General consultation',
    draftNote: '',
    draftDrug: '',
    draftStatus: 'Draft',
    draftAmount: '500',
    draftContent: '',
    draftRole: 'Receptionist',
    draftName2: '',
    error: '',
    consults: [
      {
        id: 'CON-1001',
        patient: 'Sample Patient A',
        status: 'Completed',
        note: 'Fictional consultation summary.',
      },
    ],
    prescriptions: [
      {
        id: 'RX-1001',
        patient: 'Sample Patient A',
        status: 'Draft',
        item: 'Demo item — not a medication order',
      },
    ],
    audit: [
      { event: 'Demo workspace opened', actor: 'System', time: 'Just now' },
      { event: 'Sample booking created', actor: 'Reception', time: 'Earlier today' },
    ],
    contentStates: {},
    staffStates: {},
    schedule: { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true, Sun: false },
    settings: { name: 'Aarogya Care (demo)', timezone: 'Asia/Kolkata', slot: '30', email: true, sms: false },
  };
  modalRef: { current: HTMLDivElement | null } = { current: null };
  previousFocus: HTMLElement | null = null;
  componentDidUpdate(
    _p: Readonly<{ role: Role; section: string; websiteUrl: string }>,
    prev: Readonly<State>,
  ) {
    if (!prev.modal && this.state.modal) {
      this.previousFocus = document.activeElement as HTMLElement;
      this.modalRef.current?.focus();
    }
    if (prev.modal && !this.state.modal) this.previousFocus?.focus();
  }
  get role() {
    return this.props.role;
  }
  get scopedAppointments() {
    return this.role === 'doctor'
      ? this.state.appointments.filter((a) => a.doctor === doctors[0].name)
      : this.state.appointments;
  }
  get scopedPatients() {
    return this.role === 'doctor'
      ? this.state.patients.filter((p) => p.doctor === doctors[0].name)
      : this.state.patients;
  }
  link = (id: string) => `/${this.role}${id === 'dashboard' ? '' : `/${id}`}`;
  flash = (message: React.ReactNode) =>
    this.setState((s) => ({
      toast: message,
      audit: [{ event: message, actor: roleLabels[this.role], time: 'Just now' }, ...s.audit],
    }));
  open = (kind: Modal['kind'], title: string, id?: string) => {
    const a = this.state.appointments.find((x) => x.id === id),
      p = this.state.patients.find((x) => x.id === id);
    this.setState({
      modal: { kind, title, id },
      draftName: a?.patient || p?.name || 'Sample Patient I',
      draftDoctor: a?.doctor || doctors[0].name,
      draftTime: times[0],
      draftDate: 'Today',
      draftService: 'General consultation',
      draftNote: 'Fictional demo note — no clinical instruction.',
      draftDrug: 'Sample item (not a medicine)',
      draftStatus: this.state.contentStates[id || ''] || 'Draft',
      draftAmount: '500',
      draftContent: 'Sample content for review.',
      draftRole: 'Receptionist',
      draftName2: '',
      error: '',
    });
  };
  close = () => this.setState({ modal: null, error: '' });
  changeStatus = (id: string, status: AppointmentStatus) => {
    this.setState((s) => ({
      appointments: s.appointments.map((a) => (a.id === id ? { ...a, status } : a)),
      modal: null,
    }));
    this.flash(<T en="Demo appointment {0}: {1}." values={[id, <L key="s" en={status} />]} />);
  };
  save = () => {
    const s = this.state,
      m = s.modal;
    if (!m) return;
    const fail = (error: string) => this.setState({ error });
    if (m.kind === 'newPatient') {
      if (!/^Sample Patient [A-Z][A-Z0-9 -]{0,20}$/i.test(s.draftName.trim()))
        return fail('Use a fictional name starting with Sample Patient.');
      if (s.patients.some((p) => p.name.toLowerCase() === s.draftName.trim().toLowerCase()))
        return fail('That sample patient already exists.');
      this.setState((x) => ({
        patients: [
          ...x.patients,
          {
            id: `MRN-${String(101 + x.patients.length).padStart(5, '0')}`,
            name: s.draftName.trim(),
            age: 30,
            gender: 'Not specified',
            lastVisit: 'No recent visit',
            doctor: s.draftDoctor,
          },
        ],
        modal: null,
      }));
      this.flash('Sample patient registered in this page only.');
    } else if (m.kind === 'newAppointment') {
      if (!s.patients.some((p) => p.name === s.draftName)) return fail('Select an existing sample patient.');
      if (
        s.appointments.some(
          (a) =>
            a.doctor === s.draftDoctor &&
            a.date === s.draftDate &&
            a.time === s.draftTime &&
            !['Cancelled', 'No-show'].includes(a.status),
        )
      )
        return fail('That doctor already has a sample appointment at this time.');
      this.setState((x) => ({
        appointments: [
          ...x.appointments,
          {
            id: `APT-${1001 + x.appointments.length}`,
            patient: s.draftName,
            initials: initials(s.draftName),
            doctor: s.draftDoctor,
            time: s.draftTime,
            date: s.draftDate,
            service: s.draftService,
            status: 'Confirmed',
            payment: 'Unpaid',
          },
        ],
        modal: null,
      }));
      this.flash('Sample appointment created in this page only.');
    } else if (m.kind === 'consultation') {
      if (this.role !== 'doctor') return;
      const a = this.scopedAppointments.find((x) => x.id === m.id);
      if (!a) return fail('No assigned appointment selected.');
      if (!s.draftNote.trim()) return fail('Choose the sample note.');
      this.setState((x) => ({
        consults: [
          ...x.consults,
          { id: `CON-${1001 + x.consults.length}`, patient: a.patient, status: 'Draft', note: s.draftNote },
        ],
        modal: null,
      }));
      this.flash('Demo consultation draft created.');
    } else if (m.kind === 'prescription') {
      if (this.role !== 'doctor') return;
      if (!this.scopedPatients.some((p) => p.name === s.draftName))
        return fail('Select an assigned sample patient.');
      this.setState((x) => ({
        prescriptions: [
          ...x.prescriptions,
          {
            id: `RX-${1001 + x.prescriptions.length}`,
            patient: s.draftName,
            status: 'Draft',
            item: s.draftDrug,
          },
        ],
        modal: null,
      }));
      this.flash('Sample prescription draft created. Not a medical order.');
    } else if (m.kind === 'payment') {
      if (this.role === 'doctor') return;
      const a = s.appointments.find((x) => x.id === m.id);
      if (!a || a.payment !== 'Unpaid') return fail('No unpaid sample invoice selected.');
      this.setState((x) => ({
        appointments: x.appointments.map((v) => (v.id === m.id ? { ...v, payment: 'Paid' } : v)),
        modal: null,
      }));
      this.flash('Simulated collection recorded. No money collected.');
    } else if (m.kind === 'content') {
      this.setState((x) => ({ contentStates: { ...x.contentStates, [m.id!]: s.draftStatus }, modal: null }));
      this.flash(
        <T
          en="Demo content state changed to {0}. Website not changed."
          values={[<L key="s" en={s.draftStatus} />]}
        />,
      );
    } else if (m.kind === 'user') {
      this.setState((x) => ({ staffStates: { ...x.staffStates, [m.id!]: s.draftStatus }, modal: null }));
      this.flash(
        <T
          en="Demo membership state updated to {0}. No account changed."
          values={[<L key="s" en={s.draftStatus} />]}
        />,
      );
    }
  };
  get selectedSection() {
    return roleNav[this.role].flatMap((g) => g.items).find((x) => x.id === this.props.section)!;
  }
  filteredAppointments() {
    const s = this.state;
    return this.scopedAppointments.filter(
      (a) =>
        (s.filter === 'All' || a.status === s.filter) &&
        `${a.patient} ${a.doctor} ${a.id} ${a.service}`.toLowerCase().includes(s.search.toLowerCase()),
    );
  }
  appointmentTable(items: Appointment[], compact = false) {
    return (
      <>
        {items.length === 0 ? (
          <Empty
            title="No appointments found"
            description="Try adjusting the search or status filter."
            icon="calendar"
          />
        ) : (
          <Table
            label="Appointments"
            headers={
              compact
                ? ['Patient', 'Time', 'Status', '']
                : ['Patient / reference', 'Doctor', 'Visit', 'Schedule', 'Status', 'Payment', 'Action']
            }
          >
            {items.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="person">
                    <Avatar initials={a.initials} color="mint" size="sm" />
                    <div>
                      <strong>{a.patient}</strong>
                      <small>{a.id}</small>
                    </div>
                  </div>
                </td>
                {!compact && (
                  <>
                    <td>{a.doctor.replace('Dr. ', '')}</td>
                    <td>{lx(a.service)}</td>
                  </>
                )}
                <td>
                  <strong className="table-strong">{lx(a.time)}</strong>
                  <small className="table-sub">{lx(a.date)}</small>
                </td>
                <td>
                  <Status value={a.status} />
                </td>
                {!compact && (
                  <td>
                    <Status value={a.payment} />
                  </td>
                )}
                <td>
                  <button
                    className="table-action"
                    aria-label={this.props.tx('View {0}').replace('{0}', a.id)}
                    onClick={() => this.open('appointment', 'Appointment details', a.id)}
                  >
                    <Icon name="chevron" size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </>
    );
  }
  toolbar(placeholder: string, options?: string[]) {
    return (
      <div className="toolbar">
        <label className="search-box">
          <Icon name="search" size={18} />
          <input
            aria-label={this.props.tx(placeholder)}
            placeholder={this.props.tx(placeholder)}
            value={this.state.search}
            onChange={(e) => this.setState({ search: e.target.value })}
          />
          {this.state.search && (
            <button aria-label={this.props.tx('Clear search')} onClick={() => this.setState({ search: '' })}>
              <Icon name="close" size={16} />
            </button>
          )}
        </label>
        {options && (
          <select
            className="control filter-select"
            aria-label={this.props.tx('Filter by status')}
            value={this.state.filter}
            onChange={(e) => this.setState({ filter: e.target.value })}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {this.props.tx(o)}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }
  dashboard() {
    const a = this.scopedAppointments,
      t = a.filter((x) => x.date === 'Today'),
      completed = t.filter((x) => x.status === 'Completed').length,
      waiting = t.filter((x) => x.status === 'Checked in').length,
      paid = a
        .filter((x) => x.payment === 'Paid')
        .reduce((sum, x) => sum + (doctors.find((d) => d.name === x.doctor)?.fee || 500), 0);
    const metrics =
      this.role === 'doctor'
        ? [
            ['Today’s visits', t.length, 'calendar', 'Scheduled for you', 'mint'],
            ['Waiting patients', waiting, 'users', 'Checked in', 'peach'],
            ['Completed', completed, 'check', 'Today’s consultations', 'blue'],
            ['My patients', this.scopedPatients.length, 'heart', 'Assigned sample records', 'lavender'],
          ]
        : this.role === 'staff'
          ? [
              ['Today’s appointments', t.length, 'calendar', 'Across all doctors', 'mint'],
              ['Waiting patients', waiting, 'users', 'Checked in', 'peach'],
              ['Patients registered', this.state.patients.length, 'heart', 'Sample directory', 'blue'],
              [
                'Pending payments',
                a.filter((x) => x.payment === 'Unpaid').length,
                'wallet',
                'Unpaid sample visits',
                'lavender',
              ],
            ]
          : [
              ['Today’s appointments', t.length, 'calendar', 'All doctors', 'mint'],
              ['Active doctors', doctors.length, 'stethoscope', 'Demo care team', 'blue'],
              ['Sample collections', formatINR(paid), 'wallet', 'All paid demo visits', 'peach'],
              ['Team members', demoUsers.length, 'users', 'Active sample directory', 'lavender'],
            ];
    return (
      <>
        <div className="welcome-panel animate-in">
          <div>
            <span className="eyebrow">
              <L en={'Hospital workspace'} />
            </span>
            <h2>
              <L
                en={
                  this.role === 'doctor'
                    ? 'Your day, at a glance.'
                    : this.role === 'staff'
                      ? 'Keep the day moving.'
                      : 'Your hospital, at a glance.'
                }
              />
            </h2>
            <p>
              <L
                en={
                  this.role === 'doctor'
                    ? 'Review assigned appointments and prepare for your next consultation.'
                    : this.role === 'staff'
                      ? 'Manage patient arrivals, appointments and collections from one place.'
                      : 'Monitor appointments, staffing, collections and content workflows.'
                }
              />
            </p>
            <div className="flex wrap" style={{ marginTop: 16 }}>
              <Button href={this.link('appointments')} icon="calendar">
                <L en="View appointments" />
              </Button>
              {this.role === 'staff' && (
                <Button
                  variant="secondary"
                  icon="plus"
                  onClick={() => this.open('newAppointment', 'New demo appointment')}
                >
                  New appointment
                </Button>
              )}
              {this.role === 'admin' && (
                <Button variant="secondary" href={this.link('reports')}>
                  View reports
                </Button>
              )}
            </div>
          </div>
          <div className="welcome-visual" aria-hidden="true">
            <div className="welcome-orbit" />
            <Icon
              name={this.role === 'doctor' ? 'stethoscope' : this.role === 'staff' ? 'calendar' : 'chart'}
              size={94}
            />
            <span className="mini-visual">
              <Icon name="check" size={23} />
            </span>
          </div>
        </div>
        <div className="metrics-grid">
          {metrics.map(([label, value, icon, sub, tone]) => (
            <Metric
              key={String(label)}
              label={String(label)}
              value={value}
              icon={String(icon)}
              sub={String(sub)}
              tone={String(tone)}
            />
          ))}
        </div>
        <div className="dashboard-grid">
          <Card
            title="Today's appointments"
            subtitle="Sample visits for your workspace"
            action={
              <a className="text-link" href={this.link('appointments')}>
                <T en={'View all {0}'} values={[<Icon key="v0" name="arrow" size={15} />]} />
              </a>
            }
          >
            {this.appointmentTable(t.slice(0, 5), true)}
          </Card>
          <Card
            title={this.role === 'admin' ? 'Appointment overview' : 'Care queue'}
            subtitle="Status breakdown · demo data"
          >
            <div className="queue-summary">
              <div
                className="donut"
                style={{
                  background: `conic-gradient(#14877a 0 ${t.length ? (completed / t.length) * 100 : 0}%,#e5ad62 ${t.length ? (completed / t.length) * 100 : 0}% ${t.length ? ((completed + waiting) / t.length) * 100 : 0}%,#d9e8e4 0)`,
                }}
              >
                <div>
                  <strong>{t.length}</strong>
                  <small>
                    <L en={'Today'} />
                  </small>
                </div>
              </div>
              {[
                ['Completed', completed, '#14877a'],
                ['Waiting', waiting, '#e5ad62'],
                ['Other visits', t.length - completed - waiting, '#c6dbd5'],
              ].map(([l, n, c]) => (
                <div className="legend" key={String(l)}>
                  <span style={{ background: String(c) }} />
                  <strong>{lx(l)}</strong>
                  <b>{n}</b>
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="dashboard-grid bottom-grid">
          <Card title="Quick actions" subtitle="Common tasks for your role">
            <div className="quick-actions">
              {(this.role === 'doctor'
                ? [
                    ['patients', 'users', 'Find patient'],
                    ['consultations', 'stethoscope', 'Consultations'],
                    ['schedule', 'clock', 'Availability'],
                  ]
                : this.role === 'staff'
                  ? [
                      ['patients', 'users', 'Patient registration'],
                      ['queue', 'pulse', 'Open OPD queue'],
                      ['billing', 'wallet', 'Review billing'],
                    ]
                  : [
                      ['doctors', 'stethoscope', 'Doctor directory'],
                      ['roles', 'shield', 'Review permissions'],
                      ['content', 'book', 'Manage content'],
                    ]
              ).map(([id, i, t]) => (
                <a key={id} href={this.link(id)}>
                  <span className="icon-tile">
                    <Icon name={i} />
                  </span>
                  <strong>{lx(t)}</strong>
                  <Icon name="chevron" size={17} />
                </a>
              ))}
            </div>
          </Card>
          <Card title="Recent activity" subtitle="Synthetic events from this page">
            <div className="activity-list">
              {this.state.audit.slice(0, 4).map((a, i) => (
                <div key={`${a.event}-${i}`}>
                  <span className="icon-tile">
                    <Icon name="clock" size={17} />
                  </span>
                  <div className="grow">
                    <strong>{lx(a.event)}</strong>
                    <small>
                      {lx(a.actor)} · {lx(a.time)}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </>
    );
  }
  appointments() {
    return (
      <Card
        title="Appointment list"
        subtitle="Online and reception appointments — synthetic data"
        action={
          this.role === 'staff' ? (
            <Button icon="plus" onClick={() => this.open('newAppointment', 'New demo appointment')}>
              New appointment
            </Button>
          ) : undefined
        }
      >
        {this.toolbar('Search patient, doctor or reference', [
          'All',
          'Confirmed',
          'Checked in',
          'In consultation',
          'Completed',
          'Cancelled',
          'No-show',
        ])}
        {this.appointmentTable(this.filteredAppointments())}
      </Card>
    );
  }
  patients() {
    const ps = this.scopedPatients.filter((p) =>
      `${p.name} ${p.id}`.toLowerCase().includes(this.state.search.toLowerCase()),
    );
    return (
      <Card
        title="Patient directory"
        subtitle="Fictional records; no medical data"
        action={
          this.role === 'staff' ? (
            <Button icon="plus" onClick={() => this.open('newPatient', 'Register sample patient')}>
              Register patient
            </Button>
          ) : undefined
        }
      >
        {this.toolbar('Search patient name or MRN')}
        {ps.length ? (
          <Table
            label="Patients"
            headers={['Patient', 'MRN', 'Age', 'Assigned doctor', 'Last visit', 'Action']}
          >
            {ps.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="person">
                    <Avatar initials={initials(p.name)} size="sm" />
                    <strong>{p.name}</strong>
                  </div>
                </td>
                <td>{p.id}</td>
                <td>{p.age}</td>
                <td>{p.doctor}</td>
                <td>{lx(p.lastVisit)}</td>
                <td>
                  <button
                    className="table-action"
                    onClick={() => this.open('patient', 'Sample patient profile', p.id)}
                    aria-label={this.props.tx('View {0}').replace('{0}', p.name)}
                  >
                    <Icon name="chevron" size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty title="No sample patients" description="Try a different search." icon="users" />
        )}
      </Card>
    );
  }
  queue() {
    const today = this.scopedAppointments.filter((a) => a.date === 'Today');
    return (
      <div className="queue-grid">
        {(['Confirmed', 'Checked in', 'In consultation', 'Completed'] as const).map((status) => (
          <div className="surface queue-column" key={status}>
            <div className="queue-column-head">
              <Status value={status} />
              <strong>{today.filter((a) => a.status === status).length}</strong>
            </div>
            {today
              .filter((a) => a.status === status)
              .map((a) => (
                <div className="queue-ticket" key={a.id}>
                  <div className="person">
                    <Avatar initials={a.initials} size="sm" />
                    <div>
                      <strong>{a.patient}</strong>
                      <small>
                        {lx(a.time)} · {a.id}
                      </small>
                    </div>
                  </div>
                  <p>{a.doctor}</p>
                  <Button
                    variant="secondary"
                    onClick={() => this.open('appointment', 'Appointment details', a.id)}
                  >
                    View / update
                  </Button>
                </div>
              ))}
            {!today.some((a) => a.status === status) && (
              <p className="queue-empty">
                <L en={'No sample visits'} />
              </p>
            )}
          </div>
        ))}
      </div>
    );
  }
  consultations() {
    const a = this.scopedAppointments.filter((x) =>
      ['Checked in', 'In consultation', 'Completed'].includes(x.status),
    );
    return (
      <div className="stack">
        <Notice>
          Clinical UI only. Do not enter real symptoms, diagnoses, medicines or patient information.
        </Notice>
        <Card title="Assigned consultations" subtitle="Select a visit to preview the consultation form">
          <div className="record-grid">
            {a.map((v) => (
              <div className="record-card" key={v.id}>
                <div className="person">
                  <Avatar initials={v.initials} />
                  <div>
                    <strong>{v.patient}</strong>
                    <small>
                      {v.id} · {v.time}
                    </small>
                  </div>
                </div>
                <Status value={v.status} />
                <Button
                  variant="secondary"
                  icon="edit"
                  onClick={() => this.open('consultation', 'Draft sample consultation', v.id)}
                >
                  Open consultation
                </Button>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Sample consultation records">
          <Table label="Consultations" headers={['Reference', 'Patient', 'Note', 'Status']}>
            {this.state.consults.map((c) => (
              <tr key={c.id}>
                <td>{c.id}</td>
                <td>{c.patient}</td>
                <td>{c.note}</td>
                <td>
                  <Status value={c.status} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    );
  }
  prescriptions() {
    return (
      <div className="stack">
        <Notice tone="warning">
          No real medicine order is created. Prescription drafting and signature verification require a live
          clinical backend.
        </Notice>
        <Card
          title="Prescription drafts"
          action={
            <Button icon="plus" onClick={() => this.open('prescription', 'New sample prescription')}>
              New draft
            </Button>
          }
        >
          <Table label="Prescription drafts" headers={['Reference', 'Patient', 'Sample item', 'Status']}>
            {this.state.prescriptions.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.patient}</td>
                <td>{p.item}</td>
                <td>
                  <Status value={p.status} />
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    );
  }
  schedule() {
    return (
      <Card
        title="Weekly availability"
        subtitle="Changes remain in this screen; not published to the booking system."
      >
        <div className="schedule-list">
          {Object.entries(this.state.schedule).map(([d, active]) => (
            <div className="schedule-row" key={d}>
              <strong>{lx(d)}</strong>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) =>
                    this.setState((s) => ({ schedule: { ...s.schedule, [d]: e.target.checked } }))
                  }
                />
                <span>
                  <L en={active ? 'Available' : 'Unavailable'} />
                </span>
              </label>
              <span>
                <L en={active ? '09:00 AM – 04:00 PM' : '—'} />
              </span>
            </div>
          ))}
        </div>
        <div className="card-pad">
          <Button onClick={() => this.flash('Availability preview updated. Not published.')}>
            Apply demo availability
          </Button>
        </div>
      </Card>
    );
  }
  finance() {
    const a = this.scopedAppointments;
    const total = (items: Appointment[]) =>
      items.reduce((n, v) => n + (doctors.find((d) => d.name === v.doctor)?.fee || 500), 0);
    const paid = a.filter((x) => x.payment === 'Paid'),
      unpaid = a.filter((x) => x.payment === 'Unpaid'),
      refunded = a.filter((x) => x.payment === 'Refunded');
    return (
      <>
        <div className="metrics-grid three">
          <Metric
            label="Sample collections"
            value={formatINR(total(paid))}
            icon="wallet"
            sub={`${paid.length} simulated paid visits`}
          />
          <Metric
            label="Outstanding"
            value={formatINR(total(unpaid))}
            icon="clock"
            sub={`${unpaid.length} unpaid sample visits`}
            tone="peach"
          />
          <Metric
            label="Refunded"
            value={formatINR(total(refunded))}
            icon="refresh"
            sub="Demo reversals"
            tone="blue"
          />
        </div>
        <Card
          title={this.props.section === 'billing' ? 'Consultation invoices' : 'Payment transactions'}
          subtitle="No payment gateway is connected."
        >
          <Table label="Payments" headers={['Invoice', 'Patient', 'Doctor', 'Amount', 'Payment', 'Action']}>
            {a.map((v, i) => (
              <tr key={v.id}>
                <td>
                  <T en={'INV-{0}'} values={[2001 + i]} />
                </td>
                <td>{v.patient}</td>
                <td>{v.doctor}</td>
                <td className="table-strong">
                  {formatINR(doctors.find((d) => d.name === v.doctor)?.fee || 500)}
                </td>
                <td>
                  <Status value={v.payment} />
                </td>
                <td>
                  {v.payment === 'Unpaid' && this.role !== 'doctor' ? (
                    <button
                      className="text-link"
                      onClick={() => this.open('payment', 'Simulate payment collection', v.id)}
                    >
                      <L en={'Collect demo'} />
                    </button>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </>
    );
  }
  doctorsPage() {
    return (
      <Card
        title="Doctor directory"
        subtitle="Sample profiles; actual account provisioning is not connected."
      >
        <div className="record-grid">
          {doctors.map((d) => (
            <div className="record-card" key={d.slug}>
              <div className="person">
                <Avatar initials={d.initials} color={d.color} size="lg" />
                <div>
                  <strong>{d.name}</strong>
                  <small>{lx(d.specialty)}</small>
                </div>
              </div>
              <div className="flex wrap">
                <Badge tone="green">Demo active</Badge>
                <span className="text-sm muted">{d.availability}</span>
              </div>
              <p>
                <T en={'Sample consultation fee: {0}'} values={[formatINR(d.fee)]} />
              </p>
              <Button variant="secondary" href={`${this.props.websiteUrl}/doctors/${d.slug}`}>
                View public profile
              </Button>
            </div>
          ))}
        </div>
      </Card>
    );
  }
  staffPage() {
    return (
      <Card
        title="Team members"
        subtitle="Role and membership preview; no invitations or real account changes."
      >
        <Table label="Staff members" headers={['Name', 'Role', 'Status', 'Action']}>
          {demoUsers.map((u) => (
            <tr key={u.name}>
              <td>
                <div className="person">
                  <Avatar initials={u.initials} size="sm" />
                  <strong>{u.name}</strong>
                </div>
              </td>
              <td>{lx(u.role)}</td>
              <td>
                <Status value={this.state.staffStates[u.name] || u.status} />
              </td>
              <td>
                {u.role === 'Super admin' ? (
                  <span className="muted">
                    <L en={'Protected'} />
                  </span>
                ) : (
                  <button
                    className="text-link"
                    onClick={() => {
                      this.open('user', 'Preview membership status', u.name);
                      this.setState({ draftStatus: this.state.staffStates[u.name] || u.status });
                    }}
                  >
                    <L en="Manage" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    );
  }
  roles() {
    return (
      <div className="stack">
        <Notice tone="warning">
          This is a UI permission preview, not an authorization boundary. Live role checks, organization
          scoping and RLS must be integrated before use.
        </Notice>
        <Card title="Permission matrix" subtitle="Initial roles · clinical access is assigned-care scoped">
          <Table label="Permission matrix" headers={['Permission', 'Doctor', 'Staff', 'Super admin']}>
            {permissionRows.map(([p, ...roles]) => (
              <tr key={p}>
                <td>
                  <strong>{lx(p)}</strong>
                </td>
                {roles.map((allowed, i) => (
                  <td key={i}>
                    {allowed ? (
                      <span className="permission-yes">
                        <T en={'{0} Allowed'} values={[<Icon key="v0" name="check" size={16} />]} />
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Access principles">
          <div className="card-pad stack">
            <p>
              <T
                en={'{0} staff see only information needed to perform operational tasks.'}
                values={[<strong key="v0">Least privilege:</strong>]}
              />
            </p>
            <p>
              <T
                en={'{0} administrators do not automatically receive medical record access.'}
                values={[<strong key="v0">Clinical confidentiality:</strong>]}
              />
            </p>
            <p>
              <T
                en={'{0} UI menus are not security controls.'}
                values={[<strong key="v0">Database enforcement:</strong>]}
              />
            </p>
          </div>
        </Card>
      </div>
    );
  }
  reports() {
    const a = this.scopedAppointments;
    const statuses = ['Confirmed', 'Checked in', 'In consultation', 'Completed', 'Cancelled', 'No-show'];
    return (
      <div className="stack">
        <div className="metrics-grid three">
          <Metric label="Total appointments" value={a.length} icon="calendar" sub="Sample data" />
          <Metric
            label="Completed visits"
            value={a.filter((x) => x.status === 'Completed').length}
            icon="check"
            sub="Sample data"
            tone="blue"
          />
          <Metric
            label="Registered patients"
            value={this.scopedPatients.length}
            icon="users"
            sub="Sample data"
            tone="peach"
          />
        </div>
        <div className="dashboard-grid">
          <Card title="Appointments by status" subtitle="Counts derived from the current demo state">
            <div className="report-bars">
              {statuses.map((s) => (
                <div className="report-bar-row" key={s}>
                  <span>{lx(s)}</span>
                  <div>
                    <span
                      style={{
                        width: `${a.length ? (a.filter((x) => x.status === s).length / a.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <strong>{a.filter((x) => x.status === s).length}</strong>
                </div>
              ))}
            </div>
          </Card>
          <Card title="Visits by doctor">
            <div className="report-bars">
              {doctors.map((d) => (
                <div className="report-bar-row" key={d.slug}>
                  <span>{d.name.replace('Dr. ', '')}</span>
                  <div>
                    <span
                      style={{
                        width: `${a.length ? (a.filter((x) => x.doctor === d.name).length / a.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <strong>{a.filter((x) => x.doctor === d.name).length}</strong>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }
  content() {
    const entries = [
      ...articles.map((a) => ({
        id: a.slug,
        title: a.title,
        type: 'Article',
        href: `/health-library/${a.slug}`,
      })),
      ...services.map((s) => ({
        id: s.slug,
        title: s.title,
        type: 'Service page',
        href: `/services/${s.slug}`,
      })),
    ];
    return (
      <div className="stack">
        <Notice>Publishing actions are simulated. They do not change the public website.</Notice>
        <Card title="Content inventory" subtitle="Draft → Medical review → Approved → Published">
          <Table label="Website content" headers={['Title', 'Type', 'Workflow status', 'Actions']}>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>
                  <strong>{e.title}</strong>
                </td>
                <td>{lx(e.type)}</td>
                <td>
                  <Status value={this.state.contentStates[e.id] || 'Draft'} />
                </td>
                <td>
                  <div className="flex wrap">
                    <a className="text-link" href={`${this.props.websiteUrl}${e.href}`}>
                      <L en={'Preview'} />
                    </a>
                    <button
                      className="text-link"
                      onClick={() => this.open('content', 'Preview content workflow', e.id)}
                    >
                      <L en={'Review'} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    );
  }
  audit() {
    return (
      <Card title="Activity log" subtitle="Local demo events only. Not an immutable audit trail.">
        <Table label="Audit events" headers={['Event', 'Actor', 'Time']}>
          {this.state.audit.map((a, i) => (
            <tr key={i}>
              <td>
                <strong>{lx(a.event)}</strong>
              </td>
              <td>{lx(a.actor)}</td>
              <td>{lx(a.time)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    );
  }
  settings() {
    const s = this.state.settings;
    return (
      <div className="stack">
        <Card
          title={this.role === 'admin' ? 'Hospital configuration' : 'My profile'}
          subtitle="Sample settings are local to this page"
        >
          <div className="card-pad stack">
            <div className="person">
              <Avatar initials={roleUsers[this.role].initials} size="lg" />
              <div>
                <strong>{roleUsers[this.role].name}</strong>
                <small>{lx(roleUsers[this.role].title)}</small>
              </div>
            </div>
            {this.role === 'admin' ? (
              <div className="form-grid">
                <Field label="Hospital name">
                  <input value={s.name} readOnly />
                </Field>
                <Field label="Timezone">
                  <select
                    value={s.timezone}
                    onChange={(e) =>
                      this.setState((x) => ({ settings: { ...x.settings, timezone: e.target.value } }))
                    }
                  >
                    <option>Asia/Kolkata</option>
                    <option>UTC</option>
                  </select>
                </Field>
                <Field label="Default slot duration">
                  <select
                    value={s.slot}
                    onChange={(e) =>
                      this.setState((x) => ({ settings: { ...x.settings, slot: e.target.value } }))
                    }
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                  </select>
                </Field>
              </div>
            ) : (
              <div className="form-grid">
                <Field label="Demo name">
                  <input value={roleUsers[this.role].name} readOnly />
                </Field>
                <Field label="Role">
                  <input value={roleLabels[this.role]} readOnly />
                </Field>
              </div>
            )}
            <h3>
              <L en={'Notification preferences'} />
            </h3>
            {(['email', 'sms'] as const).map((k) => (
              <label key={k} className="check-field">
                <input
                  type="checkbox"
                  checked={s[k]}
                  onChange={(e) =>
                    this.setState((x) => ({ settings: { ...x.settings, [k]: e.target.checked } }))
                  }
                />
                <span>
                  <L en={k === 'email' ? 'Email alerts (preview)' : 'SMS reminders (preview)'} />
                </span>
              </label>
            ))}
            <div>
              <Button onClick={() => this.flash('Demo settings applied to this screen only.')}>
                Apply demo settings
              </Button>
            </div>
          </div>
        </Card>
        <Card title="Security">
          <div className="card-pad">
            <Notice>
              Real MFA, session revocation, password reset and account settings require Supabase Auth. They
              are not active in this preview.
            </Notice>
          </div>
        </Card>
      </div>
    );
  }
  modal() {
    const s = this.state,
      m = s.modal;
    if (!m) return null;
    const a = this.scopedAppointments.find((x) => x.id === m.id),
      p = this.scopedPatients.find((x) => x.id === m.id);
    const transition: Record<AppointmentStatus, AppointmentStatus[]> = {
      Confirmed: ['Checked in', 'Cancelled', 'No-show'],
      'Checked in': ['In consultation', 'Cancelled'],
      'In consultation': ['Completed'],
      Completed: [],
      Cancelled: [],
      'No-show': [],
    };
    let content: React.ReactNode;
    let saveLabel = 'Apply demo change';
    if (m.kind === 'appointment' && a) {
      content = (
        <>
          <div className="person">
            <Avatar initials={a.initials} size="lg" />
            <div>
              <strong>{a.patient}</strong>
              <small>{a.id}</small>
            </div>
          </div>
          {[
            ['Doctor', a.doctor],
            ['Visit', a.service],
            ['Date and time', `${a.date} · ${a.time}`],
            ['Payment', a.payment],
          ].map(([k, v]) => (
            <div className="review-row" key={k}>
              <span>{lx(k)}</span>
              <strong>{v}</strong>
            </div>
          ))}
          <div className="flex">
            <span className="muted">
              <L en={'Status'} />
            </span>
            <Status value={a.status} />
          </div>
          {this.role !== 'admin' && transition[a.status].length > 0 && (
            <div className="stack">
              <h3>
                <L en={'Update sample status'} />
              </h3>
              <div className="flex wrap">
                {transition[a.status]
                  .filter((x) =>
                    this.role === 'doctor'
                      ? ['In consultation', 'Completed'].includes(x)
                      : !['In consultation', 'Completed'].includes(x),
                  )
                  .map((v) => (
                    <Button
                      key={v}
                      variant={v === 'Cancelled' ? 'danger' : 'secondary'}
                      onClick={() => this.changeStatus(a.id, v)}
                    >
                      {v}
                    </Button>
                  ))}
              </div>
            </div>
          )}
        </>
      );
    } else if (m.kind === 'patient' && p) {
      content = (
        <>
          <div className="person">
            <Avatar initials={initials(p.name)} size="lg" />
            <div>
              <strong>{p.name}</strong>
              <small>{p.id}</small>
            </div>
          </div>
          {[
            ['Age', String(p.age)],
            ['Assigned doctor', p.doctor],
            ['Last visit', p.lastVisit],
          ].map(([k, v]) => (
            <div className="review-row" key={k}>
              <span>{lx(k)}</span>
              <strong>{v}</strong>
            </div>
          ))}
          <Notice>
            {this.role === 'doctor'
              ? 'Only fictional assigned-care data is available in this preview.'
              : 'Clinical notes are not shown to reception staff.'}
          </Notice>
        </>
      );
    } else if (m.kind === 'newPatient') {
      saveLabel = 'Register sample patient';
      content = (
        <>
          <Field
            label="Fictional patient name"
            hint="Use a name like Sample Patient I. Do not enter real data."
          >
            <input
              value={s.draftName}
              onChange={(e) => this.setState({ draftName: e.target.value, error: '' })}
              maxLength={36}
            />
          </Field>
          <Field label="Assigned doctor">
            <select value={s.draftDoctor} onChange={(e) => this.setState({ draftDoctor: e.target.value })}>
              {doctors.map((d) => (
                <option key={d.slug}>{d.name}</option>
              ))}
            </select>
          </Field>
          <Notice>Age is set to a fictional sample value. Nothing is persisted.</Notice>
        </>
      );
    } else if (m.kind === 'newAppointment') {
      saveLabel = 'Create demo appointment';
      content = (
        <>
          <Field label="Sample patient">
            <select value={s.draftName} onChange={(e) => this.setState({ draftName: e.target.value })}>
              <option value="Sample Patient I">Select sample patient</option>
              {this.state.patients.map((p) => (
                <option key={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Doctor">
            <select value={s.draftDoctor} onChange={(e) => this.setState({ draftDoctor: e.target.value })}>
              {doctors.map((d) => (
                <option key={d.slug}>{d.name}</option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Day">
              <select value={s.draftDate} onChange={(e) => this.setState({ draftDate: e.target.value })}>
                <option>Today</option>
                <option>Tomorrow</option>
              </select>
            </Field>
            <Field label="Time">
              <select value={s.draftTime} onChange={(e) => this.setState({ draftTime: e.target.value })}>
                {times.map((t) => (
                  <option key={t} value={t}>
                    {this.props.tx(String(t))}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Visit type">
            <select value={s.draftService} onChange={(e) => this.setState({ draftService: e.target.value })}>
              <option>General consultation</option>
              <option>Follow-up</option>
              <option>Specialty consultation</option>
            </select>
          </Field>
        </>
      );
    } else if (m.kind === 'consultation') {
      saveLabel = 'Create sample draft';
      content = (
        <>
          <Notice tone="warning">Use sample placeholders only. No real clinical documentation.</Notice>
          <Field label="Patient">
            <input value={a?.patient || 'No assigned patient'} readOnly />
          </Field>
          <div className="form-grid">
            <Field label="Vitals preview">
              <input value="Sample values not recorded" readOnly />
            </Field>
            <Field label="Visit type">
              <input value={a?.service || 'Sample consultation'} readOnly />
            </Field>
          </div>
          <Field label="Consultation notes">
            <textarea value={s.draftNote} readOnly />
          </Field>
          <Field label="Plan">
            <input value="Sample follow-up discussion" readOnly />
          </Field>
        </>
      );
    } else if (m.kind === 'prescription') {
      saveLabel = 'Create demo draft';
      content = (
        <>
          <Notice tone="warning">This does not create a prescription or authorize medication.</Notice>
          <Field label="Assigned sample patient">
            <select value={s.draftName} onChange={(e) => this.setState({ draftName: e.target.value })}>
              <option value="Sample Patient I">Select sample patient</option>
              {this.scopedPatients.map((p) => (
                <option key={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Sample prescription item">
            <input value={s.draftDrug} readOnly />
          </Field>
          <Field label="Instructions">
            <input value="No dosing or medication instructions" readOnly />
          </Field>
        </>
      );
    } else if (m.kind === 'payment' && a) {
      saveLabel = 'Simulate collection';
      content = (
        <>
          <Notice tone="warning">No money will be collected. This is an in-memory simulation.</Notice>
          <div className="review-row">
            <span>
              <L en={'Sample patient'} />
            </span>
            <strong>{a.patient}</strong>
          </div>
          <div className="review-row">
            <span>
              <L en={'Amount'} />
            </span>
            <strong>{formatINR(doctors.find((d) => d.name === a.doctor)?.fee || 500)}</strong>
          </div>
          <Field label="Payment method preview">
            <select>
              <option>Cash (demo)</option>
              <option>UPI (demo)</option>
              <option>Card (demo)</option>
            </select>
          </Field>
        </>
      );
    } else if (m.kind === 'content') {
      content = (
        <>
          <Field label="Content identifier">
            <input readOnly value={m.id} />
          </Field>
          <Field label="Workflow status">
            <select value={s.draftStatus} onChange={(e) => this.setState({ draftStatus: e.target.value })}>
              {['Draft', 'Medical review', 'Approved', 'Published'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Field>
          <Notice>Changing the demo status does not publish content.</Notice>
        </>
      );
    } else if (m.kind === 'user') {
      content = (
        <>
          <Field label="Sample team member">
            <input value={m.id} readOnly />
          </Field>
          <Field label="Membership state">
            <select value={s.draftStatus} onChange={(e) => this.setState({ draftStatus: e.target.value })}>
              <option>Active</option>
              <option>Inactive</option>
            </select>
          </Field>
          <Notice>No real login account or permissions will be changed.</Notice>
        </>
      );
    } else {
      content = <Empty title="Record not found" description="Close the dialog and try again." />;
    }
    return (
      <div className="modal-overlay" onClick={this.close}>
        <div
          className="modal surface"
          ref={(el) => {
            this.modalRef.current = el;
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
          tabIndex={-1}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') this.close();
            if (e.key === 'Tab') {
              const els = Array.from(
                this.modalRef.current?.querySelectorAll<HTMLElement>(
                  'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)',
                ) || [],
              );
              const first = els[0],
                last = els[els.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last?.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div className="modal-head">
            <h2 id="modal-title">{lx(m.title)}</h2>
            <button className="icon-button" aria-label={this.props.tx('Close dialog')} onClick={this.close}>
              <Icon name="close" />
            </button>
          </div>
          <div className="modal-body stack">
            {content}
            {s.error && (
              <p role="alert" className="form-error">
                {lx(s.error)}
              </p>
            )}
          </div>
          <div className="modal-foot">
            <Button variant="secondary" onClick={this.close}>
              <L en="Close" />
            </Button>
            {!['appointment', 'patient'].includes(m.kind) && <Button onClick={this.save}>{saveLabel}</Button>}
          </div>
        </div>
      </div>
    );
  }
  render() {
    const s = this.state,
      role = this.role,
      section = this.props.section,
      user = roleUsers[role];
    const pages: Record<string, () => React.ReactNode> = {
      dashboard: () => this.dashboard(),
      appointments: () => this.appointments(),
      patients: () => this.patients(),
      queue: () => this.queue(),
      consultations: () => this.consultations(),
      prescriptions: () => this.prescriptions(),
      schedule: () => this.schedule(),
      billing: () => this.finance(),
      payments: () => this.finance(),
      finance: () => this.finance(),
      doctors: () => this.doctorsPage(),
      staff: () => this.staffPage(),
      roles: () => this.roles(),
      reports: () => this.reports(),
      content: () => this.content(),
      audit: () => this.audit(),
      settings: () => this.settings(),
    };
    return (
      <div className="workspace">
        <aside
          className={`sidebar ${s.menu ? 'sidebar-open' : ''}`}
          aria-label={this.props.tx('Portal navigation')}
        >
          <div className="sidebar-brand">
            <Brand href={this.link('dashboard')} sub="HMS workspace" />
            <button
              className="icon-button sidebar-close"
              aria-label={this.props.tx('Close navigation')}
              onClick={() => this.setState({ menu: false })}
            >
              <Icon name="close" />
            </button>
          </div>
          <div className="workspace-switch">
            <span className="workspace-switch-icon">
              <Icon name="building" size={18} />
            </span>
            <div className="grow">
              <strong>
                <L en={'Aarogya Care'} />
              </strong>
              <small>
                <L en={'Main branch · Demo'} />
              </small>
            </div>
            <Icon name="down" size={15} />
          </div>
          <nav className="side-nav">
            {roleNav[role].map((g) => (
              <div key={g.group}>
                <span className="nav-group">{lx(g.group)}</span>
                {g.items.map((i) => (
                  <a
                    key={i.id}
                    href={this.link(i.id)}
                    className={section === i.id ? 'active' : ''}
                    aria-current={section === i.id ? 'page' : undefined}
                  >
                    <Icon name={i.icon} size={19} />
                    {lx(i.label)}
                    {section === i.id && <span className="nav-active-dot" />}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <a href={this.props.websiteUrl}>
              <T
                en={'{0} Public website {1}'}
                values={[<Icon key="v0" name="eye" size={18} />, <Icon key="v1" name="arrow" size={14} />]}
              />
            </a>
            <a href="/login">
              <T en={'{0} Exit demo role'} values={[<Icon key="v0" name="logout" size={18} />]} />
            </a>
            <div className="sidebar-user">
              <Avatar initials={user.initials} />
              <div>
                <strong>{user.name}</strong>
                <small>{lx(roleLabels[role])}</small>
              </div>
            </div>
          </div>
        </aside>
        {s.menu && (
          <button
            className="mobile-scrim"
            aria-label={this.props.tx('Close navigation')}
            onClick={() => this.setState({ menu: false })}
          />
        )}
        <div className="work-main">
          <header className="work-header">
            <div className="flex grow">
              <button
                className="icon-button mobile-toggle"
                aria-label={this.props.tx('Open navigation')}
                aria-expanded={s.menu}
                onClick={() => this.setState({ menu: !s.menu })}
              >
                <Icon name="menu" size={23} />
              </button>
              <span className="header-breadcrumb">
                <span>
                  <L en="Workspace" />
                </span>
                <Icon name="chevron" size={15} />
                <strong>{lx(this.selectedSection.label)}</strong>
              </span>
            </div>
            <Badge tone="amber">Demo mode</Badge>
            <div className="notification-wrap">
              <button
                className="icon-button"
                aria-label={this.props.tx('Notifications')}
                aria-expanded={s.notifications}
                onClick={() => this.setState({ notifications: !s.notifications })}
              >
                <Icon name="bell" size={21} />
                <span className="notification-dot" />
              </button>
              {s.notifications && (
                <div className="notification-pop surface">
                  <strong>
                    <L en={'Notifications'} />
                  </strong>
                  <p>
                    <L en={'No live reminders are connected. This is a demo workspace.'} />
                  </p>
                  <button className="text-link" onClick={() => this.setState({ notifications: false })}>
                    <L en={'Dismiss'} />
                  </button>
                </div>
              )}
            </div>
            <Avatar initials={user.initials} />
          </header>
          <main id="main" className="work-content">
            <div className="work-title">
              <div>
                <div className="flex wrap">
                  <span className="eyebrow">
                    <T en={'{0} workspace'} values={[<L key="r" en={roleLabels[role]} />]} />
                  </span>
                </div>
                <h1>
                  {section === 'dashboard' ? (
                    <T
                      en="Welcome, {0}."
                      values={[
                        role === 'doctor' ? (
                          'Dr. Ananya'
                        ) : (
                          <L key="w" en={role === 'staff' ? 'Reception team' : 'Admin'} />
                        ),
                      ]}
                    />
                  ) : (
                    lx(this.selectedSection.label)
                  )}
                </h1>
                <p>{lx(sectionDescriptions[section])}</p>
              </div>
              <div className="day-chip">
                <T en={'{0} Demo day'} values={[<Icon key="v0" name="calendar" size={17} />]} />
              </div>
            </div>
            <div className="demo-banner">
              <Icon name="info" size={17} />
              <span>
                <L
                  en={
                    'Fictional data only. Actions reset when navigating or refreshing. No real authentication, medical records or payments.'
                  }
                />
              </span>
            </div>
            {s.toast && (
              <div className="toast-inline">
                <Notice tone="success">{s.toast}</Notice>
                <button
                  className="icon-button"
                  aria-label={this.props.tx('Dismiss message')}
                  onClick={() => this.setState({ toast: '' })}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
            )}
            <div className="page-content">{pages[section]?.()}</div>
            <footer className="work-footer">
              <T
                en={'Aarogya HMS · Phase 1 UI preview {0}'}
                values={[<L key="p" en={'Privacy-first architecture · Demo data'} />]}
              />
            </footer>
          </main>
        </div>
        {this.modal()}
      </div>
    );
  }
}
