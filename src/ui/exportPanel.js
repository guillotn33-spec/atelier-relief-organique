// Panneau d'export (§17, §18).
//
// Sorti d'`atelier.js` au lot 8 (§20), sans changer une ligne de comportement.
//
// L’application finale ne livre qu’une image PNG 2D. Elle part de la MÊME
// heightmap que l’écran : l’aperçu et le fichier exporté restent identiques.

import { encode, fileNameFor, outputSizeFor, renderForExport } from '../export/image.js';

export class ExportPanel {
  /**
   * @param {HTMLElement} root  racine de l'atelier
   * @param {object} options
   *   lire()      — rend `{ project, hm }` au moment de l'export
   *   rendering   — pastille « Calcul… »
   *   signal      — signal d'abandon de l'atelier : ses écouteurs meurent avec lui
   *
   * SANS `signal`, ces écouteurs SURVIVENT au changement de projet : les
   * éléments d'export appartiennent au document, pas à l'atelier. Mesuré — deux
   * panneaux vivants produisaient deux fichiers pour un seul clic, dont un aux
   * dimensions du projet précédent.
   */
  constructor(root, { lire, rendering, signal }) {
    this.root = root;
    this.lire = lire;
    this.rendering = rendering;
    const opts = signal ? { signal } : {};

    this.longSide = root.querySelector('#exportLongSide');
    this.custom = root.querySelector('#exportCustom');
    this.note = root.querySelector('#exportNote');
    this.transparent = root.querySelector('#exportTransparent');

    const refresh = () => this.refresh();
    this.longSide.addEventListener('change', refresh, opts);
    this.custom.addEventListener('input', refresh, opts);
    root.querySelector('#exportRun').addEventListener('click', (event) => this.run(event.currentTarget), opts);

    // Les deux boutons hérités de la version 1 lancent l'export courant.
    root.querySelector('#exportTop').addEventListener('click', () => root.querySelector('#exportRun').click(), opts);
    root.querySelector('#exportMobile').addEventListener('click', () => root.querySelector('#exportRun').click(), opts);
    refresh();
  }

  chosenLongSide() {
    return this.longSide.value === 'custom' ? Number(this.custom.value) : Number(this.longSide.value);
  }

  refresh() {
    const { project } = this.lire();
    this.root.querySelector('#exportSizeControl').hidden = false;
    this.root.querySelector('#exportCustomControl').hidden = this.longSide.value !== 'custom';
    // La transparence n'a de sens qu'en PNG, et seulement autour d'un disque.
    this.root.querySelector('#exportTransparentControl').hidden = project.canvasShape !== 'circle';
    this.root.querySelector('#exportCustomValue').value = `${this.custom.value} px`;
    const out = outputSizeFor(project, this.chosenLongSide());
    const megapixels = (out.width * out.height) / 1e6;
    this.note.textContent = out.clamped
      ? `${out.width} × ${out.height} px — définition ramenée sous le plafond mémoire (${megapixels.toFixed(1)} Mpx).`
      : `${out.width} × ${out.height} px (${megapixels.toFixed(1)} Mpx), au rapport du panneau.`;
    this.note.classList.toggle('warn', out.clamped);
  }

  /** Déclenche le téléchargement d'un blob. */
  download(blob, name) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1500);
  }

  async run(button) {
    const { project, hm } = this.lire();
    if (!hm) return;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Calcul…';
    this.rendering.classList.add('show');
    await new Promise((resolve) => setTimeout(resolve, 40));

    try {
      const { canvas, width, height } = renderForExport(project, hm, {
        longSide: this.chosenLongSide(),
        format: 'png',
        transparent: this.transparent.checked,
      });
      const blob = await encode(canvas, 'png');
      if (blob) this.download(blob, fileNameFor(project, 'png', width, height));
    } catch (error) {
      this.note.textContent = `Export impossible : ${error.message}`;
      this.note.classList.add('warn');
    } finally {
      button.disabled = false;
      button.textContent = original;
      this.rendering.classList.remove('show');
    }
  }
}
