// src/framework/ui/HUDSection.ts
export class HUDSection {
  readonly el:     HTMLElement;
  private _body:   HTMLElement;
  private _arrow:  HTMLElement;
  private _open:   boolean;

  constructor(title: string, expanded = true) {
    this._open = expanded;
    this.el = document.createElement('div');
    Object.assign(this.el.style, { marginTop: '8px' });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
      color: '#6c7086', cursor: 'pointer', paddingBottom: '4px',
      borderBottom: '1px solid #313244', marginBottom: '6px',
    });
    const label = document.createElement('span');
    label.textContent = title;
    this._arrow = document.createElement('span');
    this._arrow.textContent = expanded ? '▼' : '▶';
    header.appendChild(label); header.appendChild(this._arrow);

    this._body = document.createElement('div');
    this._body.style.display = expanded ? 'block' : 'none';

    header.addEventListener('click', () => this._toggle());
    this.el.appendChild(header);
    this.el.appendChild(this._body);
  }

  append(child: HTMLElement): void { this._body.appendChild(child); }

  private _toggle(): void {
    this._open = !this._open;
    this._arrow.textContent = this._open ? '▼' : '▶';
    this._body.style.display = this._open ? 'block' : 'none';
  }
}
