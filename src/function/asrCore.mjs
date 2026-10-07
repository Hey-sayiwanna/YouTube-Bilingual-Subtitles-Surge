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

export const ASR_SEGMENTER_VERSION = "39.0";

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

/** English token normalisation (same as tools/train.py -> norm()). */
export function normalizeASRToken(token) {
	let text = String(token ?? "").toLowerCase().replace(/[’‘]/g, "'");
	text = text.replace(/[^a-z0-9']/g, "").replace(/^'+|'+$/g, "");
	if (!text) return "";
	if (/[0-9]/.test(text)) return "<n>";
	return text;
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
export function estimateWordDuration(word) {
	return Math.min(900, 140 + 62 * Array.from(word).length);
}
export function splitWords(text) {
	// "- 54°" -> "-54°" so a lone minus sign is not a word
	return String(text).replace(/(^|\s)([-–+])\s+(?=\d)/g, "$1$2").match(/\S+/gu) ?? [];
}

/**
 * @returns {{words: object[], exactTiming: boolean, paragraphs: number}}
 * word = { text, start, end, event, template, paragraph }
 */
export function extractASRWords(body, profile = GENERIC_PROFILE) {
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
	let previousSpeechDisplayEnd;
	visible.forEach((item, index) => {
		const nextStart = visible[index + 1]?.start;
		const displayEnd = item.duration !== undefined ? item.start + item.duration : item.start + 3000;
		let end = displayEnd;
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
				const tokens = profile.tokenize(piece.text);
				tokens.forEach((token, tokenIndex) => {
					const span = Math.max(1, pieceEnd - pieceStart);
					local.push({ text: token, start: Math.round(pieceStart + (span * tokenIndex) / tokens.length) });
				});
			});
		} else {
			// No word offsets: spread the words over the time they would take to
			// say (not over the whole display duration, which often includes a
			// long silence after the line). The remainder becomes a real pause.
			const tokens = profile.tokenize(item.text);
			const weights = tokens.map(token => profile.estimateDuration(token));
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
		// the next paragraph. Drop such a duplicated prefix - but only when the
		// new paragraph starts while those words are still on screen, so that
		// a speaker really repeating himself ("let patients help, let
		// patients help") is never deleted.
		const previousSpeech = words.filter(word => !word.event).slice(-12);
		const previousWords = previousSpeech.map(word => profile.normalize(word.text));
		// Exact word offsets can distinguish spoken repetition from captions
		// whose display windows overlap after the preceding speech has ended.
		const startsInsidePrevious = previousSpeech.length > 0 && item.start < previousSpeechDisplayEnd
			&& (!exactTiming || item.start <= previousSpeech.at(-1).start);
		const currentWords = local.map(word => profile.normalize(word.text));
		let overlap = 0;
		for (let size = startsInsidePrevious ? Math.min(previousWords.length, currentWords.length - 1) : 0; size >= 3; size -= 1) {
			if (previousWords.slice(-size).join(" ") === currentWords.slice(0, size).join(" ") && currentWords.slice(0, size).join("").length >= 8) {
				overlap = size;
				break;
			}
		}
		local.slice(overlap).forEach((word, wordIndex, list) => {
			const nextWordStart = list[wordIndex + 1]?.start ?? (word.speakingEnd !== undefined ? Math.round(word.speakingEnd) : end);
			const wordEnd = exactTiming
				? Math.min(nextWordStart, word.start + profile.estimateDuration(word.text))
				: nextWordStart;
			words.push({ text: word.text, start: word.start, end: Math.max(word.start + 1, wordEnd), event: false, template: item.paragraph });
		});
		// Keep the original display end: word timing above is clipped to the
		// next paragraph and cannot establish whether two captions overlap.
		if (local.length > overlap) previousSpeechDisplayEnd = displayEnd;
	});

	words.sort((left, right) => left.start - right.start);
	return { words, exactTiming, paragraphs: paragraphs.length, visible: visible.length };
}

/* ------------------------------------------------------------------------ */
/* 2+3. Segmentation                                                         */
/* ------------------------------------------------------------------------ */

const ABBREVIATION_END = /^(?:mr|mrs|ms|dr|st|vs|etc)\.$/i;

export function hasStrongPunctuation(text) {
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
		const joinerWidth = options.joinerWidth ?? 1;
		let chars = -joinerWidth;
		let hardGaps = []; // indexes (inside segment) after which a hard gap occurs
		for (let end = start; end < n; end += 1) {
			chars += width[end] + joinerWidth;
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

/**
 * @returns cues [{ text, start, end, words, event, template }]
 */
export function segmentASRWords(words, userOptions = {}) {
	const profile = userOptions.profile ?? GENERIC_PROFILE;
	const options = { ...DEFAULT_ASR_SEGMENT_OPTIONS, ...profile.defaults, ...userOptions, profile };
	const speech = words.filter(word => !word.event);
	const probabilities = profile.score(speech, options);

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
	const finished = options.profile.finishCue(cueWords.map(word => word.text), probabilities, options);
	return {
		text: finished.text,
		start: cueWords[anchorFrom].start,
		end: cueWords[anchorTo].end,
		anchorStart: cueWords[anchorFrom].start,
		anchorEnd: cueWords[anchorTo].end,
		endsSentence: finished.endsSentence,
		words: cueWords,
		event: false,
		template: cueWords[0].template,
	};
}

function assignDisplayTiming(cues, options) {
	// Capitalise cues that start a sentence.
	let previousEndsSentence = true;
	for (const cue of cues) {
		if (cue.event) continue;
		if (options.addPunctuation && options.capitalize !== false && previousEndsSentence) cue.text = cue.text.replace(/^(\W*)(\p{Ll})/u, (_, prefix, letter) => prefix + letter.toUpperCase());
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
	const profiles = userOptions.profiles ?? {};
	const language = userOptions.language ?? detectASRLanguage(body, userOptions.languageHint, profiles);
	// A language without its own model uses the language-independent standard.
	const profile = profiles[language] ?? GENERIC_PROFILE;
	const extracted = extractASRWords(body, profile);
	const speechWords = extracted.words.filter(word => !word.event);
	if (speechWords.length < 2) return { applied: false, reason: "too-few-words", language, profile: profile.id, words: speechWords.length };
	if (profile.id === "en") {
		const latin = speechWords.filter(word => /[a-z]/i.test(word.text)).length;
		if (latin / speechWords.length < 0.6) return { applied: false, reason: "not-latin-script", language, profile: profile.id, words: speechWords.length };
	}

	const cues = segmentASRWords(extracted.words, { ...userOptions, profile });
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
		language,
		profile: profile.id,
		input: extracted.paragraphs,
		visible: extracted.visible,
		words: speechWords.length,
		output: cues.length,
	};
}

/* ------------------------------------------------------------------------ */
/* Language profiles                                                         */
/* ------------------------------------------------------------------------ */

/**
 * Pick the segmentation language. The URL `lang` parameter is authoritative
 * when present; otherwise the script of the caption text decides between the
 * languages that have a model in this bundle (`profiles`).
 */
export function detectASRLanguage(body, languageHint = "", profiles = {}) {
	const hint = String(languageHint ?? "").trim().toLowerCase().replaceAll("_", "-").split("-")[0];
	if (hint && !["und", "auto", "mul", "zxx"].includes(hint)) return hint;
	const sample = [].concat(body?.timedtext?.body?.p ?? []).slice(0, 80).map(paragraph => textOf(paragraph?.s ?? paragraph?.["#"] ?? "")).join(" ");
	const script = detectScriptLanguage(sample);
	if (script && profiles[script]) return script;
	return script ?? "unknown";
}

/** "ja" / "ko" / "en" (mostly Latin) / undefined, from the text itself. */
export function detectScriptLanguage(sample) {
	const text = String(sample ?? "");
	const kana = (text.match(/[\u3040-\u30ff]/gu) ?? []).length;
	const han = (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
	const hangul = (text.match(/[\uac00-\ud7a3]/gu) ?? []).length;
	const latin = (text.match(/[A-Za-z]/g) ?? []).length;
	const letters = (text.match(/\p{L}/gu) ?? []).length;
	if (!letters) return undefined;
	if (hangul / letters > 0.4) return "ko";
	if (kana >= 3 && (kana + han) / letters > 0.4) return "ja";
	if (latin / letters > 0.6) return "en";
	return undefined;
}

/* ------------------------------------------------------------------------ */
/* Generic standard for every language without its own model               */
/* ------------------------------------------------------------------------ */

const SENTENCE_END = /[.!?。！？؟۔।॥။።…]["'’”)\]」』»]*$/u;
const CLAUSE_END = /[,;:，、；：،؛]["'’”)\]」』»]*$/u;

const GLUE = "\u2060"; // marks a token written without a space before it
let wordSegmenter;
function segmentWithoutSpaces(text) {
	try {
		wordSegmenter ??= typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "word" }) : null;
	} catch {
		wordSegmenter = null;
	}
	if (wordSegmenter) return Array.from(wordSegmenter.segment(text), part => part.segment).filter(part => part.trim());
	return Array.from(text).filter(character => character.trim());
}

/**
 * Tokens: words separated by spaces. Scripts written without spaces (Thai,
 * Lao, Khmer, Myanmar, ...) are split with Intl.Segmenter when available.
 */
function tokenizeGeneric(text) {
	const tokens = splitWords(text);
	const out = [];
	for (const token of tokens) {
		if (widthOf(token) > 24 && /[\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token)) {
			// pieces after the first are glued to the previous one (no space) on output
			segmentWithoutSpaces(token).forEach((piece, index) => out.push(index ? GLUE + piece : piece));
		} else out.push(token);
	}
	return out;
}

/**
 * No language knowledge at all, only signals that exist in every language:
 *   1. punctuation, if the ASR track has it (newer YouTube ASR often does),
 *   2. pauses between words (speakers pause between sentences),
 *   3. balanced, readable cue lengths (dynamic programming as for English).
 */
function scoreGeneric(speech) {
	return speech.map((word, index) => {
		if (SENTENCE_END.test(word.text)) return { o: 0.02, comma: 0.01, period: 0.97 };
		if (CLAUSE_END.test(word.text)) return { o: 0.15, comma: 0.8, period: 0.05 };
		const next = speech[index + 1];
		const gap = next ? next.start - word.end : 0;
		// smooth pause -> boundary probability (300 ms ≈ weak, 900 ms+ ≈ strong)
		const period = gap <= 250 ? 0.04 : Math.min(0.75, 0.04 + (gap - 250) / 900);
		const comma = gap <= 150 ? 0.06 : Math.min(0.35, 0.06 + (gap - 150) / 1500);
		return { o: Math.max(0, 1 - period - comma), comma, period };
	});
}

function finishGenericCue(parts, probabilities, options) {
	let text = "";
	parts.forEach((part, index) => {
		if (part.startsWith(GLUE)) text += part.slice(GLUE.length);
		else text += (index ? " " : "") + part;
	});
	return { text, endsSentence: probabilities.at(-1).period >= options.periodThreshold || SENTENCE_END.test(parts.at(-1)) };
}

export const GENERIC_PROFILE = Object.freeze({
	id: "generic",
	tokenize: tokenizeGeneric,
	normalize: token => String(token).replace(GLUE, "").normalize("NFKC").toLowerCase(),
	estimateDuration: token => Math.min(900, 120 + 60 * Array.from(token).length),
	score: scoreGeneric,
	finishCue: finishGenericCue,
	defaults: {
		joinerWidth: 1,
		capitalize: false,
		addPunctuation: false, // never invent punctuation in an unknown language
		softChars: 52,
		hardChars: 76,
		minChars: 12,
		softDuration: 5500,
		hardDuration: 7500,
		// without a language model a skipped boundary is cheap and every cue
		// costs a little more, so pauses and length decide.
		keepFrom: 0.3,
		keepScale: 10,
	},
});
