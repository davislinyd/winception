import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stateRootForConfig } from '../config.js';

export const RESERVED_WINDOWS_USERNAMES = new Set([
  'administrator', 'guest', 'defaultaccount', 'wdagutilityaccount', 'system',
]);

export function errorWithStatus(message, statusCode = 500, options = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicError = {
    message: options.message ?? message,
    code: options.code ?? 'request_failed',
    action: options.action ?? '',
  };
  return error;
}

export function publicApiError(error) {
  const fallback = {
    statusCode: error?.statusCode ?? (error instanceof SyntaxError ? 400 : 500),
    error: error instanceof SyntaxError
      ? 'The request could not be read. Correct the input and try again.'
      : 'Operation could not be completed. Check System Log and try again.',
    errorCode: error instanceof SyntaxError ? 'invalid_request' : 'unexpected_error',
    errorAction: error instanceof SyntaxError ? 'Correct the request and try again.' : 'Check System Log and try again.',
  };
  const published = error?.publicError;
  if (!published) {
    return fallback;
  }
  return {
    statusCode: error.statusCode ?? fallback.statusCode,
    error: String(published.message ?? fallback.error),
    errorCode: String(published.code ?? 'request_failed'),
    errorAction: String(published.action ?? ''),
  };
}

export function isBenignObjectSecurityTypeDataLine(line) {
  const text = String(line ?? '');
  if (!/TypeData\s+"System\.Security\.AccessControl\.ObjectSecurity"/u.test(text)) {
    return false;
  }
  return /成員已經存在|member\s+.+?\s+is\s+already\s+present|already\s+present|already\s+exists/iu.test(text);
}

export function makeOutputLogger(writeLine, prefix, options = {}) {
  let pending = '';
  return {
    write(chunk, stream = 'stdout') {
      pending += String(chunk ?? '');
      const lines = pending.split(/\r?\n/u);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() && !options.ignoreLine?.(line)) {
          writeLine(`${prefix} ${stream}: ${line}`);
        }
      }
    },
    flush() {
      if (pending.trim() && !options.ignoreLine?.(pending)) {
        writeLine(`${prefix} ${pending}`);
      }
      pending = '';
    },
  };
}

export function softwarePayloadLogLines(payloads = []) {
  return payloads
    .filter((payload) => payload?.status === 'reused' || payload?.status === 'downloaded')
    .map((payload) => `Software payload ${payload.status}: ${payload.id}`);
}

export function serviceSummary(service, config) {
  return {
    running: Boolean(service?.running),
    ...config,
  };
}

export function safeRead(callback, fallback = null) {
  try {
    return { value: callback(), error: null };
  } catch (error) {
    return { value: fallback, error: error.message };
  }
}

export function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/u, '');
  return raw.trim() ? JSON.parse(raw) : {};
}

export function stateRootPathForConfig(config) {
  return stateRootForConfig(config);
}

export function deploymentSecretsPath(config) {
  const configured = config.deploymentSecrets?.path;
  if (configured) {
    return path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(stateRootPathForConfig(config), configured);
  }
  return path.join(stateRootPathForConfig(config), 'config', 'osdcloud-secrets.json');
}

export function hasSecretValue(value) {
  const text = String(value ?? '').trim();
  return text !== '' && !/^<[^>]+>$/u.test(text);
}

export function deploymentSecretsStatus(config, env = process.env) {
  const filePath = deploymentSecretsPath(config);
  let fileSecrets = {};
  let fileError = null;
  const fileExists = fs.existsSync(filePath);
  if (fileExists) {
    try {
      fileSecrets = readJsonFile(filePath);
    } catch (error) {
      fileError = error.message;
    }
  }

  const fields = [
    ['windowsUsername', 'OSDCLOUD_WINDOWS_USERNAME'],
    ['windowsPassword', 'OSDCLOUD_WINDOWS_PASSWORD'],
    ['pxeinstallPassword', 'OSDCLOUD_PXEINSTALL_PASSWORD'],
  ];
  const status = {};
  const missing = [];
  for (const [jsonName, envName] of fields) {
    const fromFile = !fileError && hasSecretValue(fileSecrets?.[jsonName]);
    const fromEnv = hasSecretValue(env?.[envName]);
    status[jsonName] = {
      present: fromFile || fromEnv,
      source: fromFile ? 'file' : fromEnv ? 'environment' : 'missing',
    };
    if (!status[jsonName].present) {
      missing.push(jsonName);
    }
  }

  // The account name is not a secret; expose it so the Web console can
  // pre-fill it when re-editing credentials. The passwords are never returned.
  const resolvedUsername = (!fileError && hasSecretValue(fileSecrets?.windowsUsername))
    ? String(fileSecrets.windowsUsername).trim()
    : hasSecretValue(env?.OSDCLOUD_WINDOWS_USERNAME)
      ? String(env.OSDCLOUD_WINDOWS_USERNAME).trim()
      : null;

  return {
    ready: missing.length === 0,
    filePath,
    fileExists,
    fileError,
    missing,
    status,
    windowsUsername: resolvedUsername,
  };
}

export function writeDeploymentSecrets(config, input = {}) {
  const windowsUsername = String(input.windowsUsername ?? '').trim();
  const windowsPassword = String(input.windowsPassword ?? '').trim();
  if (!hasSecretValue(windowsUsername)) {
    throw errorWithStatus('windowsUsername is required.', 400);
  }
  if (!hasSecretValue(windowsPassword)) {
    throw errorWithStatus('windowsPassword is required.', 400);
  }
  if (RESERVED_WINDOWS_USERNAMES.has(windowsUsername.toLowerCase())) {
    throw errorWithStatus(
      `windowsUsername "${windowsUsername}" is a reserved Windows account name. `
      + 'Choose a different account name (the built-in Administrator account is disabled during deployment).',
      400,
    );
  }

  // Generate a 24-character alphanumeric random password (no special characters)
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let pxeinstallPassword = '';
  for (let i = 0; i < 24; i++) {
    pxeinstallPassword += chars[crypto.randomInt(chars.length)];
  }

  const filePath = deploymentSecretsPath(config);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify({ windowsUsername, windowsPassword, pxeinstallPassword }, null, 2)}\n`, 'utf8');
  return deploymentSecretsStatus(config);
}

export function localEndpointOverlayStatus(config) {
  const filePath = config.__localConfigPath
    ? path.resolve(config.__localConfigPath)
    : path.join(stateRootPathForConfig(config), 'config', 'osdcloud-console.local.json');
  if (!fs.existsSync(filePath)) {
    return {
      ready: false,
      filePath,
      detail: 'No local endpoint overlay has been written by Web endpoint sync.',
    };
  }
  try {
    const overlay = readJsonFile(filePath);
    const hasEndpoint = Boolean(
      overlay.adapter?.serverIp
      && overlay.adapter?.interfaceAlias
      && overlay.http?.host
      && overlay.tftp?.listenIp
      && overlay.dhcp?.ipxeBootUrl
      && overlay.smb?.share,
    );
    return {
      ready: hasEndpoint,
      filePath,
      detail: hasEndpoint
        ? `${overlay.adapter.interfaceAlias} ${overlay.adapter.serverIp}/${overlay.adapter.prefixLength ?? ''}`.trim()
        : 'Local overlay exists, but endpoint sections have not been written by Web endpoint sync.',
    };
  } catch (error) {
    return {
      ready: false,
      filePath,
      detail: `Unable to read local endpoint overlay: ${error.message}`,
    };
  }
}

export function osImageDeployableStatus(osImage) {
  const active = osImage?.activeImage;
  const selected = osImage?.selectedOs;
  if (!active) {
    return { ready: false, detail: 'No active OS image selected.' };
  }
  if (!active.cached) {
    return { ready: false, detail: `Active OS image is not cached: ${active.fileName ?? active.id}` };
  }
  if (!selected) {
    return { ready: false, detail: `selected-os.json not published: ${osImage?.selectedOsPath ?? ''}`.trim() };
  }
  const selectedIndex = Number(selected.imageIndex ?? selected.osImageIndex);
  const activeIndex = Number(active.imageIndex);
  const stale = selected.id !== active.id || selected.fileName !== active.fileName || selectedIndex !== activeIndex;
  if (stale) {
    return { ready: false, detail: `selected-os.json is stale for active image ${active.id}.` };
  }
  if (!String(active.fileName ?? '').toLowerCase().endsWith('.wim')) {
    return { ready: false, detail: 'Active OS image must be an exported single WIM.' };
  }
  return { ready: true, detail: `${active.id} -> ${active.fileName} index ${active.imageIndex}` };
}

export function profilePayloadStatus(profilePayload) {
  if (!profilePayload) {
    return { ready: false, detail: 'Deployment profile payload has not been evaluated.' };
  }
  return {
    ready: profilePayload.ok === true,
    detail: profilePayload.detail || (profilePayload.ok ? 'Active profile payload is published.' : 'Active profile payload is not published.'),
  };
}

export function preflightStatus(preflight) {
  if (!Array.isArray(preflight) || preflight.length === 0) {
    return { ready: false, warnings: 0, detail: 'Preflight has not been run in this Web session.' };
  }
  const failures = preflight.filter((check) => check.ok === false);
  if (failures.length > 0) {
    return { ready: false, warnings: 0, detail: `${failures.length} preflight check(s) are blocking service start.` };
  }
  // Warnings (ok:true, warn:true) are non-blocking caveats — e.g. the service IP
  // is configured and bindable but the link is not up yet. They do not stop the
  // operator from starting services.
  const warnings = preflight.filter((check) => check.ok === true && check.warn === true);
  const unknown = preflight.filter((check) => check.ok !== true);
  if (unknown.length > 0) {
    return { ready: false, warnings: warnings.length, detail: `${unknown.length} preflight check(s) need review.` };
  }
  return {
    ready: true,
    warnings: warnings.length,
    detail: warnings.length > 0
      ? `${preflight.length} preflight check(s) passed, ${warnings.length} warning(s) — review before booting clients.`
      : `${preflight.length} preflight check(s) passed.`,
  };
}

export function deploymentServicesRunning(services = {}) {
  return ['http', 'tftp', 'dhcp'].every((name) => services?.[name]?.running === true);
}

export function fleetHasDeploymentRun(fleet = {}) {
  return Number(fleet?.total ?? 0) > 0 || (Array.isArray(fleet?.runs) && fleet.runs.length > 0);
}
