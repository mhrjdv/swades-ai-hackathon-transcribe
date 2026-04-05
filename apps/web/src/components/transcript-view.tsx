"use client"

import { useState } from "react"
import { Copy, Check, ChevronDown, ChevronUp, FileText } from "lucide-react"
import { Button } from "@my-better-t-app/ui/components/button"

const SPEAKER_COLORS: Array<{ label: string; dot: string }> = [
  { label: "text-blue-600 dark:text-blue-400", dot: "bg-blue-500" },
  { label: "text-emerald-600 dark:text-emerald-400", dot: "bg-emerald-500" },
  { label: "text-purple-600 dark:text-purple-400", dot: "bg-purple-500" },
  { label: "text-orange-600 dark:text-orange-400", dot: "bg-orange-500" },
  { label: "text-pink-600 dark:text-pink-400", dot: "bg-pink-500" },
  { label: "text-teal-600 dark:text-teal-400", dot: "bg-teal-500" },
  { label: "text-red-600 dark:text-red-400", dot: "bg-red-500" },
  { label: "text-amber-600 dark:text-amber-400", dot: "bg-amber-500" },
]

interface TranscriptSegment {
  speakerId: number
  startTime: number
  endTime: number
  content: string
}

interface TranscriptViewProps {
  segments: TranscriptSegment[]
}

const PREVIEW_COUNT = 5

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function buildFullText(segments: TranscriptSegment[]): string {
  return segments
    .map((seg) => `[Speaker ${seg.speakerId + 1}] ${seg.content}`)
    .join("\n\n")
}

export function TranscriptView({ segments }: TranscriptViewProps) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  if (segments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <FileText className="size-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">No transcript available.</p>
      </div>
    )
  }

  const displayed = expanded ? segments : segments.slice(0, PREVIEW_COUNT)
  const hasMore = segments.length > PREVIEW_COUNT

  async function handleCopy() {
    const text = buildFullText(segments)
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {segments.length} segment{segments.length !== 1 ? "s" : ""}
        </p>
        <Button variant="outline" size="xs" onClick={handleCopy} className="gap-1.5">
          {copied ? (
            <>
              <Check className="size-3 text-green-600" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Segments */}
      <div className="flex flex-col gap-4">
        {displayed.map((segment, index) => {
          const color = SPEAKER_COLORS[segment.speakerId % SPEAKER_COLORS.length]!
          return (
            <div key={index} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className={`inline-block size-2 shrink-0 rounded-full ${color.dot}`} />
                <span className={`text-xs font-semibold ${color.label}`}>
                  Speaker {segment.speakerId + 1}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {formatTimestamp(segment.startTime)} – {formatTimestamp(segment.endTime)}
                </span>
              </div>
              <p className="border-l-2 border-border/60 pl-4 text-xs leading-relaxed text-foreground">
                {segment.content}
              </p>
            </div>
          )
        })}
      </div>

      {/* Expand/Collapse */}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((prev) => !prev)}
          className="self-start gap-1 text-xs text-muted-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-3" />
              Show {segments.length - PREVIEW_COUNT} more segment{segments.length - PREVIEW_COUNT !== 1 ? "s" : ""}
            </>
          )}
        </Button>
      )}
    </div>
  )
}
