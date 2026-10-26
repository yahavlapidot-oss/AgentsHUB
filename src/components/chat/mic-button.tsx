"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "../toast";

const MAX_SECONDS = 120;

/** Hold a conversation by voice: records, sends the audio to be transcribed (Hebrew or English), and hands back the text to edit before sending. */
export function MicButton({ onText, disabled }: { onText: (text: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [seconds, setSeconds] = useState(0);
  const [supported, setSupported] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setSupported(typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)), []);
  useEffect(() => () => stopTracks(), []);

  function stopTracks() {
    if (timer.current) clearInterval(timer.current);
    rec.current?.stream.getTracks().forEach((t) => t.stop());
  }

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast("Allow the microphone to talk to your agents", "error");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    r.onstop = async () => {
      stopTracks();
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      if (blob.size < 1_000) {
        setState("idle");
        return;
      }
      setState("working");
      const ext = blob.type.includes("mp4") ? "mp4" : blob.type.includes("ogg") ? "ogg" : "webm";
      const form = new FormData();
      form.append("audio", blob, `voice.${ext}`);
      try {
        const res = await fetch("/api/ui/transcribe", { method: "POST", body: form });
        const body = (await res.json()) as { text?: string; error?: string };
        if (!res.ok || !body.text) toast(body.error ?? "Couldn't hear anything", "error");
        else onText(body.text);
      } catch {
        toast("Couldn't send the recording", "error");
      }
      setState("idle");
    };
    rec.current = r;
    r.start();
    setSeconds(0);
    setState("recording");
    timer.current = setInterval(() => {
      setSeconds((s) => {
        if (s + 1 >= MAX_SECONDS) r.state === "recording" && r.stop();
        return s + 1;
      });
    }, 1000);
  }

  if (!supported) return null;
  return (
    <button
      type="button"
      className={`btn-ghost shrink-0 border border-line px-3 ${state === "recording" ? "border-[#d83a52] text-[#d83a52]" : ""}`}
      disabled={disabled || state === "working"}
      aria-label={state === "recording" ? "Stop recording" : "Speak"}
      title={state === "recording" ? "Stop and transcribe" : "Speak (Hebrew or English)"}
      onClick={() => (state === "recording" ? rec.current?.stop() : void start())}
    >
      {state === "recording" ? `■ ${seconds}s` : state === "working" ? "…" : "🎤"}
    </button>
  );
}
