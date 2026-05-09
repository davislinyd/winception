export const minimumTerminalSize = {
  columns: 118,
  rows: 32,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function box(top, left, width, height) {
  return { top, left, width, height, hidden: false };
}

export function computeLayout(columns, rows) {
  const width = Math.max(0, Number(columns) || 0);
  const height = Math.max(0, Number(rows) || 0);

  if (width < minimumTerminalSize.columns || height < minimumTerminalSize.rows) {
    return {
      tooSmall: true,
      minimum: minimumTerminalSize,
      title: box(0, 0, Math.max(width, 1), Math.min(height, 3)),
      warning: box(3, 0, Math.max(width, 1), Math.max(height - 3, 1)),
    };
  }

  const titleHeight = 3;
  const menuWidth = width >= 150 ? 34 : 30;
  const mainLeft = menuWidth;
  const mainWidth = width - menuWidth;
  const contentHeight = height - titleHeight;

  let topHeight = clamp(Math.round(contentHeight * 0.24), 9, 13);
  let middleHeight = clamp(Math.round(contentHeight * 0.34), 8, 18);
  let logHeight = contentHeight - topHeight - middleHeight;

  if (logHeight < 8) {
    const middleReduction = Math.min(middleHeight - 8, 8 - logHeight);
    middleHeight -= Math.max(0, middleReduction);
    logHeight = contentHeight - topHeight - middleHeight;
  }

  if (logHeight < 8) {
    const topReduction = Math.min(topHeight - 9, 8 - logHeight);
    topHeight -= Math.max(0, topReduction);
    logHeight = contentHeight - topHeight - middleHeight;
  }

  const firstPaneMax = Math.min(66, mainWidth - 44);
  const firstPaneWidth = clamp(Math.round(mainWidth * 0.38), 44, firstPaneMax);
  const secondPaneWidth = mainWidth - firstPaneWidth;
  const middleTop = titleHeight + topHeight;
  const logTop = middleTop + middleHeight;

  return {
    tooSmall: false,
    minimum: minimumTerminalSize,
    title: box(0, 0, width, titleHeight),
    warning: { ...box(0, 0, 1, 1), hidden: true },
    menu: box(titleHeight, 0, menuWidth, contentHeight),
    services: box(titleHeight, mainLeft, firstPaneWidth, topHeight),
    deployment: box(titleHeight, mainLeft + firstPaneWidth, secondPaneWidth, topHeight),
    preflight: box(middleTop, mainLeft, firstPaneWidth, middleHeight),
    validation: box(middleTop, mainLeft + firstPaneWidth, secondPaneWidth, middleHeight),
    logs: box(logTop, mainLeft, mainWidth, logHeight),
  };
}
