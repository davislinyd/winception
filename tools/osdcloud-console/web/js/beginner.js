import { elements } from './dom.js';
import { buildBeginnerHomeModel } from './beginnerModel.js';

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
  const names = model.blockers.map((check) => check?.name).filter(Boolean).slice(0, 3);
  if (!names.length) {
    elements.beginnerBlockerSummary.hidden = true;
    elements.beginnerBlockerSummary.textContent = '';
    return;
  }
  const suffix = model.blockers.length > names.length ? `，另有 ${model.blockers.length - names.length} 項` : '';
  elements.beginnerBlockerSummary.hidden = false;
  elements.beginnerBlockerSummary.textContent = `需要處理：${names.join('、')}${suffix}`;
}


/**
 * Render the beginner-first home surface without changing server state.
 * @param {object|null} appState
 */
export function renderBeginnerHome(appState) {
  if (!elements.beginnerHome) return;
  const model = buildBeginnerHomeModel(appState);
  const statusLabels = { neutral: '待處理', warn: '需要操作', fail: '需要修正', working: '進行中', ok: '已就緒' };

  elements.beginnerOverallBadge.textContent = statusLabels[model.status] ?? '待處理';
  elements.beginnerOverallBadge.className = `status-pill ${model.status}`;
  elements.beginnerNextTitle.textContent = model.title;
  elements.beginnerNextDetail.textContent = model.detail;
  elements.beginnerPrimaryAction.textContent = model.primaryLabel;
  elements.beginnerPrimaryAction.dataset.beginnerAction = model.primaryAction;
  elements.beginnerPrimaryAction.dataset.beginnerStep = model.step ?? '';
  elements.beginnerPrimaryAction.disabled = model.phase === 'loading';
  elements.beginnerSecondaryAction.textContent = model.phase === 'setup' ? '開啟部署設定' : '查看完整檢查清單';
  elements.beginnerSecondaryAction.dataset.initializationStep = model.step ?? '';
  renderBlockers(model);

  const flowById = {
    content: elements.beginnerStepContent,
    environment: elements.beginnerStepEnvironment,
    services: elements.beginnerStepServices,
  };
  for (const step of model.steps) {
    renderFlowStep(flowById[step.id], step.status, step.detail);
  }

  if (elements.beginnerSummaryItems) {
    elements.beginnerSummaryItems.replaceChildren(...model.deploymentSummary.map((item) => makeSummaryItem(item.value, item.label, item.filter, item.tone)));
  }
}
