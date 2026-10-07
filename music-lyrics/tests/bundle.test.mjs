// End-to-end: run the built Surge bundles in a sandbox that mimics Surge.
// node music-lyrics/tests/bundle.test.mjs   (after `npm run build:music`)
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { gzipSync } from "fflate";
import { rewriteProtobufLyrics } from "../src/lyrics.mjs";

const root = new URL("../../", import.meta.url);
const requestSource = fs.readFileSync(new URL("YouTubeMusic.Lyrics.request.bundle.js", root), "utf8");
const responseSource = fs.readFileSync(new URL("YouTubeMusic.Lyrics.response.bundle.js", root), "utf8");
const fixture = name => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function run(source, globals) {
	return new Promise((resolve, reject) => {
		const logs = [];
		const timer = setTimeout(() => reject(new Error("script did not call $done")), 5000);
		const context = vm.createContext({});
		Object.assign(context, {
			...globals,
			console: { log: (...a) => logs.push(a.join(" ")) },
			setTimeout: globals.setTimeout ?? setTimeout,
			clearTimeout: globals.clearTimeout ?? clearTimeout,
			Promise, Uint8Array, Map, Set, JSON, Math, Number, String, Array, Object, RegExp, Error,
			$done: value => {
				clearTimeout(timer);
				const plain = { ...value };
				if (value?.headers) plain.headers = { ...value.headers };
				resolve({ value: plain, logs });
			},
		});
		vm.runInContext(source, context);
	});
}

// Fake Google Translate gtx endpoint
let googleCalls = 0;
const $httpClient = {
	get(options, callback) {
		googleCalls += 1;
		const q = decodeURIComponent(new URL(options.url).searchParams.get("q"));
		const translated = q.split("\n").map(line => `译 ${line}`).join("\n");
		setTimeout(() => callback(null, { status: 200, headers: {} }, JSON.stringify([[[translated, q]], null, "en"])), 5);
	},
};

const lyricsRequestBody = Uint8Array.from([0x0a, 0x02, 0x08, 0x01, 0x12, 0x13, ...Buffer.from("MPLYt_ABCDEFGHIJK-1")]);
const homeRequestBody = Uint8Array.from([0x0a, 0x02, 0x08, 0x01, 0x12, 0x0b, ...Buffer.from("FEmusic_home")]);
const url = "https://youtubei.googleapis.com/youtubei/v1/browse?key=abc";

// request: lyrics -> tagged + :443, body untouched (not returned)
{
	const { value } = await run(requestSource, { $request: { url, headers: {}, body: lyricsRequestBody }, $argument: "Position=原文在上&Evade=true" });
	assert.deepEqual(value, { url: "https://youtubei.googleapis.com:443/youtubei/v1/browse?key=abc&ytmLyrics=1" });
}
// request: gzip-compressed lyrics body is detected too
{
	const { value } = await run(requestSource, { $request: { url, headers: {}, body: gzipSync(lyricsRequestBody) }, $argument: "Evade=false" });
	assert.deepEqual(value, { url: `${url}&ytmLyrics=1` });
}
// request: home feed -> nothing changed
assert.deepEqual((await run(requestSource, { $request: { url, headers: {}, body: homeRequestBody }, $argument: "" })).value, {});

// response: English timed lyrics
{
	const body = fixture("timed_en.pb");
	const { value, logs } = await run(responseSource, { $response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body }, $request: { url }, $httpClient, $argument: "Position=原文在上" });
	assert.equal(value.headers["X-YTM-Lyrics"], "translated");
	const lines = [];
	rewriteProtobufLyrics(value.body, (k, t) => void lines.push(t));
	assert.equal(lines[0], "Walking down the river in the morning light\n译 Walking down the river in the morning light");
	assert.equal(googleCalls, 1, "7 unique lines in one request");
	assert.ok(logs.some(l => l.includes("translated, lines=74")), logs.join("\n"));
}
// response: Chinese song -> body not returned (unchanged), header says why
{
	const { value } = await run(responseSource, { $response: { status: 200, headers: {}, body: fixture("timed_zh.pb") }, $request: { url }, $httpClient, $argument: "" });
	assert.equal(value.body, undefined);
	assert.equal(value.headers["X-YTM-Lyrics"], "chinese-skip");
}
// response: Google down -> original lyrics, never broken
{
	const broken = { get: (o, cb) => setTimeout(() => cb(new Error("offline")), 1) };
	const { value } = await run(responseSource, { $response: { status: 200, headers: {}, body: fixture("timed_en.pb") }, $request: { url }, $httpClient: broken, $argument: "" });
	assert.ok(value.body === undefined || value.headers["X-YTM-Lyrics"] === "translated");
}
// A stalled translation must still finish before Surge's 30-second limit.
{
	const stalled = { get() {} };
	const fastClock = (callback, delay, ...args) => setTimeout(callback, delay >= 25000 ? 10 : delay, ...args);
	const { value } = await run(responseSource, {
		$response: { status: 200, headers: {}, body: fixture("timed_en.pb") },
		$httpClient: stalled, $argument: "", setTimeout: fastClock,
	});
	assert.deepEqual(value, {}, "a stalled translator returns the original response");
}
console.log("music-lyrics bundle tests: passed");
