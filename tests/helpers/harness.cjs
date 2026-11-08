// 共享测试脚手架（无第三方依赖）：在 vm 上按浏览器顺序加载
// core 共享库 → 实验 model.js → 实验 ui.js，返回可执行表达式的 run()。
// 不从 HTML 正则提取脚本，页面结构调整不会影响测试；
// 但脚本里 getElementById 用到的 id 必须真实存在于该实验的 index.html 标记中。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const scriptFiles = ['core/chart.js', 'core/controls.js'];

function loadHtml(experiment) {
  return fs.readFileSync(path.join(root, 'experiments', experiment, 'index.html'), 'utf8');
}

// 按浏览器加载顺序拼接：core 共享库 → 实验 model.js → 实验 ui.js
function loadScript(experiment) {
  return [...scriptFiles,
    `experiments/${experiment}/model.js`,
    `experiments/${experiment}/ui.js`]
    .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
}

function createSimulation(experiment) {
  const html = loadHtml(experiment);
  const script = loadScript(experiment);

  const elements = new Map();
  const context2d = new Proxy({}, { get: () => () => {} });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, classList: { toggle() {}, remove() {}, add() {} },
      clientHeight: 300, value: '', listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      getContext() { return context2d; },
      getBoundingClientRect() { return { width: 600, height: 260 }; }
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    document: {
      hidden: false,
      getElementById(id) {
        assert.ok(html.includes(`id="${id}"`), `Missing element: ${id}`);
        return element(id);
      },
      querySelector: element,
      addEventListener() {}
    },
    window: { devicePixelRatio: 1, setTimeout() {}, setInterval() {}, addEventListener() {} },
    requestAnimationFrame() {}
  });
  vm.runInContext(script, context);
  return code => vm.runInContext(code, context);
}

module.exports = { createSimulation, loadHtml, loadScript };
