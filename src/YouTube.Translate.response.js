import { Console, done, fetch } from "@nsnanocat/util";
import XML from "./XML/XML.mjs";
import {
	disableYouTubeASRRollingWindow,
	disableYouTubeBroadcastRollingWindow,
	rebalanceYouTubeASRSentenceBoundaries,
	resegmentYouTubeASRByParagraphTiming,
	resegmentYouTubeASRBySegmentTiming,
	detectYouTubeChineseCaption,
	ensureYouTubeTimedTextRows,
	mergeYouTubeOfficialSentenceFragments,
	readYouTubeTimedTextParagraph,
	shortenYouTubeBroadcastOverlaps,
	splitYouTubeASRLongParagraphs,
	splitYouTubeOfficialLongParagraphs,
	writeYouTubeTimedTextParagraph,
} from "./function/youtubeTimedText.mjs";

const SETTINGS = Object.freeze({
	Source: "AUTO",
	Target: "ZH-HANS",
	ShowOnly: false,
	Position: "Forward",
	Method: "Part",
	Times: 3,
	Interval: 500,
	Exponential: true,
	ASRMaxEncodedLength: 2400,
	ASRMaxConcurrency: 6,
	ASRQueueThreshold: 24,
	OfficialOversizeThreshold: 6000,
	OfficialMaxEncodedLength: 2400,
	OfficialLongTrackRows: 600,
	OfficialLongMaxEncodedLength: 7200,
	OfficialPostEncodedThreshold: 5000,
	OfficialMaxConcurrency: 2,
	BroadcastBatchSize: 120,
	BroadcastMaxConcurrency: 6,
	BroadcastQueueThreshold: 24,
});

Console.logLevel = "ALL";
Console.warn("Hey-sayiwanna YouTube Translate FIX 33.1 active");
Console.warn("YouTube standalone settings active; BoxJs bypassed");

(async () => {
	const originalXML = $response.body ?? "";
	const originalXMLLength = originalXML.length;
	const body = XML.parse(originalXML);
	const requestURL = new URL($request.url);
	const isAutomaticCaption = detectYouTubeAutomaticCaption(requestURL);
	const isBroadcastCaption = !isAutomaticCaption && detectYouTubeBroadcastCaption(requestURL, body);
	if (!body?.timedtext) {
		Console.warn("YouTube FIX 33 skipped: response is not timedtext XML");
		return;
	}
	const chineseSource = detectYouTubeChineseCaption(requestURL, body);
	if (chineseSource.detected) {
		$response.headers = $response.headers ?? {};
		$response.headers["X-Hey-Sayiwanna-YouTube-Fix"] = "33.1";
		$response.headers["X-Hey-Sayiwanna-Settings"] = "standalone-no-boxjs";
		$response.headers["X-Hey-Sayiwanna-Caption-Mode"] = "chinese-pass-through";
		$response.headers["X-Hey-Sayiwanna-Chinese-Source"] = chineseSource.reason;
		Console.info(`YouTube Chinese source detected; translation bypassed: ${chineseSource.reason}`);
		return;
	}

	ensureYouTubeTimedTextRows(body, 2);
	if (isAutomaticCaption) {
		const paragraphResegment = resegmentYouTubeASRByParagraphTiming(body);
		Console.info(`YouTube ASR v33 punctuation-grammar rebuild: applied=${paragraphResegment.applied}, reason=${paragraphResegment.reason}, input=${paragraphResegment.input}, visible=${paragraphResegment.visible}, output=${paragraphResegment.output}, removedEmpty=${paragraphResegment.removedEmpty}, merged=${paragraphResegment.merged}`);
		const normalizedParagraphs = disableYouTubeASRRollingWindow(body);
		Console.info(`YouTube ASR fixed two-line mode: ${normalizedParagraphs} paragraphs`);
		if (!paragraphResegment.applied) {
			const timedResegment = resegmentYouTubeASRBySegmentTiming(body);
			Console.info(`YouTube ASR v30 timed-stream fallback: applied=${timedResegment.applied}, reason=${timedResegment.reason}, segments=${timedResegment.timedSegments}/${timedResegment.segments}, explicit=${timedResegment.explicitTimedSegments ?? 0}, coverage=${Number(timedResegment.coverage ?? 0).toFixed(2)}, input=${timedResegment.input}, output=${timedResegment.output}, boundaries=${timedResegment.boundaries}`);
			if (!timedResegment.applied) {
				const boundaryResult = rebalanceYouTubeASRSentenceBoundaries(body, 450);
				Console.info(`YouTube ASR v29 fallback sentence rebalance: movedTail=${boundaryResult.movedTail}, movedHead=${boundaryResult.movedHead}`);
				const splitResult = splitYouTubeASRLongParagraphs(body, 40);
				Console.info(`YouTube ASR v29 fallback long-cue split: input=${splitResult.input}, output=${splitResult.output}, split=${splitResult.split}, shortened=${splitResult.shortened}`);
			}
		}
	} else if (isBroadcastCaption) {
		const normalizedParagraphs = disableYouTubeBroadcastRollingWindow(body);
		Console.info(`YouTube broadcast fixed two-line mode: ${normalizedParagraphs} paragraphs`);
		const shortenedOverlaps = shortenYouTubeBroadcastOverlaps(body);
		Console.info(`YouTube broadcast overlap trim: shortened=${shortenedOverlaps}`);
	} else {
		const mergeResult = mergeYouTubeOfficialSentenceFragments(body, 52);
		Console.info(`YouTube official sentence grouping: input=${mergeResult.input}, output=${mergeResult.output}, merged=${mergeResult.merged}`);
		const officialSplit = splitYouTubeOfficialLongParagraphs(body, 70);
		Console.info(`YouTube official long-cue split: input=${officialSplit.input}, output=${officialSplit.output}, split=${officialSplit.split}`);
	}
	let paragraphs = body?.timedtext?.body?.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const parsedParagraphs = paragraphs.map(paragraph => readYouTubeTimedTextParagraph(paragraph));
	const fullText = parsedParagraphs.map(item => item.text);

	Console.info(`XML paragraph count: ${paragraphs.length}`);
	Console.info(`XML fullText count: ${fullText.length}`);
	Console.info(`YouTube srv3 segmented paragraph count: ${parsedParagraphs.filter(item => item.segmented).length}`);

	let translation = await Translator(SETTINGS.Method, fullText, isAutomaticCaption, isBroadcastCaption);
	Console.info(`XML translation count: ${translation?.length ?? 0}`);
	if (!Array.isArray(translation) || translation.length !== fullText.length) {
		Console.warn(`YouTube XML translation mismatch: origin=${fullText.length}, translated=${translation?.length ?? 0}; retry with Row`);
		translation = await Translator("Row", fullText, isAutomaticCaption, isBroadcastCaption);
	}
	if (!Array.isArray(translation)) translation = [];
	translation = fullText.map((_, index) => normalizeTranslation(translation[index]));

	paragraphs.forEach((paragraph, index) => {
		writeYouTubeTimedTextParagraph(paragraph, fullText[index], translation[index], {
			segmented: parsedParagraphs[index].segmented,
			showOnly: SETTINGS.ShowOnly,
			position: SETTINGS.Position,
		});
	});

	$response.body = XML.stringify(body);
	$response.headers = $response.headers ?? {};
	$response.headers["X-Hey-Sayiwanna-YouTube-Fix"] = "33.1";
	$response.headers["X-Hey-Sayiwanna-Settings"] = "standalone-no-boxjs";
	$response.headers["X-Hey-Sayiwanna-ASR-Mode"] = isAutomaticCaption ? "punctuation-grammar-v33" : "unchanged";
	$response.headers["X-Hey-Sayiwanna-Broadcast-Mode"] = isBroadcastCaption ? "fixed-two-lines-no-roll-up" : "unchanged";
	$response.headers["X-Hey-Sayiwanna-Caption-Mode"] = isAutomaticCaption ? "automatic" : isBroadcastCaption ? "broadcast" : "official";
	$response.headers["X-Hey-Sayiwanna-XML-Original-Length"] = String(originalXMLLength);
	$response.headers["X-Hey-Sayiwanna-XML-Modified-Length"] = String($response.body.length);
	Console.info(`XML write-back length: origin=${originalXMLLength}, modified=${$response.body.length}`);
	Console.info("XML write-back finished");
})()
	.catch(error => Console.error(error))
	.finally(() => done($response));

async function Translator(method = "Part", text = [], isAutomaticCaption = false, isBroadcastCaption = false) {
	Console.info(`YouTube standalone translator: method=${method}, source=${SETTINGS.Source}, target=${SETTINGS.Target}`);
	const maximumConcurrency = isBroadcastCaption ? SETTINGS.BroadcastMaxConcurrency : isAutomaticCaption ? SETTINGS.ASRMaxConcurrency : SETTINGS.OfficialMaxConcurrency;
	const queueThreshold = isBroadcastCaption ? SETTINGS.BroadcastQueueThreshold : isAutomaticCaption ? SETTINGS.ASRQueueThreshold : 0;
	if (method === "Row") {
		const translateRow = row => retry(() => googleTranslate(row), SETTINGS.Times, SETTINGS.Interval, SETTINGS.Exponential);
		if (text.length > queueThreshold) {
			if (isBroadcastCaption) Console.info(`YouTube broadcast Row fallback scheduler: rows=${text.length}, concurrency=${maximumConcurrency}`);
			else Console.info(`YouTube Row fallback scheduler: rows=${text.length}, concurrency=${maximumConcurrency}`);
			return await mapWithConcurrency(text, maximumConcurrency, translateRow);
		}
		return await Promise.all(text.map(translateRow));
	}
	const isLongOfficialTrack = !isAutomaticCaption && !isBroadcastCaption && text.length >= SETTINGS.OfficialLongTrackRows;
	let parts = isAutomaticCaption
		? chunkByEncodedLength(text, SETTINGS.ASRMaxEncodedLength)
		: isLongOfficialTrack
			? chunkByEncodedLength(text, SETTINGS.OfficialLongMaxEncodedLength)
			: chunk(text, isBroadcastCaption ? SETTINGS.BroadcastBatchSize : 120);
	// Ordinary official captions retain the conservative v33 guard. Very long
	// official tracks use fewer, larger batches while keeping concurrency fixed.
	if (!isAutomaticCaption && !isBroadcastCaption) {
		if (isLongOfficialTrack) {
			Console.info(`YouTube official long-track compaction: rows=${text.length}, batches=${parts.length}, maxEncoded=${SETTINGS.OfficialLongMaxEncodedLength}, concurrency=${SETTINGS.OfficialMaxConcurrency}`);
		} else {
			let oversizedBatches = 0;
			parts = parts.flatMap(part => {
				if (part.length <= 1 || encodeURIComponent(part.join("\r")).length <= SETTINGS.OfficialOversizeThreshold) return [part];
				oversizedBatches += 1;
				return chunkByEncodedLength(part, SETTINGS.OfficialMaxEncodedLength);
			});
			if (oversizedBatches) Console.info(`YouTube official oversized batch guard: split=${oversizedBatches}, batches=${parts.length}, splitMaxEncoded=${SETTINGS.OfficialMaxEncodedLength}`);
		}
	}
	const captionType = isAutomaticCaption ? "ASR" : isBroadcastCaption ? "broadcast" : "official";
	const useBoundedQueue = isAutomaticCaption || isBroadcastCaption ? parts.length > queueThreshold : parts.length > 1;
	if (isAutomaticCaption) {
		Console.info(`YouTube ASR translation batches: rows=${text.length}, batches=${parts.length}, maxEncoded=${SETTINGS.ASRMaxEncodedLength}, scheduler=${useBoundedQueue ? `bounded-${SETTINGS.ASRMaxConcurrency}` : "direct"}`);
	} else if (isBroadcastCaption) {
		Console.info(`YouTube broadcast translation batches: rows=${text.length}, batches=${parts.length}, batchSize=${SETTINGS.BroadcastBatchSize}, scheduler=${useBoundedQueue ? `bounded-${SETTINGS.BroadcastMaxConcurrency}` : "direct"}`);
	} else if (useBoundedQueue) {
		Console.info(`YouTube official translation batches: rows=${text.length}, batches=${parts.length}, maxBatchRows=120, scheduler=bounded-${SETTINGS.OfficialMaxConcurrency}`);
	}
	const translatePart = (part, index) => translateBatch(part, `${index + 1}/${parts.length}`, useBoundedQueue, captionType);
	const translatedParts = useBoundedQueue
		? await mapWithConcurrency(parts, maximumConcurrency, translatePart)
		: await Promise.all(parts.map(translatePart));
	return translatedParts.flat(Number.POSITIVE_INFINITY);
}

async function translateBatch(part, label, useBoundedQueue, captionType) {
	const translation = await retry(() => googleTranslate(part), SETTINGS.Times, SETTINGS.Interval, SETTINGS.Exponential);
	if (translation.length === part.length) return translation;
	Console.warn(`YouTube ${captionType} batch mismatch: batch=${label}, expected=${part.length}, received=${translation.length}; retry smaller`);
	if (part.length <= 1) return [normalizeTranslation(translation)];

	const middle = Math.ceil(part.length / 2);
	const halves = [part.slice(0, middle), part.slice(middle)];
	if (useBoundedQueue) {
		const first = await translateBatch(halves[0], `${label}.1`, true, captionType);
		const second = await translateBatch(halves[1], `${label}.2`, true, captionType);
		return [...first, ...second];
	}
	return await Promise.all(halves.map((half, index) => translateBatch(half, `${label}.${index + 1}`, false, captionType))).then(result => result.flat(Number.POSITIVE_INFINITY));
}

async function googleTranslate(text) {
	text = Array.isArray(text) ? text : [text];
	const joinedText = text.join("\r");
	const encodedText = encodeURIComponent(joinedText);
	const usePost = encodedText.length > SETTINGS.OfficialPostEncodedThreshold;
	const request = {
		method: usePost ? "POST" : "GET",
		url: usePost
			? "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=zh-CN"
			: `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=zh-CN&q=${encodedText}`,
		headers: {
			Accept: "*/*",
			"User-Agent": "Hey-sayiwanna-YouTube-Bilingual/33.1",
			Referer: "https://translate.google.com",
			...(usePost ? { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" } : {}),
		},
		...(usePost ? { body: `q=${encodedText}` } : {}),
		timeout: 15,
	};
	const response = await fetch(request);
	const body = JSON.parse(response.body);
	let translated;
	if (Array.isArray(body?.[0])) translated = body[0].map(item => item?.[0] ?? "").join("");
	else if (Array.isArray(body)) translated = body.join("");
	else if (Array.isArray(body?.sentences)) translated = body.sentences.map(item => item?.trans ?? "").join("");
	else throw new Error("Google Translate returned an unsupported response");
	return translated.split(/\r/);
}

function normalizeTranslation(text) {
	if (Array.isArray(text)) return text.flat(Number.POSITIVE_INFINITY).join("");
	if (text === undefined || text === null) return "";
	return typeof text === "string" ? text : String(text);
}

function detectYouTubeAutomaticCaption(requestURL) {
	const kind = (requestURL.searchParams.get("kind") ?? "").trim().toLowerCase();
	const caps = (requestURL.searchParams.get("caps") ?? "").trim().toLowerCase();
	const trackName = (requestURL.searchParams.get("name") ?? "").normalize("NFKC");
	return (
		kind === "asr" ||
		caps === "asr" ||
		/(?:auto(?:matic)?[- _]?generated|auto[- _]?caption|自动生成|自動生成)/iu.test(trackName)
	);
}

function detectYouTubeBroadcastCaption(requestURL, body) {
	const trackName = requestURL.searchParams.get("name") ?? "";
	const normalizedTrackName = trackName.normalize("NFKC").toUpperCase();
	const namedBroadcastTrack =
		/(?:^|[^A-Z0-9])CC[1-4](?:$|[^0-9])/u.test(normalizedTrackName) ||
		/(?:^|[^A-Z0-9])(?:DTVCC|SERVICE)[\s._#:-]*(?:[1-9]|[1-5]\d|6[0-3])(?:$|[^0-9])/u.test(normalizedTrackName) ||
		/(?:CEA|EIA)[\s._/-]*(?:608|708)/u.test(normalizedTrackName) ||
		/(?:EMBEDDED[\s._-]*(?:608(?:\s*[/+&]\s*708)?|708)|(?:608(?:\s*[/+&]\s*708)?|708)[\s._-]*EMBEDDED|LINE[\s._-]*21)/u.test(normalizedTrackName);
	const timedTextBody = body?.timedtext?.body;
	let paragraphs = timedTextBody?.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const hasRollUpWindow = Boolean(timedTextBody?.w) && paragraphs.some(paragraph => paragraph?.["@w"] !== undefined || paragraph?.["@a"] !== undefined);
	return namedBroadcastTrack || hasRollUpWindow;
}

function chunk(source, length) {
	let index = 0;
	const target = [];
	while (index < source.length) target.push(source.slice(index, (index += length)));
	return target;
}

function chunkByEncodedLength(source, maximumLength) {
	const target = [];
	let current = [];
	for (const row of source) {
		const candidate = [...current, row];
		if (current.length && encodeURIComponent(candidate.join("\r")).length > maximumLength) {
			target.push(current);
			current = [];
		}
		current.push(row);
	}
	if (current.length) target.push(current);
	return target;
}

async function mapWithConcurrency(source, maximumConcurrency, mapper) {
	const target = new Array(source.length);
	let nextIndex = 0;
	const workerCount = Math.min(Math.max(1, maximumConcurrency), source.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (nextIndex < source.length) {
			const index = nextIndex;
			nextIndex += 1;
			target[index] = await mapper(source[index], index);
		}
	});
	await Promise.all(workers);
	return target;
}

async function retry(fn, retriesLeft = 3, interval = 500, exponential = true) {
	try {
		return await fn();
	} catch (error) {
		if (!retriesLeft) throw error;
		await new Promise(resolve => setTimeout(resolve, interval));
		return retry(fn, retriesLeft - 1, exponential ? interval * 2 : interval, exponential);
	}
}
