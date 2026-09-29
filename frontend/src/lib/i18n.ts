import type { Lang } from "../types";

const S = {
  title: { en: "Nearby Wells Intelligence System", hi: "निकटवर्ती कुआँ इंटेलिजेंस सिस्टम", as: "ওচৰৰ কুঁৱা বুদ্ধিমত্তা ব্যৱস্থা" },
  driller: { en: "Driller", hi: "ड्रिलर", as: "ড্ৰিলাৰ" },
  geologist: { en: "Geologist", hi: "भूविज्ञानी", as: "ভূতত্ত্ববিদ" },
  manager: { en: "Manager", hi: "प्रबंधक", as: "পৰিচালক" },
  overview: { en: "Overview", hi: "अवलोकन", as: "অৱলোকন" },
  kb: { en: "Knowledge Base", hi: "ज्ञान आधार", as: "জ্ঞান ভঁৰাল" },
  ingest: { en: "Ingest & Verify", hi: "इनपुट व सत्यापन", as: "গ্ৰহণ আৰু সত্যাপন" },
  ask: { en: "Ask NWIS", hi: "NWIS से पूछें", as: "NWIS ক সোধক" },
  view3d: { en: "3D Hazard Map", hi: "3D जोखिम मानचित्र", as: "3D বিপদ মানচিত্ৰ" },
  radius: { en: "Offset radius", hi: "ऑफसेट त्रिज्या", as: "অফছেট ব্যাসাৰ্ধ" },
  bitDepth: { en: "Bit depth", hi: "बिट गहराई", as: "বিট গভীৰতা" },
  lookAhead: { en: "Look-Ahead Alerts", hi: "आगामी खतरे की चेतावनी", as: "আগন্তুক বিপদৰ সতৰ্কবাণী" },
  noAlerts: { en: "No hazards within the look-ahead window.", hi: "आगे के दायरे में कोई खतरा नहीं।", as: "আগৰ পৰিসৰত কোনো বিপদ নাই।" },
  worked: { en: "What worked", hi: "क्या कारगर रहा", as: "কি কাম কৰিছিল" },
  failed: { en: "What failed", hi: "क्या विफल रहा", as: "কি বিফল হৈছিল" },
  ack: { en: "Acknowledge", hi: "स्वीकार करें", as: "স্বীকাৰ কৰক" },
  acked: { en: "Acknowledged", hi: "स्वीकृत", as: "স্বীকৃত" },
  prespud: { en: "Export Pre-Spud PDF Briefing", hi: "प्री-स्पड PDF ब्रीफिंग", as: "প্ৰি-স্পাড PDF ব্ৰিফিং" },
  offline: { en: "Offline — showing cached data", hi: "ऑफ़लाइन — कैश डेटा", as: "অফলাইন — কেশ্ব তথ্য" },
  askPlaceholder: { en: "What mitigation worked at 2,800m in nearby wells?", hi: "आसपास के कुओं में 2800 मीटर पर मड लॉस का क्या उपाय कारगर रहा?", as: "ওচৰৰ কুঁৱাত ২৮০০ মিটাৰত মাড লছৰ কি সমাধান কাম কৰিছিল?" },
  send: { en: "Ask", hi: "पूछें", as: "সোধক" },
  risk: { en: "Risk by depth", hi: "गहराई अनुसार जोखिम", as: "গভীৰতা অনুসৰি বিপদ" },
  why: { en: "Why this risk?", hi: "यह जोखिम क्यों?", as: "এই বিপদ কিয়?" },
  correlation: { en: "Well Correlation", hi: "कुआँ सहसंबंध", as: "কুঁৱা সম্পৰ্ক" },
  similarity: { en: "Offset Similarity Ranking", hi: "ऑफसेट समानता रैंकिंग", as: "অফছেট সাদৃশ্য ক্ৰম" },
  telemetry: { en: "Live MWD Telemetry", hi: "लाइव MWD टेलीमेट्री", as: "লাইভ MWD টেলিমেট্ৰি" },
  to: { en: "to", hi: "तक", as: "লৈ" },
} as const;

export type Key = keyof typeof S;
export const tr = (k: Key, lang: Lang) => S[k][lang] ?? S[k].en;
export const LANG_LABEL: Record<Lang, string> = { en: "English", hi: "हिन्दी", as: "অসমীয়া" };
