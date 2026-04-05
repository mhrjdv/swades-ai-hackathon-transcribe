"use client"

import Link from "next/link"
import { Mic, Upload } from "lucide-react"
import { Card, CardContent } from "@my-better-t-app/ui/components/card"

type SessionStatus = "idle" | "recording" | "uploading" | "transcribing" | "completed" | "error"
type SourceType = "mic" | "upload"

interface SessionCardProps {
  id: string
  status: SessionStatus
  sourceType: SourceType
  totalDurationMs?: number | null
  fileName?: string | null
  createdAt: Date | string
}

const STATUS_CONFIG: Record<SessionStatus, { label: string; dotClass: string; badgeClass: string }> = {
  idle: {
    label: "Idle",
    dotClass: "bg-muted-foreground/50",
    badgeClass: "bg-muted text-muted-foreground",
  },
  recording: {
    label: "Recording",
    dotClass: "bg-red-500 animate-pulse",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  uploading: {
    label: "Uploading",
    dotClass: "bg-yellow-500",
    badgeClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  transcribing: {
    label: "Transcribing",
    dotClass: "bg-blue-500",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  completed: {
    label: "Completed",
    dotClass: "bg-green-500",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  error: {
    label: "Error",
    dotClass: "bg-red-500",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
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

function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return "Just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

export function SessionCard({
  id,
  status,
  sourceType,
  totalDurationMs,
  fileName,
  createdAt,
}: SessionCardProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.idle

  return (
    <Link href={`/sessions/${id}`} className="block">
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="flex items-center gap-3 py-3">
          {/* Source icon */}
          <div className="flex size-8 shrink-0 items-center justify-center bg-muted/50 ring-1 ring-foreground/10">
            {sourceType === "mic" ? (
              <Mic className="size-4 text-muted-foreground" />
            ) : (
              <Upload className="size-4 text-muted-foreground" />
            )}
          </div>

          {/* Info */}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] font-medium ${config.badgeClass}`}
              >
                <span className={`inline-block size-1.5 rounded-full ${config.dotClass}`} />
                {config.label}
              </span>
              <span className="text-[10px] text-muted-foreground capitalize">{sourceType}</span>
            </div>
            {fileName && (
              <p className="truncate text-xs text-foreground">{fileName}</p>
            )}
            <p className="text-[10px] text-muted-foreground">{formatRelativeDate(createdAt)}</p>
          </div>

          {/* Duration */}
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {totalDurationMs != null ? formatDuration(totalDurationMs) : "—"}
          </span>
        </CardContent>
      </Card>
    </Link>
  )
}
