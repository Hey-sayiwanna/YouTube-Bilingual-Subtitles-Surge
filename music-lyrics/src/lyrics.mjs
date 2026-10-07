/**
 * Where YouTube Music keeps lyrics in a `youtubei/v1/browse` (browseId MPLYt_…)
 * response, iOS protobuf:
 *
 *   static lyrics  … 221496734 musicDescriptionShelfRenderer
 *                        3 description → 1 runs[] → 1 text   ("line\nline\n…")
 *   timed lyrics   … 465160965 timedLyricsRender
 *                        4 timedLyricsContent → 1 runs[] → 1 text (one line)
 *                                                          2 { start ms, end ms, id }
 *
 * The two anchor field numbers are searched anywhere in the tree, so new
 * wrapper layers do not break us. If neither anchor exists we fall back to a
 * structural signature of timed lyrics (a list of {text, {start, end}}).
 * The same numbers are used by DualSubs and by the Maasea YouTube module.
 */
import { parseMessage, rebuildMessage, fieldValue, utf8Decode, utf8Encode } from "./protobuf.mjs";

export const FIELD_MUSIC_DESCRIPTION_SHELF = 221496734;
export const FIELD_TIMED_LYRICS = 465160965;
const MAX_DEPTH = 64;

/* ------------------------------------------------------------------------ */
/* protobuf walking                                                          */
/* ------------------------------------------------------------------------ */

/**
 * Walk the message. `onText(kind, text)` is called for every lyrics string
 * and may return a replacement string (or undefined to keep it).
 * Returns { bytes, found } where bytes is the (possibly) rewritten message.
 */
export function rewriteProtobufLyrics(bytes, onText, { heuristic = false } = {}) {
	const state = { found: 0 };
	const out = visit(bytes, 0, state, onText, heuristic) ?? bytes;
	return { bytes: out, found: state.found };
}

function visit(bytes, depth, state, onText, heuristic) {
	if (depth > MAX_DEPTH || bytes.length < 2) return null;
	const fields = parseMessage(bytes);
	if (!fields || !fields.length) return null;
	const replacements = new Map();

	if (heuristic && looksLikeTimedLines(bytes, fields)) {
		state.found += 1;
		fields.forEach((field, index) => {
			if (field.no !== 1 || field.wire !== 2) return;
			const next = rewriteLine(fieldValue(bytes, field), "timed", onText);
			if (next) replacements.set(index, next);
		});
		return replacements.size ? rebuildMessage(bytes, fields, replacements) : null;
	}

	fields.forEach((field, index) => {
		if (field.wire !== 2) return;
		const value = fieldValue(bytes, field);
		let next = null;
		if (field.no === FIELD_MUSIC_DESCRIPTION_SHELF) {
			state.found += 1;
			next = editPath(value, [3, 1], runBytes => rewriteLine(runBytes, "static", onText));
		} else if (field.no === FIELD_TIMED_LYRICS) {
			state.found += 1;
			next = editPath(value, [4], content => editRepeated(content, 1, line => rewriteLine(line, "timed", onText)));
		} else {
			next = visit(value, depth + 1, state, onText, heuristic);
		}
		if (next && next !== value) replacements.set(index, next);
	});
	return replacements.size ? rebuildMessage(bytes, fields, replacements) : null;
}

/** Follow single fields along `path`, then apply `edit` to every match of the last step. */
function editPath(bytes, path, edit) {
	if (!path.length) return edit(bytes);
	const fields = parseMessage(bytes);
	if (!fields) return null;
	const [head, ...rest] = path;
	const replacements = new Map();
	fields.forEach((field, index) => {
		if (field.no !== head || field.wire !== 2) return;
		const next = editPath(fieldValue(bytes, field), rest, edit);
		if (next) replacements.set(index, next);
	});
	return replacements.size ? rebuildMessage(bytes, fields, replacements) : null;
}

function editRepeated(bytes, fieldNo, edit) {
	return editPath(bytes, [fieldNo], edit);
}

/** A run / line message: its field 1 is the text. */
function rewriteLine(bytes, kind, onText) {
	const fields = parseMessage(bytes);
	if (!fields) return null;
	const replacements = new Map();
	fields.forEach((field, index) => {
		if (field.no !== 1 || field.wire !== 2) return;
		const text = utf8Decode(fieldValue(bytes, field));
		if (text === null) return;
		const next = onText(kind, text);
		if (typeof next === "string" && next !== text) replacements.set(index, utf8Encode(next));
	});
	return replacements.size ? rebuildMessage(bytes, fields, replacements) : null;
}

/** Fallback signature: ≥3 repeated field-1 children shaped {1: text, 2: {1: start, 2: end}}. */
function looksLikeTimedLines(bytes, fields) {
	const lines = fields.filter(field => field.no === 1 && field.wire === 2);
	if (lines.length < 3 || lines.length < fields.length * 0.6) return false;
	let good = 0;
	for (const field of lines) {
		const inner = parseMessage(bytes, field.valueStart, field.valueEnd);
		if (!inner) return false;
		const text = inner.find(f => f.no === 1 && f.wire === 2);
		const timing = inner.find(f => f.no === 2 && f.wire === 2);
		if (!text || !timing) continue;
		const decoded = utf8Decode(bytes.subarray(text.valueStart, text.valueEnd));
		const times = parseMessage(bytes, timing.valueStart, timing.valueEnd);
		const start = times?.find(f => f.no === 1 && f.wire === 0)?.value;
		const end = times?.find(f => f.no === 2 && f.wire === 0)?.value;
		if (decoded !== null && Number.isFinite(start) && Number.isFinite(end) && end >= start) good += 1;
	}
	return good >= 3 && good >= lines.length * 0.8;
}

/** Compact field tree for the log when nothing was found (to adapt quickly). */
export function describeProtobuf(bytes, depth = 0, limit = { lines: 0 }) {
	const fields = parseMessage(bytes);
	if (!fields || depth > 8) return "";
	let out = "";
	for (const field of fields) {
		if (limit.lines++ > 120) return out;
		const pad = "  ".repeat(depth);
		if (field.wire !== 2) { out += `${pad}${field.no}\n`; continue; }
		const value = fieldValue(bytes, field);
		const child = value.length > 1 ? describeProtobuf(value, depth + 1, limit) : "";
		if (child) out += `${pad}${field.no} {\n${child}${pad}}\n`;
		else {
			const text = utf8Decode(value);
			out += `${pad}${field.no}: ${text !== null ? JSON.stringify(text.slice(0, 24)) : `<${value.length} bytes>`}\n`;
		}
	}
	return out;
}

/* ------------------------------------------------------------------------ */
/* JSON (music.youtube.com web)                                              */
/* ------------------------------------------------------------------------ */

export function rewriteJsonLyrics(root, onText) {
	let found = 0;
	const walk = node => {
		if (!node || typeof node !== "object") return;
		if (Array.isArray(node)) return node.forEach(walk);
		for (const [key, value] of Object.entries(node)) {
			if (key === "musicDescriptionShelfRenderer" && value?.description?.runs) {
				found += 1;
				for (const run of value.description.runs) {
					if (typeof run?.text !== "string") continue;
					const next = onText("static", run.text);
					if (typeof next === "string") run.text = next;
				}
			} else if (key === "timedLyricsContent" && Array.isArray(value?.runs)) {
				found += 1;
				for (const run of value.runs) {
					if (typeof run?.text !== "string") continue;
					const next = onText("timed", run.text);
					if (typeof next === "string") run.text = next;
				}
			} else walk(value);
		}
	};
	walk(root);
	return found;
}

/* ------------------------------------------------------------------------ */
/* language policy                                                           */
/* ------------------------------------------------------------------------ */

const count = (text, regex) => (String(text).match(regex) ?? []).length;
const HAN = /\p{Script=Han}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HANGUL = /\p{Script=Hangul}/gu;
const LETTER = /\p{L}/gu;

export function isChineseLine(line) {
	const letters = count(line, LETTER);
	if (!letters) return false;
	const han = count(line, HAN);
	return han > 0 && count(line, KANA) === 0 && count(line, HANGUL) === 0 && han / letters >= 0.5;
}

export function hasLetters(line) {
	return count(line, LETTER) > 0;
}

/**
 * Song-level decision.
 *  - Chinese song (most lyric lines are Chinese, simplified or traditional): skip all.
 *  - Japanese song (kana in ≥20 % of lines): translate every line, even kanji-only ones.
 *  - Otherwise translate every line that is not Chinese.
 */
export function analyseSong(lines) {
	const lyricLines = lines.filter(hasLetters);
	if (!lyricLines.length) return { chinese: false, japanese: false, lyricLines: 0 };
	const chinese = lyricLines.filter(isChineseLine).length;
	const kana = lyricLines.filter(line => count(line, KANA) > 0).length;
	const japanese = kana / lyricLines.length >= 0.2;
	return {
		chinese: !japanese && chinese / lyricLines.length >= 0.5,
		japanese,
		lyricLines: lyricLines.length,
	};
}

export function shouldTranslateLine(line, song) {
	if (!hasLetters(line)) return false; // blank, ♪, symbols
	if (song.chinese) return false;
	if (!song.japanese && isChineseLine(line)) return false;
	return true;
}

export function combine(original, translation, position = "Forward") {
	const trans = String(translation ?? "").trim();
	if (!trans) return original;
	const plain = text => text.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");
	if (plain(trans) === plain(original)) return original; // names, "oh oh", already Chinese
	if (position === "ShowOnly") return trans;
	return position === "Reverse" ? `${trans}\n${original}` : `${original}\n${trans}`;
}
