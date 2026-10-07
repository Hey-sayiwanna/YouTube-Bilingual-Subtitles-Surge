// Regression gate for the v39 generic standard (languages without a model).
import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";
import { resegmentYouTubeASR } from "../src/function/asrCore.mjs";

const quiet = console.table;
console.table = () => {};
const { rows } = await import("./asr_generic_eval.mjs");
console.table = quiet;
const row = name => rows.find(item => item.name.startsWith(name));
for (const lang of ["en", "ko"]) {
	const v36web = row(`v36 ${lang}-as-unknown web`), web = row(`v39 generic ${lang}-as-unknown web`);
	assert.ok(web.BAD < v36web.BAD - 0.1, `${lang} web: generic BAD ${web.BAD} must beat v36 ${v36web.BAD}`);
	assert.ok(web.sentenceRecall > v36web.sentenceRecall + 0.2, `${lang} web: recall`);
}
const v36ko = row("v36 ko-as-unknown ios"), ko = row("v39 generic ko-as-unknown ios");
assert.ok(ko.BAD <= v36ko.BAD + 0.02, "ios without timing: never worse than v36 for a non-English language");
for (const item of rows.filter(r => r.name.startsWith("v39"))) {
	assert.ok(item.maxWidth <= 80, `${item.name}: width ${item.maxWidth}`);
	assert.equal(item.overlaps, 0, `${item.name}: overlaps`);
}

const texts = body => [].concat(body.timedtext.body.p).map(p => p.s["#"]);

// punctuated ASR in a language without a model: cut exactly at the punctuation
const es = XML.parse(`<timedtext><body><p t="0" d="2500"><s>Hola a todos. Hoy vamos a hablar de la</s></p><p t="2500" d="2500"><s>historia de esta ciudad, que es muy antigua.</s></p><p t="5000" d="2000"><s>¿Están listos?</s></p></body></timedtext>`);
const esStats = resegmentYouTubeASR(es, { languageHint: "es" });
assert.equal(esStats.profile, "generic");
assert.deepEqual(texts(es), ["Hola a todos.", "Hoy vamos a hablar de la historia de esta ciudad, que es muy antigua.", "¿Están listos?"], JSON.stringify(texts(es)));

// no punctuation, real word timing: pauses decide
const ru = XML.parse(`<timedtext><body><w t="0" id="1" wp="1" ws="1"/><p t="0" d="6000" w="1"><s>привет</s><s t="400"> всем</s><s t="1600"> сегодня</s><s t="2100"> мы</s><s t="2300"> поговорим</s><s t="2900"> о</s><s t="3000"> городе</s></p></body></timedtext>`);
resegmentYouTubeASR(ru, { languageHint: "ru" });
assert.deepEqual(texts(ru), ["привет всем", "сегодня мы поговорим о городе"], JSON.stringify(texts(ru)));

// Thai has no spaces: split into words (Intl.Segmenter), never mid-word, width-limited
const thai = "วันนี้เราจะมาพูดคุยเกี่ยวกับประวัติศาสตร์ของเมืองนี้ซึ่งเก่าแก่มากและมีเรื่องราวที่น่าสนใจมากมาย".repeat(2);
const th = XML.parse(`<timedtext><body><p t="0" d="12000"><s>${thai}</s></p></body></timedtext>`);
resegmentYouTubeASR(th, { languageHint: "th" });
const thTexts = texts(th);
assert.ok(thTexts.length >= 2, "long Thai line must be split");
assert.equal(thTexts.join(""), thai, "Thai text must be preserved exactly (no spaces added)");
assert.ok(thTexts.every(t => !/^[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/u.test(t)), "never start a cue with a Thai combining mark");

console.log(JSON.stringify({ asrGenericRegression: "passed", rows: rows.map(r => `${r.name}: BAD ${r.BAD}, recall ${r.sentenceRecall}`) }, null, 1));
