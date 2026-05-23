// Voice bot intents: heuristic keyword match -> generic localized lead-in.
// The server appends the live incidents/facilities, so replies are grounded in
// real data (no per-call LLM cost). Production: LLM intent + Whisper STT.
const noData = {
  en: 'No confirmed update right now. Please call 112 if it is urgent.',
  hi: 'अभी कोई पुष्टि अपडेट नहीं है। यदि जरूरी हो तो कृपया 112 पर कॉल करें।',
  pa: "ਹੁਣੇ ਕੋਈ ਪੁਸ਼ਟੀਕਰਨ ਅਪਡੇਟ ਨਹੀਂ ਹੈ। ਜੇ ਜ਼ਰੂਰੀ ਹੋਵੇ ਤਾਂ ਕਿਰਪਾ ਕਰਕੇ 112 'ਤੇ ਕਾਲ ਕਰੋ।",
  ta: 'தற்போது உறுதிப்படுத்தப்பட்ட தகவல்கள் எதுவும் இல்லை. அவசரம் என்றால் தயவுசெய்து 112-ஐ அழையுங்கள்.',
  bn: 'এখনও কোনো নিশ্চিত আপডেট নেই। জরুরি প্রয়োজনে অনুগ্রহ করে 112 নম্বরে কল করুন।'
};
const intents = {
  emergency: {
    keywords: { en: ['help', 'fire', 'medical', 'ambulance', 'urgent', 'emergency', 'bleeding', 'unconscious'], hi: ['मदद', 'आग', 'एम्बुलेंस', 'चिकित्सा', 'आपातकाल', 'बेहोश'], pa: ['ਮਦਦ', 'ਅੱਗ', 'ਐਂਬੂਲੈਂਸ', 'ਡਾਕਟਰ', 'ਐਮਰਜੈਂਸੀ'], ta: ['உதவி', 'தீ', 'ஆம்புலன்ஸ்', 'மருத்துவம்'], bn: ['সাহায্য', 'আগুন', 'অ্যাম্বুলেন্স', 'জরুরি'] },
    response: {
      en: 'Connecting you to emergency services on 112. Stay on the line. Tell me your nearest landmark.',
      hi: '112 आपातकालीन सेवा से जोड़ रहा हूँ। लाइन पर रहिए। अपना निकटतम landmark बताएँ।',
      pa: '112 ਐਮਰਜੈਂਸੀ ਨਾਲ ਜੋੜ ਰਿਹਾ ਹਾਂ। ਲਾਈਨ ਉੱਤੇ ਰਹੋ। ਆਪਣਾ ਨੇੜਲਾ landmark ਦੱਸੋ।',
      ta: '112 அவசர சேவைக்கு இணைக்கிறேன். வரிசையில் இருங்கள். உங்கள் அருகிலுள்ள landmark-ஐ சொல்லுங்கள்.',
      bn: '112 জরুরি সেবার সাথে যুক্ত করছি. লাইনে থাকুন. আপনার নিকটতম landmark বলুন.'
    }
  },
  shelter: {
    keywords: { en: ['shelter', 'place to stay', 'where to go', 'rest house', 'hostel'], hi: ['आश्रय', 'रहने की जगह', 'कहाँ जाएँ'], pa: ['ਆਸ਼ਰਯ', 'ਰਹਿਣ ਦੀ ਜਗ੍ਹਾ'], ta: ['தங்குமிடம்', 'எங்கே போகலாம்'], bn: ['আশ্রয়', 'থাকার জায়গা'] },
    response: {
      en: 'Here are the nearest relief points and facilities:',
      hi: 'यहाँ निकटतम राहत बिंदु और सुविधाएं दी गई हैं:',
      pa: 'ਇੱਥੇ ਨਜ਼ਦੀਕੀ ਰਾਹਤ ਪੁਆਇੰਟ ਅਤੇ ਸੁਵਿਧਾਵਾਂ ਹਨ:',
      ta: 'இதோ அருகிலுள்ள நிவாரண மையங்கள் மற்றும் வசதிகள்:',
      bn: 'এখানে নিকটতম ত্রাণ কেন্দ্র এবং সুবিধাগুলি রয়েছে:'
    }
  },
  road: {
    keywords: { en: ['road', 'highway', 'block', 'traffic', 'closed', 'open'], hi: ['सड़क', 'राजमार्ग', 'बंद', 'ट्रैफिक'], pa: ['ਸੜਕ', 'ਹਾਈਵੇ', 'ਬੰਦ', 'ਟਰੈਫਿਕ'], ta: ['சாலை', 'நெடுஞ்சாலை', 'மூடியது'], bn: ['রাস্তা', 'হাইওয়ে', 'বন্ধ'] },
    response: {
      en: 'Here is the current road status:',
      hi: 'यहाँ सड़क की वर्तमान स्थिति दी गई है:',
      pa: 'ਇੱਥੇ ਸੜਕ ਦੀ ਮੌਜੂਦਾ ਸਥਿਤੀ ਹੈ:',
      ta: 'இதோ தற்போதைய சாலை நிலை குறித்த தகவல்கள்:',
      bn: 'এখানে রাস্তার বর্তমান পরিস্থিতি দেওয়া হলো:'
    }
  },
  power: {
    keywords: { en: ['power', 'electricity', 'light', 'cut', 'outage'], hi: ['बिजली', 'लाइट', 'कटौती'], pa: ['ਬਿਜਲੀ', 'ਲਾਈਟ', 'ਕੱਟ'], ta: ['மின்சாரம்', 'விளக்கு', 'மின்தடை'], bn: ['বিদ্যুৎ', 'বাতি', 'বিভ্রাট'] },
    response: {
      en: 'Here is the latest on power supply:',
      hi: 'यहाँ बिजली आपूर्ति पर नवीनतम जानकारी दी गई है:',
      pa: 'ਇੱਥੇ ਬਿਜਲੀ ਸਪਲਾਈ ਬਾਰੇ ਤਾਜ਼ਾ ਜਾਣਕਾਰੀ ਹੈ:',
      ta: 'இதோ மின்சார விநியோகம் குறித்த சமீபத்திய தகவல்கள்:',
      bn: 'এখানে বিদ্যুৎ সরবরাহ সংক্রান্ত সর্বশেষ তথ্য দেওয়া হলো:'
    }
  },
  water: {
    keywords: { en: ['water', 'tanker', 'drinking'], hi: ['पानी', 'टैंकर'], pa: ['ਪਾਣੀ', 'ਟੈਂਕਰ'], ta: ['தண்ணீர்', 'டேங்கர்'], bn: ['পানি', 'ট্যাঙ্কার'] },
    response: {
      en: 'Here is the latest on water supply:',
      hi: 'यहाँ जल आपूर्ति पर नवीनतम जानकारी दी गई है:',
      pa: 'ਇੱਥੇ ਪਾਣੀ ਦੀ ਸਪਲਾਈ ਬਾਰੇ ਤਾਜ਼ਾ ਜਾਣਕਾਰੀ ਹੈ:',
      ta: 'இதோ குடிநீர் விநியோகம் குறித்த சமீபத்திய தகவல்கள்:',
      bn: 'এখানে জল সরবরাহ সংক্রান্ত সর্বশেষ তথ্য দেওয়া হলো:'
    }
  },
  medical: {
    keywords: { en: ['medical', 'doctor', 'medicine', 'insulin', 'first aid'], hi: ['डॉक्टर', 'दवा', 'चिकित्सा', 'इंसुलिन'], pa: ['ਡਾਕਟਰ', 'ਦਵਾਈ', 'ਡਾਕਟਰੀ'], ta: ['மருத்துவம்', 'மருந்து'], bn: ['চিকিৎসা', 'ডাক্তার', 'ওষুধ'] },
    response: {
      en: 'Here is the nearest medical help:',
      hi: 'यहाँ निकटतम चिकित्सा सहायता दी गई है:',
      pa: 'ਇੱਥੇ ਨਜ਼ਦੀਕੀ ਡਾਕਟਰੀ ਸਹਾਇਤਾ ਹੈ:',
      ta: 'இதோ அருகிலுள்ள மருத்துவ உதவி குறித்த தகவல்கள்:',
      bn: 'এখানে নিকটতম চিকিৎসা সহায়তা দেওয়া হলো:'
    }
  },
  fallback: {
    keywords: {},
    response: {
      en: "I didn't catch that. You can ask me about roads, shelters, power, water, or medical help. Or say 'emergency' to connect to 112.",
      hi: 'मुझे समझ नहीं आया। आप मुझसे सड़क, आश्रय, बिजली, पानी या चिकित्सा के बारे में पूछ सकते हैं। या 112 के लिए "आपातकाल" कहें।',
      pa: 'ਸਮਝ ਨਹੀਂ ਆਇਆ। ਤੁਸੀਂ ਸੜਕ, ਆਸ਼ਰਯ, ਬਿਜਲੀ, ਪਾਣੀ ਜਾਂ ਡਾਕਟਰੀ ਬਾਰੇ ਪੁੱਛ ਸਕਦੇ ਹੋ। ਜਾਂ 112 ਲਈ "ਐਮਰਜੈਂਸੀ" ਕਹੋ।',
      ta: 'புரியவில்லை. சாலை, தங்குமிடம், மின்சாரம், தண்ணீர் அல்லது மருத்துவம் பற்றி கேளுங்கள். அல்லது 112-க்கு "அவசரம்" என்று சொல்லுங்கள்.',
      bn: 'বুঝতে পারিনি। রাস্তা, আশ্রয়, বিদ্যুৎ, পানি বা চিকিৎসা সম্পর্কে জিজ্ঞাসা করতে পারেন। বা 112-এর জন্য "জরুরি" বলুন।'
    }
  }
};

function classify(text, lang = 'en') {
  if (!text) return 'fallback';
  const t = text.toLowerCase();
  const order = ['emergency', 'shelter', 'road', 'power', 'water', 'medical'];
  for (const intent of order) {
    const kws = (intents[intent].keywords[lang] || []).concat(intents[intent].keywords.en || []);
    for (const kw of kws) {
      if (t.includes(kw.toLowerCase())) return intent;
    }
  }
  return 'fallback';
}

function respond(text, lang = 'en') {
  const intent = classify(text, lang);
  const response = intents[intent].response[lang] || intents[intent].response.en;
  return { intent, response, lang, ts: Date.now() };
}

module.exports = { intents, classify, respond, noData };
