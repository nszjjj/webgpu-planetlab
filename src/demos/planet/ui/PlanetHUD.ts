// src/demos/planet/ui/PlanetHUD.ts
import { HUDPanel, HUDSection, HUDSlider, HUDToggle } from '../../../framework/ui/index.ts';
import type { CloudParams, MaterialParams } from '../params.ts';

const TERRAIN_LABELS = ['Water', 'Sand', 'Grass', 'Rock', 'Snow'] as const;

const CLOUD_SLIDER_DEFS: readonly { key: keyof CloudParams; label: string; min: number; max: number; step: number }[] = [
  { key: 'coverageFreq',      label: 'Coverage Freq', min: 0.1, max: 10.0, step: 0.1  },
  { key: 'coverageThreshold', label: 'Coverage Thr.', min: 0.0, max:  1.0, step: 0.01 },
  { key: 'extinction',        label: 'Extinction',    min: 0.0, max: 20.0, step: 0.1  },
  { key: 'scatterAlbedo',     label: 'Scatter Albedo',min: 0.0, max:  1.0, step: 0.01 },
  { key: 'mieG',              label: 'Mie G',         min:-1.0, max:  1.0, step: 0.01 },
];

export class PlanetHUD {
  private _panel: HUDPanel;
  private _toggles: HUDToggle[] = [];

  constructor(
    params: { cloud: CloudParams; material: MaterialParams },
    debug:  { wireframe: { enabled: boolean } },
  ) {
    this._panel = new HUDPanel({ title: 'Debug', position: 'top-right' });

    // Wireframe
    const wireToggle = new HUDToggle({
      label: 'Wireframe', keybindHint: 'W', bindKey: 'w',
      value: debug.wireframe.enabled,
      onChange: (v) => { debug.wireframe.enabled = v; },
    });
    this._toggles.push(wireToggle);
    this._panel.append(wireToggle.el);

    // Cloud section
    const cloudSec = new HUDSection('Cloud', true);
    for (const def of CLOUD_SLIDER_DEFS) {
      cloudSec.append(new HUDSlider({
        label: def.label, min: def.min, max: def.max, step: def.step,
        value: params.cloud[def.key],
        onInput: (v) => { (params.cloud as unknown as Record<string, number>)[def.key as string] = v; },
      }).el);
    }
    this._panel.append(cloudSec.el);

    // PBR section
    const pbrSec = new HUDSection('PBR Materials', true);
    for (let i = 0; i < 5; i++) {
      const mat = params.material.materials[i];
      const sub = document.createElement('div');
      Object.assign(sub.style, {
        marginBottom: '8px', paddingLeft: '4px', borderLeft: '2px solid #45475a',
      });
      const subLabel = document.createElement('div');
      subLabel.textContent = TERRAIN_LABELS[i];
      Object.assign(subLabel.style, { fontSize: '11px', color: '#a6adc8', marginBottom: '2px' });
      sub.appendChild(subLabel);
      sub.appendChild(new HUDSlider({ label: 'Rough', min: 0, max: 1, step: 0.01,
        value: mat.roughness, onInput: (v) => { mat.roughness = v; } }).el);
      sub.appendChild(new HUDSlider({ label: 'Metal', min: 0, max: 1, step: 0.01,
        value: mat.metallic, onInput: (v) => { mat.metallic = v; } }).el);
      pbrSec.append(sub);
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
    lightSub.appendChild(new HUDSlider({ label: 'Intensity', min: 0.1, max: 10, step: 0.1,
      value: params.material.lightIntensity,
      onInput: (v) => { params.material.lightIntensity = v; } }).el);
    pbrSec.append(lightSub);
    this._panel.append(pbrSec.el);
  }

  dispose(): void {
    this._toggles.forEach(t => t.dispose());
    this._panel.dispose();
  }
}
