import { env } from "@my-better-t-app/env/server";

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface GroqWord {
  word: string;
  start: number;
  end: number;
}

export interface GroqSegment {
  start: number;
  end: number;
  text: string;
}

export interface GroqTranscriptionResult {
  text: string;
  segments: GroqSegment[];
  words: GroqWord[];
}

export interface DiarizationSegment {
  speaker: number;
  start: number;
  end: number;
}

export interface DiarizationResult {
  segments: DiarizationSegment[];
}

export interface TranscriptSegment {
  speakerId: number;
  startTime: number;
  endTime: number;
  content: string;
  confidence: number | null;
}

// --------------------------------------------------------------------------
// Groq Whisper transcription
// --------------------------------------------------------------------------

export async function transcribeWithGroq(
  audioBuffer: Buffer,
  fileName: string
): Promise<GroqTranscriptionResult> {
  const groqApiKey = env.GROQ_API_KEY;

  const formData = new FormData();
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "wav";
  const mimeTypes: Record<string, string> = {
    wav: "audio/wav", mp3: "audio/mpeg", flac: "audio/flac",
    ogg: "audio/ogg", m4a: "audio/mp4", webm: "audio/webm",
    mp4: "audio/mp4", mpeg: "audio/mpeg", mpga: "audio/mpeg",
  };
  const mimeType = mimeTypes[ext] ?? "audio/wav";
  const audioBlob = new Blob([audioBuffer], { type: mimeType });
  formData.append("file", audioBlob, fileName);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities[]", "word");
  formData.append("timestamp_granularities[]", "segment");
  formData.append("temperature", "0");

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Groq transcription failed (${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as {
    text?: string;
    segments?: GroqSegment[];
    words?: GroqWord[];
  };

  return {
    text: data.text ?? "",
    segments: data.segments ?? [],
    words: data.words ?? [],
  };
}

// --------------------------------------------------------------------------
// Pyannote diarization sidecar
// --------------------------------------------------------------------------

export async function diarizeAudio(
  audioBuffer: Buffer
): Promise<DiarizationResult> {
  const sidecarUrl = env.DIARIZATION_SIDECAR_URL;
  if (!sidecarUrl) {
    // No sidecar configured — return a single speaker covering all time
    return { segments: [] };
  }

  const formData = new FormData();
  const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
  formData.append("file", audioBlob, "audio.wav");

  let response: Response;
  try {
    response = await fetch(`${sidecarUrl}/diarize`, {
      method: "POST",
      body: formData,
    });
  } catch {
    // Sidecar unreachable — fall back to single speaker
    return { segments: [] };
  }

  if (!response.ok) {
    // Sidecar error — fall back to single speaker rather than failing
    return { segments: [] };
  }

  const data = (await response.json()) as { segments?: DiarizationSegment[] };
  return {
    segments: data.segments ?? [],
  };
}

// --------------------------------------------------------------------------
// Alignment: match Groq words → diarization speaker segments
// --------------------------------------------------------------------------

function findSpeakerForWord(
  wordMidpoint: number,
  diarizationSegments: DiarizationSegment[]
): number {
  for (const segment of diarizationSegments) {
    if (wordMidpoint >= segment.start && wordMidpoint <= segment.end) {
      return segment.speaker;
    }
  }
  // Default to speaker 0 if no segment covers this word
  return 0;
}

export function alignTranscriptionWithSpeakers(
  transcription: GroqTranscriptionResult,
  diarization: DiarizationResult
): TranscriptSegment[] {
  const { words } = transcription;
  const { segments: diarizationSegments } = diarization;

  if (words.length === 0) {
    return [];
  }

  const result: TranscriptSegment[] = [];
  let currentSegment: TranscriptSegment | null = null;

  for (const word of words) {
    const midpoint = (word.start + word.end) / 2;
    const speakerId = findSpeakerForWord(midpoint, diarizationSegments);

    if (currentSegment === null || currentSegment.speakerId !== speakerId) {
      // Push the completed segment before starting a new one
      if (currentSegment !== null) {
        result.push(currentSegment);
      }
      currentSegment = {
        speakerId,
        startTime: word.start,
        endTime: word.end,
        content: word.word.trimStart(),
        confidence: null,
      };
    } else {
      // Extend the current segment with this word (immutable update)
      const prev = currentSegment as TranscriptSegment;
      currentSegment = {
        speakerId: prev.speakerId,
        startTime: prev.startTime,
        endTime: word.end,
        content: `${prev.content} ${word.word.trim()}`,
        confidence: prev.confidence,
      };
    }
  }

  if (currentSegment !== null) {
    result.push(currentSegment);
  }

  return result;
}
