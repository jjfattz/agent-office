// Pictures on a 📋 queue task: pasted into its box, dragged onto it or picked with 📎, each sent to
// the office as it comes in (server/queue-images.ts), so the task only has to name them when it's added.

import './queue-images.css';
import type { QueueTask } from '../../shared/protocol';
import { QUEUE_IMAGE_MAX_BYTES, QUEUE_IMAGE_TYPES, QUEUE_IMAGES_MAX } from '../../shared/queue-images';
import { store } from '../state';
import { h, toast } from './dom';

export interface ImageAttacher {
  /** The pictures so far, as thumbnails with a ✕ each. Empty (and hidden) with none. */
  readonly list: HTMLElement;
  /** 📎: picks pictures from the computer (or the phone's photos and camera). */
  readonly button: HTMLButtonElement;
  /** The ids of the pictures, once every one still on its way is in. */
  ready(): Promise<string[]>;
  /** Lets go of the pictures: the task was added, or the window closed. */
  clear(): void;
}

interface Pending {
  chip: HTMLElement;
  url: string;
  id?: string;
  up: Promise<void>;
}

const ACCEPT = Object.keys(QUEUE_IMAGE_TYPES).join(',');

/** A picture attached to a task, as the office serves it. */
export function queueImageUrl(id: string): string {
  return `/api/queue/image?${new URLSearchParams({ floor: store.floor ?? '', id })}`;
}

async function upload(f: File): Promise<string> {
  const name = f.name || 'That picture';
  if (!QUEUE_IMAGE_TYPES[f.type]) throw new Error(`${name} isn't a PNG, JPEG, GIF or WebP picture`);
  if (f.size > QUEUE_IMAGE_MAX_BYTES) throw new Error(`${name} is too big to attach (${QUEUE_IMAGE_MAX_BYTES / 1024 / 1024} MB at most)`);
  const q = new URLSearchParams({ floor: store.floor ?? '', name: f.name || 'pasted' });
  const res = await fetch(`/api/queue/image?${q}`, { method: 'POST', headers: { 'content-type': f.type }, body: f });
  const r = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !r.id) throw new Error(r.error ?? `${name} could not be attached`);
  return r.id;
}

/** Pictures pasted into `field`, dropped on `zone` or picked with the 📎, for one task at a time. */
export function imageAttacher(field: HTMLTextAreaElement, zone: HTMLElement): ImageAttacher {
  let pending: Pending[] = [];
  const picker = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true }) as HTMLInputElement;
  const list = h('div.queue-images.hidden', { 'aria-label': 'Attached pictures' }, picker);
  const button = h('button.btn.queue-attach', { type: 'button', title: 'Attach pictures (or paste or drop them into the box)', 'aria-label': 'Attach pictures' }, '📎') as HTMLButtonElement;

  const shown = () => void list.classList.toggle('hidden', pending.length === 0);
  const drop = (p: Pending) => {
    pending = pending.filter((x) => x !== p);
    URL.revokeObjectURL(p.url);
    p.chip.remove();
    shown();
  };

  const add = (files: File[]) => {
    const pictures = files.filter((f) => f.type.startsWith('image/'));
    if (pictures.length < files.length) toast('Only pictures can be attached to a task', 'warn');
    for (const f of pictures) {
      if (pending.length >= QUEUE_IMAGES_MAX) {
        toast(`A task takes ${QUEUE_IMAGES_MAX} pictures at most`, 'warn');
        break;
      }
      const url = URL.createObjectURL(f);
      const x = h('button.queue-image-x', { type: 'button', title: 'Take it off', 'aria-label': 'Remove picture' }, '✕');
      const chip = h('div.queue-image.busy', { title: f.name || 'Pasted picture' }, h('img', { src: url, alt: f.name || 'Pasted picture' }), x);
      const p: Pending = { chip, url, up: Promise.resolve() };
      p.up = upload(f).then(
        (id) => {
          p.id = id;
          chip.classList.remove('busy');
        },
        (err: Error) => {
          toast(err.message, 'error');
          drop(p);
        },
      );
      x.addEventListener('click', () => drop(p));
      pending.push(p);
      list.append(chip);
    }
    shown();
  };

  button.addEventListener('click', () => picker.click());
  picker.addEventListener('change', () => {
    add([...(picker.files ?? [])]);
    picker.value = '';
  });
  // A screenshot pasted is a picture with no text; something copied with text too (a spreadsheet's cells) pastes as text.
  field.addEventListener('paste', (e) => {
    const data = e.clipboardData;
    const files = [...(data?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length || data?.getData('text/plain')) return;
    e.preventDefault();
    add(files);
  });
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
  zone.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    zone.classList.add('dropping');
  });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget as Node | null)) zone.classList.remove('dropping');
  });
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('dropping');
    if (!hasFiles(e)) return;
    e.preventDefault();
    add([...(e.dataTransfer?.files ?? [])]);
  });

  return {
    list,
    button,
    async ready() {
      await Promise.all(pending.map((p) => p.up));
      return pending.flatMap((p) => (p.id ? [p.id] : []));
    },
    clear() {
      for (const p of [...pending]) drop(p);
    },
  };
}

/** A task's pictures as small thumbnails, each opening the picture in a tab of its own. */
export function taskImages(t: QueueTask): HTMLElement | null {
  if (!t.images?.length) return null;
  return h(
    'div.queue-thumbs',
    {},
    ...t.images.map((id) => h('a', { href: queueImageUrl(id), target: '_blank', rel: 'noopener', title: 'Open the picture' }, h('img', { src: queueImageUrl(id), alt: 'Attached picture', loading: 'lazy' }))),
  );
}
