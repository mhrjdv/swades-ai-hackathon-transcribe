"use client"

import { useRef, useState } from "react"
import { Upload, FileAudio } from "lucide-react"

const ACCEPTED_TYPES = [
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/webm",
  "audio/flac",
  "audio/x-m4a",
  "audio/x-flac",
]

const ACCEPTED_EXTENSIONS = ".wav,.mp3,.m4a,.ogg,.webm,.flac"

const FORMAT_BADGES = [".wav", ".mp3", ".m4a", ".ogg", ".webm", ".flac"]

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

interface AudioUploadProps {
  onFileSelected: (file: File) => void
  isUploading: boolean
  accept?: string
}

export function AudioUpload({
  onFileSelected,
  isUploading,
  accept = ACCEPTED_EXTENSIONS,
}: AudioUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  function validateAndSelect(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
    const validExt = ["wav", "mp3", "m4a", "ogg", "webm", "flac"].includes(ext)
    const validType = ACCEPTED_TYPES.some((t) => file.type === t) || validExt

    if (!validType) {
      setError(`Unsupported format: .${ext || file.type}. Please use WAV, MP3, M4A, OGG, WebM, or FLAC.`)
      return
    }

    setError(null)
    setSelectedFile(file)
    onFileSelected(file)
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (!isUploading) setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (isUploading) return
    const file = e.dataTransfer.files[0]
    if (file) validateAndSelect(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) validateAndSelect(file)
  }

  function handleClick() {
    if (!isUploading) inputRef.current?.click()
  }

  const hasFile = selectedFile !== null && !error

  return (
    <div className="flex flex-col gap-3">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-disabled={isUploading}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleClick()
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-4 border-2 border-dashed p-10 text-center transition-colors duration-200",
          isUploading
            ? "pointer-events-none cursor-not-allowed border-border/40 bg-muted/10 opacity-60"
            : dragOver
              ? "border-primary bg-primary/5"
              : hasFile
                ? "border-green-500/60 bg-green-500/5"
                : "border-border/60 bg-muted/20 hover:border-primary hover:bg-primary/5",
        ].join(" ")}
      >
        {hasFile ? (
          <>
            <FileAudio className="size-10 text-green-600 dark:text-green-400" />
            <div>
              <p className="text-sm font-medium text-foreground">{selectedFile!.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{formatFileSize(selectedFile!.size)}</p>
              <p className="mt-2 text-[10px] text-muted-foreground">Click to choose a different file</p>
            </div>
          </>
        ) : (
          <>
            <div
              className={[
                "flex size-14 items-center justify-center ring-1",
                dragOver
                  ? "bg-primary/10 ring-primary/40 text-primary"
                  : "bg-muted/50 ring-foreground/10 text-muted-foreground",
              ].join(" ")}
            >
              <Upload className="size-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {dragOver ? "Drop your file here" : "Drag and drop your audio file"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">or click to browse</p>
            </div>
          </>
        )}

        {/* Format badges */}
        <div className="flex flex-wrap justify-center gap-1.5">
          {FORMAT_BADGES.map((fmt) => (
            <span
              key={fmt}
              className="bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-foreground/10"
            >
              {fmt}
            </span>
          ))}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={handleInputChange}
          disabled={isUploading}
        />
      </div>

      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  )
}
