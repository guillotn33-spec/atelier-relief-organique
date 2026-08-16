// Mode Prompt — la feuille qui montre l'état du projet en langage de modèle.
//
// Elle ne calcule rien : tout vient de `compilerPrompt`, qui est pur et
// éprouvé par `tests/prompt.mjs`. Ce fichier ne fait que trois choses — montrer,
// laisser modifier, copier.
//
// TROIS NIVEAUX, PARCE QU'IL Y A TROIS USAGES :
//
//   Simple    on copie et on colle. Un champ, deux boutons.
//   Détaillé  on retouche une phrase — la matière, l'éclairage — sans réécrire
//             le reste. Chaque section est modifiable séparément.
//   Expert    on branche un pipeline : negative prompt, JSON, graine.
//
// CE QUI EST MODIFIÉ À LA MAIN NE SE FAIT PAS ÉCRASER. Une section retouchée se
// marque et cesse de suivre les curseurs ; les autres continuent de se mettre à
// jour en direct. Sans cette règle, toucher un curseur effacerait la phrase que
// l'utilisateur vient d'écrire — et il ne le découvrirait qu'après.

import { compilerPrompt, PRECISIONS } from '../core/prompt.js';

const SECTIONS = [
  ['sujet', 'Sujet'],
  ['geometrie', 'Géométrie'],
  ['surface', 'Matière'],
  ['lumiere', 'Éclairage'],
  ['cadrage', 'Cadrage'],
  ['fidelite', 'Fidélité'],
];

const NIVEAUX = [['simple', 'Simple'], ['detaille', 'Détaillé'], ['expert', 'Expert']];

export class PromptSheet {
  /**
   * @param {HTMLElement} root  racine de l'atelier
   * @param {object} options    `lire()` rend le projet courant, `signal` l'abandon
   */
  constructor(root, { lire, signal } = {}) {
    this.root = root;
    this.lire = lire;
    this.opts = signal ? { signal } : {};
    this.niveau = 'simple';
    this.precision = 'strict';
    // Textes retouchés à la main, par clé de section.
    this.retouches = {};
    this.retoucheFinale = false;
    this.construire();
  }

  construire() {
    const feuille = document.createElement('section');
    feuille.className = 'prompt-sheet';
    feuille.id = 'promptSheet';
    feuille.hidden = true;
    feuille.setAttribute('role', 'dialog');
    feuille.setAttribute('aria-labelledby', 'promptSheetTitle');

    feuille.innerHTML = `
      <header class="prompt-head">
        <h2 id="promptSheetTitle">Mode Prompt</h2>
        <div class="prompt-levels" role="tablist" aria-label="Niveau de détail">
          ${NIVEAUX.map(([k, l], i) => `<button class="prompt-level${i === 0 ? ' active' : ''}" type="button" role="tab" aria-selected="${i === 0}" data-niveau="${k}">${l}</button>`).join('')}
        </div>
        <button class="icon-btn" type="button" data-prompt-close title="Fermer"><span aria-hidden="true">×</span><span class="sr-only">Fermer le mode prompt</span></button>
      </header>

      <div class="prompt-body">
        <label class="prompt-field prompt-fidelity">
          <span>Fidélité à la géométrie</span>
          <select class="select select-compact" data-prompt-precision>
            ${Object.entries(PRECISIONS).map(([k, v]) => `<option value="${k}">${v.nom}</option>`).join('')}
          </select>
        </label>

        <p class="prompt-note" data-prompt-cavites></p>

        <div class="prompt-pane" data-pane="simple">
          <label class="prompt-field"><span>Prompt <em class="prompt-edited" data-final-edited hidden>modifié — il ne suit plus les curseurs</em></span><textarea class="prompt-text" rows="9" data-prompt-final spellcheck="false"></textarea></label>
          <button class="btn btn-compact" type="button" data-prompt-reset-simple>Rendre la main aux curseurs</button>
        </div>

        <div class="prompt-pane" data-pane="detaille" hidden>
          ${SECTIONS.map(([k, l]) => `
            <label class="prompt-field" data-section-field="${k}">
              <span>${l} <em class="prompt-edited" hidden>modifié</em></span>
              <textarea class="prompt-text" rows="3" data-section="${k}" spellcheck="false"></textarea>
            </label>`).join('')}
          <button class="btn btn-compact" type="button" data-prompt-reset>Rendre la main aux curseurs</button>
        </div>

        <div class="prompt-pane" data-pane="expert" hidden>
          <label class="prompt-field"><span>Prompt</span><textarea class="prompt-text" rows="6" data-prompt-final-expert spellcheck="false" readonly></textarea></label>
          <label class="prompt-field"><span>Negative prompt <em>— ce que le modèle doit refuser, à ne pas confondre avec le relief négatif</em></span><textarea class="prompt-text" rows="4" data-prompt-negative spellcheck="false" readonly></textarea></label>
          <label class="prompt-field"><span>État structuré (JSON)</span><textarea class="prompt-text prompt-mono" rows="14" data-prompt-json spellcheck="false" readonly></textarea></label>
        </div>
      </div>

      <footer class="prompt-foot">
        <span class="prompt-status" role="status" data-prompt-status></span>
        <button class="btn btn-compact" type="button" data-prompt-copy-json>Copier le JSON</button>
        <button class="btn btn-primary btn-compact" type="button" data-prompt-copy>Copier le prompt</button>
      </footer>`;

    this.root.append(feuille);
    this.feuille = feuille;
    this.statut = feuille.querySelector('[data-prompt-status]');

    feuille.querySelectorAll('[data-niveau]').forEach((b) => {
      b.addEventListener('click', () => this.setNiveau(b.dataset.niveau), this.opts);
    });
    feuille.querySelector('[data-prompt-close]').addEventListener('click', () => this.fermer(), this.opts);
    feuille.querySelector('[data-prompt-precision]').addEventListener('change', (e) => {
      this.precision = e.target.value;
      this.sync();
    }, this.opts);

    // Une section retouchée cesse de suivre les curseurs, et le dit.
    feuille.querySelectorAll('[data-section]').forEach((zone) => {
      zone.addEventListener('input', () => {
        this.retouches[zone.dataset.section] = zone.value;
        this.sync();
      }, this.opts);
    });
    feuille.querySelectorAll('[data-prompt-reset], [data-prompt-reset-simple]').forEach((b) => b.addEventListener('click', () => {
      this.retouches = {};
      this.retoucheFinale = false;
      this.feuille.querySelector('[data-final-edited]').hidden = true;
      this.sync();
    }, this.opts));
    // MÊME RÈGLE POUR LE CHAMP ASSEMBLÉ : il ne cesse de suivre les curseurs
    // qu'une fois RÉELLEMENT modifié.
    //
    // La première version gardait le champ intact dès qu'il avait le focus. Or
    // `ouvrir()` lui donnait le focus : le prompt restait donc figé sur l'état
    // d'ouverture de la feuille, et bouger un curseur ne changeait rien à
    // l'écran. Avoir le focus n'est pas écrire.
    feuille.querySelector('[data-prompt-final]').addEventListener('input', () => {
      this.retoucheFinale = true;
      feuille.querySelector('[data-final-edited]').hidden = false;
    }, this.opts);
    feuille.querySelector('[data-prompt-copy]').addEventListener('click', () => {
      this.copier(feuille.querySelector('[data-prompt-final]').value, 'Prompt copié');
    }, this.opts);
    feuille.querySelector('[data-prompt-copy-json]').addEventListener('click', () => {
      this.copier(feuille.querySelector('[data-prompt-json]').value, 'JSON copié');
    }, this.opts);

    this.root.ownerDocument.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.feuille.hidden) { e.stopPropagation(); this.fermer(); }
    }, this.opts);
  }

  setNiveau(niveau) {
    this.niveau = niveau;
    this.feuille.querySelectorAll('[data-niveau]').forEach((b) => {
      const actif = b.dataset.niveau === niveau;
      b.classList.toggle('active', actif);
      b.setAttribute('aria-selected', String(actif));
    });
    this.feuille.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== niveau; });
    this.sync();
  }

  ouvrir() {
    this.feuille.hidden = false;
    this.sync();
    // On donne le focus au premier onglet, pas au champ : entrer directement
    // dans une zone de texte de neuf lignes met l'utilisateur en position
    // d'écrire alors qu'il vient d'ouvrir pour LIRE.
    this.feuille.querySelector('.prompt-level')?.focus({ preventScroll: true });
  }

  fermer() {
    this.feuille.hidden = true;
    this.root.querySelector('#promptToggle')?.focus({ preventScroll: true });
  }

  basculer() {
    if (this.feuille.hidden) this.ouvrir();
    else this.fermer();
  }

  get ouvert() {
    return !this.feuille.hidden;
  }

  /** Recompile depuis le projet et rafraîchit ce qui n'a pas été retouché. */
  sync() {
    if (this.feuille.hidden) return;
    const project = this.lire?.();
    if (!project) return;
    const r = compilerPrompt(project, { precision: this.precision });

    const sections = { ...r.sections, ...this.retouches };
    const texte = SECTIONS.map(([k]) => sections[k]).filter(Boolean).join(' ');

    this.feuille.querySelector('[data-prompt-precision]').value = r.precision;
    this.feuille.querySelector('[data-prompt-cavites]').textContent =
      `≈ ${r.cavites} cavité${r.cavites > 1 ? 's' : ''} — estimation dérivée de la taille des cavités et du format, pas un réglage.`;

    for (const [cle] of SECTIONS) {
      const zone = this.feuille.querySelector(`[data-section="${cle}"]`);
      if (!zone) continue;
      const retouche = cle in this.retouches;
      // On ne réécrit PAS une zone que l'utilisateur est en train de modifier :
      // cela déplacerait son curseur de saisie au milieu d'un mot.
      if (!retouche) zone.value = r.sections[cle];
      zone.closest('[data-section-field]').querySelector('.prompt-edited').hidden = !retouche;
    }

    const zoneFinale = this.feuille.querySelector('[data-prompt-final]');
    if (!this.retoucheFinale) zoneFinale.value = texte;
    this.feuille.querySelector('[data-prompt-final-expert]').value = texte;
    this.feuille.querySelector('[data-prompt-negative]').value = r.negative;
    this.feuille.querySelector('[data-prompt-json]').value = JSON.stringify(r.json, null, 2);
  }

  async copier(texte, message) {
    try {
      await navigator.clipboard.writeText(texte);
      this.dire(message);
    } catch (_) {
      // Le presse-papiers est refusé hors contexte sécurisé, et se taire
      // laisserait croire que la copie a eu lieu.
      this.dire('Copie refusée par le navigateur — sélectionnez le texte et copiez à la main.');
    }
  }

  dire(message) {
    this.statut.textContent = message;
    clearTimeout(this.timerStatut);
    this.timerStatut = setTimeout(() => { this.statut.textContent = ''; }, 2600);
  }

  destroy() {
    clearTimeout(this.timerStatut);
    this.feuille?.remove();
  }
}
