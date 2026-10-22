import React, { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Mic } from "lucide-react";

type RecognitionResult = {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};
type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((event: RecognitionResult) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
const messageLimit = 4000;

// No fabricated transcription: use the browser capability only after explicit user activation.
export function Composer({
  draft,
  setDraft,
  send,
  busy,
}: {
  draft: string;
  setDraft: (s: string) => void;
  send: (s?: string, voice?: boolean) => void;
  busy: boolean;
}) {
  const [listening, setListening] = useState(false),
    [voiceError, setVoiceError] = useState(""),
    [spoken, setSpoken] = useState(false);
  const recognition = useRef<Recognition | null>(null);
  const release = (r: Recognition) => {
    r.onresult = null;
    r.onerror = null;
    r.onend = null;
    if (recognition.current === r) recognition.current = null;
  };
  const cancel = () => {
    const r = recognition.current;
    if (!r) return;
    // Detach first: abort can itself enqueue another result or end event.
    release(r);
    try {
      r.abort();
    } catch {
      // A stopped browser recognizer has no further work to cancel.
    }
  };
  useEffect(() => cancel, []);
  useEffect(() => {
    if (busy) {
      cancel();
      setListening(false);
    }
  }, [busy]);
  function mic() {
    if (listening) {
      try {
        recognition.current?.stop();
      } catch {
        cancel();
      }
      setListening(false);
      return;
    }
    const speech = window as SpeechWindow;
    const C = speech.SpeechRecognition ?? speech.webkitSpeechRecognition;
    if (!C) {
      setVoiceError(
        "La dictée n’est pas disponible dans ce navigateur. Vous pouvez saisir votre question.",
      );
      return;
    }
    cancel();
    let r: Recognition;
    try {
      r = new C();
    } catch {
      setVoiceError("Impossible de démarrer la dictée.");
      return;
    }
    const prefix = draft.trimEnd();
    r.lang = "fr-FR";
    r.interimResults = true;
    r.onresult = (e) => {
      if (recognition.current !== r) return;
      const transcript = Array.from(e.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ");
      const next = [prefix, transcript].filter(Boolean).join(" ");
      setDraft(next.slice(0, messageLimit));
      setSpoken(true);
      if (next.length > messageLimit) {
        cancel();
        setListening(false);
        setVoiceError(
          "Limite de 4 000 caractères atteinte. Relisez votre message avant de l’envoyer.",
        );
      }
    };
    r.onerror = () => {
      if (recognition.current !== r) return;
      cancel();
      setVoiceError("Microphone indisponible ou autorisation refusée.");
      setListening(false);
    };
    r.onend = () => {
      if (recognition.current !== r) return;
      release(r);
      setListening(false);
    };
    recognition.current = r;
    setVoiceError("");
    setListening(true);
    try {
      r.start();
    } catch {
      cancel();
      setListening(false);
      setVoiceError("Impossible de démarrer la dictée.");
    }
  }
  return (
    <>
      <form
        className={"composer " + (listening ? "listening" : "")}
        onSubmit={(e) => {
          e.preventDefault();
          cancel();
          setListening(false);
          send(draft, spoken);
          setSpoken(false);
        }}
      >
        <input
          aria-label="Votre message"
          placeholder={
            listening
              ? "Je vous écoute…"
              : "Posez une question ou demandez une action"
          }
          value={draft}
          onChange={(e) => {
            cancel();
            setListening(false);
            setDraft(e.target.value);
          }}
          maxLength={messageLimit}
        />
        <button
          type="button"
          className="icon-button"
          disabled={busy}
          aria-label={listening ? "Arrêter la dictée" : "Parler"}
          onClick={mic}
        >
          {listening ? (
            <span className="wave">
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ animationDelay: i * 0.08 + "s" }} />
              ))}
            </span>
          ) : (
            <Mic size={17} />
          )}
        </button>
        <button
          className="send"
          disabled={busy || !draft.trim()}
          aria-label="Envoyer"
        >
          {busy ? (
            <Loader2 className="spin" size={17} />
          ) : (
            <ArrowUp size={18} />
          )}
        </button>
      </form>
      {voiceError && (
        <small role="status" className="voice-error">
          {voiceError}
        </small>
      )}
      {listening && (
        <small className="voice-error">
          Dictée du navigateur active · son traitement dépend de votre
          navigateur.
        </small>
      )}
    </>
  );
}
