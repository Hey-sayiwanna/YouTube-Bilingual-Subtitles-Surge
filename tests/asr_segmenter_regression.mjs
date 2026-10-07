// Regression gate for the v37 ASR segmenter (run by `npm test`).
import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";
import { resegmentYouTubeASR, extractASRWords } from "../src/function/asrSegmenter.mjs";

const silence = console.table;
console.table = () => {};
const { summary, report } = await import("./asr_segmenter_eval.mjs");
console.table = silence;

const baseline = summary[0];
for (const row of summary.slice(1)) {
	assert.ok(row.BAD <= 0.2, `${row.name}: unnatural boundary rate ${row.BAD} > 0.20`);
	assert.ok(row.BAD < baseline.BAD / 2, `${row.name}: must at least halve v36 bad boundaries`);
	assert.ok(row.sentenceRecall >= 0.6, `${row.name}: sentence-end recall ${row.sentenceRecall} < 0.60`);
	assert.ok(row.maxChars <= 90, `${row.name}: cue longer than 90 chars`);
	assert.equal(row.overlaps, 0, `${row.name}: overlapping cues`);
}
for (const { cues } of Object.values(report)) {
	const texts = cues.map(cue => cue.text);
	assert.ok(!texts.some(text => /^up Aran/i.test(text)), "'up' must stay with 'wake'");
	assert.ok(texts.some(text => /to wake up\.?$/.test(text)), "'to wake up' must end a cue");
	for (let i = 0; i < cues.length - 1; i++) assert.ok(cues[i].end <= cues[i + 1].start && cues[i].end > cues[i].start);
}

// orphan across a [Music] cue goes back to its sentence
const music = XML.parse(`<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="2600"><s>but little hardy yakuts know how to fight the</s></p><p t="2700" d="20000"><s>[Music]</s></p><p t="23000" d="1200"><s>cold</s></p><p t="24300" d="3000"><s>after a few minutes the icy weather begins</s></p></body></timedtext>`);
resegmentYouTubeASR(music);
const musicTexts = music.timedtext.body.p.map(p => p.s["#"]);
assert.match(musicTexts[0], /fight the cold\.?$/, JSON.stringify(musicTexts));
assert.equal(musicTexts[1], "[Music]");

// rolling-window web format with exact <s t> offsets
const rolling = XML.parse(`<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><w t="0" id="1" wp="1" ws="1"/><p t="0" d="5000" w="1"><s ac="0">it's</s><s t="300" ac="0"> time</s><s t="600" ac="0"> for</s><s t="900" ac="0"> lunch</s><s t="1200" ac="0"> and</s><s t="1500" ac="0"> he</s><s t="1800" ac="0"> is</s></p><p t="2000" d="10" w="1" a="1">\n</p><p t="2010" d="4000" w="1"><s ac="0">always</s><s t="300" ac="0"> here</s><s t="600" ac="0"> to</s><s t="900" ac="0"> help</s><s t="1200" ac="0"> his</s><s t="1500" ac="0"> mom</s></p></body></timedtext>`);
const rollingStats = resegmentYouTubeASR(rolling);
assert.equal(rollingStats.reason, "exact-word-timing");
assert.equal(rolling.timedtext.body.w, undefined, "rolling window removed");
const rollingP = [].concat(rolling.timedtext.body.p);
const rollingText = rollingP.map(p => p.s["#"]).join(" ");
assert.match(rollingText, /^It's time for lunch\.? (?:and|And) he is always here to help his mom\.?$/, rollingText);
assert.ok(!rollingP.some(p => /\bis$/.test(p.s["#"])), "must not break between 'is' and 'always' (original <p> border)");

console.log(JSON.stringify({ asrSegmenterRegression: "passed", summary }, null, 1));

// Ordinary, non-overlapping speech must retain genuine repeated phrases.
const overlappingSpeech = XML.parse(`<timedtext><body><p t="0" d="5000"><s>one two three</s></p><p t="1000" d="4000"><s>one two three four five</s></p></body></timedtext>`);
assert.equal(
	extractASRWords(overlappingSpeech).words.map(word => word.text).join(" "),
	"one two three four five",
	"overlapping rolling captions must remove duplicated prefixes",
);
const adjacentSpeech = XML.parse(`<timedtext><body><p t="0" d="1000"><s>let patients help</s></p><p t="1000" d="2000"><s>let patients help us</s></p></body></timedtext>`);
assert.equal(
	extractASRWords(adjacentSpeech).words.map(word => word.text).join(" "),
	"let patients help let patients help us",
	"adjacent spoken repetition must be retained",
);
// Long display windows do not imply that precisely timed speech overlaps.
for (const [nextStart, expected] of [
	[400, "one two three four five"],
	[2000, "one two three one two three four five"],
]) {
	const exactSpeech = XML.parse(`<timedtext><body><p t="0" d="5000"><s>one</s><s t="400"> two</s><s t="800"> three</s></p><p t="${nextStart}" d="4000"><s>one</s><s t="400"> two</s><s t="800"> three</s><s t="1200"> four</s><s t="1600"> five</s></p></body></timedtext>`);
	assert.equal(
		extractASRWords(exactSpeech).words.map(word => word.text).join(" "),
		expected,
		`precise speech timing must govern deduplication at ${nextStart}ms`,
	);
}
const repeatedSpeech = XML.parse(`<timedtext><body><p t="0" d="1000"><s>let patients help</s></p><p t="10000" d="2000"><s>let patients help us</s></p></body></timedtext>`);
assert.equal(
    extractASRWords(repeatedSpeech).words.map(word => word.text).join(" "),
    "let patients help let patients help us",
    "non-overlapping spoken repetition must never be removed as rolling text",
);
