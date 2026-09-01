# dsh-browser-verify 设计备忘录

> 本文档固化一次设计研讨的结论，供后续会话直接开工使用。
> 状态：**设计定稿，尚未开发**（2026-09-01 用户确认暂缓开发；MVP 范围已确认=只读验证四件套）
> 责任目录：本仓库根目录（`/Users/dongshuai/Desktop/AIWorks/dsh-browser-verify`）

---

## 1. 项目由来

### 1.1 触发场景

2026-09-01，在 `hhhweb`（`/Users/dongshuai/Desktop/works/hhhweb`，uni-app H5 项目）给「我的缴费」页
（`pages/lyp/livingPayment.vue`）添加空状态时，需要对该页面做浏览器验证：

- 页面对应的 dev server 在 `localhost:5173`（Vite，基路径 `/hweb/`，`/api/*` 代理到业务后端）；
- 采用无头 Chromium 验证：临时安装 playwright-core（约 5s）、探测本机 ms-playwright 缓存中的
  Chromium 二进制、编写场景脚本（真实接口 / mock 空数据 / mock 有数据三态）、截图检视。
- 全程 47 步中，**验证工具链搭建与检视约占 20 步**（近一半），其中大部分是"一次性探测"
  （装包、找二进制、找可执行文件路径、脚本重写），后续完全可模板化。
- 复盘（1.7M token / 5m36s）结论：token 大头是每步固定上下文重注入，因此优化方向是
  **压缩步数 + 减少图片检视 + 固化验证工具链**。

### 1.2 需求演进

1. 最初只想做一个"项目内可复用的验证脚本"，即 hhhweb 自己的脚手架；
2. 用户明确：不只是项目工具，要做**所有会话、所有项目都能用**的验证工具；
3. 形态调研后决定采用 **DSH（DeepSeek Harness）宿主插件**形态。

### 1.3 形态调研与决策

| 形态 | 会话内体验 | token 开销 | 耦合/维护 | 多机迁移 | 结论 |
|---|---|---|---|---|---|
| 项目内脚手架 | 每次重搭 | — | 无 | 无 | 否 |
| 全局 CLI + 全局 skill | 2–4 次 bash + 手动读图 | 仅加载 skill 时 | 与 harness 零耦合 | 拷目录 | 否（仅作开发调试入口） |
| MCP 服务器 | 1 次原生调用 | 工具定义每请求少量增加 | 需维护 MCP 协议层；DSH 只桥接 tools 能力；服务器是沙箱外受信代码 | 加配置即可 | 否 |
| **DSH 宿主插件（选定）** | 第一方原生工具，与 `read_image`/`describe_image` 同级 | 仅工具定义本身 | 与 DSH 版本有耦合（vision 先例已接受） | 插件仓库化 | **是** |

**选定理由**：

- DSH 本身是"万物皆插件"理念（Cordis），工具经 `ctx.tools.register()` 注册即为第一方工具；
- 已有成功先例 `dsh-llm-vision`（本机会话的 `describe_image`/`extract_text`/`llm_vision_check`
  即由其提供），安装链路、双半结构（host 半跑 Node 干活 / client 半做 GUI 感知）、
  构建链（tsdown）、发布方式（`dsh plugin --profile web add`）均可直接照搬；
- 模型侧体验：一个工具调用返回结构化结果 + 截图自动进上下文（image block 投影），
  与现有视觉工具完全一致，无需额外学习成本。

### 1.4 当前状态与范围（已确认）

- **只做宿主半（host half）**：MVP 无 GUI 设置项，不需要 client 半；
- **MVP = 只读验证四件套**：`browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot`；
  点击、输入、滚动等交互能力放二期；
- 开发暂缓：用户明确"暂不开发"，本文档是开工时的唯一依据。

---

## 2. 使用环境

### 2.1 机器与工具链

| 项 | 值 |
|---|---|
| 机器 | macOS（Apple Silicon，arm64） |
| Node | v22.21.1（插件 `engines` 参考 vision：`^22.19.0 || >=24.0.0`） |
| 包管理 | pnpm 11.x |
| DSH checkout | `/Users/dongshuai/Desktop/AIWorks/deepseek-harness`（开发运行 `pnpm run dev:web`） |
| DSH Web GUI | `http://127.0.0.1:3080`（仅 dsh web 注入 `window.__DSH_BOOT__`） |
| 现有插件先例 | `/Users/dongshuai/Desktop/AIWorks/dsh-llm-vision`（0.3.2，`dsh: >=0.1.2-alpha.1`） |
| 目标验证对象 | uni-app H5（业务 dev server `localhost:5173`，基路径 `/hweb/`）、一般网页均可 |

### 2.2 浏览器资源（本机已具备）

缓存目录：`~/Library/Caches/ms-playwright/`

```
chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell   ← 推荐（轻量，无头够用）
chromium-1200 / chromium_headless_shell-1200 / ffmpeg-1011
```

- 驱动策略：插件自带 `playwright-core` 依赖（**只带核心库，不下载浏览器**），启动时
  `executablePath` 显式指向缓存二进制；探测顺序：headless shell → 完整 Chrome → 引导提示
  `npx playwright install chromium`（需一次性引导，并在文档注明可清理）。
- 版本匹配：本会话用 playwright-core@1.50.1 + chromium-1234（显式 executablePath 可强跑）；
  固化时应确认 1234 对应的 playwright 版本号后 pin 住，避免协议抖动（见 §5.3）。

### 2.3 沙箱与权限（重要约束）

- agent 会话文件沙箱为 `workspace-write`：可写会话工作区；`/tmp` 等部分临时区可写；
  `~/.npm` 等用户目录写入会被拦截（本会话 npm 安装日志被拦，用 `--cache <本地>` 绕过）；
- **宿主插件在 harness 进程内运行**，不受上述沙箱限制——启动 Chromium、写临时目录、
  读缓存路径都不需要逐次审批，这正是选插件形态的隐性收益；
- 但插件代码因此是"受信代码"：不得接触凭据，不做网络外呼，行为需自约束（§4.1）。

---

## 3. 目前设计

### 3.1 总体形态

宿主插件 `dsh-browser-verify`，与 `dsh-llm-vision` 结构对齐：

| facet | vision 的做法 | browser-verify 的对应 |
|---|---|---|
| 插件清单 | `package.json` 的 `dsh.bundle.patch` → `./cordis.patch.yml` | 同左 |
| 安装 | `dsh plugin --profile web add dsh-llm-vision@0.3.2`（或本地 tgz） | 同左 |
| 宿主半 | `exports["."]`，注册模型面向工具 | 注册 browser_* 四工具 |
| client 半 | `dsh.client` 注入，附件化发送 + 缩略图 | **MVP 不做**（无设置卡片） |
| 配置面 | GUI 设置卡片（Settings → Plugins → llm-vision） | MVP 不做；默认值 + 环境变量兜底 |
| 构建 | tsdown（`src/` → `lib/`），`pnpm pack` 出 tgz | 同左 |

### 3.2 目录结构（规划）

```
dsh-browser-verify/
├── package.json              # dsh.bundle.patch 声明；engines；exports
├── cordis.patch.yml          # 向 web profile 插入插件行（参照 vision 注释模板）
├── src/
│   ├── index.ts              # ctx.tools.register() 注册 4 个工具（schema 用 harness DSL）
│   ├── driver.ts             # 浏览器驱动：探测缓存路径 → launch(executablePath) → 实例生命周期
│   ├── scenario.ts           # 每场景独立 page；mock 拦截；DOM 断言；sha256 去重
│   ├── attachments.ts        # 截图写入附件存储并返回 image block（机制待确认，见 §5.1）
│   ├── cleanup.ts            # 临时产物清理钩子（userDataDir、截图、兜底 kill）
│   └── cli.ts                # 开发调试 CLI（可选：node lib/cli.js --url ...）
├── lib/                      # tsdown 产物（gitignore）
├── tests/                    # vitest（参照 vision）
└── README.md / README.zh.md  # 使用说明（含垃圾清理指引）
```

### 3.3 工具契约（MVP）

| 工具 | 参数（要点） | 返回（要点） | 失败行为 |
|---|---|---|---|
| `browser_open` | `url`、`viewport?={width:390,height:844}`、`wait?`（selector 或 networkIdle+超时）、`deviceScaleFactor?=2` | 页面状态：标题、可见关键元素、console 错误摘要、耗时 | 超时/加载失败返回明确错误，实例回收 |
| `browser_mock` | `urlPattern`（如 `**/api/lifeIndex.do*`）、`json`（响应体）、可选 `status` | 注册成功回执（pattern 列表） | 与已有拦截冲突时报错 |
| `browser_assert` | `selector`、`count?`（精确/范围）、`text?`（包含/相等）、可选 `timeoutMs` | 结构化结果：`{pass, count, actualText?, elapsedMs}` | 不满足即 `pass:false` 并附诊断 |
| `browser_screenshot` | `name?`、`fullPage?=false` | 图片引用（自动进模型上下文）+ 尺寸/哈希 | 失败返回错误，不生成孤立文件 |

**调用模型**：`browser_open` 建立"验证会话"，后续 `browser_mock`/`browser_assert`/`browser_screenshot`
作用于同一浏览器实例内最近打开的 page；工具间共享一个惰性单例浏览器（进程内），
空闲超时（如 10 分钟）自动关闭，插件 dispose 时强杀进程树。

### 3.4 内建默认（本会话踩坑沉淀，全部固化为默认行为）

1. **每场景独立 page**：杜绝"同 URL `page.goto` 不触发重导航、截图与上轮相同"的问题；
2. **DOM 断言优先于截图**：先 `count`/`text` 断言，断言不过就不用看图；
3. **截图去重**：每次截图后哈希，与上一张相同则警告"疑似未刷新页面"；
4. **视口默认 390×844 @2x**（移动端 UI 验证的常见形态）；
5. **cleanup 钩子**：Chromium `--user-data-dir=<temp>`（退出即删）、截图写临时目录、
   兜底 `process.kill` 进程树，确保不留孤儿进程/垃圾文件（见 §4.1）。

### 3.5 安装与迭代链路（vision 同款）

```bash
pnpm install && pnpm build && pnpm pack
dsh plugin --profile web add ./dsh-browser-verify-<version>.tgz
# 新开会话验证工具出现在目录中（工具注册在会话启动时完成）
```

- 版本钉住：pnpm 11 会扣留 24h 内的新发布，升级时同步 bump `cordis.patch.yml` 注释中的版本行
  （vision 的做法）；
- host 侧改动**无 HMR**，开发迭代需重打包重装；如开发期可直接 `dsh plugin --profile web add <目录>`，
  则迭代摩擦大减（待确认，见 §5.2）。

---

## 4. 可能遇到的问题

### 4.1 垃圾文件累计（重点，逐项对策）

用户的明确关注点：**不要造成垃圾文件累计**。垃圾来源盘点与对策如下：

| # | 来源 | 说明 | 对策 |
|---|---|---|---|
| 1 | 截图文件 | 每次 `screenshot` 生成 PNG，若落固定目录会无限累积 | 默认写临时目录（`os.tmpdir()/dsh-browser-verify-<pid>/`），工具结束后删除；如需保留，显式 `--persist` 到指定路径并打印路径供人工清理 |
| 2 | Chromium userDataDir | 不指定 `--user-data-dir` 时浏览器会在 `~/Library/Application Support/` 写 profile | 每次启动用临时 userDataDir，退出时递归删除（退出失败的兜底：注册 `zombie-kill`，见 #6） |
| 3 | 临时/崩溃残留 | 异常退出（kill -9）时 #1/#2 的目录可能残留 | 启动时对 `dsh-browser-verify-*` 做一次"清理上次孤儿"（带 mtime 阈值，如 >1h；只清自己前缀的） |
| 4 | `pnpm pack` 产物 | 每次开发迭代产生 `*.tgz` | **gitignore**（`*.tgz`、`lib/`、`node_modules/`）；文档附"定期清理"命令 |
| 5 | profile 内旧版插件 | `dsh plugin add` 安装的是包副本，升级后旧版本是否残留、是否自动清理**待确认**（§5.2）；若残留，需在文档给出清理命令 | 文档化：`~/.dsh/profiles/<profile>/` 下按插件名排查；更新时先 remove 旧版再 add 新版 |
| 6 | 孤儿/僵尸浏览器进程 | 工具超时或宿主崩溃时 Chromium 未退出，每泄漏一个≈数十 MB | 超时强杀 + 进程树 kill；启动时按 `--user-data-dir` 前缀反查残留进程并清理 |
| 7 | 验证报告/日志 | 若把断言报告、console 日志落盘会持续累积 | 默认全部走**工具返回值**（结构化 JSON + 文本），不落盘；仅 `--debug` 时写临时目录 |
| 8 | DSH 附件存储 | 截图若进 `~/.dsh/attachments`，其生命周期/TTL 由谁管理**待确认**（§5.1） | 确认后遵守其机制；超出机制的部分遵循 #1 的临时目录策略 |
| 9 | 浏览器缓存/下载 | 首次 `npx playwright install chromium` 会写 `~/Library/Caches/ms-playwright` | 复用已有缓存；确需下载时文档注明"整目录可删，删后重装" |

**总原则**：插件只允许在三个地方落东西——`os.tmpdir()` 下带自己前缀的临时目录（生命周期=一次工具会话）、
harness 附件存储（遵守其生命周期）、用户显式指定的 `--persist` 路径。任何"默认写盘"都必须有
对应清理钩子，杜绝"用一次留一份"。

### 4.2 进程与并发

- **进程泄漏**：Chromium 启动失败/工具异常/宿主退出，都要有兜底 kill（携带 userDataDir 作查找键）；
- **并发**：多个会话同时调用时，宿主进程内单例浏览器可能被抢——设计上"每个验证会话一个
  浏览器 context，工具间复用同一实例"，冲突时优雅串行（锁）或按会话隔离（待定，§5.4）；
- **可用性**：工具应尽快失败（探测不到浏览器→明确文案），不要静默 hang。

### 4.3 版本与协议

- DSH 内部 API（`ctx.tools.register`、schema DSL、附件机制）随版本演进，插件需维护
  （vision 通过 `engines.dsh: >=0.1.2-alpha.1` 约束下限，同样适用于本插件）；
- playwright-core 与缓存浏览器版本匹配（§2.2）：建议在插件内固化"已认证的版本组合"表，
  检测到组合变化时给出提示而非静默工作。

### 4.4 开发迭代摩擦

- host 侧无 HMR：每次改代码 → `pnpm build && pnpm pack && dsh plugin add`；
- 缓解：开发期若能直接 add 目录（§5.2）或提供 `--patch` overlay 指向本地 `lib/`；
- 测试：插件逻辑（driver/scenario/cleanup）写成可单测的纯函数，vitest 覆盖，减少"装进 harness
  才知道坏没坏"的循环。

### 4.5 其它

- **token 成本**：4 个工具的描述要精炼（工具定义进每次请求的上下文）；
- **适用范围**：只覆盖 H5/网页；微信/支付宝小程序端样式与 API 差异仍需 HBuilderX 真机/模拟器；
  OSS 上传、裁剪等依赖真机能力的流程无法无头走通；
- **信任边界**：插件是 harness 内受信代码，不读凭据、不访问外网、不做与验证无关的写操作。

---

## 5. 需要确认的点

1. **截图输出的附件机制**：宿主插件返回图片 block 的确切路径是什么？（vision 的
   `/llm-vision/attach` 是"输入方向"的附件化；输出方向需对照 DSH `packages/attachment` 与
   规范工具输出契约文档，确认 image block 如何投影给模型、如何持久化、TTL 归谁管。）
2. **`dsh plugin add` 的安装形态与升级残留**：装进 profile 的是 tgz 副本还是解包目录？
   旧版本是否累积、有无 remove 命令、开发期能否直接 add 本地目录（免 build/pack 循环）。
3. **playwright-core 版本 pin**：chromium-1234 对应的确切 playwright 版本（查其
   `browsers.json` 反推），并确认 `executablePath` 跑法在正式插件内的稳定性。
4. **浏览器实例的并发/复用策略**：多会话同时调用时的隔离模型（进程内单例+锁，或每会话独立实例），
   以及空闲回收时长（默认 10 分钟是否合适）。
5. **配置面**：MVP 不做 GUI 设置卡片，但 chromium 路径/视口/默认超时是否需要环境变量兜底
   （如 `DSH_BROWSER_VERIFY_CHROMIUM=...`）。
6. **CLI 双面**：`cli.ts` 定位为开发调试入口（与正式工具共用同一核心），是否随 MVP 一起交付，
   还是完全砍掉（保持单面、少维护）。
7. **多机迁移**：是否 git 化（用户当前用 gitee）——node_modules/浏览器缓存不随仓，
   安装脚本与清理指引需文档化（README 就是载体）。

---

## 6. 开工清单（后续会话按下述顺序执行）

1. 通读 `dsh-llm-vision` 的 `src/index.ts`、`cordis.patch.yml`、`package.json`、`tsdown.config.ts`，
   照搬插件注册与安装结构；
2. 查证 §5.1（附件输出路径）与 §5.2（plugin add 形态），必要时通读
   `dsh/docs/cookbook/extension-cookbook.md`、`adding-a-tool.md`、`packages/attachment`；
3. 搭 `driver.ts`：缓存探测 → `playwright-core` + `executablePath` 启动（headless shell 优先）；
4. 实现 `scenario.ts`（每场景独立 page、`route` 拦截、断言、哈希去重）与 `cleanup.ts`
   （临时 userDataDir/截图目录、孤儿进程兜底），先写成纯函数 + vitest；
5. `index.ts` 注册四工具（精炼描述），跑通"open→mock→assert→screenshot"最小闭环；
6. `pnpm build && pnpm pack` → `dsh plugin --profile web add <tgz>` → 新会话验证工具入目录；
7. 用真实业务页（如 hhhweb 的缴费页，mock 空/正常两态）做端到端冒烟，确认无垃圾文件累积
   （检查 `/tmp`、`~/Library/Application Support`、profile 目录前后对比）。

---

## 7. 参考

- 插件先例：`/Users/dongshuai/Desktop/AIWorks/dsh-llm-vision`（README、cordis.patch.yml、src/index.ts）
- DSH 文档（`/Users/dongshuai/Desktop/AIWorks/deepseek-harness/docs/`）：
  - `cookbook/extension-cookbook.md`（工具注册模式一览：MCP 一行、第一方 `defineTool`）
  - `cookbook/adding-a-tool.md`（工具定义真源）
  - `user/guide/mcp-memory.md`（MCP 配置示例，对照参考）
  - `packages/mcp/mcp-client/README.md`（MCP 桥接边界：只桥 tools、默认关闭、沙箱外受信代码）
  - `packages/skill/skill-filesystem/src/index.ts`（用户级 skill 路径 `~/.agents/skills`、`~/.dsh/skills`，
    若未来需要"文档发现层"可用）
- 业务侧经验（hhhweb `.learnings/LEARNINGS.md`）：
  - `LRN-20260901-001`：CDP 直连无头浏览器（Node 内置 WebSocket）的替代驱动方案，零依赖
  - `LRN-20260901-003`：prettier 全文件重排出大 diff 的教训（涉及旧文件保持风格）
