/**
 * Builds test fixtures from two real YouTube Music iOS protobuf responses
 * (published in github.com/DualSubs/YouTube/example). The real lyric text is
 * replaced by invented lines so that no song lyrics are redistributed; every
 * other byte (timings, ids, tracking, footer, unknown fields) stays real.
 *   node tools/build_fixtures.mjs /path/to/DualSubs/YouTube/example
 */
import fs from "node:fs";
import path from "node:path";
import { rewriteProtobufLyrics } from "../src/lyrics.mjs";
import { encodeVarint } from "../src/protobuf.mjs";

const source = process.argv[2];
const out = new URL("../tests/fixtures/", import.meta.url);
const timed = new Uint8Array(fs.readFileSync(path.join(source, "YTM.MPLYt_8jkokTNJ20b-1.response")));
const stat = new Uint8Array(fs.readFileSync(path.join(source, "YTM.MPLYt_Ux5DptmuHZq-1.response")));

const LINES = {
	en: ["Walking down the river in the morning light", "I kept your letters in a paper boat", "Hold on, the night is almost over", "We were dancing on the station floor", "Every light in town is calling out your name", "Hold on, the night is almost over", "Oh oh oh", "Arian"],
	ja: ["朝の光の中で君を待ってる", "忘れないでこの約束を", "東京", "夜明けまでそばにいて", "ずっと同じ道を歩いてきた"],
	zh: ["我们在雨里慢慢走回家", "夜色温柔得像一封信", "Hold on", "城市的灯一盏一盏亮起", "把心事折成纸飞机"],
};
const STATIC = {
	ko: "아침 햇살 속에서 너를 기다려\n오늘도 같은 길을 걸어\n\n잊지 마 우리의 약속을\n밤이 끝날 때까지 곁에 있어줘\n\n아침 햇살 속에서 너를 기다려",
	zht: "我們在雨裡慢慢走回家\n夜色溫柔得像一封信\n\n城市的燈一盞一盞亮起\n把心事摺成紙飛機",
};

for (const [lang, lines] of Object.entries(LINES)) {
	let index = 0;
	const { bytes, found } = rewriteProtobufLyrics(timed, kind => (kind === "timed" ? lines[index++ % lines.length] : undefined));
	fs.writeFileSync(new URL(`timed_${lang}.pb`, out), bytes);
	console.log(`timed_${lang}.pb`, bytes.length, "anchors", found, "lines", index);
}
for (const [lang, text] of Object.entries(STATIC)) {
	// footer ("来源：LyricFind") lives outside description, it is not touched
	const { bytes, found } = rewriteProtobufLyrics(stat, kind => (kind === "static" ? text : undefined));
	fs.writeFileSync(new URL(`static_${lang}.pb`, out), bytes);
	console.log(`static_${lang}.pb`, bytes.length, "anchors", found);
}

// Future-proofing case: the timed-lyrics anchor renumbered (only the structural fallback can find it)
const en = new Uint8Array(fs.readFileSync(new URL("timed_en.pb", out)));
const oldTag = encodeVarint(465160965 * 8 + 2);
const newTag = encodeVarint(465160999 * 8 + 2);
let replaced = 0;
for (let i = 0; i + oldTag.length <= en.length; i += 1) {
	if (oldTag.every((b, k) => en[i + k] === b)) { en.set(newTag, i); replaced += 1; }
}
fs.writeFileSync(new URL("timed_en_renumbered.pb", out), en);
console.log("timed_en_renumbered.pb tags replaced", replaced);
