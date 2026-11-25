import type { Role, Appointment, Patient } from '@hms/types';
export const roleLabels: Record<Role, string> = {
  doctor: 'Doctor',
  staff: 'Reception & staff',
  admin: 'Super admin',
};
export const roleUsers: Record<Role, { name: string; initials: string; title: string }> = {
  doctor: { name: 'Dr. Ananya Sharma', initials: 'AS', title: 'General medicine' },
  staff: { name: 'Demo Receptionist', initials: 'DR', title: 'Reception desk' },
  admin: { name: 'Demo Administrator', initials: 'DA', title: 'Hospital administrator' },
};
export const roleNav: Record<
  Role,
  { group: string; items: { id: string; label: string; icon: string }[] }[]
> = {
  doctor: [
    {
      group: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Overview', icon: 'grid' },
        { id: 'appointments', label: 'My appointments', icon: 'calendar' },
        { id: 'patients', label: 'My patients', icon: 'users' },
        { id: 'consultations', label: 'Consultations', icon: 'stethoscope' },
        { id: 'prescriptions', label: 'Prescriptions', icon: 'pill' },
      ],
    },
    {
      group: 'Manage',
      items: [
        { id: 'schedule', label: 'Availability', icon: 'clock' },
        { id: 'settings', label: 'My profile', icon: 'settings' },
      ],
    },
  ],
  staff: [
    {
      group: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Overview', icon: 'grid' },
        { id: 'appointments', label: 'Appointments', icon: 'calendar' },
        { id: 'patients', label: 'Patients', icon: 'users' },
        { id: 'queue', label: 'OPD queue', icon: 'pulse' },
      ],
    },
    {
      group: 'Finance',
      items: [
        { id: 'billing', label: 'Billing', icon: 'file' },
        { id: 'payments', label: 'Payments', icon: 'wallet' },
      ],
    },
    { group: 'Manage', items: [{ id: 'settings', label: 'My profile', icon: 'settings' }] },
  ],
  admin: [
    {
      group: 'Workspace',
      items: [
        { id: 'dashboard', label: 'Overview', icon: 'grid' },
        { id: 'appointments', label: 'Appointments', icon: 'calendar' },
        { id: 'doctors', label: 'Doctors', icon: 'stethoscope' },
        { id: 'staff', label: 'Staff & users', icon: 'users' },
        { id: 'roles', label: 'Roles & permissions', icon: 'shield' },
      ],
    },
    {
      group: 'Operations',
      items: [
        { id: 'finance', label: 'Finance', icon: 'wallet' },
        { id: 'reports', label: 'Reports', icon: 'chart' },
        { id: 'content', label: 'Website content', icon: 'book' },
        { id: 'audit', label: 'Audit log', icon: 'lock' },
      ],
    },
    { group: 'Manage', items: [{ id: 'settings', label: 'Hospital settings', icon: 'settings' }] },
  ],
};
export const initialAppointments: Appointment[] = [
  {
    id: 'APT-1001',
    patient: 'Sample Patient A',
    initials: 'PA',
    doctor: 'Dr. Ananya Sharma',
    time: '09:00 AM',
    date: 'Today',
    service: 'General consultation',
    status: 'Completed',
    payment: 'Paid',
  },
  {
    id: 'APT-1002',
    patient: 'Sample Patient B',
    initials: 'PB',
    doctor: 'Dr. Ananya Sharma',
    time: '09:30 AM',
    date: 'Today',
    service: 'Follow-up',
    status: 'In consultation',
    payment: 'Paid',
  },
  {
    id: 'APT-1003',
    patient: 'Sample Patient C',
    initials: 'PC',
    doctor: 'Dr. Ananya Sharma',
    time: '10:00 AM',
    date: 'Today',
    service: 'General consultation',
    status: 'Checked in',
    payment: 'Unpaid',
  },
  {
    id: 'APT-1004',
    patient: 'Sample Patient D',
    initials: 'PD',
    doctor: 'Dr. Arjun Mehta',
    time: '10:30 AM',
    date: 'Today',
    service: 'Orthopaedics',
    status: 'Confirmed',
    payment: 'Paid',
  },
  {
    id: 'APT-1005',
    patient: 'Sample Patient E',
    initials: 'PE',
    doctor: 'Dr. Meera Rao',
    time: '11:00 AM',
    date: 'Today',
    service: 'Paediatrics',
    status: 'Confirmed',
    payment: 'Unpaid',
  },
  {
    id: 'APT-1006',
    patient: 'Sample Patient F',
    initials: 'PF',
    doctor: 'Dr. Ananya Sharma',
    time: '11:30 AM',
    date: 'Today',
    service: 'Follow-up',
    status: 'Confirmed',
    payment: 'Paid',
  },
  {
    id: 'APT-1007',
    patient: 'Sample Patient G',
    initials: 'PG',
    doctor: 'Dr. Arjun Mehta',
    time: '02:00 PM',
    date: 'Tomorrow',
    service: 'Orthopaedics',
    status: 'Confirmed',
    payment: 'Paid',
  },
  {
    id: 'APT-1008',
    patient: 'Sample Patient H',
    initials: 'PH',
    doctor: 'Dr. Ananya Sharma',
    time: '03:00 PM',
    date: 'Tomorrow',
    service: 'General consultation',
    status: 'Cancelled',
    payment: 'Refunded',
  },
];
export const initialPatients: Patient[] = initialAppointments.map((a, i) => ({
  id: `MRN-${String(101 + i).padStart(5, '0')}`,
  name: a.patient,
  age: [34, 42, 27, 56, 8, 31, 63, 45][i],
  gender: i % 2 ? 'Female' : 'Male',
  lastVisit: i < 3 ? 'Today' : 'No recent visit',
  doctor: a.doctor,
}));
export const demoUsers = [
  { name: 'Dr. Ananya Sharma', initials: 'AS', role: 'Doctor', status: 'Active' },
  { name: 'Dr. Arjun Mehta', initials: 'AM', role: 'Doctor', status: 'Active' },
  { name: 'Dr. Meera Rao', initials: 'MR', role: 'Doctor', status: 'Active' },
  { name: 'Demo Receptionist', initials: 'DR', role: 'Receptionist', status: 'Active' },
  { name: 'Demo Billing Staff', initials: 'DB', role: 'Billing staff', status: 'Active' },
  { name: 'Demo Administrator', initials: 'DA', role: 'Super admin', status: 'Active' },
];
export const permissionRows = [
  ['View appointments', true, true, true],
  ['Manage appointment queue', true, true, false],
  ['Register patients', false, true, false],
  ['View assigned clinical notes', true, false, false],
  ['Write prescriptions', true, false, false],
  ['Collect demo payments', false, true, true],
  ['Manage users and roles', false, false, true],
  ['Manage website content', false, false, true],
  ['View audit events', false, false, true],
] as const;

// Additional routes in the preview navigation.
roleNav.doctor.push({
  group: 'Clinical operations',
  items: [
    { id: 'care', label: 'Clinical records & prescriptions', icon: 'stethoscope' },
    { id: 'opd', label: 'OPD tokens', icon: 'pulse' },
    { id: 'leave', label: 'Leave & availability', icon: 'clock' },
  ],
});
roleNav.staff.push({
  group: 'Additional operations',
  items: [
    { id: 'opd', label: 'OPD tokens', icon: 'pulse' },
    { id: 'patient-edit', label: 'Patient corrections', icon: 'users' },
    { id: 'inquiries', label: 'Inquiries & callbacks', icon: 'phone' },
    { id: 'analytics', label: 'Reports', icon: 'chart' },
  ],
});
roleNav.admin.push({
  group: 'Additional operations',
  items: [
    { id: 'team-management', label: 'Team management', icon: 'users' },
    { id: 'leave', label: 'Doctor leave', icon: 'clock' },
    { id: 'analytics', label: 'Reports & analytics', icon: 'chart' },
    { id: 'communications', label: 'Notification jobs', icon: 'mail' },
    { id: 'inquiries', label: 'Inquiries & callbacks', icon: 'phone' },
    { id: 'opd', label: 'OPD tokens', icon: 'pulse' },
  ],
});

roleNav.doctor.push({
  group: 'Records',
  items: [{ id: 'history', label: 'Patient history search', icon: 'search' }],
});
roleNav.staff.push({
  group: 'Records',
  items: [{ id: 'prescription-register', label: 'Prescription register', icon: 'file' }],
});
roleNav.admin.push({
  group: 'Policies',
  items: [{ id: 'cancellation-policy', label: 'Cancellation policy', icon: 'settings' }],
});
