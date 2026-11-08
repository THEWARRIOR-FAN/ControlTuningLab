// 水位调参实验：仿真模型——物理常量、状态变量与 PID 控制回路。
// 本文件不访问 DOM；界面逻辑在 ui.js，共享控件与曲线渲染在 ../../core/ 下。

    let setPoint = 0.6;
    let kp = 200.0;
    let ki = 0.0;
    let kd = 0.0;
    // 三个滑块统一显示 0–100 的控制比例；仿真仍使用各自的物理参数范围。
    const kpScale = 10;   // 比例 100 → 内部 Kp 1000
    const kiScale = 0.05; // 比例 100 → 内部 Ki 5
    const kdScale = 200;  // 比例 100 → 内部 Kd 20000

    let currentLevel = 0.0;
    let integral = 0.0;
    let valveOpen = 0.0;
    let actuator = 0.0;
    // 本步 PID 计算的拆解结果，供界面展示“这个数是怎么来的”
    let controlOutput = { p: 0, i: 0, d: 0, raw: 0, integrating: false };

    // 所有物理计算使用米、秒、立方米；只有界面把流量换算为 L/s。
    const dt = 0.05;            // 固定物理步长，不随显示帧率或倍速变化
    const controlDelay = 0.3;   // 控制指令纯滞后，秒
    const delaySteps = Math.round(controlDelay / dt);
    const maxValve = 100;
    const tankArea = 1.0;       // 水池水平截面积，m²
    const tankHeight = 1.0;     // 池高，m
    const maxInflow = 0.002;    // 最大进水，m³/s，即 2 L/s
    const outletDiameter = 0.020; // 底部圆孔直径，m
    const outletArea = Math.PI * outletDiameter ** 2 / 4;
    const dischargeCoefficient = 0.6;
    const gravity = 9.81;
    const actuatorTimeConstant = 1.0; // 阀门一阶响应时间常数，s
    const derivativeTimeConstant = 0.5; // 测量微分低通时间常数，s
    const historyInterval = 1;  // 每个仿真秒保存一个水位点
    const historySteps = Math.round(historyInterval / dt);
    const visiblePoints = 601;  // 显示最近 10 分钟
    const maxStoredPoints = 7201;
    let simulationSteps = 0;
    let overflowVolume = 0;
    let simulationSpeed = 50;
    let accumulator = 0;
    let lastFrameTime = null;

    let lastMeasurement = 0.0;
    let filteredDerivative = 0.0;

    let delayQueue = new Array(delaySteps).fill(0);
    let history = [{ time: 0, level: 0 }];
    let isPaused = false;
    let viewStartIndex = 0;

    function outletFlow(height) {
      return dischargeCoefficient * outletArea * Math.sqrt(2 * gravity * Math.max(0, height));
    }

    function steadyStateError() {
      if (ki > 0) {
        // 积分能保持所需阀位；若进水能力不足，只能达到全开时的平衡水位。
        const fullOpenHeight = (maxInflow / (dischargeCoefficient * outletArea)) ** 2 / (2 * gravity);
        return Math.max(0, setPoint - fullOpenHeight);
      }
      // 纯 P：求 Qmax * clamp(Kp*(目标-h),0,100)/100 = Qout(h)。
      let low = 0;
      let high = setPoint;
      for (let i = 0; i < 60; i++) {
        const height = (low + high) / 2;
        const command = Math.max(0, Math.min(maxValve, kp * (setPoint - height)));
        if (maxInflow * command / maxValve > outletFlow(height)) low = height;
        else high = height;
      }
      return setPoint - (low + high) / 2;
    }

    function pidControl() {
      const error = setPoint - currentLevel;
      const measurementDerivative = (currentLevel - lastMeasurement) / dt;
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
      lastMeasurement = currentLevel;

      delayQueue.push(valveOpen);
      const delayedValve = delayQueue.shift();

      actuator += (1 - Math.exp(-dt / actuatorTimeConstant)) * (delayedValve - actuator);
      const valveRatio = actuator / maxValve;
      const inflow = maxInflow * valveRatio;
      // 一步内排出的水不能超过现有水量加本步进水。
      const outflow = Math.min(outletFlow(currentLevel), currentLevel * tankArea / dt + inflow);
      const nextVolume = currentLevel * tankArea + (inflow - outflow) * dt;
      overflowVolume += Math.max(0, nextVolume - tankArea * tankHeight);
      currentLevel = Math.max(0, Math.min(tankHeight, nextVolume / tankArea));
      simulationSteps++;

      if (simulationSteps % historySteps === 0) {
        history.push({ time: simulationSteps * dt, level: currentLevel });
        if (history.length > maxStoredPoints) history.shift();
      }
    }
