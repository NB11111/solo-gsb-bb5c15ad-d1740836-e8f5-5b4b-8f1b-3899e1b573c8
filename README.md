# 色觉安全图例校验台（CVD Legend Checker）

面向地图图例 / 信息图表的**色觉无障碍配色校验工具**：对 2–8 色带标签调色板，
在正常色觉与红色弱 / 绿色弱 / 蓝色弱模式下做模拟，计算全部色对的
**CIEDE2000（ΔE00）**距离，标出最差模式与不达标色对；并支持锁定其余颜色、
从内置候选网格中推荐最佳替换色。

技术栈：**React 18 + Vite**（前端）· **Express 4**（API）· **culori 4**（色彩计算）。

---

## 算法说明

1. `#RRGGBB` 先去伽马转换为**线性 sRGB**。
2. 在线性 RGB 中施加色觉模拟矩阵
   （Machado, Oliveira & Fernandes, *IEEE TVCG* 2009，二色视觉矩阵 D）：
   - 正常模式：单位矩阵；
   - 色弱模式：`M(s) = (1 − s)·I + s·D`，强度 s 默认 60%（可调 5%–100%，100% 即对应色盲）。
3. 模拟结果裁剪到 [0,1]，再 gamma 编码用于显示；同时转到 **Lab**（D50）。
4. 对每种模式计算**全部 C(n,2) 个色对的 CIEDE2000 距离**（Sharma et al. 2005）。
5. 每个色对取各模式中的最小值判定是否 ≥ 阈值（默认 **10**，宽松 5 / 严格 15 可一键选择）；
   全组最小距离所在的模式标记为**最差模式**，低于阈值的色对在矩阵和清单中红底标出。
6. **替换推荐**：指定一个待替换色，其余颜色锁定；对内置 HSL 等距候选网格（约 870 色）
   逐一计算“跨所有启用模式 × 所有锁定色”的最小 ΔE00，取其中**最大**者；
   分数相同时，取与原色 Lab 改变量（ΔE00）**更小**者。

---

## 快速开始

### 方式一：Docker Compose（一键安装依赖 + 构建 + 启动）

```bash
docker compose up --build -d
```

启动后打开浏览器访问：

> **http://localhost:3000**

端口：宿主机 **3000** → 容器 3000（Express 同时托管 API 与前端静态文件）。

停止：

```bash
docker compose down
```

> 首次构建会执行 `npm install` 与 Vite 打包，完成后容器内无需再做任何初始化。

### 方式二：本地 Node.js（需 Node ≥ 18）

```bash
npm install          # 安装前后端全部依赖
npm run dev          # 并行启动 Express + Vite 热更新开发服务器
```

- 前端（Vite）：**http://localhost:5173**
- 后端（Express）：**http://localhost:3000**
  - 浏览器请访问 5173；Vite 会把 `/api` 请求代理到 3000。

生产模式（先构建再由 Express 单端口托管）：

```bash
npm run build
npm start            # http://localhost:3000
```

可用环境变量：`PORT`（默认 3000）。

---

## 功能与界面

- **调色板编辑**：2–8 色，每色可取色器/HEX 输入、带中文标签；内置 4 个预设（分类五色、
  土地利用六色、风险分级四色、红绿双色）。
- **模式与阈值**：正常 / 红弱 / 绿弱 / 蓝弱任意勾选（至少一个）；色弱强度滑杆；
  ΔE00 阈值输入与 5 / 10 / 15 快捷档。
- **校验结果**：
  - 顶部横幅显示总体判定、**最差模式**、不达标色对数量；
  - 各模式最差距离条形概览；
  - 模式页签切换，**原色与模拟色色卡上下并排**对照（附 HEX）；
  - 当前模式的色对 ΔE00 距离矩阵（低于阈值红底、临界 25% 裕度黄底）；
  - 不达标色对清单，列出每个模式下的距离、最差模式与判定。
- **替换色推荐**：选择待替换色（其余以锁定芯片列出）→ 生成推荐；
  候选卡片显示“跨模式最小 ΔE00”与“相对原色改变量”，★ 最优卡一键应用并重新校验。

## HTTP API

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| GET  | `/api/health` | 健康检查，返回支持的模式列表 |
| POST | `/api/analyze` | 全模式模拟 + 全色对 ΔE00 校验 |
| POST | `/api/recommend` | 锁定换色推荐 |

`POST /api/analyze` 请求体示例：

```json
{
  "colors": ["#d62728", "#2ca02c"],
  "modes": ["normal", "protan", "deutan", "tritan"],
  "threshold": 10,
  "severity": 0.6
}
```

`POST /api/recommend` 额外字段：`"targetIndex": 0`（必选）、`"limit": 11`（可选）。

核心算法位于 `server/color-core.js`，为无依赖（仅 culori）的纯函数模块，
前端与 API 共用同一实现口径。

## 目录结构

```
.
├── Dockerfile              # 多阶段构建：npm install + vite build → 精简运行镜像
├── docker-compose.yml      # 一键启动，3000 端口
├── package.json            # npm workspaces（client / server）
├── scripts/dev.mjs         # 并行启动 Express + Vite
├── server/
│   ├── index.js            # Express API + 生产静态托管
│   └── color-core.js       # CVD 矩阵、Lab、CIEDE2000、推荐器
└── client/
    ├── vite.config.js      # /api 代理 → :3000
    ├── index.html
    └── src/                # React 应用（App.jsx / api.js / styles.css）
```
