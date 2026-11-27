// Pictures attached to a task on the 📋 queue: pasted or picked in its window, sent to the office
// first (server/queue-images.ts), and named on the task by id. The worker gets them as files.

/** The biggest picture a task takes: plenty for a screenshot of a big screen. */
export const QUEUE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** The most pictures one task takes. */
export const QUEUE_IMAGES_MAX = 8;

/** The kinds of picture a task takes, and the name ending each is kept with. */
export const QUEUE_IMAGE_TYPES: Readonly<Record<string, string>> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' };

/** Where a task's pictures are, relative to its worker's working folder (its worktree, or the project). */
export const QUEUE_IMAGES_DIR = '.agent-office/queue-images';

/** Whether this is a picture's id as the office makes them: 12 hex digits, a dash, a safe name and its ending. */
export function isQueueImageId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{12}-[\w-]{1,80}\.(png|jpg|gif|webp)$/.test(id);
}
