// ---- Google Cloud Speech-to-Text (v1, API-key auth) ----
//
// The browser's built-in speech recognition only listens in ONE language at a
// time, so Tamil/Hindi come out poorly and code-mixed "Tanglish" / "Hinglish"
// is hopeless. This sends the captured audio to Google instead, with the picked
// language as primary and the other two as alternates, so a sentence that mixes
// English and Tamil words is transcribed properly.
//
// Reuses GOOGLE_TTS_API_KEY (or GOOGLE_STT_API_KEY if set). The key must have the
// "Cloud Speech-to-Text API" enabled and allowed in its API restrictions.

const KEY = process.env.GOOGLE_STT_API_KEY || process.env.GOOGLE_TTS_API_KEY || "";
export const sttEnabled = Boolean(KEY);

const MODEL = process.env.STT_MODEL || "latest_short";
const ENDPOINT = "https://speech.googleapis.com/v1/speech:recognize";

// primary language per UI choice, plus the other two Indian locales as alternates
const LOCALE: Record<string, string> = { en: "en-IN", hi: "hi-IN", ta: "ta-IN" };
const ALL = ["en-IN", "hi-IN", "ta-IN"];

function encodingFor(mime: string): string | null {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "WEBM_OPUS";
  if (m.includes("ogg")) return "OGG_OPUS";
  if (m.includes("wav") || m.includes("l16") || m.includes("pcm")) return "LINEAR16";
  if (m.includes("mp3") || m.includes("mpeg")) return "MP3";
  if (m.includes("flac")) return "FLAC";
  return null;
}

export async function transcribe(
  audioBase64: string,
  mime: string,
  language: string,
): Promise<{ transcript: string; language: string }> {
  const encoding = encodingFor(mime);
  if (!encoding) throw new Error(`Unsupported audio type: ${mime}`);

  const primary = LOCALE[language] || "en-IN";
  const alternates = ALL.filter((l) => l !== primary);

  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      config: {
        encoding,
        languageCode: primary,
        alternativeLanguageCodes: alternates,
        model: MODEL,
        enableAutomaticPunctuation: true,
        // WEBM_OPUS / OGG_OPUS carry their own sample rate in the header
      },
      audio: { content: audioBase64 },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google STT ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    results?: { alternatives?: { transcript?: string }[]; languageCode?: string }[];
  };
  const transcript = (json.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
  return { transcript, language: json.results?.[0]?.languageCode ?? primary };
}
