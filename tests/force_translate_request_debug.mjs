import assert from "node:assert/strict";

async function run(url) {
	globalThis.$request = { url, headers: { "User-Agent": "YouTube" } };
	let output;
	globalThis.$done = value => {
		output = value;
	};
	await import(`../force_translate_request.js?test=${Date.now()}-${Math.random()}`);
	return output;
}

const translated = await run("https://www.youtube.com/api/timedtext?v=test&lang=en&kind=asr&format=srv3");
const translatedURL = new URL(translated.url);
assert.equal(translatedURL.searchParams.get("subtype"), "Translate");
assert.equal(translatedURL.searchParams.get("lang"), "en");
assert.equal(translatedURL.searchParams.get("kind"), "asr");
assert.equal(translatedURL.searchParams.get("format"), "srv3");

const preserved = await run("https://www.youtube.com/api/timedtext?v=test&lang=ko&subtype=Official");
assert.equal(new URL(preserved.url).searchParams.get("subtype"), "Official");

console.log("PASS: TimedText request adds Translate without changing existing subtitle parameters");
