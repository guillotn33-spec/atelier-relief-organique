// Interactions de l’espace de composition professionnel.
//
// Cette couche ne possède aucun réglage artistique : les molettes pilotent les
// mêmes <input type="range"> que l’inspecteur. Le moteur, la persistance et les
// tests restent donc la source de vérité unique.

const clone = (value) => JSON.parse(JSON.stringify(value));

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function quantize(value, min, step) {
  const snapped = min + Math.round((value - min) / step) * step;
  return Number(snapped.toFixed(6));
}

/**
 * Minuscules SANS accents, pour la recherche.
 *
 * `toLocaleLowerCase` seul laissait « alveole » sans réponse alors que
 * « Alvéoles » est au catalogue, et « erosion » sans réponse pour « Érosion
 * progressive ». Or c'est exactement ainsi que l'on tape dans un champ de
 * recherche. La décomposition NFD sépare la lettre de son accent, que la classe
 * des diacritiques combinants retire ensuite.
 */
function replierAccents(texte) {
  return texte.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('fr');
}

export class ProWorkspace {
  constructor(root, { lire, onRestoreVariation, onWorkspaceMode, onApplyEffect, onVaryEffect } = {}) {
    this.root = root;
    this.lire = lire;
    this.onRestoreVariation = onRestoreVariation;
    this.onWorkspaceMode = onWorkspaceMode;
    this.onApplyEffect = onApplyEffect;
    // Rend `true` si l'effet actif a su varier tout seul, `false` sinon — auquel
    // cas la variation géométrique prend le relais.
    this.onVaryEffect = onVaryEffect;
    const savedVariations = lire?.()?.ui?.variationSnapshots;
    this.variations = Array.isArray(savedVariations) ? clone(savedVariations).slice(-8) : [];
    this.drag = null;
    this.controller = new AbortController();
    this.signal = this.controller.signal;

    this.bindKnobs();
    this.bindWorkspaceTabs();
    this.bindBottomPanel();
    this.bindInspectorNavigation();
    this.bindHistory();
    this.bindEffectStore();
    if (this.variations.length) this.renderVariations();
    else this.recordVariation('Point de départ');
    this.sync();
  }

  bindKnobs() {
    this.root.querySelectorAll('.param-knob[data-control]').forEach((knob) => {
      const input = this.root.querySelector(`#${knob.dataset.control}`);
      if (!input) return;

      input.addEventListener('input', () => {
        this.syncKnob(knob, input);
        this.syncValueTracks();
      }, { signal: this.signal });

      knob.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const min = Number(input.min);
        const max = Number(input.max);
        this.drag = {
          knob,
          input,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startValue: Number(input.value),
          min,
          max,
          step: Number(input.step) || 1,
        };
        knob.classList.add('dragging');
        try { knob.setPointerCapture(event.pointerId); } catch (_) { /* confort */ }
      }, { signal: this.signal });

      knob.addEventListener('pointermove', (event) => {
        const drag = this.drag;
        if (!drag || drag.knob !== knob || drag.pointerId !== event.pointerId) return;
        event.preventDefault();
        // Haut et droite augmentent ; bas et gauche diminuent. Les deux axes
        // s’additionnent, ce qui rend la molette naturelle à la souris comme au
        // stylet sans imposer une direction de geste.
        const deltaPx = (drag.startY - event.clientY) + (event.clientX - drag.startX);
        const sensitivity = event.shiftKey ? 640 : 180;
        const raw = drag.startValue + (deltaPx / sensitivity) * (drag.max - drag.min);
        this.setInput(input, quantize(clamp(raw, drag.min, drag.max), drag.min, drag.step));
      }, { signal: this.signal });

      const end = (event) => {
        if (!this.drag || this.drag.knob !== knob || this.drag.pointerId !== event.pointerId) return;
        knob.classList.remove('dragging');
        this.drag = null;
      };
      knob.addEventListener('pointerup', end, { signal: this.signal });
      knob.addEventListener('pointercancel', end, { signal: this.signal });

      knob.addEventListener('wheel', (event) => {
        event.preventDefault();
        const step = (Number(input.step) || 1) * (event.shiftKey ? 0.25 : 1);
        const direction = event.deltaY < 0 ? 1 : -1;
        this.setInput(input, clamp(Number(input.value) + direction * step, Number(input.min), Number(input.max)));
      }, { passive: false, signal: this.signal });

      knob.addEventListener('keydown', (event) => {
        const min = Number(input.min);
        const max = Number(input.max);
        const step = Number(input.step) || 1;
        let next = Number(input.value);
        if (event.key === 'ArrowUp' || event.key === 'ArrowRight') next += step;
        else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') next -= step;
        else if (event.key === 'PageUp') next += step * 10;
        else if (event.key === 'PageDown') next -= step * 10;
        else if (event.key === 'Home') next = min;
        else if (event.key === 'End') next = max;
        else return;
        event.preventDefault();
        this.setInput(input, clamp(next, min, max));
      }, { signal: this.signal });
    });
  }

  setInput(input, value) {
    if (Number(input.value) === Number(value)) return;
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  syncKnob(knob, input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const ratio = max === min ? 0 : (value - min) / (max - min);
    const angle = -135 + ratio * 270;
    const dial = knob.querySelector('.knob-dial');
    dial?.style.setProperty('--knob-angle', `${angle.toFixed(2)}deg`);
    dial?.style.setProperty('--knob-progress', `${(ratio * 75).toFixed(2)}%`);

    const formatted = this.root.querySelector(`#${input.id}Value`);
    const output = knob.querySelector('.knob-value');
    if (output) output.value = formatted?.value || formatted?.textContent || input.value;
    // Ces attributs n'ont de sens que sur `role="slider"`, posé dans le
    // balisage : sur un `<button>` nu, un lecteur d'écran les ignore et
    // n'annonce jamais la valeur. Le clavier fonctionnait déjà — il ne manquait
    // que d'être audible.
    knob.setAttribute('aria-valuemin', input.min);
    knob.setAttribute('aria-valuemax', input.max);
    knob.setAttribute('aria-valuenow', input.value);
    knob.setAttribute('aria-valuetext', output?.value || input.value);
  }

  sync() {
    this.root.querySelectorAll('.param-knob[data-control]').forEach((knob) => {
      const input = this.root.querySelector(`#${knob.dataset.control}`);
      if (input) this.syncKnob(knob, input);
    });
    this.syncEffectStore();
    this.syncValueTracks();
  }

  syncValueTracks() {
    this.root.querySelectorAll('[data-linked-control]').forEach((control) => {
      const input = this.root.querySelector(`#${control.dataset.linkedControl}`);
      if (!input) return;
      const min = Number(input.min);
      const max = Number(input.max);
      const ratio = max === min ? 0 : clamp((Number(input.value) - min) / (max - min), 0, 1);
      const key = control.dataset.linkedControl;
      this.root.querySelectorAll(`[data-track-progress="${key}"]`).forEach((bar) => { bar.style.width = `${ratio * 100}%`; });
      this.root.querySelectorAll(`[data-track-node="${key}"]`).forEach((node) => { node.style.left = `${ratio * 100}%`; });
      const formatted = this.root.querySelector(`#${key}Value`);
      this.root.querySelectorAll(`[data-linked-value="${key}"]`).forEach((output) => {
        output.textContent = formatted?.value || formatted?.textContent || input.value;
      });
    });
  }

  bindEffectStore() {
    this.root.querySelectorAll('.effect-item[data-effect]').forEach((button) => {
      button.addEventListener('click', () => {
        this.root.querySelectorAll('.effect-item[data-effect]').forEach((item) => item.classList.toggle('active', item === button));
        this.onApplyEffect?.(button.dataset.effect);
      }, { signal: this.signal });
    });

    const search = this.root.querySelector('#effectSearch');
    // État de dépliage AVANT toute recherche. Sans lui, « Matières » et
    // « Éclairage » — fermées au chargement — restaient ouvertes une fois la
    // requête effacée : la recherche les avait dépliées et rien ne les
    // refermait. Le panneau ne revenait jamais à son état de repos.
    const ouvertAuRepos = new Map();
    this.root.querySelectorAll('.effect-category').forEach((c) => ouvertAuRepos.set(c, c.open));

    search?.addEventListener('input', () => {
      const query = replierAccents(search.value.trim());
      this.root.querySelectorAll('.effect-item, .prototype-category .preset-card').forEach((item) => {
        // Le `title` porte « nom — description » : chercher « rasante » ou
        // « alvéol » trouve donc aussi les articles dont seule la description le
        // dit. Le texte visible seul ne suffisait pas.
        const matiere = replierAccents(`${item.textContent} ${item.title || ''}`);
        item.hidden = query.length > 0 && !matiere.includes(query);
      });
      this.root.querySelectorAll('.effect-category').forEach((category) => {
        const articles = [...category.querySelectorAll('.effect-item, .preset-card')];
        const restants = articles.filter((item) => !item.hidden).length;
        category.hidden = query.length > 0 && restants === 0;
        // LE COMPTEUR SUIT LE FILTRE. Il annonçait le total du catalogue quoi
        // qu'il arrive : une recherche qui ne laissait qu'une matière affichait
        // toujours « 7 » en face d'un seul article visible.
        const compteur = category.querySelector('.category-count');
        if (compteur) compteur.textContent = String(query.length > 0 ? restants : articles.length);
        category.open = query.length > 0 ? restants > 0 : (ouvertAuRepos.get(category) ?? category.open);
      });
    }, { signal: this.signal });

    this.root.querySelector('#effectRandomize')?.addEventListener('click', () => {
      // Une FORME ou une RÉFÉRENCE varie par sa géométrie : c'est « Nouvelle
      // variation », le même geste et le même moteur. Une matière ou un
      // éclairage varie dans son propre bloc — voir `varyEffect`. Le bouton
      // déléguait tout au premier cas, y compris sur « Porcelaine », où il
      // secouait la composition sans rien changer à l'effet qu'il annonçait.
      if (this.onVaryEffect?.() === true) return;
      this.root.querySelector('#newVariation')?.click();
    }, { signal: this.signal });
  }

  syncEffectStore() {
    const project = this.lire?.();
    if (!project) return;
    // `activeEffectKey` peut être NUL, et ce n'est pas un défaut : une variation
    // fait descendre la composition d'un article sans qu'elle en soit encore un.
    // Le repli précédent sur « organic-relief » rallumait alors une vignette qui
    // ne correspondait plus à ce qui est rendu.
    const key = project.ui?.activeEffectKey || null;
    this.root.querySelectorAll('.effect-item[data-effect]').forEach((button) => button.classList.toggle('active', key !== null && button.dataset.effect === key));
    const name = this.root.querySelector('#activeEffectName');
    const category = this.root.querySelector('#activeEffectCategory');
    if (name) name.textContent = project.ui?.activeEffectName || project.ui?.designName || 'Composition';
    // `[data-effect]` et non `.effect-item[data-effect]` : les trois vignettes de
    // prototype portent désormais la clé de leur signature de référence, et sont
    // donc des entrées du catalogue à part entière.
    const selected = key === null ? null : this.root.querySelector(`[data-effect="${key}"]`)?.closest('[data-effect-category]');
    const type = selected?.dataset.effectCategory;
    if (category) {
      category.textContent = key === null ? 'Composition libre'
        : type === 'material' ? 'Matière'
          : type === 'lighting' ? 'Éclairage'
            : type === 'reference' ? 'Signature de référence'
              : 'Forme organique';
    }
  }

  bindWorkspaceTabs() {
    this.root.querySelectorAll('[data-workspace-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.root.querySelectorAll('[data-workspace-mode]').forEach((item) => {
          const actif = item === button;
          item.classList.toggle('active', actif);
          item.setAttribute('aria-current', actif ? 'page' : 'false');
        });
        this.onWorkspaceMode?.(button.dataset.workspaceMode);
      }, { signal: this.signal });
    });
  }

  bindBottomPanel() {
    const panel = this.root.querySelector('.bottom-panel');
    this.root.querySelectorAll('[data-bottom-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        const name = tab.dataset.bottomTab;
        panel?.classList.remove('collapsed');
        this.root.querySelectorAll('[data-bottom-tab]').forEach((item) => {
          const active = item === tab;
          item.classList.toggle('active', active);
          item.setAttribute('aria-selected', String(active));
        });
        this.root.querySelectorAll('[data-bottom-view]').forEach((view) => {
          const active = view.dataset.bottomView === name;
          view.classList.toggle('active', active);
          view.hidden = !active;
        });
      }, { signal: this.signal });
    });
    this.root.querySelector('[data-bottom-collapse]')?.addEventListener('click', () => panel?.classList.toggle('collapsed'), { signal: this.signal });
    this.root.querySelectorAll('[data-linked-control]').forEach((control) => {
      control.addEventListener('click', () => {
        const input = this.root.querySelector(`#${control.dataset.linkedControl}`);
        this.openInspector('composition');
        input?.focus({ preventScroll: true });
      }, { signal: this.signal });
    });
  }

  bindInspectorNavigation() {
    this.root.querySelectorAll('[data-layer-target]').forEach((row) => {
      row.addEventListener('click', () => {
        this.root.querySelectorAll('[data-layer-target]').forEach((item) => {
          const actif = item === row;
          item.classList.toggle('active', actif);
          item.setAttribute('aria-current', actif ? 'true' : 'false');
        });
        this.openInspector(row.dataset.layerTarget);
      }, { signal: this.signal });
    });

    this.root.querySelector('[data-close-inspector]')?.addEventListener('click', () => {
      this.root.querySelector('#sidebar')?.classList.remove('open');
      this.root.querySelector('#backdrop')?.classList.remove('show');
      this.root.querySelector('#drawerToggle')?.setAttribute('aria-expanded', 'false');
    }, { signal: this.signal });
  }

  openInspector(name) {
    const section = this.root.querySelector(`[data-inspector-section="${name}"]`);
    if (!section) return;
    section.open = true;
    // Le défilement animé ignorait `prefers-reduced-motion` : une option passée
    // en JavaScript prime sur le `scroll-behavior: auto !important` du CSS.
    const douceurRefusee = matchMedia('(prefers-reduced-motion: reduce)').matches;
    section.scrollIntoView({ block: 'nearest', behavior: douceurRefusee ? 'auto' : 'smooth' });
    this.root.querySelector('#sidebar')?.classList.add('open');
    if (matchMedia('(max-width: 920px)').matches) {
      this.root.querySelector('#backdrop')?.classList.add('show');
      this.root.querySelector('#drawerToggle')?.setAttribute('aria-expanded', 'true');
    }
  }

  bindHistory() {
    this.root.querySelector('[data-history-action="undo"]')?.addEventListener('click', () => this.root.querySelector('#undoBtn')?.click(), { signal: this.signal });
    this.root.querySelector('[data-history-action="redo"]')?.addEventListener('click', () => this.root.querySelector('#redoBtn')?.click(), { signal: this.signal });
  }

  recordVariation(label) {
    const project = this.lire?.();
    if (!project) return;
    const snapshot = {
      geometry: clone(project.geometry),
      designName: project.ui?.designName || `Variation ${this.variations.length + 1}`,
      presetKey: project.ui?.presetKey || null,
      seed: project.geometry?.variationSeed || project.geometry?.seed,
      label: label || 'Variation générée',
    };
    const same = this.variations.some((item) => item.seed === snapshot.seed && item.designName === snapshot.designName);
    if (!same) this.variations.push(snapshot);
    if (this.variations.length > 8) this.variations.shift();
    project.ui.variationSnapshots = clone(this.variations);
    this.renderVariations();
  }

  renderVariations() {
    const strip = this.root.querySelector('#variationStrip');
    if (!strip) return;
    strip.replaceChildren();
    this.variations.forEach((item, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `variation-card${index === this.variations.length - 1 ? ' active' : ''}`;
      button.dataset.variationIndex = String(index);
      const thumb = document.createElement('span');
      thumb.className = 'variation-thumb';
      thumb.setAttribute('aria-hidden', 'true');
      thumb.textContent = '≈';
      const copy = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = item.designName;
      const small = document.createElement('small');
      small.textContent = `${item.label} · ${String(item.seed).slice(-4)}`;
      copy.append(strong, small);
      button.append(thumb, copy);
      button.addEventListener('click', () => {
        this.root.querySelectorAll('.variation-card').forEach((card) => {
          const actif = card === button;
          card.classList.toggle('active', actif);
          card.setAttribute('aria-current', actif ? 'true' : 'false');
        });
        this.onRestoreVariation?.(clone(item));
      }, { signal: this.signal });
      strip.append(button);
    });
    const count = this.root.querySelector('#variationCount');
    if (count) count.textContent = String(this.variations.length);
  }

  destroy() {
    this.controller.abort();
    this.drag = null;
  }
}
