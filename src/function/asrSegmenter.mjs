/**
 * YouTube ASR (auto-generated, punctuation-free) caption re-segmentation.
 *
 * Pipeline
 *   1. extractASRWords()  : srv3 XML JSON -> flat word stream with timing
 *                           (exact <s t=".."> offsets when present, otherwise
 *                           estimated inside each <p> by character weight).
 *                           Rolling-window empty <p>, duplicated roll-up text
 *                           and non-speech cues ([Music]) are handled here.
 *   2. scoreBoundaries()  : a tiny n-gram punctuation model trained on spoken
 *                           English (IWSLT TED transcripts) predicts, for the
 *                           gap after every word, P(no break / comma / period).
 *   3. segmentWords()     : dynamic programming chooses the cue boundaries,
 *                           combining model probability, real pauses and
 *                           display limits (chars / duration). Short orphans
 *                           separated by a long pause or [Music] are attached
 *                           to the sentence they grammatically belong to.
 *   4. buildCues()        : restores light punctuation / capitalisation, and
 *                           computes non-overlapping display timing.
 *
 * Pure functions, no network, no dependencies except the model table.
 */
import MODEL_SOURCE from "./asrBoundaryModel.mjs";

export const ASR_SEGMENTER_VERSION = "37.0";

export const DEFAULT_ASR_SEGMENT_OPTIONS = Object.freeze({
	softChars: 62, // comfortable length of one English cue
	hardChars: 86, // never exceed (except a single huge token)
	minChars: 14, // shorter cues are penalised (not forbidden)
	hardDuration: 8000, // ms, never exceed for one cue
	softDuration: 6000,
	hardGap: 2500, // ms, a pause this long is a forced boundary ...
	orphanWords: 2, // ... unless the piece beyond it is an orphan of <= N words
	pauseBonusFrom: 350, // ms, pauses longer than this favour a boundary
	periodThreshold: 0.5, // P(period) above this = sentence end
	addPunctuation: true, // add "." / "?" / "," and capitalise when confident
	commaThreshold: 0.72,
	minDisplay: 1200, // ms, minimum on-screen time when there is room
	tailHold: 600, // ms, keep a cue a bit after its last word if there is room
	keepEvents: true, // keep [Music] / [Applause] cues
	// dynamic-programming weights (tuned on IWSLT dev2012, see tools/tune.mjs)
	commaWeight: 0.75,
	breakScale: 1.6,
	keepFrom: 0.25,
	keepScale: 14,
	cueCost: 1.2,
	longPenalty: 0.09,
	properNounHint: true,
	properNounBoost: 4,
});

/* ------------------------------------------------------------------------ */
/* Model                                                                     */
/* ------------------------------------------------------------------------ */

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

/** Same normalisation as train.py -> norm(). */
export function normalizeASRToken(token) {
	let text = String(token ?? "").toLowerCase().replace(/[’‘]/g, "'");
	text = text.replace(/[^a-z0-9']/g, "").replace(/^'+|'+$/g, "");
	if (!text) return "";
	if (/[0-9]/.test(text)) return "<n>";
	return text;
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

/* ------------------------------------------------------------------------ */
/* 1. Word extraction                                                        */
/* ------------------------------------------------------------------------ */

const EVENT_RE = /^\s*(?:\[[^\]]{1,40}\]|\([^)]{1,40}\)|[♪♫♬\s]+)\s*$/u;

function asArray(value) {
	return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}
function textOf(node) {
	if (node === undefined || node === null) return "";
	if (Array.isArray(node)) return node.map(textOf).join("");
	if (typeof node === "object") return textOf(node["#"]);
	return String(node);
}
function int(value) {
	const number = Number.parseInt(value ?? "", 10);
	return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function estimateWordDuration(word) {
	return Math.min(900, 140 + 62 * Array.from(word).length);
}
function splitWords(text) {
	// "- 54°" -> "-54°" so a lone minus sign is not a word
	return String(text).replace(/(^|\s)([-–+])\s+(?=\d)/g, "$1$2").match(/\S+/gu) ?? [];
}

/**
 * @returns {{words: object[], exactTiming: boolean, paragraphs: number}}
 * word = { text, start, end, event, template, paragraph }
 */
export function extractASRWords(body) {
	const paragraphs = asArray(body?.timedtext?.body?.p);
	const visible = [];
	let explicitOffsets = 0;
	let segments = 0;
	for (const paragraph of paragraphs) {
		const start = int(paragraph?.["@t"]);
		if (start === undefined) continue;
		const sNodes = asArray(paragraph?.s);
		const pieces = sNodes.length
			? sNodes.map((segment, index) => {
				const offset = int(segment?.["@t"]);
				if (offset !== undefined && index > 0) explicitOffsets += 1;
				segments += 1;
				return { text: textOf(segment), offset: offset ?? (index === 0 ? 0 : undefined) };
			})
			: [{ text: textOf(paragraph?.["#"] ?? paragraph), offset: 0 }];
		const text = pieces.map(piece => piece.text).join("").replace(/\u200b/g, "").trim();
		if (!text) continue;
		visible.push({ paragraph, start, duration: int(paragraph?.["@d"]), pieces, text });
	}
	const exactTiming = segments > 0 && explicitOffsets / Math.max(1, segments - visible.length) >= 0.5;

	const words = [];
	visible.forEach((item, index) => {
		const nextStart = visible[index + 1]?.start;
		let end = item.duration !== undefined ? item.start + item.duration : item.start + 3000;
		if (nextStart !== undefined && nextStart > item.start) end = Math.min(end, nextStart);
		if (end <= item.start) end = item.start + 1;

		if (EVENT_RE.test(item.text)) {
			words.push({ text: item.text.trim(), start: item.start, end, event: true, template: item.paragraph });
			return;
		}

		const local = [];
		if (exactTiming) {
			item.pieces.forEach((piece, pieceIndex) => {
				const pieceStart = item.start + (piece.offset ?? 0);
				const nextOffset = item.pieces.slice(pieceIndex + 1).find(next => next.offset !== undefined)?.offset;
				const pieceEnd = nextOffset !== undefined ? item.start + nextOffset : end;
				const tokens = splitWords(piece.text);
				tokens.forEach((token, tokenIndex) => {
					const span = Math.max(1, pieceEnd - pieceStart);
					local.push({ text: token, start: Math.round(pieceStart + (span * tokenIndex) / tokens.length) });
				});
			});
		} else {
			// No word offsets: spread the words over the time they would take to
			// say (not over the whole display duration, which often includes a
			// long silence after the line). The remainder becomes a real pause.
			const tokens = splitWords(item.text);
			const weights = tokens.map(token => estimateWordDuration(token));
			const total = weights.reduce((sum, weight) => sum + weight, 0);
			const available = Math.max(1, end - item.start);
			const speaking = Math.min(available, total * 1.25);
			let consumed = 0;
			tokens.forEach((token, tokenIndex) => {
				local.push({ text: token, start: Math.round(item.start + (speaking * consumed) / total), speakingEnd: item.start + speaking });
				consumed += weights[tokenIndex];
			});
		}

		// Roll-up formats sometimes repeat the previous line as the start of
		// the next paragraph. Drop such a duplicated prefix.
		const previousWords = words.filter(word => !word.event).slice(-12).map(word => normalizeASRToken(word.text));
		const currentWords = local.map(word => normalizeASRToken(word.text));
		let overlap = 0;
		for (let size = Math.min(previousWords.length, currentWords.length - 1); size >= 2; size -= 1) {
			if (previousWords.slice(-size).join(" ") === currentWords.slice(0, size).join(" ")) {
				overlap = size;
				break;
			}
		}
		local.slice(overlap).forEach((word, wordIndex, list) => {
			const nextWordStart = list[wordIndex + 1]?.start ?? (word.speakingEnd !== undefined ? Math.round(word.speakingEnd) : end);
			const wordEnd = exactTiming
				? Math.min(nextWordStart, word.start + estimateWordDuration(word.text))
				: nextWordStart;
			words.push({ text: word.text, start: word.start, end: Math.max(word.start + 1, wordEnd), event: false, template: item.paragraph });
		});
	});

	words.sort((left, right) => left.start - right.start);
	return { words, exactTiming, paragraphs: paragraphs.length, visible: visible.length };
}

/* ------------------------------------------------------------------------ */
/* 2+3. Segmentation                                                         */
/* ------------------------------------------------------------------------ */

const ABBREVIATION_END = /^(?:mr|mrs|ms|dr|st|vs|etc)\.$/i;

function hasStrongPunctuation(text) {
	return /[.!?。！？…]["'’”)\]]*$/u.test(text) && !ABBREVIATION_END.test(text) && !/^[ap]\.m\.$/i.test(text);
}
function hasWeakPunctuation(text) {
	return /[,;:，；：]["'’”)\]]*$/u.test(text);
}

function widthOf(text) {
	let width = 0;
	for (const character of text) {
		const code = character.codePointAt(0);
		width += code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xff60)) ? 2 : 1;
	}
	return width;
}

/**
 * Segment one run of speech words (no events inside).
 * @returns {number[]} indexes i such that a cue ends after words[i]
 */
function segmentRun(words, probabilities, options) {
	const n = words.length;
	if (!n) return [];
	const { softChars, hardChars, minChars, hardDuration, softDuration, hardGap, orphanWords, pauseBonusFrom } = options;

	const gapAfter = words.map((word, index) => (index + 1 < n ? Math.max(0, words[index + 1].start - word.end) : Infinity));
	const width = words.map(word => widthOf(word.text));

	// Boundary cost: low where a break is natural, high mid-phrase.
	const breakCost = new Array(n).fill(0);
	const keepCost = new Array(n).fill(0);
	for (let index = 0; index < n - 1; index += 1) {
		const p = probabilities[index];
		let breakable = p.period + options.commaWeight * p.comma;
		if (hasStrongPunctuation(words[index].text)) breakable = Math.max(breakable, 0.97);
		else if (hasWeakPunctuation(words[index].text)) breakable = Math.max(breakable, 0.8);
		const gap = gapAfter[index];
		let pauseBonus = 0;
		if (gap > pauseBonusFrom) pauseBonus = Math.min(2.2, (gap - pauseBonusFrom) / 600);
		breakCost[index] = -Math.log(Math.max(1e-4, breakable)) * options.breakScale - pauseBonus;
		// Merging two sentences into one cue costs something proportional to
		// how sure we are that a sentence ends here.
		const sentence = hasStrongPunctuation(words[index].text) ? 1 : p.period;
		keepCost[index] = sentence > options.keepFrom ? (sentence - options.keepFrom) * options.keepScale : 0;
	}

	// Prefix sums of keepCost so that the cost of keeping boundaries inside a
	// segment [i, j] is O(1).
	const keepPrefix = new Array(n + 1).fill(0);
	for (let index = 0; index < n; index += 1) keepPrefix[index + 1] = keepPrefix[index] + keepCost[index];

	const best = new Array(n + 1).fill(Infinity);
	const back = new Array(n + 1).fill(-1);
	best[0] = 0;

	for (let start = 0; start < n; start += 1) {
		if (!Number.isFinite(best[start])) continue;
		let chars = -1;
		let hardGaps = []; // indexes (inside segment) after which a hard gap occurs
		for (let end = start; end < n; end += 1) {
			chars += width[end] + 1;
			if (end > start && gapAfter[end - 1] >= hardGap) hardGaps.push(end - 1);

			// Spanning a hard gap is only allowed for a short orphan on one side.
			let anchorStart = start;
			let anchorEnd = end;
			if (hardGaps.length) {
				if (hardGaps.length > 1) break;
				const gapIndex = hardGaps[0];
				const before = gapIndex - start + 1;
				const after = end - gapIndex;
				if (after <= orphanWords) anchorEnd = gapIndex; // orphan head attached backwards
				else if (before <= orphanWords) anchorStart = gapIndex + 1; // orphan tail attached forwards
				else break;
				if (gapAfter[gapIndex] > 30000) break;
			}
			const duration = words[anchorEnd].end - words[anchorStart].start;
			if (end > start && (chars > hardChars || duration > hardDuration)) break;

			let cost = best[start];
			// length preference
			if (chars > softChars) cost += (chars - softChars) * options.longPenalty;
			if (chars < minChars) cost += (minChars - chars) * 0.18 + (end === start ? 1.2 : 0);
			if (duration > softDuration) cost += (duration - softDuration) / 900;
			// every cue has a fixed price -> prefer fewer, sentence-sized cues
			cost += options.cueCost;
			// boundaries we skip inside this cue
			cost += keepPrefix[end] - keepPrefix[start];
			// the boundary after this cue
			if (end < n - 1) cost += breakCost[end] - keepCost[end];
			// orphan attachment across a hard gap: allowed only if the side
			// boundary is grammatically impossible (model says "no break").
			if (hardGaps.length) {
				const gapIndex = hardGaps[0];
				const p = probabilities[gapIndex];
				const glue = p.o; // probability that the text continues
				// the orphan must also be followed by a real break, otherwise it
				// is the start of the next sentence, not the tail of this one
				const after = end < n - 1 ? probabilities[end].period + probabilities[end].comma : 1;
				const orphanIsHead = anchorEnd === gapIndex;
				const orphanSize = orphanIsHead ? end - gapIndex : gapIndex - start + 1;
				cost += glue > 0.8 && (orphanSize === 1 || !orphanIsHead || after > 0.45) ? -1.5 : 6;
			}
			if (cost < best[end + 1]) {
				best[end + 1] = cost;
				back[end + 1] = start;
			}
		}
		// guarantee progress even for a pathological single token
		if (!Number.isFinite(best[start + 1])) {
			best[start + 1] = best[start] + 50;
			back[start + 1] = start;
		}
	}

	const ends = [];
	for (let position = n; position > 0; position = back[position]) ends.push(position - 1);
	return ends.reverse();
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

/**
 * @returns cues [{ text, start, end, words, event, template }]
 */
export function segmentASRWords(words, userOptions = {}) {
	const options = { ...DEFAULT_ASR_SEGMENT_OPTIONS, ...userOptions };
	const speech = words.filter(word => !word.event);
	const tokens = speech.map(word => normalizeASRToken(word.text) || "_");
	const probabilities = scoreBoundaries(tokens);
	applyProperNounHint(speech, tokens, probabilities, options);

	// Events ([Music]) are taken out of the speech stream so that they do not
	// break the language context; they are re-inserted by time afterwards.
	// A very long silence still splits the stream into independent runs.
	const runs = [];
	let run = [];
	speech.forEach((word, index) => {
		if (run.length && word.start - run.at(-1).end > 30000) {
			runs.push(run);
			run = [];
		}
		run.push(index);
	});
	if (run.length) runs.push(run);

	// a [Music] cue between two words is treated as a hard gap
	const eventTimes = words.filter(word => word.event).map(word => word.start);
	const speechWithEventGaps = speech.map((word, index) => {
		const next = speech[index + 1];
		if (!next) return word;
		const eventBetween = eventTimes.some(time => time >= word.start && time < next.start);
		return eventBetween ? { ...word, end: Math.min(word.end, next.start - options.hardGap - 1) } : word;
	});

	const cues = [];
	for (const indexes of runs) {
		const runWords = indexes.map(index => speechWithEventGaps[index]);
		const runProbabilities = indexes.map(index => probabilities[index]);
		const ends = segmentRun(runWords, runProbabilities, options);
		let from = 0;
		for (const end of ends) {
			const cueWords = indexes.slice(from, end + 1).map(index => speech[index]);
			const cueProbabilities = indexes.slice(from, end + 1).map(index => probabilities[index]);
			cues.push(buildCue(cueWords, cueProbabilities, options));
			from = end + 1;
		}
	}

	if (options.keepEvents) {
		for (const word of words) if (word.event) cues.push({ text: word.text, start: word.start, end: word.end, event: true, template: word.template, anchorStart: word.start, anchorEnd: word.end });
	}
	cues.sort((left, right) => left.anchorStart - right.anchorStart);
	assignDisplayTiming(cues, options);
	return cues;
}

/* ------------------------------------------------------------------------ */
/* 4. Cue text + timing                                                      */
/* ------------------------------------------------------------------------ */

function buildCue(cueWords, probabilities, options) {
	// anchor = the main body of the cue (orphans across long pauses ignored)
	let anchorFrom = 0;
	let anchorTo = cueWords.length - 1;
	for (let index = 0; index < cueWords.length - 1; index += 1) {
		if (cueWords[index + 1].start - cueWords[index].end >= options.hardGap) {
			if (index + 1 <= options.orphanWords) anchorFrom = index + 1;
			else anchorTo = index;
		}
	}
	const parts = cueWords.map(word => word.text);
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
	return {
		text,
		start: cueWords[anchorFrom].start,
		end: cueWords[anchorTo].end,
		anchorStart: cueWords[anchorFrom].start,
		anchorEnd: cueWords[anchorTo].end,
		endsSentence: probabilities.at(-1).period >= options.periodThreshold || hasStrongPunctuation(parts.at(-1)),
		words: cueWords,
		event: false,
		template: cueWords[0].template,
	};
}

function isQuestion(parts) {
	const first = normalizeASRToken(parts[0]);
	const second = normalizeASRToken(parts[1] ?? "");
	const aux = /^(?:is|are|was|were|do|does|did|can|could|would|will|shall|should|have|has)$/;
	if (/^(?:what|why|how|where|who|which)$/.test(first) && aux.test(second)) return true;
	return aux.test(first) && /^(?:you|we|i|he|she|it|they|there)$/.test(second);
}

function assignDisplayTiming(cues, options) {
	// Capitalise cues that start a sentence.
	let previousEndsSentence = true;
	for (const cue of cues) {
		if (cue.event) continue;
		if (options.addPunctuation && previousEndsSentence) cue.text = cue.text.replace(/^(\W*)(\p{Ll})/u, (_, prefix, letter) => prefix + letter.toUpperCase());
		previousEndsSentence = cue.endsSentence;
	}
	for (let index = 0; index < cues.length; index += 1) {
		const cue = cues[index];
		const next = cues[index + 1];
		const limit = next ? next.anchorStart : Infinity;
		let start = cue.anchorStart;
		let end = Math.max(cue.anchorEnd + options.tailHold, start + options.minDisplay);
		end = Math.min(end, limit);
		if (end <= start) end = start + 1;
		cue.start = start;
		cue.end = end;
	}
}

/* ------------------------------------------------------------------------ */
/* XML entry point                                                           */
/* ------------------------------------------------------------------------ */

/**
 * Replace body.timedtext.body.p with re-segmented cues (single <s> each),
 * remove the rolling <w> window. Returns statistics.
 */
export function resegmentYouTubeASR(body, userOptions = {}) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return { applied: false, reason: "no-body" };
	const extracted = extractASRWords(body);
	const speechWords = extracted.words.filter(word => !word.event);
	if (speechWords.length < 2) return { applied: false, reason: "too-few-words", ...extracted, words: extracted.words.length };
	const latin = speechWords.filter(word => /[a-z]/i.test(word.text)).length;
	if (latin / speechWords.length < 0.6) return { applied: false, reason: "not-latin-script", words: speechWords.length };

	const cues = segmentASRWords(extracted.words, userOptions);
	timedTextBody.p = cues.map(cue => {
		const paragraph = {};
		for (const [key, value] of Object.entries(cue.template ?? {})) {
			if (key.startsWith("@") && !["@t", "@d", "@w", "@a"].includes(key)) paragraph[key] = value;
		}
		paragraph["@t"] = String(cue.start);
		paragraph["@d"] = String(Math.max(1, cue.end - cue.start));
		paragraph.s = { "#": cue.text };
		return paragraph;
	});
	delete timedTextBody.w;
	return {
		applied: true,
		reason: extracted.exactTiming ? "exact-word-timing" : "estimated-word-timing",
		input: extracted.paragraphs,
		visible: extracted.visible,
		words: speechWords.length,
		output: cues.length,
	};
}
