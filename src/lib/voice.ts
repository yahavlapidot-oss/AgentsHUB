/**
 * Speech to text for voice input (the microphone in chats, voice messages on
 * Telegram), through OpenAI's transcription API: about $0.003 a minute with
 * the default model. Needs OPENAI_API_KEY; VOICE_MODEL picks another model.
 */
import OpenAI, { toFile } from "openai";

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export function voiceAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function transcribe(audio: Buffer, filename: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) throw new Error("Voice input needs OPENAI_API_KEY on the server");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("The recording is too long");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const res = await client.audio.transcriptions.create({
    file: await toFile(audio, filename),
    model: process.env.VOICE_MODEL || "gpt-4o-mini-transcribe",
  });
  return res.text.trim();
}

export async function transcribeTelegramVoice(fileId: string): Promise<string> {
  const { telegramCall } = await import("./telegram");
  const file = await telegramCall<{ file_path?: string; file_size?: number }>("getFile", { file_id: fileId });
  if (!file.file_path) throw new Error("Telegram didn't return the file");
  if ((file.file_size ?? 0) > MAX_AUDIO_BYTES) throw new Error("The recording is too long");
  const res = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return transcribe(Buffer.from(await res.arrayBuffer()), "voice.ogg");
}
