// Aide contextuelle (coin bas-gauche).
//
// L'encart d'aide était figé : un seul texte, « Commencez avec les quatre
// molettes », affiché du premier au dernier geste. Il occupait la place d'une
// aide sans jamais en rendre le service.
//
// Il réagit maintenant à TROIS sources, par ordre de priorité :
//   1. la commande sous le pointeur ou sous le clavier — la plus précise ;
//   2. l'outil actif — ce qu'il fait et comment s'en servir ;
//   3. un mot d'accueil, quand rien n'est visé.
//
// Le texte vient d'une TABLE, pas du code : ajouter un réglage, c'est ajouter
// une ligne. La table est la seule chose à relire pour savoir ce que
// l'application prétend expliquer.

const ACCUEIL = {
  titre: 'Atelier',
  corps: 'Survolez un réglage pour savoir ce qu’il fait. Choisissez un outil pour dessiner sur l’œuvre.',
};

// Ce que fait chaque outil, et le geste qui va avec.
export const AIDE_OUTILS = {
  light: { titre: 'Lumière', corps: 'Glissez sur l’œuvre : la source tourne autour du panneau. Les creux s’assombrissent du côté opposé.', raccourci: 'L' },
  warp: { titre: 'Onduler', corps: 'Pousse le motif dans le sens du geste, sans creuser. Sert à recomposer, pas à sculpter.', raccourci: 'O' },
  dig: { titre: 'Creuser', corps: 'Enfonce la matière. La pression du stylet module la force ; la vitesse du geste module la dose.', raccourci: 'C' },
  raise: { titre: 'Bomber', corps: 'Fait saillir la matière. Même brosse que Creuser, sens inverse.', raccourci: 'B' },
  smooth: { titre: 'Lisser', corps: 'Adoucit ce qui a été sculpté à la main, sans toucher au relief généré.', raccourci: 'S' },
  erase: { titre: 'Gomme', corps: 'Efface la sculpture manuelle et redonne le motif d’origine. Le relief généré reste intact.', raccourci: 'G' },
};

// Ce que fait chaque réglage. La clé est l'identifiant de la commande.
export const AIDE_REGLAGES = {
  widthCm: ['Largeur du panneau', 'En centimètres réels. Élargir RÉVÈLE du motif supplémentaire : le relief n’est jamais étiré.'],
  heightCm: ['Hauteur du panneau', 'En centimètres réels. Le cadenas à côté de la poignée verrouille le rapport.'],
  depthCm: ['Épaisseur', 'Profondeur physique du panneau, du fond de cavité à la face avant.'],

  basinScaleCm: ['Taille des cavités', 'Diamètre moyen d’un creux, en centimètres. C’est l’échelle du dessin.'],
  density: ['Densité', 'Proportion de la surface creusée. Bas : quelques creux isolés. Haut : un réseau serré.'],
  channelWeight: ['Chenaux', 'Force des veines qui relient les cavités entre elles.'],
  elongation: ['Allongement', 'Étire les cavités dans une direction. À zéro, elles sont rondes.'],
  orientationDeg: ['Orientation', 'Direction de l’allongement, en degrés.'],
  warpAmount: ['Mouvement', 'Courbe les formes. Sans lui, le motif est régulier ; au maximum, il ondule.'],
  irregularity: ['Irrégularité', 'Casse la régularité des contours. Trop haut, les bords crénellent.'],

  negative: ['Relief négatif', 'Inverse creux et bosses autour du plan moyen. Non destructif : le relief d’origine est retrouvé à l’identique.'],
  depth: ['Profondeur du relief', 'Amplitude entre le fond des creux et le haut des plateaux.'],
  shoulder: ['Épaulement', 'Largeur du raccord entre un plateau et un creux. Bas : une marche. Haut : une pente longue.'],
  softness: ['Douceur des arêtes', 'Adoucissement physique, en centimètres — indépendant de la taille du panneau.'],
  wave: ['Ondulation', 'Houle de fond qui module l’ensemble, à très grande longueur d’onde.'],
  texture: ['Grain de surface', 'Grain de plâtre. Il suit la lumière : il ne se voit pas dans le noir.'],
  finish: ['Finition', 'Mat : plâtre, la référence. Satiné : reflet large. Brillant : reflet étroit. Chrome : métal.'],
  materialColor: ['Couleur de matière', 'Teinte du panneau lui-même.'],

  lightAngle: ['Direction de la lumière', 'Azimut de la source, en degrés. Une lumière rasante creuse davantage.'],
  lightHeight: ['Hauteur de lumière', 'Élévation de la source. Bas : ombres longues. Haut : relief écrasé.'],
  exposureEv: ['Exposition', 'Éclaircit ou assombrit TOUTE l’image, plateaux compris.'],
  shadowStrength: ['Intensité des ombres', 'N’agit que sur les creux : les plateaux ne bougent pas. C’est ce qui la distingue de l’exposition.'],
  cavityOcclusion: ['Occlusion des cavités', 'Assombrit le fond des creux selon leur profondeur réelle.'],
  contrast: ['Contraste', 'Écarte les tons autour d’un pivot fixe, sans laver les plateaux.'],
  backlight: ['Halo arrière', 'Lueur derrière le panneau. Décor, sans effet sur le relief.'],
  panelLayout: ['Découpe du panneau', 'Trace les joints d’un panneau composé de plusieurs éléments.'],
  frame: ['Cadre noir', 'Bordure sombre autour de l’œuvre.'],
  wallColor: ['Couleur du mur', 'Fond derrière le panneau. Sert aussi de fond à l’export PNG opaque.'],

  brushSize: ['Taille de brosse', 'Rayon en centimètres RÉELS : la brosse garde sa taille quand le panneau change.'],
  brushStrength: ['Force', 'Dose déposée par passage. La pression du stylet la module encore.'],
  brushElongation: ['Allongement de brosse', 'De ronde à 5 pour 1. L’aire reste constante : allonger ne creuse pas plus fort.'],
  brushAngle: ['Orientation de brosse', 'Angle du grand axe. Sans effet si la brosse suit le tracé.'],
  brushFollow: ['Suit le tracé', 'La brosse se couche dans le sens du geste. L’orientation manuelle est alors ignorée.'],
  symmetry: ['Symétrie', 'Duplique chaque geste en miroir. Le relief généré n’est pas concerné, seule la sculpture l’est.'],

  exportLongSide: ['Grand côté', 'Définition de l’image exportée. Le rapport vient du panneau, jamais l’inverse.'],
  exportCustom: ['Définition sur mesure', 'Grand côté en pixels. Un plafond mémoire s’applique et le dit.'],
  exportTransparent: ['Fond transparent', 'PNG à fond transparent autour d’un panneau rond.'],
};

export class ContextHelp {
  /**
   * @param {HTMLElement} root  racine de l'atelier
   * @param {object} options
   *   signal — signal d'abandon : l'aide meurt avec l'atelier
   *   lireOutil() — rend l'identifiant de l'outil actif
   */
  constructor(root, { signal, lireOutil } = {}) {
    this.root = root;
    this.lireOutil = lireOutil;
    this.boite = root.querySelector('#contextHelp');
    this.titre = root.querySelector('#contextHelpTitle');
    this.corps = root.querySelector('#contextHelpBody');
    this.raccourci = root.querySelector('#contextHelpShortcut');
    if (!this.boite) return;

    const opts = signal ? { signal } : {};
    // Le survol comme le focus : un utilisateur au clavier a droit à la même
    // aide qu'un utilisateur à la souris.
    root.addEventListener('pointerover', (e) => this.viser(e.target), opts);
    root.addEventListener('focusin', (e) => this.viser(e.target), opts);
    root.addEventListener('pointerout', (e) => { if (!root.contains(e.relatedTarget)) this.montrerOutil(); }, opts);
    this.montrerOutil();
  }

  /** Cherche, en remontant depuis l'élément visé, un réglage que l'on sait décrire. */
  viser(cible) {
    if (!cible || !cible.closest) return;
    const commande = cible.closest('[id]');
    if (commande && AIDE_REGLAGES[commande.id]) return this.afficher(...AIDE_REGLAGES[commande.id]);
    const champ = cible.closest('label, .control, .tool-slider');
    const inner = champ && champ.querySelector('[id]');
    if (inner && AIDE_REGLAGES[inner.id]) return this.afficher(...AIDE_REGLAGES[inner.id]);
    const outil = cible.closest('[data-tool]');
    if (outil) {
      const aide = AIDE_OUTILS[outil.dataset.tool];
      if (aide) return this.afficher(aide.titre, aide.corps, aide.raccourci);
    }
    const molette = cible.closest('.param-knob[data-control]');
    if (molette && AIDE_REGLAGES[molette.dataset.control]) return this.afficher(...AIDE_REGLAGES[molette.dataset.control]);
    return undefined;
  }

  /** Retombe sur l'outil actif : c'est le contexte quand rien n'est visé. */
  montrerOutil() {
    const aide = AIDE_OUTILS[this.lireOutil?.()] || null;
    if (aide) this.afficher(aide.titre, aide.corps, aide.raccourci);
    else this.afficher(ACCUEIL.titre, ACCUEIL.corps);
  }

  afficher(titre, corps, raccourci) {
    if (!this.boite) return;
    if (this.titre) this.titre.textContent = titre;
    if (this.corps) this.corps.textContent = corps;
    if (this.raccourci) {
      this.raccourci.textContent = raccourci || '';
      this.raccourci.hidden = !raccourci;
    }
  }
}
