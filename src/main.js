// Amorçage : écran de création ou reprise du dernier projet.

import './styles.css';
import { createProject, defaultCamera, defaultGeometry, defaultLighting, defaultMaterial, defaultPresentation, defaultUi } from './core/project.js';
import { SculptLayer, cellSizeFor } from './sculpt/layer.js';
import { CreationScreen } from './ui/creation.js';
import { Atelier } from './ui/atelier.js';
import { buildProjectFromLegacy } from './persistence/migrate.js';
import * as db from './persistence/db.js';

/** Complète un projet relu en base avec les valeurs par défaut manquantes. */
function hydrate(stored) {
  const base = createProject({
    canvasShape: stored.canvasShape,
    widthCm: stored.widthCm,
    heightCm: stored.heightCm,
    depthCm: stored.depthCm,
    name: stored.name,
  });
  return {
    ...base,
    ...stored,
    geometry: { ...defaultGeometry(), ...(stored.geometry || {}) },
    material: { ...defaultMaterial(), ...(stored.material || {}) },
    lighting: { ...defaultLighting(), ...(stored.lighting || {}) },
    presentation: { ...defaultPresentation(), ...(stored.presentation || {}) },
    camera: { ...defaultCamera(), ...(stored.camera || {}) },
    ui: { ...defaultUi(), ...(stored.ui || {}) },
    history: { undo: [], redo: [] },
  };
}

async function boot() {
  const creationRoot = document.getElementById('creation');
  const atelierRoot = document.getElementById('atelier');

  let persistence = true;
  try {
    await db.openDb();
  } catch (_) {
    // Navigation privée ou stockage refusé : l'atelier reste utilisable,
    // simplement sans reprise entre deux sessions. Aucun échec silencieux :
    // la limite est visible dans le pied de page.
    persistence = false;
  }

  let atelier = null;

  const openAtelier = (project, layer) => {
    if (atelier) atelier.destroy();
    creation.hide();
    atelierRoot.hidden = false;
    atelier = new Atelier(atelierRoot, {
      project,
      layer,
      onNewProject: () => showCreation(),
    });
    if (persistence) {
      db.saveProject(project).catch(() => {});
      db.setMeta('lastProjectId', project.id).catch(() => {});
    }
    if (!persistence) {
      const footer = atelierRoot.querySelector('.stage-footer .hint span:last-child');
      if (footer) footer.textContent = 'Stockage indisponible — ce projet ne sera pas conservé';
    }
  };

  const showCreation = async () => {
    if (atelier) atelier.hide();
    atelierRoot.hidden = true;
    creation.show();
    if (persistence) {
      try {
        creation.showProjects(await db.listProjects());
      } catch (_) {
        creation.showProjects([]);
      }
    }
  };

  const creation = new CreationScreen(creationRoot, {
    onCreate: (project) => {
      const layer = SculptLayer.forCanvas(project.widthCm, project.heightCm, cellSizeFor(project.widthCm, project.heightCm));
      openAtelier(project, layer);
    },
    onOpen: async (id) => {
      const stored = await db.loadProject(id);
      if (!stored) return;
      const project = hydrate(stored);
      const sculpt = await db.loadSculpt(id);
      const layer = sculpt ? SculptLayer.deserialize(sculpt) : SculptLayer.forCanvas(project.widthCm, project.heightCm);
      openAtelier(project, layer);
    },
  });

  if (!persistence) {
    await showCreation();
    return;
  }

  // Reprise unique des données de la version 1, si elles sont sur cette origine.
  try {
    if (!(await db.hasMigrated())) {
      const imported = buildProjectFromLegacy();
      if (imported) {
        await db.saveProject(imported.project);
        if (imported.layer) await db.saveSculpt(imported.project.id, imported.layer.serialize());
        await db.setMeta('lastProjectId', imported.project.id);
      }
      await db.markMigrated();
    }
  } catch (_) {
    /* la reprise est un confort, jamais un blocage */
  }

  const lastId = await db.getMeta('lastProjectId');
  if (lastId) {
    const stored = await db.loadProject(lastId);
    if (stored) {
      const project = hydrate(stored);
      const sculpt = await db.loadSculpt(lastId);
      const layer = sculpt ? SculptLayer.deserialize(sculpt) : SculptLayer.forCanvas(project.widthCm, project.heightCm);
      openAtelier(project, layer);
      return;
    }
  }

  await showCreation();
}

boot();
