"use client"

import Link from "next/link"
import { Mic, Upload, AlertCircle, AudioWaveform } from "lucide-react"
import {
  Card,
  CardContent,
} from "@my-better-t-app/ui/components/card"
import { Button } from "@my-better-t-app/ui/components/button"
import { Skeleton } from "@my-better-t-app/ui/components/skeleton"
import { trpc } from "@/lib/trpc"
import { SessionCard } from "@/components/session-card"

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Skeleton key={i} className="h-20 w-full" />
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-6 py-20 text-center">
      <div className="flex size-16 items-center justify-center bg-muted/50 ring-1 ring-foreground/10">
        <AudioWaveform className="size-8 text-muted-foreground/50" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium text-foreground">No sessions yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          Create a transcription by recording from your microphone or uploading an audio file.
        </p>
      </div>
      <div className="flex gap-3">
        <Link href="/recorder">
          <Button variant="outline" size="sm" className="gap-1.5">
            <Mic className="size-3.5" />
            Record
          </Button>
        </Link>
        <Link href="/upload">
          <Button size="sm" className="gap-1.5">
            <Upload className="size-3.5" />
            Upload File
          </Button>
        </Link>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
        <AlertCircle className="size-8 text-destructive" />
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-destructive">Failed to load sessions</p>
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  )
}

export default function SessionsPage() {
  const { data: sessions, isLoading, error, refetch } = trpc.session.getAll.useQuery()

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      {/* Header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Sessions</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            All your recorded and uploaded audio transcriptions
          </p>
        </div>
        {sessions && sessions.length > 0 && (
          <p className="shrink-0 text-xs text-muted-foreground">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>

      {/* Content */}
      {isLoading && <SkeletonGrid />}

      {!isLoading && error && (
        <ErrorState message={error.message} onRetry={() => refetch()} />
      )}

      {!isLoading && !error && sessions && sessions.length === 0 && (
        <EmptyState />
      )}

      {!isLoading && !error && sessions && sessions.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {sessions.map((session) => (
            <SessionCard
              key={session.id}
              id={session.id}
              status={session.status}
              sourceType={session.sourceType}
              totalDurationMs={session.totalDurationMs}
              fileName={session.fileName}
              createdAt={session.createdAt}
            />
          ))}
        </div>
      )}
    </div>
  )
}
