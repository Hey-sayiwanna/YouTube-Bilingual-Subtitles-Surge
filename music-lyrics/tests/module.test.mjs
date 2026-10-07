// Checks the sgmodule patterns, including coexistence with "Youtube (Music) Enhance".
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../../YouTube.Music.Lyrics.sgmodule", import.meta.url), "utf8");
const rules = Object.fromEntries(source.split("\n").filter(l => l.startsWith("YTMusic.")).map(line => {
	const name = line.split(" = ")[0];
	return [name, { pattern: new RegExp(line.match(/pattern=(\S+?),\s/)[1]), line }];
}));
assert.deepEqual(Object.keys(rules).sort(), ["YTMusic.Lyrics.request.json", "YTMusic.Lyrics.request.proto", "YTMusic.Lyrics.response.json", "YTMusic.Lyrics.response.proto"]);
assert.match(source, /hostname = %APPEND% youtubei\.googleapis\.com, music\.youtube\.com/);
for (const rule of Object.values(rules)) assert.match(rule.line, /YouTubeMusic\.Lyrics\.(request|response)\.bundle\.js/);

const plain = "https://youtubei.googleapis.com/youtubei/v1/browse?key=x";
const taggedEvade = "https://youtubei.googleapis.com:443/youtubei/v1/browse?key=x&ytmLyrics=1";
const taggedPlain = "https://youtubei.googleapis.com/youtubei/v1/browse?key=x&ytmLyrics=1";
assert.ok(rules["YTMusic.Lyrics.request.proto"].pattern.test(plain));
assert.ok(!rules["YTMusic.Lyrics.response.proto"].pattern.test(plain), "home feed responses are never touched");
assert.ok(rules["YTMusic.Lyrics.response.proto"].pattern.test(taggedEvade));
assert.ok(rules["YTMusic.Lyrics.response.proto"].pattern.test(taggedPlain));
assert.ok(rules["YTMusic.Lyrics.response.json"].pattern.test("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&ytmLyrics=1"));

// youtube.response pattern of Maasea "Youtube (Music) Enhance" (only one response script runs per request in Surge)
const enhance = /^https:\/\/youtubei\.googleapis\.com\/(youtubei\/v1\/(browse|next|player|search|reel\/reel_watch_sequence|guide|account\/get_setting|get_watch|log_event|config))(\?(.*))?$/;
assert.ok(enhance.test(taggedPlain), "without evasion the Enhance module would take the lyrics response");
assert.ok(!enhance.test(taggedEvade), "with :443 the lyrics response is ours");
assert.ok(enhance.test(plain), "every other browse response still goes to Enhance");
console.log("music-lyrics module tests: passed");

// v40: the same rules are also merged into the main subtitle module
const main = fs.readFileSync(new URL("../../YouTube.Bilingual.sgmodule", import.meta.url), "utf8");
for (const [name, rule] of Object.entries(rules)) {
	const merged = main.split("\n").find(line => line.startsWith(`${name} = `));
	assert.ok(merged, `${name} merged into YouTube.Bilingual.sgmodule`);
	assert.equal(merged.match(/pattern=(\S+?),\s/)[1], rule.pattern.source, `${name}: same pattern`);
	assert.match(merged, /argument="Position=\{\{\{歌词显示方式\}\}\}&Evade=\{\{\{歌词避让Enhance\}\}\}"/);
}
assert.match(main, /#!arguments=歌词显示方式:原文在上,歌词避让Enhance:true/);
assert.match(main, /hostname = %APPEND% .*youtubei\.googleapis\.com, music\.youtube\.com/);
console.log("music-lyrics merged-module tests: passed");

// v40: no two rules of the main module may fight for the same URL
// (Surge runs only one http-request and one http-response script per request)
{
	const all = main.split("\n").filter(l => / = type=http-(request|response)/.test(l)).map(l => ({
		name: l.split(" = ")[0], type: l.match(/type=(http-request|http-response)/)[1], pattern: new RegExp(l.match(/pattern=(\S+?),\s/)[1]),
	}));
	const urls = [
		"https://youtubei.googleapis.com/youtubei/v1/browse?key=x",
		"https://youtubei.googleapis.com:443/youtubei/v1/browse?key=x&ytmLyrics=1",
		"https://youtubei.googleapis.com/youtubei/v1/browse?key=x&ytmLyrics=1",
		"https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&ytmLyrics=1",
		"https://youtubei.googleapis.com/youtubei/v1/player?key=x",
		"https://youtubei.googleapis.com/youtubei/v1/get_watch?key=x",
		"https://youtubei.googleapis.com/youtubei/v1/next?key=x",
		"https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
		"https://www.youtube.com/api/timedtext?v=a&lang=en&subtype=Translate",
		"https://www.youtube.com/api/timedtext?v=a&lang=ja&subtype=Translate",
		"https://www.youtube.com/api/timedtext?v=a&lang=es&subtype=Translate",
		"https://www.youtube.com/api/timedtext?v=a&lang=en",
	];
	for (const url of urls) for (const type of ["http-request", "http-response"]) {
		const hits = all.filter(rule => rule.type === type && rule.pattern.test(url)).map(rule => rule.name);
		assert.ok(hits.length <= 1, `${type} conflict on ${url}: ${hits.join(", ")}`);
	}
	console.log("music-lyrics: no rule conflicts inside YouTube.Bilingual.sgmodule");
}
