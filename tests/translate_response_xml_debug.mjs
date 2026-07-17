import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";
import {
	ensureYouTubeTimedTextRows,
	readYouTubeTimedTextParagraph,
	writeYouTubeTimedTextParagraph,
} from "../src/function/youtubeTimedText.mjs";

function combineText(originText, transText, ShowOnly = false, position = "Forward", lineBreak = "\n") {
	originText = originText ?? "";
	transText = transText ?? "";
	if (!transText.trim()) return originText;
	if (ShowOnly) return transText;
	return position === "Reverse" ? `${transText}${lineBreak}${originText}` : `${originText}${lineBreak}${transText}`;
}

async function synthesize(xml, platform, translator) {
	const body = XML.parse(xml);
	ensureYouTubeTimedTextRows(body, 2);
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

const capturedOutput = await synthesize(capturedSrv3, "YouTube", async (_method, text) => text.map(() => "让开，野兽回来了。"));
assert.match(capturedOutput, /rc="2"/);
assert.match(capturedOutput, /<s>Make way, the beast has returned\.&#x000A;让开，野兽回来了。<\/s>/);
assert.doesNotMatch(capturedOutput, /Make  way/);
assert.equal((capturedOutput.match(/<s>/g) ?? []).length, 1);

const escapedOutput = await synthesize(escapedXml, "YouTube", async (_method, text) => text.map(() => "甲&乙"));
assert.match(escapedOutput, /A &amp; B&#x000A;甲&amp;乙/);
assert.doesNotThrow(() => XML.parse(escapedOutput));

console.log(JSON.stringify({
	korean: "passed",
	english: "passed",
	mismatchFallback: "passed",
	emptyTranslation: "passed",
	capturedSrv3: "passed",
	xmlEscaping: "passed"
}, null, 2));
