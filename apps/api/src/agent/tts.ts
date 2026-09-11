// ---- Google Cloud Text-to-Speech (Chirp 3: HD voices) ----
//
// Turns the assistant's reply into natural, expressive speech in English,
// Hindi or Tamil. Chirp 3: HD carries its own prosody — no SSML pitch hacks —
// so the voice actually rises and falls instead of reading in a monotone.
//
// Chirp 3: HD rejects any single "sentence" over its length limit and only
// recognises ASCII . ! ? as sentence ends — not the Devanagari danda (।) or a
// comma. So we normalise punctuation, break the reply into small chunks, ask
// Google for each, and stitch the MP3s back together.
//
// Needs GOOGLE_TTS_API_KEY (a Google Cloud API key with the Text-to-Speech API
// enabled). Without it the endpoint reports "not configured" and the browser
// falls back to the OS speech synthesiser.

const KEY = process.env.GOOGLE_TTS_API_KEY || "";
export const ttsEnabled = Boolean(KEY);

const LOCALE: Record<string, string> = { en: "en-IN", hi: "hi-IN", ta: "ta-IN" };

// The 30 Chirp 3: HD voices are offered in every supported locale, so one name
// works across all three languages. Override per language with TTS_VOICE_*.
const DEFAULT_VOICE = process.env.TTS_VOICE || "Aoede";
const VOICE: Record<string, string> = {
  en: process.env.TTS_VOICE_EN || DEFAULT_VOICE,
  hi: process.env.TTS_VOICE_HI || DEFAULT_VOICE,
  ta: process.env.TTS_VOICE_TA || DEFAULT_VOICE,
};
// A touch faster than 1.0 — Chirp 3: HD at exactly 1.0 sounds like a slow
// newsreader. 1.12–1.2 lands close to how people actually talk.
const RATE = Number(process.env.TTS_RATE || "1.15") || 1.15;

const ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const MAX_CHARS = 5000; // hard cap on the whole reply
const CHUNK_BYTES = 480; // stay well under Chirp 3: HD's per-sentence limit

const byteLen = (s: string) => Buffer.byteLength(s, "utf8");

/** Break text into <=CHUNK_BYTES pieces, splitting on sentence ends first. */
export function chunkText(input: string): string[] {
  const text = input
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[\s>]*[-*+•]\s+/gm, "") // list bullets — don't let TTS say "minus"
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_#>|]/g, "")
    .replace(/[–—]/g, ", ")
    .replace(/(\S)\s-\s(\S)/g, "$1, $2")
    .replace(/[।॥]+/g, ".") // Devanagari danda → period so Google sees a sentence end
    .replace(/\s*\n+\s*/g, ". ")
    .replace(/([:;,.])\s*\.\s*/g, "$1 ") // tidy the "text:. Next" / ".. " seams
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return [];

  // sentence-ish units, keeping their trailing punctuation
  const units = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const chunks: string[] = [];
  let cur = "";

  const pushHard = (piece: string) => {
    // a single unit still too big — split on commas, then on spaces
    let buf = "";
    for (const part of piece.split(/(?<=,)\s*/)) {
      if (byteLen(buf + part) > CHUNK_BYTES && buf) {
        chunks.push(buf.trim());
        buf = "";
      }
      if (byteLen(part) > CHUNK_BYTES) {
        for (const word of part.split(" ")) {
          if (byteLen(buf + " " + word) > CHUNK_BYTES && buf) {
            chunks.push(buf.trim());
            buf = "";
          }
          buf += (buf ? " " : "") + word;
        }
      } else {
        buf += part;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
  };

  for (const u of units) {
    if (byteLen(u) > CHUNK_BYTES) {
      if (cur.trim()) {
        chunks.push(cur.trim());
        cur = "";
      }
      pushHard(u);
    } else if (byteLen(cur + u) > CHUNK_BYTES) {
      if (cur.trim()) chunks.push(cur.trim());
      cur = u;
    } else {
      cur += u;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

async function synthChunk(text: string, locale: string, voice: string): Promise<Buffer> {
  const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(KEY)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: locale, name: `${locale}-Chirp3-HD-${voice}` },
      audioConfig: { audioEncoding: "MP3", speakingRate: RATE },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google TTS ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { audioContent?: string };
  if (!json.audioContent) throw new Error("Google TTS returned no audio");
  return Buffer.from(json.audioContent, "base64");
}

export async function synthesize(
  text: string,
  language: string,
): Promise<{ audio: string; mime: string }> {
  const lang = LOCALE[language] ? language : "en";
  const locale = LOCALE[lang];
  const voice = VOICE[lang];

  const chunks = chunkText(text.slice(0, MAX_CHARS));
  if (chunks.length === 0) throw new Error("Nothing to speak");

  const parts: Buffer[] = [];
  for (const c of chunks) parts.push(await synthChunk(c, locale, voice));

  // MP3 frame streams concatenate cleanly for playback.
  return { audio: Buffer.concat(parts).toString("base64"), mime: "audio/mpeg" };
}
