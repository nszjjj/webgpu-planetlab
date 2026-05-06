// src/ui/DebugHUD.ts
import type { DebugWireframeNode } from '../graph/nodes/DebugWireframeNode.ts';
import type { CloudParams }        from '../core/types.ts';

export class DebugHUD {
  private _wireframeCheckbox!: HTMLInputElement;
  private _cloudExpanded = true;

  constructor(
    private _wireframe:   DebugWireframeNode,
    private _cloudParams: CloudParams,
  ) {
    this._buildPanel();
    this._bindKeys();
  }

  private _buildPanel(): void {
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position:     'fixed',
      top:          '12px',
      right:        '12px',
      width:        '240px',
      background:   'rgba(10,10,15,0.82)',
      borderRadius: '8px',
      padding:      '12px 16px',
      fontFamily:   'monospace',
      fontSize:     '13px',
      lineHeight:   '1.5',
      color:        '#cdd6f4',
      boxSizing:    'border-box',
      zIndex:       '9999',
      userSelect:   'none',
    });

    const title = document.createElement('div');
    Object.assign(title.style, {
      fontSize:      '11px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color:         '#6c7086',
      marginBottom:  '8px',
      paddingBottom: '6px',
      borderBottom:  '1px solid #313244',
    });
    title.textContent = 'Debug';
    panel.appendChild(title);

    panel.appendChild(this._buildWireframeRow());
    panel.appendChild(this._buildCloudSection());

    document.body.appendChild(panel);
  }

  private _buildWireframeRow(): HTMLLabelElement {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display:    'flex',
      alignItems: 'center',
      gap:        '8px',
      cursor:     'pointer',
    });

    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = this._wireframe.enabled;
    Object.assign(checkbox.style, {
      margin:      '0',
      cursor:      'pointer',
      accentColor: '#cdd6f4',
    });
    checkbox.addEventListener('change', () => {
      this._wireframe.enabled = checkbox.checked;
    });
    this._wireframeCheckbox = checkbox;

    const label = document.createElement('span');
    label.textContent = 'Wireframe';
    Object.assign(label.style, { flex: '1' });

    const hint = document.createElement('span');
    hint.textContent = '(W)';
    Object.assign(hint.style, { color: '#585b70' });

    row.appendChild(checkbox);
    row.appendChild(label);
    row.appendChild(hint);
    return row;
  }

  private _buildCloudSection(): HTMLDivElement {
    const section = document.createElement('div');
    Object.assign(section.style, { marginTop: '8px' });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      fontSize:       '11px',
      letterSpacing:  '0.08em',
      textTransform:  'uppercase',
      color:          '#6c7086',
      cursor:         'pointer',
      paddingBottom:  '4px',
      borderBottom:   '1px solid #313244',
      marginBottom:   '6px',
    });

    const headerLabel = document.createElement('span');
    headerLabel.textContent = 'Cloud';

    const arrow = document.createElement('span');
    arrow.textContent = this._cloudExpanded ? '▼' : '▶';

    header.appendChild(headerLabel);
    header.appendChild(arrow);

    const body = document.createElement('div');
    body.style.display = this._cloudExpanded ? 'block' : 'none';

    const sliders: Array<{
      key:   keyof CloudParams;
      label: string;
      min:   number;
      max:   number;
      step:  number;
    }> = [
      { key: 'coverageFreq',      label: 'Coverage Freq',  min:  0.1, max: 10.0, step: 0.1  },
      { key: 'coverageThreshold', label: 'Coverage Thr.',  min:  0.0, max:  1.0, step: 0.01 },
      { key: 'extinction',        label: 'Extinction',     min:  0.0, max: 20.0, step: 0.1  },
      { key: 'scatterAlbedo',     label: 'Scatter Albedo', min:  0.0, max:  1.0, step: 0.01 },
      { key: 'mieG',              label: 'Mie G',          min: -1.0, max:  1.0, step: 0.01 },
    ];

    for (const def of sliders) {
      body.appendChild(this._buildSliderRow(def));
    }

    header.addEventListener('click', () => {
      this._cloudExpanded    = !this._cloudExpanded;
      arrow.textContent      = this._cloudExpanded ? '▼' : '▶';
      body.style.display     = this._cloudExpanded ? 'block' : 'none';
    });

    section.appendChild(header);
    section.appendChild(body);
    return section;
  }

  private _buildSliderRow(def: {
    key:   keyof CloudParams;
    label: string;
    min:   number;
    max:   number;
    step:  number;
  }): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display:             'grid',
      gridTemplateColumns: '90px 1fr 36px',
      alignItems:          'center',
      gap:                 '6px',
      marginBottom:        '4px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = def.label;
    Object.assign(labelEl.style, {
      fontSize:   '11px',
      color:      '#a6adc8',
      overflow:   'hidden',
      whiteSpace: 'nowrap',
    });

    const initialVal = this._cloudParams[def.key] as number;

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(def.min);
    slider.max   = String(def.max);
    slider.step  = String(def.step);
    slider.value = String(initialVal);
    Object.assign(slider.style, {
      width:       '100%',
      accentColor: '#89b4fa',
      cursor:      'pointer',
    });

    const decimals = def.step < 0.1 ? 2 : 1;
    const valueEl  = document.createElement('span');
    valueEl.textContent = initialVal.toFixed(decimals);
    Object.assign(valueEl.style, {
      fontSize:  '11px',
      color:     '#cdd6f4',
      textAlign: 'right',
    });

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      (this._cloudParams as unknown as Record<string, number>)[def.key as string] = v;
      valueEl.textContent = v.toFixed(decimals);
    });

    row.appendChild(labelEl);
    row.appendChild(slider);
    row.appendChild(valueEl);
    return row;
  }

  private _bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W') {
        this._wireframe.enabled        = !this._wireframe.enabled;
        this._wireframeCheckbox.checked = this._wireframe.enabled;
      }
    });
  }
}
