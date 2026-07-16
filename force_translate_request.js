const url = new URL($request.url);

if (
  (url.hostname === "www.youtube.com" ||
    url.hostname === "m.youtube.com") &&
  url.pathname === "/api/timedtext"
) {
  // 删除 YouTube 自带的目标语言参数，避免干扰 DualSubs
  url.searchParams.delete("tlang");

  // 强制进入 DualSubs 翻译模式
  url.searchParams.set("subtype", "Translate");
}

$done({
  url: url.toString(),
  headers: $request.headers
});