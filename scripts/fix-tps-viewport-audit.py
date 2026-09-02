from pathlib import Path

p = Path('scripts/capture-tps-visual-audit.mjs')
text = p.read_text()
old = '''  // Capture a deterministic iPhone-landscape CSS viewport. Window-rect resizing
  // is runner/decoration dependent in headless Chrome, so drive the CSS viewport
  // directly through Chrome DevTools device metrics instead.
  await command(`/session/${sessionId}/goog/cdp/execute`, "POST", {
    cmd: "Emulation.setDeviceMetricsOverride",
    params: { width: 932, height: 430, deviceScaleFactor: 1, mobile: false },
  });
  await delay(300);
  const iphone = await state(sessionId);
  if (!(iphone?.canvasWidth >= 900 && iphone?.canvasWidth <= 950 && iphone?.canvasHeight >= 400 && iphone?.canvasHeight <= 450)) {
    throw new Error(`TPS iPhone viewport probe is outside the expected range: "${JSON.stringify(iphone)}"`);
  }
  await screenshot(sessionId, `${outputDir}/tps-iphone-idle.png`);
  await command(`/session/${sessionId}/goog/cdp/execute`, "POST", {
    cmd: "Emulation.clearDeviceMetricsOverride",
    params: {},
  });
  await delay(300);
'''
new = '''  // Capture a deterministic iPhone-landscape CSS viewport. Recent headless
  // Chrome builds may accept CDP device metrics without changing window.inner*
  // (and therefore without notifying the Three.js ResizeObserver). Resize the
  // real WebDriver window instead, compensating for runner window decorations.
  const desktopRect = await command(`/session/${sessionId}/window/rect`);
  let iphone = null;
  let iphoneWindow = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    iphoneWindow = await execute(sessionId, `return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      dpr: window.devicePixelRatio,
    };`);
    const chromeWidth = Math.max(0, iphoneWindow.outerWidth - iphoneWindow.innerWidth);
    const chromeHeight = Math.max(0, iphoneWindow.outerHeight - iphoneWindow.innerHeight);
    await command(`/session/${sessionId}/window/rect`, "POST", {
      width: Math.round(932 + chromeWidth),
      height: Math.round(430 + chromeHeight),
    });
    await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
    await delay(350);
    iphone = await state(sessionId);
    if (iphone?.canvasWidth >= 900 && iphone?.canvasWidth <= 950 && iphone?.canvasHeight >= 400 && iphone?.canvasHeight <= 450) break;
  }
  if (!(iphone?.canvasWidth >= 900 && iphone?.canvasWidth <= 950 && iphone?.canvasHeight >= 400 && iphone?.canvasHeight <= 450)) {
    throw new Error(`TPS iPhone viewport probe is outside the expected range: ${JSON.stringify({ iphone, iphoneWindow, desktopRect })}`);
  }
  await screenshot(sessionId, `${outputDir}/tps-iphone-idle.png`);
  await command(`/session/${sessionId}/window/rect`, "POST", desktopRect);
  await execute(sessionId, `window.dispatchEvent(new Event('resize')); return true;`);
  await delay(300);
'''
if old not in text:
    raise SystemExit('viewport patch target not found')
p.write_text(text.replace(old, new, 1))
print('patched deterministic TPS viewport audit')
