// src/ui/DebugHUD.ts
import type { DebugWireframeNode } from '../graph/nodes/DebugWireframeNode.ts';
import type { CloudParams, MaterialParams } from '../core/types.ts';

const TERRAIN_LABELS = ['Water', 'Sand', 'Grass', 'Rock', 'Snow'];

export class DebugHUD {
  private _wireframeCheckbox!: HTMLInputElement;
  private _cloudExpanded = true;
  private _pbrExpanded   = true;

  constructor(
    private _wireframe:      DebugWireframeNode,
    private _cloudParams:    CloudParams,
    private _materialParams: MaterialParams,
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
      width:        '260px',
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
      maxHeight:    'calc(100vh - 24px)',
      overflowY:    'auto',
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
    panel.appendChild(this._buildPBRSection());

    document.body.appendChild(panel);
  }

  private _buildWireframeRow(): HTMLLabelElement {
    const row = document.createElement('label');
    Object.assign(row.style, {
      display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
    });

    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = this._wireframe.enabled;
    Object.assign(checkbox.style, { margin: '0', cursor: 'pointer', accentColor: '#cdd6f4' });
    checkbox.addEventListener('change', () => { this._wireframe.enabled = checkbox.checked; });
    this._wireframeCheckbox = checkbox;

    const label = document.createElement('span');
    label.textContent = 'Wireframe';
    Object.assign(label.style, { flex: '1' });

    const hint = document.createElement('span');
    hint.textContent = '(W)';
    Object.assign(hint.style, { color: '#585b70' });

    row.appendChild(checkbox); row.appendChild(label); row.appendChild(hint);
    return row;
  }

  // ── Cloud section ────────────────────────────────────────────────────────

  private _buildCloudSection(): HTMLDivElement {
    const section = document.createElement('div');
    Object.assign(section.style, { marginTop: '8px' });

    const [header, body, arrow] = this._buildSectionHeader('Cloud', this._cloudExpanded);
    body.style.display = this._cloudExpanded ? 'block' : 'none';

    const sliders: Array<{ key: keyof CloudParams; label: string; min: number; max: number; step: number }> = [
      { key: 'coverageFreq',      label: 'Coverage Freq', min: 0.1, max: 10.0, step: 0.1  },
      { key: 'coverageThreshold', label: 'Coverage Thr.', min: 0.0, max:  1.0, step: 0.01 },
      { key: 'extinction',        label: 'Extinction',    min: 0.0, max: 20.0, step: 0.1  },
      { key: 'scatterAlbedo',     label: 'Scatter Albedo',min: 0.0, max:  1.0, step: 0.01 },
      { key: 'mieG',              label: 'Mie G',         min:-1.0, max:  1.0, step: 0.01 },
    ];

    for (const def of sliders) {
      body.appendChild(this._buildCloudSliderRow(def));
    }

    header.addEventListener('click', () => {
      this._cloudExpanded = !this._cloudExpanded;
      arrow.textContent   = this._cloudExpanded ? '▼' : '▶';
      body.style.display  = this._cloudExpanded ? 'block' : 'none';
    });

    section.appendChild(header); section.appendChild(body);
    return section;
  }

  private _buildCloudSliderRow(def: {
    key: keyof CloudParams; label: string; min: number; max: number; step: number;
  }): HTMLDivElement {
    return this._buildGenericSlider(
      def.label, def.min, def.max, def.step,
      this._cloudParams[def.key],
      (v) => { (this._cloudParams as unknown as Record<string, number>)[def.key as string] = v; },
    );
  }

  // ── PBR section ──────────────────────────────────────────────────────────

  private _buildPBRSection(): HTMLDivElement {
    const section = document.createElement('div');
    Object.assign(section.style, { marginTop: '8px' });

    const [header, body, arrow] = this._buildSectionHeader('PBR Materials', this._pbrExpanded);
    body.style.display = this._pbrExpanded ? 'block' : 'none';

    for (let i = 0; i < 5; i++) {
      const mat = this._materialParams.materials[i];

      const sub = document.createElement('div');
      Object.assign(sub.style, {
        marginBottom: '8px', paddingLeft: '4px', borderLeft: '2px solid #45475a',
      });

      const subLabel = document.createElement('div');
      subLabel.textContent = TERRAIN_LABELS[i];
      Object.assign(subLabel.style, { fontSize: '11px', color: '#a6adc8', marginBottom: '2px' });
      sub.appendChild(subLabel);

      sub.appendChild(this._buildGenericSlider('Rough', 0.0, 1.0, 0.01,
        mat.roughness, (v) => { mat.roughness = v; }));
      sub.appendChild(this._buildGenericSlider('Metal', 0.0, 1.0, 0.01,
        mat.metallic,  (v) => { mat.metallic = v; }));

      body.appendChild(sub);
    }

    // Light intensity
    const lightSub = document.createElement('div');
    Object.assign(lightSub.style, {
      marginBottom: '8px', paddingLeft: '4px', borderLeft: '2px solid #f9e2af',
    });
    const lightLabel = document.createElement('div');
    lightLabel.textContent = 'Light';
    Object.assign(lightLabel.style, { fontSize: '11px', color: '#f9e2af', marginBottom: '2px' });
    lightSub.appendChild(lightLabel);
    lightSub.appendChild(this._buildGenericSlider('Intensity', 0.1, 10.0, 0.1,
      this._materialParams.lightIntensity,
      (v) => { this._materialParams.lightIntensity = v; }));
    body.appendChild(lightSub);

    header.addEventListener('click', () => {
      this._pbrExpanded = !this._pbrExpanded;
      arrow.textContent = this._pbrExpanded ? '▼' : '▶';
      body.style.display = this._pbrExpanded ? 'block' : 'none';
    });

    section.appendChild(header); section.appendChild(body);
    return section;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────

  private _buildSectionHeader(title: string, expanded: boolean): [HTMLDivElement, HTMLDivElement, HTMLSpanElement] {
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#6c7086', cursor: 'pointer', paddingBottom: '4px',
      borderBottom: '1px solid #313244', marginBottom: '6px',
    });
    const hdrLabel = document.createElement('span');
    hdrLabel.textContent = title;
    const arrow = document.createElement('span');
    arrow.textContent = expanded ? '▼' : '▶';
    header.appendChild(hdrLabel); header.appendChild(arrow);
    const body = document.createElement('div');
    return [header, body, arrow];
  }

  private _buildGenericSlider(
    label: string, min: number, max: number, step: number,
    initialVal: number,
    onInput: (v: number) => void,
  ): HTMLDivElement {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'grid', gridTemplateColumns: '60px 1fr 36px',
      alignItems: 'center', gap: '6px', marginBottom: '2px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    Object.assign(labelEl.style, {
      fontSize: '10px', color: '#9399b2', overflow: 'hidden', whiteSpace: 'nowrap',
    });

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(min);
    slider.max   = String(max);
    slider.step  = String(step);
    slider.value = String(initialVal);
    Object.assign(slider.style, { width: '100%', accentColor: '#89b4fa', cursor: 'pointer' });

    const decimals = step < 0.1 ? 2 : 1;
    const valueEl  = document.createElement('span');
    valueEl.textContent = initialVal.toFixed(decimals);
    Object.assign(valueEl.style, { fontSize: '10px', color: '#cdd6f4', textAlign: 'right' });

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      valueEl.textContent = v.toFixed(decimals);
      onInput(v);
    });

    row.appendChild(labelEl); row.appendChild(slider); row.appendChild(valueEl);
    return row;
  }

  private _bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W') {
        this._wireframe.enabled         = !this._wireframe.enabled;
        this._wireframeCheckbox.checked = this._wireframe.enabled;
      }
    });
  }
}
