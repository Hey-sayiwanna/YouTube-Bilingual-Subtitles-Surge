const ZERO_WIDTH_SPACE = "\u200b";
const CHINESE_LANGUAGE_CODES = new Set(["zh", "cmn", "yue", "wuu", "nan", "hak", "gan", "hsn", "cdo"]);
const UNKNOWN_LANGUAGE_CODES = new Set(["", "und", "auto", "mul", "zxx"]);

/**
 * Detect a Chinese source track without looking at `tlang`.
 *
 * YouTube uses `tlang=zh-*` for the requested translation target, so only the
 * source `lang` and track name are authoritative. Text inspection is a
 * conservative fallback for tracks whose source language is missing/unknown.
 */
export function detectYouTubeChineseCaption(requestURL, body) {
	let url;
	try {
		url = requestURL instanceof URL ? requestURL : new URL(requestURL);
	} catch {
		return { detected: false, reason: "invalid-url" };
	}

	const language = (url.searchParams.get("lang") ?? "").trim();
	const normalizedLanguage = language.replaceAll("_", "-").toLowerCase();
	const primaryLanguage = normalizedLanguage.split("-")[0];
	if (CHINESE_LANGUAGE_CODES.has(primaryLanguage)) {
		return { detected: true, reason: `language:${language || primaryLanguage}` };
	}
	if (!UNKNOWN_LANGUAGE_CODES.has(primaryLanguage)) {
		return { detected: false, reason: `language:${language}` };
	}

	const trackName = (url.searchParams.get("name") ?? "").normalize("NFKC");
	if (/(?:中文|简体|簡體|繁体|繁體|汉语|漢語|粤语|粵語|chinese|mandarin|cantonese)/iu.test(trackName)) {
		return { detected: true, reason: "track-name" };
	}

	const timedTextBody = body?.timedtext?.body;
	let paragraphs = timedTextBody?.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const sample = paragraphs
		.map(paragraph => readYouTubeTimedTextParagraph(paragraph).text)
		.filter(text => text && text !== ZERO_WIDTH_SPACE)
		.slice(0, 40)
		.join("")
		.slice(0, 2000);
	const characters = Array.from(sample);
	const han = characters.filter(character => /\p{Script=Han}/u.test(character)).length;
	const kana = characters.filter(character => /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)).length;
	const hangul = characters.filter(character => /\p{Script=Hangul}/u.test(character)).length;
	const latin = characters.filter(character => /\p{Script=Latin}/u.test(character)).length;
	const letters = han + kana + hangul + latin;
	const detected = han >= 8 && kana <= 1 && hangul <= 1 && han / Math.max(letters, 1) >= 0.4;
	return { detected, reason: detected ? "content" : "unknown" };
}

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
	return disableYouTubeRollingWindow(body);
}

/**
 * Broadcast CC/DTVCC tracks can use the same roll-up window instructions as
 * automatic captions. Keep this entry point separate so ordinary official
 * captions never enter the broadcast normalization path by accident.
 */
export function disableYouTubeBroadcastRollingWindow(body) {
	return disableYouTubeRollingWindow(body);
}

/**
 * End an overlong broadcast cue at the next roll-up event. This only shortens
 * proven overlaps; it never extends a cue or changes non-overlapping timing.
 */
export function shortenYouTubeBroadcastOverlaps(body) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return 0;
	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	let shortened = 0;
	paragraphs.forEach((paragraph, index) => {
		const text = readYouTubeTimedTextParagraph(paragraph).text;
		if (!text || text === ZERO_WIDTH_SPACE) return;
		const start = parsePositiveInteger(paragraph?.["@t"], true);
		const duration = parsePositiveInteger(paragraph?.["@d"]);
		const nextStart = findNextParagraphStart(paragraphs, index + 1, start);
		const availableDuration = Number.isFinite(start) && Number.isFinite(nextStart) ? nextStart - start : undefined;
		if (Number.isFinite(duration) && Number.isFinite(availableDuration) && availableDuration > 0 && duration > availableDuration) {
			paragraph["@d"] = String(availableDuration);
			shortened += 1;
		}
	});
	return shortened;
}

/**
 * Join only adjacent, short fragments from ordinary official captions.
 *
 * Some creator-provided tracks split one sentence into several back-to-back
 * srv3 paragraphs. Preserve punctuation, layout changes, speaker changes and
 * real timing gaps as hard boundaries. Automatic and broadcast captions use
 * separate entry points and never call this function.
 */
export function mergeYouTubeOfficialSentenceFragments(body, maximumWidth = 52, maximumGap = 350) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return { input: 0, output: 0, merged: 0 };

	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const output = [];
	let merged = 0;

	for (const paragraph of paragraphs) {
		const previous = output.at(-1);
		if (!previous || !canMergeOfficialParagraphs(previous, paragraph, maximumWidth, maximumGap)) {
			output.push(paragraph);
			continue;
		}

		const previousText = readYouTubeTimedTextParagraph(previous);
		const currentText = readYouTubeTimedTextParagraph(paragraph);
		const combinedText = joinYouTubeCaptionFragments(previousText.text, currentText.text);
		const previousStart = parsePositiveInteger(previous["@t"], true);
		const previousDuration = parsePositiveInteger(previous["@d"]);
		const currentStart = parsePositiveInteger(paragraph?.["@t"], true);
		const currentDuration = parsePositiveInteger(paragraph?.["@d"]);
		const combinedEnd = Math.max(previousStart + previousDuration, currentStart + currentDuration);

		previous["@d"] = String(combinedEnd - previousStart);
		setYouTubeTimedTextParagraphText(previous, combinedText, previousText.segmented || currentText.segmented);
		merged += 1;
	}

	timedTextBody.p = output;
	return { input: paragraphs.length, output: output.length, merged };
}

function disableYouTubeRollingWindow(body) {
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
export function splitYouTubeOfficialLongParagraphs(body, minimumWidth = 70) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return { input: 0, output: 0, split: 0 };

	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const output = [];
	let split = 0;

	for (const paragraph of paragraphs) {
		const parsed = readYouTubeTimedTextParagraph(paragraph);
		const start = parsePositiveInteger(paragraph?.["@t"], true);
		const duration = parsePositiveInteger(paragraph?.["@d"]);
		const parts = splitOfficialCaptionAtStrongSentenceBoundary(parsed.text, minimumWidth);
		if (parts.length <= 1 || !Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) {
			output.push(paragraph);
			continue;
		}

		split += 1;
		const weights = parts.map(part => Math.max(1, measureYouTubeCaptionWidth(part)));
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		let consumedWeight = 0;
		parts.forEach((part, index) => {
			const relativeStart = Math.round(duration * consumedWeight / totalWeight);
			consumedWeight += weights[index];
			const relativeEnd = index === parts.length - 1 ? duration : Math.round(duration * consumedWeight / totalWeight);
			const cue = { ...paragraph, "@t": String(start + relativeStart), "@d": String(Math.max(1, relativeEnd - relativeStart)) };
			setYouTubeTimedTextParagraphText(cue, part, parsed.segmented);
			output.push(cue);
		});
	}

	timedTextBody.p = output;
	return { input: paragraphs.length, output: output.length, split };
}

function splitOfficialCaptionAtStrongSentenceBoundary(text, minimumWidth) {
	text = normalizeText(text).trim();
	if (!text || text === ZERO_WIDTH_SPACE || measureYouTubeCaptionWidth(text) <= minimumWidth) return text ? [text] : [];

	const candidates = [];
	const pattern = /[.!?。！？…]+[\s"'’”)]*/gu;
	for (const match of text.matchAll(pattern)) {
		const end = (match.index ?? 0) + match[0].length;
		if (end <= 0 || end >= text.length) continue;
		const left = text.slice(0, end).trim();
		const right = text.slice(end).trim();
		if (!left || !right) continue;
		const leftWidth = measureYouTubeCaptionWidth(left);
		const rightWidth = measureYouTubeCaptionWidth(right);
		if (leftWidth < 18 || rightWidth < 18) continue;
		candidates.push({ end, balance: Math.abs(leftWidth - rightWidth) });
	}
	if (!candidates.length) return [text];
	candidates.sort((a, b) => a.balance - b.balance);
	const end = candidates[0].end;
	return [text.slice(0, end).trim(), text.slice(end).trim()];
}


/**
 * Rebuild automatic-caption cues from YouTube srv3 segment timing.
 *
 * ASR <p> blocks are timing/display windows rather than reliable sentences.
 * When enough <s t="..."> offsets are available, flatten adjacent segments
 * into one timed stream and choose cue boundaries from punctuation, pauses
 * and display width. No language-specific subject/pronoun word list is used.
 *
 * If segment timing is missing or sparse, leave the body untouched so the
 * conservative v29 paragraph path can be used as a fallback.
 */
export function resegmentYouTubeASRBySegmentTiming(body, options = {}) {
	const {
		softWidth = 44,
		hardWidth = 64,
		minimumWidth = 22,
		pauseThreshold = 650,
		strongPauseThreshold = 950,
		maximumDuration = 6500,
		minimumTimedSegments = 6,
		minimumTimingCoverage = 0.6,
	} = options;
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return { applied: false, reason: "no-body", input: 0, output: 0, segments: 0, timedSegments: 0, boundaries: 0 };

	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const stream = [];
	let segmentCount = 0;
	let timedSegmentCount = 0;
	let originalEnd = 0;

	for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
		const paragraph = paragraphs[paragraphIndex];
		const paragraphStart = parsePositiveInteger(paragraph?.["@t"], true);
		const paragraphDuration = parsePositiveInteger(paragraph?.["@d"]);
		if (Number.isFinite(paragraphStart) && Number.isFinite(paragraphDuration)) {
			originalEnd = Math.max(originalEnd, paragraphStart + paragraphDuration);
		}
		if (!Number.isFinite(paragraphStart) || !paragraph?.s) continue;
		const segments = Array.isArray(paragraph.s) ? paragraph.s : [paragraph.s];
		for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
			const segment = segments[segmentIndex];
			const text = normalizeText(segment?.["#"] ?? "");
			if (!text || text === ZERO_WIDTH_SPACE) continue;
			segmentCount += 1;
			const rawOffset = segment?.["@t"];
			const offset = rawOffset === undefined && segmentIndex === 0 ? 0 : parsePositiveInteger(rawOffset, true);
			if (!Number.isFinite(offset)) continue;
			timedSegmentCount += 1;
			stream.push({
				start: paragraphStart + offset,
				text,
				paragraph,
				paragraphIndex,
			});
		}
	}

	const coverage = segmentCount ? timedSegmentCount / segmentCount : 0;
	if (timedSegmentCount < minimumTimedSegments || coverage < minimumTimingCoverage || stream.length < 2) {
		return {
			applied: false,
			reason: "insufficient-segment-timing",
			input: paragraphs.length,
			output: paragraphs.length,
			segments: segmentCount,
			timedSegments: timedSegmentCount,
			coverage,
			boundaries: 0,
		};
	}

	stream.sort((left, right) => left.start - right.start || left.paragraphIndex - right.paragraphIndex);
	const deduplicated = [];
	for (const item of stream) {
		const previous = deduplicated.at(-1);
		if (previous && item.start === previous.start && normalizeText(item.text).trim() === normalizeText(previous.text).trim()) continue;
		deduplicated.push(item);
	}
	if (deduplicated.length < 2) {
		return { applied: false, reason: "insufficient-unique-segments", input: paragraphs.length, output: paragraphs.length, segments: segmentCount, timedSegments: timedSegmentCount, coverage, boundaries: 0 };
	}

	const groups = [];
	let groupStart = 0;
	while (groupStart < deduplicated.length) {
		let combined = "";
		let best;
		let forcedEnd = deduplicated.length - 1;

		for (let index = groupStart; index < deduplicated.length; index += 1) {
			combined = joinYouTubeCaptionFragments(combined, deduplicated[index].text);
			const width = measureYouTubeCaptionWidth(combined.trim());
			const next = deduplicated[index + 1];
			if (!next) {
				forcedEnd = index;
				best = { end: index, score: Number.POSITIVE_INFINITY };
				break;
			}

			const duration = next.start - deduplicated[groupStart].start;
			const step = Math.max(0, next.start - deduplicated[index].start);
			const trimmed = combined.trim();
			const strongPunctuation = /[.!?。！？…]["'’”)]*$/u.test(trimmed);
			const weakPunctuation = /[,;:，；：]["'’”)]*$/u.test(trimmed);
			const readableWidth = width >= minimumWidth;
			let score = -Math.abs(width - softWidth);
			if (strongPunctuation) score += 120;
			else if (weakPunctuation) score += 35;
			if (step >= strongPauseThreshold) score += 95;
			else if (step >= pauseThreshold) score += 65;
			else if (step >= 450) score += 25;
			if (width >= softWidth * 0.75 && width <= softWidth * 1.25) score += 18;
			if (duration >= 1800 && duration <= 5200) score += 10;

			const meaningfulBoundary =
				(strongPunctuation && width >= 12) ||
				(readableWidth && (step >= pauseThreshold || weakPunctuation || width >= softWidth * 0.72));
			if (meaningfulBoundary && (!best || score > best.score)) best = { end: index, score };

			const mustBreak = width >= hardWidth || duration >= maximumDuration;
			if (mustBreak) {
				forcedEnd = index;
				break;
			}
			forcedEnd = index;
		}

		const groupEnd = best?.end ?? forcedEnd;
		const items = deduplicated.slice(groupStart, groupEnd + 1);
		let text = "";
		for (const item of items) text = joinYouTubeCaptionFragments(text, item.text);
		groups.push({
			start: items[0].start,
			text: text.trim(),
			template: items[0].paragraph,
		});
		groupStart = groupEnd + 1;
	}

	if (!groups.length) {
		return { applied: false, reason: "no-groups", input: paragraphs.length, output: paragraphs.length, segments: segmentCount, timedSegments: timedSegmentCount, coverage, boundaries: 0 };
	}

	const output = groups.map((group, index) => {
		const cue = { ...group.template };
		const nextStart = groups[index + 1]?.start;
		const fallbackEnd = originalEnd > group.start ? originalEnd : group.start + 2500;
		const end = Number.isFinite(nextStart) && nextStart > group.start ? nextStart : fallbackEnd;
		cue["@t"] = String(group.start);
		cue["@d"] = String(Math.max(1, end - group.start));
		delete cue["@w"];
		delete cue["@a"];
		delete cue["#"];
		cue.s = { "#": group.text };
		return cue;
	});

	timedTextBody.p = output;
	return {
		applied: true,
		reason: "segment-timing",
		input: paragraphs.length,
		output: output.length,
		segments: segmentCount,
		timedSegments: timedSegmentCount,
		coverage,
		boundaries: Math.max(0, output.length - 1),
	};
}

export function rebalanceYouTubeASRSentenceBoundaries(body, maximumGap = 450) {
	const timedTextBody = body?.timedtext?.body;
	if (!timedTextBody) return { movedTail: 0, movedHead: 0 };

	let paragraphs = timedTextBody.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	let movedTail = 0;
	let movedHead = 0;

	for (let index = 0; index < paragraphs.length - 1; index += 1) {
		const current = paragraphs[index];
		const next = paragraphs[index + 1];
		const currentParsed = readYouTubeTimedTextParagraph(current);
		const nextParsed = readYouTubeTimedTextParagraph(next);
		let currentText = normalizeText(currentParsed.text).trim();
		let nextText = normalizeText(nextParsed.text).trim();
		if (!currentText || !nextText || currentText === ZERO_WIDTH_SPACE || nextText === ZERO_WIDTH_SPACE) continue;

		const currentStart = parsePositiveInteger(current?.["@t"], true);
		const currentDuration = parsePositiveInteger(current?.["@d"]);
		const nextStart = parsePositiveInteger(next?.["@t"], true);
		const currentEnd = Number.isFinite(currentStart) && Number.isFinite(currentDuration) ? currentStart + currentDuration : undefined;
		const gap = Number.isFinite(currentEnd) && Number.isFinite(nextStart) ? nextStart - currentEnd : 0;
		if (Number.isFinite(gap) && Math.abs(gap) > maximumGap) continue;

		const trailing = currentText.match(/^(.*?[.!?。！？…]+)[\\s]+([^.!?。！？…]+)$/u);
		if (trailing) {
			const tail = trailing[2].trim();
			if (countCaptionWords(tail) <= 2 && measureYouTubeCaptionWidth(tail) <= 14 && !/[,:;，；：]$/u.test(tail)) {
				currentText = trailing[1].trim();
				nextText = joinYouTubeCaptionFragments(tail, nextText);
				setYouTubeTimedTextParagraphText(current, currentText, currentParsed.segmented);
				setYouTubeTimedTextParagraphText(next, nextText, nextParsed.segmented);
				movedHead += 1;
				continue;
			}
		}

		if (!/[.!?。！？…]["'’”)]*$/u.test(currentText)) {
			const leading = nextText.match(/^(.{1,24}?[.!?。！？…]+)(?:\\s+|$)(.*)$/u);
			if (leading) {
				const head = leading[1].trim();
				const rest = leading[2].trim();
				if (rest && countCaptionWords(head) <= 2 && measureYouTubeCaptionWidth(head) <= 18 && measureYouTubeCaptionWidth(currentText) + 1 + measureYouTubeCaptionWidth(head) <= 56) {
					currentText = joinYouTubeCaptionFragments(currentText, head);
					nextText = rest;
					setYouTubeTimedTextParagraphText(current, currentText, currentParsed.segmented);
					setYouTubeTimedTextParagraphText(next, nextText, nextParsed.segmented);
					movedTail += 1;
				}
			}
		}
	}

	return { movedTail, movedHead };
}

function countCaptionWords(text) {
	const words = normalizeText(text).trim().match(/[\\p{L}\\p{N}]+(?:['’][\\p{L}\\p{N}]+)*/gu);
	return words?.length ?? 0;
}

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

export function splitYouTubeCaptionText(text, softWidth = 40, comfortableWidth = 56, hardWidth = 64) {
	text = normalizeText(text).trim();
	if (!text || text === ZERO_WIDTH_SPACE || measureYouTubeCaptionWidth(text) <= comfortableWidth) return text ? [text] : [];

	const parts = [];
	let remaining = text;
	while (measureYouTubeCaptionWidth(remaining) > comfortableWidth) {
		const remainingWidth = measureYouTubeCaptionWidth(remaining);
		const semanticEnd = chooseSemanticCaptionBreak(remaining, softWidth, comfortableWidth);
		if (semanticEnd) {
			const part = remaining.slice(0, semanticEnd).trim();
			if (part) parts.push(part);
			remaining = remaining.slice(semanticEnd).trim();
			continue;
		}
		if (remainingWidth <= hardWidth) break;
		const fallbackEnd = chooseFallbackCaptionBreak(remaining, softWidth, hardWidth);
		if (!fallbackEnd || fallbackEnd >= remaining.length) break;
		const part = remaining.slice(0, fallbackEnd).trim();
		if (part) parts.push(part);
		remaining = remaining.slice(fallbackEnd).trim();
	}
	if (remaining) parts.push(remaining);
	return parts;
}

function chooseSemanticCaptionBreak(text, softWidth, comfortableWidth) {
	const candidates = [];
	for (const match of text.matchAll(/[.!?。！？…]+["'’”)]*\\s*/gu)) {
		const end = (match.index ?? 0) + match[0].length;
		const width = measureYouTubeCaptionWidth(text.slice(0, end));
		const restWidth = measureYouTubeCaptionWidth(text.slice(end).trim());
		if (width >= softWidth * 0.55 && width <= comfortableWidth && restWidth >= 12) candidates.push({ end, width, rank: 0 });
	}
	for (const match of text.matchAll(/[,;:，；：]+\\s*/gu)) {
		const end = (match.index ?? 0) + match[0].length;
		const width = measureYouTubeCaptionWidth(text.slice(0, end));
		const restWidth = measureYouTubeCaptionWidth(text.slice(end).trim());
		if (width >= softWidth * 0.75 && width <= comfortableWidth && restWidth >= 16) candidates.push({ end, width, rank: 1 });
	}
	if (!candidates.length) return 0;
	candidates.sort((a, b) => a.rank - b.rank || Math.abs(a.width - softWidth) - Math.abs(b.width - softWidth));
	return candidates[0].end;
}

function chooseFallbackCaptionBreak(text, softWidth, hardWidth) {
	const candidates = [];
	for (const match of text.matchAll(/\\s+/gu)) {
		const end = (match.index ?? 0) + match[0].length;
		const width = measureYouTubeCaptionWidth(text.slice(0, end));
		if (width >= softWidth && width <= hardWidth) candidates.push({ end, width });
	}
	if (candidates.length) {
		candidates.sort((a, b) => Math.abs(a.width - hardWidth * 0.82) - Math.abs(b.width - hardWidth * 0.82));
		return candidates[0].end;
	}
	return findHardCaptionBreak(text, hardWidth);
}

function findHardCaptionBreak(text, hardWidth) {
	const characters = Array.from(text);
	let width = 0;
	let end = 0;
	for (let index = 0; index < characters.length; index += 1) {
		const nextWidth = measureYouTubeCaptionWidth(characters[index]);
		if (width + nextWidth > hardWidth && index > 0) break;
		width += nextWidth;
		end = index + 1;
	}
	return end;
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

function canMergeOfficialParagraphs(previous, current, maximumWidth, maximumGap) {
	const previousText = readYouTubeTimedTextParagraph(previous).text;
	const currentText = readYouTubeTimedTextParagraph(current).text;
	if (!isVisibleYouTubeCaption(previousText) || !isVisibleYouTubeCaption(currentText)) return false;
	if (endsYouTubeCaptionSentence(previousText) || startsNewYouTubeCaptionSpeaker(currentText)) return false;
	if (youtubeParagraphLayoutSignature(previous) !== youtubeParagraphLayoutSignature(current)) return false;

	const previousStart = parsePositiveInteger(previous?.["@t"], true);
	const previousDuration = parsePositiveInteger(previous?.["@d"]);
	const currentStart = parsePositiveInteger(current?.["@t"], true);
	const currentDuration = parsePositiveInteger(current?.["@d"]);
	if (![previousStart, previousDuration, currentStart, currentDuration].every(Number.isFinite)) return false;

	const gap = currentStart - (previousStart + previousDuration);
	if (gap < -100 || gap > maximumGap) return false;
	return measureYouTubeCaptionWidth(joinYouTubeCaptionFragments(previousText, currentText)) <= maximumWidth;
}

function isVisibleYouTubeCaption(text) {
	return Boolean(normalizeText(text).trim()) && text !== ZERO_WIDTH_SPACE;
}

function endsYouTubeCaptionSentence(text) {
	return /[.!?。！？…][\s"'’”)\]】」』]*$/u.test(normalizeText(text));
}

function startsNewYouTubeCaptionSpeaker(text) {
	return /^\s*(?:>{2,}|[-–—]\s+|\[[^\]]{1,40}\]\s*)/u.test(normalizeText(text));
}

function youtubeParagraphLayoutSignature(paragraph) {
	return Object.entries(paragraph ?? {})
		.filter(([key]) => key.startsWith("@") && key !== "@t" && key !== "@d")
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
}

function joinYouTubeCaptionFragments(previousText, currentText) {
	previousText = normalizeText(previousText);
	currentText = normalizeText(currentText);
	if (!previousText || !currentText || /\s$/u.test(previousText) || /^\s/u.test(currentText)) return `${previousText}${currentText}`;
	if (/^[,.!?;:，。！？；：、…)\]】」』]/u.test(currentText)) return `${previousText}${currentText}`;
	const previousCharacter = Array.from(previousText).at(-1) ?? "";
	const currentCharacter = Array.from(currentText)[0] ?? "";
	if (isHanOrKana(previousCharacter) && isHanOrKana(currentCharacter)) return `${previousText}${currentText}`;
	return `${previousText} ${currentText}`;
}

function setYouTubeTimedTextParagraphText(paragraph, text, segmented) {
	if (segmented) {
		paragraph.s = { "#": text };
		delete paragraph["#"];
	} else {
		paragraph["#"] = text;
		delete paragraph.s;
	}
}

function isNaturalCaptionBreak(character) {
	return /[\s,.!?;:，。！？；：、…\-—)\]】」』]/u.test(character);
}

function isHanOrKana(character) {
	const codePoint = character.codePointAt(0) ?? 0;
	return (
		(codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
		(codePoint >= 0x3040 && codePoint <= 0x30ff) ||
		(codePoint >= 0xf900 && codePoint <= 0xfaff)
	);
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
