// 无第三方依赖：node --test tests/temp-model.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSimulation: createExperiment, loadHtml, loadScript } = require('./helpers/harness.cjs');

// 本文件所有用例都跑调温模型；脚手架在 helpers/harness.cjs 中共享
const createSimulation = () => createExperiment('temp-tuner');
const html = loadHtml('temp-tuner');
const script = loadScript('temp-tuner');

test('heat model constants and equilibrium limits are physical', () => {
  const run = createSimulation();
  assert.equal(run('heatCapacity'), 4186);
  // 60 °C 时散热 = (60-20)/0.15 = 266.67 W
  assert.ok(Math.abs(run('heatLoss(60)') - 266.667) < 0.001);
  assert.equal(run('heatLoss(20)'), 0);
  // 满功率极限 20 + 500×0.15 = 95 °C
  assert.equal(run('ambientTemp + heaterMaxPower * thermalResistance'), 95);
  assert.equal(run('delaySteps'), 200);
  assert.equal(run('sensorTimeConstant'), 25);
});

test('steady state: heating equals cooling at pure-P equilibrium', () => {
  const run = createSimulation();
  // Kp=20 纯 P 收敛后：水温 57.5 °C、开度 50%、加热 250 W = 散热 250 W
  run('kp = 20; ki = 0; kd = 0; for (let i = 0; i < 60000; i++) pidControl();');
  assert.ok(Math.abs(run('currentTemp') - 57.5) < 0.01, `实测 ${run('currentTemp')}`);
  assert.ok(Math.abs(run('heatLoss(currentTemp)') - 250) < 1);
  assert.ok(Math.abs(run('heaterMaxPower * actuator / 100') - 250) < 1);
  // 纯 P 实测静差应与平衡解理论值一致
  assert.ok(Math.abs(run('setPoint - measuredTemp - steadyStateError()')) < 0.01);
  assert.ok(run('measuredTemp < setPoint'));
});

test('pure P too small: heats slowly and leaves a large steady error', () => {
  const run = createSimulation();
  run(`loadPreset('pSmall'); let t45 = null;
    for (let i = 0; i < 150000; i++) {
      pidControl();
      if (t45 === null && measuredTemp >= 45) t45 = (i + 1) * dt;
    }`);
  // 实测：Kp=4 到 45 °C 需 325.3 s，稳态 50.0 °C，静差 10.0 °C
  assert.ok(Math.abs(run('t45') - 325.3) < 1, `到45°C 实测 ${run('t45')} s`);
  assert.ok(Math.abs(run('measuredTemp') - 50) < 0.05, `稳态实测 ${run('measuredTemp')}`);
  assert.ok(Math.abs(run('setPoint - measuredTemp') - 10) < 0.05);
  // 加热慢：1500 s 内都没到 60 °C
  assert.ok(run('measuredTemp') < 55);
});

test('pure P too large: overshoots then oscillates with measured period', () => {
  const run = createSimulation();
  run(`loadPreset('pLarge'); let peak = 20;
    for (let i = 0; i < 60000; i++) { pidControl(); if (currentTemp > peak) peak = currentTemp; }`);
  // 实测：超调 1.94 °C
  const overshoot = run('peak - setPoint');
  assert.ok(overshoot > 1.5 && overshoot < 2.5, `超调实测 ${overshoot.toFixed(2)} °C`);
  // 末段仍在来回振荡：实测振幅 4.70 °C、周期 92 s
  const tail = run(`(() => {
    let lo = 1e9, hi = -1e9, crossings = 0, first = null, last = null, prev = currentTemp - setPoint;
    for (let i = 0; i < 10000; i++) {
      pidControl();
      lo = Math.min(lo, currentTemp); hi = Math.max(hi, currentTemp);
      const cur = currentTemp - setPoint;
      if ((prev < 0) !== (cur < 0)) { crossings++; if (first === null) first = i; last = i; }
      prev = cur;
    }
    return { amp: hi - lo, period: crossings > 1 ? (last - first) / (crossings - 1) * dt : 0 };
  })()`);
  assert.ok(tail.amp > 4.0 && tail.amp < 5.5, `振幅实测 ${tail.amp.toFixed(2)} °C`);
  assert.ok(tail.period > 60 && tail.period < 130, `周期实测 ${tail.period.toFixed(0)} s`);
});

test('PI removes the steady error; too-large I makes it oscillate harder', () => {
  const pi = createSimulation();
  pi(`loadPreset('pi'); let peak = 20;
    for (let i = 0; i < 60000; i++) { pidControl(); if (currentTemp > peak) peak = currentTemp; }`);
  const piResidual = Math.abs(pi('setPoint - measuredTemp'));
  const piOvershoot = pi('peak - setPoint');
  assert.ok(piResidual < 0.005, `PI 残差实测 ${piResidual.toFixed(3)} °C`);
  assert.ok(piOvershoot < 1.0, `PI 超调实测 ${piOvershoot.toFixed(2)} °C`);

  const strong = createSimulation();
  strong(`loadPreset('iLarge'); let peak = 20;
    for (let i = 0; i < 60000; i++) { pidControl(); if (currentTemp > peak) peak = currentTemp; }`);
  const strongOvershoot = strong('peak - setPoint');
  assert.ok(strongOvershoot > piOvershoot + 0.5,
    `Ki=1 超调 ${strongOvershoot.toFixed(2)} 应明显大于 Ki=0.1 的 ${piOvershoot.toFixed(2)}`);
  // 末段仍在振荡：实测振幅 5.45 °C、周期 117 s
  const tail = strong(`(() => {
    let lo = 1e9, hi = -1e9, crossings = 0, first = null, last = null, prev = currentTemp - setPoint;
    for (let i = 0; i < 10000; i++) {
      pidControl();
      lo = Math.min(lo, currentTemp); hi = Math.max(hi, currentTemp);
      const cur = currentTemp - setPoint;
      if ((prev < 0) !== (cur < 0)) { crossings++; if (first === null) first = i; last = i; }
      prev = cur;
    }
    return { amp: hi - lo, period: crossings > 1 ? (last - first) / (crossings - 1) * dt : 0 };
  })()`);
  assert.ok(tail.amp > 1.5, `I 过大末段振幅实测 ${tail.amp.toFixed(2)} °C`);
  assert.ok(tail.period > 80 && tail.period < 160, `周期实测 ${tail.period.toFixed(0)} s`);
});

test('D is for fine-tuning: same PI with D kills overshoot and ripple', () => {
  function runWith(overrideKd) {
    const run = createSimulation();
    run(`loadPreset('pid'); ${overrideKd === null ? '' : `kd = ${overrideKd};`} let peak = 20;
      for (let i = 0; i < 60000; i++) { pidControl(); if (currentTemp > peak) peak = currentTemp; }`);
    const overshoot = run('peak - setPoint');
    const amp = run(`(() => {
      let lo = 1e9, hi = -1e9;
      for (let i = 0; i < 10000; i++) { pidControl(); lo = Math.min(lo, currentTemp); hi = Math.max(hi, currentTemp); }
      return hi - lo;
    })()`);
    return { overshoot, amp };
  }
  const withoutD = runWith(0);
  const withD = runWith(null);   // 预设自带 Kd=1000
  // 实测：Kd 0→1000，超调 1.69→0.03 °C、振幅 3.79→0.00 °C
  assert.ok(withoutD.overshoot > 0.5, `无 D 超调实测 ${withoutD.overshoot.toFixed(2)} °C`);
  assert.ok(withoutD.amp > 1.0, `无 D 振幅实测 ${withoutD.amp.toFixed(2)} °C`);
  assert.ok(withD.overshoot < 0.2, `有 D 超调实测 ${withD.overshoot.toFixed(2)} °C`);
  assert.ok(withD.amp < 0.3, `有 D 振幅实测 ${withD.amp.toFixed(2)} °C`);
  assert.ok(withD.overshoot < withoutD.overshoot - 0.5);
});

test('theory predicts pure-P steady error for small Kp, not while oscillating', () => {
  const run = createSimulation();
  run('kp = 4; ki = 0; kd = 0; for (let i = 0; i < 60000; i++) pidControl();');
  assert.ok(Math.abs(run('setPoint - measuredTemp - steadyStateError()')) < 0.01);
  assert.ok(Math.abs(run('steadyStateError()') - 10) < 0.01);
  run('kp = 20; for (let i = 0; i < 60000; i++) pidControl();');
  assert.ok(Math.abs(run('steadyStateError()') - 2.5) < 0.01);
  // Kp=100 时系统在振荡，平衡解不再是当前误差（实测 |当前误差−理论| ≈ 1.46 °C）
  run('kp = 100; for (let i = 0; i < 60000; i++) pidControl();');
  assert.ok(Math.abs(run('setPoint - measuredTemp - steadyStateError()')) > 0.3,
    `实测差 ${run('setPoint - measuredTemp - steadyStateError()').toFixed(2)} °C`);
  // Ki>0 时理论静差为零（目标 60 °C < 满功率极限 95 °C）
  run('kp = 30; ki = 0.1; for (let i = 0; i < 60000; i++) pidControl();');
  assert.equal(run('steadyStateError()'), 0);
});

test('target step down and up recovers with PI preset', () => {
  const run = createSimulation();
  run("loadPreset('pi'); for (let i = 0; i < 50000; i++) pidControl();");
  assert.ok(Math.abs(run('measuredTemp - setPoint')) < 0.01);
  run('setPoint = 40; for (let i = 0; i < 50000; i++) pidControl();');
  assert.ok(Math.abs(run('measuredTemp - 40')) < 0.01, `降到40 实测 ${run('measuredTemp')}`);
  run('setPoint = 60; for (let i = 0; i < 50000; i++) pidControl();');
  assert.ok(Math.abs(run('measuredTemp - 60')) < 0.01, `升回60 实测 ${run('measuredTemp')}`);
  assert.ok(run('actuator >= 0 && actuator <= 100'));
});

test('cold start saturates without windup; setpoint jump causes no derivative kick', () => {
  const run = createSimulation();
  // 冷态误差 40 °C、Kp=100 → P=4000% 被限到 100%，积分应暂停累积
  run("loadPreset('pLarge'); ki = 0.3; pidControl();");
  assert.equal(run('valveOpen'), 100);
  assert.equal(run('integral'), 0);
  assert.equal(run('controlOutput.integrating'), false);
  assert.equal(run('controlOutput.p + controlOutput.i + controlOutput.d'), run('controlOutput.raw'));
  run('updateReadout();');
  assert.equal(run('document.getElementById("pOutput").textContent'), run('controlOutput.p.toFixed(1)'));
  assert.ok(run('document.getElementById("saturationStatus").textContent').includes('上限饱和'));
  assert.ok(run('document.getElementById("controlChain").textContent').includes('计算链'));

  // 目标突变不产生微分冲击：D 只看测量温度的升温速度
  run("resetSystem(); kp = 0; kd = 1500; setPoint = 80; pidControl();");
  assert.ok(Math.abs(run('controlOutput.d')) < 0.5, `D=${run('controlOutput.d')}`);

  // 未饱和时积分正常累积
  run('kp = 0; ki = 0.3; pidControl();');
  assert.equal(run('controlOutput.integrating'), true);
  assert.ok(run('integral') > 0);
  run('updateReadout();');
  assert.ok(run('document.getElementById("saturationStatus").textContent').includes('积分正在累积'));
});

test('sensor lag is visible: measurement trails actual temperature while heating', () => {
  const run = createSimulation();
  run("loadPreset('pLarge'); for (let i = 0; i < 2000; i++) pidControl();");
  const actual = run('currentTemp');
  const measured = run('measuredTemp');
  assert.ok(actual > measured + 0.5, `升温中实际 ${actual.toFixed(2)} 应明显高于测量 ${measured.toFixed(2)}`);
  // 温度条读数：实际 = 水温、测量 = 控制器所见，滞后标签 = 两者之差
  run('updateReadout();');
  assert.equal(run('document.getElementById("barMeasuredVal").textContent'),
    run('measuredTemp').toFixed(1));
  assert.equal(run('document.getElementById("barActualVal").textContent'),
    run('currentTemp').toFixed(1));
  assert.equal(run('document.getElementById("lagTag").textContent'),
    `传感器滞后 Δ ${(run('currentTemp') - run('measuredTemp')).toFixed(1)} °C`);
});

test('preset status explains the expected phenomenon for learners', () => {
  const run = createSimulation();
  run("loadPreset('pSmall');");
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('325.3'));
  run("loadPreset('pOk');");
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('57.5'));
  run("loadPreset('pLarge');");
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('振荡'));
  run("loadPreset('pi');");
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('静差消失'));
  run("loadPreset('iLarge');");
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('振荡'));
  run("loadPreset('pid');");
  assert.ok(run('document.getElementById("tuneStatus").textContent').includes('1.69'));
});

test('frame rate independent fixed-step timing, pause, speed and reset', () => {
  function simulate(fps) {
    const run = createSimulation();
    run(`simulationSpeed = 10; loop(0);
      for (let i = 1; i <= ${fps * 10}; i++) loop(i * 1000 / ${fps});`);
    return run;
  }
  const slow = simulate(30);
  const fast = simulate(144);
  // 10× 下按固定步长推进，帧率差异最多造成一个 dt 的累计舍入；
  // 满功率下单步温升约 0.012 °C（500/4186×0.1），故容差取 0.014。
  assert.ok(Math.abs(slow('simulationSteps * dt') - 100) <= 0.11);
  assert.ok(Math.abs(slow('currentTemp') - fast('currentTemp')) < 0.014);
  slow('isPaused = true; loop(11000); loop(12000);');
  const pausedSteps = slow('simulationSteps');
  slow('loop(13000);');
  assert.equal(slow('simulationSteps'), pausedSteps);
  slow('resetSystem();');
  assert.equal(slow('simulationSteps'), 0);
  assert.equal(slow('currentTemp'), 20);
  assert.equal(slow('history[0].time'), 0);
});

test('history keeps absolute simulated timestamps after trimming', () => {
  const run = createSimulation();
  run('for (let i = 0; i < 150000; i++) pidControl();');
  assert.equal(run('history.length'), 7201);
  assert.equal(run('history[0].time'), 7800);
  assert.equal(run('formatTime(0)'), '7800.0s');
});

test('speed options and slider ranges match the calibration targets', () => {
  assert.match(html, /<option value="50" selected>50×<\/option>/);
  assert.match(html, /<option value="100">100×<\/option>/);
  // 滑块范围只是本教学模型的操作边界，不代表真实设备的整定答案
  assert.match(html, /id="setPoint" min="0" max="100" step="1"/);
  assert.match(html, /id="kp" min="0" max="200" step="1"/);
  assert.match(html, /id="ki" min="0" max="100" step="1"/);
  assert.match(html, /id="kd" min="0" max="100" step="1"/);
  assert.match(script, /let kp = 20\.0;\s*\n\s*let ki = 0\.0;/);   // 默认纯 P
  assert.match(script, /kd = 1000\.0;/);                            // PID 预设用可见的 D
});
