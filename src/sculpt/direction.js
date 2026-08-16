// Orientation de brosse reprise du tracé (§6).
//
// POURQUOI L'ANGLE DOUBLE. Une ellipse est identique à elle-même après un
// demi-tour : un tracé qui part vers la droite et un tracé qui part vers la
// gauche doivent coucher la brosse de la même façon. Lisser directement
// l'angle, ou le vecteur de direction, ferait pivoter la brosse de 180° dès
// qu'un aller-retour change le signe du déplacement — un tremblement de main
// suffit. En représentant la direction par (cos 2θ, sin 2θ), les deux sens
// deviennent le MÊME point, ce qu'ils sont pour la forme, et la bascule
// disparaît.
//
// Ce module ne connaît ni le DOM ni la brosse : il transforme une suite de
// déplacements en un angle. C'est ce qui le rend éprouvable.

// Part du nouvel échantillon dans la moyenne. Plus bas, la brosse traîne
// derrière le geste ; plus haut, elle suit le bruit de numérisation du stylet.
export const FOLLOW_SMOOTHING = 0.25;

// En deçà, le déplacement n'est pas une direction mais du bruit : l'inclure
// ferait vibrer l'orientation quand la main s'arrête sans lever le stylet.
export const MIN_TRAVEL_CM = 0.01;

export class DirectionTracker {
  /** @param {number} smoothing part du nouvel échantillon, dans ]0, 1] */
  constructor(smoothing = FOLLOW_SMOOTHING) {
    this.smoothing = smoothing;
    // `null` tant qu'aucun déplacement exploitable n'a été vu.
    this.c2 = null;
    this.s2 = null;
  }

  /** Le tracé a-t-il fourni au moins une direction utilisable ? */
  get ready() {
    return this.c2 !== null;
  }

  /** Intègre un déplacement, en cm. Retourne `true` s'il a compté. */
  push(dxCm, dyCm) {
    const len = Math.hypot(dxCm, dyCm);
    if (!(len > MIN_TRAVEL_CM)) return false;
    const c = dxCm / len;
    const s = dyCm / len;
    const c2 = c * c - s * s;
    const s2 = 2 * c * s;
    this.c2 = this.c2 === null ? c2 : this.c2 + (c2 - this.c2) * this.smoothing;
    this.s2 = this.s2 === null ? s2 : this.s2 + (s2 - this.s2) * this.smoothing;
    return true;
  }

  /**
   * Angle de la brosse, en degrés dans [0, 180[.
   * `fallbackDeg` sert tant qu'aucune direction n'a été vue — au tout premier
   * contact, notamment, où le déplacement est nul par définition.
   */
  angleDeg(fallbackDeg = 0) {
    if (this.c2 === null) return fallbackDeg;
    // `atan2` rend 2θ : on revient à θ en divisant par deux, d'où 90 au lieu
    // de 180 dans la conversion en degrés.
    const deg = (Math.atan2(this.s2, this.c2) * 90) / Math.PI;
    return ((deg % 180) + 180) % 180;
  }
}
