import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const repository = "Hey-sayiwanna/YouTube-Bilingual-Subtitles-Surge";
const moduleSource = await readFile("YouTube.Bilingual.sgmodule", "utf8");
const runtimeBundles = [
	"request.youtube-standalone-v16.bundle.js",
	"response.youtube-standalone-v16.bundle.js",
	"Translate.response.youtube-fix-v16.bundle.js",
];

assert.match(moduleSource, /#!name=YouTube 自动简中双语字幕 v16/);
assert.match(moduleSource, /#!version=16\.0/);
assert.doesNotMatch(moduleSource, /github\.com\/DualSubs|raw\.githubusercontent\.com\/DualSubs/);
assert.doesNotMatch(moduleSource, /Hey-sayiwanna\/Universal/);
assert.doesNotMatch(moduleSource, /Composite\.response/);
assert.match(moduleSource, new RegExp(`${repository}/main/request\\.youtube-standalone-v16\\.bundle\\.js`));
assert.match(moduleSource, new RegExp(`${repository}/main/response\\.youtube-standalone-v16\\.bundle\\.js`));
assert.match(moduleSource, new RegExp(`${repository}/main/Translate\\.response\\.youtube-fix-v16\\.bundle\\.js`));
assert.match(moduleSource, new RegExp(`${repository}/main/force_translate_request\\.js`));

for (const path of runtimeBundles) {
	const source = await readFile(path, "utf8");
	assert.doesNotMatch(source, /@DualSubs|"DualSubs"/);
	assert.doesNotMatch(source, /github\.com\/DualSubs|raw\.githubusercontent\.com\/DualSubs/);
}

const translateBundle = await readFile("Translate.response.youtube-fix-v16.bundle.js", "utf8");
assert.match(translateBundle, /Hey-sayiwanna YouTube Translate FIX 16 active/);
assert.match(translateBundle, /YouTube standalone settings active; BoxJs bypassed/);
assert.match(translateBundle, /YouTube ASR fixed two-line mode/);
assert.match(translateBundle, /YouTube ASR long-cue split/);
assert.doesNotMatch(translateBundle, /getStorage|@DualSubs/);

console.log("PASS: stable module path and all YouTube v16 runtime files are independently hosted");
