# YouTube 双语字幕 · Surge v39

YouTube 原文在上、简体中文在下，支持 iPhone 与 iPad；中文字幕原样播放。

## 安装与更新

[模块订阅地址](https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule)

1. 删除重复的 YouTube 双语字幕模块，避免多个脚本同时执行。
2. 在 Surge 中通过上面的订阅地址安装；已安装的点击“立即更新”。
3. 开启模块与 MITM，安装并完全信任 Surge CA 证书，同时屏蔽 QUIC。
4. 完全退出 YouTube 后重新打开，选择视频原语言的字幕。

订阅地址保持不变。

## 当前版本

v39 按字幕语言使用独立脚本：英文用英文模型，日语与韩语用日韩模型，其他语言按标点、停顿和长度断句。官方字幕、自动字幕与直播字幕均保留对应处理逻辑。

已修复滚动字幕重复文字，同时保留实际说出的重复内容。断句模型离线运行，无需 API Key；翻译仍需要联网。

## 保留版本与维护

保留 v34 作为回退版本；v35～v38 的旧翻译脚本和对应说明已移除。其他已有文件保留，历史版本可在 Git 提交记录中查看。

当前运行所需的 v18 Player 脚本、v39 三个字幕脚本，以及源码、模型、构建工具、测试和依赖均保留。开发验证：`npm ci`，随后 `npm run verify`。

## 开源说明

感谢 [DualSubs](https://dualsubs.github.io/index.html) 开放源代码，感谢 GPT-5.6 Sol 协助维护。第三方来源与许可见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
