# YouTube Bilingual Subtitles for Surge

这是一个独立维护的 YouTube 自动简中双语字幕模块，默认原文在上、简体中文在下，支持 iPhone 与 iPad。

感谢 [DualSubs](https://dualsubs.github.io/index.html) 开放源代码和字幕处理思路，让这个项目有了最初的基础。

也感谢 **GPT-5.6 sol** 模型，让我有机会亲手创造自己喜欢、真正适合自己使用的东西。

> [!IMPORTANT]
> 本项目已经独立托管运行文件，不依赖 DualSubs Release、BoxJs 或 `Universal` 仓库中的旧字幕脚本。

## 一、模块订阅地址

```text
https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule
```

这个地址会保持不变，后续在 Surge 中点击“立即更新”即可。

## 二、当前版本

- **v18**：以稳定的 v16 为基础，只加快自动生成字幕的翻译请求。
- 修复 iPad 自动字幕等待过久，以及字幕正文换行造成的条目错位。
- 作者上传或官方字幕继续使用 v16 原有逻辑。

## 三、安装

1. 删除 Surge 中原来的 DualSubs YouTube 模块，以及本项目的旧版本模块，避免重复执行。
2. 使用上面的订阅地址安装本模块。
3. 开启模块与 Surge MITM，安装并完全信任 Surge CA 证书，同时屏蔽 QUIC。
4. 完全退出 YouTube 后重新打开，在字幕菜单中选择视频的原语言字幕。

> [!NOTE]
> BoxJs 可以保留，但本模块不会读取其中的 DualSubs 设置。

## 四、项目说明

- 仅对 `kind=asr` 自动生成字幕使用更小的翻译请求，减少 iPad 等待超时。
- 自动字幕保持“原文 + 简中”两个逻辑行，并处理长句重叠问题。
- 作者上传或官方字幕保留 v16 的翻译、逐行兜底和写回方式。
- 所有运行地址均指向本仓库，`DualSubs.AutoZH.*` 只作为 Surge 规则兼容名称保留。

## 五、相关文件

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

## 六、更新与排查

1. 在 Surge 模块页面确认当前显示为 **v18**。
2. 更新模块后完全退出并重新打开 YouTube。
3. 如果仍有问题，在 Surge 最近请求中确认 TimedText 请求显示 `Modified by script`，并保存对应日志或抓包。

## 七、开源说明

本项目保留并注明所使用上游开源逻辑的许可与来源，详见 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md)。运行文件和订阅路径均由本仓库独立托管。
