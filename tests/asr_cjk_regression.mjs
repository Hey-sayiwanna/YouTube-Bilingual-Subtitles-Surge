// Regression gate for v38 Japanese / Korean ASR segmentation (run by `npm test`).
import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";
import { resegmentYouTubeASR, detectASRLanguage } from "../src/function/asrSegmenter.mjs";

const quiet = console.table;
console.table = () => {};
const { rows } = await import("./asr_cjk_eval.mjs");
console.table = quiet;

for (const row of rows.filter(row => row.name.startsWith("v38"))) {
	const v36 = rows.find(other => other.name === row.name.replace("v38", "v36").replace(/ \((?:ja|ko)\)$/, ""));
	assert.ok(row.BAD <= 0.18, `${row.name}: unnatural boundary rate ${row.BAD}`);
	assert.ok(row.BAD < v36.BAD / 3, `${row.name}: must be far better than v36 (${v36.BAD})`);
	assert.ok(row.sentenceRecall >= 0.85, `${row.name}: sentence recall ${row.sentenceRecall}`);
	assert.ok(row.maxWidth <= 70, `${row.name}: cue too wide (${row.maxWidth})`);
	assert.equal(row.overlaps, 0, `${row.name}: overlapping cues`);
}

const cues = body => [].concat(body.timedtext.body.p).map(p => p.s["#"]);

// Japanese: web format, one <s> per morpheme with offsets, rolling window
const ja = XML.parse(`<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><w t="0" id="1" wp="1" ws="1"/>` +
	`<p t="0" d="6000" w="1"><s ac="0">今日</s><s t="400" ac="0">は</s><s t="600" ac="0">天気</s><s t="1000" ac="0">が</s><s t="1200" ac="0">いい</s><s t="1500" ac="0">です</s><s t="1800" ac="0">ね</s><s t="2600" ac="0">明日</s><s t="3000" ac="0">は</s></p>` +
	`<p t="3200" d="10" w="1" a="1">\n</p><p t="3210" d="4000" w="1"><s ac="0">雨</s><s t="300" ac="0">が</s><s t="500" ac="0">降る</s><s t="900" ac="0">そう</s><s t="1200" ac="0">です</s></p></body></timedtext>`);
const jaStats = resegmentYouTubeASR(ja, { languageHint: "ja" });
assert.equal(jaStats.language, "ja");
assert.deepEqual(cues(ja), ["今日は天気がいいですね。", "明日は雨が降るそうです。"], JSON.stringify(cues(ja)));

// Korean: iOS paragraph-timed format, sentence crosses the original <p> border
const ko = XML.parse(`<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>` +
	`<p t="0" d="2500"><s>오늘은 날씨가 정말 좋네요 그래서 우리는</s></p><p t="2500" d="2500"><s>공원에 가기로 했습니다</s></p></body></timedtext>`);
assert.equal(resegmentYouTubeASR(ko).language, "ko");
assert.deepEqual(cues(ko), ["오늘은 날씨가 정말 좋네요.", "그래서 우리는 공원에 가기로 했습니다."], JSON.stringify(cues(ko)));

// language selection
const empty = { timedtext: { body: { p: [] } } };
assert.equal(detectASRLanguage(empty, "ja"), "ja");
assert.equal(detectASRLanguage(empty, "ko-KR"), "ko");
assert.equal(detectASRLanguage(empty, "es"), "es");
const es = resegmentYouTubeASR(XML.parse(`<timedtext><body><p t="0" d="2000"><s>hola a todos como estan</s></p></body></timedtext>`), { languageHint: "es" });
assert.equal(es.applied, true);
assert.equal(es.profile, "generic", "languages without a model use the generic standard (v39)");

console.log(JSON.stringify({ asrCjkRegression: "passed", rows: rows.map(row => `${row.name}: BAD ${row.BAD}, recall ${row.sentenceRecall}`) }, null, 1));
