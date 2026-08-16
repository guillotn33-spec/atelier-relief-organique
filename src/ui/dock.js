// Barres flottantes et aimantées (§14, §15).
//
// Un même comportement sert la barre principale et la mini-palette : glisser par
// une poignée dédiée, s'aimanter aux bords de la toile ou de l'écran, se
// détacher, se réduire, et retrouver sa place à la réouverture du projet.
//
// La poignée est le SEUL point de saisie. C'est ce qui garantit §14 « ne jamais
// déclencher une sculpture lorsque l'utilisateur déplace la barre » : le reste
// de la barre garde ses boutons cliquables, et l'œuvre ne voit jamais ces
// pointeurs — l'arbitre de gestes les classe « interface ».

const SNAP_PX = 46;
const MARGIN = 12;

/** Cibles d'aimantation : les quatre bords de la toile, puis ceux de l'écran. */
function snapTargets(artRect) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const targets = [
    { edge: 'screen-top', x: w / 2, y: MARGIN, axis: 'y' },
    { edge: 'screen-bottom', x: w / 2, y: h - MARGIN, axis: 'y' },
    { edge: 'screen-left', x: MARGIN, y: h / 2, axis: 'x' },
    { edge: 'screen-right', x: w - MARGIN, y: h / 2, axis: 'x' },
  ];
  if (artRect && artRect.width > 0) {
    targets.push(
      { edge: 'canvas-top', x: artRect.left + artRect.width / 2, y: artRect.top + MARGIN, axis: 'y' },
      { edge: 'canvas-bottom', x: artRect.left + artRect.width / 2, y: artRect.bottom - MARGIN, axis: 'y' },
      { edge: 'canvas-left', x: artRect.left + MARGIN, y: artRect.top + artRect.height / 2, axis: 'x' },
      { edge: 'canvas-right', x: artRect.right - MARGIN, y: artRect.top + artRect.height / 2, axis: 'x' }
    );
  }
  return targets;
}

export class Dock {
  /**
   * @param {HTMLElement} element  la barre
   * @param {object} options
   *   handle       — élément de saisie (obligatoire)
   *   collapseBtn  — bouton réduire/rouvrir (facultatif)
   *   artWrap      — élément de l'œuvre, pour l'aimantation à la toile
   *   state        — état mémorisé, ou null
   *   onPersist(state)
   */
  constructor(element, { handle, collapseBtn, artWrap, state, onPersist } = {}) {
    this.element = element;
    this.handle = handle;
    this.artWrap = artWrap;
    this.onPersist = onPersist;
    this.state = {
      mode: 'snap',
      edge: 'canvas-bottom',
      x: 0,
      y: 0,
      collapsed: false,
      visible: true,
      ...(state || {}),
    };
    this.drag = null;

    this.guide = document.createElement('div');
    this.guide.className = 'dock-guide';
    this.guide.hidden = true;
    document.body.append(this.guide);

    if (this.handle) {
      this.handle.addEventListener('pointerdown', (e) => this.onHandleDown(e));
      this.handle.style.touchAction = 'none';
    }
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        this.state.collapsed = !this.state.collapsed;
        this.apply();
        this.persist();
      });
    }

    // La barre est en position fixe, la toile défile : sans réancrage au
    // défilement, une barre aimantée à un bord de la TOILE s'en détacherait dès
    // le premier mouvement de page.
    // Ces deux écouteurs vivent sur `window` et survivent au retrait du nœud de
    // la barre : sans `destroy`, chaque changement de projet en laissait quatre
    // de plus — deux par barre — plus le guide d'aimantation ajouté au `body`.
    this.onWindowChange = () => this.apply();
    window.addEventListener('resize', this.onWindowChange);
    window.addEventListener('scroll', this.onWindowChange, { passive: true });

    // La barre suit l'ŒUVRE, pas elle-même.
    //
    // Une barre aimantée à un bord de la toile doit suivre ce bord. Depuis que
    // l'œuvre est recadrée après la première mise en page, la barre s'accrochait
    // au bas d'une œuvre encore trop haute, se faisait rabattre contre le bas de
    // la fenêtre — et n'en repartait jamais. Mesuré : barre à 615 px alors que
    // le bas de l'œuvre était à 483.
    //
    // NE PAS S'OBSERVER SOI-MÊME. Cela a été essayé, pour rattraper les
    // variations tardives de sa propre hauteur, et cela FIGE LA PAGE : la barre
    // est en position fixe sans largeur explicite, sa largeur utilisable vaut
    // « fenêtre − left », donc écrire `left` change sa taille, ce qui relance
    // l'observateur, qui réécrit `left`. La boucle est immédiate. Les
    // variations tardives de hauteur sont traitées là où on les connaît : par
    // un replacement explicite après le remplissage des libellés.
    this.sizeObserver = new ResizeObserver(() => this.apply());
    if (this.artWrap) this.sizeObserver.observe(this.artWrap);
    this.apply();
  }

  destroy() {
    window.removeEventListener('resize', this.onWindowChange);
    window.removeEventListener('scroll', this.onWindowChange, { passive: true });
    this.sizeObserver?.disconnect();
    this.guide.remove();
  }

  setVisible(visible) {
    this.state.visible = visible;
    this.apply();
    this.persist();
  }

  persist() {
    this.onPersist?.({ ...this.state });
  }

  apply() {
    const el = this.element;
    el.hidden = !this.state.visible;
    el.classList.toggle('dock--collapsed', !!this.state.collapsed);
    if (!this.state.visible) return;

    const rect = el.getBoundingClientRect();
    let left;
    let top;

    if (this.state.mode === 'snap') {
      const target = snapTargets(this.artWrap?.getBoundingClientRect()).find((t) => t.edge === this.state.edge);
      if (target) {
        left = target.x - rect.width / 2;
        top = target.y - rect.height / 2;
        // Sur un bord, la barre s'aligne dessus au lieu de le chevaucher.
        if (target.edge.endsWith('top')) top = target.y;
        if (target.edge.endsWith('bottom')) top = target.y - rect.height;
        if (target.edge.endsWith('left')) left = target.x;
        if (target.edge.endsWith('right')) left = target.x - rect.width;
      }
    }
    if (left === undefined) {
      left = this.state.x;
      top = this.state.y;
    }

    // Toujours ramenée dans l'écran : une barre perdue hors cadre serait
    // irrécupérable au doigt.
    left = Math.min(window.innerWidth - rect.width - 4, Math.max(4, left));
    top = Math.min(window.innerHeight - rect.height - 4, Math.max(4, top));
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  onHandleDown(event) {
    event.preventDefault();
    event.stopPropagation();
    const rect = this.element.getBoundingClientRect();
    this.drag = {
      id: event.pointerId,
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
    };
    try {
      this.handle.setPointerCapture(event.pointerId);
    } catch (_) {
      /* la capture est un confort */
    }
    this.element.classList.add('dock--dragging');

    const move = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      e.preventDefault();
      const left = e.clientX - this.drag.dx;
      const top = e.clientY - this.drag.dy;
      this.element.style.left = `${Math.round(left)}px`;
      this.element.style.top = `${Math.round(top)}px`;
      this.previewSnap(left, top);
    };

    const up = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.element.classList.remove('dock--dragging');
      this.guide.hidden = true;
      const left = e.clientX - this.drag.dx;
      const top = e.clientY - this.drag.dy;
      this.drag = null;
      this.commit(left, top);
    };

    // Écoutés sur la FENÊTRE : une barre lâchée hors de l'écran doit quand même
    // terminer son déplacement.
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Cible d'aimantation la plus proche, ou null. */
  nearestTarget(left, top) {
    const rect = this.element.getBoundingClientRect();
    const cx = left + rect.width / 2;
    const cy = top + rect.height / 2;
    let best = null;
    for (const target of snapTargets(this.artWrap?.getBoundingClientRect())) {
      // Sur un bord horizontal seule la distance verticale compte, et l'inverse
      // sur un bord vertical : on s'aimante à un BORD, pas à un point.
      const distance = target.axis === 'y' ? Math.abs(cy - target.y) : Math.abs(cx - target.x);
      if (distance <= SNAP_PX && (!best || distance < best.distance)) best = { ...target, distance };
    }
    return best;
  }

  previewSnap(left, top) {
    const target = this.nearestTarget(left, top);
    if (!target) {
      this.guide.hidden = true;
      this.element.classList.remove('dock--will-snap');
      return;
    }
    this.element.classList.add('dock--will-snap');
    const artRect = this.artWrap?.getBoundingClientRect();
    const horizontal = target.axis === 'y';
    Object.assign(this.guide.style, {
      left: horizontal ? `${target.edge.startsWith('canvas') ? artRect.left : 0}px` : `${target.x}px`,
      top: horizontal ? `${target.y}px` : `${target.edge.startsWith('canvas') ? artRect.top : 0}px`,
      width: horizontal ? `${target.edge.startsWith('canvas') ? artRect.width : window.innerWidth}px` : '2px',
      height: horizontal ? '2px' : `${target.edge.startsWith('canvas') ? artRect.height : window.innerHeight}px`,
    });
    this.guide.hidden = false;
  }

  commit(left, top) {
    const target = this.nearestTarget(left, top);
    this.element.classList.remove('dock--will-snap');
    if (target) {
      this.state.mode = 'snap';
      this.state.edge = target.edge;
    } else {
      this.state.mode = 'float';
      this.state.x = left;
      this.state.y = top;
    }
    this.apply();
    this.persist();
  }
}
