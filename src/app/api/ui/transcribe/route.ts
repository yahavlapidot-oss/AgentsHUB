import { NextResponse } from "next/server";
import { MAX_AUDIO_BYTES, transcribe, voiceAvailable } from "@/lib/voice";

export const dynamic = "force-dynamic";

/** Voice input from the chats: audio in, text out. Protected by the dashboard password in middleware. */
export async function POST(req: Request) {
  if (!voiceAvailable()) return NextResponse.json({ error: "Voice input needs OPENAI_API_KEY on the server" }, { status: 503 });
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || !audio.size) return NextResponse.json({ error: "No recording" }, { status: 400 });
  if (audio.size > MAX_AUDIO_BYTES) return NextResponse.json({ error: "The recording is too long" }, { status: 413 });
  const name = (audio as File).name || "voice.webm";
  try {
    const text = await transcribe(Buffer.from(await audio.arrayBuffer()), /^[\w.-]+$/.test(name) ? name : "voice.webm");
    return NextResponse.json({ text });
  } catch (e) {
    console.error("[voice] transcription failed", e);
    return NextResponse.json({ error: "Couldn't transcribe the recording" }, { status: 502 });
  }
}
