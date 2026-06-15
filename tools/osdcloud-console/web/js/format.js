import { $ } from './dom.js';

export const osFamilyLabels = new Map([
  ['win11', 'Windows 11'],
]);

export function text(value, fallback = '-') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

export function percent(value) {
  return Number.isFinite(value) ? `${value}%` : '-';
}

export function bytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return '-';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = number;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function osDownloadBytes(status) {
  const total = status?.totalBytes ? ` / ${bytes(status.totalBytes)}` : '';
  return `${bytes(status?.bytes)}${total}`;
}

export function osDownloadStatusText(status) {
  if (!status) {
    return '';
  }
  if (status.status === 'failed') {
    return `Failed: ${text(status.error, 'unknown error')}`;
  }
  if (status.status === 'downloaded' || status.status === 'cache-hit') {
    return `Cached ${text(status.fileName ?? status.catalogId)}.`;
  }
  if (status.phase === 'downloading-source') {
    return `Downloading source image ${osDownloadBytes(status)}`;
  }
  if (status.phase === 'download-complete') {
    return 'Download complete; preparing image...';
  }
  if (status.message) {
    return status.message;
  }
  if (status.status === 'starting') {
    return 'Starting OS image download...';
  }
  return `${text(status.status)} ${text(status.fileName ?? status.catalogId)} ${osDownloadBytes(status)}`;
}

export function osDownloadButtonText(status) {
  if (!status || status.status === 'starting' || status.phase === 'starting') {
    return 'Starting...';
  }
  if (status.phase === 'downloading-source') {
    return `Downloading ${osDownloadBytes(status)}`;
  }
  if (status.phase === 'exporting-wim') {
    return 'Exporting WIM...';
  }
  if (status.running) {
    return 'Processing...';
  }
  return status.status === 'failed' ? 'Failed' : 'Download';
}

export function osImageLabel(image) {
  if (!image) {
    return '-';
  }
  const version = image.version || image.releaseId || image.build || 'Windows';
  return `${version} ${text(image.language)} ${text(image.edition)} index ${text(image.imageIndex)}`;
}

export function elapsed(seconds) {
  if (!Number.isFinite(seconds)) {
    return '-';
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}m ${String(remainder).padStart(2, '0')}s`;
}

export function twoDigit(value) {
  return String(value).padStart(2, '0');
}

export function localTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const TZ = 'Asia/Taipei';
const compactDateTimeFmt = new Intl.DateTimeFormat('en', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit',
  hour12: false,
  timeZoneName: 'shortOffset',
});

export function localCompactDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  const p = Object.fromEntries(compactDateTimeFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute} ${p.timeZoneName.replace('GMT', 'UTC')}`;
}

export function localDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleString();
}

export function endpointLabel(config) {
  const adapter = config?.adapter ?? {};
  return `${text(adapter.interfaceAlias)} ${text(adapter.serverIp)}/${text(adapter.prefixLength)}`;
}

export function dhcpRange(config) {
  return `${text(config?.dhcp?.leaseStartIp)} - ${text(config?.dhcp?.leaseEndIp)}`;
}
