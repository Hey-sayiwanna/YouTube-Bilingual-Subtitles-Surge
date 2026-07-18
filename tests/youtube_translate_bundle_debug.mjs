import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";

const rollingSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><ws id="0"/><ws id="1" mh="2" ju="0" sd="3"/><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><w t="0" id="1" wp="1" ws="1"/><p t="40" d="4200" w="1"><s>첫 번째 문장</s></p><p t="4230" w="1" a="1"></p><p t="4240" d="4200" w="1"><s>두 번째 문장</s></p></body></timedtext>`;
const longSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><p t="1000" d="9000" w="1"><s>This is a very long automatic caption, and it should be divided at a natural boundary before it overlaps.</s></p><p t="8500" d="2000" w="1"><s>Next caption.</s></p></body></timedtext>`;
const largeSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 231 }, (_, index) => `<p t="${index * 2000}" d="1900" w="1"><s>자동 생성 자막 ${index + 1}: 화면 문장입니다.</s></p>`).join("")}</body></timedtext>`;
const multilineSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 535 }, (_, index) => `<p t="${index * 2000}" d="1900">자동 자막 ${index + 1}${index % 3 === 0 ? "\n본문 두 번째 줄" : ""}</p>`).join("")}</body></timedtext>`;
const ipadMergedSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 248 }, (_, index) => `<p t="${index * 8000}" d="7900" w="1"><s>${index < 126 ? "가".repeat(24) : `짧은 자동 자막 ${index + 1}`}</s></p>`).join("")}</body></timedtext>`;
const largeOfficialSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>${Array.from({ length: 121 }, (_, index) => `<p t="${index * 2000}" d="1900">Official caption ${index + 1}</p>`).join("")}</body></timedtext>`;

async function runBundle({ url, translation, testName, body = rollingSrv3 }) {
	const translateRequestURLs = [];
	globalThis.$environment = { "surge-version": "5.0" };
	globalThis.$script = { startTime: Date.now() / 1000 };
	globalThis.$request = { method: "GET", url, headers: {} };
	globalThis.$response = {
		status: 200,
		headers: { "Content-Type": "text/xml; charset=utf-8" },
		body,
	};
	globalThis.$httpClient = {
		get(request, callback) {
			translateRequestURLs.push(request.url);
			const sourceRows = new URL(request.url).searchParams.get("q").split(/\r/);
			const translated = typeof translation === "function" ? translation(sourceRows) : translation;
			callback(null, { status: 200, headers: {} }, JSON.stringify([[[translated, "source", null, null]], null, "ko"]));
		},
	};

	let finish;
	const completed = new Promise(resolve => {
		finish = resolve;
	});
	globalThis.$done = value => finish(value);

	await import(`../Translate.response.youtube-fix-v19.bundle.js?test=${testName}-${Date.now()}`);
	let timeout;
	const output = await Promise.race([
		completed,
		new Promise((_, reject) => {
			timeout = setTimeout(() => reject(new Error(`${testName} bundle test timed out`)), 5000);
		}),
	]);
	clearTimeout(timeout);
	return { output, translateRequestURL: translateRequestURLs.at(-1), translateRequestURLs };
}

const automatic = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=test&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: "第一句\r\u200b\r第二句",
	testName: "automatic",
});

assert.match(automatic.translateRequestURL, /translate\.googleapis\.com/);
assert.match(automatic.translateRequestURL, /[?&]sl=auto(?:&|$)/);
assert.match(automatic.translateRequestURL, /[?&]tl=zh-CN(?:&|$)/);
assert.equal(automatic.output.headers["X-Hey-Sayiwanna-YouTube-Fix"], "19");
assert.equal(automatic.output.headers["X-Hey-Sayiwanna-Settings"], "standalone-no-boxjs");
assert.equal(automatic.output.headers["X-Hey-Sayiwanna-ASR-Mode"], "fixed-two-lines-split-long-cues");
const automaticBody = XML.parse(automatic.output.body).timedtext.body;
assert.equal(automaticBody.w, undefined);
assert.ok(automaticBody.p.every(paragraph => paragraph["@w"] === undefined && paragraph["@a"] === undefined));
assert.match(automatic.output.body, /첫 번째 문장&#x000A;第一句/);
assert.match(automatic.output.body, /두 번째 문장&#x000A;第二句/);

const longAutomatic = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=test&kind=asr&lang=en&format=srv3&subtype=Translate",
	translation: "这是很长的自动字幕。\r应该在自然位置拆分。\r避免它们互相重叠。\r下一条字幕。",
	testName: "long-automatic",
	body: longSrv3,
});
const longParagraphs = XML.parse(longAutomatic.output.body).timedtext.body.p;
assert.equal(longParagraphs.length, 4);
assert.match(longAutomatic.output.body, /This is a very long automatic caption,&#x000A;这是很长的自动字幕。/);
assert.match(longAutomatic.output.body, /boundary before it overlaps\.&#x000A;避免它们互相重叠。/);
for (let index = 0; index < longParagraphs.length - 1; index += 1) {
	const currentEnd = Number(longParagraphs[index]["@t"]) + Number(longParagraphs[index]["@d"] ?? 0);
	const nextStart = Number(longParagraphs[index + 1]["@t"]);
	assert.ok(currentEnd <= nextStart, `bundle cue ${index} overlaps cue ${index + 1}`);
}

const official = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=test&lang=ko&format=srv3&subtype=Translate",
	translation: "第一句\r\u200b\r第二句",
	testName: "official",
});

assert.equal(official.output.headers["X-Hey-Sayiwanna-YouTube-Fix"], "19");
assert.equal(official.output.headers["X-Hey-Sayiwanna-ASR-Mode"], "unchanged");
const officialBody = XML.parse(official.output.body).timedtext.body;
assert.notEqual(officialBody.w, undefined);
assert.equal(officialBody.p[0]["@w"], "1");
assert.equal(officialBody.p[1]["@a"], "1");

const capturedLike = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=ipad&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `并发翻译${index + 1}`).join("\r"),
	testName: "ipad-large-automatic",
	body: largeSrv3,
});
assert.ok(capturedLike.translateRequestURLs.length > 2);
assert.ok(capturedLike.translateRequestURLs.every(url => {
	const query = new URL(url).searchParams.get("q");
	return encodeURIComponent(query).length <= 2400;
}));
assert.equal(XML.parse(capturedLike.output.body).timedtext.body.p.length, 231);

const multilineAutomatic = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=multiline&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `翻译${index + 1}\n翻译正文第二行`).join("\r"),
	testName: "automatic-multiline-body",
	body: multilineSrv3,
});
assert.ok(multilineAutomatic.translateRequestURLs.length > 2);
assert.ok(multilineAutomatic.translateRequestURLs.every(url => encodeURIComponent(new URL(url).searchParams.get("q")).length <= 2400));
assert.equal(XML.parse(multilineAutomatic.output.body).timedtext.body.p.length, 535);
assert.equal((multilineAutomatic.output.body.match(/&#x000A;翻译/gu) ?? []).length, 535);

let droppedAutomaticRow = false;
const ipadMergedMismatch = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=ipad-merged&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: rows => {
		const translated = rows.map((_, index) => `局部重试翻译${index + 1}`);
		if (!droppedAutomaticRow && rows.length > 1) {
			droppedAutomaticRow = true;
			translated.pop();
		}
		return translated.join("\r");
	},
	testName: "ipad-merged-single-batch-mismatch",
	body: ipadMergedSrv3,
});
assert.equal(XML.parse(ipadMergedMismatch.output.body).timedtext.body.p.length, 374);
assert.equal((ipadMergedMismatch.output.body.match(/&#x000A;局部重试翻译/gu) ?? []).length, 374);
assert.ok(ipadMergedMismatch.translateRequestURLs.length < 80, "a single bad batch must not retry every subtitle row");

const largeOfficial = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=official&lang=en&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `官方翻译${index + 1}`).join("\r"),
	testName: "official-v16-batching",
	body: largeOfficialSrv3,
});
assert.equal(largeOfficial.translateRequestURLs.length, 2);
assert.equal(new URL(largeOfficial.translateRequestURLs[0]).searchParams.get("q").split(/\r/).length, 120);
assert.equal(new URL(largeOfficial.translateRequestURLs[1]).searchParams.get("q").split(/\r/).length, 1);

console.log(JSON.stringify({
	standaloneBundle: "passed",
	googleAutoToZhHans: "passed",
	autoGeneratedFixedTwoLines: "passed",
	autoGeneratedLongCueSplit: "passed",
	autoGeneratedNonOverlappingTiming: "passed",
	officialCaptionsUnchanged: "passed",
	ipadLargeASRSmallBatching: "passed",
	automaticMultilineRowsPreserved: "passed",
	ipadMergedBatchMismatchRecoveredLocally: "passed",
	officialV16BatchingPreserved: "passed",
}, null, 2));
