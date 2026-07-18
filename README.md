# YouTube Bilingual Subtitles for Surge

这是一个独立维护的 YouTube 自动简中双语字幕模块，默认原文在上、简体中文在下，支持 iPhone 与 iPad。

感谢 [DualSubs](https://dualsubs.github.io/index.html) 开放源代码，当时我还是小白，他的双语字幕陪伴我度过了快乐的时光。

也感谢 **GPT-5.6 sol** 模型，在薯薯停更后，让我有机会能借助AI修改源代码，实现双语字幕功能。

## 模块订阅地址

```text
https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule
```

这个地址会保持不变，后续在 Surge 中点击“立即更新”即可。

## 安装

1. 删除 Surge 中原来的 DualSubs YouTube 模块，以及本项目的旧版本模块，避免重复执行。
2. 使用上面的订阅地址安装本模块。
3. 开启模块与 Surge MITM，安装并完全信任 Surge CA 证书，同时屏蔽 QUIC。
4. 完全退出 YouTube 后重新打开，在字幕菜单中选择视频的原语言字幕。

## 更新日志

- **v19**：只重试自动字幕中行数不一致的小批次，避免整段重试触发并发限制。
- **v18**：回到 v16 的稳定逻辑，只缩小自动字幕的翻译批次，尝试改善 iPad 等待超时。
- **v17**：尝试限制翻译等待时间，但拆分翻译结果时出现行数不一致，已停用。
- **v16**：优化自动字幕长句的分段与衔接，减少三行显示和字幕重叠。
- **v15**：将自动生成字幕整理为“原文在上、简中在下”的双语两行模式。
- **v14**：明确必须修改源代码，找到源代码的初次尝试
- **v1-14**：保留原项目修改字幕逻辑，宣告失败

## 相关文件

| 文件 | 作用 |
| --- | --- |
| `YouTube.Bilingual.sgmodule` | Surge 模块安装入口 |
| `force_translate_request.js` | 为 YouTube 字幕请求启用简中翻译 |
| `src/YouTube.Translate.response.js` | 字幕翻译与双语写回源码 |
| `src/function/youtubeTimedText.mjs` | 自动字幕两行显示与长句处理 |
| `request.youtube-standalone-v18.bundle.js` | YouTube Player 请求脚本 |
| `response.youtube-standalone-v18.bundle.js` | YouTube Player / GetWatch 响应脚本 |
| `Translate.response.youtube-fix-v18.bundle.js` | 从本仓库源码构建的字幕响应脚本 |
| `tests/` | 自动字幕、官方字幕和模块独立性测试 |

## 开源说明

本项目保留并注明所使用上游开源逻辑的许可与来源，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。运行文件和订阅路径均由本仓库独立托管。
