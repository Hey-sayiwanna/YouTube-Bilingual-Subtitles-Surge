// v41: inline sound tags in punctuated YouTube ASR ("even [music] the simplest...").
// Runs the real built bundle (routed like Surge) with a fake Google translator.
import assert from "node:assert/strict";
import fs from "node:fs";
import XML from "../src/XML/XML.mjs";
import { stripSoundTags } from "../src/function/asrSoundTags.mjs";

// unit
const s = text => stripSoundTags(text).text;
assert.equal(s("even [music] the simplest daily task becomes much more difficult in winter."), "even the simplest daily task becomes much more difficult in winter.");
assert.equal(s("the cow shed, [music], especially at night."), "the cow shed, especially at night.");
assert.equal(s(">> Andrean is [music] a very talented artist."), "Andrean is a very talented artist.");
assert.equal(s(">> [Music] >>."), "");
assert.equal(s("[Applause] thank you"), "thank you");
assert.equal(s("[音楽] 今日は"), "今日は");
assert.equal(s("they make it (laughs) okay"), "they make it okay");
assert.equal(s("no tags here, (Sakha language class) ok"), "no tags here, (Sakha language class) ok", "ordinary parentheses are kept");

const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const rows = fs.readFileSync(new URL("./fixtures/asr_inline_music.tsv", import.meta.url), "utf8").trim().split("\n").map(line => line.split("\t"));
const body = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${rows.map(([t, d, x]) => `<p t="${t}" d="${d}"><s>${escape(x)}</s></p>`).join("")}</body></timedtext>`;
const rawWeb = `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><body><w t="0" id="1" wp="1" ws="1"/>${rows.map(([t, d, x]) => {
	const words = x.split(" ");
	const step = Math.max(1, Math.floor(Number(d) / words.length));
	return `<p t="${t}" d="${d}" w="1">${words.map((w, i) => (i ? `<s t="${i * step}" ac="0"> ${escape(w)}</s>` : `<s ac="0">${escape(w)}</s>`)).join("")}</p>`;
}).join("")}</body></timedtext>`;

async function runBundle(xml, lang = "en") {
	const sent = [];
	const url = `https://www.youtube.com/api/timedtext?v=x&kind=asr&lang=${lang}&tlang=zh-Hans&subtype=Translate`;
	globalThis.$environment = { "surge-version": "5.0" };
	globalThis.$script = { startTime: Date.now() / 1000 };
	globalThis.$argument = "";
	globalThis.$request = { method: "GET", url, headers: {} };
	globalThis.$response = { status: 200, headers: { "Content-Type": "text/xml" }, body: xml };
	globalThis.$httpClient = {
		get(request, callback) {
			const q = new URL(request.url).searchParams.get("q") ?? "";
			const lines = q.split(/\r/);
			sent.push(...lines);
			callback(null, { status: 200, headers: {} }, JSON.stringify([[[lines.map(line => `译:${line}`).join("\r"), q]]]));
		},
		post(request, callback) { this.get(request, callback); },
	};
	const done = new Promise(resolve => { globalThis.$done = resolve; });
	const log = console.log; const info = console.info; const warn = console.warn;
	console.log = console.info = console.warn = () => {};
	await import(`../Translate.response.youtube-fix-v41-en.bundle.js?${Math.random()}`);
	const output = await done;
	console.log = log; console.info = info; console.warn = warn;
	return { output, sent };
}

for (const [name, xml] of [["ios-punctuated", body], ["web-word-timing", rawWeb]]) {
	const { output, sent } = await runBundle(xml);
	assert.equal(output.headers["X-Hey-Sayiwanna-YouTube-Fix"], "41");
	const cues = [].concat(XML.parse(output.body).timedtext.body.p).map(p => (p.s?.["#"] ?? p["#"] ?? "").split("\n"));
	assert.ok(sent.length > 50, `${name}: translation requests sent`);
	assert.ok(!sent.some(line => /\[|\]|>>|♪/u.test(line)), `${name}: no tag ever sent to Google: ${sent.filter(l => /\[|>>/.test(l)).slice(0, 3)}`);
	for (const [origin, translation] of cues) {
		if (/^\[[A-Za-z ]+\]$/.test(origin)) {
			assert.ok(["[Music]"].includes(origin), `${name}: event cue ${origin}`);
			assert.equal(translation, "[音乐]", `${name}: fixed Chinese for event cue`);
			continue;
		}
		assert.ok(!/\[|\]|>>/.test(origin), `${name}: tag left in original: ${origin}`);
		assert.ok(!/\[|\]/.test(translation ?? ""), `${name}: tag left in translation: ${translation}`);
	}
	if (process.argv.includes("--show")) cues.slice(0, 40).forEach(([o, t]) => console.log(o, " || ", t));
	assert.ok(cues.some(([o]) => /even the simplest daily task becomes much more difficult in winter\./i.test(o)), `${name}: sentence kept intact`);
	assert.ok(cues.some(([o]) => /^They raise cows, horses, and chickens\.$/.test(o) || /They raise cows, horses, and chickens\./.test(o)));
	assert.ok(!sent.some(line => /^\s*$/.test(line)), `${name}: no empty lines sent`);
	console.log(`${name}: cues=${cues.length}, eventCues=${cues.filter(([o]) => o === "[Music]").length}, sentLines=${sent.length}`);
}
console.log("asr sound tags regression: passed");
