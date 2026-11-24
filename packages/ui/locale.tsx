'use client';
import { useState, useEffect } from 'react';
export type Language = 'en' | 'hi';
// Only reviewed static UI phrases. Never translate names, diagnoses, medication or notes automatically.
const hindi: Record<string, string> = {
  'A simpler way to find the right doctor, schedule a visit and stay connected to your care — all in one place.':
    'सही डॉक्टर खोजें, मुलाकात का समय तय करें और अपनी देखभाल से जुड़े रहें — सब एक ही जगह।',
  'Privacy-first': 'गोपनीयता को प्राथमिकता',
  'Convenient scheduling': 'आसान समय निर्धारण',
  'Choose a time that suits you': 'अपनी सुविधा का समय चुनें',
  'Browse by specialty': 'विशेषज्ञता के अनुसार देखें',
  'Find hospital information': 'अस्पताल की जानकारी देखें',
  'Explore the services and care pathways available in this hospital website preview.':
    'इस डेमो वेबसाइट में अस्पताल की सेवाएँ और देखभाल की जानकारी देखें।',
  'Fictional profiles show how verified doctor information, availability and consultation booking will appear.':
    'काल्पनिक प्रोफ़ाइल दिखाती हैं कि सत्यापित डॉक्टर जानकारी, उपलब्धता और परामर्श बुकिंग कैसी दिखेगी।',
  'From finding a doctor to checking in, our digital experience is designed to reduce unnecessary waiting.':
    'डॉक्टर खोजने से उपस्थिति दर्ज करने तक, डिजिटल व्यवस्था अनावश्यक इंतज़ार कम करने के लिए बनाई गई है।',
  'Browse specialties and find a doctor.': 'विशेषज्ञता के अनुसार डॉक्टर खोजें।',
  'Pick a convenient date and available time.': 'अपनी सुविधा की उपलब्ध तारीख और समय चुनें।',
  'Review your details and receive a booking reference.': 'अपना विवरण जाँचें और बुकिंग संख्या प्राप्त करें।',
  'Patient-friendly guides and articles, ready for a medical review workflow.':
    'रोगियों के लिए उपयोगी जानकारी और लेख, चिकित्सा समीक्षा के लिए तैयार।',
  'Explore the appointment booking experience.': 'अपॉइंटमेंट बुकिंग का अनुभव देखें।',
  'Useful answers to common questions about the appointment experience.':
    'अपॉइंटमेंट संबंधी सामान्य प्रश्नों के उपयोगी उत्तर।',
  'How do I book an appointment online?': 'मैं ऑनलाइन अपॉइंटमेंट कैसे बुक करूँ?',
  'Choose a doctor, date and available time. The booking preview guides you through the remaining steps. No real appointment is created in this demo.':
    'डॉक्टर, तारीख और उपलब्ध समय चुनें। डेमो आपको अगले चरण दिखाएगा। इस डेमो में वास्तविक अपॉइंटमेंट नहीं बनता।',
  'Do I need an account to book?': 'क्या बुकिंग के लिए खाता चाहिए?',
  'The planned booking system supports guest appointments. In the preview, no account, phone verification or personal details are required.':
    'लाइव बुकिंग में मोबाइल सत्यापन आवश्यक है। डेमो में कोई वास्तविक खाता या व्यक्तिगत जानकारी आवश्यक नहीं है।',
  'Can I reschedule or cancel?': 'क्या मैं अपॉइंटमेंट बदल या रद्द कर सकता/सकती हूँ?',
  'Can I pay online?': 'क्या मैं ऑनलाइन भुगतान कर सकता/सकती हूँ?',
  'Is this website for emergencies?': 'क्या यह वेबसाइट आपातकालीन स्थिति के लिए है?',
  'No. This is a software preview and does not provide care. If you need emergency medical assistance, contact your local emergency services.':
    'नहीं। यह सॉफ़्टवेयर डेमो है और चिकित्सा सेवा नहीं देता। आपातकालीन चिकित्सा सहायता के लिए स्थानीय आपातकालीन सेवाओं से संपर्क करें।',
  'Choose an available appointment and verify your mobile number.':
    'उपलब्ध अपॉइंटमेंट चुनें और अपना मोबाइल नंबर सत्यापित करें।',
  'A guided preview of the online appointment experience.': 'ऑनलाइन अपॉइंटमेंट बुकिंग का चरणबद्ध डेमो।',
  'Preview only. No real appointments, patient details or charges are created.':
    'केवल डेमो। कोई वास्तविक अपॉइंटमेंट, रोगी विवरण या शुल्क दर्ज नहीं होता।',
  'Select a doctor and one of the sample available slots.': 'डॉक्टर और नमूना उपलब्ध समय स्लॉट चुनें।',
  'Use the fictional patient profile below; do not enter personal information.':
    'नीचे दिए काल्पनिक रोगी विवरण का उपयोग करें; निजी जानकारी न डालें।',
  'Check the selected appointment and choose a simulated payment method.':
    'चुना हुआ अपॉइंटमेंट जाँचें और डेमो भुगतान का तरीका चुनें।',
  'Nothing has been scheduled or charged in the real world.': 'कोई वास्तविक बुकिंग या भुगतान नहीं हुआ है।',
  'Confirm sample patient details': 'नमूना रोगी विवरण की पुष्टि करें',
  'Review your booking': 'बुकिंग की समीक्षा करें',
  'Your demo booking is complete': 'आपकी डेमो बुकिंग पूरी हुई',
  'I understand that this is a demonstration only and does not create a medical appointment.':
    'मैं समझता/समझती हूँ कि यह सिर्फ़ डेमो है और वास्तविक चिकित्सा अपॉइंटमेंट नहीं बनाता।',
  'Online payment preview': 'ऑनलाइन भुगतान डेमो',
  'Pay at hospital preview': 'अस्पताल में भुगतान डेमो',
  'No sensitive data or live payments.': 'कोई संवेदनशील डेटा या वास्तविक भुगतान नहीं।',
  'Amount shown is illustrative. No Razorpay SDK or live payment API is loaded.':
    'दिखाई गई राशि उदाहरण मात्र है। कोई वास्तविक भुगतान नहीं होता।',
  'Mobile verified. Use your own account for an adult self-booking.':
    'मोबाइल सत्यापित है। वयस्क स्वयं की बुकिंग के लिए अपना खाता उपयोग करें।',
  'Online payment reserves the selected slot for up to ten minutes. If payment is delayed, check your booking before paying again.':
    'ऑनलाइन भुगतान के लिए चुना स्लॉट अधिकतम दस मिनट तक आरक्षित रहता है। भुगतान में देरी हो तो फिर भुगतान करने से पहले बुकिंग जाँचें।',
  'No available appointments on this date.': 'इस तारीख को अपॉइंटमेंट उपलब्ध नहीं हैं।',
  'Online booking is currently closed. Contact the hospital.': 'ऑनलाइन बुकिंग अभी बंद है। अस्पताल से संपर्क करें।',
  'For emergencies or urgent symptoms, contact local emergency services instead of online booking.':
    'आपातकालीन स्थिति या गंभीर लक्षण होने पर ऑनलाइन बुकिंग के बजाय स्थानीय आपातकालीन सेवाओं से संपर्क करें।',
  'Verify your mobile to continue.': 'आगे बढ़ने के लिए मोबाइल सत्यापित करें।',
  'No bookings yet.': 'अभी कोई बुकिंग नहीं है।',
  'Sign in with your hospital-issued account. Access is determined by your assigned role and branch.':
    'अस्पताल द्वारा दिए गए खाते से लॉगिन करें। अनुमति आपकी भूमिका और शाखा पर निर्भर है।',
  'Better care starts with a better workflow.': 'बेहतर देखभाल की शुरुआत बेहतर कार्यप्रणाली से।',
  'Accounts are provisioned by the hospital.': 'खाते अस्पताल द्वारा बनाए जाते हैं।',
  'For authorized hospital personnel only': 'केवल अधिकृत अस्पताल कर्मचारियों के लिए',
  'Private and permission-controlled workspace': 'निजी और अनुमति-नियंत्रित कार्यक्षेत्र',
  'Do not include medical records, symptoms or emergency information. For emergencies, contact local emergency services.':
    'चिकित्सा रिकॉर्ड, लक्षण या आपातकालीन जानकारी न दें। आपात स्थिति में स्थानीय आपातकालीन सेवाओं से संपर्क करें।',
  'Use online appointment booking for routine outpatient visits. For an emergency, contact local emergency services.':
    'सामान्य ओपीडी मुलाकात के लिए ऑनलाइन अपॉइंटमेंट बुक करें। आपात स्थिति में स्थानीय आपातकालीन सेवाओं से संपर्क करें।',
  'Contact the hospital for directions.': 'रास्ते की जानकारी के लिए अस्पताल से संपर्क करें।',
  'Contact reception to confirm timings.': 'समय की पुष्टि के लिए रिसेप्शन से संपर्क करें।',
  'Patient information': 'रोगी जानकारी',
  'Need an appointment?': 'अपॉइंटमेंट चाहिए?',
  'Check availability or contact the hospital.': 'उपलब्धता देखें या अस्पताल से संपर्क करें।',
  'Schedule a visit': 'मुलाकात का समय तय करें',
  'Patient care': 'रोगी देखभाल',
  'Hospital information & appointments': 'अस्पताल की जानकारी और अपॉइंटमेंट',
  'Patient-friendly information. Each article is a placeholder pending medical review.':
    'रोगियों के लिए जानकारी। प्रत्येक नमूना लेख की चिकित्सा समीक्षा बाकी है।',
  'Preview only': 'केवल डेमो',
  'General information only. Not a substitute for individual medical advice.':
    'केवल सामान्य जानकारी। यह व्यक्तिगत चिकित्सकीय सलाह का विकल्प नहीं है।',
  'For emergencies, contact local emergency services.': 'आपात स्थिति में स्थानीय आपातकालीन सेवाओं से संपर्क करें।',
  'Preview request recorded locally. No message was sent.':
    'डेमो अनुरोध स्थानीय रूप से दर्ज हुआ। कोई संदेश नहीं भेजा गया।',
  'Request received. Reception can contact you during working hours.':
    'अनुरोध मिला। रिसेप्शन कार्य समय में संपर्क कर सकता है।',
  'Mobile verified': 'मोबाइल सत्यापित',
  'Secure HMS workspace': 'सुरक्षित अस्पताल पोर्टल',
  'Offline · reconnect before making changes': 'ऑफ़लाइन · बदलाव करने से पहले इंटरनेट से जुड़ें',
  'HMS app · connected': 'अस्पताल ऐप · कनेक्टेड',
  'Android / desktop: use the browser menu and select Install app or Add to Home screen if available. iPhone / iPad: in Safari, tap Share, then Add to Home Screen. The public hospital website remains a normal website.':
    'Android/डेस्कटॉप: ब्राउज़र मेन्यू में Install app या Add to Home screen चुनें। iPhone/iPad: Safari में Share, फिर Add to Home Screen चुनें। सार्वजनिक अस्पताल वेबसाइट सामान्य वेबसाइट ही रहेगी।',
  'Your name': 'आपका नाम',
  'Phone with country code': 'मोबाइल नंबर (देश कोड सहित)',
  'What can we help with?': 'हम आपकी किस प्रकार मदद कर सकते हैं?',
  'Opening hours': 'खुलने का समय',
  'Billing information': 'बिलिंग जानकारी',
  'General inquiry': 'सामान्य पूछताछ',
  'Install app': 'ऐप इंस्टॉल करें',
  'Install on your device': 'अपने डिवाइस पर इंस्टॉल करें',
  'Patient number or full name': 'रोगी संख्या या पूरा नाम',
  'Prescription copy (PDF, PNG or JPEG)': 'पर्चे की प्रति (PDF, PNG या JPEG)',
  'Late cancellation fee (₹)': 'देरी से रद्द करने का शुल्क (₹)',
  'Free cancellation cutoff (hours before appointment)': 'मुफ़्त रद्दीकरण की समय सीमा (अपॉइंटमेंट से पहले घंटे)',
  'Example: PT-000127 (existing MRN numbers also work)': 'उदाहरण: PT-000127 (पुराने MRN भी मान्य हैं)',
  'Max 4 MB. Secure malware scanning is mandatory.': 'अधिकतम 4 MB। सुरक्षित वायरस जाँच अनिवार्य है।',
  'Example: BK-00012A7': 'उदाहरण: BK-00012A7',
  Records: 'रिकॉर्ड',
  Policies: 'नीतियाँ',
  Home: 'मुखपृष्ठ',
  About: 'हमारे बारे में',
  'About us': 'हमारे बारे में',
  Doctors: 'डॉक्टर',
  'Our doctors': 'हमारे डॉक्टर',
  Specialties: 'विशेषज्ञ सेवाएँ',
  'Specialties & services': 'विशेषज्ञ सेवाएँ',
  'Health library': 'स्वास्थ्य जानकारी',
  Contact: 'संपर्क',
  'Contact & directions': 'संपर्क और दिशा-निर्देश',
  'Contact information': 'संपर्क जानकारी',
  'Contact reception': 'रिसेप्शन से संपर्क करें',
  'Staff login': 'स्टाफ लॉगिन',
  'Book appointment': 'अपॉइंटमेंट बुक करें',
  'Book an appointment': 'अपॉइंटमेंट बुक करें',
  'Book a visit': 'अपॉइंटमेंट बुक करें',
  'Book your visit': 'अपॉइंटमेंट बुक करें',
  'Find a doctor': 'डॉक्टर खोजें',
  'Find your doctor': 'डॉक्टर खोजें',
  'All doctors': 'सभी डॉक्टर',
  'Meet our doctors': 'हमारे डॉक्टरों से मिलें',
  'View profile': 'प्रोफ़ाइल देखें',
  'Read more': 'और पढ़ें',
  'Explore service': 'सेवा देखें',
  'Read guide': 'जानकारी पढ़ें',
  'Request callback': 'कॉलबैक का अनुरोध करें',
  'Request a callback': 'कॉलबैक का अनुरोध करें',
  'My appointments': 'मेरे अपॉइंटमेंट',
  'Manage booking': 'बुकिंग प्रबंधित करें',
  'Patient services': 'रोगी सेवाएँ',
  'Hospital operations': 'अस्पताल प्रबंधन',
  'Open HMS portal': 'अस्पताल पोर्टल खोलें',
  Explore: 'देखें',
  'Hospital address': 'अस्पताल का पता',
  'Reception & opening hours': 'रिसेप्शन और खुलने का समय',
  'Get directions': 'रास्ता देखें',
  'Plan your visit': 'अपनी मुलाकात की योजना बनाएँ',
  'Check availability': 'उपलब्धता देखें',
  'Hospital services': 'अस्पताल की सेवाएँ',
  'Professional profile': 'पेशेवर परिचय',
  Consultation: 'परामर्श',
  'Consultation fee': 'परामर्श शुल्क',
  'Frequently asked questions': 'अक्सर पूछे जाने वाले प्रश्न',
  'Need help?': 'सहायता चाहिए?',
  'Privacy notice': 'गोपनीयता सूचना',
  'Booking & cancellation': 'बुकिंग और रद्दीकरण',
  'Refund policy': 'धनवापसी नीति',
  'Our team': 'हमारी टीम',
  'Our specialties': 'हमारी विशेषज्ञ सेवाएँ',
  'Meet the team': 'हमारी टीम',
  'All specialties': 'सभी विशेषज्ञ सेवाएँ',
  'Your health. Our priority.': 'आपका स्वास्थ्य, हमारी प्राथमिकता।',
  'Care that feels': 'देखभाल जो लगे',
  'closer to home.': 'अपने घर के करीब।',
  'Care for every stage of life': 'जीवन के हर चरण में देखभाल',
  'Find the right doctor for you': 'अपने लिए सही डॉक्टर खोजें',
  'A simpler experience': 'आसान अनुभव',
  'Your visit, in three easy steps': 'तीन आसान चरणों में अपॉइंटमेंट',
  'Choose your doctor': 'डॉक्टर चुनें',
  'Select an appointment': 'अपॉइंटमेंट चुनें',
  'Review and confirm': 'जाँचें और पुष्टि करें',
  'Start booking': 'बुकिंग शुरू करें',
  'Information for a better visit': 'मुलाकात के लिए उपयोगी जानकारी',
  'Explore library': 'जानकारी देखें',
  'Take the next step': 'अगला कदम उठाएँ',
  'Make time for your health.': 'अपने स्वास्थ्य के लिए समय निकालें।',
  Website: 'वेबसाइट',
  'Return to website': 'वेबसाइट पर वापस जाएँ',
  Appointments: 'अपॉइंटमेंट',
  'Patient appointment booking': 'रोगी अपॉइंटमेंट बुकिंग',
  Overview: 'अवलोकन',
  Dashboard: 'डैशबोर्ड',
  'My patients': 'मेरे रोगी',
  Patients: 'रोगी',
  Consultations: 'परामर्श',
  Prescriptions: 'पर्चे',
  'Clinical records & prescriptions': 'चिकित्सा रिकॉर्ड और पर्चे',
  'Patient history search': 'रोगी इतिहास खोजें',
  'Prescription register': 'पर्चा रजिस्टर',
  'Cancellation policy': 'रद्दीकरण नीति',
  'OPD tokens': 'ओपीडी टोकन',
  'OPD queue': 'ओपीडी कतार',
  Availability: 'उपलब्धता',
  'Leave & availability': 'अवकाश और उपलब्धता',
  'Doctor leave': 'डॉक्टर का अवकाश',
  Billing: 'बिलिंग',
  Payments: 'भुगतान',
  Finance: 'वित्त',
  Reports: 'रिपोर्ट',
  'Reports & analytics': 'रिपोर्ट और विश्लेषण',
  'Staff & users': 'स्टाफ और उपयोगकर्ता',
  'Roles & permissions': 'भूमिकाएँ और अनुमतियाँ',
  'Website content': 'वेबसाइट सामग्री',
  'Audit log': 'ऑडिट लॉग',
  'Hospital settings': 'अस्पताल सेटिंग्स',
  'Team management': 'टीम प्रबंधन',
  'Notification jobs': 'सूचना कार्य',
  'Inquiries & callbacks': 'पूछताछ और कॉलबैक',
  'Patient corrections': 'रोगी जानकारी में सुधार',
  Workspace: 'कार्य क्षेत्र',
  Manage: 'प्रबंधन',
  Operations: 'संचालन',
  'Additional operations': 'अतिरिक्त संचालन',
  'Clinical operations': 'चिकित्सा संचालन',
  'Return to sign in': 'लॉगिन पर लौटें',
  'Sign out': 'लॉगआउट',
  'Sign in': 'लॉगिन करें',
  'Work email': 'कार्य ईमेल',
  Password: 'पासवर्ड',
  'Forgot your password?': 'पासवर्ड भूल गए?',
  'Welcome back.': 'फिर से स्वागत है।',
  'Verify your identity': 'अपनी पहचान सत्यापित करें',
  'Verify & sign in': 'सत्यापित करें और लॉगिन करें',
  '6-digit authenticator code': '6 अंकों का ऑथेंटिकेटर कोड',
  'Start again': 'फिर से शुरू करें',
  'Secure workforce portal': 'सुरक्षित कर्मचारी पोर्टल',
  Doctor: 'डॉक्टर',
  'Reception & staff': 'रिसेप्शन और स्टाफ',
  'Super admin': 'मुख्य प्रशासक',
  Patient: 'रोगी',
  'Patient name': 'रोगी का नाम',
  'Patient full name': 'रोगी का पूरा नाम',
  'Patient number': 'रोगी संख्या',
  'Booking number': 'बुकिंग संख्या',
  'Booking reference': 'बुकिंग संख्या',
  'Appointment date': 'अपॉइंटमेंट की तारीख',
  'Available times': 'उपलब्ध समय',
  'Available dates': 'उपलब्ध तारीखें',
  'Available time slots': 'उपलब्ध समय स्लॉट',
  'Select doctor': 'डॉक्टर चुनें',
  'Select a doctor': 'डॉक्टर चुनें',
  'Choose your appointment': 'अपॉइंटमेंट चुनें',
  'Choose your doctor & appointment': 'डॉक्टर और अपॉइंटमेंट चुनें',
  'Doctor & time': 'डॉक्टर और समय',
  'Verify identity': 'पहचान सत्यापन',
  'Review & payment': 'समीक्षा और भुगतान',
  'Your booking': 'आपकी बुकिंग',
  Confirmation: 'पुष्टि',
  'Verify your mobile': 'मोबाइल सत्यापित करें',
  'Review and reserve': 'समीक्षा करें और स्लॉट आरक्षित करें',
  'Your appointments': 'आपके अपॉइंटमेंट',
  'Mobile number (with country code)': 'मोबाइल नंबर (देश कोड सहित)',
  'Mobile number': 'मोबाइल नंबर',
  '6-digit SMS code': '6 अंकों का एसएमएस कोड',
  'Send verification code': 'सत्यापन कोड भेजें',
  'Verify code': 'कोड सत्यापित करें',
  'Change number / resend': 'नंबर बदलें / फिर भेजें',
  'Mobile verification': 'मोबाइल सत्यापन',
  Continue: 'आगे बढ़ें',
  Back: 'पीछे जाएँ',
  Cancel: 'रद्द करें',
  'Confirm appointment': 'अपॉइंटमेंट की पुष्टि करें',
  'Reserve & pay': 'आरक्षित करें और भुगतान करें',
  'Pay at hospital': 'अस्पताल में भुगतान करें',
  'Pay online using Razorpay': 'Razorpay से ऑनलाइन भुगतान करें',
  'Pay securely': 'सुरक्षित भुगतान करें',
  'Check payment': 'भुगतान जाँचें',
  'Refresh status': 'स्थिति अपडेट करें',
  'Print confirmation': 'पुष्टि प्रिंट करें',
  Reschedule: 'समय बदलें',
  'Appointment summary': 'अपॉइंटमेंट का विवरण',
  Date: 'तारीख',
  Time: 'समय',
  'Not selected': 'नहीं चुना गया',
  Visit: 'मुलाकात',
  Payment: 'भुगतान',
  'Payment method': 'भुगतान का तरीका',
  'Invoice reference': 'बिल संख्या',
  Search: 'खोजें',
  'Patient records & preferences': 'रोगी रिकॉर्ड और प्राथमिकताएँ',
  'My health records': 'मेरे स्वास्थ्य रिकॉर्ड',
  'My profile': 'मेरी प्रोफ़ाइल',
  'Released prescriptions': 'जारी किए गए पर्चे',
  'View prescription': 'पर्चा देखें',
  Invoices: 'बिल',
  'Communication preferences': 'संचार प्राथमिकताएँ',
  'View appointments': 'अपॉइंटमेंट देखें',
  Name: 'नाम',
  'Gender (optional)': 'लिंग (वैकल्पिक)',
  'Birth date': 'जन्म तिथि',
  'Save corrections': 'सुधार सहेजें',
  'Save roles': 'भूमिकाएँ सहेजें',
  'Invite staff': 'स्टाफ को आमंत्रित करें',
  'Initial role': 'प्रारंभिक भूमिका',
  'Refresh jobs': 'कार्य अपडेट करें',
  'New date': 'नई तारीख',
  Save: 'सहेजें',
  Close: 'बंद करें',
  Download: 'डाउनलोड',
  Confirmed: 'पुष्टि हुई',
  Cancelled: 'रद्द',
  Completed: 'पूर्ण',
  'In consultation': 'परामर्श जारी',
  'Checked in': 'उपस्थिति दर्ज',
  Unpaid: 'भुगतान बाकी',
  Paid: 'भुगतान हुआ',
  Refunded: 'धनवापसी हुई',
  'Partially refunded': 'आंशिक धनवापसी',
  Held: 'आरक्षित',
  Expired: 'समय समाप्त',
  Pending: 'लंबित',
  Processing: 'प्रक्रिया जारी',
  Requested: 'अनुरोध किया गया',
  Processed: 'प्रक्रिया पूर्ण',
  Failed: 'विफल',
  'Not required': 'आवश्यक नहीं',
  'No show': 'उपस्थित नहीं',
  'Booking confirmed': 'बुकिंग की पुष्टि हुई',
  'Patient appointment': 'रोगी अपॉइंटमेंट',
  'My bookings': 'मेरी बुकिंग',
  'Demo details': 'डेमो विवरण',
  'Demo confirmed': 'डेमो पुष्टि',
  'Sample total': 'नमूना कुल',
  'Confirm demo booking': 'डेमो बुकिंग की पुष्टि करें',
  'Book another demo visit': 'एक और डेमो बुकिंग करें',
  'Select a date to see sample time slots.': 'समय स्लॉट देखने के लिए तारीख चुनें।',
};
const eventName = 'hms-language-change';
let volatileLanguage: Language | null = null;
function readLanguage(): Language {
  if (volatileLanguage) return volatileLanguage;
  try {
    const url = new URL(window.location.href),
      hash = window.location.hash.slice(1);
    const query =
      url.searchParams.get('lang') ||
      (hash.includes('?') ? new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('lang') : null);
    if (query === 'hi' || query === 'en') return query;
    return localStorage.getItem('hms-language') === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}
export function useLanguage() {
  const [language, setLanguage] = useState<Language>('en');
  useEffect(() => {
    const sync = () => {
      const value = readLanguage();
      try {
        localStorage.setItem('hms-language', value);
      } catch {}
      setLanguage(value);
      document.documentElement.lang = value === 'hi' ? 'hi-IN' : 'en-IN';
    };
    sync();
    window.addEventListener(eventName, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(eventName, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return language;
}
export function changeLanguage(language: Language) {
  volatileLanguage = language;
  try {
    localStorage.setItem('hms-language', language);
  } catch {}
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', language);
      window.history.replaceState(null, '', url);
    }
    if (url.hash.includes('lang=')) {
      const h = new URL(url.hash.slice(1), 'http://localhost');
      h.searchParams.set('lang', language);
      url.hash = h.pathname + h.search;
      window.history.replaceState(null, '', url);
    }
  } catch {}
  window.dispatchEvent(new Event(eventName));
}
export function translate(en: string, language: Language) {
  return language === 'hi' ? hindi[en] || en : en;
}
export function L({ en, hi }: { en: string; hi?: string }) {
  const lang = useLanguage();
  return <>{lang === 'hi' ? hi || hindi[en] || en : en}</>;
}
export function Localized({ children }: { children: React.ReactNode }) {
  return typeof children === 'string' ? <L en={children} /> : <>{children}</>;
}
export function LanguageSwitch() {
  const language = useLanguage();
  return (
    <div className="language-switch" role="group" aria-label="Language / भाषा">
      <button type="button" aria-pressed={language === 'en'} onClick={() => changeLanguage('en')}>
        EN
      </button>
      <button type="button" lang="hi" aria-pressed={language === 'hi'} onClick={() => changeLanguage('hi')}>
        हिंदी
      </button>
    </div>
  );
}
export function LanguageLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const language = useLanguage();
  let target = href;
  try {
    const url = new URL(
      href,
      typeof window === 'undefined' || window.location.origin === 'null'
        ? 'http://localhost'
        : window.location.origin,
    );
    const known = [process.env.NEXT_PUBLIC_PORTAL_URL, process.env.NEXT_PUBLIC_WEBSITE_URL]
      .filter(Boolean)
      .some((v) => {
        try {
          return new URL(v!).origin === url.origin;
        } catch {
          return false;
        }
      });
    if (href.startsWith('/') || known) {
      url.searchParams.set('lang', language);
      target = href.startsWith('/') ? url.pathname + url.search + url.hash : url.toString();
    }
  } catch {}
  return (
    <a className={className} href={target}>
      {children}
    </a>
  );
}
