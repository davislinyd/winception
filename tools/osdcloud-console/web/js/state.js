export const RESERVED_WINDOWS_USERNAMES = new Set([
  'administrator', 'guest', 'defaultaccount', 'wdagutilityaccount', 'system',
]);
export const DEFAULT_WINDOWS_USERNAME = 'LabAdmin';

export const state = {
  current: null,
  selectedRunId: null,
  pendingInterface: null,
  interfaces: [],
  interfacesLoading: false,
  interfacesError: null,
  osDownloadCatalog: [],
  osDownloadCatalogLoaded: false,
  osDownloadCatalogLoading: false,
  osDownloadCatalogError: null,
  osDownloadCatalogFilters: null,
  osDownloadStarting: false,
  refreshError: null,
  osImportInspection: null,
  auth: {
    checked: false,
    required: false,
    hostMode: 'loopback',
    error: '',
  },
  busy: false,
  clientFleetSignature: '',
  logsText: null,
  fleetExpanded: false,
  initializationAutoOpened: false,
  initializationPendingAction: null,
  initializationOperationAction: null,
  consoleDockCollapsed: true,
  consoleDockOperationKey: '',
  guidedConsoleAttentionAction: null,
  guidedConsoleAttentionShown: false,
  setupRailCollapsed: false,
  initializationDetailScrollPositions: {},
  endpointSyncReturnToInitialization: false,
  initializationRootDraft: '',
  initializationSecretsEditing: false,
  initializationSecretsDraft: {
    windowsUsername: DEFAULT_WINDOWS_USERNAME,
    windowsPassword: '',
  },
  currentView: null,
  selectedGuidedStepId: null,
  guidedStepCollapsed: false,
  fleetFilter: 'all',
  fleetSearch: '',
  // Multi-select for bulk delete/archive in the Activity view.
  selectedRunIds: [],
  selectAnchorRunId: null,
  // Detail focus while browsing archived runs (kept client-side so periodic
  // refreshes, which only resolve active runs, don't clobber it).
  selectedArchivedRunId: null,
};
