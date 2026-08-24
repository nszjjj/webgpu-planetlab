// src/framework/ui/HUDPanel.ts
export interface HUDPanelOptions {
  title:     string;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

const POSITION_STYLE: Record<NonNullable<HUDPanelOptions['position']>, Partial<CSSStyleDeclaration>> = {
  'top-right':    { top: '12px', right: '12px' },
  'top-left':     { top: '12px', left:  '12px' },
  'bottom-right': { bottom: '12px', right: '12px' },
  'bottom-left':  { bottom: '12px', left:  '12px' },
};

export class HUDPanel {
  readonly el: HTMLElement;

  constructor(opts: HUDPanelOptions) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position:     'fixed',
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
    }, POSITION_STYLE[opts.position ?? 'top-right']);

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
    title.textContent = opts.title;
    this.el.appendChild(title);

    document.body.appendChild(this.el);
  }

  append(child: HTMLElement): void { this.el.appendChild(child); }
  dispose(): void { this.el.remove(); }
}
