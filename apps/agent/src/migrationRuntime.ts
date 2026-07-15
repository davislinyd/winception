import type { ProductStateSnapshot } from '../../../packages/infrastructure/src/productState.js';
import type { LegacyController } from './legacyController.js';

interface MigrationDatabase {
  getSetting<T>(key: string): T | undefined;
  setSetting(key: string, value: unknown): void;
}

interface MigrationProductState {
  capture(snapshot: ProductStateSnapshot): void;
}

interface MigrationSecretStore {
  withMaterialized<T>(action: () => T | Promise<T>): Promise<T>;
}

export async function rebuildImportedRuntime(options: {
  database: MigrationDatabase;
  controller: LegacyController;
  productState: MigrationProductState;
  deploymentSecrets: MigrationSecretStore;
}): Promise<boolean> {
  if (options.database.getSetting<boolean>('runtime.rebuildRequired') !== true) return false;
  await options.deploymentSecrets.withMaterialized(() => options.controller.prepareRuntime());
  options.productState.capture(options.controller.exportProductState());
  options.database.setSetting('runtime.rebuildRequired', false);
  return true;
}
