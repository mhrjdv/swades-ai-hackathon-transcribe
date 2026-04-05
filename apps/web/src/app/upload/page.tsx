"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2, CheckCircle2, ArrowRight, AlertCircle, RotateCcw } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card"
import { Button } from "@my-better-t-app/ui/components/button"
import { AudioUpload } from "@/components/audio-upload"
import { useChunkUploader } from "@/hooks/use-chunk-uploader"
import { trpc } from "@/lib/trpc"
import { env } from "@my-better-t-app/env/web"

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type PageState = "idle" | "uploading" | "transcribing" | "success" | "error"

export default function UploadPage() {
  const router = useRouter()
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pageState, setPageState] = useState<PageState>("idle")
  const [completedSessionId, setCompletedSessionId] = useState<string | null>(null)

  const { uploadFile, isUploading, statuses } = useChunkUploader(env.NEXT_PUBLIC_SERVER_URL)
  const triggerTranscription = trpc.transcript.trigger.useMutation()

  const completedChunks = Array.from(statuses.values()).filter((s) => s.status === "success").length
  const totalChunks = statuses.size
  const progressPct = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 0

  async function handleUpload() {
    if (!selectedFile) return
    setUploadError(null)
    setPageState("uploading")

    const result = await uploadFile(selectedFile)
    if (result.success && result.sessionId) {
      setCompletedSessionId(result.sessionId)
      // Auto-trigger transcription
      setPageState("transcribing")
      triggerTranscription.mutate(
        { sessionId: result.sessionId },
        {
          onSuccess: () => {
            // Redirect to session page to see transcription progress
            router.push(`/sessions/${result.sessionId}`)
          },
          onError: () => {
            // Still redirect — user can retry from session page
            router.push(`/sessions/${result.sessionId}`)
          },
        }
      )
    } else {
      setUploadError(result.error ?? "Upload failed. Please try again.")
      setPageState("error")
    }
  }

  function handleReset() {
    setSelectedFile(null)
    setUploadError(null)
    setPageState("idle")
    setCompletedSessionId(null)
  }

  function handleFileSelected(file: File) {
    setSelectedFile(file)
    setUploadError(null)
    if (pageState === "error") setPageState("idle")
  }

  // Transcribing state — auto-redirects to session page
  if (pageState === "transcribing" && completedSessionId) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center justify-center gap-6 px-4 py-16">
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <Loader2 className="size-12 animate-spin text-blue-600 dark:text-blue-400" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">Upload Complete — Starting Transcription</p>
              <p className="text-xs text-muted-foreground">
                Redirecting to your session page...
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="text-lg font-semibold">Upload Audio</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Upload an audio file to transcribe it with speaker detection.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select File</CardTitle>
          <CardDescription>WAV, MP3, M4A, OGG, WebM, or FLAC — up to any size</CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-5">
          <AudioUpload
            onFileSelected={handleFileSelected}
            isUploading={isUploading}
          />

          {/* Upload progress */}
          {isUploading && totalChunks > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Uploading…</span>
                <span className="tabular-nums font-medium">{progressPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden bg-muted">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[10px] tabular-nums text-muted-foreground">
                {completedChunks} / {totalChunks} chunks uploaded
              </p>
            </div>
          )}

          {/* Error state */}
          {uploadError && pageState === "error" && (
            <div className="flex items-start gap-3 bg-destructive/10 px-3 py-3 ring-1 ring-destructive/30">
              <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div className="flex flex-1 flex-col gap-1">
                <p className="text-xs font-medium text-destructive">Upload failed</p>
                <p className="text-xs text-destructive/80">{uploadError}</p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={handleReset}>
                <RotateCcw className="size-3" />
              </Button>
            </div>
          )}

          {/* Selected file summary (when not yet uploading) */}
          {selectedFile && !isUploading && pageState === "idle" && (
            <div className="flex items-center justify-between bg-muted/30 px-3 py-2 ring-1 ring-foreground/10">
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-xs font-medium">{selectedFile.name}</span>
                <span className="text-[10px] text-muted-foreground">{formatFileSize(selectedFile.size)}</span>
              </div>
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || pageState === "transcribing"}
          >
            {isUploading ? "Uploading…" : pageState === "transcribing" ? "Starting Transcription…" : "Upload & Transcribe"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
