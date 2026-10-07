/**
 * v39 generic standard (languages without a model) vs the old v36 path.
 * We cannot ship test data for every language, so held-out English / Japanese /
 * Korean text is fed in *as if it were an unknown language* (no model used).
 * Speech timing is simulated: pauses after ~60% of sentence ends, ~35% of
 * commas and ~4% of other words (hesitations).
 *   node tests/asr_generic_eval.mjs
 */
import fs from "node:fs";
import XML from "../src/XML/XML.mjs";
import { resegmentYouTubeASR } from "../src/function/asrCore.mjs";
import { resegmentYouTubeASRByParagraphTiming, resegmentYouTubeASRBySegmentTiming, rebalanceYouTubeASRSentenceBoundaries, splitYouTubeASRLongParagraphs, readYouTubeTimedTextParagraph } from "../src/function/youtubeTimedText.mjs";

const keep = c => /[\p{L}\p{N}']/u.test(c);
function loadUnits(lang) {
	const units = [];
	if (lang === "en") {
		for (const row of fs.readFileSync(new URL("./fixtures/heldout_en_ted.tsv", import.meta.url), "utf8").split("\n")) {
			const [w, l] = row.split("\t");
			if (!w) continue;
			const label = l === "PERIOD" || l === "QUESTION" ? 2 : l === "COMMA" ? 1 : 0;
			if (units.length && (w.startsWith("'") || w === "n't")) { units.at(-1).text += w; units.at(-1).label = label; continue; }
			if (!/[a-z0-9]/i.test(w)) { if (units.length) units.at(-1).label = Math.max(units.at(-1).label, label); continue; }
			units.push({ text: w, label });
		}
		return { units, joiner: " " };
	}
	const rows = fs.readFileSync(new URL(`./fixtures/heldout_${lang}.txt`, import.meta.url), "utf8").split("\n").filter(Boolean).slice(0, 900);
	for (const row of rows) {
		for (const piece of row.normalize("NFKC").split(/\s+/)) { // ja: phrases between spaces are rare -> whole clauses
			const text = Array.from(piece).filter(keep).join("");
			const label = /[。.!?！？]/u.test(piece) ? 2 : /[、,，]/u.test(piece) ? 1 : 0;
			if (!text) { if (units.length) units.at(-1).label = Math.max(units.at(-1).label, label); continue; }
			units.push({ text, label });
		}
		if (units.length) units.at(-1).label = 2;
	}
	return { units, joiner: " " };
}

function simulate(units) {
	let seed = 11;
	const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
	let t = 0;
	for (const unit of units) {
		unit.start = t;
		t += 120 + 60 * Array.from(unit.text).length;
		unit.end = t;
		if (unit.label === 2 && random() < 0.6) t += 300 + random() * 700;
		else if (unit.label === 1 && random() < 0.35) t += 200 + random() * 400;
		else if (unit.label === 0 && random() < 0.04) t += 250 + random() * 400;
	}
}

function lines(units) {
	const out = [];
	let line = [], width = 0;
	for (const unit of units) {
		const w = Array.from(unit.text).length + 1;
		if (line.length && (width + w > 40 || unit.start - line.at(-1).end > 900)) { out.push(line); line = []; width = 0; }
		line.push(unit); width += w;
	}
	if (line.length) out.push(line);
	return out;
}
const esc = s => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
function iosXML(units) {
	const ls = lines(units);
	return `<timedtext format="3"><body>${ls.map((l, i) => { const s = l[0].start, e = ls[i + 1]?.[0].start ?? l.at(-1).end; return `<p t="${s - 10}" d="${e - s + 10}"></p><p t="${s}" d="${e - s}"><s>${esc(l.map(u => u.text).join(" "))}</s></p>`; }).join("")}</body></timedtext>`;
}
function webXML(units) {
	const ls = lines(units);
	return `<timedtext format="3"><body><w t="0" id="1" wp="1" ws="1"/>${ls.map((l, i) => { const s = l[0].start, e = ls[i + 2]?.[0].start ?? l.at(-1).end + 2000; return `<p t="${s}" d="${e - s}" w="1">${l.map((u, k) => k ? `<s t="${u.start - s}"> ${esc(u.text)}</s>` : `<s>${esc(u.text)}</s>`).join("")}</p>`; }).join("")}</body></timedtext>`;
}

function score(units, body) {
	const texts = [].concat(body.timedtext.body.p ?? []).map(p => readYouTubeTimedTextParagraph(p).text).filter(t => t && t !== "\u200b");
	const flat = [];
	units.forEach((u, i) => Array.from(u.text).filter(keep).forEach((_, k, a) => flat.push({ i, last: k === a.length - 1 })));
	let offset = 0, nat = 0, bad = 0, hits = 0;
	const widths = [];
	for (const text of texts) {
		offset += Array.from(text).filter(keep).length;
		widths.push(Array.from(text).reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0));
		const pos = flat[offset - 1];
		if (!pos || offset >= flat.length) continue;
		if (pos.last && units[pos.i].label > 0) { nat++; if (units[pos.i].label === 2) hits++; } else bad++;
	}
	const periods = units.filter((u, i) => u.label === 2 && i < units.length - 1).length;
	const ps = [].concat(body.timedtext.body.p ?? []);
	const overlaps = ps.filter((p, i) => ps[i + 1] && Number(p["@t"]) + Number(p["@d"] ?? 0) > Number(ps[i + 1]["@t"])).length;
	return { cues: texts.length, BAD: +(bad / (nat + bad)).toFixed(3), sentenceRecall: +(hits / periods).toFixed(3), avgWidth: +(widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(1), maxWidth: Math.max(...widths), overlaps };
}

const rows = [];
for (const lang of ["en", "ko"]) {
	const { units } = loadUnits(lang);
	simulate(units);
	for (const [format, build] of [["ios", iosXML], ["web", webXML]]) {
		const xml = build(units);
		const old = XML.parse(xml);
		const r1 = resegmentYouTubeASRByParagraphTiming(old);
		if (!r1.applied) { const r2 = resegmentYouTubeASRBySegmentTiming(old); if (!r2.applied) { rebalanceYouTubeASRSentenceBoundaries(old, 450); splitYouTubeASRLongParagraphs(old, 40); } }
		rows.push({ name: `v36 ${lang}-as-unknown ${format}`, ...score(units, old) });
		const now = XML.parse(xml);
		const stats = resegmentYouTubeASR(now, { profiles: {}, languageHint: "xx" });
		rows.push({ name: `v39 generic ${lang}-as-unknown ${format} (${stats.profile})`, ...score(units, now) });
	}
}
console.table(rows);
export { rows };
if (process.argv.includes("--debug")) {
	const { units } = loadUnits("en"); simulate(units);
	const body = XML.parse(iosXML(units));
	resegmentYouTubeASR(body, { profiles: {}, languageHint: "xx" });
	const a = units.map(u => Array.from(u.text).filter(keep).join("")).join("");
	const b = [].concat(body.timedtext.body.p).map(p => Array.from(readYouTubeTimedTextParagraph(p).text).filter(keep).join("")).join("");
	let i = 0; while (i < a.length && a[i] === b[i]) i++;
	console.log(a.length, b.length, i, JSON.stringify(a.slice(i - 30, i + 30)), JSON.stringify(b.slice(i - 30, i + 30)));
}
