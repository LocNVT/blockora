import type { FatalView } from '../errors/ErrorCoordinator';

/**
 * Fatal error screen and non-fatal banner. Deliberately self-contained: plain
 * DOM with inline styles only (no renderer, settings or injected stylesheet),
 * so it can still appear when everything else is broken.
 */

const ERROR_STYLE = {
  overlayZ: '2147483000',
  bannerZ: '2147482000',
  background: '#101820',
  panel: '#1b2733',
  text: '#f2f4f6',
  muted: '#b8c2cc',
  accent: '#9be29b',
  bannerBackground: 'rgba(40, 32, 12, 0.94)',
  bannerBorder: '#e2c46b',
  bannerMs: 6000,
  font: 'system-ui, -apple-system, "Segoe UI", sans-serif',
} as const;

const FATAL_ID = 'blockora-fatal-error';
const BANNER_ID = 'blockora-banner';

function styled<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  css: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.style.cssText = css;
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

async function copyText(text: string, fallbackArea: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      fallbackArea.focus();
      fallbackArea.select();
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/** Shows the full-page fatal error screen (replaces any previous one). Never throws for DOM reasons it can avoid. */
export function showFatalError(view: FatalView): void {
  const s = ERROR_STYLE;
  try {
    document.exitPointerLock();
  } catch {
    // Not locked, or unsupported.
  }
  document.getElementById(FATAL_ID)?.remove();

  const overlay = styled(
    'div',
    `position:fixed;inset:0;z-index:${s.overlayZ};display:flex;align-items:center;justify-content:center;` +
      `background:${s.background};color:${s.text};font-family:${s.font};overflow:auto;padding:16px;box-sizing:border-box;`,
  );
  overlay.id = FATAL_ID;
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-labelledby', `${FATAL_ID}-title`);

  const panel = styled(
    'div',
    `max-width:640px;width:100%;background:${s.panel};border-radius:10px;padding:24px;box-sizing:border-box;` +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);',
  );
  const title = styled('h1', 'margin:0 0 12px;font-size:24px;line-height:1.25;', view.classified.headline);
  title.id = `${FATAL_ID}-title`;
  const body = styled(
    'p',
    `margin:0 0 20px;font-size:16px;line-height:1.5;color:${s.muted};`,
    view.classified.explanation,
  );

  const reload = styled(
    'button',
    `font:inherit;font-size:16px;padding:10px 24px;border:0;border-radius:6px;cursor:pointer;` +
      `background:${s.accent};color:#101820;font-weight:600;`,
    'Reload',
  );
  reload.type = 'button';
  reload.addEventListener('click', () => window.location.reload());

  const details = styled('details', `margin-top:20px;color:${s.muted};font-size:14px;`);
  details.append(styled('summary', 'cursor:pointer;', 'Details'));
  const area = styled(
    'textarea',
    'display:block;width:100%;height:180px;margin-top:10px;box-sizing:border-box;padding:8px;' +
      'background:#0b1117;color:#dfe6ec;border:1px solid #33424f;border-radius:6px;' +
      'font:12px/1.4 ui-monospace,Consolas,monospace;resize:vertical;',
  );
  area.readOnly = true;
  area.value = view.report;
  area.setAttribute('aria-label', 'Error report');
  const copy = styled(
    'button',
    `font:inherit;font-size:14px;margin-top:8px;padding:6px 14px;border:1px solid #33424f;border-radius:6px;` +
      `cursor:pointer;background:transparent;color:${s.text};`,
    'Copy details',
  );
  copy.type = 'button';
  copy.addEventListener('click', () => {
    void copyText(view.report, area).then((ok) => {
      copy.textContent = ok ? 'Copied' : 'Press Ctrl+C to copy';
    });
  });
  details.append(area, copy);

  panel.append(title, body, reload, details);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

/** Shows a non-blocking notice that hides itself; never captures pointer events, so pointer lock is unaffected. */
export function showBanner(message: string): void {
  const s = ERROR_STYLE;
  let stack = document.getElementById(BANNER_ID);
  if (stack === null) {
    stack = styled(
      'div',
      `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:${s.bannerZ};display:flex;` +
        'flex-direction:column;gap:6px;align-items:center;pointer-events:none;user-select:none;' +
        'max-width:min(560px,calc(100vw - 32px));',
    );
    stack.id = BANNER_ID;
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const item = styled(
    'div',
    `padding:10px 16px;border-radius:8px;border:1px solid ${s.bannerBorder};background:${s.bannerBackground};` +
      `color:${s.text};font:14px/1.4 ${s.font};`,
    message,
  );
  stack.appendChild(item);
  window.setTimeout(() => item.remove(), s.bannerMs);
}
