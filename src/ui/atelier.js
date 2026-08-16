// Contrôleur de l'atelier — relie l'état de projet, la heightmap canonique,
// le rendu 2D, la sculpture et la persistance.
//
// Principe qui n'existait pas en version 1 : un changement de LUMIÈRE ou de
// MATIÈRE ne reconstruit pas le relief. Seule la géométrie et la sculpture
// touchent à la heightmap. La v1 réévaluait tout le champ à chaque mouvement de
// curseur de lumière.

import { clamp } from '../core/math.js';
import { BOUNDS, PRESETS, applyPreset, aspectOf, baseGeometryOf, captureBase, fitLockedSize } from '../core/project.js';
import { EFFECTS, applyEffect } from '../core/effects.js';
import { GestureManager, ROLE } from './gestures.js';
import { Viewport } from './viewport.js';
import { nextVariation } from '../geometry/variation.js';
import { buildHeightmap, updateHeightmapRect } from '../geometry/heightmap.js';
import { createRenderCache, renderFull, renderPatch } from '../render2d/renderer.js';
import { brushAxes, stamp } from '../sculpt/brush.js';
import { DirectionTracker } from '../sculpt/direction.js';
import { SculptLayer } from '../sculpt/layer.js';
import { SculptHistory } from '../sculpt/history.js';
import { ProjectStore } from './persistence.js';
import { BINDINGS, TOOL_META } from './bindings.js';
import { ExportPanel } from './exportPanel.js';
import { ContextHelp } from './contextHelp.js';
import { MenuBar, RACCOURCIS } from './menuBar.js';
import { ColorDisc } from './colorDisc.js';
import { BrushCursor } from './brushCursor.js';
import { ProWorkspace } from './proWorkspace.js';
import { EffectPreviews } from './effectPreviews.js';

// Miroir de `.art-wrap { width: min(100%, 1080px) }`. Nommé plutôt que recopié
// nu : une valeur en pixels perdue dans un calcul se relit comme une marge.
const ART_MAX_WIDTH_PX = 1080;

// Miroirs appliqués à un coup de brosse selon la symétrie choisie. Le premier
// est toujours l'identité : le geste réel part en premier, les copies suivent.
const SYMETRIES = {
  none: [[1, 1]],
  x: [[1, 1], [-1, 1]],
  y: [[1, 1], [1, -1]],
  xy: [[1, 1], [-1, 1], [1, -1], [-1, -1]],
};

export class Atelier {
  constructor(root, { project, layer, onNewProject }) {
    this.root = root;
    // UN SEUL INTERRUPTEUR POUR TOUS LES ÉCOUTEURS.
    //
    // Les éléments du document — barre d'outils, boutons, curseurs — SURVIVENT
    // au changement de projet : c'est le même `#atelier` qui sert à l'atelier
    // suivant. Chaque atelier construit y reposait donc ses écouteurs sans que
    // les précédents ne retirent les leurs, et chacun restait refermé sur SON
    // projet, désormais périmé.
    //
    // Mesuré : après l'ouverture d'un second projet dans la même page, un clic
    // sur « Exporter » produisait DEUX fichiers — le bon, et un second aux
    // dimensions de l'ancien projet. Le reste dormait derrière.
    //
    // `AbortController` retire tout d'un coup dans `destroy`, sans registre à
    // tenir à jour ni risque d'en oublier un.
    this.listeners = new AbortController();
    this.signal = this.listeners.signal;
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
    this.store = new ProjectStore({
      statusElement: root.querySelector('#saveStatus'),
      // Le projet est RELU à chaque écriture : choisir un préréglage remplace
      // `this.project`, et une référence figée enregistrerait l'ancien.
      lire: () => ({ project: this.project, layer: this.layer }),
    });
    this.hintSymbol = root.querySelector('#hintSymbol');
    this.undoBtn = root.querySelector('#undoBtn');
    this.redoBtn = root.querySelector('#redoBtn');
    this.brushSize = root.querySelector('#brushSize');
    this.brushStrength = root.querySelector('#brushStrength');
    this.brushElongation = root.querySelector('#brushElongation');
    this.brushAngle = root.querySelector('#brushAngle');
    this.brushFollow = root.querySelector('#brushFollow');
    this.symmetry = root.querySelector('#symmetry');
    this.brushGhost = null;
    this.brushGhostTimer = 0;
    this.heightControl = root.querySelector('#heightControl');
    this.widthLabel = root.querySelector('#widthLabel');

    this.controls = {};
    for (const id of Object.keys(BINDINGS)) this.controls[id] = root.querySelector('#' + id);

    this.cache = createRenderCache();
    this.previewCanvas = document.createElement('canvas');
    this.previewCache = createRenderCache();
    this.hm = null;
    this.renderToken = 0;

    this.history = new SculptHistory({
      lireCalque: () => this.layer,
      boutons: { undo: this.undoBtn, redo: this.redoBtn },
      onRestore: () => {
        this.rebuild();
        this.store.scheduleSculpt();
      },
    });
    this.stroke = null;
    this.strokeDirty = null;
    this.patchQueued = false;
    this.lightBusy = false;
    this.lightMoved = false;
    // Vrai dès qu'un geste occupe l'atelier, quel que soit son rôle.
    this.gestureActive = false;
    this.resize = null;
    // L'application finale est volontairement 2D : l'aperçu et le PNG partagent
    // la même heightmap, sans charger un second moteur de visualisation.

    // Produit statique : aucune boucle d'animation ne concurrence les gestes ou
    // le rendu. L'adaptateur garde les appels historiques sans charger le code.

    this.saveProjectTimer = 0;
    this.saveSculptTimer = 0;

    this.viewport = new Viewport(this.artWrap, this.stage, {
      onChange: () => {
        this.project.ui.viewport = this.viewport.serialize();
        const zoomReadout = this.root.querySelector('#zoomReadout');
        if (zoomReadout) zoomReadout.textContent = `${Math.round(this.viewport.zoom * 100)} %`;
        this.scheduleSaveProject();
      },
    });
    this.viewport.restore(this.project.ui.viewport);

    this.bindControls();
    this.bindTools();
    this.bindGestures();
    this.bindResizeHandle();
    this.bindDocks();
    // Aide contextuelle : elle lit l'outil actif, rien de plus.
    this.contextHelp = new ContextHelp(root, {
      signal: this.signal,
      lireOutil: () => this.project.ui.activeTool,
    });

    // Barre de menus : elle ne fait que cliquer les commandes existantes.
    this.menuBar = new MenuBar(root, {
      signal: this.signal,
      onAide: (sujet) => this.montrerAide(sujet),
    });

    // Pointeur de brosse : l'empreinte réelle sous le doigt, miroirs compris.
    this.brushCursor = new BrushCursor(this.artWrap, {
      signal: this.signal,
      lire: () => ({
        outil: this.project.ui.activeTool,
        rayonCm: this.project.ui.brushSizeCm,
        elongation: this.project.ui.brushElongation || 0,
        angleDeg: this.project.ui.brushAngle || 0,
        suitLeTrace: !!this.project.ui.brushFollowStroke,
        angleTrace: this.stroke?.direction?.angleDeg(this.project.ui.brushAngle || 0) ?? 0,
        symetrie: this.project.ui.symmetry || 'none',
        largeurCm: this.project.widthCm,
        hauteurCm: this.project.heightCm,
      }),
    });

    // Disques de couleur : ils écrivent dans les `<input type="color">` existants.
    this.colorDiscs = [...root.querySelectorAll('[data-color-disc]')].map((hote) => {
      const cible = root.querySelector('#' + hote.dataset.colorDisc);
      return cible ? new ColorDisc(cible, hote, { signal: this.signal }) : null;
    }).filter(Boolean);

    this.exportPanel = new ExportPanel(root, {
      lire: () => ({ project: this.project, hm: this.hm }),
      rendering: this.rendering,
      signal: this.signal,
    });
    this.proWorkspace = new ProWorkspace(root, {
      lire: () => this.project,
      onRestoreVariation: (snapshot) => {
        this.project.geometry = snapshot.geometry;
        this.project.ui.designName = snapshot.designName;
        this.project.ui.presetKey = snapshot.presetKey;
        this.syncControlsFromProject();
        this.rebuild();
        this.scheduleSaveProject();
      },
      onWorkspaceMode: (mode) => {
        if (mode === 'sculpture') {
          this.setTool('dig');
          this.proWorkspace.openInspector('sculpture');
        } else if (mode === 'presentation') {
          this.setTool('light');
          this.proWorkspace.openInspector('lumiere');
        } else {
          this.setTool('light');
          this.proWorkspace.openInspector('composition');
        }
        this.scheduleSaveProject();
      },
      onApplyEffect: (key) => {
        const effect = EFFECTS[key];
        if (!effect) return;
        this.project = applyEffect(this.project, key);
        this.syncControlsFromProject();
        if (effect.scope === 'geometry') {
          this.rebuild();
          this.proWorkspace?.recordVariation('Effet de forme');
        } else {
          this.updateEnvironment();
          this.render();
        }
        this.contextHelp?.afficher(effect.name, effect.description);
        this.scheduleSaveProject();
      },
    });
    this.bindMisc();

    this.syncControlsFromProject();
    this.applyShapeToDom();
    this.rebuild();

    // Les vignettes de la boutique passent APRÈS le premier relief : elles
    // coûtent onze reconstructions de champ, et l'œuvre de l'utilisateur passe
    // avant le catalogue. Elles se calculent ensuite une par image.
    this.boutique = new EffectPreviews(root, { signal: this.signal });
    this.boutique.monter();

    // Les barres se placent d'après leur taille MESURÉE, or `bindDocks` a couru
    // avant que `syncControlsFromProject` ne remplisse les valeurs affichées :
    // la barre d'outils était alors plus courte de 13 px qu'elle ne le serait,
    // et son bord bas finissait 9 px sous la fenêtre. On la replace une fois le
    // contenu définitif en place.
    // Plus aucune barre flottante à replacer : la mise en page les tient.

    this.resizeTimer = 0;
    this.observer = new ResizeObserver(() => {
      // Le cadrage est immédiat — il ne coûte que deux lectures de boîte — et
      // seul le rendu attend. Le différer aurait laissé l'œuvre déborder
      // pendant 120 ms à chaque changement de taille de fenêtre.
      this.fitArtWrap();
      clearTimeout(this.resizeTimer);
      // Simple changement de taille d'affichage : le relief ne change pas,
      // seule la résolution de sortie est refaite.
      this.resizeTimer = setTimeout(() => {
        this.render();
      }, 120);
    });
    // On observe la SCÈNE, pas l'œuvre : observer l'œuvre alors qu'on la
    // redimensionne soi-même ferait une boucle de rétroaction.
    this.observer.observe(this.stage);

    // `pagehide` plutôt que `beforeunload` : sur iOS c'est le seul des deux qui
    // se déclenche de façon fiable quand Safari met l'onglet de côté.
    this.onWindow('pagehide', () => this.flushSaves());
    this.onWindow('visibilitychange', () => {
      if (document.hidden) this.flushSaves();
    });
  }

  // ---- Liaison des contrôles ----

  bindControls() {
    for (const [id, binding] of Object.entries(BINDINGS)) {
      const el = this.controls[id];
      if (!el) continue;
      const eventName = binding.kind === 'select' || binding.kind === 'checkbox' || binding.kind === 'color' ? 'change' : 'input';
      this.ecouter(el, eventName, () => {
        const raw = binding.kind === 'checkbox' ? el.checked : binding.kind === 'color' || binding.kind === 'select' ? el.value : Number(el.value);
        this.applyChange(id, binding, raw);
      });
    }

    for (const el of [this.brushSize, this.brushStrength, this.brushElongation, this.brushAngle]) {
      if (!el) continue;
      this.ecouter(el, 'input', () => {
        this.project.ui.brushSizeCm = Number(this.brushSize.value);
        this.project.ui.brushStrength = Number(this.brushStrength.value) / 100;
        this.project.ui.brushElongation = Number(this.brushElongation.value) / 100;
        this.project.ui.brushAngle = Number(this.brushAngle.value);
        this.updateBrushDisplays();
        // Trois réglages sur quatre ne se voient nulle part avant le premier
        // trait : on montre l'empreinte réelle le temps du réglage.
        if (el !== this.brushStrength) this.flashBrushGhost();
        this.scheduleSaveProject();
      });
    }

    if (this.symmetry) {
      this.ecouter(this.symmetry, 'change', () => {
        this.project.ui.symmetry = this.symmetry.value;
        this.updateBrushDisplays();
        this.scheduleSaveProject();
      });
    }

    if (this.brushFollow) {
      this.ecouter(this.brushFollow, 'change', () => {
        this.project.ui.brushFollowStroke = this.brushFollow.checked;
        this.updateBrushDisplays();
        this.flashBrushGhost();
        this.scheduleSaveProject();
      });
    }
  }

  /**
   * Reconstruit à qualité réduite tant que le geste dure, à pleine qualité
   * quand il s'arrête.
   *
   * POURQUOI. Les trois familles procédurales introduites avec la boutique
   * d'effets coûtent bien plus cher que le champ d'origine : mesuré sur un
   * panneau de 200 × 120 cm, une reconstruction complète prend de 460 à 580 ms
   * par 200 000 cellules, contre une centaine auparavant. Or `applyChange`
   * reconstruisait à PLEINE qualité à chaque évènement `input` — soit à chaque
   * pixel parcouru par le curseur. Le réglage devenait impraticable.
   *
   * La grille d'aperçu est deux fois plus grossière, donc quatre fois moins de
   * cellules. Le relief est le MÊME champ, seulement échantillonné plus large :
   * c'est la garantie que donne `buildHeightmap(…, { quality })`, et c'est déjà
   * ce que fait l'aperçu de redimensionnement.
   */
  rebuildInteractif() {
    clearTimeout(this.finGeste);
    this.rebuild({ quality: 0.5 });
    // 220 ms sans nouvel évènement : le curseur est relâché ou la main s'est
    // arrêtée. On repasse alors à la grille complète.
    this.finGeste = setTimeout(() => this.rebuild(), 220);
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
      this.rebuildInteractif();
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
    if (this.brushElongation) this.brushElongation.value = String(Math.round((this.project.ui.brushElongation || 0) * 100));
    if (this.brushAngle) this.brushAngle.value = String(Math.round(this.project.ui.brushAngle || 0));
    if (this.brushFollow) this.brushFollow.checked = !!this.project.ui.brushFollowStroke;
    if (this.symmetry) this.symmetry.value = this.project.ui.symmetry || 'none';
    this.setTool(this.project.ui.activeTool || 'light');
    this.root.querySelectorAll('.preset').forEach((button) => {
      const actif = button.dataset.preset === this.project.ui.presetKey;
      button.classList.toggle('active', actif);
      button.setAttribute('aria-pressed', String(actif));
    });
    this.syncFamilyControls();
    this.updateControlDisplays();
    this.updateBrushDisplays();
    this.refreshBaseButton();
    this.syncMiniPalette();
    this.proWorkspace?.sync();
  }

  /**
   * Grise les commandes que la famille procédurale courante n'écoute pas.
   *
   * Le réseau de chenaux n'existe que dans la famille `organic` — voir la note
   * de `channelCarve` dans `field.js`, où l'extension aux autres familles est
   * mesurée et rejetée. Sur Cellules et Archipel, la molette « Chenaux » ne
   * changeait donc RIEN : douze réglages différents, la même image au bit près.
   *
   * Une commande visible qui n'agit pas est un mensonge. Elle est désormais
   * désactivée et dit pourquoi ; l'aide contextuelle reprend la même phrase.
   */
  syncFamilyControls() {
    const molette = this.controls.channelWeight;
    if (!molette) return;
    const famille = this.project.geometry.family || 'organic';
    const inerte = famille !== 'organic';
    molette.disabled = inerte;
    const etiquette = molette.closest('.control');
    etiquette?.classList.toggle('control-inert', inerte);
    etiquette?.setAttribute(
      'title',
      inerte
        ? 'Les chenaux appartiennent à la famille « organique ». Cette composition n’en a pas.'
        : 'Force des veines qui relient les cavités entre elles.'
    );
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

    const suit = !!this.project.ui.brushFollowStroke;
    const { aspect } = brushAxes(1, this.project.ui.brushElongation || 0);
    const elongationOut = this.root.querySelector('#brushElongationValue');
    const angleOut = this.root.querySelector('#brushAngleValue');
    // Le rapport est plus parlant qu'un pourcentage : « 3,0 : 1 » se lit, « 50 % »
    // demande de connaître la formule.
    if (elongationOut) elongationOut.value = aspect < 1.02 ? 'ronde' : `${aspect.toFixed(1).replace('.', ',')} : 1`;
    if (angleOut) angleOut.value = suit ? 'du geste' : `${this.brushAngle.value}°`;

    const angleField = this.root.querySelector('#brushAngleField');
    if (angleField) angleField.classList.toggle('is-disabled', suit);
    if (this.brushAngle) this.brushAngle.disabled = suit;

    this.paintBrushPreview('#brushPreviewShape');

    for (const el of [this.brushSize, this.brushStrength, this.brushElongation, this.brushAngle]) {
      if (!el) continue;
      const min = Number(el.min);
      const max = Number(el.max);
      el.style.setProperty('--range', (((Number(el.value) - min) / (max - min)) * 100).toFixed(2) + '%');
    }
    this.syncMiniPalette();
  }

  /**
   * Dessine l'aperçu de brosse. Les facteurs d'échelle viennent de `brushAxes`,
   * la fonction que le moteur emploie : la pastille montre l'ellipse qui
   * creusera, et non une approximation dessinée à côté.
   */
  paintBrushPreview(selector) {
    const el = this.root.querySelector(selector);
    if (!el) return;
    const { a, b } = brushAxes(1, this.project.ui.brushElongation || 0);
    const suit = !!this.project.ui.brushFollowStroke;
    el.style.setProperty('--brush-scale-x', a.toFixed(4));
    el.style.setProperty('--brush-scale-y', b.toFixed(4));
    // En mode « suit le tracé », l'aperçu se met à plat : l'angle n'est plus un
    // réglage, il vient du geste, et afficher un angle figé mentirait.
    el.style.setProperty('--brush-angle', `${suit ? 0 : this.project.ui.brushAngle || 0}deg`);
  }

  /**
   * Montre l'empreinte réelle de la brosse au centre de l'œuvre, le temps du
   * réglage. Le fantôme est dimensionné en CENTIMÈTRES convertis en pixels par
   * l'échelle d'affichage courante : ce qu'on voit est ce que la brosse couvre.
   */
  flashBrushGhost() {
    if (!this.artWrap) return;
    if (!this.brushGhost) {
      this.brushGhost = document.createElement('div');
      this.brushGhost.className = 'brush-ghost';
      this.artWrap.append(this.brushGhost);
    }
    const rect = this.artWrap.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pxParCm = rect.width / this.project.widthCm;
    const { a, b } = brushAxes(this.project.ui.brushSizeCm, this.project.ui.brushElongation || 0);
    const suit = !!this.project.ui.brushFollowStroke;
    const angle = suit ? 0 : this.project.ui.brushAngle || 0;
    const w = 2 * a * pxParCm;
    const h = 2 * b * pxParCm;
    this.brushGhost.style.width = `${w.toFixed(1)}px`;
    this.brushGhost.style.height = `${h.toFixed(1)}px`;
    this.brushGhost.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
    this.brushGhost.classList.add('show');
    clearTimeout(this.brushGhostTimer);
    this.brushGhostTimer = setTimeout(() => this.brushGhost && this.brushGhost.classList.remove('show'), 900);
  }

  /**
   * Cale l'œuvre dans la scène en respectant SES DEUX bords.
   *
   * `.art-wrap` porte `width: min(100%, 1080px)` et `aspect-ratio` : sa hauteur
   * se déduit donc de sa largeur, et le `max-height: 100%` prévu pour la borner
   * n'est pas honoré — mesuré 978 × 612 dans une scène de 510 px de haut, soit
   * une œuvre dont le bas sortait de la fenêtre. On calcule donc la largeur
   * utile depuis la scène RÉELLEMENT mesurée : la plus petite des deux
   * contraintes gagne, et le rapport de la toile est préservé dans tous les cas.
   */
  fitArtWrap() {
    if (!this.stage) return;
    const aspect = aspectOf(this.project) || 1;
    // `clientWidth`/`clientHeight` excluent la bordure mais PAS le rembourrage :
    // on le retranche, sinon l'œuvre déborderait exactement de sa marge.
    const style = getComputedStyle(this.stage);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const dispoW = Math.max(1, this.stage.clientWidth - padX);
    const dispoH = Math.max(1, this.stage.clientHeight - padY);

    const largeur = Math.min(dispoW, dispoH * aspect, ART_MAX_WIDTH_PX);
    this.artWrap.style.width = `${Math.floor(largeur)}px`;
  }

  applyShapeToDom() {
    const aspect = aspectOf(this.project);
    this.artWrap.style.setProperty('--canvas-aspect', String(aspect));
    this.fitArtWrap();
    this.artWrap.dataset.shape = this.project.canvasShape;
    const shapeLocked = this.project.canvasShape !== 'rectangle';
    if (this.heightControl) this.heightControl.hidden = shapeLocked;

    // LES BORNES DU CURSEUR SUIVENT LA FORME. Le balisage donne 1 à 500 cm pour
    // toutes les formes, alors que `BOUNDS` plafonne le carré et le rond à 200.
    // On pouvait donc porter un panneau rond à 400 cm au curseur, puis le voir
    // ramené d'un coup à 200 au premier contact avec la poignée — le calque
    // ayant entre-temps été réalloué pour 400.
    const bornes = BOUNDS[this.project.canvasShape] || BOUNDS.rectangle;
    if (this.controls.widthCm) {
      this.controls.widthCm.min = String(bornes.widthCm.min);
      this.controls.widthCm.max = String(bornes.widthCm.max);
      if (Number(this.controls.widthCm.value) > bornes.widthCm.max) {
        this.project.widthCm = bornes.widthCm.max;
        this.controls.widthCm.value = String(bornes.widthCm.max);
      }
    }
    if (this.widthLabel) this.widthLabel.textContent = this.project.canvasShape === 'circle' ? 'Diamètre' : shapeLocked ? 'Côté' : 'Largeur';

    // Le cadenas n'a de sens que pour le rectangle : le carré et le rond
    // imposent 1:1 par définition, pas par réglage.
    const lock = this.root.querySelector('#ratioLock');
    if (lock) {
      lock.hidden = shapeLocked;
      lock.setAttribute('aria-pressed', String(!!this.project.ui.ratioLocked));
    }
    // La transparence d'export ne concerne que le disque : le panneau d'export
    // doit suivre un changement de forme.
    if (this.exportPanel) this.exportPanel.refresh();
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
  rebuild({ quality = 1 } = {}) {
    const token = ++this.renderToken;
    this.rendering.classList.add('show');
    // Le report d'une image sert à peindre l'indicateur avant le calcul. Dans un
    // onglet en arrière-plan, requestAnimationFrame ne se déclenche pas du tout :
    // un projet rouvert dans un onglet inactif ne se construirait jamais et le
    // canvas resterait à sa taille par défaut. On bascule alors sur un timer.
    const defer = document.hidden ? (fn) => setTimeout(fn, 0) : requestAnimationFrame;
    defer(() => {
      if (token !== this.renderToken) return;
      this.hm = buildHeightmap(this.project, this.layer, quality === 1 ? {} : { quality });
      this.render();
      this.rendering.classList.remove('show');
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
      this.ecouter(button, 'click', () => {
        this.setTool(button.dataset.tool);
        this.scheduleSaveProject();
      });
    });

    this.ecouter(this.undoBtn, 'click', () => this.history.undo());
    this.ecouter(this.redoBtn, 'click', () => this.history.redo());
  }

  setTool(tool) {
    this.project.ui.activeTool = tool;
    // `aria-pressed` en plus de la classe : l'état actif ne vivait que dans le
    // CSS, donc invisible à un lecteur d'écran — six boutons identiques à
    // l'oreille, sans moyen de savoir lequel est choisi.
    this.root.querySelectorAll('.tool[data-tool]').forEach((b) => {
      const actif = b.dataset.tool === tool;
      b.classList.toggle('active', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
    const meta = TOOL_META[tool] || TOOL_META.light;
    this.hintSymbol.textContent = meta.icon;
    this.hintText.textContent = meta.hint;
    // L'aide contextuelle retombe sur l'outil quand rien n'est survolé : elle
    // doit donc suivre le changement d'outil, pas attendre le geste suivant.
    this.contextHelp?.montrerOutil();
    // Les entrées de menu héritent de l'état des boutons : un changement d'outil
    // peut activer ou griser « Effacer la sculpture ».
    this.menuBar?.rafraichir();
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
        if (role !== ROLE.NONE) this.lastRole = role;
        // L'animation est suspendue pendant TOUT geste, quel qu'il soit : il n'y
        // a donc aucune interaction animation × pinch × trait à gérer.
        this.gestureActive = role !== ROLE.NONE;
      },
      onSculptStart: (p) => {
        this.history.push();
        this.beginStroke(p);
      },
      onSculptMove: (p) => this.continueStroke(p),
      onSculptEnd: () => this.endStroke(),
      onLightStart: (p) => this.moveLight(p),
      onLightMove: (p) => this.moveLight(p),
      onCameraStart: (s) => this.viewport.beginPinch(s),
      onCameraMove: (s) => {
        if (!s) return;
        this.viewport.updatePinch(s);
      },
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

    this.ecouter(stage, 'pointerdown', (event) => {
      const p = toPointer(event);
      const zone = this.zoneOf(p);
      // On ne confisque jamais un pointeur destiné à l'interface : les boutons
      // et les curseurs doivent continuer de fonctionner normalement.
      if (zone !== 'ui') event.preventDefault();

      // §10 demande aussi une double tape extérieure pour recentrer. Elle n'est
      // PAS implémentée : trois montages successifs (fin de rôle, `pointerup` de
      // fenêtre, `pointerdown` de scène) n'ont jamais déclenché avec des
      // évènements synthétiques, sans erreur ni trace, et je n'ai pas de tactile
      // réel pour trancher. Plutôt que de laisser du code qui prétend tenir
      // l'exigence, il est retiré : le bouton « Vue face » assure le recentrage,
      // et lui est vérifié.
      this.gestures.pointerDown(p);
    });

    this.ecouter(stage, 'pointermove', (event) => {
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
    this.onWindow('pointerup', (event) => {
      if (this.gestures.pointerCount === 0) return;
      this.gestures.pointerUp(toPointer(event));
      this.afterGesture();
    });
    this.onWindow('pointercancel', (event) => {
      if (this.gestures.pointerCount === 0) return;
      this.gestures.pointerCancel(toPointer(event));
      this.afterGesture();
    });
    this.onWindow('blur', () => {
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
    // En volume, l'œuvre n'est pas une surface d'édition : tout glisser à un
    // pointeur y tourne la caméra, qu'il parte de l'œuvre ou d'à côté (§10).
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
    // Le suiveur de direction est remis à neuf à chaque trait : l'orientation
    // ne se reporte pas d'un geste au suivant.
    this.stroke = { lastX: xCm, lastY: yCm, direction: new DirectionTracker() };
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

  /**
   * Orientation à donner à la brosse pour ce coup (§6).
   *
   * En mode manuel c'est le réglage, tel quel. En mode « suit le tracé », c'est
   * la direction du geste, lissée en angle double — voir `FOLLOW_SMOOTHING`.
   */
  strokeAngleDeg(dxCm, dyCm) {
    const ui = this.project.ui;
    if (!ui.brushFollowStroke || !this.stroke) return ui.brushAngle || 0;
    this.stroke.direction.push(dxCm, dyCm);
    // Tant que le geste n'a pas fourni de direction — au tout premier contact,
    // où le déplacement est nul par définition — on garde le réglage manuel.
    return this.stroke.direction.angleDeg(ui.brushAngle || 0);
  }

  stampAt(xCm, yCm, dxCm, dyCm, pressure, first) {
    // L'orientation se calcule UNE fois : `strokeAngleDeg` fait avancer le
    // suiveur de direction, et l'appeler par miroir ferait tourner la brosse
    // quatre fois plus vite qu'il n'y a de gestes.
    const angleDeg = this.strokeAngleDeg(dxCm, dyCm);
    const miroirs = SYMETRIES[this.project.ui.symmetry] || SYMETRIES.none;
    for (const [sx, sy] of miroirs) {
      const rect = stamp(this.layer, {
        tool: this.project.ui.activeTool,
        xCm: sx * xCm,
        yCm: sy * yCm,
        dxCm: sx * dxCm,
        dyCm: sy * dyCm,
        radiusCm: this.project.ui.brushSizeCm,
        strength: this.project.ui.brushStrength,
        pressure,
        elongation: this.project.ui.brushElongation,
        // Un seul miroir retourne l'ellipse ; deux la remettent d'aplomb.
        angleDeg: sx * sy < 0 ? -angleDeg : angleDeg,
        first,
      });
      if (rect) this.growDirty(rect);
    }
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
    // Le jeton est relu à l'arrivée : `#reliefCanvas` est PARTAGÉ entre ateliers
    // successifs, et un patch en vol au moment d'un changement de projet
    // peindrait le relief de l'ancien par-dessus le nouveau.
    const token = this.renderToken;
    requestAnimationFrame(() => {
      this.patchQueued = false;
      if (token !== this.renderToken) return;
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
    this.proWorkspace?.recordVariation('Variation générée');
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
    this.history.push();
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

  // ---- Vue 2D ----

  // Ces passe-plats restent appelés par le cycle de rendu historique. Ils sont
  // intentionnellement vides : aucune ressource WebGL n'est chargée pour un
  // produit dont l'unique sortie est une image PNG.
  recentreView() {
    this.viewport.reset();
    this.render();
  }

  // ---- Redimensionnement physique de la toile (§3) ----
  //
  // À ne jamais confondre avec le zoom : ici ce sont les CENTIMÈTRES du panneau
  // qui changent. Le champ étant ancré en centimètres, agrandir révèle du motif
  // supplémentaire sans déplacer celui qui est déjà là — le relief n'est donc
  // jamais étiré, il est réévalué sur une fenêtre plus large.

  bindResizeHandle() {
    const lock = this.root.querySelector('#ratioLock');
    this.ecouter(lock, 'click', () => {
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
      // l'autre dimension suit exactement. Le bornage se fait sur la LARGEUR
      // seule, dans l'intervalle où la hauteur induite reste légale — plafonner
      // les deux séparément rompait le verrou contre des bornes asymétriques.
      const ratio = r.startW / r.startH;
      const vise = Math.abs(p.x - r.startX) >= Math.abs(p.y - r.startY) ? widthCm : heightCm * ratio;
      const ajuste = fitLockedSize(this.project.canvasShape, ratio, vise);
      widthCm = ajuste.widthCm;
      heightCm = ajuste.heightCm;
    } else {
      widthCm = clamp(Math.round(widthCm), bounds.widthCm.min, bounds.widthCm.max);
      const heightBound = bounds.heightCm || bounds.widthCm;
      heightCm = clamp(Math.round(heightCm), heightBound.min, heightBound.max);
    }
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
    const token = this.renderToken;
    requestAnimationFrame(() => {
      this.resizePreviewQueued = false;
      if (token !== this.renderToken || !this.resize) return;
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
    // La mini-palette a été retirée : depuis la refonte, son bouton d'ouverture
    // gardait un attribut `hidden` jamais levé, si bien qu'elle était devenue
    // inatteignable — et la barre d'outils, désormais permanente au-dessus de
    // l'œuvre, en tenait déjà le rôle. Ne reste donc aucune barre flottante.
    this.ecouter(this.root.querySelector('#resetView'), 'click', () => this.recentreView());
  }

  /** La mini-palette n'existe plus ; ce point d'entrée reste appelé ailleurs. */
  syncMiniPalette() {}

  /** Entrées du menu Aide : elles écrivent dans l'encart d'aide, pas ailleurs. */
  montrerAide(sujet) {
    if (sujet === 'raccourcis') {
      this.contextHelp?.afficher('Raccourcis clavier', RACCOURCIS.map(([k, v]) => `${k} — ${v}`).join(' · '));
    } else if (sujet === 'apropos') {
      this.contextHelp?.afficher(
        'Atelier de relief organique',
        'Le relief est calculé en centimètres réels, dans votre navigateur. Rien n’est envoyé nulle part, et l’image exportée part de la même carte de hauteurs que l’aperçu.'
      );
    }
  }

  // ---- Divers ----

  bindMisc() {
    this.root.querySelectorAll('.preset').forEach((button) => {
      this.ecouter(button, 'click', () => {
        this.project = applyPreset(this.project, button.dataset.preset);
        this.syncControlsFromProject();
        this.rebuild();
        this.scheduleSaveProject();
        this.proWorkspace?.recordVariation('Préréglage');
      });
    });

    const variation = () => this.newVariation();
    this.ecouter(this.root.querySelector('#variationTop'), 'click', variation);
    this.ecouter(this.root.querySelector('#variationMobile'), 'click', variation);
    this.ecouter(this.root.querySelector('#newVariation'), 'click', variation);
    this.ecouter(this.root.querySelector('#setBase'), 'click', () => this.setBase());
    this.ecouter(this.root.querySelector('#restoreBase'), 'click', () => this.restoreBase());


    this.ecouter(this.root.querySelector('#newProject'), 'click', () => this.onNewProject());

    this.ecouter(this.root.querySelector('#clearSculpt'), 'click', () => {
      this.history.push();
      this.layer.clear();
      this.rebuild();
      this.scheduleSaveSculpt();
    });

    // Raccourcis. Ils CLIQUENT les commandes existantes plutôt que d'appeler
    // les méthodes : un raccourci ne peut donc pas faire autre chose que le
    // bouton qu'il annonce, et il hérite de son état désactivé.
    const LETTRE_OUTIL = { l: 'light', o: 'warp', c: 'dig', b: 'raise', s: 'smooth', g: 'erase' };
    this.onWindow('keydown', (event) => {
      const dansUnChamp = /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName || '') || event.target?.isContentEditable;
      if (!dansUnChamp && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const outil = LETTRE_OUTIL[event.key.toLowerCase()];
        if (outil) {
          event.preventDefault();
          this.root.querySelector(`.tool[data-tool="${outil}"]`)?.click();
          return;
        }
      }
      if (event.ctrlKey || event.metaKey) {
        const cibles = { e: '#exportRun', r: '#variationTop', n: '#newProject', 0: '#resetView' };
        const selecteur = cibles[event.key.toLowerCase()];
        if (selecteur) {
          const bouton = this.root.querySelector(selecteur);
          if (bouton && !bouton.disabled) {
            event.preventDefault();
            bouton.click();
            return;
          }
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) this.history.redo();
        else this.history.undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        this.history.redo();
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
    this.ecouter(drawerToggle, 'click', () => setDrawer(!sidebar.classList.contains('open')));
    this.ecouter(backdrop, 'click', () => setDrawer(false));
    // Échap ferme le tiroir et rend le focus à son bouton : sans cela, un
    // utilisateur au clavier entrait dans le tiroir sans pouvoir en sortir.
    this.onWindow('keydown', (event) => {
      if (event.key !== 'Escape' || !sidebar.classList.contains('open')) return;
      setDrawer(false);
      drawerToggle.focus();
    });

    // « Paramètres avancés » était un `<div>` orné d'un chevron qui ne repliait
    // rien. C'est maintenant un vrai dépliant.
    const avance = this.root.querySelector('#advancedToggle');
    const sections = this.root.querySelector('#inspectorSections');
    if (avance && sections) {
      const replier = (ouvert) => {
        avance.setAttribute('aria-expanded', String(ouvert));
        sections.hidden = !ouvert;
      };
      replier(true);
      this.ecouter(avance, 'click', () => replier(avance.getAttribute('aria-expanded') !== 'true'));
    }

    // La poignée de redimensionnement recevait le focus sans rien faire au
    // clavier. Les flèches ajustent maintenant le panneau centimètre par
    // centimètre, Maj par pas de dix.
    const poignee = this.root.querySelector('#resizeHandle');
    if (poignee) {
      this.ecouter(poignee, 'keydown', (event) => {
        const pas = (event.shiftKey ? 10 : 1) * (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1);
        const axe = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 'widthCm' : ['ArrowUp', 'ArrowDown'].includes(event.key) ? 'heightCm' : null;
        if (!axe) return;
        event.preventDefault();
        const commande = this.controls[axe];
        if (!commande || commande.disabled) return;
        const min = Number(commande.min);
        const max = Number(commande.max);
        commande.value = String(clamp(Number(commande.value) + pas, min, max));
        commande.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
  }

  /**
   * Pose un écouteur lié au cycle de vie de cet atelier : `destroy` le retire.
   * Toute liaison de l'atelier passe par ici, y compris sur `window`.
   */
  ecouter(cible, type, handler, options = {}) {
    cible.addEventListener(type, handler, { ...options, signal: this.signal });
  }

  onWindow(type, handler, options) {
    this.ecouter(window, type, handler, options);
  }

  // ---- Persistance ----
  //
  // Déléguée à `ProjectStore` depuis le lot 8. Ces trois passe-plats existent
  // parce que `main.js` et la vue 3D appellent l'atelier, pas son magasin.

  setSaveStatus(message) {
    this.store.setStatus(message);
  }

  saveProjectNow() {
    return this.store.saveProjectNow();
  }

  disableStorage(reason) {
    this.store.disable(reason);
  }

  flushSaves() {
    this.store.flush();
  }

  scheduleSaveProject() {
    this.store.scheduleProject();
  }

  scheduleSaveSculpt() {
    this.store.scheduleSculpt();
  }

  show() {
    this.root.hidden = false;
    this.render();
  }

  hide() {
    this.root.hidden = true;
  }

  destroy() {
    // INVALIDER LE JETON DE RENDU. `rebuild()` diffère son calcul d'une image —
    // `requestAnimationFrame` en onglet visible, `setTimeout` en onglet caché,
    // et ce dernier peut être retardé de plusieurs secondes par le bridage des
    // onglets d'arrière-plan. Sans cette ligne, un atelier détruit terminait sa
    // reconstruction en attente et repeignait `#reliefCanvas`, qui est PARTAGÉ
    // avec l'atelier suivant : l'œuvre affichée était alors celle du projet
    // précédent, jusqu'au prochain rendu.
    //
    // Mesuré au lot 8 : après une séquence chargée, le premier projet rouvert
    // affichait le relief de l'ancien — deux images stables et différentes pour
    // un même projet, selon qu'un rendu fantôme était encore en vol.
    this.renderToken++;
    // Le report de 120 ms de l'observateur de taille n'était jamais annulé :
    // redimensionner la fenêtre puis ouvrir un autre projet dans l'intervalle
    // faisait rendre l'ancien atelier sur le canvas du nouveau.
    clearTimeout(this.resizeTimer);
    clearTimeout(this.finGeste);
    this.observer.disconnect();
    this.store.destroy();
    this.listeners.abort();
    this.proWorkspace?.destroy();
  }
}

function trim(value) {
  return String(Math.round(value * 10) / 10);
}

export { PRESETS };
