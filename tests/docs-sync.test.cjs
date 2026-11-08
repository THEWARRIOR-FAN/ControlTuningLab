// 无第三方依赖：node --test tests/docs-sync.test.cjs
// 文档与页面文案的同步校验：各实验 README.md 是预设参数与实测现象的唯一权威，
// 页面 ui.js 携带的数字必须与之一致；根 README 与 docs/实验介绍只做导览。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const experiments = ['water-tuner', 'temp-tuner'];

function read(...parts) {
  return fs.readFileSync(path.join(root, ...parts), 'utf8');
}

function readme(name) {
  return read('experiments', name, 'README.md');
}

// 解析 README 预设表的数据行（表头与分隔行不匹配，自动跳过）：
// | 预设名 | Kp | Ki | Kd | 现象 |
function parsePresetRows(md) {
  const rows = [];
  const re = /^\|\s*([^|]+?)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
  for (const m of md.matchAll(re)) {
    rows.push({
      name: m[1],
      triple: [Number(m[2]), Number(m[3]), Number(m[4])].join(','),
      phenomenon: m[5]
    });
  }
  return rows;
}

// 解析 ui.js loadPreset 中每个预设的 (kp, ki, kd) 赋值
function parseLoadPresets(uiSource) {
  const presets = [];
  const blockRe = /if \(name === "([^"]+)"\)\s*\{([^}]*)\}/g;
  for (const m of uiSource.matchAll(blockRe)) {
    const kp = m[2].match(/\bkp = ([\d.]+)/);
    const ki = m[2].match(/\bki = ([\d.]+)/);
    const kd = m[2].match(/\bkd = ([\d.]+)/);
    if (kp && ki && kd) {
      presets.push({
        name: m[1],
        triple: [Number(kp[1]), Number(ki[1]), Number(kd[1])].join(',')
      });
    }
  }
  return presets;
}

test('README preset tables match loadPreset values in ui.js', () => {
  for (const name of experiments) {
    const rows = parsePresetRows(readme(name));
    const ui = read('experiments', name, 'ui.js');
    const presets = parseLoadPresets(ui);

    assert.ok(rows.length >= 3, `${name}: README 预设表至少应有 3 行，实得 ${rows.length}`);
    assert.equal(presets.length, rows.length,
      `${name}: README 预设 ${rows.length} 组，ui.js loadPreset ${presets.length} 组`);

    const expected = rows.map(r => r.triple).sort();
    const actual = presets.map(p => p.triple).sort();
    assert.deepEqual(actual, expected,
      `${name}: README 预设参数 (Kp,Ki,Kd) 与 ui.js 不一致\nREADME: ${expected.join(' | ')}\nui.js:  ${actual.join(' | ')}`);
  }
});

test('phenomenon numbers in README preset tables appear in ui.js', () => {
  for (const name of experiments) {
    const rows = parsePresetRows(readme(name));
    const ui = read('experiments', name, 'ui.js');
    for (const row of rows) {
      const numbers = row.phenomenon.match(/\d+(?:\.\d+)?/g) || [];
      assert.ok(numbers.length > 0, `${name}: 预设「${row.name}」的现象列应含实测数字`);
      for (const n of numbers) {
        assert.ok(ui.includes(n),
          `${name}: 预设「${row.name}」现象数字 ${n} 未出现在 ui.js 文案中`);
      }
    }
  }
});

test('root README and docs guide link to experiment READMEs without duplicating tables', () => {
  const guideFiles = [['README.md'], ['docs', '实验介绍.md']];
  for (const file of guideFiles) {
    const src = read(...file);
    const label = file.join('/');
    // 导览文档不得复制预设表（4 列数字行）
    assert.doesNotMatch(src, /^\|\s*[^|]+\|\s*\d+\s*\|\s*\d+\s*\|\s*\d+\s*\|/m,
      `${label}: 不应包含预设参数表，数字只写在各实验 README.md`);
    // 必须链接到每个实验的 README.md（单一权威）
    for (const name of experiments) {
      assert.ok(src.includes(`experiments/${name}/README.md`),
        `${label}: 缺少 experiments/${name}/README.md 链接`);
    }
  }
});

test('README slider and internal ranges match HTML max and model.js scales', () => {
  for (const name of experiments) {
    const md = readme(name);
    const html = read('experiments', name, 'index.html');
    const model = read('experiments', name, 'model.js');

    for (const param of ['kp', 'ki', 'kd']) {
      const maxMatch = html.match(new RegExp(`id="${param}" min="[^"]*" max="(\\d+)"`));
      assert.ok(maxMatch, `${name}: index.html 缺少 ${param} 滑块范围`);
      const sliderMax = Number(maxMatch[1]);

      const scaleMatch = model.match(new RegExp(`const ${param}Scale = ([\\d.]+)`));
      assert.ok(scaleMatch, `${name}: model.js 缺少 ${param}Scale`);
      const internalMax = sliderMax * Number(scaleMatch[1]);

      // README 反引号里的 `Kp 0–N`：N 只能是滑块范围或内部物理范围
      const label = param[0].toUpperCase() + param[1]; // kp → Kp
      const mentioned = [...md.matchAll(new RegExp(`\`${label} 0–(\\d+)\``, 'g'))]
        .map(m => Number(m[1]));
      for (const n of mentioned) {
        const ok = n === sliderMax || Math.abs(n - internalMax) < 1e-6;
        assert.ok(ok,
          `${name}: README 写 \`${label} 0–${n}\`，但滑块 max=${sliderMax}、内部=${internalMax}`);
      }
      // 内部物理范围必须在 README 中写明（权威数字不能省）
      assert.ok(mentioned.some(n => Math.abs(n - internalMax) < 1e-6),
        `${name}: README 缺少 \`${label} 0–${internalMax}\` 的内部范围说明`);
    }
  }
});
