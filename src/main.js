// Amorçage : écran de création ou reprise du dernier projet.

import './styles.css';
import { createProject, defaultCamera, defaultGeometry, defaultLighting, defaultMaterial, defaultPresentation, defaultUi, validateGeometry } from './core/project.js';
import { SculptLayer, cellSizeFor } from './sculpt/layer.js';
import { CreationScreen } from './ui/creation.js';
import { Atelier } from './ui/atelier.js';
import { buildProjectFromLegacy } from './persistence/migrate.js';
import * as db from './persistence/db.js';

/**
 * Complète un projet relu en base avec les valeurs par défaut manquantes.
 *
 * Les projets écrits au lot 1 portent `engine: 'legacy-v1'` et les paramètres du
 * moteur v1 (count, scale, flow), qui n'ont pas d'équivalent dans `organic-v2`.
 * Plutôt que de laisser l'interface piloter des champs inexistants, on repart des
 * valeurs par défaut du nouveau moteur en conservant la graine. Le moteur v1
 * reste accessible au code — c'est l'oracle de non-régression des tests — mais
 * plus aucun projet ne s'ouvre dessus.
 */
function hydrate(stored) {
  const base = createProject({
    canvasShape: stored.canvasShape,
    widthCm: stored.widthCm,
    heightCm: stored.heightCm,
    depthCm: stored.depthCm,
    name: stored.name,
  });
  const storedGeometry = stored.geometry || {};
  // La géométrie relue passe par la MÊME porte que les dimensions : elle est
  // validée, pas seulement complétée. Un `{ ...defaults, ...stored }` recopiait
  // un NaN tel quel, et un seul NaN suffit à rendre la heightmap entière NaN —
  // toile vide, sans exception ni message. Voir `validateGeometry`.
  const geometry =
    storedGeometry.engine === 'legacy-v1'
      ? { ...defaultGeometry(), seed: Number.isFinite(Number(storedGeometry.seed)) ? Number(storedGeometry.seed) | 0 : defaultGeometry().seed }
      : validateGeometry(storedGeometry);
  return {
    ...base,
    ...stored,
    geometry,
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
      // Passe par l'atelier plutôt que par un `.catch` vide : le premier
      // enregistrement est aussi le premier moment où le stockage peut refuser,
      // et c'est exactement celui qu'il ne faut pas taire.
      atelier.saveProjectNow();
    }
    if (!persistence) {
      // Le message allait dans `#hintText`, que le premier changement d'outil
      // réécrivait : l'avertissement de non-conservation disparaissait au bout
      // de quelques secondes. Il a désormais sa propre ligne, persistante.
      atelier.disableStorage();
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
      // Cette fonction est asynchrone et appelée depuis un écouteur de clic :
      // son rejet n'était rattrapé par personne. Un enregistrement illisible
      // faisait donc un bouton qui ne répond à rien, sans un mot dans
      // l'interface ni la moindre trace pour comprendre.
      try {
        const stored = await db.loadProject(id);
        if (!stored) {
          showBootError('Ce projet est introuvable — il a peut-être été supprimé.');
          return;
        }
        const project = hydrate(stored);
        let layer = null;
        try {
          const sculpt = await db.loadSculpt(id);
          if (sculpt) layer = SculptLayer.deserialize(sculpt);
        } catch (_) {
          // Le calque est perdu, pas le projet : on ouvre le relief sans la
          // sculpture manuelle plutôt que de refuser l'ouverture entière.
          layer = null;
        }
        openAtelier(project, layer || SculptLayer.forCanvas(project.widthCm, project.heightCm));
      } catch (error) {
        showBootError(`Ce projet n'a pas pu être ouvert : ${error.message}`);
      }
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

  // La reprise automatique est un CONFORT. Si l'enregistrement du dernier projet
  // est illisible, l'écran de création doit quand même apparaître : auparavant
  // l'exception remontait jusqu'au `boot()` nu et la page restait vide, sans
  // aucun moyen d'en sortir puisque l'entrée fautive était relue à chaque
  // rechargement.
  try {
    const lastId = await db.getMeta('lastProjectId');
    if (lastId) {
      const stored = await db.loadProject(lastId);
      if (stored) {
        const project = hydrate(stored);
        let layer = null;
        try {
          const sculpt = await db.loadSculpt(lastId);
          if (sculpt) layer = SculptLayer.deserialize(sculpt);
        } catch (_) {
          layer = null;
        }
        openAtelier(project, layer || SculptLayer.forCanvas(project.widthCm, project.heightCm));
        return;
      }
    }
  } catch (error) {
    await showCreation();
    showBootError(`La reprise du dernier projet a échoué : ${error.message}`);
    return;
  }

  await showCreation();
}

/** Affiche un message sur l'écran de création. Le seul canal visible au démarrage. */
function showBootError(message) {
  const line = document.getElementById('bootError');
  if (!line) return;
  line.textContent = message;
  line.hidden = false;
}

// `boot` est asynchrone : sans ce rattrapage, toute exception non prévue laissait
// une page blanche muette. L'écran de création est démasqué de force pour que
// l'application reste utilisable même quand la persistance est hors service.
boot().catch((error) => {
  const creationRoot = document.getElementById('creation');
  const atelierRoot = document.getElementById('atelier');
  if (atelierRoot) atelierRoot.hidden = true;
  if (creationRoot) creationRoot.hidden = false;
  showBootError(`Le démarrage a échoué : ${error.message}. L'atelier reste utilisable, sans reprise des projets enregistrés.`);
});
