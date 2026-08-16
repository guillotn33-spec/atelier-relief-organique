// Pointeur de brosse.
//
// Jusqu'ici, sculpter se faisait à l'aveugle : le canvas portait un simple
// `cursor: crosshair` et rien n'indiquait ce que la brosse allait couvrir. Une
// taille se règle en centimètres, une brosse peut être allongée et orientée —
// trois réglages dont l'effet ne se découvrait qu'après le premier trait.
//
// L'empreinte affichée est calculée par `brushAxes`, LA fonction qu'emploie le
// moteur. Ce que le pointeur montre est donc ce que la brosse dépose, et non un
// dessin approchant tenu à jour à côté.
//
// Il suit aussi la symétrie : quand elle est active, les empreintes miroir
// s'affichent en même temps, à leur place exacte.

import { brushAxes } from '../sculpt/brush.js';

const OUTILS_DESSINANTS = new Set(['dig', 'raise', 'smooth', 'erase', 'warp']);

export class BrushCursor {
  /**
   * @param {HTMLElement} artWrap  boîte de l'œuvre
   * @param {object} options
   *   lire() — rend `{ outil, rayonCm, elongation, angleDeg, suitLeTrace, symetrie, largeurCm, hauteurCm }`
   *   signal — signal d'abandon de l'atelier
   */
  constructor(artWrap, { lire, signal } = {}) {
    this.artWrap = artWrap;
    this.lire = lire;
    this.opts = signal ? { signal } : {};
    this.empreintes = [];
    this.visible = false;

    this.hote = document.createElement('div');
    this.hote.className = 'brush-cursor';
    this.hote.setAttribute('aria-hidden', 'true');
    artWrap.append(this.hote);

    // `pointermove` sur la SCÈNE et non sur l'œuvre : le pointeur doit rester
    // visible quand le geste déborde du panneau, sinon il clignote au bord.
    const stage = artWrap.closest('.stage') || artWrap;
    stage.addEventListener('pointermove', (e) => this.placer(e), this.opts);
    stage.addEventListener('pointerleave', () => this.cacher(), this.opts);
    stage.addEventListener('pointerdown', (e) => this.placer(e), this.opts);
  }

  /** Nombre d'empreintes à afficher selon la symétrie. */
  static miroirs(symetrie) {
    switch (symetrie) {
      case 'x': return [[1, 1], [-1, 1]];
      case 'y': return [[1, 1], [1, -1]];
      case 'xy': return [[1, 1], [-1, 1], [1, -1], [-1, -1]];
      default: return [[1, 1]];
    }
  }

  placer(event) {
    const etat = this.lire?.();
    if (!etat || !OUTILS_DESSINANTS.has(etat.outil)) return this.cacher();

    const boite = this.artWrap.getBoundingClientRect();
    if (boite.width <= 0) return this.cacher();
    const pxParCm = boite.width / etat.largeurCm;
    const { a, b } = brushAxes(etat.rayonCm, etat.elongation);
    const angle = etat.suitLeTrace ? etat.angleTrace || 0 : etat.angleDeg || 0;

    // Position du pointeur dans le repère de l'œuvre, puis en centimètres pour
    // pouvoir miroiter autour du centre du panneau.
    const xPx = event.clientX - boite.left;
    const yPx = event.clientY - boite.top;
    const xCm = xPx / pxParCm - etat.largeurCm / 2;
    const yCm = yPx / pxParCm - etat.hauteurCm / 2;

    const miroirs = BrushCursor.miroirs(etat.symetrie);
    this.ajuster(miroirs.length);

    miroirs.forEach(([sx, sy], i) => {
      const el = this.empreintes[i];
      const gx = (sx * xCm + etat.largeurCm / 2) * pxParCm;
      const gy = (sy * yCm + etat.hauteurCm / 2) * pxParCm;
      // Un miroir retourne aussi l'orientation de l'ellipse.
      const angleMiroir = sx * sy < 0 ? -angle : angle;
      el.style.width = `${(2 * a * pxParCm).toFixed(1)}px`;
      el.style.height = `${(2 * b * pxParCm).toFixed(1)}px`;
      el.style.transform = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px) translate(-50%, -50%) rotate(${angleMiroir}deg)`;
      el.classList.toggle('mirror', i > 0);
    });

    if (!this.visible) {
      this.visible = true;
      this.hote.classList.add('show');
    }
    return undefined;
  }

  ajuster(n) {
    while (this.empreintes.length < n) {
      const el = document.createElement('span');
      el.className = 'brush-cursor-shape';
      this.hote.append(el);
      this.empreintes.push(el);
    }
    while (this.empreintes.length > n) this.empreintes.pop().remove();
  }

  cacher() {
    if (!this.visible) return;
    this.visible = false;
    this.hote.classList.remove('show');
  }

  destroy() {
    this.hote.remove();
  }
}
