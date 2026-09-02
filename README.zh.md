# dsh-browser-verify

[English](README.md) | 中文

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node](<https://img.shields.io/badge/node-%3E%3D22-blue.svg>)](package.json)

**给你的 DeepSeek Harness 一双看网页的眼睛** —— 只读浏览器验证，≤4 次工具调用完成：打开、mock、断言、截图。

每天都在变的页面（H5 轮播、缴费流程、后台控制台）很难靠肉眼验证。本插件让模型通过四个工具驱动一个真实的无头浏览器——打开页面、拦截接口、断言 DOM、截图——截图自动以图片块形式回到模型上下文。不需要终端脚本，不需要打理浏览器：一次验证就是几次工具调用。

## 快速上手

```sh
dsh plugin --profile web add dsh-browser-verify@0.1.3
```

1. **安装**（更多方式见 [安装](#安装)）。
2. **重启 GUI 一次**——插件在启动时加载，四个工具要在重启后才可见。
3. **新开会话**，告诉模型——或直接调用：

```
browser_open  url="http://localhost:5173/hweb/#/pages/lyp/livingPayment" waitSelector=".header"
        打开页面（全新无头会话），返回 title / HTTP status / 可见文本摘要 / console 错误。

browser_assert  selector=".empty-wrap" text="暂无可用缴费服务"
        等待选择器（默认 5s），返回 {pass, count, actualText, elapsedMs}。
        未命中是正常的 pass:false，而不是抛错。
```

这就是整个闭环——两次调用回答"页面是否显示了空态？"；需要看版式再加
`browser_screenshot`，页面启动依赖 mock 接口就先 `browser_mock`（或直接在
`browser_open` 传内联 `mocks`，见下文）。

## 它做什么

| 工具                   | 用途                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `browser_open`       | 在全新场景中打开 URL（无头 Chromium，默认视口 390×844 @2x），返回 title / HTTP 状态 / 可见文本摘要 / console 错误。不传`waitSelector` 时默认等待页面**渲染稳定**后再采样（连续两次相同可见文本即稳定，上限约 3s），不会采到启动骨架帧；`加载中...` 等加载态文案自动过滤。可选 `waitSelector` 等待关键元素出现后再返回；可选内联 `mocks` 在**首次导航前**拦截接口——用于一启动就依赖 mock 数据的页面。 |
| `browser_mock`       | 注册 playwright glob 路由（如`**/api/*.do*`）返回指定 JSON，并自动 reload 页面展示 mock 状态——不碰后端最快验证空态/异常态。重复 pattern 会提示报错。                                                                                                                                                                                                                                                                    |
| `browser_assert`     | 最省 token 也最精确的验证：等待 CSS 选择器出现，校验数量与包含文本，返回`{pass, count, actualText, elapsedMs}`。不满足时返回 `pass:false`（附差异），**绝不抛错**——失败是一等公民的结果，而不是要调试的异常。                                                                                                                                                                                                   |
| `browser_screenshot` | 截取当前页面（视口或整页），**自动以 image block 投影到模型上下文**——模型直接"看见"版式，无需任何文件处理。返回尺寸、sha256；与上一张完全一致时 `identicalToPrevious:true`（疑似页面未刷新）。                                                                                                                                                                                                                    |

先 `browser_assert` 再 `browser_screenshot`：断言更便宜，截图留给必须判断
渲染效果的时刻。

## 真实模型使用体验

> **"好用，层级分明。"** —— 一次真实使用旅程的大模型原话：它对我们生产环境
> 的 uni-app H5 缴费页做了三态验证（真实态 / 空态 / 有数据）。

- **4–5 次工具调用跑完，零环境搭建**——同样的事之前要 ~20 步手动脚本；
- **mock 后自动 reload**：手动脚本踩过"同 URL 不重导航、截图相同"的坑，
  插件直接从机制上规避；
- **截图自动投影进模型上下文**，不用再 read_image 找路径；
- **断言结构化**（count / text / 耗时），页面疑似未刷新时"疑似未刷新"告警
  自动提醒；
- **每次 browser_open 重开场景即重置 mock**，三态之间不串。

试用中提出的两个打磨点已在 **0.1.3** 修复：不传 `waitSelector` 也会等渲染
稳定后再采样（不再采到启动帧），`加载中...` 等加载态文案自动过滤。体验
反馈直接驱动迭代。

### 完整示例——两态六次调用

典型验证（空态 + 正常态）只需 6 次调用：

```
browser_open  url="…/livingPayment" mocks=[{urlPattern:"**/api/*.do*", json:{status:0,result:{list:[],data:{}}}}] waitSelector=".header"
browser_assert  selector=".empty-wrap"  text="暂无可用缴费服务"
browser_screenshot

browser_open  …（同 url，mocks 换成一条 {wegType:"WATER",name:"水费",info:"128.00"}）
browser_assert  selector=".grid-item"  text="水费"
browser_screenshot
```

## 安装

```sh
dsh plugin --profile web add dsh-browser-verify@0.1.3
```

版本故意钉死：pnpm 11 会暂缓 24 小时内新发布的包，裸写 `add dsh-browser-verify`（latest）会在发布当天装到上一个版本。`--profile web`
是本部署的 GUI profile——如果不同请换成你自己的 profile 名。

要求 **dsh ≥ 0.1.2-alpha.1**。

### 浏览器前置（务必读）

本插件**不自带 Chromium**——它在你机器上找浏览器。先装一次：

```sh
npx playwright install chromium     # 需要 playwright-core@1.62.0
```

或通过 `DSH_BROWSER_VERIFY_CHROMIUM` 指向已有二进制（见
[环境变量](#环境变量)）。两者都没有时，第一次 `browser_open` 会给出可操作的安装提示。

## 环境变量

| 变量                            | 默认         | 含义                                                                             |
| ------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| `DSH_BROWSER_VERIFY_CHROMIUM` | *(未设置)* | Chromium 完整路径；优先于缓存探测。路径错误时启动即报可操作提示。                |
| `DSH_BROWSER_VERIFY_TIMEOUT`  | `10000`    | `browser_open` 页面加载路径的墙钟预算（ms），含 wait-selector 与 mock reload。 |
| `DSH_BROWSER_VERIFY_IDLE_MS`  | `600000`   | 空闲回收窗口（ms），超时后浏览器实例自动关闭；插件 dispose 时强制清理。          |

## 可靠性与清理

- **单浏览器单场景**——每进程一个惰性单例，FIFO 串行工具访问，10 分钟空闲回收，dispose 全量清理。
- **截图幂等**——字节一致时返回 `identicalToPrevious:true`，不再把同一张图重复发给模型。
- **零垃圾纪律**——插件只写系统临时目录（`dsh-browser-verify-*` 前缀）、DSH 附件库和显式 `--persist` 路径。宿主崩溃后手动清理：

  ```sh
  rm -rf "$(node -p 'require("os").tmpdir()')/dsh-browser-verify-*"
  ```
- **错误即接口**——所有错误以 `browser-verify: ` 前缀开头、以可操作建议结尾；验证"失败"是结果（`pass:false`），不是异常。

## 测试状态

41 个单测（完全离线，无需浏览器）、严格 typecheck、每文件 ≥90% 语句覆盖率闸门。已在 **dsh 0.1.2-alpha.4 真实 GUI 端到端验证**：对一个真实 uni-app H5（hhhweb），空态+正常态两态闭环共 6 次调用，截图自动投影，无临时目录残留、无僵尸进程。

## 已知限制

- **只读**：不点击、不输入、不滚动——仅验证。同时只有一个场景；每次 `browser_open` 重置 mocks 与页面状态。
- **平台**：已实测 macOS arm64。其他平台请用 `DSH_BROWSER_VERIFY_CHROMIUM` 指定浏览器二进制。
- **单机假设**：启动清理只处理超过 1 小时的 `dsh-browser-verify-*` pid 目录，同机多实例互不影响。
- **无 GUI 配置卡**——配置仅环境变量（见上）。

## 开发

```bash
pnpm install
pnpm build            # tsc -b && tsdown → lib/（clean 构建；lib/ 不入库）
pnpm test             # vitest run（离线）
pnpm typecheck
pnpm vitest run --coverage   # discover / cleanup / attachments 每文件 ≥90%
scripts/smoke.sh      # 两态端到端；需要参考应用 dev server 在 :5173
```

CLI（免 harness 的调试路径）：`node lib/cli.js --url <u> [--mock <file.json>] [--wait-selector <sel>] [--assert <sel>] [--screenshot] [--persist <dir>] [--viewport <WxH>]`。

贡献者可本地构建后安装：`pnpm build` 后
`dsh plugin --profile web add ./dsh-browser-verify-<version>.tgz`——tgz 内已含
预构建 `lib/`，安装机无需再构建。

## 许可与署名

Apache-2.0。面向 agent 与贡献者的架构说明与实现约定见 [AGENTS.md](AGENTS.md)。
