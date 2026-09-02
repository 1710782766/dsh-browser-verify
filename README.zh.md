# dsh-browser-verify

面向 DeepSeek Harness Web GUI 的只读浏览器验证工具——**≤4 次工具调用**即可验证一个页面（H5/桌面），覆盖 mock 拦截、DOM 断言、截图自动投影进模型上下文。如果你的验证场景能被以下四件套覆盖，本插件相比临时搭建验证工具链（装浏览器、探测缓存、写场景脚本、人工读图）大约 4 次调用对 ~20 个步骤。

- **工具面**：`browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot`
- **范围**：仅只读验证（无点击/输入/滚动）。通过 `playwright-core` 驱动无头 Chromium（插件侧不下载浏览器）。
- **许可证**：Apache-2.0

## 安装

> 插件在 harness 进程内运行，安装目标是 harness profile；`dsh plugin` 命令在 harness checkout 下执行。

### 从打包 tgz 安装（本地/私有使用推荐）

```bash
pnpm install && pnpm build && pnpm pack     # → dsh-browser-verify-<版本号>.tgz
dsh plugin --profile web add ./dsh-browser-verify-<版本号>.tgz
```

### 从目录 link 安装（开发调试）

```bash
pnpm build                                  # lib/ 被 gitignore——先构建
dsh plugin --profile web add /路径/dsh-browser-verify
```

### 从 git URL 安装（git+https）

pnpm 安装 git 依赖时先克隆仓库再执行其 `prepare` 脚本：因此远端仓库必须定义 `prepare`（构建 `lib/`），且目标 profile 必须在 `pnpm-workspace.yaml` 的 `allowBuilds` 中放行该构建脚本。本仓库已验证的安装路径为上述 tgz 与目录 link 两种。

安装后重启 harness GUI、新开会话，四个工具即出现在工具目录中。

## 快速上手

```text
browser_open  url="http://localhost:5173/hweb/#/pages/lyp/livingPayment" waitSelector=".header"
        在新场景中打开页面（无头 Chromium，默认视口 390×844 @2x），返回标题/状态码/可见文本/
        console 错误。对于启动即依赖接口数据的页面，可在此传 mocks 在首次导航前完成拦截。
```

```text
browser_mock  urlPattern="**/api/*.do*" json={status:0,result:{list:[],data:{}}} status=200
        注册 playwright glob 路由拦截并自动 reload 当前页，展示 mock 后的状态。pattern 重复会
        报错：请 browser_open 重开场景，或换一个 urlPattern。
```

```text
browser_assert  selector=".empty-wrap" count=1 text="暂无可用缴费服务"
        等待选择器出现（默认 5s），返回 {pass, count, actualText, elapsedMs}——不满足时是正常的
        pass:false，绝不抛错。这是最省 token 的验证手段；先断言，确有必要再截图。
```

```text
browser_screenshot  name="livingPayment-empty" fullPage=false
        截取当前页并将图片块自动投影进模型上下文；返回尺寸/哈希，若与上一张字节完全一致则
        附 identicalToPrevious:true（疑似页面未刷新——请 browser_open 重开）。
```

## 环境变量

| 变量 | 默认值 | 含义 |
|---|---|---|
| `DSH_BROWSER_VERIFY_CHROMIUM` | （未设置） | Chromium 二进制完整路径，优先级高于缓存探测；启动时校验存在性，路径有误会给出提示。 |
| `DSH_BROWSER_VERIFY_TIMEOUT` | `10000` | 超时（ms）：页面加载 / 等待选择器 / mock reload；仅包裹 `browser_open` 的页面加载路径（其余三个工具仅 FIFO 串行，无墙钟超时）。 |
| `DSH_BROWSER_VERIFY_IDLE_MS` | `600000` | 空闲回收窗口（ms），到时自动关闭浏览器实例；插件 dispose 时无论如何会强制清理。 |

## 垃圾清理

本插件只会在系统临时目录（自己的 `dsh-browser-verify-*` 前缀）、harness 附件库、以及你显式指定的 `--persist` 路径落东西。启动时会清扫过期残留目录（>1h、仅限自己的前缀）并兜底杀死孤儿 Chromium；但宿主崩溃后仍建议手动执行：

```bash
# 崩溃残留的临时目录/profile 目录（注意 macOS tmpdir 不是 /tmp）
rm -rf "$(node -p 'require("os").tmpdir()')/dsh-browser-verify-*"
```

- **附件库**：截图持久化到 harness 全局附件库 `~/.dsh/attachments`（内容寻址，相同字节自动去重）。其生命周期由 harness 附件库管理，不随工具退出删除。
- **Playwright 缓存**：首次安装（`npx playwright install chromium`，需 `playwright-core@1.62.0`）写入机器级缓存（`~/Library/Caches/ms-playwright`）。整个目录可整删后重装；插件本身只会探测该缓存中的可用二进制，不会自行下载。
- **打包产物**：`pnpm pack` 产生的 `*.tgz` 已被 gitignore，可随意删除。

## 开发

```bash
pnpm install
pnpm build            # tsc -b && tsdown  → lib/
pnpm test             # vitest run
pnpm vitest run --coverage   # discover/cleanup/attachments 逐文件语句覆盖 ≥90% 门槛
pnpm typecheck
node lib/cli.js --url 'http://localhost:5173/hweb/#/pages/lyp/livingPayment' \
  --mock tests/fixtures/mock-empty.json --wait-selector '.header' \
  --assert '.empty-wrap' --screenshot
scripts/smoke.sh      # 两态端到端冒烟；需要 hhhweb dev server 在 :5173 运行
```

CLI 选项：`--url <u>`（必填）、`--mock <file.json>`、`--wait-selector <sel>`、`--assert <sel>`、`--screenshot`、`--persist <dir>`（保留 PNG）、`--viewport <WxH>`。

## 多机迁移

1. 复制/克隆本仓库并执行 `pnpm install && pnpm build && pnpm pack`。
2. 在目标机器 `dsh plugin --profile web add ./dsh-browser-verify-<版本号>.tgz`。
3. 浏览器缓存**不随仓库**：先 `npx playwright install chromium` 安装一次（或将 `DSH_BROWSER_VERIFY_CHROMIUM` 指向已有二进制）。

## 真实应用注意事项

- uni-app H5 页面使用 hash 路由（`/hweb/#/pages/...`），API 响应信封为 `{status, result}`——均已在参考应用（hhhweb）实测确认。
- 真实 API 返回“session invalid”时会跳转/回退的路由：mock 必须在导航前注册——请通过 `browser_open` 的 `mocks` 传入（CLI 则用 `--mock`）。
