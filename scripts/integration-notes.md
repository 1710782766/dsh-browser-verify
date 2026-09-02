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
