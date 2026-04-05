"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic2 } from "lucide-react";
import { ModeToggle } from "./mode-toggle";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/recorder", label: "Record" },
  { href: "/upload", label: "Upload" },
  { href: "/sessions", label: "Sessions" },
] as const;

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
          <Mic2 className="size-4 text-primary" />
          <span>VoiceScribe</span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={[
                  "rounded-none px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                ].join(" ")}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <ModeToggle />
      </div>
    </header>
  );
}
