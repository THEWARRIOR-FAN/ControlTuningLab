// 共享曲线渲染（classic script，双击 HTML 即可运行）。
// 依赖页面脚本提供的全局状态：history、isPaused、viewStartIndex、visiblePoints、canvas、ctx。
// 页面只需提供标度（max、target）与序列定义（series），可选 yTicks 提供纵轴刻度；
// 网格、目标线、取点循环都在这里。

function renderChart(canvas, ctx, cfg) {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const start = isPaused ? viewStartIndex : Math.max(0, history.length - visiblePoints);
  const end = Math.min(history.length, start + visiblePoints);
  // 提供纵轴刻度时左侧留出标注区，网格与曲线从标注区右缘开始
  const padL = cfg.yTicks ? 30 : 0;

  ctx.clearRect(0, 0, w, h);

  // 横向网格：5 等分
  ctx.strokeStyle = "#e5e7eb";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const gy = (h / 5) * i;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }

  // 纵轴刻度（可选）：数值右对齐在标注区，顶/底两端贴边不裁切
  if (cfg.yTicks) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "10px Arial";
    ctx.textAlign = "right";
    for (const value of cfg.yTicks) {
      const vy = h - value / cfg.max * h;
      ctx.textBaseline = vy <= 8 ? "top" : vy >= h - 8 ? "bottom" : "middle";
      ctx.fillText(String(value), padL - 6, vy);
    }
  }

  // 目标线（红，实线）
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  const ty = h - cfg.target / cfg.max * h;
  ctx.moveTo(padL, ty);
  ctx.lineTo(w, ty);
  ctx.stroke();

  // 数据序列：按 max 归一化到画布高度，支持虚线样式
  for (const series of cfg.series) {
    if (series.dash) ctx.setLineDash(series.dash);
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.width || 2;
    ctx.beginPath();
    for (let i = start; i < end; i++) {
      const point = history[i];
      if (point == null) continue;
      const progress = end - start <= 1 ? 0 : (i - start) / (end - start - 1);
      const x = padL + progress * (w - padL);
      const y = h - series.value(point) / cfg.max * h;
      if (i === start) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    if (series.dash) ctx.setLineDash([]);
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart();
}
