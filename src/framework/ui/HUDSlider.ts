// src/framework/ui/HUDSlider.ts
export interface HUDSliderOptions {
  label:  string;
  min:    number;
  max:    number;
  step:   number;
  value:  number;
  onInput: (v: number) => void;
}

export class HUDSlider {
  readonly el: HTMLElement;
  private _slider:  HTMLInputElement;
  private _valueEl: HTMLElement;
  private _decimals: number;

  constructor(opts: HUDSliderOptions) {
    this._decimals = opts.step < 0.1 ? 2 : 1;

    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      display: 'grid', gridTemplateColumns: '60px 1fr 36px',
      alignItems: 'center', gap: '6px', marginBottom: '2px',
    });

    const labelEl = document.createElement('span');
    labelEl.textContent = opts.label;
    Object.assign(labelEl.style, {
      fontSize: '10px', color: '#9399b2', overflow: 'hidden', whiteSpace: 'nowrap',
    });

    this._slider = document.createElement('input');
    this._slider.type  = 'range';
    this._slider.min   = String(opts.min);
    this._slider.max   = String(opts.max);
    this._slider.step  = String(opts.step);
    this._slider.value = String(opts.value);
    Object.assign(this._slider.style, {
      width: '100%', accentColor: '#89b4fa', cursor: 'pointer',
    });

    this._valueEl = document.createElement('span');
    this._valueEl.textContent = opts.value.toFixed(this._decimals);
    Object.assign(this._valueEl.style, {
      fontSize: '10px', color: '#cdd6f4', textAlign: 'right',
    });

    this._slider.addEventListener('input', () => {
      const v = parseFloat(this._slider.value);
      this._valueEl.textContent = v.toFixed(this._decimals);
      opts.onInput(v);
    });

    this.el.appendChild(labelEl);
    this.el.appendChild(this._slider);
    this.el.appendChild(this._valueEl);
  }

  setValue(v: number): void {
    this._slider.value = String(v);
    this._valueEl.textContent = v.toFixed(this._decimals);
  }
}
