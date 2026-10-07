import fs from "node:fs";
import { segmentASRWords, setASRBoundaryModel } from "../src/function/asrSegmenter.mjs";
const m = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
setASRBoundaryModel({ scale: m.scale, bias: m.bias, vocab: m.vocab.join(" "), lexicon: Object.entries(m.lex).map(([w, t]) => `${w}/${t}`).join(" "), weights: Object.entries(m.w).map(([k, v]) => `${k}\t${v.join(",")}`).join("\n") });
const rows = fs.readFileSync("ted_dev2012", "utf8").split("\n");
const tokens = [];
for (const row of rows) {
	const [w, l] = row.split("\t"); if (!w) continue;
	const label = l === "PERIOD" || l === "QUESTION" ? 2 : l === "COMMA" ? 1 : 0;
	if (tokens.length && (w.startsWith("'") || w === "n't")) { tokens.at(-1).text += w; tokens.at(-1).label = label; continue; }
	if (!/[a-z0-9]/i.test(w)) { if (tokens.length) tokens.at(-1).label = Math.max(tokens.at(-1).label, label); continue; }
	tokens.push({ text: w, label }); if (tokens.length >= 50000) break;
}
let t = 0;
const words = tokens.map(tok => { const start = t; t += 120 + 45 * tok.text.length; return { text: tok.text, start, end: t, event: false }; });
const CONJ = /^(?:and|but|or|so|because|which|who|that|when|while|until|otherwise|if|where|before|after|since|though|although|then|like)$/;
function run(o) {
	const cues = segmentASRWords(words, { addPunctuation: false, ...o });
	let i = 0, nat = 0, cl = 0, bad = 0, hit = 0; const br = [];
	for (const c of cues) { i += c.words.length; br.push(i - 1); }
	for (const b of br) { if (b >= tokens.length - 1) continue; if (tokens[b].label > 0) nat++; else if (CONJ.test(tokens[b + 1].text)) cl++; else bad++; if (tokens[b].label === 2) hit++; }
	const per = tokens.filter((x, k) => x.label === 2 && k < tokens.length - 1).length, tot = nat + cl + bad;
	const avg = cues.reduce((a, c) => a + c.text.length, 0) / cues.length;
	const r = { nat: nat / tot, cl: cl / tot, bad: bad / tot, rec: hit / per, avg };
	r.score = r.nat + 0.5 * r.cl - 2.5 * r.bad + 0.8 * r.rec - (avg > 60 ? (avg - 60) * 0.02 : 0) - (avg < 40 ? (40 - avg) * 0.02 : 0);
	return r;
}
const grid = { commaWeight: [0.5, 0.75, 1], breakScale: [1.6, 2.2, 3], keepFrom: [0.25, 0.35, 0.5], keepScale: [5, 9, 14], cueCost: [1, 1.6, 2.5], longPenalty: [0.05, 0.09, 0.15] };
let best = { o: {}, r: run({}) };
console.log("default", JSON.stringify(best.r));
// coordinate descent
for (let round = 0; round < 2; round++) for (const [k, vals] of Object.entries(grid)) for (const v of vals) {
	const o = { ...best.o, [k]: v }; const r = run(o);
	if (r.score > best.r.score + 1e-4) { best = { o, r }; console.log(JSON.stringify(o), JSON.stringify(Object.fromEntries(Object.entries(r).map(([a, b]) => [a, +b.toFixed(3)])))); }
}
console.log("BEST", JSON.stringify(best));
