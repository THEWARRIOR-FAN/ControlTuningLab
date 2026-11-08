# EmbeddedWebControlExperiments

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-brightgreen)](https://thewarrior-fan.github.io/EmbeddedWebControlExperiments/)

基于网页技术的控制系统仿真实验集合：用可交互的界面直观理解不同控制模型的工作原理与参数调节方法。

**纯前端实现** —— HTML5 + CSS3 + JavaScript + Canvas，无依赖、无构建、无后端，下载即可运行。

## 在线演示

<https://thewarrior-fan.github.io/EmbeddedWebControlExperiments/>

由 GitHub Pages 在每次推送 `main` 分支后自动部署。

## 快速开始

**方式一：直接打开**

双击 `experiments/water-tuner/index.html` 或 `experiments/temp-tuner/index.html`，用任意现代浏览器打开即可。

**方式二：本地静态服务**

```bash
python -m http.server 8000
# 浏览器访问 http://localhost:8000/experiments/water-tuner/index.html
#           http://localhost:8000/experiments/temp-tuner/index.html
```

## 实验列表

所有实验共享同一套交互骨架：参数滑块 + 微调按钮、预设带预期现象说明、PID 公式卡实时代入数字、Canvas 曲线可暂停回看、1×/50×/100× 倍速与固定物理步长。

| 实验 | 被控对象 | 入口 | 详细说明 |
| --- | --- | --- | --- |
| 水位调参 | 1 m³ 敞口水池（进水阀 + 底部小孔出流） | [`experiments/water-tuner/index.html`](experiments/water-tuner/index.html) | [experiments/water-tuner/README.md](experiments/water-tuner/README.md) |
| 调温模型 | 1 kg 水的加热过程（延迟 + 传感惯性） | [`experiments/temp-tuner/index.html`](experiments/temp-tuner/index.html) | [experiments/temp-tuner/README.md](experiments/temp-tuner/README.md) |

**预设参数表、预期现象实测数值、参数范围与物理模型推导只写在各实验的 README 里**（单一权威）；页面文案携带相同数字，由 `tests/docs-sync.test.cjs` 自动校验，改一处漏一处会被测试抓住。系列导览见 [`docs/实验介绍.md`](docs/实验介绍.md)。

## 目录结构

```
.
├── index.html                     # GitHub Pages 入口（选择实验）
├── core/                          # 两实验共享的样式与脚本
│   ├── theme.css                  #   布局、控件、指标、公式卡、曲线工具样式
│   ├── chart.js                   #   曲线渲染（网格/目标线/序列）
│   └── controls.js                #   回看滑块、倍速循环、微调与小贴士轮播
├── experiments/
│   ├── water-tuner/
│   │   ├── index.html             # 水位实验页（仅标记）
│   │   ├── model.js               #   仿真模型：常量、状态、PID 回路（不碰 DOM）
│   │   ├── ui.js                  #   界面：读数、预设文案、控件绑定
│   │   └── README.md              #   预设表与实测数字的唯一权威
│   └── temp-tuner/                # 调温实验，结构同上
├── docs/实验介绍.md               # 实验系列导览
├── tests/                         # node:test 测试（无第三方依赖）
│   ├── helpers/harness.cjs        #   共享 vm 脚手架（假 DOM、按路径加载脚本）
│   ├── water-model.test.cjs
│   ├── temp-model.test.cjs
│   └── docs-sync.test.cjs         #   文档与页面文案的数字同步校验
├── README.md                      # 本文件（总览）
├── LICENSE                        # MIT
└── .gitignore
```

## 验证

```bash
node --test "tests/*.test.cjs"     # 全量测试
git diff --check                    # 提交前检查空白错误
```

无需第三方依赖，需 Node.js。

## 后续计划

- [ ] 模糊控制实验
- [ ] 自适应控制实验
- [ ] 更多被控对象模型（转速等）

欢迎通过 Issue 和 PR 交流补充。

## 许可证

本项目采用 [MIT License](LICENSE) 开源。
