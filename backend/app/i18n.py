"""Localised alert templates + query normalisation for English, Hindi and Assamese."""
from __future__ import annotations

import re

LANGS = ("en", "hi", "as")

STRINGS = {
    "alert.approach": {
        "en": "🚨 WARNING: {dist}m to {fm} — {k} of {n} offset wells experienced {event} (Avg NPT: {npt} hrs) between {lo}m – {hi}m.",
        "hi": "🚨 चेतावनी: {fm} तक {dist} मीटर — {n} में से {k} ऑफसेट कुओं में {event} हुआ (औसत NPT: {npt} घंटे), {lo} मी – {hi} मी के बीच।",
        "as": "🚨 সতৰ্কবাণী: {fm} লৈ {dist} মিটাৰ — {n} টাৰ ভিতৰত {k} টা অফছেট কুঁৱাত {event} হৈছিল (গড় NPT: {npt} ঘণ্টা), {lo} মি – {hi} মি ৰ মাজত।",
    },
    "alert.inside": {
        "en": "🚨 IN ZONE: Drilling {fm} — {k} of {n} offset wells experienced {event} (Avg NPT: {npt} hrs) between {lo}m – {hi}m.",
        "hi": "🚨 क्षेत्र में: {fm} की ड्रिलिंग — {n} में से {k} ऑफसेट कुओं में {event} हुआ (औसत NPT: {npt} घंटे), {lo} मी – {hi} मी के बीच।",
        "as": "🚨 অঞ্চলত: {fm} খনন চলি আছে — {n} টাৰ ভিতৰত {k} টা অফছেট কুঁৱাত {event} হৈছিল (গড় NPT: {npt} ঘণ্টা), {lo} মি – {hi} মি ৰ মাজত।",
    },
    "event.loss": {"en": "severe Mud Loss", "hi": "गंभीर मड लॉस", "as": "গুৰুতৰ মাড লছ"},
    "event.kick": {"en": "a Kick / well-control event", "hi": "किक (वेल कंट्रोल घटना)", "as": "কিক (কুঁৱা নিয়ন্ত্ৰণ ঘটনা)"},
    "event.stuck_pipe": {"en": "Stuck Pipe", "hi": "स्टक पाइप", "as": "আবদ্ধ পাইপ"},
    "event.caving": {"en": "Hole Caving", "hi": "होल केविंग", "as": "গাঁত খহি পৰা"},
    "rag.intro": {
        "en": "Based on {n} matching report excerpts from nearby wells:",
        "hi": "आसपास के कुओं की {n} मिलती-जुलती रिपोर्टों के आधार पर:",
        "as": "ওচৰৰ কুঁৱাৰ {n} টা মিল থকা প্ৰতিবেদনৰ ভিত্তিত:",
    },
    "rag.worked": {"en": "What worked", "hi": "क्या कारगर रहा", "as": "কি কাম কৰিছিল"},
    "rag.failed": {"en": "What failed", "hi": "क्या विफल रहा", "as": "কি বিফল হৈছিল"},
    "rag.none": {
        "en": "No matching evidence was found in the indexed DDR/WCR corpus.",
        "hi": "अनुक्रमित DDR/WCR रिपोर्टों में कोई मेल खाता साक्ष्य नहीं मिला।",
        "as": "সূচীভুক্ত DDR/WCR প্ৰতিবেদনত কোনো মিল থকা প্ৰমাণ পোৱা নগ'ল।",
    },
}


def t(key: str, lang: str = "en", **kw) -> str:
    table = STRINGS.get(key, {})
    s = table.get(lang if lang in LANGS else "en") or table.get("en", key)
    return s.format(**kw) if kw else s


# Glossary used to map Hindi / Assamese drilling vocabulary to the English index terms.
GLOSSARY = {
    # Hindi
    "नुकसान": "loss", "लॉस": "loss", "मड": "mud", "रिसाव": "loss", "किक": "kick", "गैस": "gas",
    "फंसा": "stuck", "फँसा": "stuck", "अटका": "stuck", "पाइप": "pipe", "केविंग": "caving", "धंसना": "caving",
    "उपाय": "mitigation", "समाधान": "mitigation", "काम": "worked", "गहराई": "depth", "मीटर": "m",
    "कुओं": "wells", "कुआं": "well", "रेत": "sandstone", "बलुआ": "sandstone", "मिट्टी": "clay", "कोयला": "coal", "शेल": "shale",
    # Assamese
    "লছ": "loss", "লোকচান": "loss", "মাড": "mud", "কিক": "kick", "গেছ": "gas", "আবদ্ধ": "stuck", "পাইপ": "pipe",
    "খহি": "caving", "সমাধান": "mitigation", "উপায়": "mitigation", "গভীৰতা": "depth", "মিটাৰ": "m", "কুঁৱা": "well",
    "বালি": "sandstone", "মাটি": "clay", "কয়লা": "coal", "শ্বেল": "shale",
}
_DIGITS = str.maketrans("०१२३४५६७८९০১২৩৪৫৬৭৮৯", "01234567890123456789")


def detect_lang(text: str) -> str:
    if re.search(r"[ঀ-৿]", text):
        return "as"
    if re.search(r"[ऀ-ॿ]", text):
        return "hi"
    return "en"


def normalise_query(text: str) -> str:
    s = text.translate(_DIGITS)
    for k, v in GLOSSARY.items():
        s = s.replace(k, f" {v} ")
    return s
