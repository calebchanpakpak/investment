export function requestSkipWaiting(worker) {
  worker?.postMessage?.({ type: 'SKIP_WAITING' });
}

/**
 * Vault/Calendar update flow: a waiting worker is offered only when this page
 * already has a controller. Activating it reloads. The first install does not reload.
 */
export function attachServiceWorker(reg, sw, { onPrompt, reload, listenVisibility } = {}) {
  if (!reg || !sw) return;
  const hadController = !!sw.controller;
  let reloaded = false;
  sw.addEventListener?.('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    reload?.();
  });
  const prompt = (worker) => {
    if (worker && sw.controller) onPrompt?.(worker);
  };
  if (reg.waiting) prompt(reg.waiting);
  reg.addEventListener?.('updatefound', () => {
    const worker = reg.installing;
    if (!worker || typeof worker.addEventListener !== 'function') return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') prompt(worker);
    });
  });
  const listen = listenVisibility || ((fn) => {
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', fn);
    }
  });
  listen(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    reg.update?.().catch(() => {});
  });
}
