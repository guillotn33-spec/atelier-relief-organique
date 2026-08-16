// Barre de menus (Fichier, Édition, Affichage, Aide).
//
// AUCUNE LOGIQUE PROPRE. Chaque entrée délègue au bouton qui existe déjà dans
// l'interface : « Exporter » clique `#exportRun`, « Annuler » clique `#undoBtn`.
// C'est ce qui garantit qu'un menu ne peut pas diverger de la commande qu'il
// nomme — il n'y a qu'un seul chemin d'exécution, et le menu n'en est qu'une
// porte de plus. Les entrées héritent aussi de l'état `disabled` de leur cible,
// donc « Annuler » est grisé exactement quand le bouton l'est.
//
// Clavier complet, conforme au motif « menubar » : flèches horizontales entre
// les menus, verticales dans un menu, Origine/Fin, Échap pour fermer et rendre
// le focus au titre du menu.

const MENUS = [
  {
    id: 'fichier',
    libelle: 'Fichier',
    entrees: [
      { libelle: 'Nouveau document', cible: '#newProject', raccourci: 'Ctrl N' },
      { libelle: 'Nouvelle variation', cible: '#variationTop', raccourci: 'Ctrl R' },
      { separateur: true },
      { libelle: 'Définir comme base', cible: '#setBase' },
      { libelle: 'Revenir à la base', cible: '#restoreBase' },
      { separateur: true },
      { libelle: 'Exporter l’image PNG', cible: '#exportRun', raccourci: 'Ctrl E' },
      { libelle: 'Mode Prompt…', cible: '#promptToggle', raccourci: 'Ctrl M' },
    ],
  },
  {
    id: 'edition',
    libelle: 'Édition',
    entrees: [
      { libelle: 'Annuler', cible: '#undoBtn', raccourci: 'Ctrl Z' },
      { libelle: 'Rétablir', cible: '#redoBtn', raccourci: 'Ctrl ⇧ Z' },
      { separateur: true },
      { libelle: 'Effacer toute la sculpture', cible: '#clearSculpt' },
    ],
  },
  {
    id: 'affichage',
    libelle: 'Affichage',
    entrees: [
      { libelle: 'Ajuster l’œuvre à la fenêtre', cible: '#resetView', raccourci: 'Ctrl 0' },
      { separateur: true },
      { libelle: 'Affichage épuré', cible: '#benitoToggle', raccourci: 'Ctrl B' },
      { libelle: 'Replier ou déplier la barre d’outils', cible: '#toolbarCollapse' },
      { separateur: true },
      { libelle: 'Afficher ou masquer les propriétés', cible: '#drawerToggle' },
      { libelle: 'Replier ou déplier le panneau du bas', cible: '[data-bottom-collapse]' },
      { libelle: 'Replier ou déplier les paramètres avancés', cible: '#advancedToggle' },
    ],
  },
  {
    id: 'aide',
    libelle: 'Aide',
    entrees: [
      { libelle: 'Raccourcis clavier', action: 'raccourcis' },
      { libelle: 'À propos de l’atelier', action: 'apropos' },
    ],
  },
];

export const RACCOURCIS = [
  ['Ctrl Z / Ctrl ⇧ Z', 'Annuler, rétablir la sculpture'],
  ['Ctrl E', 'Exporter l’image PNG'],
  ['Ctrl R', 'Nouvelle variation'],
  ['Ctrl 0', 'Ajuster l’œuvre à la fenêtre'],
  ['Ctrl B', 'Affichage épuré'],
  ['Ctrl M', 'Mode Prompt'],
  ['L O C B S G', 'Lumière, Onduler, Creuser, Bomber, Lisser, Gomme'],
  ['Flèches sur une molette', 'Régler au clavier ; Maj pour un pas fin'],
  ['Flèches sur la poignée', 'Redimensionner le panneau ; Maj par pas de dix'],
  ['Échap', 'Fermer le menu ou le tiroir des propriétés'],
];

export class MenuBar {
  /**
   * @param {HTMLElement} root  racine de l'atelier
   * @param {object} options
   *   signal   — signal d'abandon de l'atelier
   *   onAide(sujet) — appelé pour les entrées d'aide
   */
  constructor(root, { signal, onAide } = {}) {
    this.root = root;
    this.onAide = onAide;
    this.hote = root.querySelector('#menuBar');
    if (!this.hote) return;
    this.opts = signal ? { signal } : {};
    this.ouvert = null;

    this.construire();
    document.addEventListener('pointerdown', (e) => {
      if (this.ouvert && !this.hote.contains(e.target)) this.fermer();
    }, this.opts);
  }

  construire() {
    this.hote.setAttribute('role', 'menubar');
    this.hote.replaceChildren();
    this.titres = [];

    for (const menu of MENUS) {
      const enveloppe = document.createElement('div');
      enveloppe.className = 'menu';

      const titre = document.createElement('button');
      titre.type = 'button';
      titre.className = 'menu-title';
      titre.textContent = menu.libelle;
      titre.setAttribute('role', 'menuitem');
      titre.setAttribute('aria-haspopup', 'true');
      titre.setAttribute('aria-expanded', 'false');
      titre.tabIndex = this.titres.length === 0 ? 0 : -1;

      const liste = document.createElement('div');
      liste.className = 'menu-list';
      liste.setAttribute('role', 'menu');
      liste.setAttribute('aria-label', menu.libelle);
      liste.hidden = true;

      for (const entree of menu.entrees) {
        if (entree.separateur) {
          const sep = document.createElement('hr');
          sep.className = 'menu-sep';
          sep.setAttribute('role', 'separator');
          liste.append(sep);
          continue;
        }
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'menu-item';
        item.setAttribute('role', 'menuitem');
        item.tabIndex = -1;
        const nom = document.createElement('span');
        nom.textContent = entree.libelle;
        item.append(nom);
        if (entree.raccourci) {
          const kbd = document.createElement('kbd');
          kbd.textContent = entree.raccourci;
          item.append(kbd);
        }
        if (entree.cible) item.dataset.cible = entree.cible;
        if (entree.action) item.dataset.action = entree.action;
        item.addEventListener('click', () => this.activer(entree), this.opts);
        liste.append(item);
      }

      titre.addEventListener('click', () => this.basculer(enveloppe));
      titre.addEventListener('keydown', (e) => this.clavierTitre(e, enveloppe));
      liste.addEventListener('keydown', (e) => this.clavierListe(e, enveloppe));
      enveloppe.append(titre, liste);
      this.hote.append(enveloppe);
      this.titres.push(titre);
    }
  }

  /** Une entrée n'exécute rien elle-même : elle actionne la commande existante. */
  activer(entree) {
    this.fermer();
    if (entree.action) return this.onAide?.(entree.action);
    const cible = this.root.querySelector(entree.cible);
    if (cible && !cible.disabled) cible.click();
    return undefined;
  }

  /** Les entrées héritent de l'état de leur cible : grisées quand elle l'est. */
  rafraichir() {
    if (!this.hote) return;
    for (const item of this.hote.querySelectorAll('.menu-item[data-cible]')) {
      const cible = this.root.querySelector(item.dataset.cible);
      const inactif = !cible || cible.disabled;
      item.disabled = inactif;
      item.setAttribute('aria-disabled', String(inactif));
    }
  }

  basculer(enveloppe) {
    if (this.ouvert === enveloppe) this.fermer();
    else this.ouvrir(enveloppe);
  }

  ouvrir(enveloppe, focaliser = false) {
    this.fermer();
    this.rafraichir();
    this.ouvert = enveloppe;
    enveloppe.classList.add('open');
    enveloppe.querySelector('.menu-title').setAttribute('aria-expanded', 'true');
    const liste = enveloppe.querySelector('.menu-list');
    liste.hidden = false;
    if (focaliser) this.entrees(enveloppe)[0]?.focus();
  }

  fermer(rendreFocus = false) {
    if (!this.ouvert) return;
    const titre = this.ouvert.querySelector('.menu-title');
    this.ouvert.classList.remove('open');
    titre.setAttribute('aria-expanded', 'false');
    this.ouvert.querySelector('.menu-list').hidden = true;
    this.ouvert = null;
    if (rendreFocus) titre.focus();
  }

  entrees(enveloppe) {
    return [...enveloppe.querySelectorAll('.menu-item:not([disabled])')];
  }

  clavierTitre(event, enveloppe) {
    const i = this.titres.indexOf(enveloppe.querySelector('.menu-title'));
    const aller = (n) => {
      const cible = this.titres[(n + this.titres.length) % this.titres.length];
      this.titres.forEach((t) => { t.tabIndex = -1; });
      cible.tabIndex = 0;
      cible.focus();
      if (this.ouvert) this.ouvrir(cible.parentElement);
    };
    switch (event.key) {
      case 'ArrowRight': event.preventDefault(); return aller(i + 1);
      case 'ArrowLeft': event.preventDefault(); return aller(i - 1);
      case 'ArrowDown': case 'Enter': case ' ': event.preventDefault(); return this.ouvrir(enveloppe, true);
      case 'Home': event.preventDefault(); return aller(0);
      case 'End': event.preventDefault(); return aller(this.titres.length - 1);
      case 'Escape': return this.fermer(true);
      default: return undefined;
    }
  }

  clavierListe(event, enveloppe) {
    const items = this.entrees(enveloppe);
    const i = items.indexOf(document.activeElement);
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); return items[(i + 1) % items.length]?.focus();
      case 'ArrowUp': event.preventDefault(); return items[(i - 1 + items.length) % items.length]?.focus();
      case 'Home': event.preventDefault(); return items[0]?.focus();
      case 'End': event.preventDefault(); return items[items.length - 1]?.focus();
      case 'Escape': event.preventDefault(); return this.fermer(true);
      case 'Tab': return this.fermer();
      default: return undefined;
    }
  }
}
