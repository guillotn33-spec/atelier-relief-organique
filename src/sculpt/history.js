// Annuler / rétablir de la sculpture.
//
// Sorti d'`atelier.js` au lot 8 (§20), sans changer une ligne de comportement.
//
// PORTÉE ASSUMÉE : cette pile ne couvre QUE le calque de sculpture. Ni les
// réglages, ni la graine, ni les préréglages n'y entrent — c'est un constat de
// l'audit du lot 0, pas un oubli de ce lot. « Retour base » (§4) et le mode
// négatif (§5) ont leurs propres mécanismes précisément parce qu'ils ne
// pouvaient pas s'appuyer sur celle-ci.

// Quinze pas. Chaque instantané pèse trois tableaux de flottants de la taille du
// calque : au-delà, la pile coûte plus cher en mémoire qu'elle ne rend service
// sur un iPad.
export const PROFONDEUR_MAX = 15;

export class SculptHistory {
  /**
   * @param {object} options
   *   lireCalque() — rend le calque courant
   *   boutons      — `{ undo, redo }`, éléments à activer ou griser
   *   onRestore()  — ce qu'il faut refaire après un retour en arrière
   */
  constructor({ lireCalque, boutons, onRestore }) {
    this.lireCalque = lireCalque;
    this.boutons = boutons;
    this.onRestore = onRestore;
    this.undoStack = [];
    this.redoStack = [];
    // Les boutons appartiennent au DOCUMENT, pas à cette pile : ils survivent au
    // changement de projet et gardent l'état laissé par le précédent. Sans cet
    // appel, ouvrir un second projet après avoir sculpté dans le premier
    // laissait « Annuler » actif sur une pile vide.
    this.refreshButtons();
  }

  push() {
    this.undoStack.push(this.lireCalque().snapshot());
    if (this.undoStack.length > PROFONDEUR_MAX) this.undoStack.shift();
    this.redoStack.length = 0;
    this.refreshButtons();
  }

  refreshButtons() {
    if (this.boutons.undo) this.boutons.undo.disabled = !this.undoStack.length;
    if (this.boutons.redo) this.boutons.redo.disabled = !this.redoStack.length;
  }

  undo() {
    if (!this.undoStack.length) return;
    const layer = this.lireCalque();
    this.redoStack.push(layer.snapshot());
    layer.restore(this.undoStack.pop());
    this.refreshButtons();
    this.onRestore();
  }

  redo() {
    if (!this.redoStack.length) return;
    const layer = this.lireCalque();
    this.undoStack.push(layer.snapshot());
    layer.restore(this.redoStack.pop());
    this.refreshButtons();
    this.onRestore();
  }
}
