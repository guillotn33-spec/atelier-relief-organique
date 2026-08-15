// Écran de création d'un projet (§2).
//
// Saisie en centimètres au clavier, clavier numérique sur iPad
// (`inputmode="decimal"` sur un champ texte : la validation reste entièrement
// la nôtre, `type="number"` de Safari acceptant des saisies que nous refusons).

import { BOUNDS, DEFAULT_DIMENSIONS, SHAPES, createProject, validateDimension, validateDimensions } from '../core/project.js';

const FIELDS = {
  rectangle: ['widthCm', 'heightCm', 'depthCm'],
  square: ['widthCm', 'depthCm'],
  circle: ['widthCm', 'depthCm'],
};

export class CreationScreen {
  constructor(root, { onCreate, onOpen }) {
    this.root = root;
    this.onCreate = onCreate;
    this.onOpen = onOpen;
    this.shape = 'rectangle';
    this.values = { ...DEFAULT_DIMENSIONS.rectangle };

    this.dimGrid = root.querySelector('#dimGrid');
    this.projectsBlock = root.querySelector('#creationProjects');
    this.projectList = root.querySelector('#projectList');

    root.querySelectorAll('.shape-option').forEach((button) => {
      button.addEventListener('click', () => this.setShape(button.dataset.shape));
    });

    root.querySelector('#createProject').addEventListener('click', () => this.submit());
    this.renderFields();
  }

  setShape(shape) {
    if (!SHAPES.includes(shape) || shape === this.shape) return;
    this.shape = shape;
    const defaults = DEFAULT_DIMENSIONS[shape];
    this.values = { ...defaults };
    this.root.querySelectorAll('.shape-option').forEach((button) => {
      const active = button.dataset.shape === shape;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    });
    this.renderFields();
  }

  renderFields() {
    this.dimGrid.textContent = '';
    for (const field of FIELDS[this.shape]) {
      const bound = BOUNDS[this.shape][field];
      const wrap = document.createElement('div');
      wrap.className = 'dim-field';
      wrap.dataset.field = field;

      const head = document.createElement('div');
      head.className = 'dim-head';
      const label = document.createElement('span');
      label.textContent = bound.label;
      const range = document.createElement('span');
      range.className = 'dim-range';
      range.textContent = `${bound.min} à ${bound.max} cm`;
      head.append(label, range);

      const row = document.createElement('div');
      row.className = 'dim-input-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.value = String(this.values[field] ?? bound.min);
      input.setAttribute('aria-label', `${bound.label} en centimètres`);
      const unit = document.createElement('span');
      unit.className = 'dim-unit';
      unit.textContent = 'cm';
      row.append(input, unit);

      const error = document.createElement('div');
      error.className = 'dim-error';

      input.addEventListener('input', () => {
        this.values[field] = input.value;
        const result = validateDimension(this.shape, field, input.value);
        wrap.classList.toggle('invalid', !result.ok);
        error.textContent = result.ok ? '' : result.error;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') this.submit();
      });

      wrap.append(head, row, error);
      this.dimGrid.append(wrap);
    }
  }

  submit() {
    const { ok, dimensions, errors } = validateDimensions(this.shape, this.values);
    this.dimGrid.querySelectorAll('.dim-field').forEach((wrap) => {
      const message = errors[wrap.dataset.field];
      wrap.classList.toggle('invalid', !!message);
      wrap.querySelector('.dim-error').textContent = message || '';
    });
    if (!ok) {
      const firstInvalid = this.dimGrid.querySelector('.dim-field.invalid input');
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const project = createProject({
      canvasShape: this.shape,
      widthCm: dimensions.widthCm,
      heightCm: dimensions.heightCm,
      depthCm: dimensions.depthCm,
      name: `${labelOf(this.shape)} ${dimensions.widthCm} × ${dimensions.heightCm} cm`,
    });
    this.onCreate(project);
  }

  showProjects(projects) {
    this.projectList.textContent = '';
    if (!projects.length) {
      this.projectsBlock.hidden = true;
      return;
    }
    this.projectsBlock.hidden = false;
    for (const project of projects) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'project-row';
      const name = document.createElement('strong');
      name.textContent = project.name || 'Sans titre';
      const size = document.createElement('span');
      size.textContent = `${round(project.widthCm)} × ${round(project.heightCm)} × ${round(project.depthCm)} cm`;
      row.append(name, size);
      row.addEventListener('click', () => this.onOpen(project.id));
      this.projectList.append(row);
    }
  }

  show() {
    this.root.hidden = false;
  }

  hide() {
    this.root.hidden = true;
  }
}

function labelOf(shape) {
  return shape === 'rectangle' ? 'Rectangle' : shape === 'square' ? 'Carré' : 'Rond';
}

function round(value) {
  return Math.round(value * 10) / 10;
}
