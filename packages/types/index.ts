export type Role = 'doctor' | 'staff' | 'admin';
export type AppointmentStatus = 'Confirmed' | 'Checked in' | 'In consultation' | 'Completed' | 'Cancelled' | 'No-show';
export type Appointment = { id: string; patient: string; initials: string; doctor: string; time: string; date: string; service: string; status: AppointmentStatus; payment: 'Paid' | 'Unpaid' | 'Refunded'; };
export type Patient = { id: string; name: string; age: number; gender: string; lastVisit: string; doctor: string; };
export type Doctor = { slug: string; name: string; initials: string; specialty: string; bio: string; availability: string; fee: number; color: string; };
export type Service = { slug: string; title: string; icon: string; description: string; detail: string; };
export const doctors:Doctor[]=[
 {slug:'ananya-sharma',name:'Dr. Ananya Sharma',initials:'AS',specialty:'General Medicine',bio:'A fictional physician profile for primary care and routine health consultations.',availability:'Mon–Sat',fee:500,color:'mint'},
 {slug:'arjun-mehta',name:'Dr. Arjun Mehta',initials:'AM',specialty:'Orthopaedics',bio:'A fictional profile for bone, joint and mobility consultations.',availability:'Mon, Wed, Fri',fee:700,color:'blue'},
 {slug:'meera-rao',name:'Dr. Meera Rao',initials:'MR',specialty:'Paediatrics',bio:'A fictional profile for child health and preventive care consultations.',availability:'Tue, Thu, Sat',fee:600,color:'peach'},
];
export const services:Service[]=[
 {slug:'general-medicine',title:'General Medicine',icon:'stethoscope',description:'Routine visits, general health concerns and preventive care.',detail:'Schedule a primary care consultation to discuss general health concerns, preventive care and appropriate follow-up. The actual scope and availability will be confirmed by the hospital.'},
 {slug:'orthopaedics',title:'Orthopaedics',icon:'pulse',description:'Consultations for bones, joints and mobility concerns.',detail:'A consultation can help assess joint or mobility concerns and determine appropriate next steps. This service listing is a placeholder.'},
 {slug:'paediatrics',title:'Paediatrics',icon:'heart',description:'Age-appropriate care and routine child health visits.',detail:'Book a child health consultation with a parent or guardian. Actual clinical services will be configured before launch.'},
 {slug:'preventive-care',title:'Preventive Care',icon:'shield',description:'Health check-up discussions and preventive care guidance.',detail:'Discuss relevant check-ups and preventive care with a qualified clinician. Specific packages, tests and prices will be added only after approval.'},
 {slug:'follow-up',title:'Follow-up Visits',icon:'calendar',description:'Continue care with a scheduled follow-up visit.',detail:'Arrange a follow-up with the relevant doctor. Bring any previous prescriptions or reports requested by your clinician.'},
 {slug:'health-guidance',title:'Health Guidance',icon:'book',description:'Find general information and prepare for your next visit.',detail:'Browse general visit-preparation information. Online information is not a substitute for medical advice or emergency care.'},
];
export const articles=[
 {slug:'prepare-for-your-visit',title:'How to prepare for your first visit',category:'Patient guide',minutes:3,icon:'file',intro:'A simple checklist to help make your next consultation more organized.',body:['Bring your identification and any relevant previous medical records, prescriptions or test reports.','Write down questions you want to ask. Tell your clinician about your current medicines and any known allergies.','Arrive a little before the appointment if the hospital requests registration. Ask reception about billing and follow-up arrangements.']},
 {slug:'understanding-follow-ups',title:'Why follow-up appointments matter',category:'Care journey',minutes:4,icon:'calendar',intro:'Learn what to bring and discuss at a follow-up consultation.',body:['Your clinician may ask you to return to review symptoms, test results or how you are responding to care.','Bring requested reports and note any changes or questions since the last visit.','Follow the advice of your treating clinician; the timing of follow-up depends on your individual circumstances.']},
 {slug:'booking-guide',title:'A guide to online appointment booking',category:'Hospital services',minutes:3,icon:'book',intro:'Choose a doctor, select an available time and review your booking.',body:['Choose the relevant service and doctor. Select an available appointment date and time.','Review the booking details and consultation fee before proceeding. Use only the hospital’s official booking page.','Keep the confirmation reference for check-in. Contact reception if you need to cancel or change your appointment.']},
];
