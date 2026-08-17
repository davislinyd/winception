import { state } from './state.js';

const SERVICE_KEYS = ['http', 'tftp', 'dhcp'];

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

function primaryModel(appState) {
  const initialization = appState?.initialization ?? {};
  const profileReady = Boolean(appState?.profile?.activeProfile) && !appState?.profile?.error;
  const imageReady = Boolean(appState?.osImage?.activeImage?.cached) && !appState?.osImage?.error;
  const runtimeReady = appState?.runtime?.ready === true;
  const preflight = preflightState(appState);
  const services = servicesState(appState);
  const operationRunning = appState?.operation?.running === true || Boolean(state.initializationPendingAction);

  if (!appState) {
    return {
      phase: 'loading',
      primaryAction: 'none',
      primaryLabel: '正在載入',
      status: 'neutral',
      title: '正在檢查部署狀態',
      detail: '系統正在讀取目前的部署設定。',
      step: null,
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (operationRunning) {
    return {
      phase: 'progress',
      primaryAction: 'fleet',
      primaryLabel: '查看進度',
      status: 'working',
      title: '部署正在進行',
      detail: appState.operation?.label || '系統正在執行部署操作。',
      step: null,
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (initialization.initialized !== true) {
    return {
      phase: 'setup',
      primaryAction: 'initialization',
      primaryLabel: '完成基本設定',
      status: 'neutral',
      title: '先完成部署基本設定',
      detail: `下一步：${initialization.steps?.find((item) => item.id === setupStep(initialization))?.label ?? '部署設定'}。`,
      step: setupStep(initialization),
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (!profileReady || !imageReady) {
    const missing = [!profileReady ? 'Profile' : '', !imageReady ? 'OS Image' : ''].filter(Boolean).join(' 與 ');
    return {
      phase: 'content',
      primaryAction: !profileReady ? 'profiles' : 'os-images',
      primaryLabel: '選擇部署內容',
      status: 'warn',
      title: '選擇要部署的內容',
      detail: `還需要設定 ${missing}，完成後才能進行環境檢查。`,
      step: !profileReady ? 'profiles' : 'os-images',
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (!runtimeReady) {
    return {
      phase: 'runtime',
      primaryAction: 'prepare-runtime',
      primaryLabel: '準備執行環境',
      status: 'warn',
      title: '準備部署執行環境',
      detail: '主機缺少必要的部署檔案；準備完成後再執行 Preflight。',
      step: 'runtime',
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (preflight.failed.length > 0) {
    return {
      phase: 'repair',
      primaryAction: 'initialization',
      primaryLabel: '檢視問題',
      status: 'fail',
      title: '部署前檢查需要修正',
      detail: '先查看失敗項目與修正提示，修正後再重新執行 Preflight。',
      step: 'preflight',
      blockers: preflight.failed,
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (!preflight.ready) {
    return {
      phase: 'preflight',
      primaryAction: 'preflight',
      primaryLabel: '執行部署前檢查',
      status: 'warn',
      title: '確認主機可以部署',
      detail: preflight.ran ? '目前檢查結果需要重新確認。' : '確認 Endpoint、Runtime、OS Image、Profile 與服務連接埠。',
      step: 'preflight',
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  if (!services.ready) {
    return {
      phase: 'services',
      primaryAction: 'all-services-toggle',
      primaryLabel: '啟動部署服務',
      status: 'warn',
      title: '啟動部署服務',
      detail: 'Preflight 已通過。確認測試網路的 DHCP 安全條件後，再啟動服務。',
      step: 'services',
      blockers: [],
      profileReady,
      imageReady,
      runtimeReady,
      preflight,
      services,
      operationRunning,
    };
  }

  return {
    phase: 'activity',
    primaryAction: 'fleet',
    primaryLabel: '查看部署活動',
    status: 'ok',
    title: '部署服務已就緒',
    detail: '可以啟動 Client，並在部署活動中查看進度與證據。',
    step: 'activity',
    blockers: [],
    profileReady,
    imageReady,
    runtimeReady,
    preflight,
    services,
    operationRunning,
  };
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
  model.deploymentSummary = [
    { value: counts.running ?? 0, label: '進行中', filter: 'active', tone: (counts.running ?? 0) > 0 ? 'working' : '' },
    { value: counts.failed ?? 0, label: '失敗', filter: 'failed', tone: (counts.failed ?? 0) > 0 ? 'fail' : '' },
    { value: counts.completed ?? 0, label: '已完成', filter: 'done', tone: '' },
    { value: total, label: '總數', filter: 'all', tone: '' },
  ];
  model.steps = [
    {
      id: 'content',
      status: stepStatus(model.profileReady && model.imageReady, model.phase === 'setup' || model.phase === 'content', model.phase === 'content'),
      detail: model.profileReady && model.imageReady ? '已完成' : model.phase === 'content' ? '目前處理' : '待處理',
    },
    {
      id: 'environment',
      status: stepStatus(model.runtimeReady && model.preflight.ready, ['runtime', 'preflight', 'repair'].includes(model.phase), model.phase === 'repair'),
      detail: model.runtimeReady && model.preflight.ready ? '已完成' : model.phase === 'repair' ? '需要修正' : ['runtime', 'preflight'].includes(model.phase) ? '目前處理' : '待處理',
    },
    {
      id: 'services',
      status: stepStatus(model.services.ready, model.phase === 'services' || model.phase === 'activity' || model.phase === 'progress', false),
      detail: model.services.ready ? '已完成' : model.phase === 'services' ? '目前處理' : '待處理',
    },
  ];
  return model;
}
