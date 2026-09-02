# AGENTS.md — dsh-browser-verify 项目规范

本文件是给 AI agent（及人类贡献者）的项目约定。**提效是本项目的核心思想**：任何设计取舍、代码改动、文档表述都以"更少调用、更省 token、零无谓开销、快速失败"为尺子。

## 项目定位

DeepSeek Harness 宿主插件：给模型四件只读浏览器验证工具（`browser_open` /
`browser_mock` / `browser_assert` / `browser_screenshot`）+ 精简调试 CLI。
差异化一句话：**"把网页验证变成几次工具调用"**——单态 ≤4 次、两态 ≤8 次
是验收线（实测 6 次）；截图自动以 image block 进入模型上下文；零落盘垃圾。

与 dsh-llm-vision 的关系：vision 处理"输入图像"，本插件处理"生成图像"
（projection 方向相反，`read_image` 同款输出机制）。

## 错误行为协议（错误即接口）

1. **前缀稳定可 grep**：所有抛出的 Error 消息以 `browser-verify: ` 开头并以
   可操作建议结尾（"请…"式指引）。测试按前缀断言；改动文案必须同步测试。
2. **失败=抛出，领域结果=规范 JSON**：基础设施/校验失败 throw；验证"未命中"
   是**领域结果**（`browser_assert` 返回 `pass:false` + 差异），绝不 throw——
   这是本插件的核心语义，不许回归。
3. **错误规范化在 driver 边界**（`wrapError`）：已带前缀的透传，否则包一层
   上下文 + 建议；CLI 与工具共用，禁止在 execute 里重复包裹。
4. **有界**：可见文本 ≤8 项×40 字符、console 错误 ≤5 条×120 字符、diff 截断
   120 字符——都是为了少烧 token。
5. **超时预算**：工具参数 `timeoutMs` 与墙钟 `withTimeout` 必须用同一个值
   （I11 修复后：`args.timeoutMs ?? envTimeoutMs()`）；禁止两套时钟。

## 架构

    src/index.ts           插件入口：name='browser-verify', inject=['tools']；
                            启动孤儿清扫（sweepOrphans：>1h 且排除本进程 pid 目录，
                            best-effort .catch）+ registerBrowserTools
    src/browser/discover.ts    纯函数：playwright 缓存探测（headless-shell>chromium，
                            高 revision 优先），KNOWN_REVISIONS（1234↔1.62.x）认证表，
                            env 覆盖 DSH_BROWSER_VERIFY_CHROMIUM；找不到 throw 安装提示
    src/cleanup.ts         纯解析：parseZombiePids（ps 文本→本前缀 pid）、
                            selectOrphanDirs（前缀+超龄+mtime 降序）
    src/browser/scenario.ts   纯函数（assertNoMockConflict/normalizeCountSpec/
                            summarizeVisibleText/capConsoleErrors/sha256Hex/textDiff）
                            + Scenario 类（page/context/mocks/assert/screenshot 去重）
    src/browser/driver.ts    进程内惰性单例（launchPersistentContext + 自管
                            userDataDir）、单一验证场景、FIFO chain 锁、空闲回收、
                            disposed 守卫、chained dispose、wrapError、close 失败
                            时 ps-SIGKILL 兜底（硬杀仅按本实例精确 user-data-dir）
    src/attachments.ts        saveScreenshot（saveImage + AttachmentError 码表翻译
                            + {cause}）+ renderScreenshotBlocks（text 信封 +
                            image block）+ assertImageCapable（模型能力闸门，
                            文本模型引导改用 browser_assert——最省 token）
    src/tools/index.ts       defineTool 四件套（描述为最终交付文案）；DSH_* env
                            （numberFromEnv 消毒）；每次注册一个 BrowserDriver
    src/tools/timeout.ts     withTimeout（弃赛者不 await）
    src/cli.ts               同核心的免 harness 调试入口（parseCliArgs 纯函数）

- **不变式**：纯函数与 IO 分层——纯函数可单测，IO（浏览器/ps/fs）由 Task 8 冒烟
  与实机闭环验证；scenario 类方法不含可单测新逻辑。
- **不变式**：每次 `browser_open` = 新 context+page（mock 状态全新）；mocks 必须
  **在首次导航前注册**（browser_open 内联 mocks / driver reset.mocks）——真实应用
  存在"未 mock 时启动即用户登出跳转"（hhhweb status -2 → switchTab），
  open→mock→reload 顺序永远回不到目标页（L10 裁决依据）。
- **不变式**：落盘点仅三处——`os.tmpdir()/dsh-browser-verify-<pid>/`（会话生命周期）、
  DSH 附件库（文档化生命周期）、CLI `--persist` 显式路径；报告/日志一律不落盘。

## 版本与依赖纪律

- `playwright-core` **精确 pin `1.62.0`（禁 `^`）**↔ chromium rev **1234**
  （本机缓存实证）；升级必须同步：package.json、KNOWN_REVISIONS 认证表、
  README ×2 的 `npx playwright install chromium` 注记、本文件。
- dsh 侧 devDeps（dsh-tools / dsh-attachment / dsh-llm）**对齐当前宿主版本**
  （现为 `^0.1.2-alpha.4`）；cordis ^4.0.1。宿主升级后必须 `pnpm install` +
  typecheck 验证契约（注意：defineTool 的 `parameters` 是**编译后 JSON Schema**、
  `output.render` 为必填——rc.8 起；新增参数节点必须带显式 `type` 与
  `additionalProperties`，否则 defineTool 注册即抛错）。
- **运行时 import 的宿主包必须同时声明在 peerDependencies 与
  devDependencies**（对照生态 dsh-context / dshmarket：dependencies 只放
  第三方，`@deepseek-ai/*` 一律 peer；0.1.1 的教训——只放 devDependencies，
  靠 `~/.dsh/profiles/node_modules` 共享层侥幸可解析，宿主升级时失去版本
  约束且无 peer 报警）。
- **用户可读文件（README ×2、cordis.patch.yml 注释）禁写开发者向指引**：
  不写 git 直装、不写 `add ./tgz` / `add <path>` 本地路径安装（0.1.1 时
  README 安装节与 patch 注释里都泄漏过此类内容）；本地构建安装只在
  Development 节出现（贡献者视角）。
- `engines`: node ^22.19.0 || >=24.0.0；dsh >=0.1.2-alpha.1。

## 配置纪律（改默认值需同步）

环境变量仅三个（`DSH_BROWSER_VERIFY_CHROMIUM` / `DSH_BROWSER_VERIFY_TIMEOUT`/
`DSH_BROWSER_VERIFY_IDLE_MS`），无 GUI 设置卡（有意为之——配置面最小化）。
默认值同时出现在：`src/tools/index.ts`（numberFromEnv 回退值）、README ×2
环境变量表、本文件。只改一处会静默漂移。

## 测试纪律

- 全部测试离线（无浏览器）；浏览器 IO 行为由 `scripts/smoke.sh`（需 hhhweb
  :5173）+ 实机两态闭环验证（`scripts/integration-notes.md` 记录）。
- 覆盖率口径（L11 裁决）：`vitest.config.ts` per-file ≥90% 语句仅针对
  discover / cleanup / attachments；scenario（纯函数全测、类方法 IO-bound）
  与 tools/cli 不在闸门内——新增纯模块应纳入 include。
- 新增能力必须带测试；错误文案断言行前缀 + 关键建议词，不断言完整文案。
- 工具 schema 通过 `defineTool` 真实注册即隐式校验（注册失败=测试失败）。

## 常用命令

    pnpm install / build（clean 构建：先 rm lib）/ test / typecheck
    pnpm vitest run --coverage        # 覆盖率闸门
    pnpm pack                         # 发布产物
    node lib/cli.js --url <u> ...     # 免 harness 调试
    bash scripts/smoke.sh             # 两态端到端（需 hhhweb :5173）

## 发布检查清单（npm publish 前逐项过）

1. `pnpm typecheck && pnpm test && pnpm build` 全绿；`pnpm pack` 产物含
   lib/（index + cli + 唯一 driver chunk）与 cordis.patch.yml、README.md、
   LICENSE（`pnpm pack` 会先 clean 构建——**先跑 build 再 pack**，否则 tgz
   内 lib 是旧的）。
2. 版本号三处同步：package.json `version`、README ×2 安装钉扎命令、
   git tag。
3. 发布前核对包声明与文档：运行时 import 的宿主包在 peerDependencies +
   devDependencies；README ×2 安装节只含 registry 安装；cordis.patch.yml
   注释为用户向（无 git / 本地路径安装指引）。
4. 发布后验证：`dsh plugin --profile web add dsh-browser-verify@<version>`
   安装成功 + `--dump-config` 出现 `# == dsh-browser-verify` 层。
5. GitHub：topics 必含 `dsh-plugin`（生态抓取靠它），description 保持一句
   定位话；给 Release 附变更摘要。

**安装路径事实（写文档/注释时不许再写错）**：
- 已发布包名 `dsh-browser-verify`（无 scope）；`dsh plugin add <name>@<ver>`
  按包名从 registry 解析。
- git 直装需要 prepare 脚本 + 用户 allowBuilds——本仓库未提供 `prepare`，
  **文档不得写 git 直装方式**。
- 浏览器缓存不随包分发：安装机需 `npx playwright install chromium`
  （playwright-core@1.62.0）或设 `DSH_BROWSER_VERIFY_CHROMIUM`。

## 关键事实（改实现前先读）

- **参考应用 hhhweb**：uni-app hash 路由（`/hweb/#/pages/lyp/livingPayment`）；
  响应信封 `{status, result}`（`{code,data}` 会进解密分支白屏）；缴费列表项
  真实键 `wegType/name/info`；空态 `.empty-wrap`、条目 `.grid-item`（初始为
  加载骨架，textContent 仅"查看详情"——断言需等真实条目）；boot 即 3 个
  `*.do*` 接口。
- **单机假设**：启动清扫仅处理超龄本前缀 pid 目录；同机多实例安全。
- **平台**：已验证 macOS arm64（`SUBDIRS` 为 arm64 布局）；其他平台走
  DSH_BROWSER_VERIFY_CHROMIUM。
- **ps 依赖**：cleanup/killProcessTree 路径依赖 `ps`——在禁用 ps 的沙箱内
  行为降级为无操作（冒烟中 `pgrep` 是替代证据）。
