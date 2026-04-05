"use client"

import { use } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  Mic,
  Upload,
  Loader2,
  AlertCircle,
  Clock,
  Layers,
  Calendar,
  Zap,
  Trash2,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card"
import { Button } from "@my-better-t-app/ui/components/button"
import { Skeleton } from "@my-better-t-app/ui/components/skeleton"
import { trpc } from "@/lib/trpc"
import { TranscriptView } from "@/components/transcript-view"
import { ChunkStatusList } from "@/components/chunk-status-list"

type SessionStatus = "idle" | "recording" | "uploading" | "transcribing" | "completed" | "error"

const STATUS_CONFIG: Record<SessionStatus, { label: string; badgeClass: string }> = {
  idle: { label: "Idle", badgeClass: "bg-muted text-muted-foreground" },
  recording: { label: "Recording", badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  uploading: { label: "Uploading", badgeClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400" },
  transcribing: { label: "Transcribing", badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  completed: { label: "Completed", badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  error: { label: "Error", badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

interface MetaRowProps {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
}

function MetaRow({ icon, label, value }: MetaRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2 last:border-0">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="[&>svg]:size-4">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <span className="text-xs font-medium">{value}</span>
    </div>
  )
}

interface PageProps {
  params: Promise<{ id: string }>
}

export default function SessionDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const router = useRouter()
  const utils = trpc.useUtils()

  const isTranscribing = (s: string | undefined) => s === "transcribing"
  const isUploading = (s: string | undefined) =>
    s === "uploading" || s === "idle" || s === "recording"

  const {
    data: session,
    isLoading: sessionLoading,
    error: sessionError,
  } = trpc.session.getById.useQuery(
    { sessionId: id },
    {
      // Poll every 2s while transcribing to detect completion
      refetchInterval: (query) =>
        isTranscribing(query.state.data?.status) ? 2000 : false,
    },
  )

  const deleteSession = trpc.session.delete.useMutation({
    onSuccess: () => {
      // Invalidate sessions list cache so it updates immediately
      utils.session.getAll.invalidate()
      router.push("/sessions")
    },
  })

  const { data: transcriptSegments, isLoading: transcriptLoading } =
    trpc.transcript.get.useQuery(
      { sessionId: id },
      { enabled: session?.status === "completed" },
    )

  const { data: chunkStatuses, isLoading: chunksLoading } =
    trpc.chunk.getBatchStatus.useQuery(
      { sessionId: id },
      {
        enabled: isUploading(session?.status),
        refetchInterval: isUploading(session?.status) ? 3000 : false,
      },
    )

  const triggerTranscription = trpc.transcript.trigger.useMutation()

  const hasAckedChunks =
    Array.isArray(chunkStatuses) &&
    chunkStatuses.length > 0 &&
    chunkStatuses.some((c: { status: string }) => c.status === "acked" || c.status === "uploaded")

  function handleTriggerTranscription() {
    triggerTranscription.mutate({ sessionId: id })
  }

  // Loading skeleton
  if (sessionLoading) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  // Error / not found
  if (sessionError || !session) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        <Link href="/sessions">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <ArrowLeft className="size-3" />
            Back to Sessions
          </Button>
        </Link>
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-destructive">Session not found</p>
              <p className="text-xs text-muted-foreground">
                {sessionError?.message ?? "This session does not exist or has been deleted."}
              </p>
            </div>
            <Link href="/sessions">
              <Button variant="outline" size="sm">Back to Sessions</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[session.status as SessionStatus] ?? STATUS_CONFIG.idle

  // Build chunk status map
  const chunkStatusMap = new Map<
    number,
    { status: "pending" | "uploading" | "success" | "error"; retries: number; error?: string }
  >()
  if (Array.isArray(chunkStatuses)) {
    for (const chunk of chunkStatuses as Array<{ index: number; status: string; error?: string }>) {
      let normalizedStatus: "pending" | "uploading" | "success" | "error" = "pending"
      if (chunk.status === "acked" || chunk.status === "uploaded") normalizedStatus = "success"
      else if (chunk.status === "error") normalizedStatus = "error"
      chunkStatusMap.set(chunk.index, { status: normalizedStatus, retries: 0, error: chunk.error })
    }
  }

  const canTriggerTranscription =
    (session.status === "uploading" || session.status === "idle" || session.status === "recording") &&
    hasAckedChunks

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      {/* Back nav + delete */}
      <div className="flex items-center justify-between">
        <Link href="/sessions">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
            <ArrowLeft className="size-3" />
            Back to Sessions
          </Button>
        </Link>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => deleteSession.mutate({ sessionId: id })}
          disabled={deleteSession.isPending}
        >
          <Trash2 className="size-3" />
          {deleteSession.isPending ? "Deleting…" : "Delete"}
        </Button>
      </div>

      {/* Session metadata */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CardTitle>{session.fileName ?? "Session"}</CardTitle>
              <CardDescription className="font-mono text-[10px]">{id}</CardDescription>
            </div>
            <span className={`shrink-0 px-2 py-0.5 text-[10px] font-medium ${statusConfig.badgeClass}`}>
              {statusConfig.label}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col">
            <MetaRow
              icon={session.sourceType === "mic" ? <Mic /> : <Upload />}
              label="Source"
              value={<span className="capitalize">{session.sourceType}</span>}
            />
            {session.totalDurationMs != null && (
              <MetaRow
                icon={<Clock />}
                label="Duration"
                value={formatDuration(session.totalDurationMs)}
              />
            )}
            {session.totalChunks != null && (
              <MetaRow icon={<Layers />} label="Chunks" value={session.totalChunks} />
            )}
            {session.createdAt && (
              <MetaRow
                icon={<Calendar />}
                label="Created"
                value={formatDate(session.createdAt)}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Start transcription CTA */}
      {canTriggerTranscription && (
        <Card>
          <CardContent className="flex items-center justify-between gap-4 py-4">
            <div>
              <p className="text-xs font-medium">Ready to transcribe</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                Chunks uploaded. Start the transcription process now.
              </p>
            </div>
            <Button
              onClick={handleTriggerTranscription}
              disabled={triggerTranscription.isPending}
              className="shrink-0 gap-1.5"
            >
              {triggerTranscription.isPending ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <Zap className="size-3" />
                  Start Transcription
                </>
              )}
            </Button>
          </CardContent>
          {triggerTranscription.error && (
            <CardContent className="pt-0">
              <p className="text-xs text-destructive">{triggerTranscription.error.message}</p>
            </CardContent>
          )}
        </Card>
      )}

      {/* Uploading: chunk progress */}
      {(session.status === "uploading" || session.status === "idle" || session.status === "recording") &&
        Array.isArray(chunkStatuses) &&
        chunkStatuses.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Upload Progress</CardTitle>
              <CardDescription>Per-chunk upload status</CardDescription>
            </CardHeader>
            <CardContent>
              {chunksLoading ? (
                <div className="flex flex-col gap-2">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <ChunkStatusList statuses={chunkStatusMap} />
              )}
            </CardContent>
          </Card>
        )}

      {/* Transcribing: animated state */}
      {session.status === "transcribing" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <Loader2 className="size-8 animate-spin text-primary" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Transcribing your audio…</p>
              <p className="text-xs text-muted-foreground">
                This may take a moment. The page will update when complete.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {session.status === "error" && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
            <AlertCircle className="size-8 text-destructive" />
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-destructive">Transcription failed</p>
              {session.errorMessage && (
                <p className="max-w-sm text-xs text-muted-foreground">{session.errorMessage}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completed: transcript */}
      {session.status === "completed" && (
        <Card>
          <CardHeader>
            <CardTitle>Transcript</CardTitle>
            {Array.isArray(transcriptSegments) && (
              <CardDescription>
                {transcriptSegments.length} segment{transcriptSegments.length !== 1 ? "s" : ""}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {transcriptLoading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex flex-col gap-1.5">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                ))}
              </div>
            ) : (
              <TranscriptView
                segments={
                  Array.isArray(transcriptSegments)
                    ? (transcriptSegments as Array<{
                        speakerId: number
                        startTime: number
                        endTime: number
                        content: string
                      }>)
                    : []
                }
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
