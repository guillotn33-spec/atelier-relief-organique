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

export class ProWorkspace {
  constructor(root, { lire, onRestoreVariation, onWorkspaceMode } = {}) {
    this.root = root;
    this.lire = lire;
    this.onRestoreVariation = onRestoreVariation;
    this.onWorkspaceMode = onWorkspaceMode;
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
    if (this.variations.length) this.renderVariations();
    else this.recordVariation('Point de départ');
    this.sync();
  }

  bindKnobs() {
    this.root.querySelectorAll('.param-knob[data-control]').forEach((knob) => {
      const input = this.root.querySelector(`#${knob.dataset.control}`);
      if (!input) return;

      input.addEventListener('input', () => this.syncKnob(knob, input), { signal: this.signal });

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
  }

  bindWorkspaceTabs() {
    this.root.querySelectorAll('[data-workspace-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        this.root.querySelectorAll('[data-workspace-mode]').forEach((item) => item.classList.toggle('active', item === button));
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
  }

  bindInspectorNavigation() {
    this.root.querySelectorAll('[data-layer-target]').forEach((row) => {
      row.addEventListener('click', () => {
        this.root.querySelectorAll('[data-layer-target]').forEach((item) => item.classList.toggle('active', item === row));
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
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
        this.root.querySelectorAll('.variation-card').forEach((card) => card.classList.toggle('active', card === button));
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
