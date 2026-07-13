import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProductStateSnapshot } from '../../../packages/infrastructure/src/productState.js';

interface LegacyStartResult {
  promise?: Promise<unknown>;
  [key: string]: unknown;
}

export interface LegacyController {
  runExternallyCoordinated<T>(action: () => T): T;
  exportProductState(): ProductStateSnapshot;
  reloadProductState(configPath: string): void;
  getState(options?: Record<string, unknown>): Record<string, unknown>;
  listInterfaces(): Promise<unknown>;
  inspectNetworkGateway(): Promise<unknown>;
  getProfiles(): unknown;
  getOsImages(): unknown;
  getOsDownloadCatalog(filters?: Record<string, unknown>): Promise<unknown>;
  diagnosticsSummary(): unknown;
  diagnosticsDownloadPath(bundleName: string): string;
  readSoftwareInstallScript(softwareId: string): unknown;
  readCustomScriptContent(scriptId: string): unknown;
  getSoftwareTestStatus(): unknown;
  shutdown(): Promise<void>;
  startService(name: string): Promise<unknown>;
  stopService(name: string): Promise<unknown>;
  startAll(): Promise<unknown>;
  stopAll(): Promise<unknown>;
  runPreflight(): Promise<unknown>;
  runDiagnostics(input: Record<string, unknown>): Promise<unknown>;
  saveDeploymentSecrets(input: Record<string, unknown>): Promise<unknown>;
  prepareRuntime(): Promise<unknown>;
  updateProjectRoot(input: Record<string, unknown>): Promise<unknown>;
  changeEndpoint(input: Record<string, unknown>): Promise<unknown>;
  prepareNetworkGateway(input: Record<string, unknown>): Promise<unknown>;
  removeNetworkGateway(): Promise<unknown>;
  changeBootMode(mode: string): Promise<unknown>;
  changeDhcpMode(mode: string): Promise<unknown>;
  changeDeploymentProfile(profileId: string): Promise<unknown>;
  addDeploymentProfile(input: Record<string, unknown>): Promise<unknown>;
  updateActiveDeploymentProfile(input: Record<string, unknown>): Promise<unknown>;
  removeDeploymentProfile(profileId: string): Promise<unknown>;
  configureSoftwareTest(input: Record<string, unknown>): Promise<unknown>;
  startSoftwareTest(profileId: string): Promise<Record<string, unknown>>;
  abortSoftwareTest(runId: string): Promise<Record<string, unknown>>;
  deleteOsImage(imageId: string): Promise<unknown>;
  updateTorrentSettings(seedMinutes: number): unknown;
  releaseTorrentClients(payload: Record<string, unknown>): unknown;
  extendTorrentClient(payload: Record<string, unknown>): unknown;
  startOsDownload(imageId: string): LegacyStartResult;
  startReexportOsImage(imageId: string): LegacyStartResult;
  startOfflineIsoExport(): LegacyStartResult;
  uploadOsImage(input: { fileName: string; size: number; stream: NodeJS.ReadableStream }): Promise<unknown>;
  uploadSoftwareInstaller(input: { fileName: string; size: number; stream: NodeJS.ReadableStream }): Promise<unknown>;
  addSoftwarePackage(input: Record<string, unknown>): Promise<unknown>;
  removeSoftwarePackage(softwareId: string): Promise<unknown>;
  openSoftwareInstallScript(softwareId: string): Promise<unknown>;
  uploadCustomScript(input: { fileName: string; size: number; stream: NodeJS.ReadableStream }): Promise<unknown>;
  addCustomScript(input: Record<string, unknown>): Promise<unknown>;
  removeCustomScript(scriptId: string): Promise<unknown>;
  clearStatusFiles(): Promise<unknown>;
  deleteStatusRun(runId: string): Promise<unknown>;
  deleteStatusRuns(runIds: string[]): Promise<unknown>;
  archiveStatusRuns(runIds: string[]): Promise<unknown>;
  restoreStatusRuns(runIds: string[]): Promise<unknown>;
  deleteArchivedRuns(runIds: string[]): Promise<unknown>;
  readonly softwareTestPromise?: Promise<unknown> | null;
}

interface LegacyControllerConstructor {
  new(options?: { configPath?: string; dependencies?: Record<string, unknown> }): LegacyController;
}

export async function loadLegacyController(options: { appRoot: string; configPath?: string; dependencies?: Record<string, unknown> }): Promise<LegacyController> {
  const appRoot = resolve(options.appRoot);
  const modulePath = join(appRoot, 'tools', 'osdcloud-console', 'src', 'controller', 'index.js');
  const module = await import(pathToFileURL(modulePath).href) as { ServiceController?: LegacyControllerConstructor };
  if (!module.ServiceController) throw new Error('The legacy ServiceController adapter could not be loaded.');
  return new module.ServiceController({
    ...(options.configPath ? { configPath: resolve(options.configPath) } : {}),
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
  });
}
