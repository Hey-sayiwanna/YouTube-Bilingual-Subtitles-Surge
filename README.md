# YouTube Bilingual Subtitles for Surge

这是一个独立维护的 YouTube 自动简中双语字幕模块，默认原文在上、简体中文在下，支持 iPhone 与 iPad。

感谢 [DualSubs](https://dualsubs.github.io/index.html) 开放源代码，也感谢 **GPT-5.6 Sol&Claude-opus5.5** 在后续维护中协助分析与修改代码。

## 模块订阅地址

```text
https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule
```

这个地址保持不变，后续在 Surge 中点击“立即更新”即可。

## 安装

1. 删除 Surge 中原来的 DualSubs YouTube 模块，以及本项目的旧模块副本，避免重复执行。
2. 使用上面的订阅地址安装本模块。
3. 开启模块与 Surge MITM，安装并完全信任 Surge CA 证书，同时屏蔽 QUIC。
4. 完全退出 YouTube 后重新打开，在字幕菜单中选择视频的原语言字幕。

## 更新日志

### 2026-10-09（v40）

- 仅清理英文无标点自动字幕中混入连续语句的 `[music]` / `(music)`，保留片头、独立音乐提示、明显停顿处提示及普通单词 `music`。其他事件标签规则不变。
- 模块标记为 v40，英文脚本使用新的 GitHub 直连 `v40-en` 文件地址，绕过原 CDN 缓存并便于更新与测试；日韩和其他语言继续使用原 v39 脚本。模块订阅地址不变。

### 2026-10-07（v37-v39）

- **v39**：利用Claude opus5.5模型，进行专门针对Youtube自动生成式字幕且没有标点进行辅助断句的字幕，进行完全重构。利用TED等英文演讲，进行断句模型训练，分成三个入口，针对英、日韩、其他语言。英文进 `v39-en`（约 720KB）；日语、韩语进 `v39-cjk`（约 570KB）；其他语言进 `v39-other`（约 54KB）。
- **v27-v37**：Bug修复与针对自动生成字幕的失败探索

### 2026-10-04

- **v26**：仅在官方字幕批次编码长度过大时继续拆小请求，减少大批量翻译失败。

### 2026-07-30

- **v25**：识别简体与繁体中文字幕并原样播放，避免再次翻译或重复合并。

### 2026-07-26

- **v24**：将普通官方字幕中属于同一句的连续短片段适度合并，自动字幕与电视广播字幕保持原样。

### 2026-07-22

- **v23**：只截断电视广播字幕中已经发生重叠的时间段，不再强制延长字幕。
- **v22**：单独整理电视广播字幕的滚动残留和翻译并发，不改变自动字幕与普通官方字幕。
- **v21**：超长官方字幕只重试出错的小批次并限制重试次数，避免长片字幕整体失败。

### 2026-07-18

- **v20**：超长自动字幕改为排队翻译，避免几千行字幕同时发起过多请求。
- **v19**：只重试自动字幕中行数不一致的小批次，避免整段重试触发并发限制。

### 2026-07-17

- **v18**：回到 v16 的稳定逻辑，只缩小自动字幕翻译批次以改善 iPad 等待超时。
- **v17**：尝试限制翻译等待时间，但因翻译结果拆分行数不稳定而停用。
- **v16**：优化自动字幕长句分段与衔接，减少三行显示和字幕重叠。
- **v15**：将自动生成字幕整理为“原文在上、简中在下”的双语两行模式。
- **v14**：开始直接修改字幕响应源码，建立后续独立维护路线。

### 2026-07-12—2026-07-16

- **v1–v13**：早期试验阶段，主要验证原项目字幕逻辑和 Surge 接入方式。

## 当前文件说明

| 文件 | 作用 |
| --- | --- |
| `YouTube.Bilingual.sgmodule` | 当前 Surge 模块安装入口，订阅地址保持不变 |
| `force_translate_request.js` | 为 YouTube 字幕请求启用简中翻译 |
| `src/YouTube.Translate.response.js` | 当前字幕翻译与双语写回源码 |
| `src/function/youtubeTimedText.mjs` | 自动字幕重组、两行显示、长句与时间处理 |
| `request.youtube-standalone-v18.bundle.js` | 当前仍在使用的 YouTube Player 请求脚本 |
| `response.youtube-standalone-v18.bundle.js` | 当前仍在使用的 YouTube Player / GetWatch 响应脚本|
| `Translate.response.youtube-fix-v24.bundle.js` ～ `v28.bundle.js` | 保留给仍在使用旧模块的用户做兼容 |
| `Translate.response.youtube-fix-v40-en.bundle.js` | 当前英文字幕脚本（含英文模型及句中音乐清理） |
| `Translate.response.youtube-fix-v39-cjk.bundle.js` | 当前日语、韩语字幕脚本（含日韩模型） |
| `Translate.response.youtube-fix-v39-other.bundle.js` | 当前其他语言字幕脚本（无模型，通用标准） |
| `src/function/asrCore.mjs` | 断句框架：取词、动态规划、时间轴、语言识别，以及通用标准 |
| `src/function/asrSegmenter.mjs` | 载入全部模型的便捷入口，仅供测试和工具使用 |
| `src/function/asrBoundaryModel.mjs` | 自动生成的标点模型权重，不要手改 |
| `tools/` | 模型训练、调参脚本（英文在根目录，日韩在 `tools/cjk/`） |
| `tests/` | 自动字幕、官方字幕、广播字幕和模块独立性测试 |


## 开源说明

本项目保留并注明所使用上游开源逻辑的许可与来源，详情见THIRD_PARTY_NOTICES.md，运行文件和订阅路径均由本仓库独立托管。
