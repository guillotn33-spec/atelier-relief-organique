// Contrôleur de l'atelier — relie l'état de projet, la heightmap canonique,
// le rendu 2D, la sculpture et la persistance.
//
// Principe qui n'existait pas en version 1 : un changement de LUMIÈRE ou de
// MATIÈRE ne reconstruit pas le relief. Seule la géométrie et la sculpture
// touchent à la heightmap. La v1 réévaluait tout le champ à chaque mouvement de
// curseur de lumière.

import { clamp } from '../core/math.js';
import { BOUNDS, PRESETS, applyPreset, aspectOf, baseGeometryOf, captureBase } from '../core/project.js';
import { GestureManager, ROLE } from './gestures.js';
import { Viewport } from './viewport.js';
import { Dock } from './dock.js';
import { nextVariation } from '../geometry/variation.js';
import { buildHeightmap, updateHeightmapRect } from '../geometry/heightmap.js';
import { createRenderCache, renderFull, renderPatch } from '../render2d/renderer.js';
import { stamp } from '../sculpt/brush.js';
import { SculptLayer } from '../sculpt/layer.js';
import * as db from '../persistence/db.js';

const TOOL_META = {
  light: { icon: '☀', hint: 'Glissez sur l’œuvre pour déplacer la lumière' },
  warp: { icon: '〰', hint: 'Poussez le motif dans le sens du geste' },
  dig: { icon: '◡', hint: 'Glissez pour creuser la matière — la pression du stylet module la force' },
  raise: { icon: '◠', hint: 'Glissez pour bomber la matière — la pression du stylet module la force' },
  smooth: { icon: '≋', hint: 'Glissez pour adoucir la sculpture' },
  erase: { icon: '⌫', hint: 'Glissez pour retrouver le motif d’origine' },
};

// `scope` décide de ce qu'il faut refaire : 'size' redimensionne la toile,
// 'geometry' reconstruit la heightmap, 'shading' se contente de réombrer.
const BINDINGS = {
  widthCm: { scope: 'size', read: (p) => p.widthCm, write: (p, v) => { p.widthCm = v; }, format: (v) => `${v} cm` },
  heightCm: { scope: 'size', read: (p) => p.heightCm, write: (p, v) => { p.heightCm = v; }, format: (v) => `${v} cm` },
  depthCm: { scope: 'meta', read: (p) => p.depthCm, write: (p, v) => { p.depthCm = v; }, format: (v) => `${v} cm` },

  basinScaleCm: { scope: 'geometry', read: (p) => Math.round(p.geometry.basinScaleCm), write: (p, v) => { p.geometry.basinScaleCm = v; }, format: (v) => `${v} cm` },
  density: { scope: 'geometry', read: (p) => Math.round(p.geometry.density * 100), write: (p, v) => { p.geometry.density = v / 100; }, format: (v) => `${v} %` },
  channelWeight: { scope: 'geometry', read: (p) => Math.round(p.geometry.channelWeight * 100), write: (p, v) => { p.geometry.channelWeight = v / 100; }, format: (v) => `${v} %` },
  elongation: { scope: 'geometry', read: (p) => Math.round(p.geometry.elongation * 100), write: (p, v) => { p.geometry.elongation = v / 100; }, format: (v) => `${v} %` },
  orientationDeg: { scope: 'geometry', read: (p) => Math.round(p.geometry.orientationDeg), write: (p, v) => { p.geometry.orientationDeg = v; }, format: (v) => `${v}°` },
  warpAmount: { scope: 'geometry', read: (p) => Math.round(p.geometry.warpAmount * 100), write: (p, v) => { p.geometry.warpAmount = v / 100; }, format: (v) => `${v} %` },
  irregularity: { scope: 'geometry', read: (p) => Math.round(p.geometry.irregularity * 100), write: (p, v) => { p.geometry.irregularity = v / 100; }, format: (v) => `${v} %` },
  depth: { scope: 'geometry', read: (p) => Math.round(p.geometry.depth * 100), write: (p, v) => { p.geometry.depth = v / 100; }, format: (v) => `${v} %` },
  shoulder: { scope: 'geometry', read: (p) => Math.round(p.geometry.shoulder * 100), write: (p, v) => { p.geometry.shoulder = v / 100; }, format: (v) => `${v} %` },
  softness: { scope: 'geometry', read: (p) => Math.round(p.geometry.softness * 100), write: (p, v) => { p.geometry.softness = v / 100; }, format: (v) => `${v} %` },
  wave: { scope: 'geometry', read: (p) => Math.round(p.geometry.wave * 100), write: (p, v) => { p.geometry.wave = v / 100; }, format: (v) => `${v} %` },
  negative: { scope: 'geometry', kind: 'checkbox', read: (p) => p.geometry.negative, write: (p, v) => { p.geometry.negative = v; } },

  texture: { scope: 'shading', read: (p) => Math.round(p.material.texture * 100), write: (p, v) => { p.material.texture = v / 100; }, format: (v) => `${v} %` },
  materialColor: { scope: 'shading', kind: 'color', read: (p) => p.material.color, write: (p, v) => { p.material.color = v; } },

  lightAngle: { scope: 'shading', read: (p) => p.lighting.angle, write: (p, v) => { p.lighting.angle = v; }, format: (v) => `${v}°` },
  lightHeight: { scope: 'shading', read: (p) => p.lighting.height, write: (p, v) => { p.lighting.height = v; }, format: (v) => `${v}°` },
  contrast: { scope: 'shading', read: (p) => Math.round(p.lighting.contrast * 100), write: (p, v) => { p.lighting.contrast = v / 100; }, format: (v) => `${v} %` },
  backlight: { scope: 'shading', read: (p) => Math.round(p.lighting.backlight * 100), write: (p, v) => { p.lighting.backlight = v / 100; }, format: (v) => `${v} %` },

  panelLayout: { scope: 'shading', kind: 'select', read: (p) => p.presentation.panelLayout, write: (p, v) => { p.presentation.panelLayout = v; } },
  frame: { scope: 'shading', kind: 'checkbox', read: (p) => p.presentation.frame, write: (p, v) => { p.presentation.frame = v; } },
  wallColor: { scope: 'shading', kind: 'color', read: (p) => p.presentation.wallColor, write: (p, v) => { p.presentation.wallColor = v; } },
};

export class Atelier {
  constructor(root, { project, layer, onNewProject }) {
    this.root = root;
    this.project = project;
    this.layer = layer || SculptLayer.forCanvas(project.widthCm, project.heightCm);
    this.onNewProject = onNewProject;

    this.canvas = root.querySelector('#reliefCanvas');
    this.artWrap = root.querySelector('#artWrap');
    this.stage = root.querySelector('#stage');
    this.rendering = root.querySelector('#rendering');
    this.seedLabel = root.querySelector('#seedLabel');
    this.designName = root.querySelector('#designName');
    this.sizeLabel = root.querySelector('#sizeLabel');
    this.hintText = root.querySelector('#hintText');
    this.hintSymbol = root.querySelector('#hintSymbol');
    this.undoBtn = root.querySelector('#undoBtn');
    this.redoBtn = root.querySelector('#redoBtn');
    this.brushSize = root.querySelector('#brushSize');
    this.brushStrength = root.querySelector('#brushStrength');
    this.heightControl = root.querySelector('#heightControl');
    this.widthLabel = root.querySelector('#widthLabel');

    this.controls = {};
    for (const id of Object.keys(BINDINGS)) this.controls[id] = root.querySelector('#' + id);

    this.cache = createRenderCache();
    this.previewCanvas = document.createElement('canvas');
    this.previewCache = createRenderCache();
    this.hm = null;
    this.renderToken = 0;

    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
    this.strokeDirty = null;
    this.patchQueued = false;
    this.lightBusy = false;
    this.lightMoved = false;
    // Vrai dès qu'un geste occupe l'atelier, quel que soit son rôle.
    this.gestureActive = false;
    this.resize = null;

    // Qualité de départ de l'animation : 0,22 et non 0,45.
    //
    // Mesuré sur ce poste, panneau 200 × 120 cm : une image coûte 70,9 ms à
    // qualité 0,45 (14 im/s) contre 14,0 ms à 0,18 (71 im/s). Démarrer à 0,45
    // faisait passer la première seconde d'animation à 14 im/s avant que la
    // boucle adaptative ne descende. On démarre donc déjà bas.
    this.anim = { enabled: false, raf: 0, canvas: null, cache: null, quality: 0.22, lastTs: 0, avg: 0 };

    this.saveProjectTimer = 0;
    this.saveSculptTimer = 0;

    this.viewport = new Viewport(this.artWrap, this.stage, {
      onChange: () => {
        this.project.ui.viewport = this.viewport.serialize();
        this.scheduleSaveProject();
      },
    });
    this.viewport.restore(this.project.ui.viewport);

    this.bindControls();
    this.bindTools();
    this.bindGestures();
    this.bindResizeHandle();
    this.bindDocks();
    this.bindMisc();

    this.syncControlsFromProject();
    this.applyShapeToDom();
    this.rebuild();

    this.resizeTimer = 0;
    this.observer = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      // Simple changement de taille d'affichage : le relief ne change pas,
      // seule la résolution de sortie est refaite.
      this.resizeTimer = setTimeout(() => this.render(), 120);
    });
    this.observer.observe(this.artWrap);
  }

  // ---- Liaison des contrôles ----

  bindControls() {
    for (const [id, binding] of Object.entries(BINDINGS)) {
      const el = this.controls[id];
      if (!el) continue;
      const eventName = binding.kind === 'select' || binding.kind === 'checkbox' || binding.kind === 'color' ? 'change' : 'input';
      el.addEventListener(eventName, () => {
        const raw = binding.kind === 'checkbox' ? el.checked : binding.kind === 'color' || binding.kind === 'select' ? el.value : Number(el.value);
        this.applyChange(id, binding, raw);
      });
    }

    for (const el of [this.brushSize, this.brushStrength]) {
      el.addEventListener('input', () => {
        this.project.ui.brushSizeCm = Number(this.brushSize.value);
        this.project.ui.brushStrength = Number(this.brushStrength.value) / 100;
        this.updateBrushDisplays();
        this.scheduleSaveProject();
      });
    }
  }

  applyChange(id, binding, raw) {
    binding.write(this.project, raw);
    this.markCustom();

    if (binding.scope === 'size') {
      if (this.project.canvasShape !== 'rectangle') {
        this.project.heightCm = this.project.widthCm;
        if (this.controls.heightCm) this.controls.heightCm.value = String(this.project.heightCm);
      }
      this.layer.ensureCovers(this.project.widthCm, this.project.heightCm);
      this.applyShapeToDom();
      this.rebuild();
    } else if (binding.scope === 'geometry') {
      this.rebuild();
    } else {
      this.updateEnvironment();
      this.render();
    }

    this.updateControlDisplays();
    this.scheduleSaveProject();
  }

  syncControlsFromProject() {
    for (const [id, binding] of Object.entries(BINDINGS)) {
      const el = this.controls[id];
      if (!el) continue;
      const value = binding.read(this.project);
      if (binding.kind === 'checkbox') el.checked = !!value;
      else el.value = String(value);
    }
    this.brushSize.value = String(this.project.ui.brushSizeCm);
    this.brushStrength.value = String(Math.round(this.project.ui.brushStrength * 100));
    this.setTool(this.project.ui.activeTool || 'light');
    this.root.querySelectorAll('.preset').forEach((button) => {
      button.classList.toggle('active', button.dataset.preset === this.project.ui.presetKey);
    });
    this.updateControlDisplays();
    this.updateBrushDisplays();
    this.refreshBaseButton();
    this.syncMiniPalette();
  }

  updateControlDisplays() {
    for (const [id, binding] of Object.entries(BINDINGS)) {
      const el = this.controls[id];
      const output = this.root.querySelector('#' + id + 'Value');
      if (!el) continue;
      if (output && binding.format) output.value = binding.format(el.value);
      if (el.type === 'range') {
        const min = Number(el.min);
        const max = Number(el.max);
        const value = Number(el.value);
        el.style.setProperty('--range', (((value - min) / (max - min)) * 100).toFixed(2) + '%');
      }
    }
    this.seedLabel.textContent = String(this.project.geometry.seed);
    this.designName.textContent = this.project.ui.designName;
    this.sizeLabel.textContent = `${trim(this.project.widthCm)} × ${trim(this.project.heightCm)} × ${trim(this.project.depthCm)} cm`;
  }

  updateBrushDisplays() {
    const sizeOut = this.root.querySelector('#brushSizeValue');
    const strengthOut = this.root.querySelector('#brushStrengthValue');
    if (sizeOut) sizeOut.value = `${this.brushSize.value} cm`;
    if (strengthOut) strengthOut.value = `${this.brushStrength.value} %`;
    for (const el of [this.brushSize, this.brushStrength]) {
      const min = Number(el.min);
      const max = Number(el.max);
      el.style.setProperty('--range', (((Number(el.value) - min) / (max - min)) * 100).toFixed(2) + '%');
    }
  }

  applyShapeToDom() {
    const aspect = aspectOf(this.project);
    this.artWrap.style.setProperty('--canvas-aspect', String(aspect));
    this.artWrap.dataset.shape = this.project.canvasShape;
    const shapeLocked = this.project.canvasShape !== 'rectangle';
    if (this.heightControl) this.heightControl.hidden = shapeLocked;
    if (this.widthLabel) this.widthLabel.textContent = this.project.canvasShape === 'circle' ? 'Diamètre' : shapeLocked ? 'Côté' : 'Largeur';

    // Le cadenas n'a de sens que pour le rectangle : le carré et le rond
    // imposent 1:1 par définition, pas par réglage.
    const lock = this.root.querySelector('#ratioLock');
    if (lock) {
      lock.hidden = shapeLocked;
      lock.setAttribute('aria-pressed', String(!!this.project.ui.ratioLocked));
    }
  }

  updateEnvironment() {
    this.stage.style.setProperty('--wall', this.project.presentation.wallColor);
    this.artWrap.style.setProperty('--glow-alpha', (0.06 + this.project.lighting.backlight * 0.76).toFixed(2));
  }

  markCustom() {
    if (this.project.ui.presetKey) {
      this.project.ui.presetKey = null;
      this.project.ui.designName = 'Création libre';
      this.root.querySelectorAll('.preset').forEach((button) => button.classList.remove('active'));
    }
  }

  // ---- Rendu ----

  outputSize() {
    const rect = this.artWrap.getBoundingClientRect();
    const aspect = aspectOf(this.project);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.45);
    let outW = Math.round(clamp((rect.width || 900) * dpr, 560, 1020));
    let outH = Math.max(1, Math.round(outW / aspect));
    const MAX_PIXELS = 1_400_000;
    if (outW * outH > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (outW * outH));
      outW = Math.max(64, Math.round(outW * k));
      outH = Math.max(1, Math.round(outW / aspect));
    }
    return { outW, outH };
  }

  /** Reconstruit la heightmap puis rend. Réservé aux changements de géométrie. */
  rebuild() {
    const token = ++this.renderToken;
    this.rendering.classList.add('show');
    // Le report d'une image sert à peindre l'indicateur avant le calcul. Dans un
    // onglet en arrière-plan, requestAnimationFrame ne se déclenche pas du tout :
    // un projet rouvert dans un onglet inactif ne se construirait jamais et le
    // canvas resterait à sa taille par défaut. On bascule alors sur un timer.
    const defer = document.hidden ? (fn) => setTimeout(fn, 0) : requestAnimationFrame;
    defer(() => {
      if (token !== this.renderToken) return;
      this.hm = buildHeightmap(this.project, this.layer);
      this.render();
      this.rendering.classList.remove('show');
      if (this.anim.enabled) this.restartAnim();
    });
  }

  /** Rend à partir de la heightmap existante. */
  render() {
    if (!this.hm) return;
    const { outW, outH } = this.outputSize();
    this.updateEnvironment();
    renderFull(this.canvas, this.project, this.hm, outW, outH, this.cache);
    this.updateControlDisplays();
  }

  renderLowPreview() {
    if (!this.hm) return;
    const { outW, outH } = this.outputSize();
    const w = Math.max(64, Math.round(outW * 0.5));
    const h = Math.max(1, Math.round(outH * 0.5));
    renderFull(this.previewCanvas, this.project, this.hm, w, h, this.previewCache);
    const ctx = this.canvas.getContext('2d', { alpha: true });
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.previewCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  // ---- Outils ----

  bindTools() {
    this.root.querySelectorAll('.tool[data-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setTool(button.dataset.tool);
        this.scheduleSaveProject();
      });
    });

    this.undoBtn.addEventListener('click', () => this.undo());
    this.redoBtn.addEventListener('click', () => this.redo());
  }

  setTool(tool) {
    this.project.ui.activeTool = tool;
    this.root.querySelectorAll('.tool[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    const meta = TOOL_META[tool] || TOOL_META.light;
    this.hintSymbol.textContent = meta.icon;
    this.hintText.textContent = meta.hint;
  }

  // ---- Gestes (§22) ----
  //
  // Tous les pointeurs passent par l'arbitre, qui décide d'UN rôle à l'ouverture
  // du geste et le verrouille jusqu'au relevé du dernier pointeur. Les sept
  // séquences de `tests/gestures.mjs` éprouvent cette machine hors DOM ; ici on
  // ne fait que la brancher.

  bindGestures() {
    const stage = this.stage;

    this.gestures = new GestureManager({
      activeTool: () => this.project.ui.activeTool,
      hitTest: (p) => this.zoneOf(p),
      onRoleChange: (role) => {
        // L'animation est suspendue pendant TOUT geste, quel qu'il soit : il n'y
        // a donc aucune interaction animation × pinch × trait à gérer.
        this.gestureActive = role !== ROLE.NONE;
      },
      onSculptStart: (p) => {
        this.pushUndo();
        this.beginStroke(p);
      },
      onSculptMove: (p) => this.continueStroke(p),
      onSculptEnd: () => this.endStroke(),
      onLightStart: (p) => this.moveLight(p),
      onLightMove: (p) => this.moveLight(p),
      onCameraStart: (s) => this.viewport.beginPinch(s),
      onCameraMove: (s) => this.viewport.updatePinch(s),
      onPanStart: (p) => this.viewport.beginPan(p),
      onPanMove: (p) => this.viewport.updatePan(p),
      onResizeStart: (p) => this.beginResize(p),
      onResizeMove: (p) => this.updateResize(p),
      onResizeEnd: () => this.endResize(),
    });

    const toPointer = (event) => ({
      id: event.pointerId,
      type: event.pointerType || 'mouse',
      x: event.clientX,
      y: event.clientY,
      pressure: event.pressure > 0 ? event.pressure : 0.55,
      time: event.timeStamp,
      target: event.target,
    });

    stage.addEventListener('pointerdown', (event) => {
      const p = toPointer(event);
      // On ne confisque jamais un pointeur destiné à l'interface : les boutons
      // et les curseurs doivent continuer de fonctionner normalement.
      if (this.zoneOf(p) !== 'ui') event.preventDefault();
      this.gestures.pointerDown(p);
    });

    stage.addEventListener('pointermove', (event) => {
      if (this.gestures.pointerCount === 0) return;
      const p = toPointer(event);
      // Les événements coalescés ne servent qu'au trait ; les autres rôles se
      // contentent du dernier point connu.
      if (this.gestures.role === ROLE.SCULPT && event.getCoalescedEvents) {
        const list = event.getCoalescedEvents();
        if (list && list.length) p.coalesced = list;
      }
      event.preventDefault();
      this.gestures.pointerMove(p);
    });

    // Fins de geste écoutées sur la FENÊTRE. C'est ce qui empêche un pointeur
    // relevé hors de la toile de rester compté — le défaut relevé au lot 0.
    window.addEventListener('pointerup', (event) => {
      if (this.gestures.pointerCount === 0) return;
      this.gestures.pointerUp(toPointer(event));
      this.afterGesture();
    });
    window.addEventListener('pointercancel', (event) => {
      if (this.gestures.pointerCount === 0) return;
      this.gestures.pointerCancel(toPointer(event));
      this.afterGesture();
    });
    window.addEventListener('blur', () => {
      if (!this.gestures.busy) return;
      this.gestures.cancelAll();
      this.afterGesture();
    });
  }

  /** Zone touchée — c'est elle qui porte la priorité des gestes de §22. */
  zoneOf(p) {
    const target = p.target;
    if (target && target.closest) {
      if (target.closest('#resizeHandle')) return 'resize';
      if (target.closest('.dock, .tool, .btn, .ratio-lock, input, select, label, summary')) return 'ui';
    }
    const rect = this.artWrap.getBoundingClientRect();
    const inside = p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
    return inside ? 'canvas' : 'outside';
  }

  /** Remise en ordre après un geste : la vue et la caméra reprennent la main. */
  afterGesture() {
    if (this.gestures.role !== ROLE.NONE) return;
    this.viewport.endPinch();
    this.viewport.endPan();
    if (this.lightMoved) {
      this.lightMoved = false;
      this.render();
      this.scheduleSaveProject();
    }
    if (this.anim.enabled) this.restartAnim();
  }

  toCm(clientX, clientY) {
    // Le rectangle renvoyé est DÉJÀ transformé par le zoom : la conversion en
    // centimètres n'a donc pas à connaître la vue.
    const rect = this.artWrap.getBoundingClientRect();
    const u = (clientX - rect.left) / rect.width;
    const v = (clientY - rect.top) / rect.height;
    return {
      xCm: (u - 0.5) * this.project.widthCm,
      yCm: (v - 0.5) * this.project.heightCm,
    };
  }

  beginStroke(p) {
    const { xCm, yCm } = this.toCm(p.x, p.y);
    this.stroke = { lastX: xCm, lastY: yCm };
    this.stampAt(xCm, yCm, 0, 0, p.pressure, true);
    this.queuePatch();
  }

  continueStroke(p) {
    if (!this.stroke) return;
    if (p.coalesced) {
      for (const sample of p.coalesced) {
        const { xCm, yCm } = this.toCm(sample.clientX, sample.clientY);
        this.stampAt(xCm, yCm, xCm - this.stroke.lastX, yCm - this.stroke.lastY, sample.pressure > 0 ? sample.pressure : 0.55, false);
      }
    } else {
      const { xCm, yCm } = this.toCm(p.x, p.y);
      this.stampAt(xCm, yCm, xCm - this.stroke.lastX, yCm - this.stroke.lastY, p.pressure, false);
    }
    this.queuePatch();
  }

  stampAt(xCm, yCm, dxCm, dyCm, pressure, first) {
    const rect = stamp(this.layer, {
      tool: this.project.ui.activeTool,
      xCm,
      yCm,
      dxCm,
      dyCm,
      radiusCm: this.project.ui.brushSizeCm,
      strength: this.project.ui.brushStrength,
      pressure,
      elongation: this.project.ui.brushElongation,
      angleDeg: this.project.ui.brushAngle,
      first,
    });
    if (rect) this.growDirty(rect);
    this.stroke.lastX = xCm;
    this.stroke.lastY = yCm;
  }

  growDirty(rect) {
    const margin = this.hm ? this.hm.blurRadius * this.hm.cellCm * 2 + this.hm.cellCm : 1;
    const grown = { x0: rect.x0 - margin, y0: rect.y0 - margin, x1: rect.x1 + margin, y1: rect.y1 + margin };
    if (!this.strokeDirty) this.strokeDirty = grown;
    else {
      this.strokeDirty.x0 = Math.min(this.strokeDirty.x0, grown.x0);
      this.strokeDirty.y0 = Math.min(this.strokeDirty.y0, grown.y0);
      this.strokeDirty.x1 = Math.max(this.strokeDirty.x1, grown.x1);
      this.strokeDirty.y1 = Math.max(this.strokeDirty.y1, grown.y1);
    }
  }

  queuePatch() {
    if (this.patchQueued) return;
    this.patchQueued = true;
    requestAnimationFrame(() => {
      this.patchQueued = false;
      const rect = this.strokeDirty;
      this.strokeDirty = null;
      if (!rect || !this.hm) return;
      updateHeightmapRect(this.hm, this.project, this.layer, rect);
      renderPatch(this.canvas, this.project, this.hm, this.cache, rect);
    });
  }

  endStroke() {
    if (!this.stroke) return;
    this.stroke = null;

    // Le patch est différé d'une image. Si le trait se termine avant qu'elle
    // n'ait lieu — geste bref, onglet en arrière-plan, machine chargée — les
    // derniers coups de brosse sont dans le calque mais PAS dans la heightmap.
    // Les jeter les ferait disparaître jusqu'à la prochaine reconstruction
    // complète. On solde donc la zone en attente avant de réombrer.
    const pending = this.strokeDirty;
    this.strokeDirty = null;
    if (pending && this.hm) updateHeightmapRect(this.hm, this.project, this.layer, pending);

    // La moyenne du relief a bougé : l'occlusion est globale, on réombre tout.
    this.render();
    this.scheduleSaveSculpt();
  }

  moveLight(p) {
    const rect = this.artWrap.getBoundingClientRect();
    const x = p.x - rect.left - rect.width / 2;
    const y = p.y - rect.top - rect.height / 2;
    let angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    this.project.lighting.angle = Math.round(angle);
    if (this.controls.lightAngle) this.controls.lightAngle.value = String(this.project.lighting.angle);
    this.markCustom();
    this.updateControlDisplays();
    this.lightMoved = true;
    if (!this.lightBusy) {
      this.lightBusy = true;
      requestAnimationFrame(() => {
        this.renderLowPreview();
        this.lightBusy = false;
      });
    }
  }

  // ---- Génération : variation, base, retour base (§4) ----

  newVariation() {
    this.project.geometry = nextVariation(this.project.geometry);
    this.project.ui.presetKey = null;
    this.project.ui.designName = 'Variation ' + String(this.project.geometry.variationSeed).slice(-4);
    this.root.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'));
    this.syncControlsFromProject();
    this.rebuild();
    this.scheduleSaveProject();
  }

  setBase() {
    this.project.baseDesignSnapshot = captureBase(this.project, this.layer);
    this.refreshBaseButton();
    this.scheduleSaveProject();
  }

  restoreBase() {
    const snapshot = this.project.baseDesignSnapshot;
    if (!snapshot) return;
    // On restaure les VRAIES données, sculpture comprise, pas une approximation.
    this.pushUndo();
    this.project.geometry = baseGeometryOf(snapshot, this.project.geometry);
    this.layer.adopt(snapshot.sculpt);
    this.project.ui.presetKey = null;
    this.project.ui.designName = 'Base';
    this.root.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'));
    this.syncControlsFromProject();
    this.rebuild();
    this.scheduleSaveProject();
    this.scheduleSaveSculpt();
  }

  refreshBaseButton() {
    const button = this.root.querySelector('#restoreBase');
    if (button) button.disabled = !this.project.baseDesignSnapshot;
  }

  // ---- Redimensionnement physique de la toile (§3) ----
  //
  // À ne jamais confondre avec le zoom : ici ce sont les CENTIMÈTRES du panneau
  // qui changent. Le champ étant ancré en centimètres, agrandir révèle du motif
  // supplémentaire sans déplacer celui qui est déjà là — le relief n'est donc
  // jamais étiré, il est réévalué sur une fenêtre plus large.

  bindResizeHandle() {
    const lock = this.root.querySelector('#ratioLock');
    lock.addEventListener('click', () => {
      this.project.ui.ratioLocked = !this.project.ui.ratioLocked;
      this.applyShapeToDom();
      this.scheduleSaveProject();
    });
    this.resizeReadout = this.root.querySelector('#resizeReadout');
  }

  beginResize(p) {
    const rect = this.artWrap.getBoundingClientRect();
    this.resize = {
      startX: p.x,
      startY: p.y,
      startW: this.project.widthCm,
      startH: this.project.heightCm,
      // Échelle réelle à l'écran, zoom compris : la poignée doit suivre le doigt.
      pxPerCmX: rect.width / this.project.widthCm,
      pxPerCmY: rect.height / this.project.heightCm,
    };
    this.resizeReadout.hidden = false;
    this.updateResizeReadout();
  }

  updateResize(p) {
    if (!this.resize) return;
    const r = this.resize;
    const bounds = BOUNDS[this.project.canvasShape];
    const locked = this.project.canvasShape !== 'rectangle' || this.project.ui.ratioLocked;

    let widthCm = r.startW + (p.x - r.startX) / r.pxPerCmX;
    let heightCm = r.startH + (p.y - r.startY) / r.pxPerCmY;

    if (locked) {
      // Ratio verrouillé : c'est le déplacement dominant qui commande, et
      // l'autre dimension suit exactement.
      const ratio = r.startW / r.startH;
      if (Math.abs(p.x - r.startX) >= Math.abs(p.y - r.startY)) heightCm = widthCm / ratio;
      else widthCm = heightCm * ratio;
    }

    widthCm = clamp(Math.round(widthCm), bounds.widthCm.min, bounds.widthCm.max);
    const heightBound = bounds.heightCm || bounds.widthCm;
    heightCm = clamp(Math.round(heightCm), heightBound.min, heightBound.max);
    if (this.project.canvasShape !== 'rectangle') heightCm = widthCm;

    this.project.widthCm = widthCm;
    this.project.heightCm = heightCm;
    if (this.controls.widthCm) this.controls.widthCm.value = String(widthCm);
    if (this.controls.heightCm) this.controls.heightCm.value = String(heightCm);
    this.layer.ensureCovers(widthCm, heightCm);
    this.applyShapeToDom();
    this.updateResizeReadout();
    this.previewResize();
  }

  updateResizeReadout() {
    if (!this.resizeReadout) return;
    this.resizeReadout.textContent = `${Math.round(this.project.widthCm)} × ${Math.round(this.project.heightCm)} cm`;
  }

  /** Aperçu pendant le glisser : même relief, échantillonné plus grossièrement. */
  previewResize() {
    if (this.resizePreviewQueued) return;
    this.resizePreviewQueued = true;
    requestAnimationFrame(() => {
      this.resizePreviewQueued = false;
      if (!this.resize) return;
      this.hm = buildHeightmap(this.project, this.layer, { quality: 0.35 });
      this.render();
    });
  }

  endResize() {
    if (!this.resize) return;
    this.resize = null;
    this.resizeReadout.hidden = true;
    this.rebuild();
    this.updateControlDisplays();
    this.scheduleSaveProject();
  }

  // ---- Barres (§14, §15) ----

  bindDocks() {
    const ui = this.project.ui;
    ui.docks = ui.docks || {};

    this.toolbarDock = new Dock(this.root.querySelector('#toolbar'), {
      handle: this.root.querySelector('#toolbarHandle'),
      collapseBtn: this.root.querySelector('#toolbarCollapse'),
      artWrap: this.artWrap,
      state: ui.docks.toolbar,
      onPersist: (state) => {
        ui.docks.toolbar = state;
        this.scheduleSaveProject();
      },
    });

    this.miniDock = new Dock(this.root.querySelector('#miniPalette'), {
      handle: this.root.querySelector('#miniHandle'),
      artWrap: this.artWrap,
      state: ui.docks.mini,
      onPersist: (state) => {
        ui.docks.mini = state;
        this.scheduleSaveProject();
      },
    });

    this.root.querySelector('#miniToggle').addEventListener('click', () => {
      this.miniDock.setVisible(!this.miniDock.state.visible);
    });

    this.root.querySelector('#resetView').addEventListener('click', () => {
      this.viewport.reset();
      this.render();
    });

    // La mini-palette n'a pas d'état propre : elle pilote les mêmes réglages
    // que la barre principale, et les deux restent synchronisées.
    this.root.querySelectorAll('[data-mini-tool]').forEach((button) => {
      button.addEventListener('click', () => {
        this.setTool(button.dataset.miniTool);
        this.syncMiniPalette();
        this.scheduleSaveProject();
      });
    });
    const miniSize = this.root.querySelector('#miniSize');
    const miniStrength = this.root.querySelector('#miniStrength');
    miniSize.addEventListener('input', () => {
      this.brushSize.value = miniSize.value;
      this.brushSize.dispatchEvent(new Event('input', { bubbles: true }));
      this.syncMiniPalette();
    });
    miniStrength.addEventListener('input', () => {
      this.brushStrength.value = miniStrength.value;
      this.brushStrength.dispatchEvent(new Event('input', { bubbles: true }));
      this.syncMiniPalette();
    });
    this.syncMiniPalette();
  }

  syncMiniPalette() {
    const miniSize = this.root.querySelector('#miniSize');
    const miniStrength = this.root.querySelector('#miniStrength');
    if (!miniSize) return;
    miniSize.value = this.brushSize.value;
    miniStrength.value = this.brushStrength.value;
    this.root.querySelector('#miniSizeValue').value = `${miniSize.value} cm`;
    this.root.querySelector('#miniStrengthValue').value = `${miniStrength.value} %`;
    this.root.querySelectorAll('[data-mini-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.miniTool === this.project.ui.activeTool);
    });
  }

  // ---- Annuler / rétablir ----

  pushUndo() {
    this.undoStack.push(this.layer.snapshot());
    if (this.undoStack.length > 15) this.undoStack.shift();
    this.redoStack.length = 0;
    this.refreshHistoryButtons();
  }

  refreshHistoryButtons() {
    this.undoBtn.disabled = !this.undoStack.length;
    this.redoBtn.disabled = !this.redoStack.length;
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.layer.snapshot());
    this.layer.restore(this.undoStack.pop());
    this.refreshHistoryButtons();
    this.rebuild();
    this.scheduleSaveSculpt();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.layer.snapshot());
    this.layer.restore(this.redoStack.pop());
    this.refreshHistoryButtons();
    this.rebuild();
    this.scheduleSaveSculpt();
  }

  // ---- Divers ----

  bindMisc() {
    this.root.querySelectorAll('.preset').forEach((button) => {
      button.addEventListener('click', () => {
        this.project = applyPreset(this.project, button.dataset.preset);
        this.syncControlsFromProject();
        this.rebuild();
        this.scheduleSaveProject();
      });
    });

    const variation = () => this.newVariation();
    this.root.querySelector('#variationTop').addEventListener('click', variation);
    this.root.querySelector('#variationMobile').addEventListener('click', variation);
    this.root.querySelector('#newVariation').addEventListener('click', variation);
    this.root.querySelector('#setBase').addEventListener('click', () => this.setBase());
    this.root.querySelector('#restoreBase').addEventListener('click', () => this.restoreBase());

    const exportPng = (event) => this.exportPng(event.currentTarget);
    this.root.querySelector('#exportTop').addEventListener('click', exportPng);
    this.root.querySelector('#exportMobile').addEventListener('click', exportPng);

    this.root.querySelector('#newProject').addEventListener('click', () => this.onNewProject());

    this.root.querySelector('#clearSculpt').addEventListener('click', () => {
      this.pushUndo();
      this.layer.clear();
      this.rebuild();
      this.scheduleSaveSculpt();
    });

    this.root.querySelector('#animate').addEventListener('change', (event) => {
      this.anim.enabled = event.target.checked;
      this.project.ui.animate = this.anim.enabled;
      if (this.anim.enabled) this.restartAnim();
      else this.stopAnim();
    });

    window.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.redo();
      }
    });

    const sidebar = this.root.querySelector('#sidebar');
    const backdrop = this.root.querySelector('#backdrop');
    const drawerToggle = this.root.querySelector('#drawerToggle');
    const setDrawer = (open) => {
      sidebar.classList.toggle('open', open);
      backdrop.classList.toggle('show', open);
      drawerToggle.setAttribute('aria-expanded', String(open));
    };
    drawerToggle.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
    backdrop.addEventListener('click', () => setDrawer(false));
  }

  // ---- Animation de l'ondulation ----
  // Portée de la version 1 : la carte statique est construite une fois, seule la
  // houle est recalculée par image. Le lot 2 remplace ce terme additif — c'est
  // lui qui fabrique les îlots au fond des cavités.

  restartAnim() {
    if (!this.anim.enabled || !this.hm) return;
    if (!this.anim.canvas) {
      this.anim.canvas = document.createElement('canvas');
      this.anim.cache = createRenderCache();
    }
    if (!this.anim.raf) this.anim.raf = requestAnimationFrame((ts) => this.animFrame(ts));
  }

  stopAnim() {
    if (this.anim.raf) cancelAnimationFrame(this.anim.raf);
    this.anim.raf = 0;
    this.anim.avg = 0;
    this.render();
  }

  animFrame(ts) {
    this.anim.raf = requestAnimationFrame((next) => this.animFrame(next));
    if (!this.anim.enabled || document.hidden || this.gestureActive) return;
    if (ts - this.anim.lastTs < 40) return;
    this.anim.lastTs = ts;

    const start = performance.now();
    this.drawAnimFrame(ts * 0.00016);
    const dt = performance.now() - start;
    this.anim.avg = this.anim.avg ? this.anim.avg * 0.8 + dt * 0.2 : dt;
    if (this.anim.avg > 34 && this.anim.quality > 0.18) {
      this.anim.quality = Math.max(0.18, this.anim.quality * 0.75);
      this.anim.avg = 0;
    }
  }

  /**
   * Le champ étant une fonction pure des centimètres, animer l'ondulation revient
   * à faire défiler le domaine de la HOULE PORTEUSE et à rééchantillonner le champ
   * sur une grille plus grossière. La structure des creux ne bouge pas ; c'est la
   * houle qui traverse la pièce. Le moteur v1 gardait sa carte statique et ajoutait
   * une sinusoïde par-dessus — c'est précisément ce qui posait une bosse au fond
   * des cavités.
   */
  drawAnimFrame(phase) {
    const quality = this.anim.quality;
    const hm = buildHeightmap(this.project, this.layer, { quality, carrierPhase: phase, tPhase: phase });
    const { outW, outH } = this.outputSize();
    const w = Math.max(64, Math.round(outW * quality));
    const h = Math.max(1, Math.round(outH * quality));
    renderFull(this.anim.canvas, this.project, hm, w, h, this.anim.cache);
    const ctx = this.canvas.getContext('2d', { alpha: true });
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.anim.canvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  // ---- Export ----
  // §17 (PNG/JPEG, résolutions au choix, transparence du rond) est le lot 6.
  // Au lot 1 on supprime seulement le 1920 × 1200 câblé : la sortie respecte
  // désormais le rapport réel du projet.

  async exportPng(button) {
    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="btn-icon">···</span> Calcul HD';
    this.rendering.classList.add('show');
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const aspect = aspectOf(this.project);
      const long = 2048;
      const outW = aspect >= 1 ? long : Math.max(1, Math.round(long * aspect));
      const outH = aspect >= 1 ? Math.max(1, Math.round(long / aspect)) : long;
      const target = document.createElement('canvas');
      renderFull(target, this.project, this.hm, outW, outH, createRenderCache());
      const blob = await new Promise((resolve) => target.toBlob(resolve, 'image/png'));
      if (blob) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `relief-organique-${this.project.geometry.seed}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1200);
      }
    } finally {
      button.disabled = false;
      button.innerHTML = original;
      this.rendering.classList.remove('show');
    }
  }

  // ---- Persistance ----

  scheduleSaveProject() {
    clearTimeout(this.saveProjectTimer);
    this.saveProjectTimer = setTimeout(() => {
      db.saveProject(this.project).catch(() => {});
      db.setMeta('lastProjectId', this.project.id).catch(() => {});
    }, 400);
  }

  scheduleSaveSculpt() {
    clearTimeout(this.saveSculptTimer);
    this.saveSculptTimer = setTimeout(() => {
      db.saveSculpt(this.project.id, this.layer.active ? this.layer.serialize() : null).catch(() => {});
    }, 800);
  }

  show() {
    this.root.hidden = false;
    this.render();
  }

  hide() {
    this.root.hidden = true;
  }

  destroy() {
    this.observer.disconnect();
    this.stopAnim();
  }
}

function trim(value) {
  return String(Math.round(value * 10) / 10);
}

export { PRESETS };
