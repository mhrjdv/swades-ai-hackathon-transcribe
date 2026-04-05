"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, FileText, Mic, Pause, Play, Square } from "lucide-react"

import { Button } from "@my-better-t-app/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card"
import { LiveWaveform } from "@/components/ui/live-waveform"
import { ChunkStatusList } from "@/components/chunk-status-list"
import { useRecorder, type WavChunk } from "@/hooks/use-recorder"
import { useOPFS } from "@/hooks/use-opfs"
import { useChunkUploader } from "@/hooks/use-chunk-uploader"
import { trpc } from "@/lib/trpc"

const SERVER_URL = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000"

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 10)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${ms}`
}

function formatDuration(seconds: number) {
  return `${seconds.toFixed(1)}s`
}

function ChunkRow({ chunk, index }: { chunk: WavChunk; index: number }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); el.currentTime = 0; setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  const download = () => {
    const a = document.createElement("a")
    a.href = chunk.url
    a.download = `chunk-${index + 1}.wav`
    a.click()
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 bg-muted/30 px-3 py-2">
      <audio ref={audioRef} src={chunk.url} onEnded={() => setPlaying(false)} preload="none" />
      <span className="text-xs font-medium text-muted-foreground tabular-nums">#{index + 1}</span>
      <span className="text-xs tabular-nums">{formatDuration(chunk.duration)}</span>
      <span className="text-[10px] text-muted-foreground">16kHz PCM</span>
      <div className="ml-auto flex gap-1">
        <Button variant="ghost" size="icon-xs" onClick={toggle}>
          {playing ? <Square className="size-3" /> : <Play className="size-3" />}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={download}>
          <Download className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export default function RecorderPage() {
  const router = useRouter()
  const [deviceId] = useState<string | undefined>()

  const { status, start, stop, pause, resume, chunks, elapsed, stream } =
    useRecorder({ chunkDuration: 5, deviceId })

  const { writeChunk, markChunkAcked } = useOPFS()
  const { uploadChunk, statuses: uploadStatuses } = useChunkUploader(SERVER_URL)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [stopped, setStopped] = useState(false)
  const processedChunkIds = useRef<Set<string>>(new Set())

  const updateSessionStatus = trpc.session.updateStatus.useMutation()

  const createSession = trpc.session.create.useMutation({
    onSuccess: (data) => {
      setSessionId(data.id)
      updateSessionStatus.mutate({ sessionId: data.id, status: "recording" })
    },
  })

  const triggerTranscript = trpc.transcript.trigger.useMutation({
    onSuccess: () => {
      if (sessionId) router.push(`/sessions/${sessionId}`)
    },
  })

  const isRecording = status === "recording"
  const isPaused = status === "paused"
  const isActive = isRecording || isPaused
  const isStopped = stopped && !isActive && chunks.length > 0

  const handleStart = useCallback(() => {
    setStopped(false)
    createSession.mutate({ sourceType: "mic" }, { onSuccess: () => start() })
  }, [createSession, start])

  const handleStop = useCallback(() => {
    stop()
    setStopped(true)
    if (sessionId) {
      updateSessionStatus.mutate({ sessionId, status: "uploading", totalChunks: chunks.length })
    }
  }, [stop, sessionId, updateSessionStatus, chunks.length])

  const handlePrimary = useCallback(() => {
    if (isActive) handleStop()
    else handleStart()
  }, [isActive, handleStop, handleStart])

  const handleTranscribe = useCallback(() => {
    if (sessionId) triggerTranscript.mutate({ sessionId })
  }, [sessionId, triggerTranscript])

  const [uploadedCount, setUploadedCount] = useState(0)
  const [autoTranscribeTriggered, setAutoTranscribeTriggered] = useState(false)

  // Chunk pipeline: write to OPFS → upload → ack on success
  useEffect(() => {
    if (!sessionId || chunks.length === 0) return

    const newChunks = chunks.filter((c) => !processedChunkIds.current.has(c.id))
    if (newChunks.length === 0) return

    for (const chunk of newChunks) {
      processedChunkIds.current.add(chunk.id)
      const chunkIndex = chunks.indexOf(chunk)

      void (async () => {
        try {
          const buffer = await chunk.blob.arrayBuffer()
          const hashBytes = await crypto.subtle.digest("SHA-256", buffer)
          const checksum = Array.from(new Uint8Array(hashBytes))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
          await writeChunk(sessionId, chunkIndex, chunk.blob, checksum)
        } catch {
          // OPFS write failure is non-fatal
        }

        const result = await uploadChunk(sessionId, chunkIndex, chunk.blob)

        if (result.success) {
          setUploadedCount((prev) => prev + 1)
          try {
            await markChunkAcked(sessionId, chunkIndex)
          } catch {
            // Ack failure is non-fatal
          }
        }
      })()
    }
  }, [chunks, sessionId, writeChunk, uploadChunk, markChunkAcked])

  // Auto-transcribe: trigger once recording stopped and all chunks uploaded
  useEffect(() => {
    if (
      stopped &&
      !isActive &&
      sessionId &&
      chunks.length > 0 &&
      uploadedCount >= chunks.length &&
      !autoTranscribeTriggered &&
      !triggerTranscript.isPending
    ) {
      setAutoTranscribeTriggered(true)
      triggerTranscript.mutate({ sessionId })
    }
  }, [stopped, isActive, sessionId, chunks.length, uploadedCount, autoTranscribeTriggered, triggerTranscript])

  return (
    <div className="container mx-auto flex max-w-lg flex-col items-center gap-6 px-4 py-8">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Recorder</CardTitle>
          <CardDescription>16 kHz / 16-bit PCM WAV — chunked every 5 s</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="overflow-hidden rounded-sm border border-border/50 bg-muted/20 text-foreground">
            <LiveWaveform
              active={isRecording}
              processing={isPaused}
              stream={stream}
              height={80}
              barWidth={3}
              barGap={1}
              barRadius={2}
              sensitivity={1.8}
              smoothingTimeConstant={0.85}
              fadeEdges
              fadeWidth={32}
              mode="static"
            />
          </div>

          <div className="text-center font-mono text-3xl tabular-nums tracking-tight">
            {formatTime(elapsed)}
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button
              size="lg"
              variant={isActive ? "destructive" : "default"}
              className="gap-2 px-5"
              onClick={handlePrimary}
              disabled={status === "requesting" || createSession.isPending}
            >
              {isActive ? (
                <><Square className="size-4" />Stop</>
              ) : (
                <><Mic className="size-4" />
                  {status === "requesting" || createSession.isPending ? "Starting..." : "Record"}
                </>
              )}
            </Button>

            {isActive && (
              <Button size="lg" variant="outline" className="gap-2" onClick={isPaused ? resume : pause}>
                {isPaused
                  ? <><Play className="size-4" />Resume</>
                  : <><Pause className="size-4" />Pause</>}
              </Button>
            )}

            {isStopped && sessionId && (
              <Button
                size="lg"
                variant="secondary"
                className="gap-2"
                onClick={handleTranscribe}
                disabled={triggerTranscript.isPending}
              >
                <FileText className="size-4" />
                {triggerTranscript.isPending ? "Queuing..." : "Transcribe"}
              </Button>
            )}
          </div>

          {sessionId && (
            <p className="text-center text-[10px] tabular-nums text-muted-foreground">
              Session: {sessionId}
            </p>
          )}
        </CardContent>
      </Card>

      {uploadStatuses.size > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Upload Status</CardTitle>
            <CardDescription>{uploadStatuses.size} chunk(s)</CardDescription>
          </CardHeader>
          <CardContent>
            <ChunkStatusList statuses={uploadStatuses} />
          </CardContent>
        </Card>
      )}

      {chunks.length > 0 && (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Chunks</CardTitle>
            <CardDescription>{chunks.length} recorded</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {chunks.map((chunk, i) => (
              <ChunkRow key={chunk.id} chunk={chunk} index={i} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
