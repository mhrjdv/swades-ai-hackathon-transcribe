"use client";

import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@my-better-t-app/trpc";

export const trpc = createTRPCReact<AppRouter>();
