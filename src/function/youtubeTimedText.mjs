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
 * with YouTube iOS rolling-caption windows while intentionally dropping the
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
