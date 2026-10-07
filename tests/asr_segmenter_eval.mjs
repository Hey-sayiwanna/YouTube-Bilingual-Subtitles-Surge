/**
 * Evaluates the ASR segmenter against the creator-made (manual) subtitles of
 * the same video.
 *
 *   node tests/asr_segmenter_eval.mjs            # summary
 *   node tests/asr_segmenter_eval.mjs --show     # print every cue
 *   node tests/asr_segmenter_eval.mjs --bad      # print only bad boundaries
 *
 * Metrics
 *   natural-boundary precision : share of our cue boundaries that fall where
 *                                the manual subtitle has a cue break or any
 *                                punctuation mark (. , ! ? ; :).
 *   sentence-end recall        : share of manual sentence ends (. ! ?) where
 *                                we also end a cue.
 *   plus length / overlap / orphan checks.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XML from "../src/XML/XML.mjs";
import { resegmentYouTubeASR, normalizeASRToken } from "../src/function/asrSegmenter.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "fixtures");
const args = new Set(process.argv.slice(2));

const readTSV = file =>
	fs.readFileSync(path.join(fixtures, file), "utf8").trim().split("\n").map(line => {
		const [t, d, ...rest] = line.split("\t");
		return { start: Number(t), dur: Number(d), text: rest.join("\t") };
	});

const asrLines = readTSV("asr_v36_output.tsv");
const reference = readTSV("reference_manual.tsv");
const REFERENCE_END = reference.at(-1).start + reference.at(-1).dur + 500;

/* ---------------- synthetic raw ASR srv3 builders ---------------- */
const escape = text => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const HEAD = `<head><ws id="0"/><ws id="1" mh="2" ju="0" sd="3"/><wp id="0"/><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head>`;

function wordStream(lines) {
	const words = [];
	lines.forEach((line, index) => {
		const next = lines[index + 1];
		const end = Math.min(line.start + line.dur, next ? next.start : Infinity);
		if (/^\[.*\]$/.test(line.text)) {
			words.push({ text: line.text, start: line.start, end, event: true });
			return;
		}
		const tokens = line.text.split(/\s+/).filter(Boolean);
		const weights = tokens.map(token => token.length + 2);
		const total = weights.reduce((a, b) => a + b, 0);
		let used = 0;
		tokens.forEach((token, i) => {
			const s = Math.round(line.start + ((end - line.start) * used) / total);
			used += weights[i];
			const e = Math.round(line.start + ((end - line.start) * used) / total);
			words.push({ text: token, start: s, end: e, event: false });
		});
	});
	return words;
}

/** Re-wrap the word stream into ~cc=40 ASR lines the way YouTube does. */
function wrapLines(words, maxChars = 40) {
	const lines = [];
	let current = [];
	const flush = () => {
		if (current.length) lines.push(current);
		current = [];
	};
	for (const word of words) {
		if (word.event) {
			flush();
			lines.push([word]);
			continue;
		}
		const chars = current.map(w => w.text).join(" ").length;
		const gap = current.length ? word.start - current.at(-1).end : 0;
		if (current.length && (chars + 1 + word.text.length > maxChars || gap > 1500)) flush();
		current.push(word);
	}
	flush();
	return lines;
}

function buildParagraphTimedXML(words) {
	// iOS app style: an empty <p> + a <p> with one <s> per line (no word offsets)
	const lines = wrapLines(words);
	const body = lines.map((line, i) => {
		const start = line[0].start;
		const next = lines[i + 1];
		const end = next ? next[0].start : line.at(-1).end;
		const text = line.map(w => w.text).join(" ");
		return `<p t="${start - 10}" d="${end - start + 10}"></p><p t="${start}" d="${Math.max(1, end - start)}"><s>${escape(text)}</s></p>`;
	});
	return `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">${HEAD}<body>${body.join("")}</body></timedtext>`;
}

function buildExactTimedXML(words) {
	// Web / Android style: rolling window + <s t="offset"> word timing
	const lines = wrapLines(words);
	const body = lines.map((line, i) => {
		const start = line[0].start;
		const afterNext = lines[i + 2]?.[0]?.start ?? line.at(-1).end + 2000;
		if (line[0].event) return `<p t="${start}" d="${line[0].end - start}" w="1"><s ac="0">${escape(line[0].text)}</s></p>`;
		const segments = line.map((w, j) => (j === 0 ? `<s ac="0">${escape(w.text)}</s>` : `<s t="${w.start - start}" ac="0"> ${escape(w.text)}</s>`)).join("");
		const nextStart = lines[i + 1]?.[0]?.start;
		const append = nextStart ? `<p t="${nextStart - 10}" d="${afterNext - nextStart + 10}" w="1" a="1">\n</p>` : "";
		return `<p t="${start}" d="${afterNext - start}" w="1">${segments}</p>${append}`;
	});
	return `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">${HEAD}<body><w t="0" id="1" wp="1" ws="1"/>${body.join("")}</body></timedtext>`;
}

function buildLineXML(lines) {
	const body = lines.map(line => `<p t="${line.start}" d="${line.dur}"><s>${escape(line.text)}</s></p>`);
	return `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3">${HEAD}<body>${body.join("")}</body></timedtext>`;
}

/* ---------------- alignment + metrics ---------------- */
const norm = token => {
	const n = normalizeASRToken(token);
	return n;
};
const tokensOf = text => text.replace(/(\S)\.(\S)/g, "$1. $2").split(/\s+/).filter(t => norm(t));

// reference tokens with "break after" type: 0 none, 1 comma/cue break, 2 sentence end
const referenceTokens = [];
for (const cue of reference) {
	const tokens = tokensOf(cue.text);
	tokens.forEach((token, i) => {
		let kind = 0;
		if (/[.!?]["')]*$/.test(token) && !/^[ap]\.?m\.?$/i.test(token)) kind = 2;
		else if (/[,;:)]$/.test(token) || i === tokens.length - 1) kind = 1;
		referenceTokens.push({ n: norm(token), kind, raw: token });
	});
}
// "AM." / "Breakfast." etc. keep sentence ends; "Arian," in "It's 7:40 AM and" fine.

function similar(a, b) {
	if (a === b) return true;
	if (a.length >= 4 && b.length >= 4 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4)))) return true;
	return false;
}

function align(ours, theirs) {
	// LCS over normalised tokens with fuzzy equality
	const n = ours.length, m = theirs.length;
	const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			dp[i][j] = similar(ours[i], theirs[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const map = new Array(n).fill(-1);
	let i = 0, j = 0;
	while (i < n && j < m) {
		if (similar(ours[i], theirs[j])) { map[i] = j; i++; j++; }
		else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
		else j++;
	}
	return map;
}

function evaluate(name, cues) {
	const speech = cues.filter(c => !c.event && c.start < REFERENCE_END);
	const ourTokens = [];
	const ourBreakAfter = [];
	speech.forEach(cue => {
		const tokens = tokensOf(cue.text);
		tokens.forEach((t, i) => {
			ourTokens.push(norm(t));
			ourBreakAfter.push(i === tokens.length - 1);
		});
	});
	const map = align(ourTokens, referenceTokens.map(t => t.n));
	// boundary natural if the aligned reference token (or the next unaligned
	// reference token before the next aligned one) has kind>0
	let good = 0, total = 0, acceptable = 0;
	const bad = [];
	for (let i = 0; i < ourTokens.length - 1; i++) {
		if (!ourBreakAfter[i]) continue;
		if (map[i] < 0 && map[i + 1] < 0) continue; // cannot judge
		total++;
		let j = map[i] >= 0 ? map[i] : map[i + 1] - 1;
		const nextJ = map[i + 1] >= 0 ? map[i + 1] : j + 1;
		let ok = false;
		for (let k = j; k < Math.max(nextJ, j + 1); k++) if (referenceTokens[k]?.kind > 0) ok = true;
		const clause = /^(?:and|but|or|so|because|which|who|that|when|while|until|otherwise|if|where|before|after|since|though|although|then|despite|like)$/.test(ourTokens[i + 1]);
		if (ok) good++;
		else if (clause) acceptable++;
		else bad.push(`${ourTokens.slice(Math.max(0, i - 5), i + 1).join(" ")} | ${ourTokens.slice(i + 1, i + 5).join(" ")}`);
	}
	// sentence-end recall
	const inverse = new Map();
	map.forEach((j, i) => j >= 0 && inverse.set(j, i));
	let sentenceEnds = 0, hit = 0;
	const missed = [];
	referenceTokens.forEach((token, j) => {
		if (token.kind !== 2 || !inverse.has(j)) return;
		if (j + 1 >= referenceTokens.length) return;
		sentenceEnds++;
		const i = inverse.get(j);
		if (ourBreakAfter[i] || (i + 1 < ourTokens.length && false)) hit++;
		else missed.push(referenceTokens.slice(Math.max(0, j - 4), j + 4).map(t => t.raw).join(" "));
	});
	const lengths = speech.map(c => c.text.length);
	const overlaps = cues.filter((c, i) => cues[i + 1] && c.end > cues[i + 1].start).length;
	const tooLong = lengths.filter(l => l > 90).length;
	const singles = speech.filter(c => tokensOf(c.text).length === 1).length;
	const result = {
		name,
		cues: speech.length,
		natural: +(good / total).toFixed(3),
		clauseOK: +(acceptable / total).toFixed(3),
		BAD: +(1 - (good + acceptable) / total).toFixed(3),
		sentenceRecall: +(hit / sentenceEnds).toFixed(3),
		avgChars: +(lengths.reduce((a, b) => a + b, 0) / lengths.length).toFixed(1),
		maxChars: Math.max(...lengths),
		over90: tooLong,
		singleWordCues: singles,
		overlaps,
	};
	return { result, bad, missed };
}

/* ---------------- run ---------------- */
const words = wordStream(asrLines);
const variants = {
	"ios-paragraph-timed": buildParagraphTimedXML(words),
	"web-exact-word-timing": buildExactTimedXML(words),
	"v36-lines-as-input": buildLineXML(asrLines),
};

// baseline: current v36 output as it is (each line = one cue)
const baselineCues = asrLines.map(l => ({ text: l.text, start: l.start, end: l.start + l.dur, event: /^\[.*\]$/.test(l.text) }));
const summary = [evaluate("BASELINE current v36 output", baselineCues).result];
let showCues;
const report = {};
for (const [name, xml] of Object.entries(variants)) {
	const body = XML.parse(xml);
	const stats = resegmentYouTubeASR(body);
	const ps = Array.isArray(body.timedtext.body.p) ? body.timedtext.body.p : [body.timedtext.body.p];
	const cues = ps.map(p => ({ text: p.s["#"], start: Number(p["@t"]), end: Number(p["@t"]) + Number(p["@d"]), event: /^\[.*\]$/.test(p.s["#"]) }));
	const evaluation = evaluate(`${name} (${stats.reason})`, cues);
	summary.push(evaluation.result);
	report[name] = { cues, evaluation, xml: XML.stringify(body) };
	if (!showCues) showCues = cues;
}
console.table(summary);

if (args.has("--bad")) {
	for (const [name, { evaluation }] of Object.entries(report)) {
		console.log(`\n### ${name} unnatural boundaries (${evaluation.bad.length})`);
		evaluation.bad.forEach(b => console.log("  ", b));
		console.log(`### ${name} missed sentence ends (${evaluation.missed.length})`);
		evaluation.missed.forEach(b => console.log("  ", b));
	}
}
if (args.has("--show")) {
	const which = [...args].find(a => a.startsWith("--variant="))?.split("=")[1] ?? "ios-paragraph-timed";
	for (const cue of report[which].cues) console.log(`${(cue.start / 1000).toFixed(2).padStart(8)} → ${(cue.end / 1000).toFixed(2).padStart(8)}  ${cue.text}`);
}
export { summary, report };
