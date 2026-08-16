// Enregistrement du projet et de la sculpture (amendement E).
//
// Sorti d'`atelier.js` au lot 8 (§20), sans changer une ligne de comportement.
//
// UNE ÉCRITURE QUI ÉCHOUE DOIT SE VOIR. Les cinq appels de sauvegarde avalaient
// leur rejet dans un `.catch(() => {})` : quota dépassé, base fermée par Safari
// en mémoire basse, navigation privée — dans tous ces cas l'atelier continuait
// d'afficher un travail que plus rien n'enregistrait.
//
// Le message va dans son propre élément, PAS dans `#hintText` : celui-ci est
// réécrit à chaque changement d'outil, ce qui effaçait l'unique alerte de perte
// de données au bout de quelques secondes.
//
// Le projet est lu à CHAQUE écriture par le rappel `lire`, jamais mémorisé :
// choisir un préréglage remplace l'objet projet de l'atelier, et une référence
// gardée ici enregistrerait indéfiniment l'ancien.

import * as db from '../persistence/db.js';

const DELAI_PROJET_MS = 400;
const DELAI_SCULPTURE_MS = 800;

export class ProjectStore {
  /**
   * @param {object} options
   *   statusElement — ligne d'état dédiée, ou null
   *   lire()        — rend `{ project, layer }` à l'instant de l'écriture
   */
  constructor({ statusElement, lire }) {
    this.statusElement = statusElement || null;
    this.lire = lire;
    this.projectTimer = 0;
    this.sculptTimer = 0;
    this.disabled = false;
    // Message qui survit aux messages passagers : voir `setStatus`.
    this.persistentStatus = '';
    this.shownStatus = undefined;
  }

  /**
   * Un message vide ne rend pas la ligne muette : il RETOMBE sur
   * `persistentStatus`. Mesuré sans cette retenue — la restauration d'un
   * contexte WebGL effaçait l'avertissement « stockage indisponible », qui est
   * le plus grave des deux et n'a aucune raison de disparaître.
   */
  setStatus(message) {
    if (!this.statusElement) return;
    const shown = message || this.persistentStatus || '';
    if (shown === this.shownStatus) return;
    this.shownStatus = shown;
    this.statusElement.textContent = shown;
    this.statusElement.hidden = !shown;
  }

  /** Signale que le projet n'est plus enregistré. Reste affiché jusqu'au succès suivant. */
  reportFailure(error) {
    const cause = error && error.name === 'QuotaExceededError' ? 'espace de stockage saturé' : 'stockage indisponible';
    this.setStatus(`⚠ Sauvegarde impossible — ${cause}. Exportez votre travail.`);
  }

  reportSuccess() {
    if (this.shownStatus) this.setStatus('');
  }

  scheduleProject() {
    if (this.disabled) return;
    clearTimeout(this.projectTimer);
    this.projectTimer = setTimeout(() => this.saveProjectNow(), DELAI_PROJET_MS);
  }

  scheduleSculpt() {
    if (this.disabled) return;
    clearTimeout(this.sculptTimer);
    this.sculptTimer = setTimeout(() => this.saveSculptNow(), DELAI_SCULPTURE_MS);
  }

  saveProjectNow() {
    clearTimeout(this.projectTimer);
    const { project } = this.lire();
    return Promise.all([db.saveProject(project), db.setMeta('lastProjectId', project.id)]).then(
      () => this.reportSuccess(),
      (error) => this.reportFailure(error)
    );
  }

  saveSculptNow() {
    clearTimeout(this.sculptTimer);
    const { project, layer } = this.lire();
    return db
      .saveSculpt(project.id, layer.active ? layer.serialize() : null)
      .then(() => this.reportSuccess(), (error) => this.reportFailure(error));
  }

  /**
   * Écrit sans attendre les temporisations. Appelé quand l'onglet part en
   * arrière-plan : sur iPad, Safari peut décharger un onglet caché sans jamais
   * rendre la main, et les 400 à 800 ms d'attente emportaient alors le dernier
   * trait. L'écriture n'est pas GARANTIE d'aboutir — IndexedDB est asynchrone et
   * la page peut mourir avant — mais la déclencher vaut mieux que la retarder.
   */
  flush() {
    if (this.disabled) return;
    if (this.projectTimer) this.saveProjectNow();
    if (this.sculptTimer) this.saveSculptNow();
  }

  /** Coupe la persistance et le dit, une fois pour toutes. */
  disable(reason) {
    this.disabled = true;
    clearTimeout(this.projectTimer);
    clearTimeout(this.sculptTimer);
    this.persistentStatus = reason || 'Stockage indisponible — ce projet ne sera pas conservé';
    this.setStatus(this.persistentStatus);
  }

  destroy() {
    clearTimeout(this.projectTimer);
    clearTimeout(this.sculptTimer);
  }
}
