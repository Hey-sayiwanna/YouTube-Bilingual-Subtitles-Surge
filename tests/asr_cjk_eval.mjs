/**
 * Japanese / Korean ASR segmentation evaluation on held-out punctuated text
 * (never seen in training) turned into punctuation-free YouTube-style ASR.
 *   node tests/asr_cjk_eval.mjs            -> table v36 vs v38
 *   node tests/asr_cjk_eval.mjs --show ja  -> print v38 cues
 */
import fs from "node:fs";
import XML from "../src/XML/XML.mjs";
import { resegmentYouTubeASR } from "../src/function/asrSegmenter.mjs";
import { resegmentYouTubeASRByParagraphTiming, resegmentYouTubeASRBySegmentTiming, rebalanceYouTubeASRSentenceBoundaries, splitYouTubeASRLongParagraphs, readYouTubeTimedTextParagraph } from "../src/function/youtubeTimedText.mjs";

const args = process.argv.slice(2);
const PERIOD = /[。.!?！？…]/u, COMMA = /[、,，]/u;
const keep = c => /[\p{L}\p{N}]/u.test(c);

function makeCase(lang, pauses) {
	const rows = fs.readFileSync(new URL(`./fixtures/heldout_${lang}.txt`, import.meta.url), "utf8").split("\n").filter(Boolean);
	// units = what ASR would emit: ja characters, ko eojeol; with labels
	const units = [];
	let rnd = 7;
	const random = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
	for (const row of rows) {
		const pieces = lang === "ko" ? row.normalize("NFKC").split(/\s+/) : Array.from(row.normalize("NFKC"));
		for (const piece of pieces) {
			const text = Array.from(piece).filter(keep).join("");
			const label = PERIOD.test(piece) ? 2 : COMMA.test(piece) ? 1 : 0;
			if (!text) { if (units.length) units.at(-1).label = Math.max(units.at(-1).label, label); continue; }
			units.push({ text, label });
		}
		if (units.length) units.at(-1).label = 2;
	}
	let t = 0;
	for (const unit of units) {
		unit.start = t;
		t += lang === "ko" ? 150 + 105 * unit.text.length : 115 * unit.text.length;
		unit.end = t;
		if (pauses && unit.label === 2 && random() < 0.6) t += 350 + random() * 600;
		if (pauses && unit.label === 1 && random() < 0.4) t += 200 + random() * 300;
	}
	// iOS paragraph-timed lines of ~ cc=40 width (CJK = 2)
	const lines = [];
	let line = [], width = 0;
	for (const unit of units) {
		const w = Array.from(unit.text).reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0) + (lang === "ko" ? 1 : 0);
		if (line.length && (width + w > 40 || unit.start - line.at(-1).end > 1200)) { lines.push(line); line = []; width = 0; }
		line.push(unit); width += w;
	}
	if (line.length) lines.push(line);
	const body = lines.map((l, i) => {
		const start = l[0].start, end = lines[i + 1]?.[0].start ?? l.at(-1).end;
		const text = l.map(u => u.text).join(lang === "ko" ? " " : "");
		return `<p t="${start - 10}" d="${end - start + 10}"></p><p t="${start}" d="${end - start}"><s>${text}</s></p>`;
	}).join("");
	return { units, xml: `<?xml version="1.0" encoding="utf-8" ?><timedtext format="3"><head><wp id="1" ap="6" ah="20" av="100" rc="2" cc="40"/></head><body>${body}</body></timedtext>` };
}

function cueTexts(body) {
	return [].concat(body.timedtext.body.p ?? []).map(p => readYouTubeTimedTextParagraph(p).text).filter(t => t && t !== "\u200b");
}

function score(lang, units, texts, timing) {
	// boundaries by character offset in the punctuation-free stream
	const stream = [];
	units.forEach((u, i) => { for (let k = 0; k < Array.from(u.text).length; k++) stream.push({ unit: i, last: k === Array.from(u.text).length - 1 }); });
	let offset = 0, nat = 0, clause = 0, bad = 0, hits = 0;
	const CONN = lang === "ja" ? /(?:て|で|けど|から|ので|のに|し|たら|ば|が|と)$/u : /(?:고|서|면|며|는데|은데|지만|니까|도록|려고|면서|다가)$/u;
	const widths = [];
	for (const text of texts) {
		const n = Array.from(text).filter(keep).length;
		widths.push(Array.from(text).reduce((a, c) => a + (c.charCodeAt(0) > 0x1100 ? 2 : 1), 0));
		offset += n;
		const pos = stream[offset - 1];
		if (!pos || offset >= stream.length) continue;
		const unit = units[pos.unit];
		if (!pos.last) bad++;
		else if (unit.label > 0) { nat++; if (unit.label === 2) hits++; }
		else if (CONN.test(units.slice(Math.max(0, pos.unit - 3), pos.unit + 1).map(u => u.text).join(""))) clause++;
		else bad++;
	}
	const total = nat + clause + bad;
	const periods = units.filter((u, i) => u.label === 2 && i < units.length - 1).length;
	return { cues: texts.length, natural: +(nat / total).toFixed(3), clauseOK: +(clause / total).toFixed(3), BAD: +(bad / total).toFixed(3), sentenceRecall: +(hits / periods).toFixed(3), avgWidth: +(widths.reduce((a, b) => a + b, 0) / widths.length).toFixed(1), maxWidth: Math.max(...widths), overlaps: timing };
}

function overlaps(body) {
	const ps = [].concat(body.timedtext.body.p ?? []);
	return ps.filter((p, i) => ps[i + 1] && Number(p["@t"]) + Number(p["@d"] ?? 0) > Number(ps[i + 1]["@t"])).length;
}

const rows = [];
const shown = {};
for (const lang of ["ja", "ko"]) for (const pauses of [false]) {
	const { units, xml } = makeCase(lang, pauses);
	const label = `${lang} ${pauses ? "with pauses" : "no pauses"}`;
	const old = XML.parse(xml);
	const r1 = resegmentYouTubeASRByParagraphTiming(old);
	if (!r1.applied) { const r2 = resegmentYouTubeASRBySegmentTiming(old); if (!r2.applied) { rebalanceYouTubeASRSentenceBoundaries(old, 450); splitYouTubeASRLongParagraphs(old, 40); } }
	rows.push({ name: `v36 ${label}`, ...score(lang, units, cueTexts(old), overlaps(old)) });
	const now = XML.parse(xml);
	const stats = resegmentYouTubeASR(now, { languageHint: lang });
	rows.push({ name: `v38 ${label} (${stats.language})`, ...score(lang, units, cueTexts(now), overlaps(now)) });
	shown[lang] = now;
}
console.table(rows);
const show = args.indexOf("--show");
if (show >= 0) {
	const lang = args[show + 1] ?? "ja";
	for (const p of [].concat(shown[lang].timedtext.body.p).slice(0, Number(args[show + 2] ?? 80))) console.log(`${(Number(p["@t"]) / 1000).toFixed(2).padStart(8)} ${readYouTubeTimedTextParagraph(p).text}`);
}
export { rows };
