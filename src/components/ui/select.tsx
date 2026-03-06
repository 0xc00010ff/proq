"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "./dropdown-menu"

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  label?: string
  className?: string
  placeholder?: string
}

export function Select({ value, onChange, options, label, className, placeholder }: SelectProps) {
  const selectedOption = options.find((o) => o.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "w-full flex items-center justify-between bg-surface-inset border border-border-strong/50 rounded-md px-3 py-2 text-sm text-text-primary outline-none hover:border-border-hover hover:bg-surface-hover/40 transition-colors",
            className
          )}
        >
          <span className={selectedOption ? "" : "text-text-chrome"}>
            {selectedOption?.label ?? placeholder ?? "Select..."}
          </span>
          <ChevronDownIcon className="w-3.5 h-3.5 text-text-chrome shrink-0 ml-2" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
      >
        {label && (
          <>
            <DropdownMenuLabel>{label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onChange(option.value)}
            className={cn(
              value === option.value && "text-text-chrome-active"
            )}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
