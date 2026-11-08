// 水位调参实验：界面——读数刷新、预设文案、控件绑定与初始化。
// 仿真状态与模型函数见 model.js，共享控件与曲线渲染在 ../../core/ 下。

    const tips = [
      "先观察纯 P 的静差，再增加 I；普通水池通常用 PI 就足够。",
      "Kp 越大，静差越小：实测 50→0.39 m、200→0.14 m、1000→0.03 m。",
      "本模型纯 P 拉满 Kp=1000 也不会振荡——临界增益实测约 50 万，上限只有它的 1/500。",
      "纯 P 控制必然留下静差；Ki 就是记住所需阀位、把静差消掉的“记忆项”。",
      "Ki 不宜一次加太多：实测 Kp=200 时超调在 Ki≈2 达到峰值（约 109 mm）。",
      "Kd 要到几千才有可见作用（水位速度只有约 0.002 m/s），小了完全无感。",
      "实测：本模型加大 Kd 反而让超调变大——D 拖慢接近速度，积分积累更多。原因值得思考。",
      "调参时一次只改一个参数，并观察响应曲线的超调量与稳定时间。",
      "积分项会累积历史误差，若阀门已达上限（积分饱和），退出饱和需要额外时间。",
      "Kp 接于 0 属于纯 I 控制，实测会持续振荡；出现振荡先确认 Kp > 0。",
      "「推荐 PI 参数」只是预设，不是在线自动辨识或自动整定。",
      "预测稳态静差是平衡解，不是当前误差；加 I 后预测为零仍需要等待系统收敛。",
      "调节目标液位后，记录新稳态的到达时间，对比不同参数下的响应速度。",
      "水池截面积越大，相同净流量引起的水位变化越慢。",
      "右侧「PID 拆解」公式卡实时显示每个数怎么来的，调参时盯着它看最直观。",
      "暂停后可回看水位曲线；上方读数仍显示当前状态，不是历史读数。"
    ];
    let tipIndex = 0;
    const tipElement = document.getElementById("loadingTip");
    tipElement.addEventListener("click", showNextTip);
    window.setInterval(showNextTip, 6000);

    const waterEl = document.getElementById("water");
    const targetLineEl = document.getElementById("targetLine");
    const inletStreamEl = document.getElementById("inletStream");
    const outletStreamEl = document.getElementById("outletStream");
    const poolBoxEl = document.querySelector(".pool-box");
    const drainPoolEl = document.querySelector(".drain-pool");
    const canvas = document.getElementById("chart");
    const ctx = canvas.getContext("2d");
    const toggleRunBtn = document.getElementById("toggleRunBtn");
    const historyScrubber = document.getElementById("historyScrubber");
    const scrubberStateEl = document.getElementById("scrubberState");
    const scrubberRangeEl = document.getElementById("scrubberRange");

    function syncUI() {
      document.getElementById("setPoint").value = setPoint;
      document.getElementById("setPointVal").textContent = setPoint.toFixed(1);
      document.getElementById("kp").value = kp / kpScale;
      document.getElementById("kpVal").textContent = Math.round(kp / kpScale);
      document.getElementById("ki").value = ki / kiScale;
      document.getElementById("kiVal").textContent = Math.round(ki / kiScale);
      document.getElementById("kd").value = kd / kdScale;
      document.getElementById("kdVal").textContent = Math.round(kd / kdScale);
      updateTargetLine();
      updateReadout();
      drawChart();
    }

    function loadPreset(name) {
      if (name === "pOnly") {
        kp = 200.0;
        ki = 0.0;
        kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "P 模式（Kp=200）。预期：稳定在约 0.459 m，静差约 0.141 m——纯 P 必须留误差才能维持进水";
      }
      if (name === "pi") {
        kp = 200.0;
        ki = 0.2;
        kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "PI 模式（Kp=200、Ki=0.2）。预期：静差消失、水位贴住红线，几乎无超调；盯住公式卡里 I 项的累积";
      }
      if (name === "pid") {
        kp = 200.0;
        ki = 0.2;
        kd = 20000.0;
        document.getElementById("tuneStatus").textContent =
          "PID 模式（与 PI 预设仅差 D 项，Kd=20000）。预期：超调反而多约 20 mm——D 拖慢接近速度、积分积累更多，实测与教科书印象相反，值得思考";
      }

      // 预设从空槽重新开始，便于比较同一目标下的不同控制方式。
      syncUI();
      resetSimState();
    }

    function autoTune() {
      loadPreset("pi");
      document.getElementById("tuneStatus").textContent = "已加载当前物理模型的推荐 PI：Kp=200、Ki=0.2、Kd=0（预设，非自动整定）";
    }

    function resetSimState() {
      currentLevel = 0.0;
      integral = 0.0;
      lastMeasurement = 0.0;
      filteredDerivative = 0.0;
      valveOpen = 0.0;
      actuator = 0.0;
      controlOutput = { p: 0, i: 0, d: 0, raw: 0, integrating: false };
      delayQueue = new Array(delaySteps).fill(0);
      simulationSteps = 0;
      overflowVolume = 0;
      accumulator = 0;
      lastFrameTime = null;
      history = [{ time: 0, level: 0 }];
      isPaused = false;
      viewStartIndex = 0;
      poolBoxEl.classList.remove("is-paused");
      updateReadout();
      updateScrubberUI();
      drawChart();
    }

    function resetSystem() {
      setPoint = 0.6;
      kp = 200.0;
      ki = 0.0;
      kd = 0.0;
      syncUI();
      resetSimState();
      document.getElementById("tuneStatus").textContent = "已重置：所有参数恢复默认值，系统从空槽重新开始";
    }

    function updateTargetLine() {
      targetLineEl.style.bottom = (setPoint / tankHeight * 100) + "%";
    }

    // 调参不重启系统：参数改动即时生效，系统从当前状态继续响应，便于观察过渡过程
    document.getElementById("setPoint").oninput = function () {
      setPoint = parseFloat(this.value);
      syncUI();
    };

    document.getElementById("kp").oninput = function () {
      kp = parseFloat(this.value) * kpScale;
      syncUI();
    };

    document.getElementById("ki").oninput = function () {
      ki = parseFloat(this.value) * kiScale;
      syncUI();
    };

    document.getElementById("kd").oninput = function () {
      kd = parseFloat(this.value) * kdScale;
      syncUI();
    };

    toggleRunBtn.addEventListener("click", function () {
      isPaused = !isPaused;
      lastFrameTime = null;
      if (!isPaused) {
        viewStartIndex = getLatestViewStart();
      }
      poolBoxEl.classList.toggle("is-paused", isPaused);
      updateScrubberUI();
      drawChart();
    });

    document.getElementById("simulationSpeed").addEventListener("change", function () {
      simulationSpeed = Number(this.value);
      lastFrameTime = null;
    });

    // 后台页面停止推进仿真，避免回到页面时突然补算很长时间。
    document.addEventListener("visibilitychange", function () {
      lastFrameTime = null;
    });

    historyScrubber.addEventListener("input", function () {
      viewStartIndex = parseInt(this.value, 10) || 0;
      updateScrubberUI();
      drawChart();
    });

    function updateReadout() {
      const error = setPoint - currentLevel;
      const waterPercent = currentLevel / tankHeight * 100;
      waterEl.style.height = waterPercent + "%";
      waterEl.classList.toggle("has-water", currentLevel > 0.002);
      document.getElementById("currentLv").textContent = currentLevel.toFixed(2);
      document.getElementById("targetLv").textContent = setPoint.toFixed(2);
      document.getElementById("valve").textContent = Math.round(actuator);
      document.getElementById("error").textContent = error.toFixed(2);
      document.getElementById("simTimeDisplay").textContent = (simulationSteps * dt).toFixed(1);
      document.getElementById("volumeDisplay").textContent = (currentLevel * tankArea * 1000).toFixed(1);
      document.getElementById("overflowDisplay").textContent = (overflowVolume * 1000).toFixed(1);

      // PID 拆解：把“误差 → 各项 → 指令 → 实际阀位”这串数字直接显示出来
      const out = controlOutput;
      document.getElementById("pOutput").textContent = out.p.toFixed(1);
      document.getElementById("iOutput").textContent = out.i.toFixed(1);
      document.getElementById("dOutput").textContent = out.d.toFixed(1);
      document.getElementById("rawOutput").textContent = out.raw.toFixed(1);
      document.getElementById("commandOutput").textContent = valveOpen.toFixed(1);
      // 公式卡：把当前误差、参数、水位速度代入原始式子
      document.getElementById("fpErr").textContent = error.toFixed(3);
      document.getElementById("fpKp").textContent = kp.toFixed(1);
      document.getElementById("fpKi").textContent = ki.toFixed(2);
      document.getElementById("fpIacc").textContent = ki > 0 ? (integral / ki).toFixed(2) : "—";
      document.getElementById("fpKd").textContent = kd.toFixed(0);
      document.getElementById("fpSpeed").textContent = filteredDerivative.toFixed(3);
      const saturation = out.raw > maxValve ? "上限饱和：原始输出超过 100%，阀门按 100% 打开"
        : out.raw < 0 ? "下限饱和：原始输出为负，阀门按 0% 关闭（不能反向抽水）" : "未饱和";
      const integration = ki === 0 ? "Ki=0，积分关闭"
        : out.integrating ? "积分正在累积" : "抗饱和：输出已在边界，暂停向饱和方向累积";
      document.getElementById("saturationStatus").textContent = saturation + "；" + integration;
      document.getElementById("controlChain").textContent =
        `计算链：限幅指令 ${valveOpen.toFixed(1)}% 经 ${controlDelay.toFixed(2)} s 延迟与阀门动作`
        + ` → 实际阀位 ${Math.round(actuator)}%`;

      // 进/出水动画强度跟随当前阀门开度与水位
      const poolHeight = poolBoxEl.clientHeight;
      const valveRatio = actuator / maxValve;
      const inflow = maxInflow * valveRatio;
      const outflow = outletFlow(currentLevel);
      // 进出水平衡是理解闭环稳态的关键：进≈出时水位不再变化
      const netLps = (inflow - outflow) * 1000;
      const balanceState = Math.abs(netLps) < 0.005 ? "进出平衡，水位稳定"
        : netLps > 0 ? `净进 ${netLps.toFixed(3)} L/s，水位上升`
          : `净出 ${(-netLps).toFixed(3)} L/s，水位下降`;
      document.getElementById("balanceLine").textContent =
        `进水 ${(inflow * 1000).toFixed(3)} L/s · 出水 ${(outflow * 1000).toFixed(3)} L/s · ${balanceState}`;
      const inletRatio = valveRatio;
      const outletRatio = Math.min(1, outflow / outletFlow(tankHeight));

      // 进水流长度精确接到当前水面（起点距池顶16px）
      const surfaceY = poolHeight * (1 - currentLevel / tankHeight);
      const inletHeight = Math.max(0, surfaceY - 16);
      inletStreamEl.style.height = inletHeight.toFixed(1) + "px";
      inletStreamEl.style.width = (8 + inletRatio * 10).toFixed(1) + "px";
      inletStreamEl.style.opacity = inletRatio > 0.01 ? String(0.4 + inletRatio * 0.6) : "0";

      // 出水流长度接到接水槽（槽顶距池底约70px），粗细随出水量变化
      const outletHeight = 46;
      outletStreamEl.style.height = outletHeight.toFixed(1) + "px";
      outletStreamEl.style.width = (6 + outletRatio * 8).toFixed(1) + "px";
      outletStreamEl.style.opacity = outletRatio > 0.01 ? String(0.4 + outletRatio * 0.6) : "0";
      drainPoolEl.classList.toggle("is-receiving", outletRatio > 0.01);

      // 仅为平衡解预测，不承诺不稳定参数能够收敛。
      document.getElementById("theoryError").textContent = steadyStateError().toFixed(3);
    }


    function drawChart() {
      renderChart(canvas, ctx, {
        max: tankHeight,
        target: setPoint,
        series: [{ value: point => point.level, color: "#2563eb", width: 2 }]
      });
    }

    syncUI();
    updateReadout();
    updateScrubberUI();
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    requestAnimationFrame(loop);
