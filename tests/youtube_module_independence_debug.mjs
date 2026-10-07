import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repository = "Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge";
const moduleSource = await readFile("YouTube.Bilingual.sgmodule", "utf8");
const runtimeBundles = [
	"request.youtube-standalone-v18.bundle.js",
	"response.youtube-standalone-v18.bundle.js",
	"Translate.response.youtube-fix-v39-en.bundle.js",
	"Translate.response.youtube-fix-v39-cjk.bundle.js",
	"Translate.response.youtube-fix-v39-other.bundle.js",
];

assert.match(moduleSource, /#!name=YouTube 自动简中双语字幕 v39/);
assert.match(moduleSource, /#!version=39\.0/);
assert.doesNotMatch(moduleSource, /github\.com\/DualSubs|raw\.githubusercontent\.com\/DualSubs/);
assert.doesNotMatch(moduleSource, /Hey-sayiwanna\/Universal/);
assert.doesNotMatch(moduleSource, /Composite\.response/);
assert.match(moduleSource, new RegExp(`${repository}/main/request\\.youtube-standalone-v18\\.bundle\\.js`));
assert.match(moduleSource, new RegExp(`${repository}/main/response\\.youtube-standalone-v18\\.bundle\\.js`));
for (const name of ["en", "cjk", "other"]) assert.ok(moduleSource.includes(`${repository}@main/Translate.response.youtube-fix-v39-${name}.bundle.js`), name);
assert.match(moduleSource, new RegExp(`${repository}/main/force_translate_request\\.js`));
assert.match(moduleSource, /DualSubs\.AutoZH\.Player\.response\.proto = type=http-response/);

for (const path of runtimeBundles) {
	const source = await readFile(path, "utf8");
	assert.doesNotMatch(source, /@DualSubs|"DualSubs"/);
	assert.doesNotMatch(source, /github\.com\/DualSubs|raw\.githubusercontent\.com\/DualSubs/);
}

for (const name of ["en", "cjk", "other"]) {
const translateBundle = await readFile(`Translate.response.youtube-fix-v39-${name}.bundle.js`, "utf8");
assert.match(translateBundle, /Hey-sayiwanna YouTube Translate FIX 39 active/);
assert.match(translateBundle, /YouTube standalone settings active; BoxJs bypassed/);
assert.match(translateBundle, /YouTube Chinese source detected; translation bypassed/);
assert.match(translateBundle, /YouTube ASR v39 segmentation/);
assert.match(translateBundle, /YouTube ASR fixed two-line mode/);
assert.match(translateBundle, /YouTube ASR translation batches/);
assert.match(translateBundle, /YouTube official translation batches/);
assert.match(translateBundle, /YouTube Row fallback scheduler/);
assert.match(translateBundle, /YouTube broadcast fixed two-line mode/);
assert.match(translateBundle, /YouTube broadcast overlap trim/);
assert.match(translateBundle, /YouTube broadcast translation batches/);
assert.doesNotMatch(translateBundle, /translation deadline fallback|translateBatchesWithinBudget/);
assert.doesNotMatch(translateBundle, /getStorage|@DualSubs/);
// each bundle only carries its own language models
const hasEnglishModel = translateBundle.includes("TED transcripts") || translateBundle.includes("p:the\t");
const hasCjkModel = translateBundle.includes("j:す|");
assert.equal(hasEnglishModel, name === "en", `${name}: English model presence`);
assert.equal(hasCjkModel, name === "cjk", `${name}: Japanese/Korean model presence`);
}

console.log("PASS: stable module path and all current YouTube runtime files are independently hosted");
