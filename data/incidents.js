// LocalPulse: MLP mock data layer (no persistence; in-memory only)
// All numbers are illustrative for the capstone demo.

const NOW = () => Date.now();
const MIN = 60 * 1000;

// Solan, H.P. as base coordinates (Shoolini University area).
const BASE = { lat: 30.9087, lng: 77.0959 };

const incidents = [
  {
    id: 'inc-001',
    category: 'road',
    severity: 'high',
    title: { en: 'NH-5 blocked near Kandaghat', hi: 'कंडाघाट के पास NH-5 बंद', pa: 'ਕੰਡਾਘਾਟ ਕੋਲ NH-5 ਬੰਦ', ta: 'கண்டாகட் அருகே NH-5 அடைப்பு', bn: 'কান্দাঘাটের কাছে NH-5 বন্ধ' },
    summary: {
      en: 'Landslide debris blocking both lanes. Diversion via Subathu road active.',
      hi: 'भूस्खलन से दोनों लेन बंद। सुबाथू रोड से डायवर्जन सक्रिय।',
      pa: 'ਜ਼ਮੀਨ ਖਿਸਕਣ ਨਾਲ ਦੋਵੇਂ ਲੇਨ ਬੰਦ। ਸੁਬਾਥੂ ਸੜਕ ਰਾਹੀਂ ਡਾਇਵਰਜ਼ਨ ਚਾਲੂ।',
      ta: 'நிலச்சரிவில் இரண்டு பாதைகளும் அடைப்பு. சுபாது சாலை வழியாக மாற்றுப்பாதை.',
      bn: 'ভূমিধসে দুই লেন বন্ধ। সুবাথু রোড দিয়ে ডাইভারশন চালু।'
    },
    lat: BASE.lat + 0.05, lng: BASE.lng - 0.04,
    sources: 23, verified: 18, trust: 0.91,
    updatedAt: NOW() - 8 * MIN
  },
  {
    id: 'inc-002',
    category: 'shelter',
    severity: 'info',
    title: { en: 'Govt. Sr. Sec. School Solan: shelter open', hi: 'राजकीय वरिष्ठ माध्यमिक विद्यालय सोलन: आश्रय खुला', pa: 'ਸਰਕਾਰੀ ਸੀਨੀਅਰ ਸੈਕੰਡਰੀ ਸਕੂਲ ਸੋਲਨ: ਆਸ਼ਰਯ ਖੁੱਲ੍ਹਾ', ta: 'அரசு மேல்நிலைப் பள்ளி சோலான்: தங்குமிடம் திறந்தது', bn: 'সরকারি উচ্চ মাধ্যমিক বিদ্যালয় সোলান: আশ্রয় খোলা' },
    summary: {
      en: 'Capacity 220. Hot meals + medical. Open 24x7 till advisory lifts.',
      hi: 'क्षमता 220। गर्म भोजन और चिकित्सा। सलाह हटने तक 24x7 खुला।',
      pa: 'ਸਮਰੱਥਾ 220। ਗਰਮ ਖਾਣਾ ਤੇ ਡਾਕਟਰੀ। ਸਲਾਹ ਹਟਣ ਤੱਕ 24x7 ਖੁੱਲ੍ਹਾ।',
      ta: 'திறன் 220. சூடான உணவு + மருத்துவம். அறிவுறுத்தல் நீங்கும் வரை 24x7.',
      bn: 'ক্ষমতা 220। গরম খাবার ও চিকিৎসা। নির্দেশিকা ওঠা পর্যন্ত 24x7 খোলা।'
    },
    lat: BASE.lat - 0.01, lng: BASE.lng + 0.02,
    sources: 7, verified: 7, trust: 1.0,
    updatedAt: NOW() - 18 * MIN
  },
  {
    id: 'inc-003',
    category: 'power',
    severity: 'medium',
    title: { en: 'Power cut in Anhech, Chambaghat', hi: 'अन्हेच, चंबाघाट में बिजली कटौती', pa: 'ਅਨਹੇਚ, ਚੰਬਾਘਾਟ ਵਿੱਚ ਬਿਜਲੀ ਕੱਟ', ta: 'அன்ஹெச், சம்பாகட்டில் மின்தடை', bn: 'অন্হেচ, চম্বাঘাটে বিদ্যুৎ বিভ্রাট' },
    summary: {
      en: 'HPSEBL crew dispatched. ETA restoration: ~2 hours.',
      hi: 'HPSEBL टीम भेजी गई। बहाली का अनुमानित समय: ~2 घंटे।',
      pa: 'HPSEBL ਟੀਮ ਭੇਜੀ ਗਈ। ਮੁੜ ਚਾਲੂ ਹੋਣ ਦਾ ਸਮਾਂ: ~2 ਘੰਟੇ।',
      ta: 'HPSEBL குழு அனுப்பப்பட்டது. மீட்பு நேரம்: ~2 மணி.',
      bn: 'HPSEBL দল পাঠানো হয়েছে। পুনরুদ্ধারের সময়: ~2 ঘণ্টা।'
    },
    lat: BASE.lat + 0.01, lng: BASE.lng - 0.015,
    sources: 12, verified: 9, trust: 0.84,
    updatedAt: NOW() - 22 * MIN
  },
  {
    id: 'inc-004',
    category: 'water',
    severity: 'medium',
    title: { en: 'Water tanker at Mall Road every 2h', hi: 'मॉल रोड पर हर 2 घंटे में पानी का टैंकर', pa: 'ਮਾਲ ਰੋਡ ਉੱਤੇ ਹਰ 2 ਘੰਟੇ ਵਿੱਚ ਪਾਣੀ ਦਾ ਟੈਂਕਰ', ta: 'மால் ரோட்டில் ஒவ்வொரு 2 மணிக்கும் தண்ணீர் டேங்கர்', bn: 'মল রোডে প্রতি ২ ঘণ্টায় পানির ট্যাঙ্কার' },
    summary: {
      en: 'Bring own containers. Free, ID not required.',
      hi: 'अपने बर्तन लाएँ। मुफ्त, ID की आवश्यकता नहीं।',
      pa: 'ਆਪਣੇ ਭਾਂਡੇ ਲਿਆਓ। ਮੁਫ਼ਤ, ID ਦੀ ਲੋੜ ਨਹੀਂ।',
      ta: 'உங்கள் பாத்திரங்களை கொண்டு வாருங்கள். இலவசம், ID தேவையில்லை.',
      bn: 'নিজের পাত্র আনুন। বিনামূল্যে, ID লাগবে না।'
    },
    lat: BASE.lat, lng: BASE.lng,
    sources: 5, verified: 4, trust: 0.88,
    updatedAt: NOW() - 35 * MIN
  },
  {
    id: 'inc-005',
    category: 'medical',
    severity: 'high',
    title: { en: 'Mobile medical camp at Rajgarh PHC', hi: 'राजगढ़ PHC पर मोबाइल चिकित्सा शिविर', pa: 'ਰਾਜਗੜ੍ਹ PHC ਉੱਤੇ ਮੋਬਾਈਲ ਡਾਕਟਰੀ ਕੈਂਪ', ta: 'ராஜ்கட் PHC-யில் நகரும் மருத்துவ முகாம்', bn: 'রাজগড় PHC-তে মোবাইল চিকিৎসা শিবির' },
    summary: {
      en: 'Doctors, ambulance, basic meds. Insulin + ORS in stock.',
      hi: 'डॉक्टर, एम्बुलेंस, बुनियादी दवाएँ। इंसुलिन और ORS उपलब्ध।',
      pa: 'ਡਾਕਟਰ, ਐਂਬੂਲੈਂਸ, ਬੁਨਿਆਦੀ ਦਵਾਈਆਂ। ਇਨਸੁਲਿਨ ਤੇ ORS ਉਪਲਬਧ।',
      ta: 'மருத்துவர்கள், ஆம்புலன்ஸ், அடிப்படை மருந்துகள். இன்சுலின் + ORS கையிருப்பில்.',
      bn: 'ডাক্তার, অ্যাম্বুলেন্স, প্রাথমিক ওষুধ। ইনসুলিন ও ORS মজুদ।'
    },
    lat: BASE.lat - 0.04, lng: BASE.lng + 0.05,
    sources: 9, verified: 9, trust: 1.0,
    updatedAt: NOW() - 42 * MIN
  },
  {
    id: 'inc-006',
    category: 'rumor',
    severity: 'low',
    title: { en: 'Rumor flagged false: "dam burst at Giri"', hi: 'अफवाह झूठी पाई गई: "गिरि पर बांध फटा"', pa: 'ਅਫ਼ਵਾਹ ਝੂਠੀ ਮਿਲੀ: "ਗਿਰੀ ਉੱਤੇ ਡੈਮ ਫਟਿਆ"', ta: 'வதந்தி பொய்யென உறுதி: "கிரியில் அணை உடைப்பு"', bn: 'গুজব মিথ্যা প্রমাণিত: "গিরিতে বাঁধ ভেঙেছে"' },
    summary: {
      en: 'Cross-checked with HP-SDMA + 3 official sources. No incident.',
      hi: 'HP-SDMA और 3 आधिकारिक स्रोतों से क्रॉस-चेक। कोई घटना नहीं।',
      pa: 'HP-SDMA ਤੇ 3 ਅਧਿਕਾਰਤ ਸਰੋਤਾਂ ਨਾਲ ਜਾਂਚ। ਕੋਈ ਘਟਨਾ ਨਹੀਂ।',
      ta: 'HP-SDMA + 3 அதிகாரப்பூர்வ ஆதாரங்களுடன் சரிபார்ப்பு. சம்பவம் இல்லை.',
      bn: 'HP-SDMA ও 3টি সরকারি সূত্রের সাথে যাচাই। কোনো ঘটনা নেই।'
    },
    lat: BASE.lat + 0.07, lng: BASE.lng + 0.08,
    sources: 41, verified: 0, trust: 0.02,
    updatedAt: NOW() - 12 * MIN
  }
];

const shelters = [
  { id: 'sh-1', name: 'Govt. Sr. Sec. School Solan', capacity: 220, occupied: 84, lat: BASE.lat - 0.01, lng: BASE.lng + 0.02, amenities: ['meals', 'medical', 'power', 'wheelchair', 'female-ward'] },
  { id: 'sh-2', name: 'Yogananda Hostel, Shoolini Univ.', capacity: 180, occupied: 47, lat: BASE.lat + 0.012, lng: BASE.lng - 0.018, amenities: ['meals', 'wifi', 'power', 'medical'] },
  { id: 'sh-3', name: 'Community Centre, Chambaghat', capacity: 90, occupied: 90, lat: BASE.lat + 0.018, lng: BASE.lng - 0.025, amenities: ['meals', 'power'] }
];

const summary = (lang = 'en') => ({
  generatedAt: NOW(),
  window: '60m',
  language: lang,
  bullets: {
    en: [
      'NH-5 near Kandaghat: both lanes blocked. Diversion via Subathu live.',
      '3 shelters open in Solan; 311 beds total, 84 occupied.',
      'Power cut in Anhech / Chambaghat. Restoration ETA about 2h.',
      'Water tanker at Mall Road every 2 hours, free, no ID.',
      'Mobile medical camp at Rajgarh PHC. Insulin and ORS in stock.',
      '1 rumor flagged false (alleged Giri dam burst).'
    ],
    hi: [
      'कंडाघाट के पास NH-5: दोनों लेन बंद। सुबाथू डायवर्जन चालू।',
      'सोलन में 3 आश्रय खुले; कुल 311 बेड, 84 भरे हुए।',
      'अन्हेच / चंबाघाट में बिजली कटौती। बहाली लगभग 2 घंटे में।',
      'मॉल रोड पर हर 2 घंटे में पानी का टैंकर, मुफ्त, बिना ID।',
      'राजगढ़ PHC पर मोबाइल मेडिकल कैंप। इंसुलिन और ORS उपलब्ध।',
      '1 अफवाह झूठी पाई गई (कथित गिरि बांध फटना)।'
    ],
    pa: [
      'ਕੰਡਾਘਾਟ ਕੋਲ NH-5: ਦੋਵੇਂ ਲੇਨ ਬੰਦ। ਸੁਬਾਥੂ ਡਾਇਵਰਜ਼ਨ ਚਾਲੂ।',
      'ਸੋਲਨ ਵਿੱਚ 3 ਆਸ਼ਰਯ ਖੁੱਲ੍ਹੇ; ਕੁੱਲ 311 ਬੈੱਡ, 84 ਭਰੇ ਹਨ।',
      'ਅਨਹੇਚ / ਚੰਬਾਘਾਟ ਵਿੱਚ ਬਿਜਲੀ ਕੱਟ। ਮੁੜ ਚਾਲੂ ਲਗਭਗ 2 ਘੰਟੇ ਵਿੱਚ।',
      'ਮਾਲ ਰੋਡ ਉੱਤੇ ਹਰ 2 ਘੰਟੇ ਪਾਣੀ ਦਾ ਟੈਂਕਰ, ਮੁਫ਼ਤ, ID ਬਿਨਾਂ।',
      'ਰਾਜਗੜ੍ਹ PHC ਉੱਤੇ ਮੋਬਾਈਲ ਡਾਕਟਰੀ ਕੈਂਪ। ਇਨਸੁਲਿਨ ਤੇ ORS।',
      '1 ਅਫ਼ਵਾਹ ਝੂਠੀ ਮਿਲੀ (ਕਥਿਤ ਗਿਰੀ ਡੈਮ ਫਟਣਾ)।'
    ],
    ta: [
      'கண்டாகட் அருகே NH-5: இரண்டு பாதைகளும் அடைப்பு. சுபாது மாற்றுப்பாதை.',
      'சோலானில் 3 தங்குமிடம் திறந்துள்ளன; மொத்தம் 311 படுக்கைகள், 84 நிரப்பப்பட்டுள்ளன.',
      'அன்ஹெச் / சம்பாகட்டில் மின்தடை. மீட்பு சுமார் 2 மணி.',
      'மால் ரோட்டில் 2 மணிக்கொருமுறை இலவச தண்ணீர் டேங்கர்.',
      'ராஜ்கட் PHC-யில் நகரும் மருத்துவ முகாம். இன்சுலின் மற்றும் ORS.',
      '1 வதந்தி பொய்யென உறுதி (கிரி அணை உடைப்பு).'
    ],
    bn: [
      'কান্দাঘাটের কাছে NH-5: দুই লেন বন্ধ। সুবাথু ডাইভারশন চালু।',
      'সোলানে ৩টি আশ্রয় খোলা; মোট ৩১১ শয্যা, ৮৪ ভর্তি।',
      'অন্হেচ / চম্বাঘাটে বিদ্যুৎ বিভ্রাট। পুনরুদ্ধার প্রায় ২ ঘণ্টায়।',
      'মল রোডে প্রতি ২ ঘণ্টায় বিনামূল্যে পানির ট্যাঙ্কার, ID ছাড়াই।',
      'রাজগড় PHC-তে মোবাইল চিকিৎসা শিবির। ইনসুলিন ও ORS।',
      '১টি গুজব মিথ্যা প্রমাণিত (গিরি বাঁধ ভাঙা)।'
    ]
  }[lang] || []
});

module.exports = { incidents, shelters, summary, BASE };
