// Vue : zoom et déplacement de la caméra (§11).
//
// Distinction qui ne doit jamais se brouiller : le zoom regarde l'œuvre de plus
// près, il ne change AUCUNE dimension physique. Redimensionner le panneau, c'est
// la poignée (§3), et c'est un autre geste, un autre rôle, un autre effet.
//
// La transformation est posée sur l'élément de l'œuvre lui-même. Conséquence
// utile : `getBoundingClientRect()` renvoie déjà la boîte transformée, donc la
// conversion pointeur → centimètres reste exactement celle d'avant le zoom.

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 6;

export class Viewport {
  constructor(element, stage, { onChange } = {}) {
    this.element = element;
    this.stage = stage;
    this.onChange = onChange;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.gesture = null;
  }

  set(zoom, panX, panY) {
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.panX = panX;
    this.panY = panY;
    this.apply();
  }

  reset() {
    this.set(1, 0, 0);
  }

  apply() {
    const { zoom, panX, panY } = this;
    this.element.style.transform = `translate(${panX.toFixed(2)}px, ${panY.toFixed(2)}px) scale(${zoom.toFixed(4)})`;
    // Exposé en variable CSS : les éléments qui ne doivent PAS grossir avec le
    // zoom (poignée de redimensionnement, étiquette de cotes) s'appliquent
    // l'échelle inverse.
    this.element.style.setProperty('--zoom', String(zoom));
    this.onChange?.(this);
  }

  /** Centre de l'élément non transformé, en coordonnées écran. */
  centerScreen() {
    const stageRect = this.stage.getBoundingClientRect();
    return { x: stageRect.left + stageRect.width / 2, y: stageRect.top + stageRect.height / 2 };
  }

  /** Point du contenu (repère non transformé) situé sous un point écran. */
  contentAt(screenX, screenY) {
    const c = this.centerScreen();
    return {
      x: (screenX - c.x - this.panX) / this.zoom,
      y: (screenY - c.y - this.panY) / this.zoom,
    };
  }

  // ---- Pinch ----

  beginPinch(state) {
    this.gesture = {
      startZoom: this.zoom,
      startDistance: Math.max(1, state.distance),
      // Le point du CONTENU saisi entre les deux doigts. C'est lui qui doit
      // rester sous les doigts pendant tout le geste — sans cette ancre, l'œuvre
      // fuit sous la main dès que l'on zoome ailleurs qu'au centre exact.
      anchor: this.contentAt(state.centerX, state.centerY),
    };
  }

  updatePinch(state) {
    if (!this.gesture || !state) return;
    const { startZoom, startDistance, anchor } = this.gesture;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (startZoom * state.distance) / startDistance));
    const c = this.centerScreen();
    // On repose l'ancre exactement sous le centre courant des deux doigts.
    this.zoom = zoom;
    this.panX = state.centerX - c.x - anchor.x * zoom;
    this.panY = state.centerY - c.y - anchor.y * zoom;
    this.apply();
  }

  endPinch() {
    this.gesture = null;
  }

  // ---- Déplacement à un pointeur (glisser hors de l'œuvre) ----

  beginPan(p) {
    this.gesture = { startPanX: this.panX, startPanY: this.panY, startX: p.x, startY: p.y };
  }

  updatePan(p) {
    if (!this.gesture) return;
    this.panX = this.gesture.startPanX + (p.x - this.gesture.startX);
    this.panY = this.gesture.startPanY + (p.y - this.gesture.startY);
    this.apply();
  }

  endPan() {
    this.gesture = null;
  }

  serialize() {
    return { zoom: this.zoom, panX: this.panX, panY: this.panY };
  }

  restore(state) {
    if (!state) return;
    this.set(state.zoom ?? 1, state.panX ?? 0, state.panY ?? 0);
  }
}

export { MIN_ZOOM, MAX_ZOOM };
