import fs from 'node:fs';
import path from 'node:path';
import { runPowerShell } from '../windows/powershell.js';
import { redactJson, redactText } from './redact.js';
import { diagnosticsLatestPathForConfig, diagnosticsRootForConfig, diagnosticsTimestamp, ensureInside, sanitizeName } from './shared.js';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function compressArchive(sourceDir, zipPath) {
  const escapedSource = sourceDir.replace(/'/gu, "''");
  const escapedZip = zipPath.replace(/'/gu, "''");
  const script = `
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath '${escapedZip}') {
  Remove-Item -LiteralPath '${escapedZip}' -Force
}
Compress-Archive -Path (Join-Path -Path '${escapedSource}' -ChildPath '*') -DestinationPath '${escapedZip}' -CompressionLevel Optimal -Force
`;
  await runPowerShell(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
}

function materializeArtifact(bundleDir, artifact) {
  const targetPath = path.join(bundleDir, artifact.relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (artifact.kind === 'binary') {
    if (!artifact.sourcePath || !fs.existsSync(artifact.sourcePath)) {
      return { ...artifact, included: false, bundlePath: targetPath };
    }
    fs.copyFileSync(artifact.sourcePath, targetPath);
    return { ...artifact, included: true, bundlePath: targetPath };
  }
  if (artifact.kind === 'json') {
    const value = Object.hasOwn(artifact, 'content')
      ? artifact.content
      : artifact.sourcePath && fs.existsSync(artifact.sourcePath)
        ? redactJson(JSON.parse(fs.readFileSync(artifact.sourcePath, 'utf8')))
        : null;
    if (value === null || value === undefined) {
      return { ...artifact, included: false, bundlePath: targetPath };
    }
    writeJson(targetPath, value);
    return { ...artifact, included: true, bundlePath: targetPath };
  }
  const text = Object.hasOwn(artifact, 'content')
    ? String(artifact.content ?? '')
    : artifact.sourcePath && fs.existsSync(artifact.sourcePath)
      ? redactText(fs.readFileSync(artifact.sourcePath, 'utf8'))
      : null;
  if (text === null) {
    return { ...artifact, included: false, bundlePath: targetPath };
  }
  fs.writeFileSync(targetPath, `${text}`.replace(/\r?\n?$/u, '\n'), 'utf8');
  return { ...artifact, included: true, bundlePath: targetPath };
}

export async function writeDiagnosticsBundle(config = {}, result = {}, options = {}) {
  const root = diagnosticsRootForConfig(config);
  const timestamp = diagnosticsTimestamp(new Date(result.summary?.generatedAt ?? result.generatedAt ?? Date.now()));
  const trigger = sanitizeName(result.summary?.trigger ?? result.trigger ?? 'manual', 'manual');
  const overallStatus = sanitizeName(result.summary?.overallStatus ?? 'pass', 'pass');
  const bundleName = `${timestamp}-${trigger}-${overallStatus}.zip`;
  const bundlePath = ensureInside(root, path.join(root, bundleName));
  const workDir = ensureInside(root, path.join(root, `${bundleName}.work`));

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  const materialized = (result.artifacts ?? []).map((artifact) => materializeArtifact(workDir, artifact));
  const summaryDoc = {
    ...result.summary,
    artifacts: materialized.map((artifact) => ({
      label: artifact.label,
      path: artifact.sourcePath ?? artifact.relativePath,
      included: artifact.included === true,
      redacted: artifact.redacted === true,
    })),
  };
  writeJson(path.join(workDir, 'summary.json'), summaryDoc);
  writeJson(path.join(workDir, 'checks.json'), result.checks ?? []);

  if (options.compress !== false) {
    await compressArchive(workDir, bundlePath);
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const latest = {
    ...summaryDoc,
    bundleName,
    bundlePath: options.compress === false ? workDir : bundlePath,
  };
  writeJson(diagnosticsLatestPathForConfig(config), latest);

  return {
    summary: summaryDoc,
    checks: result.checks ?? [],
    artifacts: summaryDoc.artifacts,
    bundleName,
    bundlePath: latest.bundlePath,
  };
}
