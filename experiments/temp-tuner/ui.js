// 调温模型实验：界面——读数刷新、预设文案、控件绑定与初始化。
// 仿真状态与模型函数见 model.js，共享控件与曲线渲染在 ../../core/ 下。

    const tips = [
      "先看纯 P：Kp 偏小加热慢、静差大；偏大会超调并来回振荡。",
      "实测 Kp=4：静差 10.0 °C，到 45 °C 要 634.5 s——比例太弱，加热跟不上散热。",
      "实测 Kp=20（默认）：稳态 57.5 °C、静差 2.50 °C，加热 250 W = 散热 250 W。",
      "实测 Kp=100：超调 0.63 °C 后来回振荡，振幅 2.08 °C、周期 92 s——纯 P 太大就会振。",
      "纯 P 必须留静差才能维持功率；Ki 记住所需功率，把静差消掉，这就是它的“记忆”。",
      "同 Kp=50：Ki=0.3 静差消失、几乎无超调；Ki=1 振荡加剧（振幅 2.62 °C、周期 122 s）。",
      "I 太大容易让温度振荡加剧：积分记忆太强，修正过头就反向再来一遍。",
      "D 用于微调：同 Kp=70、Ki=0.3，Kd 0→1500 实测超调 0.81→0.00 °C、振幅 1.83→0.00 °C。",
      "本模型 20 s 指令延迟 + 6 s 加热管惯性 + 25 s 测温惯性，是 P 太大会振的根源。",
      "调参时一次只改一个参数，并观察曲线的超调量与振荡周期。",
      "积分项会累积历史误差；加热管已满负荷（积分饱和）时，退出饱和需要额外时间。",
      "「推荐 PI 参数」只是预设，不是在线自动辨识或自动整定。",
      "预测稳态静差是平衡解，不是当前误差；加 I 后预测为零仍需等待收敛。",
      "右侧「PID 拆解」公式卡实时显示每个数怎么来的，调参时盯着它看最直观。",
      "暂停后可回看温度曲线；上方读数仍显示当前状态，不是历史读数。"
    ];
    let tipIndex = 0;
    const tipElement = document.getElementById("loadingTip");
    tipElement.addEventListener("click", showNextTip);
    window.setInterval(showNextTip, 6000);

    const gaugeBoxEl = document.getElementById("gaugeBox");
    const targetLineEl = document.getElementById("targetLine");
    const targetTagEl = document.getElementById("targetTag");
    const actualLineEl = document.getElementById("actualLine");
    const actualBarEl = document.getElementById("barActual");
    const measuredBarEl = document.getElementById("barMeasured");
    const barActualValEl = document.getElementById("barActualVal");
    const barMeasuredValEl = document.getElementById("barMeasuredVal");
    const lagTagEl = document.getElementById("lagTag");
    const heaterEl = document.getElementById("heater");
    const canvas = document.getElementById("chart");
    const ctx = canvas.getContext("2d");
    const toggleRunBtn = document.getElementById("toggleRunBtn");
    const historyScrubber = document.getElementById("historyScrubber");
    const scrubberStateEl = document.getElementById("scrubberState");
    const scrubberRangeEl = document.getElementById("scrubberRange");

    function syncUI() {
      document.getElementById("setPoint").value = setPoint;
      document.getElementById("setPointVal").textContent = setPoint.toFixed(0);
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
      if (name === "pSmall") {
        kp = 4.0; ki = 0.0; kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "P 偏小（Kp=4）。预期：加热很慢，到 45 °C 要 634.5 s，最终停在 50.0 °C——静差高达 10.0 °C，比例太弱压不住散热";
      }
      if (name === "pOk") {
        kp = 20.0; ki = 0.0; kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "P 合适（Kp=20，默认）。预期：稳态 57.5 °C、静差 2.50 °C，无振荡——纯 P 永远要留一点误差（加热 250 W = 散热 250 W）";
      }
      if (name === "pLarge") {
        kp = 100.0; ki = 0.0; kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "P 偏大（Kp=100）。预期：超调 0.63 °C 后来回振荡，实测振幅 2.08 °C、周期 92 s——延迟+热惯性让大 P 失稳";
      }
      if (name === "pi") {
        kp = 50.0; ki = 0.3; kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "PI 合适（Kp=50、Ki=0.3）。预期：静差消失、贴住目标线，超调仅 0.40 °C——盯住公式卡里 I 项的累积";
      }
      if (name === "iLarge") {
        kp = 50.0; ki = 1.0; kd = 0.0;
        document.getElementById("tuneStatus").textContent =
          "I 过大（Kp=50、Ki=1）。预期：积分记忆太强，振荡比 Ki=0.3 明显加剧——实测振幅 2.62 °C、周期 122 s";
      }
      if (name === "pid") {
        kp = 70.0; ki = 0.3; kd = 1500.0;
        document.getElementById("tuneStatus").textContent =
          "PID 微调（Kp=70、Ki=0.3、Kd=1500）。预期：D 抑制升温冲刺，超调 0.00 °C；同参数去掉 D 实测超调 0.81 °C、振幅 1.83 °C";
      }

      // 预设从 20 °C 冷态重新开始，便于比较同一目标下的不同控制方式。
      syncUI();
      resetSimState();
    }

    function autoTune() {
      loadPreset("pi");
      document.getElementById("tuneStatus").textContent = "已加载当前物理模型的推荐 PI：Kp=50、Ki=0.3、Kd=0（预设，非自动整定）";
    }

    function resetSimState() {
      currentTemp = ambientTemp;
      measuredTemp = ambientTemp;
      integral = 0.0;
      lastMeasurement = ambientTemp;
      filteredDerivative = 0.0;
      valveOpen = 0.0;
      actuator = 0.0;
      peakTemp = ambientTemp;
      controlOutput = { p: 0, i: 0, d: 0, raw: 0, integrating: false };
      delayQueue = new Array(delaySteps).fill(0);
      simulationSteps = 0;
      accumulator = 0;
      lastFrameTime = null;
      history = [{ time: 0, temp: ambientTemp, measured: ambientTemp }];
      isPaused = false;
      viewStartIndex = 0;
      updateReadout();
      updateScrubberUI();
      drawChart();
    }

    function resetSystem() {
      setPoint = 60;
      kp = 20.0;
      ki = 0.0;
      kd = 0.0;
      syncUI();
      resetSimState();
      document.getElementById("tuneStatus").textContent = "已重置：所有参数恢复默认值，系统从 20 °C 冷态重新开始";
    }

    function updateTargetLine() {
      // 刻度范围 0–100 °C，目标线按比例摆放
      targetLineEl.style.bottom = setPoint + "%";
      targetTagEl.textContent = setPoint.toFixed(0);
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
      const error = setPoint - measuredTemp;
      // 双柱刻度条：橙柱 = 实际水温，蓝柱 = 测量温度（控制器所见），两柱顶差即传感器滞后
      const actualPercent = Math.max(0, Math.min(100, currentTemp));
      const measuredPercent = Math.max(0, Math.min(100, measuredTemp));
      actualBarEl.style.height = actualPercent + "%";
      measuredBarEl.style.height = measuredPercent + "%";
      actualLineEl.style.bottom = actualPercent + "%";
      barActualValEl.textContent = currentTemp.toFixed(1);
      barMeasuredValEl.textContent = measuredTemp.toFixed(1);
      lagTagEl.textContent = `传感器滞后 Δ ${(currentTemp - measuredTemp).toFixed(1)} °C`;
      // 加热管红热程度跟随实际功率
      const powerRatio = actuator / maxValve;
      heaterEl.style.background = `repeating-linear-gradient(90deg, hsl(0 ${30 + 60 * powerRatio}% ${18 + 24 * powerRatio}%) 0 10px, hsl(0 ${45 + 50 * powerRatio}% ${26 + 30 * powerRatio}%) 10px 20px)`;
      heaterEl.style.boxShadow = powerRatio > 0.02 ? `0 0 ${8 + 18 * powerRatio}px rgba(239,68,68,${0.25 + 0.55 * powerRatio})` : "none";

      document.getElementById("currentTemp").textContent = currentTemp.toFixed(1);
      document.getElementById("targetTemp").textContent = setPoint.toFixed(1);
      document.getElementById("valve").textContent = Math.round(actuator);
      document.getElementById("error").textContent = error.toFixed(2);
      document.getElementById("simTimeDisplay").textContent = (simulationSteps * dt).toFixed(1);
      document.getElementById("massDisplay").textContent = waterMass.toFixed(1);
      document.getElementById("capacityDisplay").textContent = heatCapacity.toFixed(0);

      // PID 拆解：把“误差 → 各项 → 指令 → 实际功率”这串数字直接显示出来
      const out = controlOutput;
      document.getElementById("pOutput").textContent = out.p.toFixed(1);
      document.getElementById("iOutput").textContent = out.i.toFixed(1);
      document.getElementById("dOutput").textContent = out.d.toFixed(1);
      document.getElementById("rawOutput").textContent = out.raw.toFixed(1);
      document.getElementById("commandOutput").textContent = valveOpen.toFixed(1);
      // 公式卡：把当前误差、参数、升温速度代入原始式子
      document.getElementById("fpErr").textContent = error.toFixed(3);
      document.getElementById("fpKp").textContent = kp.toFixed(1);
      document.getElementById("fpKi").textContent = ki.toFixed(2);
      document.getElementById("fpIacc").textContent = ki > 0 ? (integral / ki).toFixed(2) : "—";
      document.getElementById("fpKd").textContent = kd.toFixed(0);
      document.getElementById("fpSpeed").textContent = filteredDerivative.toFixed(3);
      const saturation = out.raw > maxValve ? "上限饱和：原始输出超过 100%，加热管按 100% 全功率"
        : out.raw < 0 ? "下限饱和：原始输出为负，加热管关闭（不能制冷）" : "未饱和";
      const integration = ki === 0 ? "Ki=0，积分关闭"
        : out.integrating ? "积分正在累积" : "抗饱和：输出已在边界，暂停向饱和方向累积";
      document.getElementById("saturationStatus").textContent = saturation + "；" + integration;
      document.getElementById("controlChain").textContent =
        `计算链：限幅指令 ${valveOpen.toFixed(1)}% 经 ${controlDelay.toFixed(0)} s 延迟与 ${heaterTimeConstant.toFixed(0)} s 加热管惯性`
        + ` → 实际功率 ${Math.round(actuator)}%`;

      // 加热与散热的平衡是理解闭环稳态的关键：加热≈散热时温度不再变化
      const heatIn = heaterMaxPower * actuator / 100;
      const heatOut = heatLoss(currentTemp);
      const netW = heatIn - heatOut;
      const balanceState = Math.abs(netW) < 1 ? "加热=散热，温度稳定"
        : netW > 0 ? `净加热 ${netW.toFixed(1)} W，温度上升`
          : `净散热 ${(-netW).toFixed(1)} W，温度下降`;
      document.getElementById("balanceLine").textContent =
        `加热 ${heatIn.toFixed(1)} W · 散热 ${heatOut.toFixed(1)} W · ${balanceState}`;

      // 仅为平衡解预测，不承诺不稳定参数能够收敛。
      document.getElementById("theoryError").textContent = steadyStateError().toFixed(2);
    }


    function drawChart() {
      renderChart(canvas, ctx, {
        max: 100,
        target: setPoint,
        series: [
          { value: point => point.temp, color: "#f97316", width: 1.5, dash: [6, 4] },
          { value: point => point.measured, color: "#2563eb", width: 2 }
        ]
      });
    }

    syncUI();
    updateReadout();
    updateScrubberUI();
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    requestAnimationFrame(loop);
