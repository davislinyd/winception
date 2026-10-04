// Shared by the browser and HTTP server; keep this module free of DOM dependencies.
export const uiRoutes = [
  { path: '/', view: 'dashboard' },
  { path: '/fleet', view: 'fleet' },
  { path: '/setup', panel: 'initializationDialog' },
  { path: '/profiles', panel: 'deploymentProfilesDialog' },
  { path: '/profiles/software', panel: 'deploymentProfilesDialog', target: 'software-catalog-section' },
  { path: '/profiles/scripts', panel: 'deploymentProfilesDialog', target: 'script-catalog-section' },
  { path: '/os-images', panel: 'osImagesDialog' },
  { path: '/endpoint', panel: 'endpointSettingsDialog' },
  { path: '/software-test', panel: 'deploymentProfilesDialog', target: 'software-test-section' },
  { path: '/services', console: true, target: 'console-services' },
  { path: '/content', console: true, target: 'console-content' },
  { path: '/network', console: true, target: 'console-network' },
  { path: '/checks', console: true, target: 'console-checks' },
  { path: '/tools', console: true, target: 'console-tools' },
  { path: '/diagnostics', console: true, target: 'diagnostics-status-badge' },
  { path: '/offline-iso', console: true, target: 'offline-iso-status-badge' },
  { path: '/logs', console: true, target: 'logs' },
];

export function findUiRoute(pathname) {
  return uiRoutes.find((route) => route.path === (pathname.replace(/\/+$/u, '') || '/')) ?? null;
}

export function resolveUiRoute(url) {
  const route = findUiRoute(url.pathname);
  if (!route) return null;
  const requestedMode = url.searchParams.get('mode');
  const mode = route.console || requestedMode === 'console' ? 'console' : 'guided';
  return { ...route, mode, href: `${route.path}?mode=${mode}` };
}

export function actionRoute(action, source) {
  const paths = {
    initialization: '/setup', profiles: '/profiles', 'os-images': '/os-images',
    interfaces: '/endpoint', logs: '/logs', activity: '/fleet', fleet: '/fleet',
    management: '/',
  };
  if (action === 'console-jump') {
    return `/${source?.dataset?.consoleJump?.replace(/^console-/u, '') ?? ''}`;
  }
  if (action === 'management-target') return paths[source?.dataset?.managementTarget] ?? null;
  return paths[action] ?? null;
}
