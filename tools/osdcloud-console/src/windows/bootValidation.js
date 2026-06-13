import fs from 'node:fs';
import path from 'node:path';
import { stateRootForConfig } from '../config.js';
import { resolveTftpPath } from '../tftp.js';
import { buildBootWimSyncInputs, diffBootWimSyncInputs, hashBootWimSyncInputs, readBootWimSyncMarker } from './bootArtifacts.js';
import { runPowerShell } from './powershell.js';
import { fail, getFileSha256, pass, warn } from './shared.js';

export async function evaluateBootWimCustomization(publishedBootWim) {
  if (!fs.existsSync(publishedBootWim)) {
    return fail('WinPE boot.wim customization', `Published boot.wim is missing at ${publishedBootWim}`);
  }

  const marker = readBootWimSyncMarker(publishedBootWim);

  if (!marker || typeof marker.publishedSha256 !== 'string') {
    return fail(
      'WinPE boot.wim customization',
      'The published boot.wim has not been customized. You must run Endpoint Sync to inject WinPE settings before PXE boot.',
    );
  }

  let publishedHash;
  try {
    publishedHash = await getFileSha256(publishedBootWim);
  } catch (error) {
    return fail('WinPE boot.wim customization', `Failed to calculate boot.wim hash: ${error.message}`);
  }

  if (publishedHash !== marker.publishedSha256.toUpperCase()) {
    return fail(
      'WinPE boot.wim customization',
      'The published boot.wim has changed since the last Endpoint Sync. You must run Endpoint Sync to re-customize WinPE before PXE boot.',
    );
  }

  const syncedAt = marker.syncedAtUtc ? ` (last synced ${marker.syncedAtUtc})` : '';
  return pass('WinPE boot.wim customization', `The published boot.wim has been customized${syncedAt}.`);
}

export function checkBootWimSyncStateLegacy(config, publishedBootWim) {
  if (!fs.existsSync(publishedBootWim)) {
    return fail('WinPE boot.wim synchronization', 'Published boot.wim is missing. Cannot check synchronization status.');
  }

  try {
    const stateRoot = stateRootForConfig(config);
    const secretsPath = path.join(stateRoot, 'config', 'osdcloud-secrets.json');
    const configPath = config.__configPath;
    const localConfigPath = config.__localConfigPath;

    const publishedMtime = fs.statSync(publishedBootWim).mtimeMs;
    let outOfSync = false;
    const details = [];

    if (fs.existsSync(secretsPath)) {
      const secretsMtime = fs.statSync(secretsPath).mtimeMs;
      if (secretsMtime > publishedMtime) {
        outOfSync = true;
        details.push('secrets');
      }
    }
    if (configPath && fs.existsSync(configPath)) {
      const configMtime = fs.statSync(configPath).mtimeMs;
      if (configMtime > publishedMtime) {
        outOfSync = true;
        details.push('config');
      }
    }
    if (localConfigPath && fs.existsSync(localConfigPath)) {
      const localConfigMtime = fs.statSync(localConfigPath).mtimeMs;
      if (localConfigMtime > publishedMtime) {
        outOfSync = true;
        details.push('local config');
      }
    }

    if (outOfSync) {
      return fail(
        'WinPE boot.wim synchronization',
        `The published boot.wim is older than the current ${details.join(' and ')}. You must run Endpoint Sync to apply settings/secrets changes to the WinPE boot image.`,
      );
    }

    return pass(
      'WinPE boot.wim synchronization',
      'The published boot.wim is up to date with configuration and secrets.',
    );
  } catch (error) {
    return fail('WinPE boot.wim synchronization', `Failed to check configuration timestamps: ${error.message}`);
  }
}

export function checkBootWimSyncState(config, publishedBootWim) {
  if (!fs.existsSync(publishedBootWim)) {
    return fail('WinPE boot.wim synchronization', 'Published boot.wim is missing. Cannot check synchronization status.');
  }

  const marker = readBootWimSyncMarker(publishedBootWim);
  if (!marker || typeof marker.publishedSha256 !== 'string' || typeof marker.syncInputsSha256 !== 'string') {
    const legacy = checkBootWimSyncStateLegacy(config, publishedBootWim);
    if (!legacy.ok) {
      return legacy;
    }
    return pass(
      'WinPE boot.wim synchronization',
      'The published boot.wim is up to date with configuration and secrets (legacy sync marker; run Endpoint Sync to upgrade to input fingerprint checks).',
    );
  }

  if (!marker.syncInputs || typeof marker.syncInputs !== 'object') {
    return fail(
      'WinPE boot.wim synchronization',
      'The published boot.wim sync marker is invalid. Run Endpoint Sync to regenerate fingerprint metadata.',
    );
  }

  try {
    const currentInputs = buildBootWimSyncInputs(config);
    const currentSha256 = hashBootWimSyncInputs(currentInputs);
    if (currentSha256 === String(marker.syncInputsSha256).toUpperCase()) {
      return pass(
        'WinPE boot.wim synchronization',
        'The published boot.wim is up to date with WinPE sync inputs.',
      );
    }

    const mismatches = diffBootWimSyncInputs(marker.syncInputs, currentInputs);
    const detail = mismatches.length > 0 ? mismatches.join(', ') : 'WinPE sync inputs';
    return fail(
      'WinPE boot.wim synchronization',
      `The published boot.wim is out of date with current ${detail}. You must run Endpoint Sync to apply WinPE input changes before PXE boot.`,
    );
  } catch (error) {
    return fail('WinPE boot.wim synchronization', `Failed to check WinPE sync inputs: ${error.message}`);
  }
}

export function evaluateBootModeConfig(config) {
  const configuredMode = config.dhcp?.bootMode;
  const bootMode = configuredMode ?? 'secureboot';
  if (!['secureboot', 'ipxe'].includes(bootMode)) {
    return fail('Boot mode', `dhcp.bootMode is ${configuredMode}; expected secureboot or ipxe`);
  }
  const bootFile = bootMode === 'secureboot'
    ? (config.dhcp?.secureBootFile ?? 'bootmgfw.efi')
    : config.dhcp?.bootFile;
  if (!bootFile) {
    return fail('Boot mode', `${bootMode}: DHCP boot file is not configured`);
  }
  const filePath = resolveTftpPath(config.tftp.root, bootFile);
  if (!filePath) {
    return fail('Boot mode', `${bootMode}: boot file escapes the TFTP root: ${bootFile}`);
  }
  if (!fs.existsSync(filePath)) {
    return fail('Boot mode', `${bootMode}: boot file missing: ${filePath}`);
  }
  return pass('Boot mode', `${bootMode}: ${filePath}`);
}

// Files Windows Boot Manager pulls over TFTP in secureboot mode. sources\boot.wim
// is the ramdisk image referenced by the generated network BCD.
export function secureBootTftpFiles(config) {
  return [
    config.dhcp?.secureBootFile ?? 'bootmgfw.efi',
    'Boot/BCD',
    'Boot/boot.sdi',
    'Boot/Fonts/wgl4_boot.ttf',
    'sources/boot.wim',
  ];
}

export function evaluateSecureBootTftpTree(config) {
  return secureBootTftpFiles(config).map((relativePath) => {
    const filePath = resolveTftpPath(config.tftp.root, relativePath);
    if (!filePath) {
      return fail(`TFTP file ${relativePath}`, `escapes the TFTP root ${config.tftp.root}`);
    }
    return fs.existsSync(filePath)
      ? pass(`TFTP file ${relativePath}`, filePath)
      : fail(`TFTP file ${relativePath}`, `${filePath} — run Endpoint Sync or tools\\Publish-SecureBootTftp.ps1`);
  });
}

// The TFTP copy of boot.wim must be the same content as the published HTTP copy
// (which the sync marker already vouches for). The publisher hardlinks them, so
// matching NTFS file ids is the cheap, definitive proof; size+mtime covers the
// cross-volume copy fallback. No hashing: 500+ MB per preflight is too slow.
export function evaluateSecureBootWimIdentity(config, publishedBootWim) {
  const name = 'Secure Boot boot.wim identity';
  const tftpWim = resolveTftpPath(config.tftp.root, 'sources/boot.wim');
  if (!tftpWim || !fs.existsSync(tftpWim)) {
    return fail(name, `TFTP sources\\boot.wim missing under ${config.tftp.root} — run Endpoint Sync or tools\\Publish-SecureBootTftp.ps1`);
  }
  if (!fs.existsSync(publishedBootWim)) {
    return fail(name, `published boot.wim missing at ${publishedBootWim}`);
  }
  const tftpStats = fs.statSync(tftpWim, { bigint: true });
  const publishedStats = fs.statSync(publishedBootWim, { bigint: true });
  if (tftpStats.dev === publishedStats.dev && tftpStats.ino === publishedStats.ino && tftpStats.ino !== 0n) {
    return pass(name, 'hardlinked to published boot.wim (same NTFS file id)');
  }
  if (tftpStats.size === publishedStats.size && tftpStats.mtimeMs === publishedStats.mtimeMs) {
    return pass(name, 'copied from published boot.wim (size and mtime match)');
  }
  return fail(name, 'TFTP sources\\boot.wim differs from the published boot.wim — run Endpoint Sync to refresh the hardlink');
}

export async function evaluateSecureBootSignature(config, options = {}) {
  const name = 'Secure Boot boot manager signature';
  const bootFile = resolveTftpPath(config.tftp.root, config.dhcp?.secureBootFile ?? 'bootmgfw.efi');
  if (!bootFile || !fs.existsSync(bootFile)) {
    return fail(name, `boot manager missing under ${config.tftp.root}`);
  }
  // Import by $PSHOME path: the console may inherit a PowerShell 7 PSModulePath,
  // which breaks Microsoft.PowerShell.Security autoloading in Windows PowerShell.
  const script = `Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security') -ErrorAction Stop; $signature = Get-AuthenticodeSignature -LiteralPath '${bootFile.replace(/'/g, "''")}' -ErrorAction Stop; @{ status = [string]$signature.Status; subject = [string]$signature.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
  let output;
  try {
    const run = options.runPowerShell ?? runPowerShell;
    const result = await run(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script]);
    output = JSON.parse(result.stdout.trim());
  } catch (error) {
    // Infrastructure failure (constrained language mode, missing module): the
    // existence/identity checks remain the blockers; surface this as a caveat.
    return warn(name, `signature check unavailable: ${error.message}`);
  }
  if (output.status !== 'Valid') {
    return fail(name, `Authenticode status ${output.status}: ${bootFile}`);
  }
  if (!/Microsoft Corporation|Microsoft Windows/.test(output.subject ?? '')) {
    return fail(name, `unexpected signer: ${output.subject}`);
  }
  return pass(name, output.subject);
}
