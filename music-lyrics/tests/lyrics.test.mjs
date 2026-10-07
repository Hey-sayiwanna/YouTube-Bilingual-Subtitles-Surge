// node music-lyrics/tests/lyrics.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { gzipSync } from "fflate";
import { processLyricsBody } from "../src/response.js";
import { rewriteProtobufLyrics, analyseSong, isChineseLine } from "../src/lyrics.mjs";
import { parseMessage } from "../src/protobuf.mjs";
import { tagLyricsUrl } from "../src/request.js";

const load = name => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const calls = [];
const mockTranslate = async lines => {
	calls.push(lines.length);
	return { map: new Map(lines.map(line => [line.trim(), line === "Arian" ? "Arian" : `译:${line.trim()}`])), detected: ["en"] };
};
const collect = bytes => {
	const out = [];
	rewriteProtobufLyrics(bytes, (kind, text) => void out.push({ kind, text }));
	return out;
};
// timing / id sub-messages of every timed line, to prove nothing else changed
const timings = bytes => {
	const out = [];
	const walk = (b, depth) => {
		const fields = parseMessage(b);
		if (!fields || depth > 40) return;
		for (const f of fields) if (f.wire === 2) {
			const v = b.subarray(f.valueStart, f.valueEnd);
			if (f.no === 2 && depth > 5) {
				const t = parseMessage(v);
				if (t && t.length === 3 && t[0].no === 1 && t[1].no === 2 && t[2].no === 3) out.push(Buffer.from(v).toString("hex"));
			}
			walk(v, depth + 1);
		}
	};
	walk(bytes, 0);
	return out;
};
const undo = bytes => rewriteProtobufLyrics(bytes, (kind, text) => text.split("\n").filter(line => !line.startsWith("译:")).join("\n")).bytes;

// 1. English timed lyrics
{
	const input = load("timed_en.pb");
	const result = await processLyricsBody(input, { translate: mockTranslate });
	assert.equal(result.status, "translated");
	const lines = collect(result.body);
	assert.equal(lines.length, 74);
	assert.equal(lines[0].text, "Walking down the river in the morning light\n译:Walking down the river in the morning light");
	assert.equal(lines.find(l => l.text.startsWith("Arian")).text, "Arian", "same text -> no duplicate line");
	assert.deepEqual(timings(result.body), timings(input), "line timings untouched");
	assert.ok(timings(input).length >= 70);
	assert.deepEqual(Buffer.from(undo(result.body)), Buffer.from(input), "lossless: removing the translations restores the original bytes exactly");
	assert.equal(result.translated, 7, "7 unique lines sent to Google once each");
	// ...but EVERY occurrence of a repeated line shows its translation
	const chorus = lines.filter(l => l.text.startsWith("Hold on, the night is almost over"));
	assert.ok(chorus.length >= 15, `chorus repeats ${chorus.length} times`);
	assert.ok(chorus.every(l => l.text === "Hold on, the night is almost over\n译:Hold on, the night is almost over"), "every repeated chorus line is translated");
	assert.equal(lines.filter(l => l.text.includes("\n译:")).length, lines.filter(l => !l.text.startsWith("Arian")).length, "all 74 lines except the name carry a translation");
}
// 2. Chinese song (with an English hook) -> untouched
{
	const input = load("timed_zh.pb");
	const result = await processLyricsBody(input, { translate: mockTranslate });
	assert.equal(result.status, "chinese-skip");
	assert.equal(result.body, input);
}
// 3. Japanese: kanji-only line inside a Japanese song is translated too
{
	const result = await processLyricsBody(load("timed_ja.pb"), { translate: mockTranslate });
	assert.equal(result.status, "translated");
	assert.ok(collect(result.body).some(l => l.text === "東京\n译:東京"));
}
// 4. Korean static lyrics: blank lines kept, footer untouched
{
	const input = load("static_ko.pb");
	const result = await processLyricsBody(input, { translate: mockTranslate });
	assert.equal(result.status, "translated");
	const [desc] = collect(result.body);
	assert.equal(desc.kind, "static");
	assert.equal(desc.text.split("\n").filter(l => l === "").length, 2);
	assert.ok(desc.text.startsWith("아침 햇살 속에서 너를 기다려\n译:아침 햇살 속에서 너를 기다려\n오늘도"));
	assert.ok(Buffer.from(result.body).includes(Buffer.from("LyricFind")), "footer kept");
	assert.deepEqual(Buffer.from(undo(result.body)), Buffer.from(input));
}
// 5. Traditional Chinese static lyrics -> untouched
assert.equal((await processLyricsBody(load("static_zht.pb"), { translate: mockTranslate })).status, "chinese-skip");
// 6. Anchor renumbered by YouTube -> structural fallback still works
{
	const result = await processLyricsBody(load("timed_en_renumbered.pb"), { translate: mockTranslate });
	assert.equal(result.status, "translated");
	assert.equal(result.mode, "heuristic");
}
// 7. Not a lyrics response -> untouched
{
	const other = Uint8Array.from([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x10, 0x01, 0x1a, 0x03, 0x08, 0x96, 0x01]);
	const result = await processLyricsBody(other, { translate: mockTranslate });
	assert.equal(result.status, "no-lyrics");
	assert.equal(result.body, other);
}
// 8. Translation reported Chinese for everything -> untouched
{
	const input = load("timed_en.pb");
	const result = await processLyricsBody(input, { translate: async lines => ({ map: new Map(lines.map(l => [l, "x"])), detected: ["zh-CN"] }) });
	assert.equal(result.status, "chinese-skip");
}
// 9. Web JSON
{
	const json = JSON.stringify({ contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: { description: { runs: [{ text: "Hello there\n\nGood night" }] }, footer: { runs: [{ text: "Source: Musixmatch" }] } } }] } } });
	const result = await processLyricsBody(json, { translate: mockTranslate, position: "Reverse" });
	assert.equal(result.status, "translated");
	assert.equal(JSON.parse(result.body).contents.sectionListRenderer.contents[0].musicDescriptionShelfRenderer.description.runs[0].text, "译:Hello there\nHello there\n\n译:Good night\nGood night");
}
// 10. language policy
assert.equal(isChineseLine("夜色溫柔得像一封信"), true);
assert.equal(isChineseLine("朝の光の中で"), false);
assert.equal(isChineseLine("Hold on 我们"), false, "mostly-Latin line is still translated");
assert.equal(isChineseLine("我们一起 go"), true);
assert.equal(analyseSong(["Hello", "world", "我们走吧"]).chinese, false);
assert.equal(analyseSong(["我们走吧", "Yeah", "夜色温柔", "城市的灯"]).chinese, true);
// Japanese songs remain Japanese when most lines happen to use kanji only.
{
	const json = JSON.stringify({ timedLyricsContent: { runs: ["東京", "未来", "君を愛してる"].map(text => ({ text })) } });
	const result = await processLyricsBody(json, { translate: mockTranslate });
	assert.equal(result.status, "translated", "kana identifies a Japanese song even with mostly kanji-only lines");
	assert.ok(JSON.parse(result.body).timedLyricsContent.runs.every(run => run.text.includes("\n译:")));
}
// 11. request tagging
assert.equal(tagLyricsUrl("https://youtubei.googleapis.com/youtubei/v1/browse?key=x", true), "https://youtubei.googleapis.com:443/youtubei/v1/browse?key=x&ytmLyrics=1");
assert.equal(tagLyricsUrl("https://youtubei.googleapis.com/youtubei/v1/browse", false), "https://youtubei.googleapis.com/youtubei/v1/browse?ytmLyrics=1");
assert.equal(tagLyricsUrl("https://music.youtube.com/youtubei/v1/browse?prettyPrint=false", true), "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false&ytmLyrics=1");
assert.ok(gzipSync instanceof Function);

console.log("music-lyrics core tests: passed");
