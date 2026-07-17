import assert from "node:assert/strict";

const capturedSrv3 = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body><p t="22160" d="5960" w="1"><s>Make</s><s t="720"> way,</s><s t="1640"> the</s><s t="1880"> beast</s><s t="2720"> has</s><s t="3080"> returned.</s></p></body></timedtext>`;
let translateRequestURL = "";

globalThis.$environment = { "surge-version": "5.0" };
globalThis.$script = { startTime: Date.now() / 1000 };
globalThis.$request = {
	method: "GET",
	url: "https://www.youtube.com/api/timedtext?v=test&lang=en&format=srv3&subtype=Translate",
	headers: {},
};
globalThis.$response = {
	status: 200,
	headers: { "Content-Type": "text/xml; charset=utf-8" },
	body: capturedSrv3,
};
globalThis.$httpClient = {
	get(request, callback) {
		translateRequestURL = request.url;
		callback(null, { status: 200, headers: {} }, JSON.stringify([[['让开，野兽回来了。', "Make way, the beast has returned.", null, null]], null, "en"]));
	},
};

let finish;
const completed = new Promise(resolve => {
	finish = resolve;
});
globalThis.$done = value => finish(value);

await import(`../Translate.response.youtube-fix-v14.bundle.js?test=${Date.now()}`);
let timeout;
const output = await Promise.race([
	completed,
	new Promise((_, reject) => {
		timeout = setTimeout(() => reject(new Error("bundle test timed out")), 5000);
	}),
]);
clearTimeout(timeout);

assert.match(translateRequestURL, /translate\.googleapis\.com/);
assert.match(translateRequestURL, /[?&]sl=auto(?:&|$)/);
assert.match(translateRequestURL, /[?&]tl=zh-CN(?:&|$)/);
assert.equal(output.headers["X-Hey-Sayiwanna-YouTube-Fix"], "14");
assert.equal(output.headers["X-Hey-Sayiwanna-Settings"], "standalone-no-boxjs");
assert.match(output.body, /rc="2"/);
assert.match(output.body, /<s>Make way, the beast has returned\.&#x000A;让开，野兽回来了。<\/s>/);
assert.equal((output.body.match(/<s>/g) ?? []).length, 1);
assert.doesNotMatch(output.body, /Make  way/);

console.log(JSON.stringify({
	standaloneBundle: "passed",
	boxJsBypassHeader: "passed",
	googleAutoToZhHans: "passed",
	capturedSrv3WriteBack: "passed",
}, null, 2));
