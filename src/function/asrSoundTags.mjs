/**
 * v41: sound-event tags inside YouTube automatic captions.
 *
 * Newer YouTube ASR (now punctuated) inserts non-speech tags *inside* sentences:
 *   "even [music] the simplest daily task becomes much more difficult"
 *   "the cow shed, [music], especially at night."
 *   ">> [Music] >>."            (">>" = speaker change marker)
 * Sent to Google these become "[音乐]" in the middle of the Chinese line, and
 * the token "music" also confuses the punctuation model.
 *
 * Rules:
 *   - every [ ... ] tag (any language: [Music] [Applause] [音楽] [음악] ...),
 *     (music)/(applause)-style tags, ♪ symbols and ">>" markers are removed
 *     from speech; punctuation that followed a tag is kept on the previous word.
 *   - a cue that contains nothing but tags becomes one clean event cue
 *     ("[Music]"), which is never sent to Google; its Chinese is fixed.
 */

// [anything short], or (known sound word), or ♪♫♬ runs
const BRACKET_TAG = /\[[^\[\]\n]{1,40}\]/gu;
const PAREN_TAG = /\(\s*(?:music|applause|laughter|laughs|cheering|cheers|silence|inaudible|foreign|speaking foreign language|singing|sighs|音楽|拍手|笑い|음악|박수|웃음)\s*\)/giu;
const NOTES = /[♪♫♬]+/gu;
const SPEAKER = /(?:>>|&gt;&gt;|»)/gu;
const ANY_TAG = new RegExp(`${BRACKET_TAG.source}|${PAREN_TAG.source}|${NOTES.source}|${SPEAKER.source}`, "giu");
const TRAILING_PUNCT = /^\s*([.,!?;:。、！？，]+)/u;

function canonicalTag(raw) {
	const inner = raw.replace(/^[\[(]\s*|\s*[\])]$/gu, "").trim();
	if (!inner || /^[♪♫♬>&gt;»]+$/u.test(raw)) return /[♪♫♬]/u.test(raw) ? "♪" : "";
	// [music] / [MUSIC] -> [Music]; non-Latin left as is
	const pretty = /^[a-z\s'-]+$/i.test(inner) ? inner.toLowerCase().replace(/^\p{L}/u, letter => letter.toUpperCase()) : inner;
	return `[${pretty}]`;
}

/**
 * @returns {{ text: string, tags: string[], orphanPunct: string }}
 *   text        : speech only (may be "")
 *   tags        : canonical tags found ("[Music]", "♪")
 *   orphanPunct : punctuation that followed a leading tag and has no word
 *                 before it inside this text (caller may attach it upstream)
 */
export function stripSoundTags(input) {
	const text = String(input ?? "");
	const tags = [];
	let out = "";
	let orphanPunct = "";
	let last = 0;
	ANY_TAG.lastIndex = 0;
	for (let match = ANY_TAG.exec(text); match; match = ANY_TAG.exec(text)) {
		out += text.slice(last, match.index);
		const tag = canonicalTag(match[0]);
		if (tag) tags.push(tag);
		last = match.index + match[0].length;
		const punct = text.slice(last).match(TRAILING_PUNCT);
		if (punct) {
			last += punct[0].length;
			const mark = /[.!?。！？]/u.test(punct[1]) ? punct[1].replace(/^[,，、]+/u, "") : punct[1].slice(0, 1);
			const before = out.trimEnd();
			if (/[\p{L}\p{N}'’)"”]$/u.test(before)) out = `${before}${mark}`;
			else if (!before && /[.!?。！？]/u.test(mark)) orphanPunct = mark;
		}
		out += " ";
	}
	out += text.slice(last);
	out = out
		.replace(/\s+/gu, " ")
		.replace(/\s+([.,!?;:。、！？，])/gu, "$1")
		.replace(/^[\s.,;:、，]+/u, "")
		.replace(/([.,!?;:])(?=[.,;:])/gu, "$1")
		.replace(/,([.!?])/gu, "$1")
		.trim();
	return { text: out, tags, orphanPunct };
}

export function hasSoundTag(text) {
	ANY_TAG.lastIndex = 0;
	return ANY_TAG.test(String(text ?? ""));
}

/** Text of a cue that only contained tags ("[Music]", or "♪"). */
export function eventCueText(tags) {
	return tags.find(tag => tag.startsWith("[")) ?? tags[0] ?? "";
}

const EVENT_ZH = new Map(
	Object.entries({
		music: "音乐", applause: "鼓掌", laughter: "笑声", laughs: "笑声", laughing: "笑声", cheering: "欢呼", cheers: "欢呼",
		silence: "静音", inaudible: "听不清", foreign: "外语", "foreign speech": "外语", "speaking foreign language": "外语",
		singing: "歌声", sighs: "叹气", "no audio": "无声", noise: "噪音", whistling: "口哨声", gunshot: "枪声", explosion: "爆炸声",
		音楽: "音乐", 拍手: "鼓掌", 笑い: "笑声", 음악: "音乐", 박수: "鼓掌", 웃음: "笑声",
	}),
);

/** Fixed Chinese for an event cue, never sent to Google. */
export function eventCueChinese(text) {
	if (/^[♪♫♬\s]+$/u.test(text)) return "";
	const inner = String(text).replace(/^\[|\]$/g, "").trim().toLowerCase();
	const zh = EVENT_ZH.get(inner);
	return zh ? `[${zh}]` : "";
}

/** True when a cue is only an event tag (after v41 cleaning). */
export function isEventCue(text) {
	const value = String(text ?? "").trim();
	return value !== "" && (/^\[[^\[\]]{1,40}\]$/u.test(value) || /^[♪♫♬\s]+$/u.test(value));
}
