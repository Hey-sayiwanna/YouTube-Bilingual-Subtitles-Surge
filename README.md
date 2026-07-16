# YouTube Bilingual Subtitles for Surge

这是已经实测可用的 **YouTube 自动简中双语字幕 v6**，默认原文在上、简体中文在下。

## 模块文件

- `YouTube.Bilingual.sgmodule`

## Surge 云端订阅地址

```text
https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule
```

## BoxJS 设置

打开：

```text
http://boxjs.com/#/app/DualSubs.YouTube
```

建议设置为：

```text
字幕启用类型：翻译字幕（翻译器）
自动显示：开启
源语言字幕位置：上面
翻译服务商：Google
只显示自动翻译字幕：关闭
源语言：AUTO
目标语言：ZH-HANS
```

## 使用说明

1. 使用“安装新模块”添加上面的云端地址。
2. 开启 MITM，并确保 Surge CA 证书已经安装且完全信任。
3. 关闭或删除其他重复的 DualSubs、YouTube 字幕模块。
4. 在 Surge 的“调整生效顺序”页面中按下面顺序排列：

```text
YouTube 自动简中双语字幕 v6
BoxJS
YouTube Enhance 最新兼容版 + ATT接口
```

Surge 模块从上到下依次生效，**最底部优先级最高**，因此字幕模块放在去广告模块上面。

5. 在 YouTube 中优先选择原语言字幕，不要选择 YouTube 自带的中文自动翻译。
6. iPhone 和 iPad 的 BoxJS 设置、模块开关和 MITM 证书需要分别检查。

## 版本说明

- 当前版本为 v6，使用翻译器模式生成简体中文字幕。
- 已放宽 TimedText 响应匹配条件，提升字幕响应脚本的命中率。
- 视频本身需要提供官方字幕或自动生成字幕。

## 更新日志

### v2.0.0 · 2026-07-16

- 字幕模块升级至 v6。
- 放宽 TimedText 响应匹配条件。
- 修复字幕响应脚本未执行的问题。
- 修正与去广告模块同时使用时的模块顺序说明。

### v1.0.0 · 2026-07-14

- 首次发布 YouTube 自动简中双语字幕模块。
- 使用翻译器模式生成简体中文字幕。
- 增加 BoxJS 推荐设置和 Surge 云端订阅地址。
