// ---- assistant streaming + voice helpers ----
import { API_BASE } from "./api";

export type AgentEvent =
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "done"; appended: ChatMessage[] }
  | { type: "error"; message: string };

export type ChatMessage = { role: "user" | "assistant"; content: unknown };
export type Lang = "en" | "hi" | "ta";

export const LANGS: { code: Lang; label: string; bcp47: string }[] = [
  { code: "en", label: "English", bcp47: "en-IN" },
  { code: "hi", label: "हिन्दी", bcp47: "hi-IN" },
  { code: "ta", label: "தமிழ்", bcp47: "ta-IN" },
];

export async function streamChat(
  body: { language: Lang; messages: ChatMessage[]; operate?: boolean },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API_BASE}/agent/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    onEvent({ type: "error", message: `HTTP ${res.status}` });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const chunks = buf.split("\n\n");
    buf = chunks.pop() ?? "";
    for (const c of chunks) {
      const line = c.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      } catch {
        /* ignore malformed frame */
      }
    }
  }
}

// ---- text extraction from Claude message content ----
export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
  return "";
}
export function toolUsesOf(content: unknown): { name: string; input: unknown }[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_use")
    .map((b) => ({ name: (b as { name: string }).name, input: (b as { input: unknown }).input }));
}
export function isToolResultTurn(m: ChatMessage): boolean {
  return (
    m.role === "user" &&
    Array.isArray(m.content) &&
    m.content.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result")
  );
}

// ---- speech-to-text ----
// The browser recogniser drives timing + an instant preview; when audio capture
// is enabled, `takeAudio()` hands back everything heard since the last call so
// the server can re-transcribe it with Google (multi-language / code-mixed).
type Recognizer = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  takeAudio: () => Promise<{ blob: Blob; mime: string } | null>;
  clearAudio: () => void; // drop buffered audio (e.g. echo picked up while the assistant spoke)
};

export function speechSupported() {
  return typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
}

/** Available microphones. Labels are blank until the site has mic permission. */
export async function listMics(): Promise<{ deviceId: string; label: string }[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "audioinput" && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

function pickAudioMime(): string {
  const M = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  const opts = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
  for (const o of opts) if (M?.isTypeSupported?.(o)) return o;
  return "";
}

export function createRecognizer(
  bcp47: string,
  handlers: {
    onPartial?: (t: string) => void;
    onFinal: (t: string) => void;
    onEnd?: () => void;
    onError?: (e: string) => void;
    onSpeechStart?: () => void;
  },
  opts?: { continuous?: boolean; captureAudio?: boolean; micId?: string },
): Recognizer | null {
  const w = window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor() as {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    maxAlternatives: number;
    onresult: (e: {
      resultIndex: number;
      results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
    }) => void;
    onerror: (e: { error: string }) => void;
    onend: () => void;
    onspeechstart: () => void;
    start: () => void;
    stop: () => void;
    abort: () => void;
  };
  rec.lang = bcp47;
  rec.interimResults = true;
  rec.continuous = opts?.continuous ?? false;
  rec.maxAlternatives = 1;
  rec.onspeechstart = () => handlers.onSpeechStart?.();
  rec.onresult = (e) => {
    // In continuous mode `e.results` is cumulative and re-delivered on every
    // event — only look at what changed this time (from `e.resultIndex`),
    // otherwise every earlier phrase is re-emitted again and again.
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const t = r[0].transcript.trim();
        if (t) handlers.onFinal(t);
      } else {
        interim += r[0].transcript;
      }
    }
    if (interim.trim()) handlers.onPartial?.(interim.trim());
  };
  rec.onerror = (e) => handlers.onError?.(e.error);
  rec.onend = () => handlers.onEnd?.();

  // ---- parallel raw-audio capture for server-side transcription ----
  let stream: MediaStream | null = null;
  let mr: MediaRecorder | null = null;
  let header: Blob | null = null;
  let chunks: Blob[] = [];
  const mime = opts?.captureAudio ? pickAudioMime() : "";

  if (opts?.captureAudio && typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia) {
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };
    if (opts.micId && opts.micId !== "default") audio.deviceId = { exact: opts.micId };
    navigator.mediaDevices
      .getUserMedia({ audio })
      .then((s) => {
        stream = s;
        mr = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        mr.ondataavailable = (ev) => {
          if (!ev.data || ev.data.size === 0) return;
          if (!header) header = ev.data;
          chunks.push(ev.data);
        };
        mr.start(250); // emit a blob every 250ms
      })
      .catch(() => {
        /* mic capture unavailable — the browser transcript still works */
      });
  }

  const cleanup = () => {
    try {
      if (mr && mr.state !== "inactive") mr.stop();
    } catch {
      /* ignore */
    }
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    mr = null;
    chunks = [];
    header = null;
  };

  return {
    start: () => rec.start(),
    stop: () => {
      cleanup();
      rec.stop();
    },
    abort: () => {
      cleanup();
      rec.abort();
    },
    takeAudio: async () => {
      if (!mr) return null;
      // let the recorder flush the last slice
      await new Promise((r) => setTimeout(r, 60));
      if (chunks.length === 0) return null;
      const parts = header && chunks[0] !== header ? [header, ...chunks] : [...chunks];
      chunks = [];
      return { blob: new Blob(parts, { type: mr.mimeType || mime || "audio/webm" }), mime: mr.mimeType || mime || "audio/webm" };
    },
    clearAudio: () => {
      chunks = []; // `header` stays cached and is re-prepended on the next takeAudio()
    },
  };
}

/** Send a captured audio turn to the server for accurate multi-language transcription. */
export async function transcribeAudio(
  blob: Blob,
  mime: string,
  lang: Lang,
): Promise<string | null> {
  const buf = await blob.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const b64 = btoa(bin);
  try {
    const res = await fetch(`${API_BASE}/agent/stt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: b64, mime, language: lang }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { transcript?: string };
    return (j.transcript ?? "").trim() || null;
  } catch {
    return null;
  }
}

// ---- text-to-speech ----
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[\s>]*[-*+•]\s+/gm, "") // bullet markers → nothing (don't read "- " as "minus")
    .replace(/^\s*\d+[.)]\s+/gm, "") // "1. " / "2) " list markers
    .replace(/[*_#>]/g, "")
    .replace(/\|/g, " ")
    .replace(/[–—]/g, ", ") // en/em dash → a pause
    .replace(/(\S)\s-\s(\S)/g, "$1, $2") // spaced hyphen between words → pause, not "minus"
    .replace(/\s+/g, " ")
    .trim();
}

let voicesCache: SpeechSynthesisVoice[] = [];
if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const load = () => (voicesCache = window.speechSynthesis.getVoices());
  load();
  window.speechSynthesis.onvoiceschanged = load;
}

// Voice output is always available now: cloud TTS when the API has a key,
// the browser synthesiser otherwise.
export function ttsSupported() {
  return typeof window !== "undefined";
}

const bcp47Of = (lang: Lang) => LANGS.find((l) => l.code === lang)?.bcp47 ?? "en-IN";

let cloudTtsDown = false; // set once the API reports TTS unconfigured — skip the round-trip after that

function pickVoice(bcp47: string): SpeechSynthesisVoice | undefined {
  const lang2 = bcp47.split("-")[0];
  return (
    voicesCache.find((x) => x.lang === bcp47 && /natural|online|neural/i.test(x.name)) ??
    voicesCache.find((x) => x.lang.startsWith(lang2) && /natural|online|neural/i.test(x.name)) ??
    voicesCache.find((x) => x.lang === bcp47) ??
    voicesCache.find((x) => x.lang.startsWith(lang2))
  );
}

/**
 * A streaming speech queue. `push()` a sentence the moment it's ready and it is
 * synthesised (Google Chirp 3: HD, or the browser voice as a fallback) while the
 * earlier ones are still playing, so the assistant starts talking almost as soon
 * as its first sentence lands instead of waiting for the whole reply.
 *
 * `end()` when no more sentences are coming; `stop()` to cut it off (barge-in).
 * `onStart` fires when audio actually begins, `onEnd` when the queue drains.
 */
export type Speech = { push: (sentence: string) => void; end: () => void; stop: () => void };

export function createSpeech(lang: Lang, opts?: { onStart?: () => void; onEnd?: () => void }): Speech {
  const bcp47 = bcp47Of(lang);
  let stopped = false;
  let ended = false;
  let started = false;

  // cloud path: ordered slots, filled asynchronously
  const slots: (HTMLAudioElement | null | undefined)[] = [];
  let playIdx = 0;
  let pending = 0;
  let curAudio: HTMLAudioElement | null = null;
  const acs = new Set<AbortController>();

  // browser fallback path
  let bQueued = 0;
  let bDone = 0;

  const finish = () => {
    if (stopped) return;
    stopped = true;
    opts?.onEnd?.();
  };

  const kickStart = () => {
    if (!started) {
      started = true;
      opts?.onStart?.();
    }
  };

  const advance = () => {
    if (stopped || curAudio) return;
    while (playIdx < slots.length) {
      const slot = slots[playIdx];
      if (slot === undefined) return; // still synthesising this one — wait
      playIdx++;
      if (slot === null) continue; // failed — skip
      curAudio = slot;
      kickStart();
      slot.onended = slot.onerror = () => {
        curAudio = null;
        advance();
      };
      void slot.play().catch(() => {
        curAudio = null;
        advance();
      });
      return;
    }
    if (ended && pending === 0) finish();
  };

  const pushCloud = (sentence: string) => {
    const idx = slots.length;
    slots.push(undefined);
    pending++;
    const ac = new AbortController();
    acs.add(ac);
    fetch(`${API_BASE}/agent/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sentence.slice(0, 2000), language: lang }),
      signal: ac.signal,
    })
      .then(async (r) => {
        if (r.status === 503) {
          cloudTtsDown = true;
          throw new Error("tts-unconfigured");
        }
        if (!r.ok) throw new Error(`tts-${r.status}`);
        const { audio, mime } = (await r.json()) as { audio: string; mime?: string };
        return new Audio(`data:${mime || "audio/mpeg"};base64,${audio}`);
      })
      .then((a) => {
        slots[idx] = stopped ? null : a;
      })
      .catch(() => {
        slots[idx] = null;
        if (cloudTtsDown && !stopped) pushBrowser(sentence); // salvage this sentence via the OS voice
      })
      .finally(() => {
        acs.delete(ac);
        pending--;
        advance();
      });
  };

  const pushBrowser = (sentence: string) => {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(stripMarkdown(sentence));
    u.lang = bcp47;
    const v = pickVoice(bcp47);
    if (v) u.voice = v;
    u.rate = 1;
    u.pitch = 1.03;
    bQueued++;
    u.onstart = kickStart;
    u.onend = u.onerror = () => {
      bDone++;
      if (ended && bDone >= bQueued && !window.speechSynthesis.speaking && !window.speechSynthesis.pending) finish();
    };
    window.speechSynthesis.speak(u);
  };

  return {
    push: (raw: string) => {
      const s = stripMarkdown(raw).trim();
      if (!s || stopped) return;
      if (cloudTtsDown) pushBrowser(s);
      else pushCloud(s);
    },
    end: () => {
      ended = true;
      if (cloudTtsDown) {
        if (bDone >= bQueued) finish();
      } else {
        advance();
      }
    },
    stop: () => {
      if (stopped) return;
      stopped = true;
      acs.forEach((a) => a.abort());
      acs.clear();
      if (curAudio) {
        curAudio.pause();
        curAudio.src = "";
        curAudio = null;
      }
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    },
  };
}

/** Global stop for the browser synthesiser (streaming handles own their audio). */
export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
