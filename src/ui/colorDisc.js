// Disque de couleurs.
//
// Remplace le sélecteur natif, qui ouvre une fenêtre du système d'exploitation :
// hors de l'atelier, impossible à styler, et sur iPad il recouvre l'œuvre au
// moment précis où l'on veut voir l'effet de la teinte.
//
// LE DISQUE N'EST PAS UNE SOURCE DE VÉRITÉ. Il écrit dans l'`<input type="color">`
// qui existe déjà et déclenche son évènement `input` : toute la chaîne en aval —
// liaison, rendu, enregistrement — reste inchangée et ignore jusqu'à son
// existence. Le jour où le disque disparaît, l'application fonctionne encore.
//
// Teinte et saturation sur le disque, clarté sur la réglette : ce sont les trois
// axes qui comptent pour une matière. Le rouge pur et le blanc cassé ne se
// choisissent pas de la même façon, et un carré de dégradé mélange les deux.

const TAILLE = 132; // côté du disque, en pixels de mise en page
const ANNEAU = 0.5; // part du rayon laissée vide au centre, pour la pastille

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function hslVersHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const oct = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${oct(r)}${oct(g)}${oct(b)}`;
}

export function hexVersHsl(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const [r, g, b] = m.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h;
  if (max === r) h = 60 * (((g - b) / d) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

export class ColorDisc {
  /**
   * @param {HTMLInputElement} input  le `<input type="color">` piloté
   * @param {HTMLElement} hote        conteneur où dessiner le disque
   * @param {object} options          `signal` d'abandon
   */
  constructor(input, hote, { signal } = {}) {
    this.input = input;
    this.hote = hote;
    this.opts = signal ? { signal } : {};
    this.etat = hexVersHsl(input.value);

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'color-disc-canvas';
    this.canvas.width = TAILLE * 2; // deux fois, pour rester net sur écran dense
    this.canvas.height = TAILLE * 2;
    this.canvas.style.width = `${TAILLE}px`;
    this.canvas.style.height = `${TAILLE}px`;
    this.canvas.setAttribute('role', 'application');
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute('aria-label', 'Disque de teinte et saturation — flèches pour ajuster');

    this.curseur = document.createElement('span');
    this.curseur.className = 'color-disc-cursor';
    this.curseur.setAttribute('aria-hidden', 'true');

    this.clarte = document.createElement('input');
    this.clarte.type = 'range';
    this.clarte.className = 'color-disc-light';
    this.clarte.min = '0';
    this.clarte.max = '100';
    this.clarte.step = '1';
    this.clarte.setAttribute('aria-label', 'Clarté');

    const plateau = document.createElement('div');
    plateau.className = 'color-disc-plate';
    plateau.append(this.canvas, this.curseur);
    hote.append(plateau, this.clarte);

    this.dessinerDisque();
    this.sync();

    this.canvas.addEventListener('pointerdown', (e) => this.saisir(e), this.opts);
    this.canvas.addEventListener('pointermove', (e) => { if (this.saisie) this.saisir(e); }, this.opts);
    this.canvas.addEventListener('pointerup', () => { this.saisie = false; }, this.opts);
    this.canvas.addEventListener('pointercancel', () => { this.saisie = false; }, this.opts);
    this.canvas.addEventListener('keydown', (e) => this.clavier(e), this.opts);
    this.clarte.addEventListener('input', () => {
      this.etat.l = Number(this.clarte.value) / 100;
      this.appliquer();
    }, this.opts);
    // Le disque suit la valeur si elle change ailleurs — préréglage, variation,
    // reprise d'un projet enregistré.
    this.input.addEventListener('input', () => {
      if (this.ecrivant) return;
      this.etat = hexVersHsl(this.input.value);
      this.sync();
    }, this.opts);
  }

  /** Le disque lui-même : teinte en angle, saturation en rayon. */
  dessinerDisque() {
    const ctx = this.canvas.getContext('2d');
    const n = this.canvas.width;
    const r = n / 2;
    const image = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = x - r;
        const dy = y - r;
        const d = Math.hypot(dx, dy) / r;
        const i = (y * n + x) * 4;
        if (d > 1 || d < ANNEAU) {
          image.data[i + 3] = 0;
          continue;
        }
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const s = (d - ANNEAU) / (1 - ANNEAU);
        const hex = hslVersHex(h, s, 0.5);
        image.data[i] = parseInt(hex.slice(1, 3), 16);
        image.data[i + 1] = parseInt(hex.slice(3, 5), 16);
        image.data[i + 2] = parseInt(hex.slice(5, 7), 16);
        // Bord adouci : sans lui, le disque a l'escalier d'un cercle tracé au pixel.
        image.data[i + 3] = Math.round(255 * clamp((1 - d) * r * 0.5, 0, 1) * clamp((d - ANNEAU) * r * 0.5, 0, 1));
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  saisir(event) {
    this.saisie = true;
    event.preventDefault();
    try { this.canvas.setPointerCapture(event.pointerId); } catch (_) { /* confort */ }
    const b = this.canvas.getBoundingClientRect();
    const dx = event.clientX - b.left - b.width / 2;
    const dy = event.clientY - b.top - b.height / 2;
    const d = clamp(Math.hypot(dx, dy) / (b.width / 2), ANNEAU, 1);
    this.etat.h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    this.etat.s = (d - ANNEAU) / (1 - ANNEAU);
    this.appliquer();
  }

  clavier(event) {
    const pas = event.shiftKey ? 1 : 5;
    switch (event.key) {
      case 'ArrowLeft': this.etat.h = (this.etat.h - pas + 360) % 360; break;
      case 'ArrowRight': this.etat.h = (this.etat.h + pas) % 360; break;
      case 'ArrowUp': this.etat.s = clamp(this.etat.s + pas / 100, 0, 1); break;
      case 'ArrowDown': this.etat.s = clamp(this.etat.s - pas / 100, 0, 1); break;
      default: return;
    }
    event.preventDefault();
    this.appliquer();
  }

  appliquer() {
    const hex = hslVersHex(this.etat.h, this.etat.s, this.etat.l);
    this.ecrivant = true;
    this.input.value = hex;
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    this.ecrivant = false;
    this.sync();
  }

  sync() {
    const { h, s, l } = this.etat;
    const rayon = ANNEAU + s * (1 - ANNEAU);
    const a = (h * Math.PI) / 180;
    this.curseur.style.left = `${50 + Math.cos(a) * rayon * 50}%`;
    this.curseur.style.top = `${50 + Math.sin(a) * rayon * 50}%`;
    this.curseur.style.background = hslVersHex(h, s, l);
    this.clarte.value = String(Math.round(l * 100));
    this.clarte.style.setProperty('--teinte', hslVersHex(h, s, 0.5));
    this.canvas.setAttribute('aria-valuetext', `teinte ${Math.round(h)} degrés, saturation ${Math.round(s * 100)} %, clarté ${Math.round(l * 100)} %`);
  }
}
