import assert from "node:assert/strict";
import XML from "../src/XML/XML.mjs";

const rollingSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><ws id="0"/><ws id="1" mh="2" ju="0" sd="3"/><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><w t="0" id="1" wp="1" ws="1"/><p t="40" d="4200" w="1"><s>첫 번째 문장</s></p><p t="4230" w="1" a="1"></p><p t="4240" d="4200" w="1"><s>두 번째 문장</s></p></body></timedtext>`;
const plainOfficialSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="2" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><p t="40" d="4200" wp="2"><s>첫 번째 문장</s></p><p t="4230" d="10" wp="2"></p><p t="4240" d="4200" wp="2"><s>두 번째 문장</s></p></body></timedtext>`;
const longSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><p t="1000" d="9000" w="1"><s>This is a very long automatic caption, and it should be divided at a natural boundary before it overlaps.</s></p><p t="8500" d="2000" w="1"><s>Next caption.</s></p></body></timedtext>`;
const largeSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 231 }, (_, index) => `<p t="${index * 2000}" d="1900" w="1"><s>자동 생성 자막 ${index + 1}: 화면 문장입니다.</s></p>`).join("")}</body></timedtext>`;
const multilineSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 535 }, (_, index) => `<p t="${index * 2000}" d="1900">자동 자막 ${index + 1}${index % 3 === 0 ? "\n본문 두 번째 줄" : ""}</p>`).join("")}</body></timedtext>`;
const ipadMergedSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 248 }, (_, index) => `<p t="${index * 8000}" d="7900" w="1"><s>${index < 126 ? "가".repeat(24) : `짧은 자동 자막 ${index + 1}`}</s></p>`).join("")}</body></timedtext>`;
const hugeSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${Array.from({ length: 3711 }, (_, index) => `<p t="${index * 2000}" d="1900" w="1"><s>자동 자막 ${index + 1}</s></p>`).join("")}</body></timedtext>`;
const shortOfficialFragmentsSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="1000" d="1000">This is one</p><p t="2000" d="1100">complete official</p><p t="3100" d="900">caption.</p><p t="4000" d="900">Next sentence.</p></body></timedtext>`;
const largeOfficialSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>${Array.from({ length: 121 }, (_, index) => `<p t="${index * 2000}" d="1900">Official caption ${index + 1}.</p>`).join("")}</body></timedtext>`;
const hugeOfficialSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>${Array.from({ length: 5578 }, (_, index) => `<p t="${index * 2000}" d="1900">Long movie official caption ${index + 1}.</p>`).join("")}</body></timedtext>`;
const largeBroadcastSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><ws id="1" mh="2" ju="0" sd="3"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><w t="0" id="1" wp="1" ws="1"/>${Array.from({ length: 3001 }, (_, index) => `<p t="${index * 2000}" d="1900" w="1"><s>Broadcast caption ${index + 1}</s></p>`).join("")}</body></timedtext>`;
const simplifiedChineseSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="3000">这是简体中文字幕，不需要再次翻译。</p></body></timedtext>`;
const traditionalChineseSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><p t="0" d="3000">這是繁體中文字幕，不需要再次翻譯。</p></body></timedtext>`;

async function runBundle({ url, translation, testName, body = rollingSrv3, concurrentRequestLimit = Number.POSITIVE_INFINITY, responseDelay = 0 }) {
	const translateRequestURLs = [];
	let activeRequests = 0;
	let maximumActiveRequests = 0;
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
			if (activeRequests >= concurrentRequestLimit) {
				callback(new Error("Excessive concurrent requests"));
				return;
			}
			activeRequests += 1;
			maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
			const sourceRows = new URL(request.url).searchParams.get("q").split(/\r/);
			const translated = typeof translation === "function" ? translation(sourceRows) : translation;
			const respond = () => {
				activeRequests -= 1;
				callback(null, { status: 200, headers: {} }, JSON.stringify([[[translated, "source", null, null]], null, "ko"]));
			};
			if (responseDelay > 0) setTimeout(respond, responseDelay);
			else respond();
		},
	};

	let finish;
	const completed = new Promise(resolve => {
		finish = resolve;
	});
	globalThis.$done = value => finish(value);

	await import(`../Translate.response.youtube-fix-v30.bundle.js?test=${testName}-${Date.now()}`);
	let timeout;
	const output = await Promise.race([
		completed,
		new Promise((_, reject) => {
			timeout = setTimeout(() => reject(new Error(`${testName} bundle test timed out`)), 5000);
		}),
	]);
	clearTimeout(timeout);
	return { output, translateRequestURL: translateRequestURLs.at(-1), translateRequestURLs, maximumActiveRequests };
}

const automatic = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=test&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: "第一句\r\u200b\r第二句",
	testName: "automatic",
});

assert.match(automatic.translateRequestURL, /translate\.googleapis\.com/);
assert.match(automatic.translateRequestURL, /[?&]sl=auto(?:&|$)/);
assert.match(automatic.translateRequestURL, /[?&]tl=zh-CN(?:&|$)/);
assert.equal(automatic.output.headers["X-Hey-Sayiwanna-YouTube-Fix"], "30");
assert.equal(automatic.output.headers["X-Hey-Sayiwanna-Settings"], "standalone-no-boxjs");
assert.equal(automatic.output.headers["X-Hey-Sayiwanna-ASR-Mode"], "timed-stream-v30-with-v29-fallback");
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
	body: plainOfficialSrv3,
});

assert.equal(official.output.headers["X-Hey-Sayiwanna-YouTube-Fix"], "30");
assert.equal(official.output.headers["X-Hey-Sayiwanna-ASR-Mode"], "unchanged");
assert.equal(official.output.headers["X-Hey-Sayiwanna-Broadcast-Mode"], "unchanged");
assert.equal(official.output.headers["X-Hey-Sayiwanna-Caption-Mode"], "official");
const officialBody = XML.parse(official.output.body).timedtext.body;
assert.equal(officialBody.p[0]["@wp"], "2");
assert.equal(officialBody.p[1]["@wp"], "2");
assert.match(official.output.body, /첫 번째 문장&#x000A;第一句/);
assert.match(official.output.body, /두 번째 문장&#x000A;第二句/);

for (const [testName, language, body] of [
	["simplified-chinese-pass-through", "zh-Hans", simplifiedChineseSrv3],
	["traditional-chinese-pass-through", "zh-Hant", traditionalChineseSrv3],
	["traditional-taiwan-pass-through", "zh-TW", traditionalChineseSrv3],
]) {
	const chinese = await runBundle({
		url: `https://www.youtube.com/api/timedtext?v=chinese&lang=${language}&format=srv3&subtype=Translate`,
		translation: () => {
			throw new Error("Chinese source must not call Google Translate");
		},
		testName,
		body,
	});
	assert.equal(chinese.output.body, body, `${language} source XML must remain byte-for-byte unchanged`);
	assert.equal(chinese.translateRequestURLs.length, 0, `${language} source must not send translation requests`);
	assert.equal(chinese.output.headers["X-Hey-Sayiwanna-Caption-Mode"], "chinese-pass-through");
}

const groupedOfficial = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=official-fragments&lang=en&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `合并翻译${index + 1}`).join("\r"),
	testName: "official-short-sentence-grouping",
	body: shortOfficialFragmentsSrv3,
});
const groupedOfficialParagraphs = XML.parse(groupedOfficial.output.body).timedtext.body.p;
assert.equal(groupedOfficialParagraphs.length, 2);
assert.match(groupedOfficial.output.body, /This is one complete official caption\.&#x000A;合并翻译1/);
assert.match(groupedOfficial.output.body, /Next sentence\.&#x000A;合并翻译2/);

const broadcastCC2 = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=broadcast&lang=en&name=CC2&format=srv3&subtype=Translate",
	translation: "上一句翻译\r\u200b\r当前句翻译",
	testName: "broadcast-cc2-rolling-window",
});
assert.equal(broadcastCC2.output.headers["X-Hey-Sayiwanna-Caption-Mode"], "broadcast");
const broadcastCC2Body = XML.parse(broadcastCC2.output.body).timedtext.body;
assert.equal(broadcastCC2Body.w, undefined);
assert.ok(broadcastCC2Body.p.every(paragraph => paragraph["@w"] === undefined && paragraph["@a"] === undefined));
assert.equal(broadcastCC2Body.p[0]["@d"], "4190", "the previous broadcast cue must end before the next roll-up event starts");
assert.match(broadcastCC2.output.body, /첫 번째 문장&#x000A;上一句翻译/);
assert.match(broadcastCC2.output.body, /두 번째 문장&#x000A;当前句翻译/);

const unnamedBroadcast = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=broadcast&lang=en&name=English&format=srv3&subtype=Translate",
	translation: "上一句翻译\r\u200b\r当前句翻译",
	testName: "broadcast-structure-fallback",
});
assert.equal(unnamedBroadcast.output.headers["X-Hey-Sayiwanna-Caption-Mode"], "broadcast");
assert.equal(XML.parse(unnamedBroadcast.output.body).timedtext.body.w, undefined);

const broadcastTrackNameFamilies = [
	"CC1",
	"CC4",
	"DTVCC1",
	"DTVCC63",
	"SERVICE1",
	"Service 63",
	"CEA-608",
	"EIA 708",
	"Embedded 608/708",
	"Line 21",
];
for (const [index, trackName] of broadcastTrackNameFamilies.entries()) {
	const namedBroadcast = await runBundle({
		url: `https://www.youtube.com/api/timedtext?v=broadcast-name&lang=en&name=${encodeURIComponent(trackName)}&format=srv3&subtype=Translate`,
		translation: "第一句\r\u200b\r第二句",
		testName: `broadcast-name-family-${index}`,
		body: plainOfficialSrv3,
	});
	assert.equal(namedBroadcast.output.headers["X-Hey-Sayiwanna-Caption-Mode"], "broadcast", `${trackName} should use the isolated broadcast path`);
}

const longBroadcast = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=broadcast-long&lang=en&name=DTVCC2&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `广播字幕翻译${index + 1}`).join("\r"),
	testName: "broadcast-dtvcc-bounded-concurrency",
	body: largeBroadcastSrv3,
	concurrentRequestLimit: 6,
	responseDelay: 2,
});
assert.equal(longBroadcast.output.headers["X-Hey-Sayiwanna-Caption-Mode"], "broadcast");
assert.equal((longBroadcast.output.body.match(/&#x000A;广播字幕翻译/gu) ?? []).length, 3001);
assert.ok(longBroadcast.maximumActiveRequests <= 6, `broadcast translation concurrency must stay bounded, received ${longBroadcast.maximumActiveRequests}`);

const capturedLike = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=ipad&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `并发翻译${index + 1}`).join("\r"),
	testName: "ipad-large-automatic",
	body: largeSrv3,
	responseDelay: 2,
});
assert.ok(capturedLike.translateRequestURLs.length > 2);
assert.ok(capturedLike.maximumActiveRequests > 6, "normal automatic captions must keep the original direct scheduling path");
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
assert.equal(XML.parse(ipadMergedMismatch.output.body).timedtext.body.p.length, 248);
assert.equal((ipadMergedMismatch.output.body.match(/&#x000A;局部重试翻译/gu) ?? []).length, 248);
assert.ok(ipadMergedMismatch.translateRequestURLs.length < 80, "a single bad batch must not retry every subtitle row");

let droppedHugeAutomaticRow = false;
const hugeAutomatic = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=huge&kind=asr&lang=ko&format=srv3&subtype=Translate",
	translation: rows => {
		const translated = rows.map((_, index) => `超长视频翻译${index + 1}`);
		if (!droppedHugeAutomaticRow && rows.length > 1) {
			droppedHugeAutomaticRow = true;
			translated.pop();
		}
		return translated.join("\r");
	},
	testName: "automatic-bounded-concurrency",
	body: hugeSrv3,
	concurrentRequestLimit: 6,
	responseDelay: 2,
});
assert.equal((hugeAutomatic.output.body.match(/&#x000A;超长视频翻译/gu) ?? []).length, 3711);
assert.ok(hugeAutomatic.translateRequestURLs.length > 60);
assert.ok(hugeAutomatic.maximumActiveRequests <= 6, `automatic translation concurrency must stay bounded, received ${hugeAutomatic.maximumActiveRequests}`);

const largeOfficial = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=official&lang=en&format=srv3&subtype=Translate",
	translation: rows => rows.map((_, index) => `官方翻译${index + 1}`).join("\r"),
	testName: "official-v16-batching",
	body: largeOfficialSrv3,
});
assert.equal(largeOfficial.translateRequestURLs.length, 2);
assert.equal(new URL(largeOfficial.translateRequestURLs[0]).searchParams.get("q").split(/\r/).length, 120);
assert.equal(new URL(largeOfficial.translateRequestURLs[1]).searchParams.get("q").split(/\r/).length, 1);

// Representative official-track sizes from the iPad logs; these are synthetic
// captions, not uploaded transcripts or an exact replay of the failed response.
for (const count of [205, 282]) {
	const paragraphs = Array.from({ length: count }, (_, index) => `<p t="${index * 3000}" d="2000" wp="2">공식 자막 문장 ${index + 1}.</p>`).join("");
	const oversizedOfficial = await runBundle({
		url: "https://www.youtube.com/api/timedtext?v=official-long-query&lang=ko&format=srv3&subtype=Translate",
		translation: rows => rows.map(row => `译文:${row}`).join("\r"),
		testName: `official-oversized-query-${count}`,
		body: `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body>${paragraphs}</body></timedtext>`,
	});
	assert.ok(encodeURIComponent(new URL(oversizedOfficial.translateRequestURLs[0]).searchParams.get("q")).length <= 2400, "the oversized first official batch must be split before sending the translation request");
	assert.ok(oversizedOfficial.translateRequestURLs.every(url => encodeURIComponent(new URL(url).searchParams.get("q")).length <= 6000), "no multi-row official query should remain above the oversize guard threshold");
	assert.equal(new URL(oversizedOfficial.translateRequestURLs.at(-1)).searchParams.get("q").split(/\r/).length, count % 120, "the original short remainder batch must remain unchanged");
	const output = XML.parse(oversizedOfficial.output.body).timedtext.body.p;
	assert.equal(output.length, count);
	output.forEach((paragraph, index) => {
		assert.equal(paragraph["@t"], String(index * 3000));
		assert.equal(paragraph["@d"], "2000");
		assert.equal(paragraph["@wp"], "2");
		assert.match(paragraph["#"], new RegExp(`译文:공식 자막 문장 ${index + 1}\\.`));
	});
}

const borderlineOfficial = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=official-short-query&lang=en&format=srv3&subtype=Translate",
	translation: rows => rows.map(() => "短批次译文").join("\r"),
	testName: "official-short-query-preserves-120-row-batch",
	body: `<timedtext format="3"><body>${Array.from({ length: 120 }, (_, index) => `<p t="${index * 3000}" d="2000">${"a".repeat(45)}.</p>`).join("")}</body></timedtext>`,
});
assert.equal(borderlineOfficial.translateRequestURLs.length, 1, "ordinary official batches below the oversize threshold must retain the original scheduling");
assert.equal(XML.parse(borderlineOfficial.output.body).timedtext.body.p.length, 120);

const oversizedBroadcast = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=broadcast-long-query&lang=ko&name=CC1&format=srv3&subtype=Translate",
	translation: rows => rows.map(() => "广播译文").join("\r"),
	testName: "official-query-guard-does-not-change-broadcast",
	body: `<timedtext format="3"><body>${Array.from({ length: 205 }, (_, index) => `<p t="${index * 3000}" d="2000">공식 자막 문장 ${index + 1}.</p>`).join("")}</body></timedtext>`,
});
assert.equal(oversizedBroadcast.translateRequestURLs.length, 2, "broadcast batches must not enter the new ordinary-official guard");
assert.equal(new URL(oversizedBroadcast.translateRequestURLs[0]).searchParams.get("q").split(/\r/).length, 120);

let droppedOfficialRow = false;
const hugeOfficialMismatch = await runBundle({
	url: "https://www.youtube.com/api/timedtext?v=movie&lang=en&format=srv3&subtype=Translate",
	translation: rows => {
		const translated = rows.map((_, index) => `超长官方字幕翻译${index + 1}`);
		if (!droppedOfficialRow && rows.length > 1) {
			droppedOfficialRow = true;
			translated.pop();
		}
		return translated.join("\r");
	},
	testName: "official-long-movie-single-batch-mismatch",
	body: hugeOfficialSrv3,
	concurrentRequestLimit: 50,
	responseDelay: 2,
});
assert.equal(
	(hugeOfficialMismatch.output.body.match(/&#x000A;超长官方字幕翻译/gu) ?? []).length,
	5578,
	"a single malformed long-movie batch should be recovered locally without retrying every subtitle row",
);
assert.ok(
	hugeOfficialMismatch.maximumActiveRequests <= 6,
	`long official captions must use bounded concurrency, received ${hugeOfficialMismatch.maximumActiveRequests}`,
);

console.log(JSON.stringify({
	standaloneBundle: "passed",
	googleAutoToZhHans: "passed",
	autoGeneratedFixedTwoLines: "passed",
	autoGeneratedLongCueSplit: "passed",
	autoGeneratedNonOverlappingTiming: "passed",
	officialCaptionsUnchanged: "passed",
	simplifiedAndTraditionalChinesePassThrough: "passed",
	officialShortSentenceFragmentsGrouped: "passed",
	broadcastCCFamilyFixedTwoLines: "passed",
	broadcastOverlapsShortenedOnlyWhenProven: "passed",
	broadcastStandardNameFamiliesDetected: "passed",
	unknownBroadcastNameDetectedByStructure: "passed",
	longBroadcastCaptionsUseBoundedConcurrency: "passed",
	ipadLargeASRSmallBatching: "passed",
	automaticMultilineRowsPreserved: "passed",
	ipadMergedBatchMismatchRecoveredLocally: "passed",
	hugeAutomaticCaptionsUseBoundedConcurrency: "passed",
	officialV16BatchingPreserved: "passed",
	officialOversizedQueriesSplitWithTimingAndOrderPreserved: "passed",
	officialShortQueriesKeepOriginalBatching: "passed",
	broadcastOversizedQueriesUnchanged: "passed",
	hugeOfficialMismatchRecoveredLocally: "passed",
}, null, 2));
