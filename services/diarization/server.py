"""Speaker diarization sidecar using pyannote.audio 3.1."""

from __future__ import annotations

import os
import tempfile
from typing import List

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

app = FastAPI(title="Speaker Diarization Service")

pipeline = None


class DiarizationSegment(BaseModel):
    speaker: int
    start: float
    end: float


class DiarizationResponse(BaseModel):
    segments: List[DiarizationSegment]
    num_speakers: int


@app.on_event("startup")
async def load_model() -> None:
    global pipeline
    from pyannote.audio import Pipeline

    hf_token = os.environ.get("HF_TOKEN", "")
    if not hf_token:
        print("WARNING: HF_TOKEN not set")
        return

    try:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=hf_token,
        )
    except Exception as e:
        print(f"Failed to load pipeline: {e}")
        return

    # CPU is safest — MPS has issues with pyannote
    device = "cuda" if torch.cuda.is_available() else "cpu"
    pipeline.to(torch.device(device))
    print(f"Pyannote 3.1 loaded on {device}")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "model_loaded": pipeline is not None}


@app.post("/diarize", response_model=DiarizationResponse)
async def diarize(file: UploadFile = File(...)) -> DiarizationResponse:
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    suffix = ".wav"
    if file.filename:
        ext = file.filename.rsplit(".", 1)[-1].lower()
        if ext in ("mp3", "flac", "ogg", "m4a", "webm", "mp4"):
            suffix = f".{ext}"

    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(audio_bytes)
    tmp.close()

    try:
        # Convert to 16kHz mono WAV for pyannote compatibility
        import subprocess
        wav_path = tmp.name + ".converted.wav"
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", tmp.name, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav_path],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            # Fallback: try loading original file directly
            wav_path = tmp.name

        result = pipeline(wav_path)

        # Cleanup converted file
        if wav_path != tmp.name:
            try:
                os.unlink(wav_path)
            except OSError:
                pass

        # pyannote 4.0: result is DiarizeOutput, use .speaker_diarization
        diarization = getattr(result, "speaker_diarization", result)

        speaker_map: dict[str, int] = {}
        speaker_counter = 0
        segments: list[DiarizationSegment] = []

        for turn, _, speaker in diarization.itertracks(yield_label=True):
            if speaker not in speaker_map:
                speaker_map[speaker] = speaker_counter
                speaker_counter += 1

            segments.append(DiarizationSegment(
                speaker=speaker_map[speaker],
                start=round(turn.start, 3),
                end=round(turn.end, 3),
            ))

        return DiarizationResponse(
            segments=segments,
            num_speakers=len(speaker_map),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Diarization failed: {e}")
    finally:
        os.unlink(tmp.name)
