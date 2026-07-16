const url = new URL($request.url);

if (
  (url.hostname === "www.youtube.com" ||
    url.hostname === "m.youtube.com") &&
  url.pathname === "/api/timedtext"
) {
  // 防止 YouTube 原生翻译参数影响 DualSubs 翻译器
  url.searchParams.delete("tlang");

  // 强制进入 DualSubs Translate 翻译模式
  url.searchParams.set("subtype", "Translate");
}

$done({
  url: url.toString(),
  headers: $request.headers
});