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

### 2026-10-07（v39）

- **v39**：字幕翻译脚本拆成三个互相独立的包，sgmodule 按字幕请求里的 `lang=` 参数分流，每次只会命中其中一个：
  - 英文进 `v39-en`（约 720KB），
  - 日语、韩语进 `v39-cjk`（约 570KB），
  - 其他语言进 `v39-other`（约 54KB）。

  没有专门模型的语言，自动字幕不再走 v36，改用一套与语言无关的通用标准：有标点就按标点切，没有标点就按说话停顿切，同时让每条长度均衡（单条不超过 76 宽度、7.5 秒，时间轴不重叠）。泰语等不写空格的文字按词切分，不会从单词中间断开，也不会多出空格。v36 只在断句代码出现异常时作为最后的保底。英文输出与 v37 逐字节一致。

### 2026-10-07（v38）

- **v38**：新增日语和韩语无标点自动字幕的离线断句模型。日语模型按字符判断句界，韩语模型按词（어절）判断；日语用 Tanaka 例句和 JSQuAD 训练，韩语用 Chatbot_data、KorNLI 和 NSMC 训练，两个模型各约 260KB。新逻辑会补上句号（。/ .）和问号，单条字幕的长度和时长有上限，时间轴不重叠。在未参与训练的测试文本上，日语不自然断点从 85% 降到 14%，句末命中率从 5% 升到 89%；韩语不自然断点从 71% 降到 9%，句末命中率从 17% 升到 90%。英文逻辑与 v37 逐字一致，没有改动。西班牙语、俄语等其他语言暂时继续走 v36 逻辑。

### 2026-10-07（v37）

- **v37**：英文等拉丁字母的无标点自动字幕，改用离线标点模型加动态规划断句。模型用 TED 口语语料训练，体积约 690KB，不联网、不需要 API Key。新逻辑优先在句末或从句处断开，跨 `[Music]` 或长停顿的孤词会归回原句（例如 `wake | up Aran` → `wake up.` / `Aran is…`）。单条字幕不超过 86 字符、8 秒，时间轴保证不重叠，并补充高置信度的句号和首字母大写，以提升翻译质量。在样例视频上，不自然断点从 44% 降到约 15%，句末命中率从 40% 升到约 70%。韩语、日语等非拉丁字母自动字幕继续走 v36 逻辑。

### 2026-10-07

- **v36**：统一精确词时间与估算词时间两条英文自动字幕重建路径，全部使用同一套语义分段逻辑与104字符/22词/9秒安全上限。
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
| `Translate.response.youtube-fix-v35.bundle.js` | 保留给仍在使用 v35 的用户兼容/回退 |
| `Translate.response.youtube-fix-v36.bundle.js` | 保留给仍在使用 v36 的用户兼容/回退 |
| `Translate.response.youtube-fix-v37.bundle.js` | 保留给仍在使用 v37 的用户兼容/回退 |
| `Translate.response.youtube-fix-v38.bundle.js` | 保留给仍在使用 v38 的用户兼容/回退 |
| `Translate.response.youtube-fix-v39-en.bundle.js` | 当前英文字幕脚本（含英文模型） |
| `Translate.response.youtube-fix-v39-cjk.bundle.js` | 当前日语、韩语字幕脚本（含日韩模型） |
| `Translate.response.youtube-fix-v39-other.bundle.js` | 当前其他语言字幕脚本（无模型，通用标准） |
| `src/function/asrCore.mjs` | 断句框架：取词、动态规划、时间轴、语言识别，以及通用标准 |
| `src/function/asrEnglish.mjs` | 英文档案（v37 逻辑） |
| `src/profiles/{en,cjk,other}.mjs` | 决定每个包里编译进哪些语言模型 |
| `src/function/asrCjkSegmenter.mjs` | v38 日语/韩语分词、模型打分与成句 |
| `src/function/asrModelJa.mjs` / `asrModelKo.mjs` | 自动生成的日语/韩语断句模型 |
| `src/function/asrSegmenter.mjs` | 载入全部模型的便捷入口，仅供测试和工具使用 |
| `src/function/asrBoundaryModel.mjs` | 自动生成的标点模型权重，不要手改 |
| `tools/` | 模型训练、调参脚本（英文在根目录，日韩在 `tools/cjk/`） |
| `tests/` | 自动字幕、官方字幕、广播字幕和模块独立性测试 |

> 仓库清理原则：当前运行链依赖的文件一律保留；v24–v28、v32、v33、v34 与 v35 兼容 bundle 保留；v18–v23 与 v29–v31 的旧翻译 bundle 已从主线移除，但历史代码仍可在 Git 提交记录中查看。

## 开源说明

本项目保留并注明所使用上游开源逻辑的许可与来源，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。运行文件和订阅路径均由本仓库独立托管。
