// What the boss's monitor shows in the office while nobody's at it up close: the computer's welcome
// screen, or the game you stepped away from, paused where you left it.
import * as THREE from 'three';
import { RETRO_SYSTEMS, type RetroSystem } from '../../../shared/retro';

const W = 640;
const H = 360;

export class Monitor {
  private readonly canvas = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private paused: { title: string; system: RetroSystem; shot: ImageBitmap | null } | null = null;
  private count = 0;
  private systems: RetroSystem[] = [];

  constructor(screen: THREE.Mesh) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = screen.material as THREE.MeshBasicMaterial;
    mat.map = this.texture;
    mat.color.set('#ffffff');
    mat.toneMapped = false;
    this.draw();
    // Canvas text only picks up the office's font once it has loaded.
    void document.fonts.ready.then(() => this.draw());
  }

  /** How many games there are, and for which consoles. */
  library(count: number, systems: RetroSystem[]) {
    this.count = count;
    this.systems = systems;
    this.draw();
  }

  /** The game you stepped away from, with a picture of where you were, or none. */
  async showPaused(game: { title: string; system: RetroSystem } | null, shot: Blob | null) {
    const prev = this.paused?.shot;
    let bitmap: ImageBitmap | null = null;
    if (game && shot) bitmap = await createImageBitmap(shot).catch(() => null);
    this.paused = game ? { ...game, shot: bitmap } : null;
    prev?.close();
    this.draw();
  }

  private draw() {
    const g = this.canvas.getContext('2d')!;
    const font = (size: number, weight = 900) => `${weight} ${size}px Nunito, ui-rounded, system-ui, sans-serif`;
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1320');
    sky.addColorStop(1, '#1d2b53');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const p = this.paused;
    if (p) {
      if (p.shot) {
        // The game's own picture, as big as it fits, in its own pixels.
        const scale = Math.min(W / p.shot.width, (H - 44) / p.shot.height);
        const w = p.shot.width * scale;
        const h = p.shot.height * scale;
        g.imageSmoothingEnabled = false;
        g.drawImage(p.shot, (W - w) / 2, (H - 44 - h) / 2, w, h);
      }
      g.fillStyle = 'rgba(11, 19, 32, 0.92)';
      g.fillRect(0, H - 44, W, 44);
      g.fillStyle = '#ffd166';
      g.font = font(20);
      g.fillText(`⏸ ${p.title} · ${RETRO_SYSTEMS[p.system].name}`, W / 2, H - 22, W - 30);
      this.texture.needsUpdate = true;
      return;
    }

    g.fillStyle = '#ff8a5b';
    g.shadowColor = '#000';
    g.shadowOffsetY = 5;
    g.font = font(68);
    g.fillText('OVERTIME', W / 2, 120);
    g.shadowOffsetY = 0;
    g.fillStyle = '#e8ecf8';
    g.font = font(20, 800);
    g.fillText(this.count ? `${this.count} retro games` : 'Retro games', W / 2, 182);
    g.fillStyle = '#8f9bc0';
    g.font = font(15, 700);
    const names = this.systems.map((s) => RETRO_SYSTEMS[s].name);
    const line = (from: number, to: number) => names.slice(from, to).join(' · ');
    g.fillText(line(0, 4), W / 2, 216, W - 40);
    if (names.length > 4) g.fillText(line(4, 9), W / 2, 238, W - 40);
    g.fillStyle = '#ffd166';
    g.font = font(17, 800);
    g.fillText('Sit in the boss’s chair and press E to play', W / 2, 300);
    this.texture.needsUpdate = true;
  }
}
