// Mode Benito — l'atelier réduit à l'œuvre et à la main qui la sculpte.
//
// Tout ce qui n'est pas l'œuvre disparaît : titre, menus, onglets, colonne de
// projet, boutique d'effets, inspecteur, panneau du bas, fil d'Ariane, pied de
// page. Il reste la barre d'outils complète, repliable, et une petite palette
// flottante qui ne porte que les quatre commandes dont on se sert vraiment en
// sculptant : creuser, bomber, taille, force.
//
// LA PALETTE FLOTTANTE EST UNE RÉCIDIVE ASSUMÉE. `src/ui/dock.js` faisait cela
// et a été supprimé au lot 9 pour deux défauts précis, tous deux évitables :
//
//   1. Il positionnait par `top` et `left`. La règle « mouvement réduit »
//      posait `transition-duration: .01ms !important` sur `*` avec
//      `transition-property: all` par défaut, donc `top` et `left` devenaient
//      transitionnables : chaque placement lançait deux transitions que Chrome
//      laissait « running » sans les appliquer. Mesuré à l'époque : barre
//      écrite à 381 px, rendue à 615 px, et une écriture ultérieure sans le
//      moindre effet à l'écran.
//      ICI ON POSITIONNE PAR `transform`. Aucune transition n'est déclarée
//      dessus, et `transform` ne déclenche pas de recalcul de mise en page.
//
//   2. Il ne recadrait pas au redimensionnement, si bien qu'une palette posée
//      en bas à droite d'un grand écran devenait inatteignable sur un petit.
//      ICI `contraindre` est une fonction PURE, éprouvée hors DOM par
//      `tests/benito.mjs`, appelée au dépôt ET à chaque changement de taille.
//
// La position est rangée dans `project.ui.paletteXY`, en pixels depuis le coin
// haut-gauche de la fenêtre.

/**
 * Ramène une position dans la fenêtre.
 *
 * PURE, ET C'EST LE POINT. Le défaut de `dock.js` n'était pas dans son écoute
 * du pointeur mais dans son arithmétique ; une arithmétique sans DOM se vérifie
 * sans navigateur. Même choix que l'arbitre de gestes du lot 3.
 *
 * @param {{x:number,y:number}} position  coin haut-gauche voulu
 * @param {{w:number,h:number}} taille    taille de la palette
 * @param {{w:number,h:number}} fenetre   surface disponible
 * @param {number} marge                  garde minimale contre les bords
 */
export function contraindre(position, taille, fenetre, marge = 8) {
  const fini = (v, repli) => (Number.isFinite(v) ? v : repli);
  const w = Math.max(0, fini(taille.w, 0));
  const h = Math.max(0, fini(taille.h, 0));
  // Une palette plus large que la fenêtre ne peut pas respecter les deux
  // marges : on privilégie le bord gauche, qui est celui par lequel on la
  // rattrape. Sans ce cas, `Math.min(max, …)` avec max négatif renvoyait la
  // palette hors écran par la gauche — exactement le défaut qu'on répare.
  const maxX = Math.max(marge, fenetre.w - w - marge);
  const maxY = Math.max(marge, fenetre.h - h - marge);
  return {
    x: Math.min(maxX, Math.max(marge, fini(position.x, marge))),
    y: Math.min(maxY, Math.max(marge, fini(position.y, marge))),
  };
}

/** Position de départ : en bas à gauche de la zone utile, hors des barres. */
export function positionParDefaut(fenetre, taille) {
  return contraindre({ x: 24, y: fenetre.h - taille.h - 96 }, taille, fenetre);
}

export class ModeBenito {
  /**
   * @param {HTMLElement} root  racine de l'atelier
   * @param {object} options
   *   lire()          — rend le projet courant
   *   onOutil(nom)    — bascule d'outil (délègue au bouton existant)
   *   onEtat()        — appelé après chaque changement, pour l'enregistrement
   *   onPrompt()      — ouvre le mode prompt
   *   signal          — abandon de l'atelier
   */
  constructor(root, { lire, onEtat, onPrompt, signal } = {}) {
    this.root = root;
    this.lire = lire;
    this.onEtat = onEtat;
    this.onPrompt = onPrompt;
    this.opts = signal ? { signal } : {};
    this.actif = false;
    this.glisse = null;

    this.construirePalette();
    this.brancherRecadrage();
  }

  // ---- Palette flottante ----

  construirePalette() {
    const palette = document.createElement('div');
    palette.className = 'palette';
    palette.id = 'palette';
    palette.hidden = true;
    palette.setAttribute('role', 'group');
    palette.setAttribute('aria-label', 'Palette rapide');
    palette.innerHTML = `
      <span class="palette-grip" data-palette-grip aria-hidden="true">⣿</span>
      <div class="palette-tools">
        <button class="tool" type="button" data-palette-tool="dig"><span class="tool-icon" aria-hidden="true">◡</span>Creuser</button>
        <button class="tool" type="button" data-palette-tool="raise"><span class="tool-icon" aria-hidden="true">◠</span>Bomber</button>
      </div>
      <label class="tool-slider" for="paletteSize">Taille <output class="tool-slider-value" aria-hidden="true" data-palette-size-value></output><input type="range" id="paletteSize" min="2" max="80" step="1"></label>
      <label class="tool-slider" for="paletteStrength">Force <output class="tool-slider-value" aria-hidden="true" data-palette-strength-value></output><input type="range" id="paletteStrength" min="10" max="100" step="1"></label>
      <button class="btn btn-compact palette-prompt" type="button" data-palette-prompt>Mode Prompt</button>`;
    this.root.append(palette);
    this.palette = palette;

    // LES COMMANDES CLIQUENT LES COMMANDES EXISTANTES.
    //
    // Même règle que la barre de menus : la palette n'a aucune logique propre,
    // donc elle ne peut pas diverger de l'atelier. Un outil qui change de
    // comportement change partout à la fois, ou nulle part.
    palette.querySelectorAll('[data-palette-tool]').forEach((b) => {
      b.addEventListener('click', () => {
        this.root.querySelector(`.tool[data-tool="${b.dataset.paletteTool}"]`)?.click();
        this.syncOutils();
      }, this.opts);
    });
    const relayer = (source, cible) => {
      const origine = this.root.querySelector(cible);
      source.addEventListener('input', () => {
        if (!origine) return;
        origine.value = source.value;
        origine.dispatchEvent(new Event('input', { bubbles: true }));
        this.syncCurseurs();
      }, this.opts);
    };
    relayer(palette.querySelector('#paletteSize'), '#brushSize');
    relayer(palette.querySelector('#paletteStrength'), '#brushStrength');
    palette.querySelector('[data-palette-prompt]').addEventListener('click', () => this.onPrompt?.(), this.opts);

    this.brancherGlissement(palette.querySelector('[data-palette-grip]'));
  }

  brancherGlissement(poignee) {
    poignee.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      const boite = this.palette.getBoundingClientRect();
      this.glisse = { id: e.pointerId, dx: e.clientX - boite.left, dy: e.clientY - boite.top };
      this.palette.classList.add('palette--glisse');
      try { poignee.setPointerCapture(e.pointerId); } catch (_) { /* confort */ }
    }, this.opts);

    poignee.addEventListener('pointermove', (e) => {
      if (!this.glisse || this.glisse.id !== e.pointerId) return;
      e.preventDefault();
      this.placer({ x: e.clientX - this.glisse.dx, y: e.clientY - this.glisse.dy });
    }, this.opts);

    const fin = (e) => {
      if (!this.glisse || this.glisse.id !== e.pointerId) return;
      this.glisse = null;
      this.palette.classList.remove('palette--glisse');
      this.enregistrerPosition();
    };
    poignee.addEventListener('pointerup', fin, this.opts);
    poignee.addEventListener('pointercancel', fin, this.opts);
  }

  /** Écrit la position, toujours contrainte. Jamais `top`/`left` : `transform`. */
  placer(position) {
    const boite = this.palette.getBoundingClientRect();
    const p = contraindre(position, { w: boite.width, h: boite.height }, { w: innerWidth, h: innerHeight });
    this.position = p;
    this.palette.style.transform = `translate3d(${Math.round(p.x)}px, ${Math.round(p.y)}px, 0)`;
  }

  brancherRecadrage() {
    // Une palette posée en bas à droite d'un grand écran doit rester
    // attrapable sur un petit. `dock.js` ne le faisait pas.
    addEventListener('resize', () => {
      if (this.actif && this.position) this.placer(this.position);
    }, this.opts);
  }

  enregistrerPosition() {
    const project = this.lire?.();
    if (project && this.position) {
      project.ui.paletteXY = { x: Math.round(this.position.x), y: Math.round(this.position.y) };
      this.onEtat?.();
    }
  }

  // ---- Le mode lui-même ----

  activer(oui) {
    this.actif = !!oui;
    this.root.classList.toggle('benito', this.actif);
    this.palette.hidden = !this.actif;
    this.root.querySelector('#benitoToggle')?.setAttribute('aria-pressed', String(this.actif));

    if (this.actif) {
      const project = this.lire?.();
      const boite = this.palette.getBoundingClientRect();
      const taille = { w: boite.width || 260, h: boite.height || 120 };
      const memorisee = project?.ui?.paletteXY;
      this.placer(memorisee || positionParDefaut({ w: innerWidth, h: innerHeight }, taille));
      this.syncOutils();
      this.syncCurseurs();
    }
    const project = this.lire?.();
    if (project) project.ui.benito = this.actif;
    this.onEtat?.();
  }

  basculer() {
    this.activer(!this.actif);
  }

  /** L'outil actif de la palette suit celui de l'atelier, et non l'inverse. */
  syncOutils() {
    const actif = this.lire?.()?.ui?.activeTool;
    this.palette.querySelectorAll('[data-palette-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.paletteTool === actif);
    });
  }

  syncCurseurs() {
    const taille = this.root.querySelector('#brushSize');
    const force = this.root.querySelector('#brushStrength');
    const pt = this.palette.querySelector('#paletteSize');
    const pf = this.palette.querySelector('#paletteStrength');
    if (taille && pt) {
      pt.value = taille.value;
      this.palette.querySelector('[data-palette-size-value]').value = `${taille.value} cm`;
      pt.style.setProperty('--range', `${((Number(pt.value) - 2) / 78) * 100}%`);
    }
    if (force && pf) {
      pf.value = force.value;
      this.palette.querySelector('[data-palette-strength-value]').value = `${force.value} %`;
      pf.style.setProperty('--range', `${((Number(pf.value) - 10) / 90) * 100}%`);
    }
  }

  sync() {
    if (!this.actif) return;
    this.syncOutils();
    this.syncCurseurs();
  }

  destroy() {
    this.root.classList.remove('benito');
    this.palette?.remove();
  }
}
