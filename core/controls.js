// 共享控件逻辑（classic script，双击 HTML 即可运行）。
// 依赖页面脚本提供的全局：参数（setPoint/kp/ki/kd 与各自 Scale）、仿真状态
// （history/isPaused/viewStartIndex/visiblePoints/accumulator/simulationSpeed/dt）、
// 控件元素（historyScrubber/toggleRunBtn/scrubberStateEl/scrubberRangeEl）与
// 页面函数（syncUI/pidControl/updateReadout/drawChart）。
// 页面在最后统一调用事件绑定，函数在调用时才解析这些全局，因此脚本加载顺序不受限制。

function roundToStep(v, step) {
  return Math.round(v / step) * step;
}

function adjustParam(name, delta) {
  const input = document.getElementById(name);
  const step = parseFloat(input.step) || 0.1;
  let value = roundToStep(parseFloat(input.value) + delta, step);
  value = Math.max(parseFloat(input.min), Math.min(parseFloat(input.max), value));

  if (name === "setPoint") setPoint = value;
  if (name === "kp") kp = value * kpScale;
  if (name === "ki") ki = value * kiScale;
  if (name === "kd") kd = value * kdScale;

  // 微调同样不重启系统，参数即时生效
  syncUI();
}

function getLatestViewStart() {
  return Math.max(0, history.length - visiblePoints);
}

function formatTime(index) {
  return (history[index]?.time || 0).toFixed(1) + "s";
}

function updateScrubberUI() {
  const maxStart = getLatestViewStart();
  if (!isPaused) {
    viewStartIndex = maxStart;
  } else {
    viewStartIndex = Math.max(0, Math.min(viewStartIndex, maxStart));
  }

  historyScrubber.max = String(maxStart);
  historyScrubber.value = String(viewStartIndex);
  historyScrubber.disabled = !isPaused || maxStart === 0;
  toggleRunBtn.textContent = isPaused ? "启动" : "暂停";
  scrubberStateEl.textContent = isPaused ? "已暂停：可拖动滑块回看" : "运行中：显示最新曲线";

  if (history.length === 0) {
    scrubberRangeEl.textContent = "0.0s - 0.0s";
    return;
  }

  const endIndex = Math.min(history.length, viewStartIndex + visiblePoints);
  scrubberRangeEl.textContent = formatTime(viewStartIndex) + " - " + formatTime(endIndex - 1);
}

// 固定步长推进仿真，渲染只做一次；积压保留到后续帧，不把大步长传入物理模型。
function loop(timestamp) {
  if (lastFrameTime !== null && !isPaused && !document.hidden) {
    accumulator += (timestamp - lastFrameTime) / 1000 * simulationSpeed;
    let steps = 0;
    while (accumulator >= dt && steps < 2400) {
      pidControl();
      accumulator -= dt;
      steps++;
    }
  }
  lastFrameTime = timestamp;
  updateReadout();
  updateScrubberUI();
  drawChart();
  requestAnimationFrame(loop);
}

// 调参小贴士轮播：tips 数组与 tipIndex/tipElement 由页面提供
function showNextTip() {
  tipElement.classList.add("is-changing");
  window.setTimeout(() => {
    tipIndex = (tipIndex + 1) % tips.length;
    tipElement.textContent = `调参小贴士：${tips[tipIndex]}`;
    tipElement.classList.remove("is-changing");
  }, 250);
}
