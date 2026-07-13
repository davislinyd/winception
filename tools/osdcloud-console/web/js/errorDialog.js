import { elements } from './dom.js';

const fallbackError = {
  message: 'Operation could not be completed. Check System Log and try again.',
  action: 'Check System Log and try again.',
};

export function operationErrorDetails(value) {
  if (typeof value === 'string') {
    return { ...fallbackError, message: value };
  }
  const message = String(value?.message ?? '').trim();
  const action = String(value?.action ?? '').trim();
  return {
    message: message || fallbackError.message,
    action: action || (message ? '' : fallbackError.action),
  };
}

function showDialog(dialog) {
  if (!dialog || dialog.open) {
    return;
  }
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

export function showOperationError(error) {
  const details = operationErrorDetails(error);
  elements.operationErrorTitle.textContent = 'Operation failed';
  elements.operationErrorMessage.textContent = details.message;
  elements.operationErrorAction.textContent = details.action;
  elements.operationErrorAction.hidden = !details.action;
  showDialog(elements.operationErrorDialog);
  elements.operationErrorClose?.focus();
}

export function showOperationNotice(message, action = '') {
  elements.operationErrorTitle.textContent = 'Operation complete';
  elements.operationErrorMessage.textContent = String(message ?? '');
  elements.operationErrorAction.textContent = String(action ?? '');
  elements.operationErrorAction.hidden = !action;
  showDialog(elements.operationErrorDialog);
  elements.operationErrorClose?.focus();
}
