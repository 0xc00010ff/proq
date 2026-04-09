import { useCallback, useRef, useState } from 'react';
import { uploadFiles } from '@/lib/upload';
import type { TaskAttachment } from '@/lib/types';

/**
 * Hook for handling file drag-and-drop on a container element.
 * Returns drag event handlers and an isDragOver state for visual feedback.
 */
export function useFileDrop(
  attachments: TaskAttachment[],
  onAttachmentsChange: (attachments: TaskAttachment[]) => void,
  projectId?: string,
) {
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files, projectId).then((uploaded) => {
        onAttachmentsChange([...attachments, ...uploaded]);
      });
    }
  }, [attachments, onAttachmentsChange, projectId]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const dropProps = {
    onDrop: handleDrop,
    onDragEnter: handleDragEnter,
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
  };

  const dismiss = useCallback(() => {
    dragCounterRef.current = 0;
    setIsDragOver(false);
  }, []);

  return { isDragOver, dropProps, dismiss };
}
