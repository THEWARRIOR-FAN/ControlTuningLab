// 调温模型实验：仿真模型——物理常量、状态变量与 PID 控制回路。
// 本文件不访问 DOM；界面逻辑在 ui.js，共享控件与曲线渲染在 ../../core/ 下。

    let setPoint = 60;
    let kp = 20.0;
    let ki = 0.0;
    let kd = 0.0;
    // 三个滑块统一显示 0–100 的控制比例；仿真仍使用各自的物理参数范围。
    const kpScale = 2;    // 比例 100 → 内部 Kp 200
    const kiScale = 0.05; // 比例 100 → 内部 Ki 5
    const kdScale = 30;   // 比例 100 → 内部 Kd 3000

    let currentTemp = 20.0;   // 实际水温
    let measuredTemp = 20.0;  // 传感器测量温度（控制器只看这个）
    let integral = 0.0;
    let valveOpen = 0.0;      // 限幅后的加热指令 %
    let actuator = 0.0;       // 实际加热管功率 %
    let peakTemp = 20.0;      // 本次运行的最高水温，用于算超调
    // 本步 PID 计算的拆解结果，供界面展示“这个数是怎么来的”
    let controlOutput = { p: 0, i: 0, d: 0, raw: 0, integrating: false };

    // 物理计算使用 kg、s、J、°C；界面把功率显示为 W 与 %。
    const dt = 0.1;               // 固定物理步长，不随显示帧率或倍速变化
    const ambientTemp = 20;       // 环境温度 °C
    const heaterMaxPower = 500;   // 加热管最大功率 W
    const waterMass = 2.0;        // 水质量 kg
    const specificHeat = 4186;    // 水比热容 J/(kg·°C)
    const heatCapacity = waterMass * specificHeat; // 8372 J/K
    const thermalResistance = 0.15;      // 热阻 K/W
    const heaterTimeConstant = 6;        // 加热管一阶惯性 s
    const sensorTimeConstant = 25;       // 测温传感器一阶惯性 s
    const controlDelay = 20;             // 控制指令纯滞后 s
    const delaySteps = Math.round(controlDelay / dt);
    const maxValve = 100;
    const derivativeTimeConstant = 4;    // 测量微分低通时间常数 s
    const historyInterval = 1;           // 每个仿真秒保存一个温度点
    const historySteps = Math.round(historyInterval / dt);
    const visiblePoints = 601;           // 显示最近 10 分钟
    const maxStoredPoints = 7201;
    let simulationSteps = 0;
    let simulationSpeed = 50;
    let accumulator = 0;
    let lastFrameTime = null;

    let lastMeasurement = 20.0;
    let filteredDerivative = 0.0;

    let delayQueue = new Array(delaySteps).fill(0);
    let history = [{ time: 0, temp: 20, measured: 20 }];
    let isPaused = false;
    let viewStartIndex = 0;

    function heatLoss(temp) {
      return Math.max(0, temp - ambientTemp) / thermalResistance;
    }

    function steadyStateError() {
      if (ki > 0) {
        // 积分能保持所需功率；若满功率仍不够，只能达到 95 °C 的极限平衡温度。
        const maxTemp = ambientTemp + heaterMaxPower * thermalResistance;
        return Math.max(0, setPoint - maxTemp);
      }
      // 纯 P：求 500 × clamp(Kp×(目标−T),0,100)/100 = heatLoss(T)。
      let low = ambientTemp;
      let high = ambientTemp + heaterMaxPower * thermalResistance + 40;
      for (let i = 0; i < 60; i++) {
        const temp = (low + high) / 2;
        const command = Math.max(0, Math.min(maxValve, kp * (setPoint - temp)));
        if (heaterMaxPower * command / maxValve > heatLoss(temp)) low = temp;
        else high = temp;
      }
      return setPoint - (low + high) / 2;
    }

    function pidControl() {
      // 控制器只看测量温度；微分也作用在测量值上
      const error = setPoint - measuredTemp;
      const measurementDerivative = (measuredTemp - lastMeasurement) / dt;
      const derivativeAlpha = 1 - Math.exp(-dt / derivativeTimeConstant);
      filteredDerivative += derivativeAlpha * (measurementDerivative - filteredDerivative);

      // integral 直接存积分输出（%）。条件积分：饱和时不继续向饱和方向累积。
      const candidateIntegral = integral + ki * error * dt;
      const candidateCommand = kp * error + candidateIntegral - kd * filteredDerivative;
      let integrating = false;
      if (ki === 0) integral = 0;
      else if ((candidateCommand >= 0 && candidateCommand <= maxValve)
        || (candidateCommand > maxValve && error < 0)
        || (candidateCommand < 0 && error > 0)) {
        integral = candidateIntegral;
        integrating = true;
      }

      const command = kp * error + integral - kd * filteredDerivative;
      valveOpen = Math.max(0, Math.min(maxValve, command));
      controlOutput = { p: kp * error, i: integral, d: -kd * filteredDerivative,
        raw: command, integrating };
      // 必须在传感器更新之前记录本次测量，否则微分恒为 0
      lastMeasurement = measuredTemp;

      delayQueue.push(valveOpen);
      const delayedCommand = delayQueue.shift();

      actuator += (1 - Math.exp(-dt / heaterTimeConstant)) * (delayedCommand - actuator);
      const heatIn = heaterMaxPower * actuator / 100;
      currentTemp += (heatIn - heatLoss(currentTemp)) / heatCapacity * dt;
      // 测温传感器一阶惯性：测量值追不上实际水温
      measuredTemp += (1 - Math.exp(-dt / sensorTimeConstant)) * (currentTemp - measuredTemp);
      if (currentTemp > peakTemp) peakTemp = currentTemp;
      simulationSteps++;

      if (simulationSteps % historySteps === 0) {
        history.push({ time: simulationSteps * dt, temp: currentTemp, measured: measuredTemp });
        if (history.length > maxStoredPoints) history.shift();
      }
    }
