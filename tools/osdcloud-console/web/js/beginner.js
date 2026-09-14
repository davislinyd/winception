import { elements } from './dom.js';
import { buildBeginnerHomeModel } from './beginnerModel.js';
import { renderBootRequests } from './onboarding.js';

export { buildBeginnerHomeModel } from './beginnerModel.js';

function makeSummaryItem(value, label, filter, tone = '') {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = `beginner-summary-item ${tone}`.trim();
  item.dataset.goto = 'activity';
  item.dataset.fleetFilter = filter;
  const number = document.createElement('strong');
  number.textContent = String(value);
  const caption = document.createElement('span');
  caption.textContent = label;
  item.append(number, caption);
  return item;
}

function renderFlowStep(element, status, detail) {
  if (!element) return;
  element.classList.remove('complete', 'current', 'blocked', 'waiting');
  element.classList.add(status);
  const statusElement = element.querySelector('.beginner-flow-status');
  if (statusElement) {
    statusElement.textContent = detail;
  }
}

function renderBlockers(model) {
  if (!elements.beginnerBlockerSummary) return;
  const blockers = model.blockers.filter((check) => check?.name);
  if (!blockers.length) {
    elements.beginnerBlockerSummary.hidden = true;
    elements.beginnerBlockerSummary.replaceChildren();
    return;
  }
  elements.beginnerBlockerSummary.hidden = false;
  const cards = blockers.slice(0, 3).map((check) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'beginner-blocker-card';
    button.dataset.action = 'initialization';
    button.dataset.initializationStep = 'preflight';
    const title = document.createElement('strong');
    title.textContent = check.name;
    button.append(title);
    if (check.detail) {
      const detail = document.createElement('span');
      detail.textContent = check.detail;
      button.append(detail);
    }
    return button;
  });
  if (blockers.length > 3) {
    const extra = document.createElement('p');
    extra.className = 'beginner-blocker-more';
    extra.textContent = `另有 ${blockers.length - 3} 項需要處理`;
    cards.push(extra);
  }
  elements.beginnerBlockerSummary.replaceChildren(...cards);
}

/**
 * Render the beginner-first home surface without changing server state.
 * @param {object|null} appState
 */
export function renderBeginnerHome(appState) {
  if (!elements.beginnerHome) return;
  const model = buildBeginnerHomeModel(appState);
  renderBootRequests(appState);
  const wiring = document.getElementById('beginner-wiring-instruction');
  if (wiring) wiring.textContent = appState?.config?.network?.topology === 'dual-nic-nat'
    ? `目標電腦直接或經交換器接到筆電的 ${appState.config.network.nat?.pxeInterfaceAlias || 'Client 接線介面'}。`
    : `目標電腦與筆電的 ${appState?.config?.adapter?.interfaceAlias || '服務介面'} 接到同一 LAN／交換器。`;
  const stop = document.getElementById('beginner-stop-services');
  if (stop) {
    stop.disabled = !model.canStopServices;
    stop.title = model.canStopServices ? '' : '仍有電腦部署或等待 Windows 登入，請確認完成後再停止服務。';
  }
  const instruction = document.getElementById('beginner-boot-instruction');
  if (instruction) instruction.textContent = appState?.config?.dhcp?.bootMode === 'ipxe'
    ? '目前使用 iPXE：目標電腦的 Secure Boot 必須關閉；TPM 是獨立的韌體設定。'
    : '目前使用簽署的 Windows PXE 開機鏈：Secure Boot 可維持開啟；TPM 是獨立的韌體設定。';
  const statusLabels = { neutral: '待處理', warn: '需要操作', fail: '需要修正', working: '進行中', ok: '已就緒' };

  elements.beginnerOverallBadge.textContent = statusLabels[model.status] ?? '待處理';
  elements.beginnerOverallBadge.className = `status-pill ${model.status}`;
  elements.beginnerNextTitle.textContent = model.title;
  elements.beginnerNextDetail.textContent = model.detail;
  if (elements.beginnerWhy) {
    elements.beginnerWhy.textContent = model.why;
    elements.beginnerWhy.hidden = !model.why;
  }
  if (elements.beginnerNextHint) {
    elements.beginnerNextHint.textContent = model.nextHint;
    elements.beginnerNextHint.hidden = !model.nextHint;
  }
  elements.beginnerPrimaryAction.textContent = model.primaryLabel;
  elements.beginnerPrimaryAction.dataset.beginnerAction = model.primaryAction;
  elements.beginnerPrimaryAction.dataset.beginnerStep = model.step ?? '';
  elements.beginnerPrimaryAction.disabled = model.phase === 'loading';

  if (model.phase === 'setup') {
    elements.beginnerSecondaryAction.textContent = '開啟逐步設定';
    elements.beginnerSecondaryAction.dataset.action = 'initialization';
    elements.beginnerSecondaryAction.dataset.initializationStep = model.step ?? '';
    delete elements.beginnerSecondaryAction.dataset.operatorMode;
  } else if (model.pxeReady) {
    elements.beginnerSecondaryAction.textContent = '切換到控制台';
    elements.beginnerSecondaryAction.dataset.action = 'operator-mode';
    elements.beginnerSecondaryAction.dataset.operatorMode = 'console';
    delete elements.beginnerSecondaryAction.dataset.initializationStep;
  } else {
    elements.beginnerSecondaryAction.textContent = '這一步在做什麼';
    elements.beginnerSecondaryAction.dataset.action = 'initialization';
    elements.beginnerSecondaryAction.dataset.initializationStep = model.step ?? '';
    delete elements.beginnerSecondaryAction.dataset.operatorMode;
  }
  renderBlockers(model);

  if (elements.beginnerPxeCard) {
    elements.beginnerPxeCard.hidden = !model.pxeReady;
  }

  const flowById = {
    setup: elements.beginnerStepSetup,
    content: elements.beginnerStepContent,
    environment: elements.beginnerStepEnvironment,
    services: elements.beginnerStepServices,
  };
  for (const step of model.steps) {
    const node = flowById[step.id];
    renderFlowStep(node, step.status, step.detail);
    if (node) {
      node.dataset.beginnerAction = step.action;
      node.dataset.beginnerStep = step.id === 'setup' ? 'project-root' : model.step ?? '';
    }
  }

  if (elements.beginnerSummaryItems) {
    elements.beginnerSummaryItems.replaceChildren(...model.deploymentSummary.map((item) => makeSummaryItem(item.value, item.label, item.filter, item.tone)));
  }
}
