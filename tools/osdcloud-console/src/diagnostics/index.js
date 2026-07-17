import { collectDiagnosticsContext } from './collectors.js';
import { writeDiagnosticsBundle } from './bundle.js';
import { buildDiagnosticsChecks, summarizeDiagnostics } from './rules.js';
import { diagnosticsLatestPathForConfig, diagnosticsRootForConfig, ensureInside, readJsonIfExists } from './shared.js';
import fs from 'node:fs';
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
  const latest = readJsonIfExists(diagnosticsLatestPathForConfig(config), null);
  if (!latest) {
    return null;
  }
  return {
    ...latest,
    bundleAvailable: Boolean(resolveDiagnosticsBundlePath(config, latest.bundleName)),
  };
}

export function resolveDiagnosticsBundlePath(config = {}, bundleName) {
  if (!bundleName || path.extname(bundleName).toLowerCase() !== '.zip') {
    return null;
  }
  try {
    const candidate = ensureInside(diagnosticsRootForConfig(config), path.join(diagnosticsRootForConfig(config), bundleName));
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}
