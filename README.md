# YouTube Bilingual Subtitles for Surge

独立维护的 YouTube 自动简中双语字幕模块。当前版本为 **v15**，默认原文在上、简体中文在下。

## Surge 订阅地址

```text
https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule
```

这个路径保持不变，后续更新继续使用同一个地址。

## 独立性

- 所有 `script-path` 均指向本仓库。
- 不依赖 DualSubs Release 或 `Universal` 仓库。
- TimedText 翻译响应不读取 BoxJs。
- Player/GetWatch 使用独立的 `Hey-sayiwanna` 存储命名空间，不读取旧 `@DualSubs` 设置。
- 保留 `DualSubs.AutoZH.*` 规则名称，仅用于兼容已有 Surge 配置。

## v15 修复

- 只对 `kind=asr` 自动生成字幕关闭 YouTube 的滚动保留窗口，避免上一句翻译残留后形成三行。
- 韩语、英语、日语等所有自动生成字幕统一固定为“原文 + 简中”两个逻辑行。
- 作者上传或官方提供的字幕不走这项处理，原有显示方式保持不变。
- 兼容 YouTube iOS 的 `srv3` ASR 分段字幕。
- 保留有效 `<s>` 节点及 `rc>=2`，避免双语第二行被裁掉。
- 原文分段按原始空格拼接，避免产生双空格。
- Google 自动检测源语言并翻译为简体中文。
- 翻译数量不匹配时自动切换逐行重试。
- 使用独立文件名避免 Surge 脚本缓存。

## 安装

1. 在 Surge 中停用或删除旧 v6、v12、v13 和其他重复的 YouTube 字幕模块。
2. 使用上面的稳定订阅地址安装。
3. 开启模块与 MITM，确认 Surge CA 证书已安装并完全信任。
4. 完全退出 YouTube 后重新打开，并选择视频的原语言字幕。

BoxJs 可以保留，但本模块不会读取其中的旧 DualSubs 配置。

## 项目结构

- `YouTube.Bilingual.sgmodule`：稳定 Surge 订阅入口。
- `force_translate_request.js`：为 TimedText 请求添加 `subtype=Translate`。
- `src/YouTube.Translate.response.js`：字幕翻译与 srv3 写回源码。
- `src/function/youtubeTimedText.mjs`：YouTube XML 读取与双语写回逻辑。
- `request.youtube-standalone-v14.bundle.js`：独立 Player 请求脚本。
- `response.youtube-standalone-v14.bundle.js`：独立 Player/GetWatch 响应脚本。
- `Translate.response.youtube-fix-v15.bundle.js`：从本仓库源码构建的字幕响应脚本。
- `tests/`：抓包样本结构、编译 Bundle 和独立性测试。

## 本地构建与测试

```bash
npm ci
npm run build
npm test
```

## 开源说明

本项目保留并注明所使用上游开源逻辑的许可与来源，详见 `THIRD_PARTY_NOTICES.md`。运行文件和订阅路径均由本仓库独立托管。
