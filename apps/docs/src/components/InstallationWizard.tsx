import { useEffect, useMemo, useRef, useState } from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

const storageKey = 'winception-docs.install-plan.v1';
const steps = ['host-checked', 'signature-verified', 'installed', 'runtime-prepared', 'acceptance-recorded'] as const;
type StepId = typeof steps[number];

interface InstallPlan {
  schemaVersion: 1;
  vmRole: 'deployment-host';
  source: 'local' | 'release';
  releaseTag: string;
  managementNic: string;
  pxeNic: string;
  managementSubnet: string;
  pxeSubnet: string;
  bootMode: 'secureboot' | 'ipxe';
  stepStatus: Record<StepId, boolean>;
}

const emptyPlan: InstallPlan = {
  schemaVersion: 1,
  vmRole: 'deployment-host',
  source: 'local',
  releaseTag: 'v2.0.0-alpha.14',
  managementNic: 'Ethernet',
  pxeNic: 'Ethernet 2',
  managementSubnet: '192.168.100.0/24',
  pxeSubnet: '10.77.0.0/24',
  bootMode: 'secureboot',
  stepStatus: { 'host-checked': false, 'signature-verified': false, installed: false, 'runtime-prepared': false, 'acceptance-recorded': false },
};

export function InstallationWizard({ compact = false }: { compact?: boolean }): React.JSX.Element {
  const { i18n } = useDocusaurusContext();
  const zh = i18n.currentLocale === 'zh-TW';
  const [plan, setPlan] = useState<InstallPlan>(emptyPlan);
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored) setPlan(validatePlan(JSON.parse(stored) as unknown));
    } catch { window.localStorage.removeItem(storageKey); }
  }, []);
  useEffect(() => { window.localStorage.setItem(storageKey, JSON.stringify(plan)); }, [plan]);
  const errors = useMemo(() => validateNetwork(plan, zh), [plan, zh]);
  const commands = useMemo(() => commandLines(plan), [plan]);
  function update<K extends keyof InstallPlan>(key: K, value: InstallPlan[K]): void { setPlan((current) => ({ ...current, [key]: value })); }
  function exportPlan(): void {
    const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'winception-install-plan.json'; link.click(); URL.revokeObjectURL(link.href);
    setNotice(zh ? '已匯出不含 secret 的安裝計畫。' : 'Exported a secret-free installation plan.');
  }
  async function importPlan(file: File): Promise<void> {
    try { setPlan(validatePlan(JSON.parse(await file.text()) as unknown)); setNotice(zh ? '安裝計畫已匯入並通過 schema 驗證。' : 'Installation plan imported and schema-validated.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : (zh ? '匯入失敗。' : 'Import failed.')); }
  }
  async function copyCommands(): Promise<void> { await navigator.clipboard.writeText(commands.join('\r\n')); setNotice(zh ? '命令已複製。' : 'Commands copied.'); }
  return (
    <section className={`interactive-card ${compact ? 'is-compact' : ''}`} aria-labelledby="install-wizard-title">
      <h2 id="install-wizard-title">{zh ? '互動式安裝計畫' : 'Interactive installation plan'}</h2>
      <p>{zh ? '只產生安全命令與 checklist；NIC alias、subnet 和進度保存在此瀏覽器，沒有 secret。' : 'Generates safe commands and a checklist only; NIC aliases, subnets and progress stay in this browser, without secrets.'}</p>
      <div className="wizard-grid">
        <label>{zh ? '安裝來源' : 'Install source'}<select value={plan.source} onChange={(event) => update('source', event.target.value as InstallPlan['source'])}><option value="local">{zh ? '本機 MSI + CER' : 'Local MSI + CER'}</option><option value="release">GitHub prerelease tag</option></select></label>
        <label>{zh ? 'Release tag' : 'Release tag'}<input value={plan.releaseTag} onChange={(event) => update('releaseTag', event.target.value)} /></label>
        <label>{zh ? '管理 NIC alias' : 'Management NIC alias'}<input value={plan.managementNic} onChange={(event) => update('managementNic', event.target.value)} /></label>
        <label>{zh ? 'PXE NIC alias' : 'PXE NIC alias'}<input value={plan.pxeNic} onChange={(event) => update('pxeNic', event.target.value)} /></label>
        <label>{zh ? '管理 subnet' : 'Management subnet'}<input value={plan.managementSubnet} onChange={(event) => update('managementSubnet', event.target.value)} /></label>
        <label>{zh ? '隔離 PXE subnet' : 'Isolated PXE subnet'}<input value={plan.pxeSubnet} onChange={(event) => update('pxeSubnet', event.target.value)} /></label>
        <label>{zh ? 'Client boot mode' : 'Client boot mode'}<select value={plan.bootMode} onChange={(event) => update('bootMode', event.target.value as InstallPlan['bootMode'])}><option value="secureboot">Secure Boot</option><option value="ipxe">iPXE</option></select></label>
      </div>
      {errors.length > 0 && <div className="validation-errors" role="alert"><strong>{zh ? '先修正：' : 'Correct first:'}</strong><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
      <h3>{zh ? '安全命令' : 'Safe commands'}</h3>
      <pre className="command-preview"><code>{commands.join('\r\n')}</code></pre>
      <button type="button" onClick={() => { void copyCommands(); }}>{zh ? '複製命令' : 'Copy commands'}</button>
      <h3>{zh ? 'Validation checklist' : 'Validation checklist'}</h3>
      <div className="check-grid">{steps.map((id) => <label key={id}><input type="checkbox" checked={plan.stepStatus[id]} onChange={(event) => setPlan((current) => ({ ...current, stepStatus: { ...current.stepStatus, [id]: event.target.checked } }))} />{stepLabel(id, zh)}</label>)}</div>
      <div className="wizard-actions">
        <button type="button" onClick={exportPlan}>{zh ? '匯出 JSON' : 'Export JSON'}</button>
        <button type="button" onClick={() => fileInput.current?.click()}>{zh ? '匯入 JSON' : 'Import JSON'}</button>
        <button type="button" onClick={() => { setPlan(emptyPlan); setNotice(zh ? '已重設。' : 'Reset.'); }}>{zh ? '重設' : 'Reset'}</button>
        <input ref={fileInput} aria-label={zh ? '選擇安裝計畫 JSON' : 'Choose installation plan JSON'} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importPlan(file); event.target.value = ''; }} />
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className="safety-note"><strong>{zh ? '不會產生：' : 'Never generated: '}</strong>{zh ? 'NIC 修改、DHCP 啟動、irm | iex、secret 或自動信任憑證。' : 'NIC changes, DHCP startup, irm | iex, secrets or automatic certificate trust.'}</div>
    </section>
  );
}

function validatePlan(value: unknown): InstallPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Installation plan must be a JSON object.');
  const item = value as Partial<InstallPlan> & Record<string, unknown>;
  const allowed = new Set(['schemaVersion', 'vmRole', 'source', 'releaseTag', 'managementNic', 'pxeNic', 'managementSubnet', 'pxeSubnet', 'bootMode', 'stepStatus']);
  if (Object.keys(item).some((key) => !allowed.has(key) || /secret|password|token|credential/iu.test(key))) throw new Error('Installation plan contains an unknown or secret-like field.');
  if (item.schemaVersion !== 1 || item.vmRole !== 'deployment-host' || !['local', 'release'].includes(String(item.source)) || !['secureboot', 'ipxe'].includes(String(item.bootMode))) throw new Error('Installation plan schema is invalid or unsupported.');
  for (const field of ['releaseTag', 'managementNic', 'pxeNic', 'managementSubnet', 'pxeSubnet'] as const) if (typeof item[field] !== 'string' || item[field].length > 128) throw new Error(`Installation plan field is invalid: ${field}`);
  if (!item.stepStatus || typeof item.stepStatus !== 'object') throw new Error('Installation plan stepStatus is invalid.');
  const status = item.stepStatus as Record<string, unknown>;
  if (Object.keys(status).some((key) => !steps.includes(key as StepId)) || steps.some((key) => typeof status[key] !== 'boolean')) throw new Error('Installation plan stepStatus schema is invalid.');
  return item as InstallPlan;
}

function validateNetwork(plan: InstallPlan, zh: boolean): string[] {
  const errors: string[] = [];
  const cidr = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/u;
  if (!plan.managementNic.trim() || !plan.pxeNic.trim()) errors.push(zh ? '兩張 NIC 都必須有 alias。' : 'Both NICs require aliases.');
  if (plan.managementNic.trim().toLocaleLowerCase() === plan.pxeNic.trim().toLocaleLowerCase()) errors.push(zh ? '管理 NIC 與 PXE NIC 不可相同。' : 'Management and PXE NICs must differ.');
  if (!cidr.test(plan.managementSubnet) || !cidr.test(plan.pxeSubnet)) errors.push(zh ? 'Subnet 必須使用 IPv4 CIDR。' : 'Subnets must use IPv4 CIDR.');
  if (plan.managementSubnet === plan.pxeSubnet) errors.push(zh ? '管理 subnet 與 PXE subnet 不可重疊。' : 'Management and PXE subnets must not overlap.');
  if (!/^v2\.\d+\.\d+-(alpha|beta|rc)\.\d+$/u.test(plan.releaseTag)) errors.push(zh ? 'Release tag 格式無效。' : 'Release tag format is invalid.');
  return errors;
}

function commandLines(plan: InstallPlan): string[] {
  const prefix = '.\\Install-Winception.ps1';
  const source = plan.source === 'local'
    ? '-MsiPath .\\Winception-v2.msi -CertificatePath .\\Winception-Local-CodeSigning.cer'
    : `-ReleaseTag ${plan.releaseTag}`;
  return [
    `${prefix} -Action Check ${source} -ReportPath .\\winception-check.json`,
    `${prefix} -Action Install ${source} -TrustSelfSignedCertificate -ShowSetupCode -OpenBrowser -ReportPath .\\winception-install.json`,
    `${prefix} -Action Verify -ReportPath .\\winception-verify.json`,
  ];
}

function stepLabel(id: StepId, zh: boolean): string {
  const labels: Record<StepId, [string, string]> = {
    'host-checked': ['主機與雙 NIC topology 已確認', 'Host and dual-NIC topology checked'],
    'signature-verified': ['Manifest、hash 與 signer 已驗證', 'Manifest, hashes and signer verified'],
    installed: ['Services、ACL、pipe、SQLite 與 health 已驗證', 'Services, ACL, pipe, SQLite and health verified'],
    'runtime-prepared': ['隔離 PXE runtime 與 preflight 已完成', 'Isolated PXE runtime and preflight completed'],
    'acceptance-recorded': ['單 client 與 Software Test evidence 已記錄', 'Single-client and Software Test evidence recorded'],
  };
  return labels[id][zh ? 0 : 1];
}
