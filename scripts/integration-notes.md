# dsh-browser-verify 实装集成验证记录

> 状态：Step 1–2 ✅ 已完成；Step 3–5 ⏳ 待用户在重启后的新会话中执行。

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

## Step 3 — 重启 Web GUI 并新开会话（⏳ 待用户）

- 重启 127.0.0.1:3080 的 dev server（host 无 HMR，必须重启）。
- 新开会话后确认 `browser_open` / `browser_mock` / `browser_assert` / `browser_screenshot` 出现在工具目录。

## Step 4 — 模型侧两态闭环（⏳ 待新会话执行）

目标：两态 ≤8 次工具调用（验收线），按真实应用（hhhweb 缴费页）执行：

**空态（3 次）：**
1. `browser_open` url=`http://localhost:5173/hweb/#/pages/lyp/livingPayment`，mocks=[{urlPattern:"**/api/*.do*", json:{status:0, result:{list:[], data:{}}}}]
2. `browser_assert` selector=`.empty-wrap`，text=`暂无可用缴费服务`
   （可选）`browser_screenshot`

**正常态（3 次）：**
3. `browser_open`（同上，mocks 换成 {status:0, result:{list:[{title:"水费",amount:128.00}], data:{}}}}）
4. `browser_assert` selector=`.grid-item`，text=`水费`
   （可选）`browser_screenshot`

说明（来自 Task 8 实测证据）：
- 路由必须带 hash `#/pages/lyp/livingPayment`（uni-app hash 模式）。
- 拦截需在**打开前**生效（browser_open 的 `mocks` 参数，L10 裁决）：页面启动即发 3 个接口，未 mock 时后端返回 `status:-2` → userOut + switchTab 跳到 `#/`，open→mock→reload 顺序永远回不到本页。
- 响应体信封为 `{status: 0, result: ...}`（`{code,data}` 会进入解密分支，页面白屏）。
- 每态调用数记录：空态 = N，正常态 = M（合计 ≤8）。

## Step 5 — 垃圾验收（⏳ 待新会话）

- `/tmp`（实际 `os.tmpdir()`）无 `dsh-browser-verify-*` 残留（`ls "$(node -p 'require("os").tmpdir()')" | grep dsh-browser-verify-` 应为空）。
- `ps` 无 `--user-data-dir=.../dsh-browser-verify-` 进程（注意 grep 自匹配：用 `[d]sh` 技巧）。
- 附件库增量 = 截图张数；同图幂等不重复（identicalToPrevious 语义）。
- 结果记录在本文件下方。
