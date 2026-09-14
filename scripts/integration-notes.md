# dsh-browser-verify 实装集成验证记录

> 状态：Step 1–5 ✅ 全部完成（Step 3–4 在本会话内闭环验证；宿主已更新至 0.1.2-alpha.4 后实测）。

## 0.1.3 复验 — 快照时机 + 噪音过滤 ✅（用户体验报告驱动）

用户实测反馈两点：① 第二次 open（未传 waitSelector）返回 `visible: []`（uni-app
启动早期采样）；② 摘要混入 showLoading 残留"加载中..."。定性为 **open 快照时机
偏早 + 加载态噪音**，修复为：未传 waitSelector 时默认等渲染稳定（连续两次相同非空
可见文本采样，间隔 250ms、上限 min(timeoutMs, 3000)），`summarizeVisibleText`
过滤 `NOISE_TEXT_PATTERN`（加载中/正在加载/请稍候/loading，全串锚定，不伤
加载失败/加载更多等业务态）。

实机复现与修复后验证（hhhweb :5173 真实态 URL + 两态 mock）：

| 场景 | 0.1.2（修复前） | 0.1.3（修复后） |
|---|---|---|
| open 无 waitSelector（真实态 uid/rid） | `visible: []`, 502ms | `["我的缴费","便捷生活 从缴费开始","暂无可用缴费服务"]`, 1440ms |
| open `waitSelector='.header'`（真实态） | visible 混入 `"加载中..."` | 无噪音（settle 后采样 + 过滤双保险） |
| smoke 空态 / 正常态 / 无 wait-selector 回归护栏 | — | 三条全过；无残留、无僵尸（沙箱禁 ps 时降级 0） |

单测 39 → 41（新增 isNoiseText / summarize 噪音过滤两例）；工具描述与 README ×2
同步；版本 0.1.3。

## 0.1.4 复验 — 浏览器发现链 A+B ✅（生态摩擦优化）

实施：探测链 = env 覆盖 → playwright 缓存（任意已装版本，headless-shell 高 rev →
chromium）→ **系统浏览器兜底**（darwin/linux/win32 常见路径 + $PATH 命令解析，
kind='system'，未认证 hint）→ 报错（列探测范围 + 一键安装命令，去掉"需
playwright-core@1.62.0"的误导措辞）。

| 验证项 | 结果 |
|---|---|
| 真实环境缓存优先 | `headless-shell 1234 known=true` ✓ |
| 模拟无缓存 → 系统兜底 | 真实命中 `/Applications/Google Chrome.app/...`，hint 正确 ✓（本机恰好装有 Chrome，零下载场景真实成立） |
| 系统 Chrome launch 兼容 | CLI + `DSH_BROWSER_VERIFY_CHROMIUM` 指向系统 Chrome：hhhweb 打开、渲染正常、settle 生效（1753ms）✓ |
| 单测 | discover 10 → 14（系统兜底/缓存优先/candidates 平台表/PATH 解析 → 共 45 全绿） |
| smoke 三态回归 | 待跑（见下） |

## Step 1 — 构建并装载（pnpm link，免 pack）✅

```bash
cd /Users/dongshuai/Desktop/AIWorks/dsh-browser-verify && pnpm build
# ✔ [dsh-browser-verify] Build complete（lib/index.js + lib/cli.js + driver 分包 31.2 kB）
cd /Users/dongshuai/Desktop/AIWorks/deepseek-harness && pnpm dsh plugin --profile web add /Users/dongshuai/Desktop/AIWorks/dsh-browser-verify
```

结果（profile package.json）：

```json
"dependencies": {
  ...,
  "dsh-browser-verify": "link:/Users/dongshuai/Desktop/AIWorks/dsh-browser-verify"
}
```

## Step 2 — 验证层生效 ✅

```bash
cd /Users/dongshuai/Desktop/AIWorks/deepseek-harness && pnpm dsh --profile web --dump-config
```

结果（config 层）：

```yaml
# == dsh-browser-verify
- id: browser-verify
  name: dsh-browser-verify
```

## Step 3 — 重启 Web GUI 并新开会话 ✅

- 宿主重启并更新至 dsh 0.1.2-alpha.4 后，四件套 `browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot` 已出现在本会话工具目录并可直接调用（本记录即由这些工具执行完成）。**SQLite 持久化后端移除（session 层重构）不影响插件装载与运行。**

## Step 4 — 模型侧两态闭环 ✅（合计 6 次调用 ≤ 8 验收线）

**空态（3 次）：**
1. `browser_open` url=`http://localhost:5173/hweb/#/pages/lyp/livingPayment`，mocks=[{urlPattern:"**/api/*.do*", json:{status:0, result:{list:[], data:{}}}}]，waitSelector=`.header`
   → `{"title":"生活缴费",...,"visible":["我的缴费","便捷生活 从缴费开始","暂无可用缴费服务",...],"consoleErrors":[],"elapsedMs":1016}`
2. `browser_assert` `.empty-wrap` text=`暂无可用缴费服务` → `{"pass":true,"count":1,"actualText":"暂无可用缴费服务","elapsedMs":10}`
3. `browser_screenshot` fullPage=true name=`livingPayment-empty` → image block 自动投影进上下文（780x1688, sha256 2e4b32c9…）

**正常态（3 次）：**
4. `browser_open`（mocks 换 `{status:0, result:{list:[{wegType:"WATER",name:"水费",info:"128.00"}], data:{}}}`）waitSelector=`.grid-item`
   → `{"visible":["我的缴费","便捷生活 从缴费开始","水费","查看详情","128.00",...]}`
5. `browser_assert` `.grid-item` text=`水费` → `{"pass":true,"count":1,"actualText":"水费查看详情128.00","elapsedMs":9}`
6. `browser_screenshot` name=`livingPayment-normal` → 投影成功，sha256 a12c2ff1…（与空态不同，identicalToPrevious 语义正确）

关键事实（Task 8 实测 + 本闭环复核）：
- 路由须带 hash `#/pages/lyp/livingPayment`；拦截须在打开前生效（`browser_open.mocks`，L10 裁决）；响应体信封 `{status:0, result:...}`。
- **列表项真实键为 `wegType/name/info`**（计划原文的 `title/amount` 与真实应用不符——首次按 title/amount 断言失败，切真实键后通过；标题按 `name` 渲染）。
- `.grid-item` 初始为加载骨架（visible 含"加载中..."，首帧 textContent 仅"查看详情"）——断言须等真实条目（真实条目渲染后 textContent=水费查看详情128.00）。

## Step 5 — 垃圾验收 ✅

- tmpdir 内仅存在当前宿主的活动浏览器目录 `dsh-browser-verify-<宿主pid>`（chrome 为该宿主直属子进程，profile 于本会话创建；空闲 10 min 由 driver 回收，宿主优雅退出时 dispose 删除）。
- 无孤儿目录/僵尸进程（无"宿主已死但浏览器存活"的实例——本轮宿主重启未产生残留：重启发生在插件装载前，旧宿主退出时浏览器由 idle/dispose 闭环）。
- 附件库内容寻址、同图幂等；本轮增量 = 2 张截图。

## 0.1.5 复验 — 附件格式直通（宿主归一化闭环）✅

对 `attachment-local` **真实源码**（checkout：`prepareImageFile` / `readImageFile` / `normalizedImagePath`）跑桌面级截图闭环
（`/tmp` 脚本，非仓库产物）：

| 提交 | store 返回 ref | 宿主 read 校验 |
|---|---|---|
| 2560×1800 PNG（1280×900 @2 = 4,608,000 px > 预算 2048² = 4,194,304） | `image/jpeg` 2442×1717 / 25,052 B / `originalDimensions{2560,1800}` | 修复后 ref **PASS**；0.1.4 ref（格式重述 png）**FAIL `ATTACHMENT_CORRUPT`**（"Stored attachment metadata does not match its reference."） |
| 2560×1800 透明 PNG（alpha） | `image/webp` 2442×1717 | ——（证明只放宽到 jpeg 不够） |

- 转码事实与线上事故逐位吻合（缩放系数 0.95396 → 2442×1717）：**`ref.mediaType` 即实际存储格式**。
- `SCREENSHOT_MEDIA_TYPES` 四值 = 宿主 `ImageMediaType`（`satisfies` 编译期校验，宿主改契约即报错）。
- 离线回归：`screenshotValueFrom` 全字段直通（jpeg/webp/originalDimensions）+ 信封标注原图尺寸 + schema enum 四值。

## 0.1.5 上线复验 — 已发布包 + 真宿主（事故场景回归）✅

用户按 registry 安装 + 重启宿主后，在**全新会话**里重放事故场景（即 0.1.4 会写坏引用
并拖垮会话的那一次）：

```bash
dsh plugin --profile web add dsh-browser-verify@0.1.5   # profile 钉扎 0.1.5；node_modules 实装 0.1.5
```

| 项 | 实测（1280×900 @2 = 2560×1800 = 4,608,000 px > 预算 2048²） |
|---|---|
| 工具返回信封 | `image/jpeg, 2442x1717 px（原图 2560x1800，已按宿主预算缩放）, 35696 bytes, sha256 cead88b696f7` |
| 附件 ref 元信息 | `2442x1717px, image/jpeg`（与信封逐项一致，无"声明 PNG / 实存 JPEG"矛盾） |
| 会话存活性 | 截图后同会话继续执行工具调用成功（退出码 0）—— 无 `ATTACHMENT_CORRUPT`、无 TRANSPORT 重试 |
| 打包产物静态核对 | `image/jpeg`×1 / `image/webp`×1 / `originalDimensions`×8 / `已按宿主预算缩放`×1（硬编码残留为 0） |

- 页面侧无关结论的观察：无头上下文访问 `http://127.0.0.1:3080` 返回 401
  （`dsh web authentication required`）——像素预算超限与画面内容无关，闭环成立；
  若要截图 GUI 本身须传 `dsh web` 打印的带 token URL。
- 事故场景已从"必死"变为"正常降级并自述原图尺寸"，且验证发生在**已发布产物**而非
  本地构建上（本地构建闭环见上一节）。
