# 图匣 PicVault

电商详情页图片采集工具，两种形态：

| 形态 | 目录 | 说明 |
|------|------|------|
| **网页版（免安装，推荐）** | `webapp/` | 浏览器打开即用，无需装扩展 |
| 浏览器扩展 | `extension/` | Chrome/Edge Manifest V3 插件 |

功能一致：打开商品详情页 → 获取页内全部图片 → 新页面展示 → 单张 **PNG** / 多张 **ZIP** 下载。

## 一、网页版（无需安装）

纯 Python 标准库，无第三方依赖。后端负责跨域抓取商品页并代理图片，前端负责展示与 PNG / ZIP 下载。

### 启动

```powershell
cd D:\damoxing\picvault\webapp
py server.py
# 或指定端口： py server.py 9000
```

浏览器打开 **http://127.0.0.1:8787**

### 使用

1. 首页粘贴商品详情页链接（淘宝 / 天猫 / 京东 / 拼多多 / 亚马逊等）
2. 点「采集图片」，自动抓取页内全部图片地址
3. 图库页勾选图片
   - **下载 PNG**：单张或分张保存为 PNG
   - **打包 ZIP**：多张转为 PNG 后打成一个 ZIP

### 原理

- `POST /api/extract` 后端抓取商品页 HTML，解析 `<img>`（含 `data-src` 懒加载）、背景图、`og:image`、srcset、JSON-LD 等，尽量还原高清地址
- `GET /api/proxy` 后端带 Referer 拉取图片字节，绕开浏览器跨域限制
- 前端通过 canvas 统一转成 PNG，再用纯 JS 生成 ZIP 下载

> 说明：纯后端 HTML 抓取不执行页面 JS，极少数「纯 JS 才渲染图片」的站点可能采不到，属正常限制。

## 二、浏览器扩展

见 `extension/` 目录。安装方式见下文「扩展安装」。

## 扩展安装（可选）

1. 打开 `chrome://extensions` 或 `edge://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 `extension` 文件夹

## 介绍网页

`website/index.html`（静态介绍页）

## 注意

- 请仅下载你有权使用的图片，遵守目标网站条款与版权法规
- 个别电商站有较强的反爬/防盗链，网页版或扩展可能都受限

## 部署

- **介绍页（静态）** → GitHub Pages：仓库已含 `.github/workflows/deploy-pages.yml`，到 GitHub 仓库 Settings → Pages → Source 选「GitHub Actions」，推送后自动生成 `https://Ssq060902.github.io/ssq/`。
- **网页版（Python 后端）** → Render：仓库根目录有 `render.yaml`，在 Render 控制台 New → Blueprint 选本仓库即可，得到 `https://picvault.onrender.com`，可在 Render 里绑定自定义域名。

## 版本

v1.2.0
