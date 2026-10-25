// The shelf of the "+" tab in the window (packages/island/src/island/shelf.ts draws it).
// Rust keeps what lies on it (src-tauri/src/shelf.rs): files by reference, text and links as files
// in its temp folder, each for 10 minutes. On macOS the native drop reaches Rust directly; on
// Windows (and in the browser) the page gets the HTML5 drop: files go to Rust through WebView2
// (their real paths), text and links by a command.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  extOf,
  shelfCarry,
  shelfDrop,
  shelfRemove,
  type IslandPoint,
  type IslandState,
  type ShelfIn,
  type ShelfKind,
} from '@almanac-notch/island';

/** an item as Rust sends it */
export interface ShelfMsg {
  id: string;
  kind: ShelfKind;
  name: string;
  size: number | null;
  note: string;
  /** seconds left on the shelf */
  left: number;
  /** PNG, base64; null = the island draws a glyph */
  thumb: string | null;
}

async function decode(b64: string | null): Promise<CanvasImageSource | null> {
  if (!b64) return null;
  try {
    const bin = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    return await createImageBitmap(new Blob([bin], { type: 'image/png' }));
  } catch {
    return null;
  }
}

async function toIn(m: ShelfMsg): Promise<ShelfIn> {
  return {
    id: m.id,
    kind: m.kind,
    name: m.name,
    size: m.size,
    note: m.note,
    left: m.left,
    thumb: await decode(m.thumb),
  };
}

interface WebView2 {
  postMessageWithAdditionalObjects(message: string, objects: unknown): void;
}

export class ShelfDriver {
  constructor(
    private s: IslandState,
    private inTauri: boolean,
    private toIsland: (e: DragEvent) => IslandPoint,
    private wake: () => void,
  ) {}

  async start(): Promise<void> {
    if (this.inTauri) {
      await listen<{ x: number; y: number; n: number } | null>('island://shelf-carry', (e) => {
        this.wake();
        shelfCarry(this.s, e.payload, e.payload?.n ?? 0);
      });
      await listen<{ items: ShelfMsg[]; x: number | null; y: number | null }>('island://shelf-add', async (e) => {
        const items = await Promise.all(e.payload.items.map(toIn));
        this.wake();
        const { x, y } = e.payload;
        shelfDrop(this.s, items, x === null || y === null ? null : { x, y });
      });
      await listen<{ ids: string[]; how: 'sent' | 'expired' | 'removed' }>('island://shelf-remove', (e) => {
        this.wake();
        shelfRemove(this.s, e.payload.ids, e.payload.how);
      });
      await listen<{ id: string; thumb: string }>('island://shelf-thumb', async (e) => {
        const img = await decode(e.payload.thumb),
          it = this.s.shelf.items.find((i) => i.id === e.payload.id);
        if (it && img) it.thumb = img;
      });
    }
    this.html();
  }

  /** The HTML5 drop: the browser, and Windows, where the WebView takes drops itself. On macOS
   * Tauri's native handler takes every drop first and this never fires. */
  private html(): void {
    const over = (e: DragEvent): void => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      this.wake();
      shelfCarry(this.s, this.toIsland(e), e.dataTransfer?.items.length ?? 0);
    };
    document.addEventListener('dragenter', over);
    document.addEventListener('dragover', over);
    document.addEventListener('dragleave', (e) => {
      // only leaving the window counts, not moving between its elements
      if (!e.relatedTarget) shelfCarry(this.s, null);
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      this.wake();
      void this.drop(e);
    });
  }

  private async drop(e: DragEvent): Promise<void> {
    const dt = e.dataTransfer,
      p = this.toIsland(e);
    if (!dt) return shelfCarry(this.s, null);
    const files = [...dt.files];
    const wv = (window as unknown as { chrome?: { webview?: WebView2 } }).chrome?.webview;
    if (files.length && this.inTauri && wv) {
      // Windows: Rust reads the real paths from the File objects (ICoreWebView2File) and answers
      // with island://shelf-add; the point goes first, so the tiles fly from where they fell
      await invoke('shelf_drop_point', { x: p.x, y: p.y });
      wv.postMessageWithAdditionalObjects('almanac-shelf-drop', dt.files);
      return;
    }
    const uri = dt
      .getData('text/uri-list')
      .split('\n')
      .find((l) => l && !l.startsWith('#'));
    const text = dt.getData('text/plain');
    if (!files.length && (uri || text)) {
      if (this.inTauri) {
        const items = await invoke<ShelfMsg[]>('shelf_add_text', { text: uri || text, link: !!uri });
        return shelfDrop(this.s, await Promise.all(items.map(toIn)), p);
      }
      return shelfDrop(this.s, [webText(uri || text, !!uri)], p);
    }
    // the browser alone: the page cannot keep files, it only shows them (the harness and the filmstrips)
    shelfDrop(this.s, await Promise.all(files.map(webFile)), p);
  }

  /** `shelf:*` requests from the island */
  request(r: string): void {
    const [, what, arg = ''] = r.split(':');
    const ids = arg.split(',').filter(Boolean);
    if (!this.inTauri) {
      // the browser: a drag out "succeeds" so the filmstrips can show a tile leaving
      if (what === 'drag' || what === 'remove') shelfRemove(this.s, ids, what === 'drag' ? 'sent' : 'removed');
      return;
    }
    if (what === 'drag') void invoke('shelf_drag', { ids });
    else if (what === 'open') void invoke('shelf_open', { id: ids[0] });
    else if (what === 'menu') void invoke('shelf_menu', { ids });
    else if (what === 'look') void invoke('shelf_quicklook', { ids });
  }
}

let seq = 0;
const webId = (): string => 'web' + ++seq;

function webText(text: string, link: boolean): ShelfIn {
  let note = '';
  if (link)
    try {
      note = new URL(text).host.replace(/^www\./, '');
    } catch {
      note = '';
    }
  const first = text.trim().split(/\s+/).slice(0, 6).join(' ');
  return {
    id: webId(),
    kind: link ? 'link' : 'text',
    name: link ? note || text : first.length > 40 ? first.slice(0, 40) : first,
    size: null,
    note: link ? note : '',
    thumb: null,
  };
}

async function webFile(f: File): Promise<ShelfIn> {
  const image = f.type.startsWith('image/') || /^(png|jpe?g|gif|webp)$/.test(extOf(f.name));
  let thumb: CanvasImageSource | null = null;
  if (image)
    try {
      thumb = await createImageBitmap(f, { resizeWidth: 108, resizeQuality: 'medium' });
    } catch {
      thumb = null;
    }
  return { id: webId(), kind: image ? 'image' : 'file', name: f.name, size: f.size, note: '', thumb };
}
