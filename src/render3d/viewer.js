// Vue 3D et navigation autour de l'œuvre (§9, §10).
//
// Three.js est importé depuis `node_modules` et part dans le bundle : aucune
// dépendance à un CDN, conformément à §19 et à l'amendement B.
//
// La caméra vise TOUJOURS le centre géométrique de la toile, qui est l'origine
// du mesh. Elle ne touche jamais à la géométrie : orbite, distance et cadrage
// vivent dans cette classe, le relief vit dans la heightmap.
//
// Le rendu est À LA DEMANDE. Une boucle permanente viderait la batterie de
// l'iPad pour afficher une image fixe ; on ne redessine qu'après un changement.

import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { FINISHES } from '../render2d/shade.js';
import { buildReliefMesh } from './mesh.js';

const MIN_ELEVATION = -Math.PI / 2.4; // ±75° : au-delà on ne comprend plus ce qu'on regarde
const MAX_ELEVATION = Math.PI / 2.4;
// Intensité de base de la lumière principale. Nommée parce que sa valeur
// littérale — 1,6 — est celle du rapport d'image de la version 1 : la laisser
// nue la ferait passer pour un rapport lors d'une relecture ou d'un audit.
const KEY_LIGHT_BASE = 1.6;

const MIN_DISTANCE_FACTOR = 0.55;
const MAX_DISTANCE_FACTOR = 4.0;

export class Viewer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(new Color('#d8d3c9'), 1);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(38, 1, 1, 20000);

    this.ambient = new AmbientLight(0xffffff, 0.55);
    this.hemi = new HemisphereLight(0xffffff, 0x6b6357, 0.6);
    this.key = new DirectionalLight(0xffffff, 2.1);
    this.scene.add(this.ambient, this.hemi, this.key);

    this.geometry = new BufferGeometry();
    this.material = new MeshStandardMaterial({ color: 0xe8e4dc, roughness: 1, metalness: 0 });
    this.mesh = new Mesh(this.geometry, this.material);
    this.scene.add(this.mesh);

    // État de caméra, en coordonnées sphériques autour du centre de l'œuvre.
    this.azimuth = 0;
    this.elevation = 0;
    this.distance = 100;
    this.baseDistance = 100;
    this.needsRender = true;
    this.meshInfo = null;
  }

  /** Reconstruit le mesh depuis la heightmap. Le relief vient de là, pas d'ailleurs. */
  setRelief(project, hm) {
    const built = buildReliefMesh(project, hm);
    this.meshInfo = built;

    this.geometry.dispose();
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(built.positions, 3));
    this.geometry.setAttribute('normal', new BufferAttribute(built.normals, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(built.uvs, 2));
    this.geometry.setIndex(new BufferAttribute(built.indices, 1));
    this.geometry.computeBoundingSphere();
    this.mesh.geometry = this.geometry;

    const diagonal = Math.hypot(project.widthCm, project.heightCm);
    this.baseDistance = diagonal * 1.35;
    if (!this.userDistance) this.distance = this.baseDistance;
    this.needsRender = true;
    return built;
  }

  /** Matière et lumière — mêmes réglages que la vue 2D, modèle PBR réel. */
  setAppearance(project) {
    const finish = FINISHES[project.material.finish] || FINISHES.mat;
    this.material.color = new Color(project.material.color);
    this.material.roughness = finish.roughness;
    this.material.metalness = finish.metal;
    this.material.needsUpdate = true;

    const { lighting } = project;
    const azimuth = (lighting.angle * Math.PI) / 180;
    const elevation = (lighting.height * Math.PI) / 180;
    const distance = this.baseDistance * 2;
    // Même direction qu'en 2D, avec y inversé : la scène a y vers le haut.
    //
    // Aucun biais vers l'observateur. Un relief de 6 cm sur un panneau de 200 cm
    // est géométriquement ténu : seule une lumière réellement RASANTE le révèle,
    // exactement comme sur les photographies de référence. Un terme +Z ajouté
    // « pour éclairer » rendait la lumière frontale et la vue plate.
    this.key.position.set(
      Math.cos(azimuth) * Math.cos(elevation) * distance,
      -Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance
    );
    this.key.target.position.set(0, 0, 0);
    this.key.target.updateMatrixWorld();

    // L'ambiante suit le contraste, comme en 2D : fort contraste, ambiante basse.
    this.ambient.intensity = 0.25 + (1 - lighting.contrast) * 0.5;
    this.hemi.intensity = 0.35 + (1 - lighting.contrast) * 0.35;
    this.key.intensity = KEY_LIGHT_BASE + lighting.contrast * 1.2;

    this.renderer.setClearColor(new Color(project.presentation.wallColor), 1);
    this.needsRender = true;
  }

  // ---- Navigation (§10) ----

  orbitBy(deltaAzimuth, deltaElevation) {
    this.azimuth += deltaAzimuth;
    // Rotation horizontale complète : l'azimut n'est jamais borné.
    if (this.azimuth > Math.PI) this.azimuth -= Math.PI * 2;
    if (this.azimuth < -Math.PI) this.azimuth += Math.PI * 2;
    // Rotation verticale bornée : sans cela on passe derrière l'œuvre par le
    // dessus et le geste devient incompréhensible.
    this.elevation = Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, this.elevation + deltaElevation));
    this.needsRender = true;
  }

  /** Distance absolue, bornée. Utilisée par le pinch, qui raisonne en rapport. */
  setDistance(distance) {
    this.userDistance = true;
    this.distance = Math.min(
      this.baseDistance * MAX_DISTANCE_FACTOR,
      Math.max(this.baseDistance * MIN_DISTANCE_FACTOR, distance)
    );
    this.needsRender = true;
  }

  dollyBy(factor) {
    this.userDistance = true;
    this.distance = Math.min(
      this.baseDistance * MAX_DISTANCE_FACTOR,
      Math.max(this.baseDistance * MIN_DISTANCE_FACTOR, this.distance / factor)
    );
    this.needsRender = true;
  }

  /** Retour à la vue de face — bouton discret de §10, et double tape extérieure. */
  resetToFront() {
    this.azimuth = 0;
    this.elevation = 0;
    this.userDistance = false;
    this.distance = this.baseDistance;
    this.needsRender = true;
  }

  serialize() {
    return { azimuth: this.azimuth, elevation: this.elevation, distance: this.distance, userDistance: !!this.userDistance };
  }

  restore(state) {
    if (!state) return;
    this.azimuth = state.azimuth ?? 0;
    this.elevation = state.elevation ?? 0;
    if (state.userDistance && state.distance) {
      this.userDistance = true;
      this.distance = state.distance;
    }
    this.needsRender = true;
  }

  resize(width, height) {
    if (width <= 0 || height <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  render() {
    if (!this.needsRender) return false;
    this.needsRender = false;
    const cosE = Math.cos(this.elevation);
    this.camera.position.set(
      Math.sin(this.azimuth) * cosE * this.distance,
      Math.sin(this.elevation) * this.distance,
      Math.cos(this.azimuth) * cosE * this.distance
    );
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    return true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
