'use client';

import { useState, useEffect, useCallback, type DragEvent, type RefObject } from 'react';
import { attachPathDrop, attachSavedImagePaste, saveTempImage } from '@/lib/terminal/imageInsert';
import { mergeAttachmentPaths } from '@/lib/agents/spawnAttachments';

export function useDragAndDropAttachments(dialogRef: RefObject<HTMLDivElement | null>) {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isDropTarget, setIsDropTarget] = useState(false);

  const addAttachments = useCallback((paths: string[]) => {
    setAttachments((current) => mergeAttachmentPaths(current, paths));
  }, []);

  const removeAttachment = useCallback((path: string) => {
    setAttachments((current) => current.filter((candidate) => candidate !== path));
  }, []);

  const resetAttachments = useCallback(() => {
    setAttachments([]);
    setIsDropTarget(false);
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const detachDrop = attachPathDrop(el, addAttachments, setIsDropTarget);
    const detachPaste = attachSavedImagePaste(el, addAttachments);
    return () => {
      detachDrop();
      detachPaste();
    };
  }, [addAttachments, dialogRef]);

  const handleHtml5DragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDropTarget(true);
  };

  const handleHtml5DragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDropTarget(false);
  };

  const handleHtml5Drop = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setIsDropTarget(false);
    const files = Array.from(e.dataTransfer.files);
    const nativePaths = files
      .map((file) => (file as File & { path?: string }).path)
      .filter((path): path is string => !!path);
    if (nativePaths.length > 0) {
      addAttachments(nativePaths);
      return;
    }
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    Promise.all(images.map(saveTempImage))
      .then(addAttachments)
      .catch(() => {
        // Browser mode / IPC failure — nothing to attach
      });
  };

  return {
    attachments,
    isDropTarget,
    addAttachments,
    removeAttachment,
    resetAttachments,
    handleHtml5DragOver,
    handleHtml5DragLeave,
    handleHtml5Drop,
  };
}
