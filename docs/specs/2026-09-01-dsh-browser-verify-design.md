# dsh-browser-verify 设计文档

> 状态：**设计定稿**（2026-09-01，用户确认）
> 本文档由本次设计研讨固化而来；背景与项目由来见仓库根目录 [`DESIGN.md`](../../DESIGN.md)（历史备忘，不再更新）。
> 实施依据：本设计 + [`docs/plans/2026-09-01-dsh-browser-verify-plan.md`](../plans/2026-09-01-dsh-browser-verify-plan.md)。

---

## 0. 设计判据：提效优先（核心思想）

本工具存在的唯一理由是**提效**：把一次页面验证从"搭工具链 + 反复看图"的 40+ 步压缩到少数几次工具调用。**每一个设计决策都用这把尺子量**——与提效无关的功能一律砍掉（YAGNI），与提效相反的做法（多一步调用、多余 token、多余落盘、静默 hang）一律禁止。

| 判据 | 含义 | 落地 |
|---|---|---|
| 步数最少 | 一次验证 ≤ 4 次工具调用（open→mock→assert→screenshot） | 每工具一次调用完成一件完整的事 |
| token 最小 | 工具描述精炼（≤ ~300 字符）；返回只给结构化关键值 | 四件套描述"一句话用途 + 参数要点"；断言失败给紧凑差异而非页面 dump |
| 能不看就不看 | 能断言就不截图；截图能复用就不重复 | DOM 断言优先写入工具描述；sha256 去重 + `identicalToPrevious` 警告 |
| 快速失败 | 工具内部统一超时（默认 10s，可配），失败消息给**可操作**的下一步 | 探测不到 chromium → 直接给 install 命令；拦截冲突 → 报错并列出已有 pattern |
| 零无谓开销 | 不验证页面的会话不花任何时间/token/磁盘 | 浏览器惰性单例（首次 `browser_open` 才启动）；无 client 半无 GUI 卡；报告不落盘 |
| 安装一次、处处可用 | 一个插件覆盖所有会话/所有项目，零逐项目配置 | 默认值硬编码 + 环境变量兜底 |
| 自身迭代要快 | 插件开发循环同样提效 | 纯函数 + vitest + CLI 调试 + `dsh plugin add 目录`（pnpm link 免 pack） |
| YAGNI | 与提效无关的复杂度一律砍 | 交互工具、多断言语法、GUI 卡、报告文件均不进 MVP |

**验收指标（量化底线）**：hhhweb「我的缴费」页空态/正常态两态验证，**单态 ≤ 4 次、两态 ≤ 8 次工具调用**（对照 DESIGN.md 复盘的手工流程约 20 步）、总 token 显著低于复盘值（1.7M）；工具空闲时宿主零额外开销；冒烟前后 `/tmp`、`~/Library/Application Support`、DSH 附件库无预期外残留（§9）。

---

## 1. 范围

### 1.1 MVP（本次交付）

- **只读验证四件套**：`browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot`
- **只做宿主半**：无 `dsh.client` 声明、无 GUI 设置卡、无附件上传路由
- **精简 CLI**：`node lib/cli.js --url ...` 开发调试入口，与正式工具共用同一核心，随 MVP 交付
- 目标页面：uni-app H5 等**一般网页**（本地 dev server、mock 接口验证）；移动端形态优先（默认视口 390×844 @2x）

### 1.2 明确不做（YAGNI 清单，进二期需重新证明提效）

- 交互工具（click / input / scroll / wait 手势）——二期
- client 半、GUI 设置卡、设置文档页
- 验证报告/日志落盘（全部走工具返回值）
- 多断言语法、批量 mock 表达式
- 自动清理 DSH 附件库（属 DSH 文档化生命周期，README 给人工清理指引）
- 微信/支付宝小程序端验证（需真机/模拟器，非无头场景）

---

## 2. 环境与约束

| 项 | 值 |
|---|---|
| 机器 | macOS Apple Silicon（arm64）；Node `^22.19.0 \|\| >=24.0.0`；pnpm 11.x |
| DSH | `dsh >=0.1.2-alpha.1`（照搬 vision 的 `engines`） |
| 浏览器缓存 | `~/Library/Caches/ms-playwright/`：`chromium_headless_shell-1234`、`chromium-1234`（另有旧 rev 1200 等） |
| playwright pin | **`playwright-core@1.62.0` 精确钉死**（已查证：1.62.0 的 `browsers.json` 中 chromium revision = 1234，与本机缓存精确匹配；跑法为显式 `executablePath`，可强跑） |
| 沙箱 | 宿主插件运行在 harness 进程内，**不受 agent 会话文件沙箱限制**（启动 Chromium、写临时目录均无需逐次审批）；插件代码因此是**受信代码**（§12） |
| hhhweb 参考页 | `/Users/dongshuai/Desktop/works/hhhweb/pages/lyp/livingPayment.vue`，dev server `localhost:5173`，基路径 `/hweb/`，`/api/*` 代理业务后端 |

---

## 3. 总体形态与目录结构

单 bundle `dsh-browser-verify`，与 `dsh-llm-vision` 同构：

```
dsh-browser-verify/                  ← 本仓库即插件仓库
├── docs/
│   ├── specs/2026-09-01-dsh-browser-verify-design.md   （本文档）
│   └── plans/2026-09-01-dsh-browser-verify-plan.md     （实施计划）
├── package.json                     # dsh.bundle.patch；engines；exports["."]；playwright-core 精确 pin
├── cordis.patch.yml                 # 向 web profile 插入一行 {id: browser-verify, name: dsh-browser-verify}
├── tsdown.config.ts / tsconfig.json / tsconfig.host.json / tsconfig.vitest.json
├── vitest.config.ts
├── src/
│   ├── index.ts                     # 组装：启动时 cleanupOrphans；discover 惰性调用；注册 4 工具；dispose 强杀
│   ├── browser/
│   │   ├── discover.ts              # 缓存二进制探测（纯函数）
│   │   ├── driver.ts                # 浏览器/验证会话生命周期、空闲回收、强杀兜底
│   │   └── scenario.ts              # 每场景独立 page；route 拦截；DOM 断言；sha256 去重（核心逻辑纯函数化）
│   ├── tools/
│   │   └── index.ts                 # 4 个 defineTool（schema + 精炼描述 + execute 薄壳）
│   ├── attachments.ts               # saveImage 封装 + image block 渲染（照搬 read_image 模式）
│   ├── cleanup.ts                   # 孤儿临时目录 / 残留进程清理（解析部分纯函数）
│   └── cli.ts                       # 调试 CLI（复用 browser/ 核心）
├── lib/                             # tsdown 产物（gitignore）
├── tests/                           # vitest：discover / scenario / cleanup / attachments 纯函数；tools 注册冒烟
└── README.md / README.zh.md         # 安装、环境变量表、垃圾清理指引、迭代命令
```

**分层原则**：`browser/` 与 `cleanup.ts`、`attachments.ts` 的纯逻辑不 import 任何 harness 类型（`@deepseek-ai/*` 只出现在 `index.ts` / `tools/` 与类型声明处），让核心能被 CLI 复用、被 vitest 全覆盖，避免"装进 harness 才知道坏没坏"的循环。

---

## 4. 浏览器驱动（discover + driver）

### 4.1 discover.ts（纯函数）

```ts
export type BrowserKind = 'headless-shell' | 'chromium'
export interface DiscoveredBrowser {
  executablePath: string
  kind: BrowserKind
  revision: number            // 目录后缀数字，如 1234
  known: boolean              // revision 是否在已知对照表内
  versionHint: string | null  // known=false 时给出提示文案
}
export function discoverBrowser(opts: {
  cacheDir?: string           // 默认 ~/Library/Caches/ms-playwright
  overridePath?: string       // env DSH_BROWSER_VERIFY_CHROMIUM
}): DiscoveredBrowser        // 找不到时 throw，message 含可操作下一步
```

- 探测顺序：`chromium_headless_shell-<rev>` → `chromium-<rev>`（取**最高 rev** 目录）；`overridePath` 存在时直接用它（kind='custom'，跳过校验）。
- 每个候选：`<dir>/<sub>/...` 下可执行文件需 `fs.existsSync`；headless shell 相对路径 `chrome-headless-shell-mac-arm64/chrome-headless-shell`，完整 chrome `chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`。
- 已知对照表（固化进代码，含本机已装 rev；未知 rev 不拒绝，置 `known:false` + `versionHint` 并在 open 返回里呈现）：`{ 1234: '1.62.x' }`（1.62.0 的 chromium rev 恰好 1234；见 `playwright-core@1.62.0` 的 `browsers.json`）。
- 全部找不到：throw：`未找到浏览器二进制。请安装：npx playwright install chromium（需 playwright-core ^1.62.0），或设置 DSH_BROWSER_VERIFY_CHROMIUM=<完整路径>`。

### 4.2 driver.ts（生命周期）

```ts
export class BrowserDriver {
  async openSecurity(): Promise<Scenario>   // 建会话：context+page（惰性启动浏览器）
  async withLock<T>(fn: () => Promise<T>): Promise<T>   // 全局 FIFO 串行锁
  get current(): Scenario | null
  dispose(): Promise<void>                  // 关闭浏览器 + 强杀进程树
}
export interface Scenario {
  page: Page
  context: BrowserContext
  mocks: Map<string, MockRule>              // pattern -> {json, status}
  lastScreenshotHash: string | null
  close(): Promise<void>                    // 关 context，递归删 userDataDir
}
```

- **惰性单例**：`browser_open` 首次调用才 launch；不打开页面的会话零开销。
- **会话语义**：进程内至多一个活动验证会话；每次 `open` 是幂等的"重置"——关闭旧 context/page（清空 mock、lastScreenshotHash），新建独立 context + page（固化踩坑①：杜绝同 URL `page.goto` 不触发重导航）。
- **并发**：`withLock` 全局 FIFO；所有工具调用（open/mock/assert/screenshot）都持锁执行；锁等待不设软上限但受工具总体超时保护（§7）。
- **空闲回收**：context 空闲 `DSH_BROWSER_VERIFY_IDLE_MS`（默认 600000）关闭；浏览器全空闲同阈值整个 close。回收定时器属于插件 fiber（`ctx.effect`），dispose 时全部取消。
- **启动参数**：`--user-data-dir=<os.tmpdir()/dsh-browser-verify-<pid>>`（尾随每次 launch 新建、close 递归删除）、headless 恒真（headless shell 本身无头；fallback 全量 chrome 时 `--headless`）；不传 `--no-sandbox`（macOS 不需要）、不传任何外联/网络参数。
- **强杀兜底**：`dispose()` 与工具异常路径调用 `killProcessTree(pid)`（按 `ps -Ao pid,ppid,command` 找子进程树，SIGKILL）；userDataDir 前缀作为反查键（§6）。

---

## 5. 工具契约（MVP 四件套）

会话模型见 §4.2。所有工具描述遵循 §0 判据：一句话用途 + 参数要点 + 关键失败提示（完整文案见实施计划，作为 copy-paste 真源）。

```ts
// browser_open
parameters: {
  url:        { type: 'string', required: true, description: '页面地址，如 http://localhost:5173/hweb/... ' },
  viewport:   { type: 'object', ... default {width:390,height:844} },
  deviceScaleFactor: { type: 'number', default 2 },
  waitSelector: { type: 'string', description: '可选：等待该选择器出现后再返回（优先于时间等待）' },
  timeoutMs:  { type: 'number', default 10000 },
}
output value: {
  title: string, url: string, status: number|null,
  visible: string[]                 // 定义：body 内前 8 个「有非空白 textContent 且可见」的元素的文本去重项，每项 ≤40 字符
  consoleErrors: string[]           // 定义：page 'console'(type=error) + 'pageerror' 事件收集，≤5 条，每条 ≤120 字符
  elapsedMs: number,
  versionHint: string|null          // 来自 discover（未知 rev 提示）
}
```

```ts
// browser_mock  —— 无 open 会话时 throw「请先 browser_open」
// 语义：注册拦截后**默认自动 reload 当前页**（reload:true），保证拦截对页面加载立即生效——
// 否则「open→mock→assert」测不到 mock 效果，需要多次 open 才能轮换场景，违背 ≤4 次判据。
parameters: {
  urlPattern: { type: 'string', required: true, description: 'glob，如 **/api/lifeIndex.do*（playwright route 语法）' },
  json:       { description: '响应体（任意 JSON）', required: true },
  status:     { type: 'number', default 200 },
  reload:     { type: 'boolean', default true, description: '注册后自动 reload 当前页' },
}
output value: { patterns: string[] }
// 失败：与已注册 pattern 完全相同的字符串冲突 → throw 并列出已有 patterns；
// 其余冲突（不同字符串、同实际 URL）不检测（YAGNI）。
```

```ts
// browser_assert
parameters: {
  selector: { type: 'string', required: true },
  count:    { oneOf: [number, {min:number,max:number}] },        // 与 DOM 匹配数比较
  text:     { type: 'string', description: '匹配元素 textContent 的包含谓词（默认 contains）' },
  timeoutMs:{ type: 'number', default 5000 },
}
output value: { pass: boolean, count: number, actualText: string|null, elapsedMs: number }
// 流程：waitForSelector(selector, {timeout}) → count + 首个元素的 textContent（截断 120 字符）
// → 与 count/text 期望比较。text 只验证「包含」（equals 不做，YAGNI）。
// 失败≠ throw：pass:false + 紧凑差异（count 期望/实际、text 期望/实际前缀）。
```

```ts
// browser_screenshot
parameters: {
  name:     { type: 'string', description: '可选命名（进附件名）' },
  fullPage: { type: 'boolean', default false },
}
output value: {
  image: { attachmentId, mediaType:'image/png', bytes, width, height, name? },
  sha256: string,
  identicalToPrevious: boolean,
}
render: [{type:'text', text: 尺寸/字节/去重警告}, {type:'image', attachment: imageRef}]
```

- **先例**：完全照搬 `packages/fs/tool-fs/src/read-image.ts` 的输出方向模式（`attachments.saveImage` → 结构化 value → render 出 image block）。cap 用 `attachments.imageLimits.maxImageBytes`（与 read_image 相同，超限报错并提示降 `fullPage` 或 reduce）。
- **image 路由门**：执行时校验当前模型路由声明图片输入（复用 read_image 的 `assertImageCapableRoute` 语义：`exec.agent.session.requestHeader().config` + `ctx.get('llm').resolveModelInfo`）；不满足 → throw：`当前模型不支持看图：改用 browser_assert 做文本断言（更省 token），或切换到图片模型后重试`——错误文案本身就是提效引导。
- **去重**：截图字节 sha256 与 `scenario.lastScreenshotHash` 比较；相同 → `identicalToPrevious:true`（text 块注明"疑似页面未刷新，请先 browser_open 重开或修改后重试"），仍照常返回 image block。`attachments.saveImage` 本身 content-addressed 幂等，同图不重复占空间。
- **失败**：非零抛错，不生成孤立文件；成功才算一次调用。

---

## 6. 垃圾管控（用户核心关注）

**总原则**：插件只允许在三个地方落东西——`os.tmpdir()` 下带自己前缀的临时目录（生命周期=一次会话）、DSH 附件存储（遵守其文档化生命周期）、用户显式 `--persist` 路径（仅 CLI）。

| 来源 | 处置 |
|---|---|
| Chromium userDataDir | `os.tmpdir()/dsh-browser-verify-<pid>/`；生命周期 = 浏览器实例（launch → close），关闭即递归删除（场景 context 只影响页面装态，不新建目录） |
| CLI 调试产物 | 同一临时目录；`--persist <dir>` 时写指定目录并打印完整路径 |
| 崩溃残留（kill -9） | `cleanup.ts`：启动时清同前缀目录（`mtime > 1h`）+ 按 `--user-data-dir` 前缀反查残留进程 kill（只清自己前缀；ps 解析为纯函数） |
| 截图 → 附件库 | DSH 文档化生命周期（**不自动删除**）；sha256 幂等；README 给清理方法（与用户手动贴图、`read_image` 的既有生命周期一致，非插件新增垃圾面） |
| 报告/日志 | 一律不落盘，全走工具返回值；仅 CLI `--debug` 写临时目录 |
| `*.tgz` / `lib/` / `node_modules` | gitignore；README 给清理命令 |

---

## 7. 错误处理与失败策略

- **统一超时**：每个工具调用默认 `DSH_BROWSER_VERIFY_TIMEOUT=10000`（ms）；goto/waitForSelector/断言自身再乘系数不足时由外层 abort（`exec.signal` 优先；driver 操作链带 `AbortSignal.timeout` 兜底）。
- **可操作消息**：所有 throw 的 message 以 `browser-verify: ` 前缀 + 下一步建议结尾（如 install 命令、重开场景、改用断言）。禁止静默 hang、禁止返回错误码让模型猜。
- **快速失败**：discover 失败在 open 时立即 throw（不挂起、不重试 3 次）；mock 冲突立即 throw。
- **资源回收**：任何工具异常路径 `finally { 释放锁 }`；超时/异常后 scenario 保持可用（page 可能已坏，下一次 open 重置）；进程崩溃场景由 cleanup 兜底。

---

## 8. 配置面（无 GUI）

默认值硬编码 + 3 个环境变量兜底（宿主进程环境变量；**不做** `cordis.patch.yml` 的 `config:` 块——vision 注释已说明 patch 层 config 只作卡片默认值，MVP 无卡片）：

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `DSH_BROWSER_VERIFY_CHROMIUM` | 无（自动探测） | 指定浏览器二进制完整路径 |
| `DSH_BROWSER_VERIFY_TIMEOUT` | `10000` | 单次工具调用超时（ms） |
| `DSH_BROWSER_VERIFY_IDLE_MS` | `600000` | 验证场景/浏览器空闲回收时间（ms） |

---

## 9. 测试策略

1. **单测（vitest，覆盖纯函数）**：
   - `discover`：探测顺序、override 优先、未知 rev 的 `known:false`、全部缺失的错误文案；
   - `scenario`：glob 注册/去重冲突、断言期望归一化（count 数字/范围）、差异文案截断、sha256 去重判定；
   - `cleanup`：目录年龄/前缀判定、ps 输出解析（注入 fake ps 文本）；
   - `attachments`：value→imageRef 映射、render 块构造（注入 fake value）；
   - `tools`：4 工具的 schema 合法、参数校验与错误映射（fake ctx 捕获注册；不启动浏览器）。
   - 目标：上述纯模块语句覆盖率 ≥ 90%。
2. **CLI 冒烟（真实浏览器）**：hhhweb 缴费页两态（mock 空态/正常态）跑 open→mock→assert→screenshot 闭环；既是核心验证，也是垃圾验收的对照样本。
3. **实装验证**：`dsh plugin --profile web add <目录>` → dump-config 出现 `# == dsh-browser-verify` 层 → 新会话工具入目录 → 模型侧真实调用四件套。
4. **垃圾验收**：冒烟前后对比 `/tmp`、`~/Library/Application Support`、DSH 附件库增量——/tmp 无新增（或仅 <1h 内已清理的）、附件库增量 = 截图数、无孤儿 Chromium 进程（`ps` 检查）。

---

## 10. 安装与迭代链路（已查证）

| 场景 | 命令 | 备注 |
|---|---|---|
| 开发期装载 | `dsh plugin --profile web add /Users/dongshuai/Desktop/AIWorks/dsh-browser-verify` | **pnpm link 本地 checkout**（查证 `docs/user/develop/basic/publish.md`：add 目录 = `"link:/path"` 依赖 + bundle 层）；改完 `pnpm build` 后重启 dsh 生效（host 无 HMR） |
| 调试核心逻辑 | `node lib/cli.js --url ...` | 不碰 harness、不重启 |
| 发布 | `pnpm build && pnpm pack` → `dsh plugin add ./dsh-browser-verify-<v>.tgz` | 或 npm 发布（lib 产物）；gitee/git 安装需 `prepare` 自构建脚本 + `allowBuilds` 白名单，README 记录 |
| 升级 | `dsh plugin --profile web remove dsh-browser-verify` 后 `add` 新版；`cordis.patch.yml` 注释中的版本号同步 bump | pnpm 11 扣留 24h 内新发布 |

---

## 11. 工程与发布约束

- `package.json`：`name: dsh-browser-verify`、`version: 0.1.0`、`type: module`、`main: lib/index.js`、`exports["."]`、`engines`（§2）、`dependencies: { playwright-core: "1.62.0" }`（**精确 pin**，禁止 `^`）、`devDependencies`：tsdown 0.22.2、typescript ~5.7.2、vitest ^3.0.0、@deepseek-ai/cordis ^4.0.1、@deepseek-ai/dsh-tools（版本对齐 vision 的 devDeps）。
- `dsh.bundle.patch: ./cordis.patch.yml`；`cordis.patch.yml` 仅插入一行（`id: browser-verify, name: dsh-browser-verify`），注释模板照搬 vision（版本行 + 安装命令），**无 config 块**。
- git 化：本仓库 `git init`；`.gitignore`：`lib/`、`node_modules/`、`*.tgz`、`coverage/`、`docs/**` 除外（docs 随仓）。远程按用户 gitee 习惯自配（README 记录多机迁移：安装 = `dsh plugin add ./tgz` 或 `git+https://…(需 prepare+allowBuilds)`；浏览器缓存不随仓，复用或 `npx playwright install chromium`）。

---

## 12. 信任边界

- 插件运行在 harness 进程内 = 受信代码：**不读取凭据**、**不做网络外呼**（浏览器只访问工具参数给出的 URL）、不做与验证无关的写操作；
- 唯一第三方运行时依赖 `playwright-core@1.62.0`；浏览器复用本机既有缓存，**不触发任何下载**（install 提示仅是文案，不自动执行）；
- CLI 只读本机文件系统与本地 dev server，不接 harness 状态；
- `browser_mock` 只作用于本场景 page 的请求拦截，不改动业务代码/数据。

---

## 13. 已查证的开放问题裁决（原 DESIGN.md §5）

| # | 问题 | 裁决 | 证据 |
|---|---|---|---|
| 1 | 截图输出附件机制 | 走 `ctx.attachments.saveImage` + render image block（read_image 同款）；附件存储 TTL 归 DSH（不自动删），README 文档化清理 | `packages/fs/tool-fs/src/read-image.ts`；`packages/attachment` |
| 2 | `dsh plugin add` 形态 | 目录 = pnpm link 本地 checkout（免 pack）；`remove` 存在；git 安装需 `prepare`+`allowBuilds` | `docs/user/develop/basic/publish.md` |
| 3 | playwright 版本 pin | **`playwright-core@1.62.0`**（chromium rev 1234 精确匹配本机缓存；1.62.0 browsers.json 实证） | playwright-core@1.62.0 `browsers.json` |
| 4 | 并发/复用 | 进程内浏览器单例 + 单一验证会话 + FIFO 锁串行；空闲回收 10 分钟 | §4.2 |
| 5 | 配置面 | 无 GUI 卡；3 个环境变量兜底 | §8 |
| 6 | CLI | **保留**精简 CLI（复用核心，随 MVP） | 用户确认 |
| 7 | 多机迁移 | git 化 + README 记录安装/清理/迁移指引 | §11 |

---

## 14. 参考

- 先例插件：`/Users/dongshuai/Desktop/AIWorks/dsh-llm-vision`（package.json / cordis.patch.yml / src/index.ts / attach-routes.ts）
- harness 文档（`/Users/dongshuai/Desktop/AIWorks/deepseek-harness/`）：
  - `docs/cookbook/adding-a-tool.md`（工具契约：defineTool / output.render / exec.signal）
  - `docs/user/develop/basic/publish.md`（bundle + profile + plugin add/remove）
  - `packages/fs/tool-fs/src/read-image.ts`（image block 输出方向先例：saveImage → {type:'image', attachment}）
  - `packages/attachment`（附件存储生命周期）
- 历史：`DESIGN.md`（项目由来、首次踩坑复盘、§5 问题清单）
