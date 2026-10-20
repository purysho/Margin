import { useEffect, useRef, useState } from "react";

export interface Recording {
  blob: Blob;
  durationMs: number;
  url: string;
}

const MAX_BYTES = 1_500_000;
const PREFERRED_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", "audio/webm"];

function pickType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Records from the microphone (or takes an uploaded file) and hands back one recording. */
export function Recorder({ maxSeconds, onChange }: { maxSeconds: number; onChange: (r: Recording | null) => void }) {
  const [state, setState] = useState<"idle" | "asking" | "recording" | "done">("idle");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rec, setRec] = useState<Recording | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const started = useRef(0);
  const timer = useRef<number | null>(null);
  const canRecord = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

  useEffect(
    () => () => {
      if (timer.current) window.clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  const accept = (r: Recording | null) => {
    if (rec) URL.revokeObjectURL(rec.url);
    setRec(r);
    onChange(r);
  };

  const start = async () => {
    setError(null);
    setState("asking");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setState("idle");
      setError("Margin couldn't use your microphone. Allow microphone access for this site, or upload a recording instead.");
      return;
    }
    const type = pickType();
    const mr = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (timer.current) window.clearInterval(timer.current);
      const durationMs = Date.now() - started.current;
      const blob = new Blob(chunks, { type: mr.mimeType || type || "audio/webm" });
      if (blob.size > MAX_BYTES) {
        setError("That recording is too large. Please record a shorter answer.");
        setState("idle");
        return;
      }
      accept({ blob, durationMs, url: URL.createObjectURL(blob) });
      setState("done");
    };
    media.current = mr;
    started.current = Date.now();
    setElapsed(0);
    mr.start(1000);
    setState("recording");
    timer.current = window.setInterval(() => {
      const ms = Date.now() - started.current;
      setElapsed(ms);
      if (ms >= maxSeconds * 1000) mr.state === "recording" && mr.stop();
    }, 250);
  };

  const stop = () => media.current?.state === "recording" && media.current.stop();

  const upload = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!/^(audio|video)\//.test(file.type)) return setError("Please choose an audio file.");
    if (file.size > MAX_BYTES) return setError("That file is too large (max 1.5 MB, about 3 minutes).");
    const url = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    probe.onloadedmetadata = () => {
      const seconds = Number.isFinite(probe.duration) ? probe.duration : 0;
      if (seconds > maxSeconds + 5) {
        URL.revokeObjectURL(url);
        setError(`That recording is longer than ${Math.round(maxSeconds / 60)} minutes.`);
        return;
      }
      accept({ blob: file, durationMs: Math.round(seconds * 1000), url });
      setState("done");
    };
    probe.onerror = () => {
      accept({ blob: file, durationMs: 0, url });
      setState("done");
    };
    probe.src = url;
  };

  return (
    <div className="recorder card">
      {state === "recording" ? (
        <div className="rec-live" role="status">
          <span className="rec-dot" aria-hidden="true" />
          <strong>Recording</strong>
          <span className="rec-clock">
            {clock(elapsed)} / {clock(maxSeconds * 1000)}
          </span>
          <button type="button" className="primary" onClick={stop}>
            Stop
          </button>
        </div>
      ) : rec ? (
        <div className="stack">
          <p>
            <strong>Your recording</strong> <span className="muted">({clock(rec.durationMs)})</span>. Listen to check it, then hand it in.
          </p>
          <audio controls src={rec.url} className="rec-audio" />
          {canRecord && (
            <div>
              <button
                type="button"
                onClick={() => {
                  accept(null);
                  void start();
                }}
              >
                Record again
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          {canRecord ? (
            <>
              <p className="muted small">
                Find a quiet place. Press record, speak your answer, then press stop. You can listen and record again before handing in. Up to{" "}
                {Math.round(maxSeconds / 60)} minutes.
              </p>
              <div>
                <button type="button" className="primary rec-button" onClick={start} disabled={state === "asking"}>
                  <span className="rec-dot" aria-hidden="true" /> {state === "asking" ? "Allow the microphone…" : "Start recording"}
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">This browser can't record here. Record your answer with your phone's voice recorder, then upload it below.</p>
          )}
        </div>
      )}
      {state !== "recording" && (
        <label className="rec-upload small">
          {rec ? "Or replace it with a file" : "Or upload a recording"}
          <input type="file" accept="audio/*" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
