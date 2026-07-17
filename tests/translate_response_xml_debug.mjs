import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";
import {
	disableYouTubeASRRollingWindow,
	ensureYouTubeTimedTextRows,
	measureYouTubeCaptionWidth,
	readYouTubeTimedTextParagraph,
	splitYouTubeASRLongParagraphs,
	splitYouTubeCaptionText,
	writeYouTubeTimedTextParagraph,
} from "../src/function/youtubeTimedText.mjs";

function combineText(originText, transText, ShowOnly = false, position = "Forward", lineBreak = "\n") {
	originText = originText ?? "";
	transText = transText ?? "";
	if (!transText.trim()) return originText;
	if (ShowOnly) return transText;
	return position === "Reverse" ? `${transText}${lineBreak}${originText}` : `${originText}${lineBreak}${transText}`;
}

async function synthesize(xml, platform, translator, automatic = false) {
	const body = XML.parse(xml);
	ensureYouTubeTimedTextRows(body, 2);
	if (automatic) {
		disableYouTubeASRRollingWindow(body);
		splitYouTubeASRLongParagraphs(body, 40);
	}
	const paragraphNode = body?.timedtext?.body?.p ?? [];
	const paragraph = Array.isArray(paragraphNode) ? paragraphNode : paragraphNode ? [paragraphNode] : [];
	const parsedParagraphs = paragraph.map(para => readYouTubeTimedTextParagraph(para));
	const fullText = parsedParagraphs.map(item => item.text);

	let translation = await translator("Part", fullText);
	if (platform === "YouTube" && (!Array.isArray(translation) || translation.length !== fullText.length)) {
		translation = await translator("Row", fullText);
	}
	if (!Array.isArray(translation)) translation = [];
	translation = fullText.map((_, index) => {
		const text = translation[index] ?? "";
		return Array.isArray(text) ? text.flat(Number.POSITIVE_INFINITY).join("") : text;
	});

	paragraph.forEach((para, index) => {
		writeYouTubeTimedTextParagraph(para, fullText[index], translation[index], {
			segmented: parsedParagraphs[index].segmented,
		});
	});
	return XML.stringify(body);
}

const korean = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0"><s>안녕</s><s>하세요</s></p></body></timedtext>`;
const english = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0">Hello world</p></body></timedtext>`;
const mismatchXml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0"><s>一</s></p><p t="1"><s>二</s></p><p t="2"><s>三</s></p></body></timedtext>`;
const capturedSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><p t="22160" d="5960" w="1"><s>Make</s><s t="720"> way,</s><s t="1640"> the</s><s t="1880"> beast</s><s t="2720"> has</s><s t="3080"> returned.</s></p></body></timedtext>`;
const rollingSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><ws id="0"/><ws id="1" mh="2" ju="0" sd="3"/><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><w t="0" id="1" wp="1" ws="1"/><p t="40" d="4200" w="1"><s>첫 번째 문장</s></p><p t="4230" w="1" a="1"></p><p t="4240" d="4200" w="1"><s>두 번째 문장</s></p></body></timedtext>`;
const longASRSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><p t="1000" d="9000" w="1"><s>This is a very long automatic caption, and it should be divided at a natural boundary before it overlaps.</s></p><p t="8500" d="2000" w="1"><s>Next caption.</s></p></body></timedtext>`;
const noPunctuationKorean = "자동생성자막이아주길어도화면에서서로겹치지않도록안전하게나누어표시해야합니다";
const escapedXml = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0"><s>A &amp; B</s></p></body></timedtext>`;

const koreanOutput = await synthesize(korean, "YouTube", async (_method, text) => text.map(() => "你好"));
assert.match(koreanOutput, /안녕.*하세요/);
assert.match(koreanOutput, /你好/);

const englishOutput = await synthesize(english, "YouTube", async (_method, text) => text.map(() => "你好，世界"));
assert.match(englishOutput, /Hello world/);
assert.match(englishOutput, /你好，世界/);

const calls = [];
const mismatchOutput = await synthesize(mismatchXml, "YouTube", async (method, text) => {
	calls.push(method);
	return method === "Part" ? ["只有一条"] : text.map(() => ["逐行翻译"]);
});
assert.deepEqual(calls, ["Part", "Row"]);
assert.match(mismatchOutput, /逐行翻译/);
assert.doesNotMatch(mismatchOutput, /undefined/);
assert.equal(combineText("原文", ""), "原文");

const capturedOutput = await synthesize(capturedSrv3, "YouTube", async (_method, text) => text.map(() => "让开，野兽回来了。"), true);
assert.match(capturedOutput, /rc="2"/);
assert.match(capturedOutput, /<s>Make way, the beast has returned\.&#x000A;让开，野兽回来了。<\/s>/);
assert.doesNotMatch(capturedOutput, /Make  way/);
assert.equal((capturedOutput.match(/<s>/g) ?? []).length, 1);

const rollingOutput = await synthesize(rollingSrv3, "YouTube", async (_method, text) => text.map((_, index) => `翻译${index + 1}`), true);
const rollingBody = XML.parse(rollingOutput);
const rollingParagraphs = rollingBody.timedtext.body.p;
assert.equal(rollingBody.timedtext.body.w, undefined);
assert.ok(rollingParagraphs.every(paragraph => paragraph["@w"] === undefined && paragraph["@a"] === undefined));
assert.match(rollingOutput, /첫 번째 문장&#x000A;翻译1/);
assert.match(rollingOutput, /두 번째 문장&#x000A;翻译3/);

const officialOutput = await synthesize(rollingSrv3, "YouTube", async (_method, text) => text.map(() => "官方翻译"), false);
const officialBody = XML.parse(officialOutput);
assert.notEqual(officialBody.timedtext.body.w, undefined);
assert.equal(officialBody.timedtext.body.p[0]["@w"], "1");
assert.equal(officialBody.timedtext.body.p[1]["@a"], "1");

const longBody = XML.parse(longASRSrv3);
disableYouTubeASRRollingWindow(longBody);
const longSplit = splitYouTubeASRLongParagraphs(longBody, 40);
const longParagraphs = longBody.timedtext.body.p;
assert.equal(longSplit.input, 2);
assert.ok(longSplit.split >= 1);
assert.ok(longSplit.output > longSplit.input);
assert.equal(longSplit.shortened, 1);
assert.ok(longParagraphs.every(paragraph => {
	const text = readYouTubeTimedTextParagraph(paragraph).text;
	return text === "Next caption." || measureYouTubeCaptionWidth(text) <= 40;
}));
for (let index = 0; index < longParagraphs.length - 1; index += 1) {
	const currentEnd = Number(longParagraphs[index]["@t"]) + Number(longParagraphs[index]["@d"] ?? 0);
	const nextStart = Number(longParagraphs[index + 1]["@t"]);
	assert.ok(currentEnd <= nextStart, `cue ${index} overlaps cue ${index + 1}`);
}
assert.ok(splitYouTubeCaptionText(noPunctuationKorean, 40).length > 1);
assert.ok(splitYouTubeCaptionText(noPunctuationKorean, 40).every(text => measureYouTubeCaptionWidth(text) <= 40));

const officialLongBody = XML.parse(longASRSrv3);
const officialLongParagraphs = officialLongBody.timedtext.body.p;
assert.equal(officialLongParagraphs.length, 2);
assert.equal(officialLongParagraphs[0]["@d"], "9000");

const escapedOutput = await synthesize(escapedXml, "YouTube", async (_method, text) => text.map(() => "甲&乙"));
assert.match(escapedOutput, /A &amp; B&#x000A;甲&amp;乙/);
assert.doesNotThrow(() => XML.parse(escapedOutput));

console.log(JSON.stringify({
	korean: "passed",
	english: "passed",
	mismatchFallback: "passed",
	emptyTranslation: "passed",
	capturedSrv3: "passed",
	autoGeneratedTwoLines: "passed",
	autoGeneratedLongCueSplit: "passed",
	autoGeneratedNoPunctuationSplit: "passed",
	autoGeneratedNonOverlappingTiming: "passed",
	officialRollingPreserved: "passed",
	officialLongCuePreserved: "passed",
	xmlEscaping: "passed"
}, null, 2));
