# YouTube Bilingual Subtitles for Surge

这是已经实测可用的 **YouTube 自动简中双语字幕 v4**。

## 模块文件

- `YouTube.Bilingual.sgmodule`

## Surge 云端订阅地址

```text
https://raw.githubusercontent.com/Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge/main/YouTube.Bilingual.sgmodule
```

## BoxJS 必要设置

打开：

```text
http://boxjs.com/#/app/DualSubs.YouTube
```

设置为：

```text
字幕启用类型：翻译字幕（翻译器）
自动显示：开启
源语言字幕位置：上面
翻译服务商：Google
只显示自动翻译字幕：关闭
源语言：AUTO
目标语言：ZH-HANS
```

其中最关键的是：

```text
只显示自动翻译字幕：关闭
```

否则可能只显示中文，不显示原文。

## 模块排序

在 Surge 的“调整生效顺序”页面中：

```text
YouTube Enhance 稳定版 + ATT接口
YouTube 自动简中双语字幕 v4
```

最底部优先级最高，因此双语字幕 v4 放在最底部。

## 注意事项

- 关闭或删除官方 DualSubs YouTube、DualSubs Universal，以及其他重复的 YouTube 字幕模块。
- 视频本身必须提供官方字幕或自动生成字幕。
- iPhone 和 iPad 的 BoxJS 设置、模块开关、MITM 证书信任需要分别检查。
