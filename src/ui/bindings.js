// Tables de liaison entre les commandes de l'interface et le projet.
//
// Sorties d'`atelier.js` au lot 8 (§20). Ce sont des DONNÉES : elles ne
// connaissent ni le DOM, ni la classe qui les consomme. Chaque entrée dit où
// lire la valeur dans le projet, où l'écrire, comment l'afficher, et surtout ce
// qu'il faut refaire ensuite — c'est `scope` qui décide entre redimensionner la
// toile, reconstruire la heightmap ou se contenter de réombrer.

export const TOOL_META = {
  light: { icon: '☀', hint: 'Glissez sur l’œuvre pour déplacer la lumière' },
  warp: { icon: '〰', hint: 'Poussez le motif dans le sens du geste' },
  dig: { icon: '◡', hint: 'Glissez pour creuser la matière — la pression du stylet module la force' },
  raise: { icon: '◠', hint: 'Glissez pour bomber la matière — la pression du stylet module la force' },
  smooth: { icon: '≋', hint: 'Glissez pour adoucir la sculpture' },
  erase: { icon: '⌫', hint: 'Glissez pour retrouver le motif d’origine' },
};

// `scope` décide de ce qu'il faut refaire : 'size' redimensionne la toile,
// 'geometry' reconstruit la heightmap, 'shading' se contente de réombrer.
export const BINDINGS = {
  widthCm: { scope: 'size', read: (p) => p.widthCm, write: (p, v) => { p.widthCm = v; }, format: (v) => `${v} cm` },
  heightCm: { scope: 'size', read: (p) => p.heightCm, write: (p, v) => { p.heightCm = v; }, format: (v) => `${v} cm` },
  depthCm: { scope: 'meta', read: (p) => p.depthCm, write: (p, v) => { p.depthCm = v; }, format: (v) => `${v} cm` },

  basinScaleCm: { scope: 'geometry', read: (p) => Math.round(p.geometry.basinScaleCm), write: (p, v) => { p.geometry.basinScaleCm = v; }, format: (v) => `${v} cm` },
  density: { scope: 'geometry', read: (p) => Math.round(p.geometry.density * 100), write: (p, v) => { p.geometry.density = v / 100; }, format: (v) => `${v} %` },
  channelWeight: { scope: 'geometry', read: (p) => Math.round(p.geometry.channelWeight * 100), write: (p, v) => { p.geometry.channelWeight = v / 100; }, format: (v) => `${v} %` },
  elongation: { scope: 'geometry', read: (p) => Math.round(p.geometry.elongation * 100), write: (p, v) => { p.geometry.elongation = v / 100; }, format: (v) => `${v} %` },
  orientationDeg: { scope: 'geometry', read: (p) => Math.round(p.geometry.orientationDeg), write: (p, v) => { p.geometry.orientationDeg = v; }, format: (v) => `${v}°` },
  warpAmount: { scope: 'geometry', read: (p) => Math.round(p.geometry.warpAmount * 100), write: (p, v) => { p.geometry.warpAmount = v / 100; }, format: (v) => `${v} %` },
  irregularity: { scope: 'geometry', read: (p) => Math.round(p.geometry.irregularity * 100), write: (p, v) => { p.geometry.irregularity = v / 100; }, format: (v) => `${v} %` },
  depth: { scope: 'geometry', read: (p) => Math.round(p.geometry.depth * 100), write: (p, v) => { p.geometry.depth = v / 100; }, format: (v) => `${v} %` },
  shoulder: { scope: 'geometry', read: (p) => Math.round(p.geometry.shoulder * 100), write: (p, v) => { p.geometry.shoulder = v / 100; }, format: (v) => `${v} %` },
  softness: { scope: 'geometry', read: (p) => Math.round(p.geometry.softness * 100), write: (p, v) => { p.geometry.softness = v / 100; }, format: (v) => `${v} %` },
  wave: { scope: 'geometry', read: (p) => Math.round(p.geometry.wave * 100), write: (p, v) => { p.geometry.wave = v / 100; }, format: (v) => `${v} %` },
  negative: { scope: 'geometry', kind: 'checkbox', read: (p) => p.geometry.negative, write: (p, v) => { p.geometry.negative = v; } },

  texture: { scope: 'shading', read: (p) => Math.round(p.material.texture * 100), write: (p, v) => { p.material.texture = v / 100; }, format: (v) => `${v} %` },
  materialColor: { scope: 'shading', kind: 'color', read: (p) => p.material.color, write: (p, v) => { p.material.color = v; } },

  exposureEv: { scope: 'shading', read: (p) => Math.round((p.lighting.exposureEv || 0) * 10), write: (p, v) => { p.lighting.exposureEv = v / 10; }, format: (v) => `${(v / 10).toFixed(1)} EV` },
  shadowStrength: { scope: 'shading', read: (p) => Math.round(p.lighting.shadowStrength * 100), write: (p, v) => { p.lighting.shadowStrength = v / 100; }, format: (v) => `${v} %` },
  cavityOcclusion: { scope: 'shading', read: (p) => Math.round(p.lighting.cavityOcclusion * 100), write: (p, v) => { p.lighting.cavityOcclusion = v / 100; }, format: (v) => `${v} %` },
  finish: { scope: 'shading', kind: 'select', read: (p) => p.material.finish, write: (p, v) => { p.material.finish = v; } },

  lightAngle: { scope: 'shading', read: (p) => p.lighting.angle, write: (p, v) => { p.lighting.angle = v; }, format: (v) => `${v}°` },
  lightHeight: { scope: 'shading', read: (p) => p.lighting.height, write: (p, v) => { p.lighting.height = v; }, format: (v) => `${v}°` },
  contrast: { scope: 'shading', read: (p) => Math.round(p.lighting.contrast * 100), write: (p, v) => { p.lighting.contrast = v / 100; }, format: (v) => `${v} %` },
  backlight: { scope: 'shading', read: (p) => Math.round(p.lighting.backlight * 100), write: (p, v) => { p.lighting.backlight = v / 100; }, format: (v) => `${v} %` },

  panelLayout: { scope: 'shading', kind: 'select', read: (p) => p.presentation.panelLayout, write: (p, v) => { p.presentation.panelLayout = v; } },
  frame: { scope: 'shading', kind: 'checkbox', read: (p) => p.presentation.frame, write: (p, v) => { p.presentation.frame = v; } },
  wallColor: { scope: 'shading', kind: 'color', read: (p) => p.presentation.wallColor, write: (p, v) => { p.presentation.wallColor = v; } },
};
