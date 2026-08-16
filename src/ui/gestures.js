// Arbitrage des gestes (§22) — logique pure, sans aucune dépendance au DOM.
//
// Un mouvement a UNE seule signification. Le rôle est décidé au début du geste
// et verrouillé jusqu'à ce que TOUS les pointeurs soient relevés. Rien ne peut
// le changer en cours de route : ni un doigt supplémentaire, ni un stylet posé
// pendant un pinch.
//
// Priorité, dans l'ordre de §22 :
//   1. interaction avec l'interface
//   2. poignée de redimensionnement
//   3. deux doigts → navigation caméra
//   4. stylet sur l'œuvre → sculpture
//   5. glisser à l'extérieur → déplacement de la vue
//
// Ce module est écrit hors DOM pour une raison précise : les séquences adverses
// (stylet posé pendant un pinch, doigt levé hors de la toile, pinch amorcé sur
// une barre d'outils) se rejouent alors en test, à l'identique et sans navigateur.

export const ROLE = {
  NONE: 'none',
  UI: 'ui',
  RESIZE: 'resize',
  CAMERA: 'camera',
  SCULPT: 'sculpt',
  LIGHT: 'light',
  PAN: 'pan',
};

// Fenêtre d'arbitrage du TOUCHER seul : un doigt posé peut être le premier d'un
// pinch. On diffère la décision de quelques millisecondes en mémorisant les
// points, qui sont rejoués si le geste se révèle être une sculpture.
//
// Le stylet n'attend JAMAIS : il n'est pas ambigu, et retarder le Pencil de
// 70 ms se sentirait à chaque trait.
const TOUCH_ARBITRATION_MS = 70;

// Mais le temps n'est pas le seul juge : un doigt qui PART vite est un trait,
// pas le premier d'un pinch (dont les deux doigts se posent quasi immobiles).
// Dès ce déplacement franchi, la décision tombe sans attendre la fenêtre, et
// les points mémorisés sont rejoués avec leurs coordonnées d'origine — sinon un
// trait rapide au doigt perdrait son premier segment, donc sa forme.
const TOUCH_MOVE_THRESHOLD_PX = 8;

export class GestureManager {
  /**
   * @param {object} hooks
   *   hitTest(point) → 'ui' | 'resize' | 'canvas' | 'outside'
   *   onSculptStart/Move/End, onLightStart/Move, onCameraStart/Move,
   *   onResizeStart/Move/End, onPanStart/Move, onRoleChange — tous facultatifs
   *   activeTool() → nom de l'outil courant
   */
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.pointers = new Map();
    this.role = ROLE.NONE;
    this.primaryId = null;
    this.pending = null; // arbitrage tactile en cours
  }

  get pointerCount() {
    return this.pointers.size;
  }

  /** Vrai tant qu'un geste occupe l'atelier. */
  get busy() {
    return this.role !== ROLE.NONE || this.pending !== null;
  }

  setRole(role) {
    if (this.role === role) return;
    this.role = role;
    this.hooks.onRoleChange?.(role);
  }

  pointerDown(p) {
    this.pointers.set(p.id, { ...p });

    // Rôle déjà verrouillé : le pointeur est enregistré — il faut bien le voir
    // partir — mais il ne change rien. C'est tout le sens de §22.
    if (this.role !== ROLE.NONE) {
      if (this.role === ROLE.CAMERA && this.pointers.size === 2) this.startCamera();
      return this.role;
    }

    // Arbitrage tactile en cours : un second doigt tranche pour la caméra.
    if (this.pending) {
      if (p.type === 'touch' && this.pointers.size >= 2) {
        this.pending = null;
        this.setRole(ROLE.CAMERA);
        this.startCamera();
        return this.role;
      }
      return ROLE.NONE;
    }

    const zone = this.hooks.hitTest?.(p) ?? 'canvas';

    if (zone === 'ui') {
      this.setRole(ROLE.UI);
      return this.role;
    }

    if (zone === 'resize') {
      this.primaryId = p.id;
      this.setRole(ROLE.RESIZE);
      this.hooks.onResizeStart?.(p);
      return this.role;
    }

    // Stylet et souris ne sont jamais ambigus : décision immédiate.
    if (p.type === 'pen' || p.type === 'mouse') {
      this.primaryId = p.id;
      if (zone === 'outside') {
        this.setRole(ROLE.PAN);
        this.hooks.onPanStart?.(p);
      } else {
        this.beginCanvasRole(p);
      }
      return this.role;
    }

    // Doigt seul : décision différée, sans le moindre effet de bord entre-temps.
    //
    // L'attente vaut AUSSI hors de l'œuvre. Elle ne couvrait d'abord que la
    // toile, si bien qu'en vue 3D — où tout glisser est une orbite — le premier
    // doigt verrouillait « orbite » avant l'arrivée du second : le pinch ne
    // pouvait jamais se former. Un doigt posé n'importe où peut être le premier
    // d'un pinch.
    this.pending = { id: p.id, startedAt: p.time, zone, samples: [p] };
    return ROLE.NONE;
  }

  pointerMove(p) {
    const known = this.pointers.get(p.id);
    if (!known) return this.role;
    Object.assign(known, p);

    if (this.pending && this.pending.id === p.id) {
      this.pending.samples.push(p);
      const origin = this.pending.samples[0];
      const travel = Math.hypot(p.x - origin.x, p.y - origin.y);
      // Le déplacement tranche avant le temps : un doigt qui file est un trait.
      // Sinon le temps tranche : passé la fenêtre, un doigt isolé sculpte.
      if (travel >= TOUCH_MOVE_THRESHOLD_PX || p.time - this.pending.startedAt >= TOUCH_ARBITRATION_MS) {
        this.resolvePending();
      }
      return this.role;
    }

    switch (this.role) {
      case ROLE.SCULPT:
        if (p.id === this.primaryId) this.hooks.onSculptMove?.(p);
        break;
      case ROLE.LIGHT:
        if (p.id === this.primaryId) this.hooks.onLightMove?.(p);
        break;
      case ROLE.RESIZE:
        if (p.id === this.primaryId) this.hooks.onResizeMove?.(p);
        break;
      case ROLE.PAN:
        if (p.id === this.primaryId) this.hooks.onPanMove?.(p);
        break;
      case ROLE.CAMERA:
        this.hooks.onCameraMove?.(this.twoPointerState());
        break;
      default:
        break;
    }
    return this.role;
  }

  pointerUp(p) {
    const wasPending = this.pending && this.pending.id === p.id;
    this.pointers.delete(p.id);

    // Un doigt relevé avant la fin de l'arbitrage : c'était une tape brève.
    // Elle vaut geste de sculpture, sinon un point posé au doigt ne marquerait
    // jamais rien.
    if (wasPending) {
      this.resolvePending();
    }

    if (this.role === ROLE.SCULPT && p.id === this.primaryId) this.hooks.onSculptEnd?.(p);
    if (this.role === ROLE.RESIZE && p.id === this.primaryId) this.hooks.onResizeEnd?.(p);

    // Le rôle ne se libère QUE lorsque plus aucun pointeur n'est actif.
    // C'est ce qui garantit le retour à l'état neutre, y compris quand un doigt
    // se lève hors de la toile — à condition que l'appelant transmette bien les
    // fins de geste depuis la fenêtre, jamais depuis l'élément.
    if (this.pointers.size === 0) {
      this.primaryId = null;
      this.pending = null;
      this.setRole(ROLE.NONE);
    }
    return this.role;
  }

  /**
   * Annulation système d'UN pointeur — appel entrant, geste système iOS.
   * Safari l'envoie en plein trait. Ce qui a été sculpté avant l'interruption a
   * réellement eu lieu et reste : le trait se termine proprement, avec une seule
   * entrée d'annulation, celle posée à son ouverture. Ne rien terminer laisserait
   * un trait ouvert pour toujours ; tout défaire perdrait un geste volontaire.
   */
  pointerCancel(p) {
    const wasPending = this.pending && this.pending.id === p.id;
    this.pointers.delete(p.id);
    if (wasPending) {
      // Rien n'a encore été appliqué : aucun rôle n'a été pris, donc rien à clore.
      this.pending = null;
    } else {
      if (this.role === ROLE.SCULPT && p.id === this.primaryId) this.hooks.onSculptEnd?.({ ...p, cancelled: true });
      if (this.role === ROLE.RESIZE && p.id === this.primaryId) this.hooks.onResizeEnd?.({ ...p, cancelled: true });
    }
    if (this.pointers.size === 0) {
      this.primaryId = null;
      this.pending = null;
      this.setRole(ROLE.NONE);
    }
    return this.role;
  }

  /** Perte de tous les pointeurs (changement d'onglet, perte de focus). */
  cancelAll() {
    if (this.role === ROLE.SCULPT) this.hooks.onSculptEnd?.(null);
    this.pointers.clear();
    this.pending = null;
    this.primaryId = null;
    this.setRole(ROLE.NONE);
  }

  resolvePending() {
    if (!this.pending) return;
    const { samples, zone } = this.pending;
    this.pending = null;
    const first = samples[0];
    this.primaryId = first.id;
    if (zone === 'outside') {
      this.setRole(ROLE.PAN);
      this.hooks.onPanStart?.(first);
      for (let i = 1; i < samples.length; i++) this.hooks.onPanMove?.(samples[i]);
      return;
    }
    this.beginCanvasRole(first);
    // Les points retenus pendant l'arbitrage sont rejoués : le trait démarre
    // bien là où le doigt s'est posé, sans latence perceptible.
    if (this.role === ROLE.SCULPT) for (let i = 1; i < samples.length; i++) this.hooks.onSculptMove?.(samples[i]);
    else if (this.role === ROLE.LIGHT) for (let i = 1; i < samples.length; i++) this.hooks.onLightMove?.(samples[i]);
  }

  beginCanvasRole(p) {
    const tool = this.hooks.activeTool?.() ?? 'light';
    if (tool === 'light') {
      this.setRole(ROLE.LIGHT);
      this.hooks.onLightStart?.(p);
    } else {
      this.setRole(ROLE.SCULPT);
      this.hooks.onSculptStart?.(p);
    }
  }

  startCamera() {
    const state = this.twoPointerState();
    if (state) this.hooks.onCameraStart?.(state);
  }

  /** Distance et centre des deux premiers pointeurs — base du pinch. */
  twoPointerState() {
    const list = [...this.pointers.values()].slice(0, 2);
    if (list.length < 2) return null;
    const [a, b] = list;
    return {
      centerX: (a.x + b.x) / 2,
      centerY: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }
}
