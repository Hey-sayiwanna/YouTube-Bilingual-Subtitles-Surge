# YouTube Bilingual Subtitles for Surge

这是一个独立维护的 YouTube 自动简中双语字幕模块，默认原文在上、简体中文在下，支持 iPhone 与 iPad。

感谢 [DualSubs](https://dualsubs.github.io/index.html) 开放源代码，也感谢 **GPT-5.6 Sol** 在后续维护中协助分析与修改代码。

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

### 2026-10-07

- **v35**：重构无标点自动字幕分段，改为语义完整度优先、长度仅作安全阀，并加入104字符/22词/9秒硬上限以兼顾自然断句与显示稳定性。
- **v34**：官方字幕翻译并发由2提升到4，并在单批网络重试仍失败时只二分该批继续恢复，ASR与直播字幕并发保持6。
- **v33**：有可靠标点时优先按标点断句，无标点时按语法完整度、时间停顿与显示上限重建自然小句，原始 `<p>` 仅保留时间作用，不再参与断句判断。
- **v32**：自动字幕先按真实标点确定硬句界，无标点时再结合时间、孤儿片段和语法完整度重分段，重点修复跨 `p` 断句、`come at / him`、`his family | warm` 等不自然切分，并兼容 `kind=asr`、`caps=asr` 与自动生成字幕轨道识别。
- **v31**：尝试基于 `p` 级时间流先重组自动字幕再翻译，改善短碎片被单独翻译的问题。
- **v30（实验）**：尝试利用 `<s t="...">` 细粒度时间恢复自动字幕词流，并在时间信息不足时回退旧逻辑。
- **v29（实验）**：调整自动字幕句界与长度策略，并将翻译响应脚本切换到 jsDelivr 以改善部分 iOS / Surge 的 Raw GitHub TLS 问题。
- **v28**：在 v27 稳定翻译调度基础上，仅对超长官方字幕按明确强句界进行保守拆分。
- **v27**：限制官方字幕翻译并发并增加内部请求超时控制，降低长字幕翻译失败率。

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
| `request.youtube-standalone-v18.bundle.js` | 当前仍在使用的 YouTube Player 请求脚本，文件名虽为 v18 但不能删除 |
| `response.youtube-standalone-v18.bundle.js` | 当前仍在使用的 YouTube Player / GetWatch 响应脚本，文件名虽为 v18 但不能删除 |
| `Translate.response.youtube-fix-v24.bundle.js` ～ `v28.bundle.js` | 保留给仍在使用旧模块的用户做兼容 |
| `Translate.response.youtube-fix-v32.bundle.js` | 保留给仍在使用 v32 的用户兼容/回退 |
| `Translate.response.youtube-fix-v33.bundle.js` | 保留给仍在使用 v33 的用户兼容/回退 |
| `Translate.response.youtube-fix-v34.bundle.js` | 保留给仍在使用 v34 的用户兼容/回退 |
| `Translate.response.youtube-fix-v35.bundle.js` | 当前 v35 字幕响应脚本 |
| `tests/` | 自动字幕、官方字幕、广播字幕和模块独立性测试 |

> 仓库清理原则：当前运行链依赖的文件一律保留；v24–v28、v32、v33 与 v34 兼容 bundle 保留；v18–v23 与 v29–v31 的旧翻译 bundle 已从主线移除，但历史代码仍可在 Git 提交记录中查看。

## 开源说明

本项目保留并注明所使用上游开源逻辑的许可与来源，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。运行文件和订阅路径均由本仓库独立托管。
