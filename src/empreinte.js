// Empreinte comportementale de l'atelier — outil de développement (§20).
//
//   import('/empreinte.js').then((m) => m.empreinte()).then(JSON.stringify)
//
// POURQUOI. Le lot 8 découpe `atelier.js`. Un découpage n'a qu'un seul critère
// de réussite : RIEN NE CHANGE. Or « rien ne change » ne se démontre pas en
// relisant un diff de 1 500 lignes, ni en cliquant au hasard après coup. Il
// faut une empreinte : une suite d'interactions fixée, jouée avant le
// découpage, rejouée après, et comparée octet pour octet.
//
// CE HARNAIS NE TOUCHE À AUCUN INTERNE. Il ne connaît ni la classe `Atelier`,
// ni ses champs, ni ses méthodes : il clique, il glisse, il tape, puis il
// regarde ce qu'un utilisateur verrait — les pixels de l'œuvre et l'état des
// commandes. C'est précisément ce qui lui permet de survivre au découpage qu'il
// doit éprouver : si l'empreinte ne bouge pas alors que tout le code a été
// déplacé, c'est que le déplacement n'a rien cassé.
//
// Il n'est servi qu'en mode `--serve`, comme le banc de mesure : il n'a rien à
// faire dans un déploiement.

/**
 * Rend la main à la boucle d'événements SANS passer par un minuteur.
 *
 * POURQUOI PAS `setTimeout`. Un onglet caché depuis plus de cinq minutes — le
 * cas d'un pilotage automatisé — subit le bridage « intensif » de Chrome : les
 * minuteurs y tombent à une exécution par MINUTE. La séquence passait alors de
 * deux minutes à plus d'une heure. `MessageChannel` planifie une tâche sans
 * minuteur et échappe à ce bridage.
 *
 * Ce n'est pas un contournement gratuit : l'atelier rend de façon SYNCHRONE sur
 * les chemins que cette séquence emprunte — `endStroke` solde le rectangle en
 * attente puis réombre, `endResize` reconstruit, un réglage rend dans son
 * propre gestionnaire. Il n'y a donc rien à attendre au sens d'une horloge ;
 * il faut seulement laisser la boucle d'événements souffler. Ce qui reste
 * différé, l'empreinte le voit par `attendreStabilite`, qui compare des états
 * au lieu de compter des millisecondes.
 */
function céder() {
  return new Promise((resolve) => {
    const canal = new MessageChannel();
    canal.port1.onmessage = () => {
      canal.port1.close();
      resolve();
    };
    canal.port2.postMessage(0);
  });
}

/** `ms` n'est plus une durée mais une INDICATION : combien de tours céder. */
async function attendre(ms) {
  const tours = Math.min(12, Math.max(2, Math.ceil(ms / 100)));
  for (let i = 0; i < tours; i++) await céder();
}

/** FNV-1a 32 bits sur les octets du canvas. Compact, stable, sans dépendance. */
function empreinteOctets(octets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < octets.length; i++) {
    h ^= octets[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function hachageCanvas() {
  const cv = document.getElementById('reliefCanvas');
  if (!cv || cv.hidden || !cv.width) return 'masque';
  const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  return `${cv.width}x${cv.height}:${empreinteOctets(data)}`;
}

/**
 * État visible des commandes. On lit TOUT ce qui porte un identifiant : un
 * découpage qui oublierait de rebrancher un curseur se verrait ici, alors
 * qu'une liste choisie à la main laisserait passer précisément ce qu'on n'a pas
 * pensé à y mettre.
 */
function etatCommandes() {
  const out = {};
  for (const el of document.querySelectorAll('#atelier input[id], #atelier select[id]')) {
    out[el.id] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.disabled) out[el.id + ':inactif'] = true;
  }
  for (const el of document.querySelectorAll('#atelier output[id]')) out[el.id] = el.value;
  for (const id of ['seedLabel', 'sizeLabel', 'designName', 'hintText', 'saveStatus', 'exportNote', 'exportCustomValue']) {
    const el = document.getElementById(id);
    if (el) out[id] = el.hidden ? '(masque)' : el.textContent.trim();
  }
  const aw = document.getElementById('artWrap');
  if (aw) {
    out['artWrap:forme'] = aw.dataset.shape || '';
    out['artWrap:vue'] = aw.dataset.view || '';
    const r = aw.getBoundingClientRect();
    out['artWrap:taille'] = `${Math.round(r.width)}x${Math.round(r.height)}`;
  }
  for (const b of document.querySelectorAll('#atelier [data-tool], #atelier .preset')) {
    if (b.classList.contains('active')) out['actif:' + (b.dataset.tool || b.dataset.preset)] = true;
  }
  for (const id of ['undoBtn', 'redoBtn', 'restoreBase']) {
    const el = document.getElementById(id);
    if (el) out[id + ':inactif'] = !!el.disabled;
  }
  return out;
}

/**
 * Attend que l'œuvre CESSE DE CHANGER, au lieu d'attendre une durée.
 *
 * POURQUOI. La première version de ce harnais attendait un délai fixe après
 * chaque action. Dans un onglet d'arrière-plan — celui d'un pilotage
 * automatisé — `requestAnimationFrame` ne se déclenche pas et les minuteurs
 * sont bridés à une exécution par seconde : un rendu peut donc être à moitié
 * fait quand l'empreinte le photographie. Mesuré : la même étape relevée à
 * 719051f9 une fois et 4f7c3192 ensuite, sur un code identique — soit une
 * référence qui accusait un découpage innocent.
 *
 * On échantillonne donc jusqu'à obtenir deux valeurs consécutives identiques.
 * L'attente est bornée : une étape qui ne se stabilise pas doit se voir dans
 * l'empreinte, pas bloquer la séquence.
 */
async function attendreStabilite({ pas = 150, maxi = 26 } = {}) {
  const pastille = document.getElementById('rendering');
  let precedent = null;
  let calmes = 0;
  for (let i = 0; i < maxi; i++) {
    // `rebuild()` DIFFÈRE son calcul : `requestAnimationFrame` en onglet
    // visible, `setTimeout` en onglet caché. Tant que la pastille « Calcul… »
    // est là, la heightmap n'est pas refaite et le canvas montre encore l'image
    // précédente — parfaitement stable, et parfaitement fausse. Deux relevés
    // identiques ne suffisent donc pas : il faut aussi que l'atelier se déclare
    // au repos.
    const occupe = pastille && pastille.classList.contains('show');
    const actuel = hachageCanvas();
    if (!occupe && actuel === precedent) {
      calmes++;
      if (calmes >= 1) return { hachage: actuel, tours: i + 1, stabilise: true };
    } else {
      calmes = 0;
    }
    precedent = actuel;
    // Attente par VRAI minuteur, volontairement : c'est le seul moyen de
    // laisser tourner le `setTimeout` différé de `rebuild()`. Les cessions sans
    // minuteur, elles, ne lui donnent jamais la main.
    await new Promise((r) => setTimeout(r, pas));
  }
  return { hachage: hachageCanvas(), tours: maxi, stabilise: false };
}

const signature = () => ({ canvas: hachageCanvas(), commandes: etatCommandes() });

// ---- Gestes synthétiques ----

const evenement = (type, x, y, { id = 1, type_ = 'pen', pression = 0.85 } = {}) =>
  new PointerEvent(type, {
    pointerId: id,
    pointerType: type_,
    isPrimary: true,
    clientX: x,
    clientY: y,
    bubbles: true,
    cancelable: true,
    buttons: type === 'pointerup' ? 0 : 1,
    pressure: type === 'pointerup' ? 0 : pression,
  });

/**
 * Trace un segment sur l'œuvre. Les coordonnées sont des FRACTIONS de l'œuvre,
 * pas des pixels : l'empreinte reste comparable tant que la fenêtre ne change
 * pas de taille, et la taille de l'œuvre est enregistrée pour qu'une
 * comparaison entre deux fenêtres différentes soit refusée plutôt que crue.
 */
async function tracer(x0, y0, x1, y1, pas = 10) {
  const stage = document.getElementById('stage');
  const b = document.getElementById('artWrap').getBoundingClientRect();
  const px = (fx, fy) => [b.left + b.width * fx, b.top + b.height * fy];
  const [ax, ay] = px(x0, y0);
  stage.dispatchEvent(evenement('pointerdown', ax, ay));
  await attendre(60);
  // Les déplacements partent d'un seul tenant, sans attente entre eux.
  // POURQUOI : dans un onglet d'arrière-plan, Chrome plafonne les minuteurs à
  // une exécution par seconde. Dix attentes de 20 ms deviennent alors dix
  // secondes, et la séquence entière passe de deux minutes à un quart d'heure.
  // L'atelier regroupe de toute façon les déplacements par image, si bien que
  // le relief obtenu est le même — et surtout il est DÉTERMINISTE, ce qui est
  // la seule chose que cette empreinte demande.
  for (let i = 1; i <= pas; i++) {
    const [x, y] = px(x0 + ((x1 - x0) * i) / pas, y0 + ((y1 - y0) * i) / pas);
    stage.dispatchEvent(evenement('pointermove', x, y));
  }
  const [bx, by] = px(x1, y1);
  window.dispatchEvent(evenement('pointerup', bx, by));
  await attendre(500);
}

const cliquer = async (selecteur, ms = 260) => {
  const el = document.querySelector(selecteur);
  if (!el) throw new Error(`introuvable : ${selecteur}`);
  el.click();
  await attendre(ms);
};

const regler = async (selecteur, valeur, ms = 240) => {
  const el = document.querySelector(selecteur);
  if (!el) throw new Error(`introuvable : ${selecteur}`);
  if (el.type === 'checkbox') {
    el.checked = !!valeur;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    el.value = String(valeur);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  await attendre(ms);
};

/** Glisser de la poignée de redimensionnement, en pixels écran. */
async function tirerPoignee(dx, dy, pas = 8) {
  const stage = document.getElementById('stage');
  const h = document.getElementById('resizeHandle');
  const r = h.getBoundingClientRect();
  const x0 = r.left + r.width / 2;
  const y0 = r.top + r.height / 2;
  h.dispatchEvent(evenement('pointerdown', x0, y0, { id: 77, type_: 'mouse' }));
  await attendre(60);
  for (let i = 1; i <= pas; i++) {
    stage.dispatchEvent(evenement('pointermove', x0 + (dx * i) / pas, y0 + (dy * i) / pas, { id: 77, type_: 'mouse' }));
  }
  window.dispatchEvent(evenement('pointerup', x0 + dx, y0 + dy, { id: 77, type_: 'mouse' }));
  await attendre(800);
}

// ---- La séquence ----
//
// Chaque étape porte un nom : quand une comparaison échoue, c'est le nom qui
// dit ce qui a été cassé, sans avoir à rejouer quoi que ce soit à la main.

const ETAPES = [
  ['depart', async () => {}],
  ['preset-cellules', () => cliquer('.preset[data-preset="cellules"]', 700)],
  ['densite-30', () => regler('#density', 30, 600)],
  ['cavites-60', () => regler('#basinScaleCm', 60, 600)],
  ['outil-creuser', () => cliquer('[data-tool="dig"]')],
  ['trait-horizontal', () => tracer(0.2, 0.5, 0.8, 0.5)],
  ['brosse-allongee', async () => {
    await regler('#brushElongation', 60, 0);
    await regler('#brushAngle', 45, 300);
  }],
  ['outil-bomber', () => cliquer('[data-tool="raise"]')],
  ['trait-vertical', () => tracer(0.5, 0.2, 0.5, 0.8)],
  ['suit-le-trace', () => regler('#brushFollow', true)],
  ['trait-diagonal', () => tracer(0.25, 0.25, 0.75, 0.75)],
  ['annuler-2', async () => {
    document.getElementById('undoBtn').click();
    document.getElementById('undoBtn').click();
    await attendre(900);
  }],
  ['retablir-1', () => cliquer('#redoBtn', 500)],
  ['outil-lumiere', () => cliquer('[data-tool="light"]')],
  ['deplacer-lumiere', () => tracer(0.3, 0.3, 0.7, 0.6, 6)],
  ['definir-base', () => cliquer('#setBase', 400)],
  ['variation', () => cliquer('#variationTop', 900)],
  ['retour-base', () => cliquer('#restoreBase', 900)],
  ['negatif', () => regler('#negative', true, 700)],
  ['negatif-retire', () => regler('#negative', false, 700)],
  ['matiere-brillant', () => regler('#finish', 'brillant', 600)],
  ['exposition-basse', () => regler('#exposureEv', -10, 600)],
  ['ombres-fortes', () => regler('#shadowStrength', 90, 600)],
  ['verrou-rapport', () => cliquer('#ratioLock', 300)],
  ['redimensionner', () => tirerPoignee(260, 90)],
  ['definition-export', () => regler('#exportLongSide', 4096, 500)],

  // ---- Interface de composition (refonte du 16 août) ----
  //
  // Aucune suite Node ne couvre cette interface : les molettes, la bande de
  // variations et le panneau d'export vivent dans le document. C'est ici, et
  // nulle part ailleurs, qu'elles sont éprouvées.

  ['molette-clavier', async () => {
    const knob = document.querySelector('.param-knob[data-control="density"]');
    if (!knob) return { 'molette:absente': true };
    for (let i = 0; i < 5; i++) knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    await attendre(300);
    return { 'molette:role': knob.getAttribute('role'), 'molette:valeur': knob.getAttribute('aria-valuenow') };
  }],
  ['molette-roulette', async () => {
    const knob = document.querySelector('.param-knob[data-control="basinScaleCm"]');
    if (!knob) return { 'molette2:absente': true };
    for (let i = 0; i < 3; i++) knob.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    await attendre(300);
    return { 'molette2:valeur': knob.getAttribute('aria-valuenow') };
  }],
  ['variation-enregistree', async () => {
    await cliquer('#variationTop', 900);
    return { 'variations:nombre': document.querySelectorAll('.variation-card').length };
  }],
  ['variation-restauree', async () => {
    const cartes = document.querySelectorAll('.variation-card');
    if (!cartes.length) return { 'variations:absentes': true };
    cartes[0].click();
    await attendre(900);
    return { 'variations:restauree': document.getElementById('designName')?.textContent || '' };
  }],

  // RÉGRESSION SCELLÉE ICI. Chaque atelier reposait ses écouteurs sur des
  // éléments du document qui lui survivent : après l'ouverture d'un second
  // projet, un clic sur « Exporter » produisait DEUX fichiers, dont un aux
  // dimensions du projet précédent. Cette étape compte les fichiers.
  ['un-seul-fichier-par-export', async () => {
    // Définition modeste : ce qu'on compte ici, ce sont des fichiers, pas des
    // pixels. Encoder deux PNG de 4096 px sur un onglet bridé coûterait une
    // minute pour rien.
    await regler('#exportLongSide', 2048, 0);
    const un = await compterExports();
    await creerProjet();
    const deux = await compterExports();
    return { 'export:fichiers': un, 'export:fichiersApresSecondProjet': deux };
  }],
];

/** Compte les fichiers qu'un clic sur « Exporter » produit, sans rien écrire. */
async function compterExports() {
  const captures = [];
  const vraiCreate = URL.createObjectURL;
  const vraiClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = () => 'blob:empreinte';
  HTMLAnchorElement.prototype.click = function () { captures.push(this.download); };
  const bouton = document.getElementById('exportRun');
  bouton?.click();
  // L'export passe par `toBlob`, asynchrone : ici il faut de VRAIES attentes.
  // On s'arrête dès que le bouton redevient actif — c'est le signal de fin que
  // `run()` donne lui-même — puis on laisse une marge au cas où un second
  // écouteur fantôme lancerait un export de plus.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (bouton && !bouton.disabled && captures.length) break;
  }
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 150));
  URL.createObjectURL = vraiCreate;
  HTMLAnchorElement.prototype.click = vraiClick;
  return captures.length;
}

/**
 * Joue la séquence et rend l'empreinte.
 * Le projet DOIT être neuf : la séquence part de l'état par défaut, et un
 * projet repris fausserait la comparaison. `preparer()` s'en charge.
 */
export async function empreinte({ verbeux = false } = {}) {
  const releves = [];
  for (const [nom, action] of ETAPES) {
    // Témoin de progression : une séquence qui se bloque doit dire OÙ.
    window.__etape = nom;
    try {
      // Une étape peut rendre des mesures propres : elles rejoignent l'état des
      // commandes, et la comparaison les prend donc en charge sans rien savoir
      // d'elles.
      const extra = await action();
      const attente = await attendreStabilite();
      const releve = { etape: nom, ...signature(), stabilise: attente.stabilise };
      if (extra && typeof extra === 'object') Object.assign(releve.commandes, extra);
      releves.push(releve);
    } catch (erreur) {
      releves.push({ etape: nom, erreur: String(erreur && erreur.message) });
    }
    window.__etape = nom + ' (relevé)';
    if (verbeux) console.log('[empreinte]', nom, releves[releves.length - 1].canvas);
  }
  return {
    fenetre: `${window.innerWidth}x${window.innerHeight}`,
    etapes: releves.length,
    releves,
  };
}

/**
 * Repart d'un projet neuf, aux dimensions par défaut du formulaire.
 *
 * DEUX PROJETS, ET LE PREMIER EST JETÉ. Au chargement, l'atelier reprend le
 * dernier projet enregistré et lance sa construction. Créer aussitôt un projet
 * neuf le fait cohabiter avec ce qui reste en vol, et l'empreinte relève alors
 * un mélange des deux. Mesuré : la même séquence donnait `4f7c3192` au premier
 * projet d'une page et `719051f9` au second, pour un projet identique au champ
 * près. Le projet de préchauffage absorbe cette transition ; celui qui est
 * mesuré part d'un atelier déjà stabilisé.
 */
export async function preparer() {
  await creerProjet();
  return creerProjet();
}

async function creerProjet() {
  const nouveau = document.getElementById('newProject');
  if (nouveau && !document.getElementById('atelier').hidden) {
    nouveau.click();
    await attendre(600);
  }
  const creer = document.getElementById('createProject');
  if (creer) {
    creer.click();
    await attendre(1800);
  }
  return signature();
}

/** Compare deux empreintes et rend la liste des divergences. */
export function comparer(reference, actuelle) {
  const ecarts = [];
  if (reference.fenetre !== actuelle.fenetre) {
    return [{ etape: '(fenêtre)', champ: 'taille', avant: reference.fenetre, apres: actuelle.fenetre, fatal: true }];
  }
  const n = Math.max(reference.releves.length, actuelle.releves.length);
  for (let i = 0; i < n; i++) {
    const a = reference.releves[i];
    const b = actuelle.releves[i];
    if (!a || !b) {
      ecarts.push({ etape: (a || b).etape, champ: '(présence)', avant: !!a, apres: !!b });
      continue;
    }
    if (a.etape !== b.etape) {
      ecarts.push({ etape: a.etape, champ: '(ordre)', avant: a.etape, apres: b.etape });
      continue;
    }
    if (a.erreur || b.erreur) {
      if (a.erreur !== b.erreur) ecarts.push({ etape: a.etape, champ: '(erreur)', avant: a.erreur, apres: b.erreur });
      continue;
    }
    if (a.stabilise === false || b.stabilise === false) {
      ecarts.push({ etape: a.etape, champ: '(non stabilisé)', avant: a.stabilise, apres: b.stabilise });
    }
    if (a.canvas !== b.canvas) ecarts.push({ etape: a.etape, champ: 'canvas', avant: a.canvas, apres: b.canvas });
    const cles = new Set([...Object.keys(a.commandes), ...Object.keys(b.commandes)]);
    for (const cle of cles) {
      if (String(a.commandes[cle]) !== String(b.commandes[cle])) {
        ecarts.push({ etape: a.etape, champ: cle, avant: a.commandes[cle], apres: b.commandes[cle] });
      }
    }
  }
  return ecarts;
}
