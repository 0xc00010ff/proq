"use client";

import React, { useState } from "react";
import { XIcon, FolderSearchIcon, Trash2Icon, FolderOpenIcon } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import type { Project } from "@/lib/types";

interface MissingPathModalProps {
  project: Project;
  onClose: () => void;
  onRelocate: (project: Project, newPath: string) => void;
  onRemove: (project: Project) => void;
}

export function MissingPathModal({ project, onClose, onRelocate, onRemove }: MissingPathModalProps) {
  const [loading, setLoading] = useState(false);

  useEscapeKey(onClose, true);

  const handleSelectFolder = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/folder-picker", { method: "POST" });
      const data = await res.json();
      if (data.cancelled) {
        setLoading(false);
        return;
      }
      onRelocate(project, data.path);
    } catch {
      setLoading(false);
    }
  };

  const handleRemove = () => {
    onRemove(project);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-none"
        onClick={onClose}
      />

      <div className="relative w-full max-w-md bg-surface-modal border border-border-default rounded-lg shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-text-placeholder hover:text-text-secondary p-1 z-10"
        >
          <XIcon className="w-4 h-4" />
        </button>

        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-crimson/10 flex items-center justify-center flex-shrink-0">
              <FolderSearchIcon className="w-5 h-5 text-crimson" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Project not found
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                {project.name}
              </p>
            </div>
          </div>

          <div className="bg-surface-hover/50 rounded-md p-3 mb-5">
            <p className="text-xs text-text-tertiary mb-1">Expected path</p>
            <p className="text-xs font-mono text-crimson break-all">
              {project.path}
            </p>
          </div>

          <p className="text-xs text-text-secondary mb-5">
            The folder for this project can&apos;t be found. It may have been moved or deleted.
          </p>

          <div className="flex flex-col gap-2">
            <button
              onClick={handleSelectFolder}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md bg-steel-dark hover:bg-steel disabled:opacity-50 text-white text-sm font-medium"
            >
              <FolderOpenIcon className="w-4 h-4" />
              {loading ? "Waiting for selection..." : "Select new folder"}
            </button>
            <button
              onClick={handleRemove}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-md border border-border-strong hover:bg-crimson/10 hover:border-crimson/30 text-text-secondary hover:text-crimson text-sm"
            >
              <Trash2Icon className="w-4 h-4" />
              Remove project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
