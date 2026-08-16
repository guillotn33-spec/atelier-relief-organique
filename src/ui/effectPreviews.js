// Vignettes de la boutique.
//
// Jusqu'ici un effet se présentait par un caractère — ⌘ pour « Relief
// organique », ≋ pour « Vagues douces », ✺ pour « Alvéoles ». Aucun de ces
// signes ne dit ce que l'effet fait, et deux formes voisines portent des glyphes
// que rien ne distingue. Les trois prototypes, eux, s'annonçaient par un dessin
// CSS peint à la main : une promesse tenue par la feuille de style et non par le
// moteur, donc une promesse qui peut mentir dès que le préréglage change — et
// qui a menti, puisque la calibration sur les photos a tout déplacé.
//
// UNE VIGNETTE EST UN RENDU, PAS UNE ILLUSTRATION. Elle passe par `applyEffect`
// puis `renderFull`, exactement le chemin que suit le clic. Ce que la boutique
// montre est donc, par construction, ce qu'elle livre.
//
// Ce que la vignette ISOLE, en revanche, est un choix :
//   • une FORME est rendue sous un éclairage d'atelier fixe, pour que deux
//     formes se comparent entre elles et non à travers deux lumières ;
//   • une MATIÈRE et un ÉCLAIRAGE sont rendus sur un relief témoin unique, pour
//     la même raison ;
//   • une RÉFÉRENCE est rendue avec sa composition entière, puisque c'est
//     l'ensemble — forme, matière, lumière — qui a été calibré sur la photo.

import { createProject } from '../core/project.js';
import { EFFECTS, applyEffect } from '../core/effects.js';
import { buildHeightmap } from '../geometry/heightmap.js';
import { renderFull, createRenderCache } from '../render2d/renderer.js';

// Le panneau des vignettes est le panneau PAR DÉFAUT. Le champ étant ancré en
// centimètres, montrer le motif sur un autre format le montrerait à une autre
// échelle : une vignette de 160 × 100 cm est celle que l'on obtient en ouvrant
// l'atelier sans rien régler.
const PANNEAU = { canvasShape: 'rectangle', widthCm: 160, heightCm: 100, depthCm: 6 };

// Environ trente mille cellules de champ, soit dix-huit millisecondes par
// vignette (mesuré). Une vignette fait au plus 168 pixels de large : ce champ y
// est déjà vingt fois plus fin que l'image.
const QUALITE = 0.2;

// Éclairage d'atelier des vignettes de FORME. Rasant à 26°, parce qu'une lumière
// haute aplatit le relief et que, à cette taille, un relief aplati ne se
// distingue plus d'un autre.
const ATELIER = {
  lighting: { angle: 232, height: 26, contrast: 0.86, backlight: 0.42, exposureEv: 0.05, shadowStrength: 0.62, cavityOcclusion: 0.58 },
  material: { color: '#e7e5e2', texture: 0.28, finish: 'mat' },
};

// Relief témoin des vignettes de MATIÈRE et d'ÉCLAIRAGE.
const TEMOIN = 'organic-relief';

// Ni cadre ni lignes de panneau : à cette taille, un cadre est un liseré noir
// qui mange le sixième de l'image et n'apprend rien sur l'effet.
const NU = { panelLayout: 'none', frame: false };

/** Projet à rendre pour une entrée du catalogue. */
export function projetDeVignette(cle) {
  const effet = EFFECTS[cle];
  if (!effet) return null;
  const base = createProject(PANNEAU);

  if (effet.category === 'reference') {
    const p = applyEffect(base, cle);
    return { ...p, presentation: { ...p.presentation, ...NU } };
  }

  if (effet.category === 'form') {
    const p = applyEffect(base, cle);
    return {
      ...p,
      material: { ...p.material, ...ATELIER.material },
      lighting: { ...p.lighting, ...ATELIER.lighting },
      presentation: { ...p.presentation, ...NU },
    };
  }

  // Matière ou éclairage : le relief témoin, puis l'effet par-dessus.
  const p = applyEffect(applyEffect(base, TEMOIN), cle);
  return { ...p, presentation: { ...p.presentation, ...NU } };
}

export class EffectPreviews {
  /**
   * @param {HTMLElement} root  racine de l'atelier
   * @param {object} options    `signal` d'abandon de l'atelier
   */
  constructor(root, { signal } = {}) {
    this.root = root;
    this.signal = signal;
    this.cache = createRenderCache();
    this.file = [];
    this.enCours = false;
    this.abandonne = false;
  }

  /**
   * Abandonne la file et libère le cache.
   *
   * `signal` couvrait déjà l'abandon de l'atelier, mais rien ne l'appelait
   * depuis `Atelier.destroy()` : la file d'un atelier fermé continuait de
   * tourner tant que le signal n'était pas déclenché, et son cache de rendu
   * restait vivant. Un point d'entrée explicite vaut mieux qu'un effet de bord.
   */
  destroy() {
    this.abandonne = true;
    this.file.length = 0;
    this.cache = null;
  }

  /**
   * Remplace glyphes, pastilles et dessins CSS par des toiles, puis met le
   * calcul en file. Le rendu ne bloque jamais la première peinture : une
   * vignette par image, et la file s'arrête si l'atelier est abandonné.
   */
  monter() {
    for (const bouton of this.root.querySelectorAll('.effect-item[data-effect]')) {
      const cle = bouton.dataset.effect;
      const effet = EFFECTS[cle];
      if (!effet) continue;

      // `.effect-thumb` FAIT PARTIE DE LA RECHERCHE, et c'est le point entier.
      //
      // `monter()` est appelé une fois par atelier, mais l'atelier est reconstruit
      // sur le MÊME `#atelier` à chaque ouverture de projet (voir `main.js`).
      // Au second passage, le glyphe d'origine n'existe plus — il a été remplacé
      // par une toile — donc la recherche ne trouvait rien et le `else` AJOUTAIT
      // une seconde toile au lieu de remplacer la première. Un canevas de plus
      // par article et par ouverture, et surtout une mise en page cassée dès la
      // deuxième : `.effect-item` est une grille à trois colonnes fixes, un
      // quatrième enfant y pousse le texte dans la colonne du chevron.
      const ancien = bouton.querySelector('.effect-glyph, .effect-swatch, .effect-thumb');
      const toile = this.toile(46, 29);
      if (ancien) ancien.replaceWith(toile);
      else bouton.prepend(toile);

      // La description vient de la TABLE, jamais du gabarit : deux copies d'un
      // même texte finissent toujours par diverger, et c'est la copie visible
      // qui ment.
      const libelle = bouton.querySelector('span:nth-child(2)');
      if (libelle && !libelle.classList.contains('effect-copy')) {
        const copie = document.createElement('span');
        copie.className = 'effect-copy';
        const nom = document.createElement('strong');
        nom.textContent = effet.name;
        const desc = document.createElement('small');
        desc.textContent = effet.description;
        copie.append(nom, desc);
        libelle.replaceWith(copie);
      }
      bouton.title = `${effet.name} — ${effet.description}`;

      this.file.push({ cle, toile });
    }

    for (const carte of this.root.querySelectorAll('.preset-card[data-preset]')) {
      const cle = `${carte.dataset.preset}-reference`;
      if (!EFFECTS[cle]) continue;
      const art = carte.querySelector('.preset-art');
      const toile = this.toile(84, 53, 'preset-art preset-art-render');
      if (art) art.replaceWith(toile);
      else carte.prepend(toile);
      this.file.push({ cle, toile });
    }

    this.drainer();
  }

  toile(w, h, className = 'effect-thumb') {
    const c = document.createElement('canvas');
    c.className = className;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.setAttribute('aria-hidden', 'true');
    c.dataset.cssWidth = String(w);
    c.dataset.cssHeight = String(h);
    return c;
  }

  /**
   * Vide la file, une vignette par tour.
   *
   * PAS `requestAnimationFrame` : un onglet caché n'en reçoit plus aucun. La
   * première version s'arrêtait donc net dès qu'on passait à un autre onglet —
   * mesuré, huit vignettes rendues sur vingt-quatre, sans la moindre erreur en
   * console puisque rien n'avait échoué : la boucle attendait une image qui ne
   * venait pas. `requestIdleCallback` avec délai de garde tient dans les deux
   * cas, et `setTimeout` sert de secours là où il n'existe pas.
   */
  drainer() {
    if (this.enCours || !this.file.length) return;
    this.enCours = true;
    const planifier = typeof window.requestIdleCallback === 'function'
      ? (fn) => window.requestIdleCallback(fn, { timeout: 300 })
      : (fn) => setTimeout(fn, 0);
    const suivant = () => {
      if (this.abandonne || this.signal?.aborted) { this.enCours = false; return; }
      const tache = this.file.shift();
      if (!tache) { this.enCours = false; return; }
      try {
        this.dessiner(tache.cle, tache.toile);
      } catch (erreur) {
        // Une vignette manquante laisse une case vide et un libellé lisible :
        // la boutique reste utilisable, ce qui vaut mieux qu'une file cassée.
        // Mais elle le DIT — un catch muet a déjà caché ici treize vignettes
        // absentes, et il a fallu compter les toiles pour s'en apercevoir.
        console.error(`[boutique] vignette « ${tache.cle} » non rendue :`, erreur);
      }
      planifier(suivant);
    };
    planifier(suivant);
  }

  dessiner(cle, toile) {
    const project = projetDeVignette(cle);
    if (!project) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(Number(toile.dataset.cssWidth) * dpr);
    const h = Math.round(Number(toile.dataset.cssHeight) * dpr);
    const hm = buildHeightmap(project, null, { quality: QUALITE });
    renderFull(toile, project, hm, w, h, this.cache);
    toile.style.width = `${toile.dataset.cssWidth}px`;
    toile.style.height = `${toile.dataset.cssHeight}px`;
  }
}
