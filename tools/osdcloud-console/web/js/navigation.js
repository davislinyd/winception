import { findUiRoute, resolveUiRoute, actionRoute } from './routes.js';

let current;
let apply;
let ready = false;
let applying = false;
let panelEntry = null;

export function isApplyingRoute() { return applying; }
export function currentRoute() { return current; }

function applyCurrent() {
  if (!ready || !apply) return;
  applying = true;
  try { apply(current); } finally { applying = false; }
  updateRouteLinks();
}

export function updateRouteLinks() {
  if (!current) return;
  for (const link of document.querySelectorAll('a[data-route]')) {
    const route = findUiRoute(link.dataset.route);
    if (!route) continue;
    const mode = link.dataset.routeMode ?? (route.console ? 'console' : current.mode);
    link.href = `${route.path}?mode=${mode}`;
    if (route.path === current.path && mode === current.mode) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
}

export function initializeNavigation(callback) {
  apply = callback;
  current = resolveUiRoute(new URL(window.location.href));
  if (!current) return;
  panelEntry = window.history.state?.winceptionPanel ?? null;
  window.history.replaceState(window.history.state, '', current.href);
  window.addEventListener('popstate', () => {
    current = resolveUiRoute(new URL(window.location.href));
    if (!current) return;
    panelEntry = window.history.state?.winceptionPanel ?? null;
    window.history.replaceState(window.history.state, '', current.href);
    applyCurrent();
  });
  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[data-route]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || link.target === '_blank') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(link.dataset.route, { mode: link.dataset.routeMode, toggle: true });
  }, true);
  updateRouteLinks();
}

export function navigationReady() {
  if (ready) return;
  ready = true;
  applyCurrent();
}

export function navigate(path, options = {}) {
  const route = findUiRoute(path);
  if (!route || !current) return;
  const next = resolveUiRoute(new URL(`${route.path}?mode=${options.mode ?? current.mode}`, window.location.origin));
  if (next.href === current.href) {
    if (options.toggle && next.panel) closeRoutePanel(next.panel);
    return;
  }
  const previous = current;
  const entry = next.panel ? { returnHref: panelEntry?.returnHref ?? previous.href, depth: (panelEntry?.depth ?? 0) + 1 } : null;
  current = next;
  panelEntry = entry;
  window.history[options.replace ? 'replaceState' : 'pushState']({ winceptionPanel: entry }, '', next.href);
  applyCurrent();
}

export function closeRoutePanel(panel) {
  if (applying || current?.panel !== panel) return;
  if (panelEntry?.returnHref) {
    window.history.go(-panelEntry.depth);
  } else {
    navigate('/', { mode: current.mode, replace: true });
  }
}

export function navigateAction(action, source) {
  if (applying) return false;
  if (action === 'operator-mode') {
    const mode = source?.dataset?.operatorMode;
    navigate(mode === 'guided' && current?.console ? '/' : current.path, { mode });
    return true;
  }
  const path = actionRoute(action, source);
  if (!path) return false;
  navigate(path, { mode: action === 'management' || action === 'console-jump' ? 'console' : undefined, toggle: true });
  return true;
}
