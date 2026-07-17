const ZERO_WIDTH_SPACE = "\u200b";

/**
 * Keep enough rows for an original line plus its translation.
 * YouTube ASR srv3 responses normally declare rc=2. The generic DualSubs
 * handler used to force that value to 1, which can clip the second line on
 * the iOS player.
 */
export function ensureYouTubeTimedTextRows(body, minimumRows = 2) {
	const positions = body?.timedtext?.head?.wp;
	if (!positions) return;
	const list = Array.isArray(positions) ? positions : [positions];
	const position = list.find(item => item?.["@id"] === "1") ?? list[1];
	if (!position) return;
	const rows = Number.parseInt(position["@rc"] ?? "0", 10);
	position["@rc"] = String(Math.max(Number.isFinite(rows) ? rows : 0, minimumRows));
}

/**
 * Turn YouTube's rolling ASR window into independent cues.
 *
 * Automatic srv3 captions use a body-level <w> window plus @w/@a paragraph
 * attributes to retain and scroll earlier cues. Once every cue contains an
 * original and translated row, that behavior can leave the previous
 * translation above the current pair and produce three visible rows.
 * Official/creator-provided captions do not call this function.
 */
export function disableYouTubeASRRollingWindow(body) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return 0;
	delete timedTextBody.w;

	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	paragraphs.forEach(paragraph => {
		delete paragraph["@w"];
		delete paragraph["@a"];
	});
	return paragraphs.length;
}

/**
 * Split long automatic captions at natural reading boundaries and assign
 * adjacent, non-overlapping time slices to the resulting cues.
 *
 * East Asian characters count as two display units while Latin text counts
 * as one. This is closer to the space used by YouTube's landscape caption
 * renderer than a raw JavaScript string length.
 */
export function splitYouTubeASRLongParagraphs(body, maximumWidth = 40) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return { input: 0, output: 0, split: 0, shortened: 0 };

	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const output = [];
	let split = 0;
	let shortened = 0;

	paragraphs.forEach((paragraph, index) => {
		const parsed = readYouTubeTimedTextParagraph(paragraph);
		const start = parsePositiveInteger(paragraph?.["@t"], true);
		const nextStart = findNextParagraphStart(paragraphs, index + 1, start);
		const declaredDuration = parsePositiveInteger(paragraph?.["@d"]);
		const availableDuration = Number.isFinite(nextStart) && Number.isFinite(start) ? nextStart - start : undefined;
		let duration = declaredDuration;

		if (Number.isFinite(availableDuration) && availableDuration > 0) {
			if (!Number.isFinite(duration) || duration > availableDuration) {
				duration = availableDuration;
				if (Number.isFinite(declaredDuration) && declaredDuration > duration) shortened += 1;
			}
		}

		const parts = splitYouTubeCaptionText(parsed.text, maximumWidth);
		if (parts.length <= 1 || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
			if (Number.isFinite(duration) && duration > 0 && parsed.text !== ZERO_WIDTH_SPACE) paragraph["@d"] = String(duration);
			output.push(paragraph);
			return;
		}

		split += 1;
		const weights = parts.map(part => Math.max(1, measureYouTubeCaptionWidth(part)));
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		let consumedWeight = 0;

		parts.forEach((part, partIndex) => {
			const relativeStart = Math.round(duration * consumedWeight / totalWeight);
			consumedWeight += weights[partIndex];
			const relativeEnd = partIndex === parts.length - 1 ? duration : Math.round(duration * consumedWeight / totalWeight);
			const cue = { ...paragraph };
			cue["@t"] = String(start + relativeStart);
			cue["@d"] = String(Math.max(1, relativeEnd - relativeStart));
			delete cue["@w"];
			delete cue["@a"];
			if (parsed.segmented) {
				cue.s = { "#": part };
				delete cue["#"];
			} else {
				cue["#"] = part;
				delete cue.s;
			}
			output.push(cue);
		});
	});

	timedTextBody.p = output;
	return { input: paragraphs.length, output: output.length, split, shortened };
}

export function splitYouTubeCaptionText(text, maximumWidth = 40) {
	text = normalizeText(text).trim();
	if (!text || text === ZERO_WIDTH_SPACE || measureYouTubeCaptionWidth(text) <= maximumWidth) return text ? [text] : [];

	const characters = Array.from(text);
	const parts = [];
	let start = 0;
	while (start < characters.length) {
		let width = 0;
		let index = start;
		let naturalBreak = -1;
		while (index < characters.length) {
			const nextWidth = measureYouTubeCaptionWidth(characters[index]);
			if (width + nextWidth > maximumWidth && index > start) break;
			width += nextWidth;
			index += 1;
			if (isNaturalCaptionBreak(characters[index - 1])) naturalBreak = index;
		}

		if (index >= characters.length) {
			const remainder = characters.slice(start).join("").trim();
			if (remainder) parts.push(remainder);
			break;
		}

		let end = index;
		if (naturalBreak > start) {
			const naturalWidth = measureYouTubeCaptionWidth(characters.slice(start, naturalBreak).join(""));
			if (naturalWidth >= maximumWidth * 0.55) end = naturalBreak;
		}
		const part = characters.slice(start, end).join("").trim();
		if (part) parts.push(part);
		start = end;
		while (start < characters.length && /\s/u.test(characters[start])) start += 1;
	}
	return parts;
}

export function measureYouTubeCaptionWidth(text) {
	return Array.from(normalizeText(text)).reduce((width, character) => width + (isWideCharacter(character) ? 2 : 1), 0);
}

/**
 * Read one YouTube srv3 paragraph without changing its original structure.
 * Segment text is concatenated exactly as XML textContent would be; ASR
 * segments already carry their own leading spaces.
 */
export function readYouTubeTimedTextParagraph(paragraph) {
	if (paragraph?.s) {
		const segments = Array.isArray(paragraph.s) ? paragraph.s : [paragraph.s];
		return {
			segmented: true,
			text: segments.map(segment => segment?.["#"] ?? "").join("") || ZERO_WIDTH_SPACE,
		};
	}
	return {
		segmented: false,
		text: paragraph?.["#"] ?? ZERO_WIDTH_SPACE,
	};
}

/**
 * Write a bilingual paragraph while preserving a valid srv3 text node.
 * For ASR captions we keep a single <s> wrapper instead of deleting every
 * <s> node and placing mixed text directly under <p>. This remains compatible
 * with independent YouTube iOS ASR cues while intentionally dropping the
 * per-word karaoke offsets.
 */
export function writeYouTubeTimedTextParagraph(paragraph, originText, transText, options = {}) {
	const { segmented = false, showOnly = false, position = "Forward", lineBreak = "&#x000A;" } = options;
	originText = normalizeText(originText);
	transText = normalizeText(transText);
	if (!originText || originText === ZERO_WIDTH_SPACE) return false;

	const escapedOrigin = escapeXMLText(originText);
	const escapedTranslation = escapeXMLText(transText);
	let combined = escapedOrigin;
	if (escapedTranslation.trim()) {
		if (showOnly) combined = escapedTranslation;
		else combined = position === "Reverse" ? `${escapedTranslation}${lineBreak}${escapedOrigin}` : `${escapedOrigin}${lineBreak}${escapedTranslation}`;
	}

	if (segmented) {
		paragraph.s = { "#": combined };
		delete paragraph["#"];
	} else paragraph["#"] = combined;
	return true;
}

export function escapeXMLText(text) {
	return normalizeText(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function normalizeText(text) {
	if (Array.isArray(text)) return text.flat(Number.POSITIVE_INFINITY).join("");
	if (text === undefined || text === null) return "";
	return typeof text === "string" ? text : String(text);
}

function findNextParagraphStart(paragraphs, fromIndex, currentStart) {
	for (let index = fromIndex; index < paragraphs.length; index += 1) {
		const start = parsePositiveInteger(paragraphs[index]?.["@t"], true);
		if (Number.isFinite(start) && (!Number.isFinite(currentStart) || start > currentStart)) return start;
	}
	return undefined;
}

function parsePositiveInteger(value, allowZero = false) {
	const number = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) return undefined;
	return number;
}

function isNaturalCaptionBreak(character) {
	return /[\s,.!?;:，。！？；：、…\-—)\]】」』]/u.test(character);
}

function isWideCharacter(character) {
	const codePoint = character.codePointAt(0) ?? 0;
	return codePoint >= 0x1100 && (
		codePoint <= 0x115f ||
		codePoint === 0x2329 ||
		codePoint === 0x232a ||
		(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
		(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
		(codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
		(codePoint >= 0xff00 && codePoint <= 0xff60) ||
		(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
		(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
		(codePoint >= 0x20000 && codePoint <= 0x3fffd)
	);
}
