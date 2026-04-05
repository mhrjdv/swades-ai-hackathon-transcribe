"use client"

import { Loader2, Check, X, Circle } from "lucide-react"

interface ChunkStatus {
  status: "pending" | "uploading" | "success" | "error"
  retries: number
  error?: string
}

interface ChunkStatusListProps {
  statuses: Map<number, ChunkStatus>
}

function StatusIcon({ status }: { status: ChunkStatus["status"] }) {
  switch (status) {
    case "pending":
      return <Circle className="size-3 text-muted-foreground/50" />
    case "uploading":
      return <Loader2 className="size-3 animate-spin text-yellow-500" />
    case "success":
      return <Check className="size-3 text-green-600 dark:text-green-400" />
    case "error":
      return <X className="size-3 text-destructive" />
  }
}

function ProgressSummary({ statuses }: { statuses: Map<number, ChunkStatus> }) {
  const total = statuses.size
  const success = Array.from(statuses.values()).filter((s) => s.status === "success").length
  const errors = Array.from(statuses.values()).filter((s) => s.status === "error").length
  const pct = total > 0 ? Math.round((success / total) * 100) : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {success} / {total} chunks uploaded
        </span>
        <span className="tabular-nums font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden bg-muted">
        <div
          className={[
            "h-full transition-all duration-500",
            errors > 0 ? "bg-destructive" : "bg-primary",
          ].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
      {errors > 0 && (
        <p className="text-[10px] text-destructive">{errors} chunk{errors !== 1 ? "s" : ""} failed</p>
      )}
    </div>
  )
}

export function ChunkStatusList({ statuses }: ChunkStatusListProps) {
  if (statuses.size === 0) {
    return <p className="text-xs text-muted-foreground">No chunks yet.</p>
  }

  const entries = Array.from(statuses.entries()).sort(([a], [b]) => a - b)

  return (
    <div className="flex flex-col gap-3">
      <ProgressSummary statuses={statuses} />

      <div className="flex flex-col gap-1">
        {entries.map(([index, chunkStatus]) => (
          <div
            key={index}
            className="flex items-center gap-3 bg-muted/30 px-3 py-2 ring-1 ring-foreground/5"
          >
            <StatusIcon status={chunkStatus.status} />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              Chunk {String(index + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 text-xs capitalize text-foreground">{chunkStatus.status}</span>
            {chunkStatus.retries > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {chunkStatus.retries} {chunkStatus.retries === 1 ? "retry" : "retries"}
              </span>
            )}
            {chunkStatus.error && chunkStatus.status === "error" && (
              <span className="max-w-[180px] truncate text-[10px] text-destructive">
                {chunkStatus.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
