"use client";

import Link from "next/link";
import { Mic, Upload, ArrowRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@my-better-t-app/ui/components/card";
import { Button } from "@my-better-t-app/ui/components/button";
import { Skeleton } from "@my-better-t-app/ui/components/skeleton";
import { trpc } from "@/lib/trpc";
import { SessionCard } from "@/components/session-card";
import { env } from "@my-better-t-app/env/web";
import { useEffect, useState } from "react";

type ApiHealthStatus = "checking" | "ok" | "error";

function useApiHealth() {
  const [status, setStatus] = useState<ApiHealthStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(`${env.NEXT_PUBLIC_SERVER_URL}/`)
      .then((r) => {
        if (!cancelled) setStatus(r.ok ? "ok" : "error");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}

function SessionSkeletons() {
  return (
    <div className="flex flex-col gap-2">
      {[1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}

export default function Home() {
  const apiHealth = useApiHealth();
  const { data: sessions, isLoading, error, refetch } = trpc.session.getAll.useQuery();

  const recentSessions = sessions?.slice(0, 5) ?? [];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8">
      {/* Hero */}
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">VoiceScribe</h1>
        <p className="text-sm text-muted-foreground">
          Record or upload audio to get accurate, speaker-labeled transcriptions.
        </p>
      </section>

      {/* Quick actions */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link href="/recorder" className="block">
          <Card className="group h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-4 py-5">
              <div className="flex size-10 shrink-0 items-center justify-center bg-primary/10 ring-1 ring-primary/20">
                <Mic className="size-5 text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">Record Audio</p>
                <p className="text-xs text-muted-foreground">
                  Capture audio directly from your microphone in real time.
                </p>
              </div>
              <ArrowRight className="ml-auto mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/upload" className="block">
          <Card className="group h-full transition-shadow hover:shadow-md">
            <CardContent className="flex items-start gap-4 py-5">
              <div className="flex size-10 shrink-0 items-center justify-center bg-primary/10 ring-1 ring-primary/20">
                <Upload className="size-5 text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-foreground">Upload Audio</p>
                <p className="text-xs text-muted-foreground">
                  Upload WAV, MP3, M4A, OGG, WebM, or FLAC files for transcription.
                </p>
              </div>
              <ArrowRight className="ml-auto mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </CardContent>
          </Card>
        </Link>
      </section>

      {/* Recent sessions */}
      <section>
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Recent Sessions</CardTitle>
              <Link href="/sessions">
                <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
                  View all
                  <ArrowRight className="size-3" />
                </Button>
              </Link>
            </div>
            <CardDescription>Your last 5 transcription sessions</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <SessionSkeletons />}

            {!isLoading && error && (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-xs text-destructive">Failed to load sessions: {error.message}</p>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            )}

            {!isLoading && !error && recentSessions.length === 0 && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">No sessions yet.</p>
                <p className="text-xs text-muted-foreground">
                  Record or upload audio to create your first transcription.
                </p>
              </div>
            )}

            {!isLoading && !error && recentSessions.length > 0 && (
              <div className="flex flex-col gap-2">
                {recentSessions.map((session) => (
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
          </CardContent>
        </Card>
      </section>

      {/* Service status */}
      <section>
        <Card size="sm">
          <CardHeader className="border-b">
            <CardTitle>Service Status</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              {apiHealth === "checking" && (
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              )}
              {apiHealth === "ok" && (
                <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
              )}
              {apiHealth === "error" && (
                <XCircle className="size-4 text-destructive" />
              )}
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">
                  {apiHealth === "checking" && "Checking server…"}
                  {apiHealth === "ok" && "Server is online"}
                  {apiHealth === "error" && "Server is unreachable"}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {env.NEXT_PUBLIC_SERVER_URL}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
