// src/ui/DebugHUD.ts
import type { DebugWireframeNode } from '../graph/nodes/DebugWireframeNode.ts';

export class DebugHUD {
  private _wireframeCheckbox!: HTMLInputElement;

  constructor(private _wireframe: DebugWireframeNode) {
    this._buildPanel();
    this._bindKeys();
  }

  private _buildPanel(): void {
    // Root panel
    const panel = document.createElement('div');
    Object.assign(panel.style, {
      position:        'fixed',
      top:             '12px',
      right:           '12px',
      width:           '200px',
      background:      'rgba(10,10,15,0.82)',
      borderRadius:    '8px',
      padding:         '12px 16px',
      fontFamily:      'monospace',
      fontSize:        '13px',
      lineHeight:      '1.5',
      color:           '#cdd6f4',
      boxSizing:       'border-box',
      zIndex:          '9999',
      userSelect:      'none',
    });

    // Title
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

    // Wireframe row
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
      margin:  '0',
      cursor:  'pointer',
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
    panel.appendChild(row);

    document.body.appendChild(panel);
  }

  private _bindKeys(): void {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'w' || e.key === 'W') {
        this._wireframe.enabled       = !this._wireframe.enabled;
        this._wireframeCheckbox.checked = this._wireframe.enabled;
      }
    });
  }
}
