import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isQueueImageId, QUEUE_IMAGE_TYPES, QUEUE_IMAGES_DIR } from '../shared/queue-images.js';

/** A picture sent up but never queued (the window was closed first) is deleted after this long. */
const UNUSED_MS = 24 * 60 * 60 * 1000;

/** What each kind of picture starts with, so a file that only says it's a picture isn't kept. */
function pictureType(body: Buffer): string | undefined {
  if (body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'image/jpeg';
  if (body.length >= 6 && /^GIF8[79]a$/.test(body.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (body.length >= 12 && body.subarray(0, 4).toString('latin1') === 'RIFF' && body.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return undefined;
}

const TYPE_OF_EXT: Record<string, string> = Object.fromEntries(Object.entries(QUEUE_IMAGE_TYPES).map(([type, ext]) => [ext, type]));

/**
 * The pictures attached to the floor's queued tasks (see shared/queue-images.ts), kept in its
 * .agent-office/queue-images/. They're sent up as they're pasted, before the task is queued, and go
 * when their task does. A worker in a worktree gets a copy in its own .agent-office/queue-images/,
 * so it opens them inside its working folder (git ignores .agent-office/ in every worktree).
 */
export class QueueImages {
  readonly dir: string;

  constructor(
    dataDir: string,
    /** The floor's checkout, which a worker's worktree path is relative to. */
    private projectDir: string,
  ) {
    this.dir = path.join(dataDir, 'queue-images');
  }

  /** Keeps a picture sent up for a task; its id, or why it couldn't be. */
  save(name: string, body: Buffer): { id: string } | { error: string } {
    const type = pictureType(body);
    if (!type) return { error: 'Only PNG, JPEG, GIF and WebP pictures can be attached' };
    const stem = (name.split(/[\\/]/).pop() ?? '')
      .replace(/\.[^.]*$/, '')
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .replace(/[^\w-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const id = `${randomBytes(6).toString('hex')}-${stem || 'picture'}${QUEUE_IMAGE_TYPES[type]}`;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileSync(path.join(this.dir, id), body, { mode: 0o600, flag: 'wx' });
      return { id };
    } catch {
      return { error: 'The office could not keep that picture' };
    }
  }

  has(id: string): boolean {
    try {
      return isQueueImageId(id) && statSync(path.join(this.dir, id)).isFile();
    } catch {
      return false;
    }
  }

  /** A picture to show in the queue's window. */
  file(id: string): { type: string; body: Buffer } | undefined {
    if (!isQueueImageId(id)) return undefined;
    try {
      return { type: TYPE_OF_EXT[path.extname(id)], body: readFileSync(path.join(this.dir, id)) };
    } catch {
      return undefined;
    }
  }

  /**
   * Puts a task's pictures where its worker can open them: a copy in its worktree (relative to the
   * floor's checkout), or nothing to do for a worker in the checkout itself, where they already are.
   * Returns the ones it has, by their path in the worker's folder.
   */
  handTo(ids: string[], worktree?: string): string[] {
    const there = worktree ? path.join(this.projectDir, worktree, QUEUE_IMAGES_DIR) : undefined;
    const out: string[] = [];
    for (const id of ids) {
      if (!this.has(id)) continue;
      try {
        if (there) {
          mkdirSync(there, { recursive: true, mode: 0o700 });
          copyFileSync(path.join(this.dir, id), path.join(there, id));
        }
        out.push(`${QUEUE_IMAGES_DIR}/${id}`);
      } catch {
        // the worker goes without that one
      }
    }
    return out;
  }

  remove(ids: readonly string[]) {
    for (const id of ids) {
      if (!isQueueImageId(id)) continue;
      try {
        rmSync(path.join(this.dir, id), { force: true });
      } catch {
        // already gone
      }
    }
  }

  /** Deletes pictures sent up a day ago or more that no task has: the window was closed before they were queued. */
  prune(keep: Set<string>, now = Date.now()) {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const id of names) {
      if (keep.has(id)) continue;
      try {
        if (now - statSync(path.join(this.dir, id)).mtimeMs > UNUSED_MS) rmSync(path.join(this.dir, id), { force: true });
      } catch {
        // gone meanwhile
      }
    }
  }
}

/** What's added to a task's prompt for the pictures attached to it, by their paths in the worker's folder. */
export function imagesNote(paths: string[]): string {
  if (!paths.length) return '';
  const one = paths.length === 1;
  return `${one ? 'A picture is' : 'Pictures are'} attached to this task. Look at ${one ? 'it' : 'them'} before you start (the path${one ? ' is' : 's are'} relative to your working folder):\n${paths.map((p) => `- ${p}`).join('\n')}`;
}
