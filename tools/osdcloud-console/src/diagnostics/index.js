import { collectDiagnosticsContext } from './collectors.js';
import { writeDiagnosticsBundle } from './bundle.js';
import { buildDiagnosticsChecks, summarizeDiagnostics } from './rules.js';
import { diagnosticsLatestPathForConfig, diagnosticsRootForConfig, ensureInside, readJsonIfExists } from './shared.js';
import path from 'node:path';

export async function runDiagnostics(config = {}, options = {}) {
  const context = await collectDiagnosticsContext(config, options);
  const checks = buildDiagnosticsChecks(context);
  const summary = summarizeDiagnostics(context, checks);
  return writeDiagnosticsBundle(config, {
    generatedAt: context.generatedAt,
    trigger: context.trigger,
    scope: context.scope,
    summary,
    checks,
    artifacts: context.artifacts,
  }, options);
}

export function readLatestDiagnostics(config = {}) {
  return readJsonIfExists(diagnosticsLatestPathForConfig(config), null);
}

export function resolveDiagnosticsBundlePath(config = {}, bundleName) {
  if (!bundleName) {
    return null;
  }
  return ensureInside(diagnosticsRootForConfig(config), path.join(diagnosticsRootForConfig(config), bundleName));
}
