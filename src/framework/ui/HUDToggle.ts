// src/framework/ui/HUDToggle.ts
export interface HUDToggleOptions {
  label:        string;
  value:        boolean;
  onChange:     (v: boolean) => void;
  keybindHint?: string;   // "W" 之类显示提示
  bindKey?:     string;   // "w" 之类实际按键，大小写自动兼容
}

export class HUDToggle {
  readonly el: HTMLElement;
  private _checkbox: HTMLInputElement;
  private _keydownHandler?: (e: KeyboardEvent) => void;

  constructor(opts: HUDToggleOptions) {
    this.el = document.createElement('label');
    Object.assign(this.el.style, {
      display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer',
    });

    this._checkbox = document.createElement('input');
    this._checkbox.type    = 'checkbox';
    this._checkbox.checked = opts.value;
    Object.assign(this._checkbox.style, {
      margin: '0', cursor: 'pointer', accentColor: '#cdd6f4',
    });
    this._checkbox.addEventListener('change', () => opts.onChange(this._checkbox.checked));

    const label = document.createElement('span');
    label.textContent = opts.label;
    Object.assign(label.style, { flex: '1' });

    this.el.appendChild(this._checkbox);
    this.el.appendChild(label);

    if (opts.keybindHint) {
      const hint = document.createElement('span');
      hint.textContent = `(${opts.keybindHint})`;
      Object.assign(hint.style, { color: '#585b70' });
      this.el.appendChild(hint);
    }

    if (opts.bindKey) {
      const target = opts.bindKey.toLowerCase();
      this._keydownHandler = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() === target) {
          const next = !this._checkbox.checked;
          this._checkbox.checked = next;
          opts.onChange(next);
        }
      };
      window.addEventListener('keydown', this._keydownHandler);
    }
  }

  setValue(v: boolean): void { this._checkbox.checked = v; }

  dispose(): void {
    if (this._keydownHandler) {
      window.removeEventListener('keydown', this._keydownHandler);
    }
  }
}
