import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function parseLines(str: string | undefined | null): string[] {
  return str?.split('\n').filter(Boolean) || [];
}
