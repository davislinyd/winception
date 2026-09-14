import { state } from './state.js';

const SERVICE_KEYS = ['http', 'tftp', 'dhcp'];

export function activeDeploymentCount(appState) {
  const counts = appState?.fleet?.counts ?? {};
  return ['running', 'awaiting-windows', 'windows-running'].reduce((total, status) => total + (counts[status] ?? 0), 0);
}

function preflightChecks(appState) {
  const value = appState?.preflight;
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value?.checks) ? value.checks : [];
}

function preflightState(appState) {
  const checks = preflightChecks(appState);
  const failed = checks.filter((check) => check?.ok === false);
  const ran = checks.length > 0 || Boolean(appState?.preflight?.ranAt) || Boolean(appState?.preflight?.status);
  const ready = appState?.preflight?.ok === true
    || appState?.preflight?.status === 'ready'
    || (checks.length > 0 && checks.every((check) => check?.ok === true));
  return { checks, failed, ran, ready };
}

function servicesState(appState) {
  const running = SERVICE_KEYS.filter((key) => appState?.services?.[key]?.running === true).length;
  return { running, total: SERVICE_KEYS.length, ready: running === SERVICE_KEYS.length };
}

function stepStatus(done, current, blocked) {
  if (done) return 'complete';
  if (blocked) return 'blocked';
  if (current) return 'current';
  return 'waiting';
}

function setupStep(initialization) {
  return initialization?.nextStepId || 'project-root';
}

function model(fields) {
  return {
    why: '',
    nextHint: '',
    pxeReady: false,
    ...fields,
  };
}

function primaryModel(appState) {
  const initialization = appState?.initialization ?? {};
  const profileReady = Boolean(appState?.profile?.activeProfile) && !appState?.profile?.error;
  const imageReady = Boolean(appState?.osImage?.activeImage?.cached) && !appState?.osImage?.error;
  const runtimeReady = appState?.runtime?.ready === true;
  const preflight = preflightState(appState);
  const services = servicesState(appState);
  const operationRunning = appState?.operation?.running === true || Boolean(state.initializationPendingAction);
  const shared = {
    profileReady,
    imageReady,
    runtimeReady,
    preflight,
    services,
    operationRunning,
  };

  if (!appState) {
    return model({
      phase: 'loading',
      primaryAction: 'none',
      primaryLabel: '正在載入',
      status: 'neutral',
      title: '正在檢查部署狀態',
      detail: '系統正在讀取目前的部署設定。',
      why: '先確認這台主機現在的狀態，再決定下一步。',
      step: null,
      blockers: [],
      ...shared,
    });
  }

  if (operationRunning) {
    return model({
      phase: 'progress',
      primaryAction: 'host-progress',
      primaryLabel: '查看主機作業進度',
      status: 'working',
      title: '主機準備作業進行中',
      detail: '系統正在準備主機。可展開作業日誌查看目前步驟。',
      why: '下載、部署檔案準備與網路同步是主機作業，完成前請勿關閉主控台。',
      nextHint: '目標電腦的安裝進度另外顯示在「部署活動」。',
      step: null,
      blockers: [],
      ...shared,
    });
  }

  if (appState.endpointDrift === true) {
    return model({ phase: 'repair', primaryAction: 'initialization', primaryLabel: '重新確認部署網路',
      status: 'fail', title: '部署介面或 IP 已改變', detail: '請重新確認目前場地的介面、IP、DHCP、gateway 與 DNS，再同步端點並執行部署前檢查。',
      why: '舊的就緒結果已撤銷。', step: 'endpoint', blockers: [], ...shared });
  }

  if (appState.bootRequests?.length > 0) {
    return model({ phase: 'pairing', primaryAction: 'pairing', primaryLabel: '查看並核對配對碼',
      status: 'warn', title: `${appState.bootRequests.length} 台電腦等待核准`,
      detail: '核對目標電腦 WinPE 畫面與下方配對碼，確認是本次要重灌的電腦後核准。',
      why: '使用既有 DHCP 時，每次開機都需要明確授權，等待期間不提供部署憑證。',
      nextHint: '配對請求十分鐘過期；身分不符請拒絕並重新 PXE 開機。', step: null, blockers: [], ...shared });
  }
  if (initialization.initialized !== true) {
    return model({
      phase: 'setup',
      primaryAction: 'initialization',
      primaryLabel: '完成基本設定',
      status: 'neutral',
      title: '先完成部署基本設定',
      detail: '開啟逐步設定，依目前未完成的步驟繼續。',
      why: '第一次使用要先指定部署資料夾、網路位置與登入帳號。',
      nextHint: '完成後就可以選擇要安裝的 Windows。',
      step: setupStep(initialization),
      blockers: [],
      ...shared,
    });
  }

  if (!profileReady || !imageReady) {
    const missing = [!profileReady ? '部署設定' : '', !imageReady ? 'Windows 映像' : ''].filter(Boolean).join(' 與 ');
    return model({
      phase: 'content',
      primaryAction: !profileReady ? 'profiles' : 'os-images',
      primaryLabel: '選擇要安裝的內容',
      status: 'warn',
      title: '選擇要部署的內容',
      detail: `還需要設定 ${missing}，完成後才能檢查這台主機。`,
      why: '沒有部署設定與 Windows 映像，目標電腦就沒有東西可裝。',
      nextHint: '選好之後會準備主機上的部署檔案。',
      step: !profileReady ? 'profiles' : 'os-images',
      blockers: [],
      ...shared,
    });
  }

  if (!runtimeReady) {
    return model({
      phase: 'runtime',
      primaryAction: 'prepare-runtime',
      primaryLabel: '準備部署檔案',
      status: 'warn',
      title: '準備部署執行環境',
      detail: '主機缺少必要的部署檔案；準備完成後再確認這台主機能不能部署。',
      why: '主機還缺少 WinPE 與開機檔案，目標電腦現在無法從網路開機。',
      nextHint: '準備完成後會檢查這台主機。',
      step: 'runtime',
      blockers: [],
      ...shared,
    });
  }

  if (preflight.failed.length > 0) {
    return model({
      phase: 'repair',
      primaryAction: 'initialization',
      primaryLabel: '檢視問題',
      status: 'fail',
      title: '部署前檢查需要修正',
      detail: '先查看失敗項目與修正提示，修正後再重新執行檢查。',
      why: '檢查發現問題，先修好才能啟動網路開機服務。',
      nextHint: '修正後請再執行一次檢查。',
      step: 'preflight',
      blockers: preflight.failed,
      ...shared,
    });
  }

  if (!preflight.ready) {
    return model({
      phase: 'preflight',
      primaryAction: 'preflight',
      primaryLabel: '確認這台主機能部署',
      status: 'warn',
      title: '確認主機可以部署',
      detail: preflight.ran ? '目前檢查結果需要重新確認。' : '確認網路位置、部署檔案、Windows 映像與服務連接埠。',
      why: '啟動服務前必須確認網路、映像與連接埠都正確。',
      nextHint: '通過後就可以啟動網路開機服務。',
      step: 'preflight',
      blockers: [],
      ...shared,
    });
  }

  if (!services.ready) {
    return model({
      phase: 'services',
      primaryAction: 'all-services-toggle',
      primaryLabel: '啟動網路開機服務',
      status: 'warn',
      title: '啟動部署服務',
      detail: appState.config?.dhcp?.dhcpMode === 'proxy'
        ? '檢查已通過。沿用既有 DHCP 與 gateway，Winception 只提供 PXE。'
        : '檢查已通過。確認 client 網段没有其他 DHCP server，再啟動服務。',
      why: '啟動 HTTP、TFTP、DHCP 後，電腦才能從這台主機網路開機。',
      nextHint: appState.config?.dhcp?.dhcpMode === 'proxy' ? 'Client 首次連入需核對配對碼並核准。' : 'NAT 的上游 DHCP 可維持運作。',
      step: 'services',
      blockers: [],
      ...shared,
    });
  }

  return model({
    phase: 'activity',
    primaryAction: 'fleet',
    primaryLabel: '查看電腦進度',
    status: 'ok',
    title: '可以開始開機',
    detail: '把目標電腦接到這條部署網路，從 UEFI IPv4 PXE 開機。',
    why: appState.config?.dhcp?.bootMode === 'ipxe' ? '目前使用 iPXE：Secure Boot 必須關閉。' : '目前使用簽署的 Windows PXE 開機鏈：Secure Boot 可保持開啟。',
    nextHint: '開機後到「部署活動」查看每一台電腦。',
    pxeReady: true,
    step: 'activity',
    blockers: [],
    ...shared,
  });
}

/**
 * Derive the novice-facing home model from the existing server state.
 * @param {object|null} appState
 * @returns {object}
 */
export function buildBeginnerHomeModel(appState) {
  const model = primaryModel(appState);
  const counts = appState?.fleet?.counts ?? {};
  const total = appState?.fleet?.total ?? 0;
  const active = activeDeploymentCount(appState);
  model.canStopServices = active === 0;
  const initialized = appState?.initialization?.initialized === true;
  model.deploymentSummary = [
    { value: active, label: '進行中', filter: 'active', tone: active > 0 ? 'working' : '' },
    { value: counts.failed ?? 0, label: '失敗', filter: 'failed', tone: (counts.failed ?? 0) > 0 ? 'fail' : '' },
    { value: counts.completed ?? 0, label: '已完成', filter: 'done', tone: '' },
    { value: total, label: '總數', filter: 'all', tone: '' },
  ];
  model.steps = [
    {
      id: 'setup',
      status: stepStatus(initialized, model.phase === 'setup', false),
      detail: initialized ? '已完成' : model.phase === 'setup' ? '目前處理' : '待處理',
      action: 'initialization',
    },
    {
      id: 'content',
      status: stepStatus(model.profileReady && model.imageReady, model.phase === 'content', model.phase === 'content'),
      detail: model.profileReady && model.imageReady ? '已完成' : model.phase === 'content' ? '目前處理' : '待處理',
      action: !model.profileReady ? 'profiles' : 'os-images',
    },
    {
      id: 'environment',
      status: stepStatus(model.runtimeReady && model.preflight.ready, ['runtime', 'preflight', 'repair'].includes(model.phase), model.phase === 'repair'),
      detail: model.runtimeReady && model.preflight.ready ? '已完成' : model.phase === 'repair' ? '需要修正' : ['runtime', 'preflight'].includes(model.phase) ? '目前處理' : '待處理',
      action: model.phase === 'repair' ? 'initialization' : !model.runtimeReady ? 'prepare-runtime' : 'preflight',
    },
    {
      id: 'services',
      status: stepStatus(model.services.ready, model.phase === 'services' || model.phase === 'activity' || model.phase === 'progress', false),
      detail: model.services.ready ? '已完成' : model.phase === 'services' ? '目前處理' : '待處理',
      action: model.services.ready ? 'fleet' : 'all-services-toggle',
    },
  ];
  return model;
}
