import { api, loadInterfaces, mutate } from './api.js';
import { confirmAction, closeDialog } from './dialogs.js';
import { elements } from './dom.js';
import { render } from './render.js';
import { state } from './state.js';

export const SCENARIOS = [
  { id: 'proxy', title: '使用既有網路與 DHCP', detail: 'Client 與筆電在同一 subnet，使用既有 gateway 上網。Winception 只提供 PXE。' },
  { id: 'server', title: '使用既有網路，由筆電提供 DHCP', detail: 'Client 與筆電在同一 subnet，使用既有 gateway 上網。此網段必須沒有其他 DHCP server。' },
  { id: 'nat', title: 'Client 接到筆電，由筆電提供 NAT', detail: '上網介面連 Internet；另一張網卡連 client 或交換器。筆電提供 client 的 DHCP 與 gateway。' },
];
export const WIZARD_STEPS = ['project-root', 'secrets', 'scene', 'runtime', 'endpoint', 'os-image', 'profile', 'preflight', 'services', 'client'];
const GROUPS = [
  ['主機與帳號', ['project-root', 'secrets']], ['選擇接線方式', ['scene']],
  ['部署檔案與網路', ['runtime', 'endpoint']], ['Windows 與部署設定', ['os-image', 'profile']],
  ['檢查並開始部署', ['preflight', 'services', 'client']],
];
const COPY = {
  'project-root': ['部署資料夾', '確認部署資料保存的位置。', '資料夾位於 Git clone 與 HostTools 之外。'],
  web: ['開啟操作介面', '後續設定都從這個介面進行。', '可以開啟目前的 Web Console。'],
  secrets: ['部署帳號', '設定部署後的 Windows 帳號與密碼；SMB 密碼由系統準備。', '三個必要帳號欄位已保存於本機 State。'],
  scene: ['選擇接線方式', '依現場的接線和 DHCP 來源選擇場景。', '已選擇場景；下一階段會確認並套用網路。'],
  runtime: ['準備部署檔案', '建立網路開機、WinPE 與檔案分享所需的環境。', '所有必要部署檔案皆已就緒。'],
  endpoint: ['確認並套用部署網路', '確認介面、IP、gateway、DNS 與 DHCP 來源，再同步網路開機檔案。', '端點已同步，並符合目前的接線場景。'],
  'os-image': ['選擇 Windows', '下載或匯入 Windows 映像，準備一份可安裝的映像。', '至少有一份可部署的 Windows 映像已快取。'],
  profile: ['確認要安裝的內容', '選擇 Windows、語言、時區與需要的軟體，並發布部署設定。', '本次部署設定與所選映像、軟體已發布。'],
  preflight: ['部署前檢查', '檢查網路、部署檔案、映像、分享與服務連接埠。', '沒有阻擋部署的失敗項目；警告仍須閱讀。'],
  services: ['啟動部署服務', '核對本次安裝內容、接線與 DHCP 來源後啟動。目標電腦從 PXE 開機後將進行重灌。', 'HTTP、TFTP 與 DHCP／PXE Proxy 均已啟動。'],
  client: ['開機並確認完成', '目標電腦選 UEFI IPv4 PXE；必要時核對配對碼，再查看部署活動。', '本次部署顯示 windows-desktop-ready。'],
};

export function selectedScenario(appState) {
  return state.onboardingScenario || (appState.config?.network?.topology === 'dual-nic-nat' ? 'nat'
    : appState.config?.dhcp?.dhcpMode === 'proxy' ? 'proxy' : 'server');
}

export function wizardInitialization(appState) {
  const source = appState.initialization;
  const steps = (source.steps ?? []).map((step) => {
    const copy = COPY[step.id];
    return copy ? { ...step, label: copy[0], objective: copy[1], doneWhen: copy[2],
      safetyNote: step.id === 'services' ? dhcpSafetyText(appState) : step.id === 'secrets' ? '密碼只保存於本機，不顯示在日誌或文件。' : '' } : step;
  });
  const endpoint = steps.find((step) => step.id === 'endpoint');
  if (endpoint && state.onboardingNetworkDirty) endpoint.done = false;
  steps.splice(3, 0, { id: 'scene', action: 'scene', done: Boolean(state.onboardingScenario) || steps.find((s) => s.id === 'endpoint')?.done,
    label: COPY.scene[0], objective: COPY.scene[1], doneWhen: COPY.scene[2], required: false });
  return { ...source, steps };
}

export function dhcpSafetyText(appState) {
  return appState.config?.dhcp?.dhcpMode === 'proxy'
    ? '使用既有 DHCP：保留原 DHCP 與 gateway；Winception 只提供 PXE。Client 首次連入需核對配對碼並核准。'
    : '由 Winception 提供 DHCP：確認 client 網段沒有其他 DHCP server。NAT 的上游 DHCP 可維持運作。';
}

function node(tag, text, className = '') {
  const item = document.createElement(tag);
  if (text) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function action(label, name, data = {}) {
  const button = node('button', label);
  button.type = 'button';
  button.dataset.onboardingAction = name;
  Object.assign(button.dataset, data);
  button.disabled = state.busy || (['approve', 'reject', 'apply-network', 'stop-services'].includes(name) && state.current?.operation?.running === true);
  return button;
}

let optionsPromise = null;
let optionsReadAt = 0;
export function ensureNetworkOptions() {
  if (optionsPromise || Date.now() - optionsReadAt < 15_000) return;
  optionsReadAt = Date.now();
  optionsPromise = Promise.all([api('/api/network/options'), loadInterfaces()]).then(([payload]) => {
    state.networkOptions = payload.options;
    state.networkOptionsError = '';
  }).catch((error) => { state.networkOptionsError = error.message; }).finally(() => {
    optionsPromise = null;
    render();
  });
}

function selectField(body, label, id, rows, value, changed) {
  const field = node('label', label);
  const select = node('select');
  select.id = id;
  select.append(new Option('請選擇介面', ''));
  for (const row of rows) {
    select.append(new Option(`${row.interfaceAlias} · ${row.ipAddress || row.ipv4?.[0]?.ipAddress || '尚無 IPv4'}${row.status ? ` · ${row.status}` : ''}${row.gateway ? ` · GW ${row.gateway}` : ''}`, row.interfaceAlias));
  }
  select.value = value || '';
  select.onchange = () => changed(select.value);
  field.append(select);
  body.append(field);
}

export function renderScene(body, appState, apply = false) {
  const scenario = selectedScenario(appState);
  const cards = node('div', '', 'onboarding-scenarios');
  for (const item of SCENARIOS) {
    const button = action(item.title, 'scenario', { scenario: item.id });
    button.classList.toggle('selected', scenario === item.id);
    button.setAttribute('aria-pressed', String(scenario === item.id));
    button.append(node('small', item.detail));
    cards.append(button);
  }
  body.append(cards);
  const image = node('img', '', 'onboarding-wiring');
  image.src = `/manual/manual-assets/network-${scenario}.svg`;
  image.alt = SCENARIOS.find((s) => s.id === scenario).detail;
  body.append(image);
  if (!apply) {
    body.append(node('p', '選擇只決定教學場景。準備部署檔案後，會再次確認並套用網路。'));
    return;
  }
  const fields = node('div', '', 'onboarding-network');
  if (scenario === 'nat') {
    const rows = state.networkOptions?.adapters ?? [];
    selectField(fields, '筆電上網介面（可使用 Wi-Fi）', 'onboarding-wan', rows, state.networkWanInterface || appState.config?.network?.nat?.wanInterfaceAlias,
      (value) => { state.networkWanInterface = value; state.onboardingNetworkDirty = true; render(); });
    selectField(fields, 'Client 接線介面（Ethernet／USB Ethernet）', 'onboarding-pxe', rows, state.networkPxeInterface || appState.config?.network?.nat?.pxeInterfaceAlias,
      (value) => { state.networkPxeInterface = value; state.onboardingNetworkDirty = true; render(); });
    const label = node('label', 'Client 子網（CIDR）');
    const input = node('input');
    input.id = 'onboarding-subnet';
    input.placeholder = '例如 192.168.100.0/24';
    input.value = state.networkInternalSubnet || appState.config?.network?.nat?.internalSubnet || state.networkOptions?.suggestedSubnet || '';
    input.oninput = () => { state.networkInternalSubnet = input.value; state.onboardingNetworkDirty = true; };
    label.append(input);
    fields.append(label, node('p', '將檢查子網是否與上游或 VPN 重疊。需要支援 Hyper-V／WinNAT 的 Windows，並以系統管理員執行。'));
    if (state.networkOptions?.icsRunning) fields.append(node('p', 'ICS 正在運作，可能屬於 Hyper-V Default Switch 或其他服務。請先確認擁有者並處理衝突，或改用既有 LAN。精靈不會停止它。', 'form-error'));
    for (const nat of state.networkOptions?.natNetworks ?? []) {
      if (nat.name !== appState.config?.network?.nat?.natName) fields.append(node('p', `其他 NAT：${nat.name}（${nat.subnet}）。請由該服務管理者處理；Winception 不會移除它。`, 'form-error'));
    }
  } else {
    selectField(fields, '與 client 位於同一 LAN 的服務介面', 'onboarding-lan', state.interfaces,
      state.onboardingLanInterface || appState.config?.adapter?.interfaceAlias,
      (value) => { state.onboardingLanInterface = value; state.onboardingNetworkDirty = true; render(); });
    const row = state.interfaces.find((item) => item.interfaceAlias === (state.onboardingLanInterface || appState.config?.adapter?.interfaceAlias));
    fields.append(node('p', row ? `IP：${row.ipAddress}/${row.prefixLength} · Gateway：${row.gateway || '尚未設定'} · DNS：${(row.dnsServers ?? []).join(', ') || '依目前網路設定'}` : '請先選擇具有 IPv4 的 LAN 介面。Windows 網卡 IP 仍由你明確設定。'));
    if (scenario === 'server') {
      for (const [id, label, draft, key] of [
        ['onboarding-lease-start', '已確認可用的 DHCP 起始 IP', 'onboardingLeaseStart', 'leaseStartIp'],
        ['onboarding-lease-end', '已確認可用的 DHCP 結束 IP', 'onboardingLeaseEnd', 'leaseEndIp'],
      ]) {
        const field = node('label', label);
        const input = node('input');
        input.id = id;
        input.value = state[draft] || (row?.ipAddress === appState.config?.adapter?.serverIp ? appState.config?.dhcp?.[key] || '' : '');
        input.oninput = () => { state[draft] = input.value; state.onboardingNetworkDirty = true; };
        field.append(input); fields.append(field);
      }
      fields.append(node('p', '由現場網管確認位址池沒有其他設備占用；不能包含筆電或 gateway。'));
    }
  }
  if (state.networkOptionsError) fields.append(node('p', `網卡查詢失敗：${state.networkOptionsError}`, 'form-error'));
  fields.append(node('p', dhcpSafetyText({ config: { dhcp: { dhcpMode: scenario === 'proxy' ? 'proxy' : 'server' } } })),
    action('確認並套用部署網路', 'apply-network'));
  body.append(fields);
}

export function renderWizardNavigation(appState, initialization) {
  ensureNetworkOptions();
  const selectedId = state.selectedGuidedStepId;
  const current = initialization.steps.find((step) => step.id === selectedId);
  for (const row of elements.initializationSteps.querySelectorAll('.initialization-step')) row.hidden = row.dataset.stepId !== selectedId;
  const progress = node('nav', '', 'onboarding-stages');
  progress.setAttribute('aria-label', '首次設定階段');
  GROUPS.forEach(([label, ids], index) => {
    const button = action(`${index + 1} ${label}`, 'step', { step: ids[0] });
    if (ids.includes(selectedId)) button.setAttribute('aria-current', 'step');
    progress.append(button);
  });
  elements.initializationSteps.prepend(progress);
  const footer = elements.initializationNext.parentElement;
  footer.querySelector('[data-onboarding-action="previous"]')?.remove();
  const previous = action('上一步', 'previous');
  previous.disabled = WIZARD_STEPS.indexOf(selectedId) <= 0 || state.busy;
  footer.prepend(previous);
  const next = elements.initializationNext;
  delete next.dataset.initAction;
  delete next.dataset.nextAction;
  next.dataset.onboardingAction = 'next';
  next.textContent = selectedId === 'client' ? '查看部署活動' : '下一步';
  next.hidden = false;
  next.disabled = state.busy || appState.operation?.running === true || (selectedId !== 'client' && !current?.done);
  elements.initializationSummary.textContent = current?.objective || '依接線方式與目前狀態完成設定。';
  elements.initializationBadge.textContent = appState.operation?.running ? '處理中' : current?.done ? '本步已完成' : '待處理';
  elements.initProgressText.textContent = `第 ${Math.max(0, GROUPS.findIndex(([, ids]) => ids.includes(selectedId))) + 1} 階段，共 5 階段`;
}

export function renderBootRequests(appState) {
  const root = document.getElementById('beginner-boot-requests');
  if (!root) return;
  root.replaceChildren();
  const requests = appState.bootRequests ?? [];
  root.hidden = requests.length === 0;
  if (!requests.length) return;
  root.append(node('h2', '核准首次連入的電腦'), node('p', '請核對目標電腦 WinPE 畫面的配對碼。核准後會進行重灌；拒絕則不提供部署憑證。'));
  for (const request of requests) {
    const card = node('article', '', 'onboarding-pairing');
    card.append(node('strong', `${request.clientId} · ${request.clientIp} · ${request.clientMac}`), node('code', request.pairingCode),
      action('核對並核准', 'approve', { requestId: request.requestId }), action('拒絕', 'reject', { requestId: request.requestId }));
    root.append(card);
  }
}

export async function handleOnboardingAction(source) {
  if (source.disabled) return;
  const actionName = source.dataset.onboardingAction;
  if (actionName === 'scenario') { state.onboardingScenario = source.dataset.scenario; state.onboardingNetworkDirty = true; render(); return; }
  const selected = state.selectedGuidedStepId;
  if (actionName === 'step' || actionName === 'previous' || actionName === 'next') {
    if (actionName === 'next' && selected === 'client') { closeDialog(elements.initializationDialog); document.getElementById('tab-fleet').click(); return; }
    state.selectedGuidedStepId = actionName === 'step' ? source.dataset.step
      : WIZARD_STEPS[Math.max(0, Math.min(WIZARD_STEPS.length - 1, WIZARD_STEPS.indexOf(selected) + (actionName === 'next' ? 1 : -1)))];
    state.guidedStepCollapsed = false;
    render(); return;
  }
  if (actionName === 'approve' || actionName === 'reject') {
    const request = state.current.bootRequests.find((item) => item.requestId === source.dataset.requestId);
    if (!request) throw new Error('此配對請求已失效。請重新整理。');
    const approved = actionName === 'approve';
    if (!await confirmAction({ title: approved ? '核准本次電腦部署' : '拒絕本次連線',
      message: approved ? '確認目標電腦顯示相同配對碼。核准後將提供本次部署憑證，並自動重灌。' : '此電腦不會取得部署憑證。',
      details: [request.clientId, request.clientMac, request.pairingCode], confirmLabel: approved ? '配對碼相同，核准部署' : '拒絕' })) return;
    await mutate(`/api/boot-requests/${approved ? 'approve' : 'reject'}`, { requestId: request.requestId, pairingCode: request.pairingCode });
    return;
  }
  if (actionName === 'stop-services') {
    if ((state.current.fleet?.counts?.running ?? 0) > 0) throw new Error('仍有電腦部署中，請確認全部完成後再停止服務。');
    if (await confirmAction({ title: '停止部署服務', message: '停止 HTTP、TFTP 與 DHCP／PXE Proxy。Winception NAT 會保持運作，已部署電腦仍可上網。', confirmLabel: '確認停止' })) {
      await mutate('/api/services/stop-all');
    }
    return;
  }
  if (actionName !== 'apply-network') return;
  const appState = state.current;
  const scenario = selectedScenario(appState);
  if (scenario === 'nat') {
    const input = { wanInterfaceAlias: document.getElementById('onboarding-wan').value,
      pxeInterfaceAlias: document.getElementById('onboarding-pxe').value,
      internalSubnet: document.getElementById('onboarding-subnet').value.trim() };
    if (!input.wanInterfaceAlias || !input.pxeInterfaceAlias || !input.internalSubnet) throw new Error('請選擇上網與 client 介面，並輸入 client 子網。');
    if (!await confirmAction({ title: '準備筆電 NAT', message: '會停止部署服務、準備 Hyper-V／WinNAT，並只設定 Winception 部署 vNIC。可能需要重開機；WAN 設定保持原樣。',
      details: [input.wanInterfaceAlias, input.pxeInterfaceAlias, input.internalSubnet], confirmLabel: '確認並準備 NAT' })) return;
    await mutate('/api/network/prepare', input);
  } else {
    if (appState.config?.network?.topology === 'dual-nic-nat') throw new Error('請先在控制台明確移除 Winception NAT，再選擇既有 LAN 介面。');
    const row = state.interfaces.find((item) => item.interfaceAlias === document.getElementById('onboarding-lan').value);
    if (!row) throw new Error('請選擇具有 IPv4 的服務介面。');
    if (scenario === 'server' && !row.gateway) throw new Error('此 LAN 介面尚無 gateway。請先明確完成 Windows 網路設定。');
    if (scenario === 'server' && !row.dnsServers?.length) throw new Error('此 LAN 介面尚無 DNS。請先確認現場 DNS 設定。');
    const choice = { ...row, dhcpMode: scenario };
    if (scenario === 'server') {
      choice.leaseStartIp = document.getElementById('onboarding-lease-start').value.trim();
      choice.leaseEndIp = document.getElementById('onboarding-lease-end').value.trim();
      if (!choice.leaseStartIp || !choice.leaseEndIp) throw new Error('請輸入已確認可用的 DHCP 位址池。');
    }
    if (!await confirmAction({ title: '套用目前場地的部署網路', message: `${SCENARIOS.find((item) => item.id === scenario).detail} ${scenario === 'server' ? '確認此 client 網段沒有其他 DHCP server。' : '保留既有 DHCP。'}`,
      details: [row.interfaceAlias, `${row.ipAddress}/${row.prefixLength}`, `Gateway: ${row.gateway || '由既有 DHCP 提供'}`, `DNS: ${(row.dnsServers ?? []).join(', ')}`,
        ...(scenario === 'server' ? [`DHCP: ${choice.leaseStartIp} – ${choice.leaseEndIp}`] : [])], confirmLabel: '確認並同步端點' })) return;
    await mutate('/api/endpoint', { interface: choice });
  }
  state.onboardingNetworkDirty = false;
  render();
}
