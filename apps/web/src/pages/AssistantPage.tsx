import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "../api";
import {
  createRecognizer,
  createSpeech,
  isToolResultTurn,
  LANGS,
  listMics,
  speechSupported,
  stopSpeaking,
  streamChat,
  textOf,
  toolUsesOf,
  transcribeAudio,
  ttsSupported,
  type ChatMessage,
  type Lang,
  type Speech,
} from "../assistant";

const MESSAGES_KEY = "summer.assistant.messages";

function loadStoredMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // corrupt/quota-blocked storage — start fresh rather than crash the page
  }
}

const TOOL_LABEL: Record<string, string> = {
  list_projects: "Listing projects",
  get_cost_summary: "Reading cost summary",
  get_project_tree: "Reading project tree",
  search_nodes: "Searching nodes",
  search_bom_lines: "Searching BOM lines",
  get_node: "Reading node detail",
  list_materials: "Reading material catalog",
  list_suppliers: "Reading suppliers",
  get_supplier_assignments: "Checking supplier assignments",
  list_rfqs: "Listing RFQs",
  get_rfq: "Reading RFQ detail",
  create_project: "✏️ Creating project",
  update_project: "✏️ Updating project",
  delete_project: "🗑️ Deleting project",
  create_category: "✏️ Adding sub-group",
  update_category: "✏️ Updating sub-group",
  delete_category: "🗑️ Deleting sub-group",
  create_node: "✏️ Adding node",
  update_node: "✏️ Updating node",
  move_node: "✏️ Moving node",
  delete_node: "🗑️ Deleting node",
  add_bom_line: "✏️ Adding BOM line",
  update_bom_line: "✏️ Updating BOM line",
  delete_bom_line: "🗑️ Deleting BOM line",
  create_material: "✏️ Adding material",
  update_material: "✏️ Updating material",
  delete_material: "🗑️ Deleting material",
  create_supplier: "✏️ Adding supplier",
  update_supplier: "✏️ Updating supplier",
  delete_supplier: "🗑️ Deleting supplier",
  assign_supplier: "✏️ Assigning supplier",
  create_rfq: "✏️ Creating RFQ",
  add_rfq_items: "✏️ Adding RFQ items",
  update_rfq: "✏️ Updating RFQ",
  delete_rfq: "🗑️ Deleting RFQ",
  award_rfq: "✏️ Awarding RFQ",
  invite_rfq_suppliers: "✏️ Inviting suppliers",
  send_rfq_emails: "📧 Sending RFQ email",
};

const SUGGESTIONS = [
  "What does Thuniv Paradise cost, broken down by trade?",
  "Which supplier furnishes the main doors in Tower 2, and how many?",
  "List the open RFQs and who has responded.",
  "Why is Tower 2 more expensive than Tower 1?",
];

type Turn = { role: "user" | "assistant"; text: string; tools: { name: string }[] };

function turnsFrom(messages: ChatMessage[]): Turn[] {
  const out: Turn[] = [];
  for (const m of messages) {
    if (isToolResultTurn(m)) continue;
    if (m.role === "user") out.push({ role: "user", text: textOf(m.content), tools: [] });
    else out.push({ role: "assistant", text: textOf(m.content), tools: toolUsesOf(m.content).map((t) => ({ name: t.name })) });
  }
  return out.filter((t) => t.text.trim() || t.tools.length);
}

export default function AssistantPage() {
  // Persisted across page reloads and navigating away and back — a plain
  // useState here reset to [] every time this component unmounted, which read
  // as "the assistant forgets everything after a few messages" even though
  // the server-side context was always fine.
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("summer.assistant.lang") as Lang) || "en");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ text: string; tools: { name: string; done?: boolean }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakOn, setSpeakOn] = useState(() => localStorage.getItem("summer.assistant.voice") === "1");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [convMode, setConvMode] = useState(
    () => localStorage.getItem("summer.assistant.conv") === "1" && speechSupported(),
  );
  // "Allow changes" — off by default (read-only), same as the app's own design intent.
  const [operateMode, setOperateMode] = useState(() => localStorage.getItem("summer.assistant.operate") === "1");
  const operateRef = useRef(operateMode);
  const [status, setStatus] = useState<{ enabled: boolean; model: string; tts?: boolean; stt?: boolean } | null>(null);
  const sttOkRef = useRef(true); // flips false if the server says STT isn't configured

  const [mics, setMics] = useState<{ deviceId: string; label: string }[]>([]);
  const [micId, setMicId] = useState(() => localStorage.getItem("summer.assistant.mic") || "default");
  const micIdRef = useRef(micId);

  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Refs so the speech-recognition callbacks and the speak() onEnd callback
  // always see the current values (they outlive the render that created them).
  const convRef = useRef(convMode);
  const speakOnRef = useRef(speakOn);
  const speakingRef = useRef(false);
  const busyRef = useRef(false);
  const langRef = useRef(lang);
  const sendRef = useRef<(t: string) => void>(() => {});
  const listenRef = useRef<() => void>(() => {});
  const flushRef = useRef<() => void>(() => {});

  // conversation-mode listening state
  const utterBufRef = useRef(""); // finalized speech waiting for the end-of-turn pause
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpokenRef = useRef(""); // the assistant's last spoken reply, normalised — for echo rejection
  const interruptedAtRef = useRef(0); // when a spoken stop phrase last cut the assistant off
  const speechEndedAtRef = useRef(0); // ignore the mic for a beat after the assistant stops (speaker echo)
  const speechRef = useRef<Speech | null>(null); // active streaming-TTS queue
  const speechCancelledRef = useRef(false); // barge-in: stop the current reply from resuming speech

  useEffect(() => {
    fetch(`${API_BASE}/agent/status`)
      .then((r) => r.json())
      .then((s) => {
        setStatus(s);
        sttOkRef.current = s.stt !== false;
      })
      .catch(() => setStatus({ enabled: false, model: "" }));
  }, []);
  useEffect(() => {
    const load = () => listMics().then(setMics);
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", load);
  }, []);
  useEffect(() => {
    micIdRef.current = micId;
    localStorage.setItem("summer.assistant.mic", micId);
  }, [micId]);
  useEffect(() => {
    try {
      localStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    } catch {
      /* storage full/blocked — the conversation still works, it just won't survive a reload */
    }
  }, [messages]);
  useEffect(() => localStorage.setItem("summer.assistant.lang", lang), [lang]);
  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    speakOnRef.current = speakOn;
    localStorage.setItem("summer.assistant.voice", speakOn ? "1" : "0");
  }, [speakOn]);
  useEffect(() => {
    operateRef.current = operateMode;
    localStorage.setItem("summer.assistant.operate", operateMode ? "1" : "0");
  }, [operateMode]);
  useEffect(() => {
    speakingRef.current = speaking;
  }, [speaking]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, draft]);

  const turns = useMemo(() => turnsFrom(messages), [messages]);

  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

  /** Is this transcript just the mic hearing the assistant's own voice? */
  const isEcho = (t: string) => {
    const a = norm(t);
    if (a.length < 4) return false;
    const b = lastSpokenRef.current;
    if (!b) return false;
    if (b.includes(a) || a.includes(b)) return true;
    // fuzzy: most of the heard words appear in what the assistant just said
    const bw = new Set(b.split(" "));
    const aw = a.split(" ");
    const hits = aw.filter((w) => w.length > 2 && bw.has(w)).length;
    return aw.length >= 3 && hits / aw.length >= 0.6;
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  /** Short "shut up and let me talk" phrases that cut the assistant off mid-reply. */
  const STOP_PHRASES = [
    "stop", "stop it", "stop talking", "summer stop", "stop summer", "hey summer stop", "wait", "hold on", "enough",
    "be quiet", "quiet", "shut up",
  ];
  /** After the assistant stops, its voice still rings in the room/mic for a moment — ignore the mic that long. */
  const ECHO_GRACE_MS = 1800;
  /** In conversation mode the mic is deaf to everything but stop phrases while the assistant thinks, talks or has just talked. */
  const assistantActive = () =>
    speakingRef.current || busyRef.current || Date.now() - speechEndedAtRef.current < ECHO_GRACE_MS;
  /** Did the user just say a stop phrase (and not the assistant itself, via speaker echo)? */
  const isStopPhrase = (t: string) => {
    const a = norm(t);
    if (!a || a.split(" ").length > 3 || !STOP_PHRASES.includes(a)) return false;
    // the assistant just said this word itself — that's echo, not the user
    const tail = lastSpokenRef.current.slice(-60);
    return !` ${tail} `.includes(` ${a} `);
  };

  /** Barge-in by voice: cut off speech AND any answer still streaming, then the user talks. */
  const interruptNow = () => {
    if (busyRef.current) {
      abortRef.current?.abort();
      busyRef.current = false;
      setBusy(false);
    }
    stopSpeakingNow();
    utterBufRef.current = "";
    clearSilenceTimer();
    setInput("");
    interruptedAtRef.current = Date.now();
    recRef.current?.clearAudio();
  };

  const stopSpeakingNow = () => {
    speechCancelledRef.current = true; // don't let an in-flight reply resume talking
    speechRef.current?.stop();
    speechRef.current = null;
    stopSpeaking();
    if (speakingRef.current) speechEndedAtRef.current = Date.now();
    speakingRef.current = false;
    setSpeaking(false);
    lastSpokenRef.current = "";
    recRef.current?.clearAudio();
  };

  /** End-of-turn: the user paused. Re-transcribe the audio with Google (better
   *  for Tamil/Hindi and code-mixed speech), then send it. */
  const flushUtterance = async () => {
    clearSilenceTimer();
    const preview = utterBufRef.current.trim();
    utterBufRef.current = "";
    // assistant is (or just was) talking — this is speaker echo, drop it
    if (assistantActive()) {
      recRef.current?.clearAudio();
      return;
    }
    const minLen = 2;

    let text = preview;
    const rec = recRef.current;
    if (rec && sttOkRef.current) {
      const cap = await rec.takeAudio();
      if (cap && cap.blob.size > 1400) {
        setTranscribing(true);
        const better = await transcribeAudio(cap.blob, cap.mime, langRef.current);
        setTranscribing(false);
        if (better) {
          text = better;
          setInput(better);
        }
      }
    }

    if (!text || text.length < minLen || isEcho(text)) return;
    setInput("");
    sendRef.current(text); // send() handles cutting off any in-flight answer or speech
  };
  flushRef.current = flushUtterance;

  const stopListening = () => {
    clearSilenceTimer();
    utterBufRef.current = "";
    const r = recRef.current;
    recRef.current = null;
    r?.abort();
    setListening(false);
  };

  const startListening = () => {
    if (recRef.current) return;
    const rec = createRecognizer(
      LANGS.find((l) => l.code === langRef.current)!.bcp47,
      {
        onPartial: (t) => {
          // In conversation mode, don't listen while the assistant is talking (or
          // just finished) — the mic only hears the speakers, not the user.
          // Exception: a short stop phrase ("stop", "wait"…) interrupts it.
          if (convRef.current && assistantActive()) {
            if (isStopPhrase(t)) interruptNow();
            return;
          }
          if (convRef.current && isEcho(t)) return;
          setInput(utterBufRef.current ? `${utterBufRef.current} ${t}` : t);
        },
        onFinal: (t) => {
          if (!convRef.current) {
            setInput(t);
            return;
          }
          if (assistantActive() && isStopPhrase(t)) {
            interruptNow();
            return;
          }
          // the final transcript of the stop phrase itself arrives just after the interrupt — swallow it
          if (Date.now() - interruptedAtRef.current < 1500 && STOP_PHRASES.includes(norm(t))) return;
          if (assistantActive()) return; // assistant's own voice, or noise while it works
          if (isEcho(t)) return;
          utterBufRef.current = `${utterBufRef.current} ${t}`.trim();
          setInput(utterBufRef.current);
          clearSilenceTimer();
          // wait out a short pause; if they keep talking this resets
          silenceTimerRef.current = setTimeout(() => flushRef.current(), 900);
        },
        onEnd: () => {
          const rec = recRef.current;
          recRef.current = null;
          setListening(false);
          if (convRef.current) {
            // Chrome ends the session after ~60s or on a network blip — keep it alive
            setTimeout(() => {
              if (convRef.current && !recRef.current) listenRef.current();
            }, 250);
          } else if (rec && sttOkRef.current) {
            // one-shot mic: replace the rough preview with an accurate transcript
            rec.takeAudio().then((cap) => {
              if (!cap || cap.blob.size < 1400) return;
              setTranscribing(true);
              transcribeAudio(cap.blob, cap.mime, langRef.current)
                .then((t) => t && setInput(t))
                .finally(() => setTranscribing(false));
            });
          }
        },
        onError: (e) => {
          if (e === "not-allowed" || e === "service-not-allowed") {
            setError("Microphone access is blocked — allow it in the browser, then turn Conversation on again.");
            convRef.current = false;
            setConvMode(false);
            setListening(false);
          }
          // "no-speech" / "aborted" / "network" are transient; onEnd handles the restart
        },
      },
      { continuous: convRef.current, captureAudio: sttOkRef.current, micId: micIdRef.current },
    );
    if (!rec) {
      setError("Speech input isn't supported in this browser.");
      return;
    }
    recRef.current = rec;
    setListening(true);
    listMics().then(setMics); // labels resolve once permission is granted
    try {
      rec.start();
    } catch {
      /* already started — ignore */
    }
  };
  listenRef.current = startListening;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q) return;
    // barge-in: a new message supersedes any answer still streaming
    if (busyRef.current) {
      abortRef.current?.abort();
      busyRef.current = false;
      setBusy(false);
    }
    stopSpeakingNow();
    setError(null);
    setInput("");
    utterBufRef.current = "";
    const next: ChatMessage[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setBusy(true);
    busyRef.current = true;
    setDraft({ text: "", tools: [] });

    const ac = new AbortController();
    abortRef.current = ac;
    let finalText = "";

    // ---- streaming TTS: speak each sentence the moment it's finished ----
    let ttsBuf = "";
    let spokenNorm = "";
    const voiceOn = speakOnRef.current;
    speechCancelledRef.current = false;
    const ensureSpeech = () => {
      if (speechRef.current || !voiceOn || speechCancelledRef.current) return;
      speechRef.current = createSpeech(langRef.current, {
        onStart: () => {
          speakingRef.current = true;
          setSpeaking(true);
          clearSilenceTimer();
          utterBufRef.current = "";
          recRef.current?.clearAudio();
        },
        onEnd: () => {
          speakingRef.current = false;
          setSpeaking(false);
          speechEndedAtRef.current = Date.now();
          speechRef.current = null;
          recRef.current?.clearAudio(); // drop any echo the mic recorded while it spoke
        },
      });
    };
    const pushSentence = (s: string) => {
      const t = s.trim();
      if (t.length < 2) return;
      ensureSpeech();
      speechRef.current?.push(t);
      spokenNorm = norm(`${spokenNorm} ${t}`);
      lastSpokenRef.current = spokenNorm;
    };
    const feedTts = (flush: boolean) => {
      if (!voiceOn) return;
      // a sentence = up to a . ! ? । ॥ or newline that is followed by whitespace
      // ("[\\s\\S]+?" so internal dots like "5.2M" don't split the sentence)
      const re = flush ? /[\s\S]+?(?:[.!?।॥\n]+(?=\s|$)|$)/g : /[\s\S]+?[.!?।॥\n]+(?=\s)/g;
      let consumed = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(ttsBuf)) && m[0].length) {
        pushSentence(m[0]);
        consumed = re.lastIndex;
      }
      ttsBuf = ttsBuf.slice(consumed);
      // don't let an unpunctuated run grow without bound
      if (!flush && ttsBuf.length > 400) {
        const cut = ttsBuf.lastIndexOf(" ", 400);
        if (cut > 120) {
          pushSentence(ttsBuf.slice(0, cut));
          ttsBuf = ttsBuf.slice(cut + 1);
        }
      }
      if (flush) {
        if (ttsBuf.trim()) pushSentence(ttsBuf);
        ttsBuf = "";
        speechRef.current?.end();
      }
    };

    try {
      await streamChat({ language: langRef.current, messages: next, operate: operateRef.current }, (e) => {
        if (e.type === "text") {
          finalText += e.delta;
          ttsBuf += e.delta;
          feedTts(false);
          setDraft((d) => (d ? { ...d, text: d.text + e.delta } : d));
        } else if (e.type === "tool_start") {
          setDraft((d) => (d ? { ...d, tools: [...d.tools, { name: e.name }] } : d));
        } else if (e.type === "tool_end") {
          setDraft((d) =>
            d ? { ...d, tools: d.tools.map((t, i) => (i === d.tools.length - 1 && t.name === e.name ? { ...t, done: true } : t)) } : d,
          );
        } else if (e.type === "done") {
          setMessages([...next, ...(e.appended as ChatMessage[])]);
          setDraft(null);
        } else if (e.type === "error") {
          setError(e.message);
          setDraft(null);
        }
      }, ac.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
      setDraft(null);
    }

    // A newer send (barge-in) has taken over — don't touch shared state or speak.
    if (abortRef.current !== ac) return;

    setBusy(false);
    busyRef.current = false;
    abortRef.current = null;

    if (finalText.trim()) feedTts(true);
    else speechRef.current?.stop();
  };
  sendRef.current = send;

  const toggleMic = () => {
    if (convMode) {
      toggleConv(); // in conversation mode the mic button just turns it off
    } else if (listening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const toggleConv = () => {
    const on = !convMode;
    setConvMode(on);
    convRef.current = on;
    localStorage.setItem("summer.assistant.conv", on ? "1" : "0");
    if (on) {
      if (!speakOn) setSpeakOn(true);
      speakOnRef.current = true;
      startListening(); // mic stays open for the whole conversation
    } else {
      stopListening();
      stopSpeakingNow();
    }
  };

  const reset = () => {
    stopSpeakingNow();
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setMessages([]);
    setDraft(null);
    setError(null);
    utterBufRef.current = "";
    clearSilenceTimer();
  };

  useEffect(() => {
    // tidy up on unmount
    return () => {
      convRef.current = false;
      recRef.current?.abort();
      clearSilenceTimer();
      stopSpeaking();
    };
  }, []);

  return (
    <div className="page assistant-page">
      <div className="page-head">
        <div>
          <h1>Summer</h1>
          <p className="muted small">
            Read-only · asks the app for real numbers · {status?.model || "…"}
            {status?.tts === false && " · basic voice"}
            {status?.stt === false && " · basic mic"}
          </p>
        </div>
        <div className="assistant-controls">
          <div className="seg">
            {LANGS.map((l) => (
              <button key={l.code} className={lang === l.code ? "on" : ""} onClick={() => setLang(l.code)}>
                {l.label}
              </button>
            ))}
          </div>
          {speechSupported() && mics.length > 1 && (
            <select
              className="mic-select"
              value={micId}
              title="Microphone"
              onChange={(e) => {
                const id = e.target.value;
                setMicId(id);
                micIdRef.current = id;
                if (recRef.current) {
                  stopListening();
                  setTimeout(startListening, 120);
                }
              }}
            >
              <option value="default">🎙 Default mic</option>
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  🎙 {m.label}
                </option>
              ))}
            </select>
          )}
          {speechSupported() && (
            <button
              className={`btn sm ${convMode ? "primary" : ""}`}
              title="Hands-free: it listens, answers aloud, then listens again — no need to press send"
              onClick={toggleConv}
            >
              {convMode ? "💬 Conversation on" : "💬 Conversation"}
            </button>
          )}
          {ttsSupported() && (
            <button
              className={`btn sm ${speakOn ? "primary" : ""}`}
              title="Speak replies aloud"
              onClick={() => {
                stopSpeakingNow();
                setSpeakOn((s) => !s);
              }}
            >
              {speakOn ? "🔊 Voice on" : "🔇 Voice off"}
            </button>
          )}
          <button
            className={`btn sm ${operateMode ? "danger" : ""}`}
            title="Let the assistant create, edit and delete data. It always previews an action and waits for you to say yes before doing it — deletes are permanent."
            onClick={() => setOperateMode((o) => !o)}
          >
            {operateMode ? "✏️ Changes allowed" : "🔒 Read-only"}
          </button>
          <button className="btn sm" onClick={reset} disabled={messages.length === 0 && !busy}>
            New chat
          </button>
        </div>
      </div>

      {status && !status.enabled && (
        <div className="card banner-warn">
          The assistant needs an Anthropic API key. Set <code>ANTHROPIC_API_KEY</code> in <code>apps/api/.env</code> and restart the API.
        </div>
      )}

      {operateMode && (
        <div className="card banner-operate">
          ✏️ <strong>Changes allowed.</strong> The assistant can create, edit and delete data. It will always describe an
          action and wait for you to say yes before doing it — but deletes are permanent, there's no undo. Turn this off
          (🔒 Read-only) when you're just asking questions.
        </div>
      )}

      <div className="chat card" ref={scrollRef}>
        {turns.length === 0 && !draft && (
          <div className="chat-empty">
            <p className="muted">Ask about your projects, costs, suppliers or RFQs.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn ghost sm" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => (
          <Bubble key={i} role={t.role} text={t.text} tools={t.tools} />
        ))}

        {draft && (
          <Bubble
            role="assistant"
            text={draft.text}
            tools={draft.tools}
            live={!draft.text && draft.tools.length === 0}
          />
        )}

        {error && <div className="chat-error">{error}</div>}
      </div>

      {convMode && (
        <div className="conv-strip">
          <span
            className={`conv-dot ${
              transcribing ? "think" : speaking ? "speak" : busy ? "think" : listening ? "listen" : ""
            }`}
          />
          {transcribing
            ? "Got it…"
            : speaking
              ? "Speaking… (mic pauses)"
              : busy
                ? "Thinking…"
                : listening
                  ? "Listening — go ahead"
                  : "Mic off — tap 🎤 to resume"}
        </div>
      )}

      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        {speechSupported() && (
          <button
            type="button"
            className={`btn mic ${listening ? "listening" : ""}`}
            onClick={toggleMic}
            title={convMode ? "Turn conversation mode off" : "Speak"}
          >
            {convMode ? "💬 on" : listening ? "● listening" : "🎤"}
          </button>
        )}
        <input
          placeholder={
            transcribing
              ? "Transcribing…"
              : convMode
                ? "…or type instead"
                : listening
                  ? "Listening…"
                  : "Ask about a project, cost, supplier, RFQ…"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy && !convMode}
        />
        {busy || speaking ? (
          <button type="button" className="btn danger" onClick={interruptNow}>
            Stop
          </button>
        ) : (
          <button className="btn primary" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

function Bubble({
  role,
  text,
  tools,
  live,
}: {
  role: "user" | "assistant";
  text: string;
  tools: { name: string; done?: boolean }[];
  live?: boolean;
}) {
  return (
    <div className={`bubble ${role}`}>
      {tools.length > 0 && (
        <div className="tool-chips">
          {tools.map((t, i) => (
            <span key={i} className={`tool-chip ${t.done === false ? "running" : ""}`}>
              {TOOL_LABEL[t.name] ?? t.name}
            </span>
          ))}
        </div>
      )}
      {text ? <Markdown text={text} /> : live ? <span className="typing">•••</span> : null}
    </div>
  );
}

/** minimal markdown: paragraphs, `- ` bullets, **bold**, `code`, | tables kept as text */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: JSX.Element[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      blocks.push(
        <ul key={blocks.length}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^[-*]\s+/.test(l)) list.push(l.replace(/^[-*]\s+/, ""));
    else {
      flush();
      if (l.trim()) blocks.push(<p key={blocks.length}>{inline(l)}</p>);
    }
  }
  flush();
  return <div className="md">{blocks}</div>;
}

function inline(s: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    if (m[1]) parts.push(<strong key={k++}>{m[1]}</strong>);
    else if (m[2]) parts.push(<code key={k++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push(s.slice(last));
  return parts;
}
