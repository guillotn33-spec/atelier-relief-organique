// Verrouillage d'intention (§22) — sept séquences, dont quatre adverses.
//
//   node tests/gestures.mjs
//
// Ces séquences se rejouent sans navigateur parce que `GestureManager` est
// écrit hors DOM. C'est la raison d'être de ce découpage : un stylet posé
// pendant un pinch, ou un doigt relevé hors de la toile, sont pénibles à
// produire à la main dans un navigateur et impossibles à reproduire à
// l'identique — ici ce sont six lignes déterministes.
//
// Deux invariants sont vérifiés à CHAQUE séquence, en plus de son objet propre :
//   • un seul rôle a été pris, et il n'a jamais changé en cours de geste ;
//   • l'état final est neutre : aucun rôle, aucun pointeur retenu.

import { GestureManager, ROLE } from '../src/ui/gestures.js';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  console.log(`${ok ? '  OK  ' : ' ÉCHEC'} ${label}`);
  if (detail) console.log(`        ${detail}`);
}

/** Bâtit un gestionnaire instrumenté. `zoneOf` décide de la zone touchée. */
function harness({ tool = 'dig', zoneOf = () => 'canvas' } = {}) {
  const events = [];
  const roles = [];
  let undoDepth = 0;

  const manager = new GestureManager({
    activeTool: () => tool,
    hitTest: (p) => zoneOf(p),
    onRoleChange: (role) => roles.push(role),
    onSculptStart: (p) => {
      undoDepth += 1; // l'atelier empile une annulation à l'ouverture du trait
      events.push(`sculptStart@${p.x}`);
    },
    onSculptMove: (p) => events.push(`sculptMove@${p.x}`),
    onSculptEnd: (p) => events.push(`sculptEnd${p && p.cancelled ? '(annulé)' : ''}`),
    onLightStart: () => events.push('lightStart'),
    onLightMove: () => events.push('lightMove'),
    onCameraStart: (s) => events.push(`cameraStart d=${Math.round(s.distance)}`),
    onCameraMove: (s) => events.push(`cameraMove d=${s ? Math.round(s.distance) : '-'}`),
    onResizeStart: () => events.push('resizeStart'),
    onResizeMove: () => events.push('resizeMove'),
    onResizeEnd: () => events.push('resizeEnd'),
    onPanStart: () => events.push('panStart'),
    onPanMove: () => events.push('panMove'),
  });

  return {
    manager,
    events,
    /** Rôles réellement pris, hors retours à l'état neutre. */
    rolesTaken: () => roles.filter((r) => r !== ROLE.NONE),
    undoDepth: () => undoDepth,
    neutral: () => manager.role === ROLE.NONE && manager.pointerCount === 0 && !manager.busy,
  };
}

function assertSingleRole(h, expected, label) {
  const taken = h.rolesTaken();
  const unique = [...new Set(taken)];
  check(
    `${label} — un seul rôle pris, verrouillé`,
    unique.length === 1 && unique[0] === expected,
    `rôles observés : ${taken.length ? taken.join(' → ') : '(aucun)'}`
  );
}

function assertNeutral(h, label) {
  check(`${label} — retour à l’état neutre`, h.neutral(), `rôle=${h.manager.role} pointeurs=${h.manager.pointerCount}`);
}

// ---------------------------------------------------------------- séquence 1
// Stylet posé PENDANT un pinch à deux doigts.
console.log('\n1. Stylet posé pendant un pinch à deux doigts\n');
{
  const h = harness();
  h.manager.pointerDown({ id: 1, type: 'touch', x: 300, y: 300, time: 0 });
  h.manager.pointerDown({ id: 2, type: 'touch', x: 500, y: 300, time: 4 });
  h.manager.pointerMove({ id: 2, type: 'touch', x: 560, y: 300, time: 20 });
  // Le Pencil arrive au milieu du pinch : il ne doit RIEN déclencher.
  h.manager.pointerDown({ id: 3, type: 'pen', x: 400, y: 320, time: 30, pressure: 0.8 });
  h.manager.pointerMove({ id: 3, type: 'pen', x: 430, y: 330, time: 40, pressure: 0.8 });
  const roleWithPen = h.manager.role;
  h.manager.pointerUp({ id: 3, type: 'pen', x: 430, y: 330, time: 50 });
  h.manager.pointerUp({ id: 1, type: 'touch', x: 300, y: 300, time: 60 });
  h.manager.pointerUp({ id: 2, type: 'touch', x: 560, y: 300, time: 62 });

  check('1 — le rôle reste caméra malgré le stylet', roleWithPen === ROLE.CAMERA, `rôle pendant le stylet : ${roleWithPen}`);
  check('1 — aucune sculpture déclenchée', !h.events.some((e) => e.startsWith('sculpt')), h.events.join(' '));
  assertSingleRole(h, ROLE.CAMERA, '1');
  assertNeutral(h, '1');
}

// ---------------------------------------------------------------- séquence 2
// Deuxième doigt posé pendant un trait au stylet.
console.log('\n2. Deuxième doigt posé pendant un trait\n');
{
  const h = harness();
  h.manager.pointerDown({ id: 1, type: 'pen', x: 200, y: 200, time: 0, pressure: 0.9 });
  h.manager.pointerMove({ id: 1, type: 'pen', x: 220, y: 205, time: 10, pressure: 0.9 });
  h.manager.pointerDown({ id: 2, type: 'touch', x: 600, y: 400, time: 15 });
  h.manager.pointerMove({ id: 2, type: 'touch', x: 640, y: 420, time: 25 });
  h.manager.pointerMove({ id: 1, type: 'pen', x: 250, y: 215, time: 30, pressure: 0.9 });
  const roleWithSecond = h.manager.role;
  h.manager.pointerUp({ id: 2, type: 'touch', x: 640, y: 420, time: 40 });
  h.manager.pointerUp({ id: 1, type: 'pen', x: 250, y: 215, time: 50 });

  check('2 — le rôle reste sculpture malgré le doigt', roleWithSecond === ROLE.SCULPT, `rôle : ${roleWithSecond}`);
  check('2 — aucune navigation caméra déclenchée', !h.events.some((e) => e.startsWith('camera')), h.events.join(' '));
  check('2 — le trait continue après l’arrivée du doigt', h.events.includes('sculptMove@250'), h.events.join(' '));
  assertSingleRole(h, ROLE.SCULPT, '2');
  assertNeutral(h, '2');
}

// ---------------------------------------------------------------- séquence 3
// Doigt levé HORS de la toile. C'est le bug du lot 0 : la v1 n'écoutait les
// fins de geste que sur l'œuvre, si bien qu'un doigt relevé ailleurs restait
// compté pour toujours et bloquait toute sculpture ultérieure.
console.log('\n3. Doigt levé hors de la toile\n');
{
  const h = harness();
  h.manager.pointerDown({ id: 1, type: 'touch', x: 300, y: 300, time: 0 });
  h.manager.pointerDown({ id: 2, type: 'touch', x: 500, y: 300, time: 3 });
  h.manager.pointerMove({ id: 2, type: 'touch', x: 900, y: 700, time: 20 });
  // Les deux doigts se relèvent loin de l'œuvre — la fenêtre les rapporte quand même.
  h.manager.pointerUp({ id: 2, type: 'touch', x: 1400, y: 900, time: 30 });
  h.manager.pointerUp({ id: 1, type: 'touch', x: -50, y: -80, time: 35 });

  check('3 — aucun pointeur retenu après relevé hors toile', h.manager.pointerCount === 0, `${h.manager.pointerCount} retenu(s)`);
  assertNeutral(h, '3');

  // Et surtout : un geste ultérieur doit repartir normalement.
  h.manager.pointerDown({ id: 9, type: 'pen', x: 210, y: 210, time: 100, pressure: 1 });
  const reprise = h.manager.role;
  h.manager.pointerUp({ id: 9, type: 'pen', x: 210, y: 210, time: 120 });
  check('3 — un geste ultérieur n’est pas bloqué', reprise === ROLE.SCULPT, `rôle repris : ${reprise}`);
}

// ---------------------------------------------------------------- séquence 4
// Pinch commencé sur la barre d'outils.
console.log('\n4. Pinch commencé sur la barre d’outils\n');
{
  const h = harness({ zoneOf: (p) => (p.y > 640 ? 'ui' : 'canvas') });
  h.manager.pointerDown({ id: 1, type: 'touch', x: 300, y: 660, time: 0 });
  h.manager.pointerDown({ id: 2, type: 'touch', x: 420, y: 665, time: 5 });
  h.manager.pointerMove({ id: 1, type: 'touch', x: 260, y: 660, time: 15 });
  h.manager.pointerMove({ id: 2, type: 'touch', x: 470, y: 665, time: 20 });
  const role = h.manager.role;
  h.manager.pointerUp({ id: 1, type: 'touch', x: 260, y: 660, time: 30 });
  h.manager.pointerUp({ id: 2, type: 'touch', x: 470, y: 665, time: 32 });

  check('4 — le rôle est « interface », pas caméra', role === ROLE.UI, `rôle : ${role}`);
  check('4 — ni caméra ni sculpture déclenchées', h.events.length === 0, h.events.join(' ') || '(aucun événement)');
  assertSingleRole(h, ROLE.UI, '4');
  assertNeutral(h, '4');
}

// ---------------------------------------------------------------- séquence 5
// Doigt seul qui BOUGE vite pendant la fenêtre d'arbitrage de 70 ms.
console.log('\n5. Doigt seul qui part vite pendant la fenêtre de 70 ms\n');
{
  const h = harness();
  const path = [
    { x: 100, y: 100, time: 0 },
    { x: 104, y: 101, time: 6 },
    { x: 113, y: 103, time: 12 },
    { x: 129, y: 107, time: 18 },
    { x: 152, y: 112, time: 24 },
  ];
  h.manager.pointerDown({ id: 1, type: 'touch', ...path[0] });
  let decidedAt = null;
  for (let i = 1; i < path.length; i++) {
    h.manager.pointerMove({ id: 1, type: 'touch', ...path[i] });
    if (decidedAt === null && h.manager.role === ROLE.SCULPT) decidedAt = path[i].time;
  }
  h.manager.pointerUp({ id: 1, type: 'touch', ...path[path.length - 1] });

  check('5 — le trait est décidé avant l’expiration des 70 ms', decidedAt !== null && decidedAt < 70, `décidé à ${decidedAt} ms`);

  // Les points mémorisés doivent être rejoués DANS L'ORDRE et à leurs
  // coordonnées d'origine : sinon un trait rapide perd son premier segment.
  const replayed = h.events.filter((e) => e.startsWith('sculpt')).join(' ');
  const expected = 'sculptStart@100 sculptMove@104 sculptMove@113 sculptMove@129 sculptMove@152 sculptEnd';
  check('5 — points mémorisés rejoués dans l’ordre, coordonnées d’origine', replayed === expected, replayed);
  assertSingleRole(h, ROLE.SCULPT, '5');
  assertNeutral(h, '5');
}

// ---------------------------------------------------------------- séquence 6
// Deux pointeurs posés dans la même frame — pinch d'emblée.
console.log('\n6. Deux pointeurs posés dans la même frame\n');
{
  const h = harness();
  h.manager.pointerDown({ id: 1, type: 'touch', x: 380, y: 300, time: 0 });
  h.manager.pointerDown({ id: 2, type: 'touch', x: 620, y: 300, time: 0 });
  const role = h.manager.role;
  h.manager.pointerMove({ id: 1, type: 'touch', x: 360, y: 300, time: 16 });
  h.manager.pointerUp({ id: 1, type: 'touch', x: 360, y: 300, time: 40 });
  h.manager.pointerUp({ id: 2, type: 'touch', x: 620, y: 300, time: 42 });

  check('6 — pinch reconnu d’emblée', role === ROLE.CAMERA, `rôle : ${role}`);
  check('6 — la caméra reçoit une distance initiale', h.events.some((e) => e.startsWith('cameraStart')), h.events.join(' '));
  check('6 — aucune sculpture déclenchée', !h.events.some((e) => e.startsWith('sculpt')), h.events.join(' '));
  assertSingleRole(h, ROLE.CAMERA, '6');
  assertNeutral(h, '6');
}

// ---------------------------------------------------------------- séquence 7
// pointercancel de Safari en plein trait — appel entrant, geste système.
console.log('\n7. Annulation système en plein trait\n');
{
  const h = harness();
  h.manager.pointerDown({ id: 1, type: 'pen', x: 200, y: 200, time: 0, pressure: 1 });
  h.manager.pointerMove({ id: 1, type: 'pen', x: 240, y: 210, time: 12, pressure: 1 });
  h.manager.pointerMove({ id: 1, type: 'pen', x: 280, y: 225, time: 24, pressure: 1 });
  h.manager.pointerCancel({ id: 1, type: 'pen', x: 280, y: 225, time: 30 });

  check('7 — le trait est clos une seule fois', h.events.filter((e) => e.startsWith('sculptEnd')).length === 1, h.events.join(' '));
  check('7 — la clôture est marquée comme annulée', h.events.includes('sculptEnd(annulé)'), h.events.join(' '));
  check('7 — une seule entrée d’annulation empilée', h.undoDepth() === 1, `${h.undoDepth()} entrée(s)`);
  assertSingleRole(h, ROLE.SCULPT, '7');
  assertNeutral(h, '7');

  // Annulation pendant la fenêtre d'arbitrage : rien n'a été appliqué, donc
  // aucune entrée d'annulation ne doit rester en l'air.
  const h2 = harness();
  h2.manager.pointerDown({ id: 5, type: 'touch', x: 100, y: 100, time: 0 });
  h2.manager.pointerCancel({ id: 5, type: 'touch', x: 100, y: 100, time: 10 });
  check('7bis — annulation pendant l’arbitrage : aucune annulation orpheline', h2.undoDepth() === 0 && h2.events.length === 0, `undo=${h2.undoDepth()} events=${h2.events.join(' ') || '(aucun)'}`);
  assertNeutral(h2, '7bis');
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées\n`);
process.exit(failed.length ? 1 : 0);
