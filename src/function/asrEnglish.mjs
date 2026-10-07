/**
 * English profile for the ASR segmenter (v37 behaviour, unchanged).
 * Word-level punctuation model trained on IWSLT TED transcripts.
 */
import MODEL_SOURCE from "./asrBoundaryModel.mjs";
import { normalizeASRToken, splitWords, estimateWordDuration, hasStrongPunctuation } from "./asrCore.mjs";


let MODEL;
let modelSource = MODEL_SOURCE;
/** Test hook: swap the model table (same shape as asrBoundaryModel.mjs). */
export function setASRBoundaryModel(source) {
	modelSource = source ?? MODEL_SOURCE;
	MODEL = undefined;
}
function loadModel() {
	if (MODEL) return MODEL;
	const weights = new Map();
	for (const line of modelSource.weights.split("\n")) {
		const tab = line.lastIndexOf("\t");
		if (tab < 0) continue;
		const values = line.slice(tab + 1).split(",").map(Number);
		weights.set(line.slice(0, tab), values);
	}
	const vocabulary = new Set(modelSource.vocab.split(" "));
	const lexicon = new Map();
	for (const entry of modelSource.lexicon.split(" ")) {
		const slash = entry.lastIndexOf("/");
		if (slash > 0) lexicon.set(entry.slice(0, slash), entry.slice(slash + 1));
	}
	MODEL = { scale: modelSource.scale, bias: modelSource.bias, weights, vocabulary, lexicon };
	return MODEL;
}

/**
 * Probabilities for the boundary AFTER each token.
 * @param {string[]} tokens normalised tokens
 * @returns {{o:number,comma:number,period:number}[]}
 */
export function scoreBoundaries(tokens) {
	const { scale, bias, weights, vocabulary, lexicon } = loadModel();
	const tags = tokens.map(token => (vocabulary.has(token) && lexicon.has(token) ? lexicon.get(token) : guessTag(token)));
	const words = tokens.map(token => (token === "<n>" || vocabulary.has(token) ? token : "<unk>"));
	const n = words.length;
	const g = index => (index >= 0 && index < n ? words[index] : "_");
	const h = index => (index >= 0 && index < n ? tags[index] : "_");
	const result = new Array(n);
	for (let i = 0; i < n; i += 1) {
		const a2 = g(i - 2), a1 = g(i - 1), a0 = g(i), b0 = g(i + 1), b1 = g(i + 2);
		const x2 = h(i - 2), x1 = h(i - 1), x0 = h(i), y0 = h(i + 1), y1 = h(i + 2), y2 = h(i + 3), y3 = h(i + 4);
		// Mirror of feats() in tools/train.py
		const features = [
			`p:${a0}`, `q:${a1}`, `n:${b0}`, `m:${b1}`, `r:${a2}`,
			`A:${a1}|${a0}`, `B:${a0}|${b0}`, `C:${b0}|${b1}`,
			`D:${a0}|${b0}|${b1}`, `E:${a1}|${a0}|${b0}`,
			`t:${x0}`, `u:${y0}`,
			`TA:${x1}|${x0}`, `TB:${x0}|${y0}`, `TC:${y0}|${y1}`,
			`TD:${y0}|${y1}|${y2}`, `TE:${x0}|${y0}|${y1}`,
			`TF:${y0}|${y1}|${y2}|${y3}`,
			`TG:${x1}|${x0}|${y0}|${y1}`,
			`TH:${x2}|${x1}|${x0}`,
			`MW:${a0}|${y0}|${y1}`, `MX:${x0}|${b0}`,
		];
		let s0 = bias[0], s1 = bias[1], s2 = bias[2];
		for (const feature of features) {
			const w = weights.get(feature);
			if (!w) continue;
			s0 += w[0] / scale;
			s1 += w[1] / scale;
			s2 += w[2] / scale;
		}
		const max = Math.max(s0, s1, s2);
		const e0 = Math.exp(s0 - max), e1 = Math.exp(s1 - max), e2 = Math.exp(s2 - max);
		const sum = e0 + e1 + e2;
		result[i] = { o: e0 / sum, comma: e1 / sum, period: e2 / sum };
	}
	return result;
}

function guessTag(word) {
	if (word === "<n>") return "cd";
	if (word === "_") return "np";
	if (word.endsWith("'s")) return "np$";
	if (word.endsWith("ing")) return "vbg";
	if (word.endsWith("ed")) return "vbn";
	if (word.endsWith("ly")) return "rb";
	if (word.endsWith("s") && !word.endsWith("ss")) return "nns";
	return "np";
}

// Words after which a sentence practically never ends.
const NO_END_AFTER = new Set("a an the to of in on at for with from by into onto about than as and or but nor so because if when while that which who whom whose where is are was were be been being am has have had do does did can could will would shall should must may might my your his her its our their this these those very too more most such no not every each some any all also just only really quite rather same".split(" "));

/**
 * YouTube ASR lower-cases ordinary words but capitalises most proper nouns
 * ("Arian", "Kirill"). In narration a proper noun after a content word very
 * often starts a new sentence, which the lower-cased model cannot see.
 */
function applyProperNounHint(speech, tokens, probabilities, options) {
	if (!options.properNounHint) return;
	const capitalised = speech.map(word => /^[A-Z][a-z'’]+$/.test(word.text) && word.text !== "I");
	// only trust capitalisation when the track is mostly lower-case
	const ratio = capitalised.filter(Boolean).length / Math.max(1, speech.length);
	if (ratio > 0.25) return;
	for (let index = 0; index < speech.length - 1; index += 1) {
		if (!capitalised[index + 1] || capitalised[index]) continue;
		if (NO_END_AFTER.has(tokens[index])) continue;
		const p = probabilities[index];
		const odds = (p.period / Math.max(1e-6, 1 - p.period)) * options.properNounBoost;
		const period = odds / (1 + odds);
		const scale = (1 - period) / Math.max(1e-6, p.o + p.comma);
		probabilities[index] = { o: p.o * scale, comma: p.comma * scale, period };
	}
}

function finishEnglishCue(parts, probabilities, options) {
	if (options.addPunctuation) {
		for (let index = 0; index < parts.length; index += 1) {
			const last = index === parts.length - 1;
			const p = probabilities[index];
			if (/[.,!?;:…]$/.test(parts[index])) continue;
			if (last) {
				if (p.period >= options.periodThreshold) parts[index] += isQuestion(parts) ? "?" : ".";
			} else if (p.period >= 0.8) {
				parts[index] += ".";
			} else if (p.comma >= options.commaThreshold) {
				parts[index] += ",";
			}
		}
	}
	let text = parts.join(" ");
	text = text.replace(/\bi\b/g, "I").replace(/\bi'(m|ll|ve|d)\b/g, "I'$1");
	return { text, endsSentence: probabilities.at(-1).period >= options.periodThreshold || hasStrongPunctuation(parts.at(-1)) };
}

function isQuestion(parts) {
	const first = normalizeASRToken(parts[0]);
	const second = normalizeASRToken(parts[1] ?? "");
	const aux = /^(?:is|are|was|were|do|does|did|can|could|would|will|shall|should|have|has)$/;
	if (/^(?:what|why|how|where|who|which)$/.test(first) && aux.test(second)) return true;
	return aux.test(first) && /^(?:you|we|i|he|she|it|they|there)$/.test(second);
}

function scoreEnglish(speech, options) {
	const tokens = speech.map(word => normalizeASRToken(word.text) || "_");
	const probabilities = scoreBoundaries(tokens);
	applyProperNounHint(speech, tokens, probabilities, options);
	return probabilities;
}

/** English: unchanged v37 behaviour. */
export const EN_PROFILE = Object.freeze({
	id: "en",
	tokenize: splitWords,
	normalize: normalizeASRToken,
	estimateDuration: estimateWordDuration,
	score: scoreEnglish,
	finishCue: finishEnglishCue,
	defaults: { joinerWidth: 1, capitalize: true },
});
