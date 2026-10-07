// Large-scale tuning set: IWSLT dev2012 TED transcripts turned into fake ASR.
import fs from "node:fs";
import { segmentASRWords, setASRBoundaryModel } from "../src/function/asrSegmenter.mjs";
const [, , modelFile, optionsJSON, limitArg] = process.argv;
if (modelFile && modelFile !== "-") {
	const m = JSON.parse(fs.readFileSync(modelFile, "utf8"));
	setASRBoundaryModel({ scale: m.scale, bias: m.bias, vocab: m.vocab.join(" "), lexicon: Object.entries(m.lex).map(([w, t]) => `${w}/${t}`).join(" "), weights: Object.entries(m.w).map(([k, v]) => `${k}\t${v.join(",")}`).join("\n") });
}
const options = optionsJSON && optionsJSON !== "-" ? JSON.parse(optionsJSON) : {};
const limit = Number(limitArg ?? 60000);
const rows = fs.readFileSync(new URL("../ted_dev2012", import.meta.url), "utf8").split("\n");
const tokens = [];
for (const row of rows) {
	const [w, l] = row.split("\t");
	if (!w) continue;
	const label = l === "PERIOD" || l === "QUESTION" ? 2 : l === "COMMA" ? 1 : 0;
	if (tokens.length && (w.startsWith("'") || w === "n't")) { tokens.at(-1).text += w; tokens.at(-1).label = label; continue; }
	if (!/[a-z0-9]/i.test(w)) { if (tokens.length) tokens.at(-1).label = Math.max(tokens.at(-1).label, label); continue; }
	tokens.push({ text: w, label });
	if (tokens.length >= limit) break;
}
let t = 0;
const words = tokens.map(tok => { const start = t; t += 120 + 45 * tok.text.length; return { text: tok.text, start, end: t, event: false }; });
const cues = segmentASRWords(words, { addPunctuation: false, ...options });
let index = 0, natural = 0, clause = 0, bad = 0, sentenceHits = 0;
const breakAfter = new Set();
for (const cue of cues) { index += cue.words.length; breakAfter.add(index - 1); }
const CONJ = /^(?:and|but|or|so|because|which|who|that|when|while|until|otherwise|if|where|before|after|since|though|although|then|like)$/;
for (const i of breakAfter) {
	if (i >= tokens.length - 1) continue;
	if (tokens[i].label > 0) natural++; else if (CONJ.test(tokens[i + 1].text)) clause++; else bad++;
}
const periods = tokens.filter((tok, i) => tok.label === 2 && i < tokens.length - 1).length;
for (const i of breakAfter) if (tokens[i]?.label === 2) sentenceHits++;
const total = natural + clause + bad;
const chars = cues.map(c => c.text.length);
const out = { cues: cues.length, natural: +(natural / total).toFixed(3), clauseOK: +(clause / total).toFixed(3), BAD: +(bad / total).toFixed(3), sentenceRecall: +(sentenceHits / periods).toFixed(3), avgChars: +(chars.reduce((a, b) => a + b, 0) / chars.length).toFixed(1), maxChars: Math.max(...chars) };
console.log(JSON.stringify(out));
