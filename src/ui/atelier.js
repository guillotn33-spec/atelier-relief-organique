// Contrôleur de l'atelier — relie l'état de projet, la heightmap canonique,
// le rendu 2D, la sculpture et la persistance.
//
// Principe qui n'existait pas en version 1 : un changement de LUMIÈRE ou de
// MATIÈRE ne reconstruit pas le relief. Seule la géométrie et la sculpture
// touchent à la heightmap. La v1 réévaluait tout le champ à chaque mouvement de
// curseur de lumière.

import { clamp } from '../core/math.js';
import { PRESETS, applyPreset, aspectOf } from '../core/project.js';
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

  count: { scope: 'geometry', read: (p) => p.geometry.count, write: (p, v) => { p.geometry.count = v; }, format: (v) => `${v}` },
  scale: { scope: 'geometry', read: (p) => Math.round(p.geometry.scale * 100), write: (p, v) => { p.geometry.scale = v / 100; }, format: (v) => `${v} %` },
  elongation: { scope: 'geometry', read: (p) => Math.round(p.geometry.elongation * 100), write: (p, v) => { p.geometry.elongation = v / 100; }, format: (v) => `${v} %` },
  flow: { scope: 'geometry', read: (p) => Math.round(p.geometry.flow * 100), write: (p, v) => { p.geometry.flow = v / 100; }, format: (v) => `${v} %` },
  irregularity: { scope: 'geometry', read: (p) => Math.round(p.geometry.irregularity * 100), write: (p, v) => { p.geometry.irregularity = v / 100; }, format: (v) => `${v} %` },
  depth: { scope: 'geometry', read: (p) => Math.round(p.geometry.depth * 100), write: (p, v) => { p.geometry.depth = v / 100; }, format: (v) => `${v} %` },
  softness: { scope: 'geometry', read: (p) => Math.round(p.geometry.softness * 100), write: (p, v) => { p.geometry.softness = v / 100; }, format: (v) => `${v} %` },
  wave: { scope: 'geometry', read: (p) => Math.round(p.geometry.wave * 100), write: (p, v) => { p.geometry.wave = v / 100; }, format: (v) => `${v} %` },

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
    this.lightPointerId = null;
    this.lightBusy = false;
    this.pointers = new Set();

    this.anim = { enabled: false, raf: 0, state: null, quality: 0.45, lastTs: 0, avg: 0 };

    this.saveProjectTimer = 0;
    this.saveSculptTimer = 0;

    this.bindControls();
    this.bindTools();
    this.bindPointer();
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
    const locked = this.project.canvasShape !== 'rectangle';
    if (this.heightControl) this.heightControl.hidden = locked;
    if (this.widthLabel) this.widthLabel.textContent = this.project.canvasShape === 'circle' ? 'Diamètre' : locked ? 'Côté' : 'Largeur';
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

  // ---- Pointeurs ----

  bindPointer() {
    const wrap = this.artWrap;

    wrap.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.pointers.add(event.pointerId);
      if (this.pointers.size > 1) {
        // Comportement de la version 1 conservé au lot 1 : le second pointeur
        // annule le geste. Le vrai gestionnaire multi-pointeur (pinch, orbite,
        // priorités de gestes) est le lot 3.
        this.endStroke();
        this.lightPointerId = null;
        return;
      }

      // La capture est un confort — elle garde le geste vivant hors de l'œuvre.
      // Elle échoue sur certains pointeurs (et sur tout événement synthétique) :
      // l'échec ne doit jamais interrompre le traitement du geste lui-même.
      const capture = () => {
        try {
          wrap.setPointerCapture(event.pointerId);
        } catch (_) {
          /* geste traité sans capture */
        }
      };

      if (this.project.ui.activeTool === 'light') {
        this.lightPointerId = event.pointerId;
        capture();
        this.moveLight(event);
        return;
      }

      capture();
      this.pushUndo();
      const point = this.toCm(event);
      this.stroke = { id: event.pointerId, lastX: point.xCm, lastY: point.yCm };
      this.applyStroke(event, true);
    });

    wrap.addEventListener('pointermove', (event) => {
      if (this.stroke && event.pointerId === this.stroke.id && this.pointers.size === 1) {
        event.preventDefault();
        this.applyStroke(event, false);
      } else if (this.lightPointerId === event.pointerId) {
        event.preventDefault();
        this.moveLight(event);
      }
    });

    // Les fins de geste sont écoutées sur la FENÊTRE, pas sur l'élément.
    // La version 1 les écoutait sur l'œuvre : un second doigt relevé en dehors
    // ne renvoyait jamais de `pointerup`, l'ensemble des pointeurs actifs ne
    // redescendait jamais à zéro et toute sculpture ultérieure restait bloquée.
    const release = (event) => {
      this.pointers.delete(event.pointerId);
      if (this.stroke && event.pointerId === this.stroke.id) this.endStroke();
      if (this.lightPointerId === event.pointerId) {
        this.lightPointerId = null;
        this.render();
        this.scheduleSaveProject();
      }
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  }

  toCm(event) {
    const rect = this.artWrap.getBoundingClientRect();
    const u = (event.clientX - rect.left) / rect.width;
    const v = (event.clientY - rect.top) / rect.height;
    return {
      xCm: (u - 0.5) * this.project.widthCm,
      yCm: (v - 0.5) * this.project.heightCm,
    };
  }

  applyStroke(event, first) {
    // `getCoalescedEvents()` peut renvoyer une liste VIDE — c'est le cas de tout
    // événement synthétique, et de certaines implémentations sur `pointerdown`.
    // Sans repli, le trait est silencieusement ignoré.
    const coalesced = event.getCoalescedEvents ? event.getCoalescedEvents() : null;
    const events = coalesced && coalesced.length ? coalesced : [event];
    let isFirst = first;
    for (const sample of events) {
      const { xCm, yCm } = this.toCm(sample);
      const pressure = sample.pressure > 0 ? sample.pressure : 0.55;
      const dxCm = isFirst ? 0 : xCm - this.stroke.lastX;
      const dyCm = isFirst ? 0 : yCm - this.stroke.lastY;
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
        first: isFirst,
      });
      if (rect) this.growDirty(rect);
      this.stroke.lastX = xCm;
      this.stroke.lastY = yCm;
      isFirst = false;
    }
    this.queuePatch();
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

  moveLight(event) {
    const rect = this.artWrap.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    let angle = (Math.atan2(y, x) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    this.project.lighting.angle = Math.round(angle);
    if (this.controls.lightAngle) this.controls.lightAngle.value = String(this.project.lighting.angle);
    this.markCustom();
    this.updateControlDisplays();
    if (!this.lightBusy) {
      this.lightBusy = true;
      requestAnimationFrame(() => {
        this.renderLowPreview();
        this.lightBusy = false;
      });
    }
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

    const randomize = () => {
      this.project.geometry.seed = Math.floor(1000 + Math.random() * 8999);
      this.project.ui.presetKey = null;
      this.project.ui.designName = 'Variation ' + this.project.geometry.seed;
      this.root.querySelectorAll('.preset').forEach((b) => b.classList.remove('active'));
      this.rebuild();
      this.scheduleSaveProject();
    };
    this.root.querySelector('#randomizeTop').addEventListener('click', randomize);
    this.root.querySelector('#randomizeMobile').addEventListener('click', randomize);

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
    this.buildAnimState();
    if (!this.anim.raf) this.anim.raf = requestAnimationFrame((ts) => this.animFrame(ts));
  }

  stopAnim() {
    if (this.anim.raf) cancelAnimationFrame(this.anim.raf);
    this.anim.raf = 0;
    this.anim.state = null;
    this.anim.avg = 0;
    this.render();
  }

  buildAnimState() {
    const quality = this.anim.quality;
    const scaled = {
      ...this.project,
      widthCm: this.project.widthCm,
      heightCm: this.project.heightCm,
    };
    const hm = buildHeightmap(scaled, this.layer, { withSwell: false });
    const n = hm.cols * hm.rows;
    const sx = new Float32Array(n);
    const sy = new Float32Array(n);
    const halfW = this.project.widthCm / 2;
    const halfH = this.project.heightCm / 2;
    const invW = 1 / this.project.widthCm;
    const invH = 1 / this.project.heightCm;
    for (let r = 0; r < hm.rows; r++) {
      const yCm = hm.yCmAt(r);
      const v = (yCm + halfH) * invH;
      for (let c = 0; c < hm.cols; c++) {
        const xCm = hm.xCmAt(c);
        const u = (xCm + halfW) * invW;
        const i = r * hm.cols + c;
        sx[i] = u + (this.layer.active ? this.layer.sample(this.layer.warpX, xCm, yCm) * invW : 0);
        sy[i] = v + (this.layer.active ? this.layer.sample(this.layer.warpY, xCm, yCm) * invH : 0);
      }
    }
    const { outW, outH } = this.outputSize();
    this.anim.state = {
      hm,
      staticMap: hm.h.slice(),
      sx,
      sy,
      canvas: document.createElement('canvas'),
      cache: createRenderCache(),
      outW: Math.max(64, Math.round(outW * quality)),
      outH: Math.max(1, Math.round(outH * quality)),
    };
  }

  animFrame(ts) {
    this.anim.raf = requestAnimationFrame((next) => this.animFrame(next));
    if (!this.anim.enabled || !this.anim.state || document.hidden || this.stroke || this.lightPointerId !== null) return;
    if (ts - this.anim.lastTs < 33) return;
    this.anim.lastTs = ts;

    const start = performance.now();
    this.drawAnimFrame(ts * 0.00045);
    const dt = performance.now() - start;
    this.anim.avg = this.anim.avg ? this.anim.avg * 0.8 + dt * 0.2 : dt;
    if (this.anim.avg > 30 && this.anim.quality > 0.2) {
      this.anim.quality = Math.max(0.2, this.anim.quality * 0.72);
      this.anim.avg = 0;
      this.buildAnimState();
    }
  }

  drawAnimFrame(phase) {
    const state = this.anim.state;
    const { hm, staticMap, sx, sy } = state;
    const { swellAmp, p1, p2, p3 } = hm.ctx;
    const tau = Math.PI * 2;
    for (let i = 0; i < staticMap.length; i++) {
      const x = sx[i];
      const y = sy[i];
      hm.h[i] =
        staticMap[i] +
        swellAmp *
          (0.5 * Math.sin((x * 0.8 + y * 0.55) * tau * 1.15 + p1 + phase) +
            0.32 * Math.sin((x * 0.45 - y * 1.05) * tau * 1.35 + p2 + phase * 0.7) +
            0.18 * Math.sin((x * 1.5 + y * 1.3) * tau * 0.8 + p3 + phase * 1.35));
    }
    renderFull(state.canvas, this.project, hm, state.outW, state.outH, state.cache);
    const ctx = this.canvas.getContext('2d', { alpha: true });
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.canvas, 0, 0, this.canvas.width, this.canvas.height);
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
