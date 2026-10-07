/**
 * Japanese / Korean profiles for the ASR segmenter (asrSegmenter.mjs).
 *
 * The English model works on words and cannot be reused: Japanese has no
 * spaces and Korean words are agglutinated. Both languages, however, mark
 * sentence ends very explicitly with verb endings (〜ます / 〜ました / 〜ですね,
 * -다 / -요 / -니다 / -까), so a small character-context model is enough:
 * for every possible boundary it looks at the last 1-4 characters before it
 * and the first 1-3 characters after it.
 *
 *   ja : a boundary may fall between any two characters (tokens = characters,
 *        Latin words / numbers kept whole), joined without spaces.
 *   ko : a boundary may only fall at a space (tokens = eojeol), joined with " ".
 *
 * Models: asrModelJa.mjs (Tanaka corpus + JSQuAD Wikipedia),
 *         asrModelKo.mjs (Chatbot_data + KorNLI + NSMC), see tools/cjk/.
 * Feature extraction mirrors feats() in tools/cjk/train_cjk.py exactly.
 */
import JA_MODEL from "./asrModelJa.mjs";
import KO_MODEL from "./asrModelKo.mjs";

const cache = new Map();
function loadModel(source) {
	if (cache.has(source)) return cache.get(source);
	const weights = new Map();
	for (const line of source.weights.split("\n")) {
		const tab = line.lastIndexOf("\t");
		if (tab > 0) weights.set(line.slice(0, tab), line.slice(tab + 1).split(",").map(Number));
	}
	const model = { scale: source.scale, bias: source.bias, weights };
	cache.set(source, model);
	return model;
}

/* ---------------- normalisation (mirror of train_cjk.py) ---------------- */

function normChar(character) {
	if (/^\p{Nd}$/u.test(character)) return "0";
	if (/^[a-z]$/i.test(character)) return "a";
	return character;
}
function keepChar(character) {
	return /^[\p{L}\p{N}]$/u.test(character);
}
function charType(character) {
	if (character === "_") return "_";
	if (character === " ") return "S";
	const code = character.codePointAt(0);
	if (code >= 0x3040 && code <= 0x309f) return "H";
	if (code >= 0x30a0 && code <= 0x30ff) return "K";
	if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) return "C";
	if (code >= 0xac00 && code <= 0xd7a3) return "G";
	if (character === "a") return "A";
	if (character === "0") return "D";
	return "O";
}
/** characters of one token after NFKC + normalisation, punctuation removed */
function tokenChars(token) {
	return Array.from(String(token).normalize("NFKC")).filter(keepChar).map(normChar);
}

function features(lang, chars, i) {
	const n = chars.length;
	const r0 = lang === "ko" ? i + 2 : i + 1;
	const L = chars.slice(Math.max(0, i - 3), i + 1).join("").padStart(4, "_");
	const Lc = Array.from(L);
	const R = chars.slice(r0, r0 + 3).join("").padEnd(3, "_");
	const Rc = Array.from(R);
	const l1 = Lc.at(-1), l2 = Lc.slice(-2).join(""), l3 = Lc.slice(-3).join("");
	const r1 = Rc[0], r2 = Rc.slice(0, 2).join("");
	const tL = Lc.slice(-3).map(charType).join("");
	const tR = Rc.slice(0, 2).map(charType).join("");
	const result = [
		`a:${l1}`, `b:${l2}`, `c:${l3}`, `d:${L}`,
		`e:${r1}`, `f:${r2}`, `g:${R}`,
		`h:${l1}|${r1}`, `i:${l2}|${r1}`, `j:${l1}|${r2}`,
		`k:${l3}|${r1}`, `y:${l2}|${r2}`, `t:${tL}|${tR}`,
	];
	if (lang === "ko") {
		let j = i;
		while (j >= 0 && chars[j] !== " ") j -= 1;
		const leftWord = chars.slice(j + 1, i + 1).join("");
		let k = r0;
		while (k < n && chars[k] !== " ") k += 1;
		const rightWord = chars.slice(r0, k).join("");
		if (Array.from(leftWord).length <= 8) result.push(`w:${leftWord}`);
		if (Array.from(rightWord).length <= 8) result.push(`x:${rightWord}`);
	}
	return result;
}

function softmax(model, list) {
	let s0 = model.bias[0], s1 = model.bias[1], s2 = model.bias[2];
	for (const feature of list) {
		const w = model.weights.get(feature);
		if (!w) continue;
		s0 += w[0] / model.scale;
		s1 += w[1] / model.scale;
		s2 += w[2] / model.scale;
	}
	const max = Math.max(s0, s1, s2);
	const e0 = Math.exp(s0 - max), e1 = Math.exp(s1 - max), e2 = Math.exp(s2 - max);
	const sum = e0 + e1 + e2;
	return { o: e0 / sum, comma: e1 / sum, period: e2 / sum };
}

/**
 * Probabilities for the boundary after each token.
 * @param {"ja"|"ko"} lang
 * @param {string[]} tokens raw token texts
 */
export function scoreCjkBoundaries(lang, tokens) {
	const model = loadModel(lang === "ja" ? JA_MODEL : KO_MODEL);
	const chars = [];
	const lastCharIndex = [];
	tokens.forEach(token => {
		const list = tokenChars(token);
		if (lang === "ko" && chars.length && list.length) chars.push(" ");
		chars.push(...list);
		lastCharIndex.push(list.length ? chars.length - 1 : -1);
	});
	if (lang === "ko") chars.push(" ");
	return tokens.map((_, index) => {
		const i = lastCharIndex[index];
		if (i < 0) return { o: 0.5, comma: 0.25, period: 0.25 };
		return softmax(model, features(lang, chars, i));
	});
}

/* ---------------- profiles ---------------- */

const JA_QUESTION = /(?:か|かな|かね|の|でしょう|ですか|ますか)$/u;
const KO_QUESTION = /(?:까|니|나요|가요|래요|죠|지요|냐|나|ㄹ까)$/u;
const KO_CONNECTIVE = /(?:고|서|면|며|는데|은데|ㄴ데|지만|거든|니까|어서|아서|해서|도록|려고|면서|다가)$/u;
const JA_CONNECTIVE = /(?:て|で|けど|けれど|けども|から|ので|のに|し|たら|ば|が|と)$/u;

function tokenizeJapanese(text) {
	// Latin words / numbers stay whole, every other visible character is a token
	return String(text).match(/[A-Za-z0-9０-９Ａ-Ｚａ-ｚ'’.,:%°$+\-]+|[^\s]/gu) ?? [];
}
function tokenizeKorean(text) {
	return String(text).replace(/(^|\s)([-–+])\s+(?=\d)/g, "$1$2").match(/\S+/gu) ?? [];
}
function normalizeCjk(token) {
	return String(token).normalize("NFKC").toLowerCase();
}

function scoreWith(lang, connective) {
	return speech => {
		const tokens = speech.map(word => word.text);
		const probabilities = scoreCjkBoundaries(lang, tokens);
		// Spoken run-on sentences: a connective ending (〜て / 〜けど / -고 / -는데)
		// is an acceptable place to split a long sentence even without a comma.
		return probabilities.map((p, index) => {
			const tail = lang === "ja" ? tokens.slice(Math.max(0, index - 3), index + 1).join("") : tokens[index];
			if (!connective.test(tail.normalize("NFKC")) || p.comma >= 0.3) return p;
			const comma = Math.max(p.comma, Math.min(0.3, p.o * 0.35));
			const scale = (1 - comma - p.period) / Math.max(1e-6, p.o);
			return { o: p.o * scale, comma, period: p.period };
		});
	};
}

function finishJapaneseCue(parts, probabilities, options) {
	const out = parts.slice();
	if (options.addPunctuation) {
		for (let index = 0; index < out.length; index += 1) {
			const p = probabilities[index];
			const last = index === out.length - 1;
			if (/[。、！？!?…]$/u.test(out[index])) continue;
			const text = out.slice(Math.max(0, index - 4), index + 1).join("");
			if (last && p.period >= options.periodThreshold) out[index] += JA_QUESTION.test(text) && /か$/u.test(text) ? "？" : "。";
			else if (!last && p.period >= 0.85) out[index] += "。";
			else if (!last && p.comma >= options.commaThreshold) out[index] += "、";
		}
	}
	return { text: out.join(""), endsSentence: probabilities.at(-1).period >= options.periodThreshold };
}

function finishKoreanCue(parts, probabilities, options) {
	const out = parts.slice();
	if (options.addPunctuation) {
		for (let index = 0; index < out.length; index += 1) {
			const p = probabilities[index];
			const last = index === out.length - 1;
			if (/[.,!?…]$/u.test(out[index])) continue;
			if (last && p.period >= options.periodThreshold) out[index] += KO_QUESTION.test(out[index]) && /(?:까|니|나요|가요|냐)$/u.test(out[index]) ? "?" : ".";
			else if (!last && p.period >= 0.85) out[index] += ".";
			else if (!last && p.comma >= options.commaThreshold) out[index] += ",";
		}
	}
	return { text: out.join(" "), endsSentence: probabilities.at(-1).period >= options.periodThreshold };
}

// Width units: CJK characters count 2, Latin/space 1 (same as the renderer).
export const JA_PROFILE = Object.freeze({
	id: "ja",
	tokenize: tokenizeJapanese,
	normalize: normalizeCjk,
	estimateDuration: token => Math.min(900, 110 * Array.from(token).length + 20),
	score: scoreWith("ja", JA_CONNECTIVE),
	finishCue: finishJapaneseCue,
	defaults: {
		joinerWidth: 0,
		capitalize: false,
		properNounHint: false,
		softChars: 40, // ~20 Japanese characters
		hardChars: 56, // ~28 Japanese characters
		minChars: 10,
		orphanWords: 4, // tokens are characters
		periodThreshold: 0.5,
		commaThreshold: 0.6,
	},
});

export const KO_PROFILE = Object.freeze({
	id: "ko",
	tokenize: tokenizeKorean,
	normalize: normalizeCjk,
	estimateDuration: token => Math.min(1200, 150 + 105 * Array.from(token).length),
	score: scoreWith("ko", KO_CONNECTIVE),
	finishCue: finishKoreanCue,
	defaults: {
		joinerWidth: 1,
		capitalize: false,
		properNounHint: false,
		softChars: 46, // ~6 eojeol
		hardChars: 66,
		minChars: 12,
		orphanWords: 2,
		periodThreshold: 0.5,
		commaThreshold: 0.6,
	},
});

export const CJK_PROFILES = Object.freeze({ ja: JA_PROFILE, ko: KO_PROFILE });
