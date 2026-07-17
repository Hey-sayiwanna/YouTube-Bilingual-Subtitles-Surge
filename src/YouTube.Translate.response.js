import { Console, done, fetch } from "@nsnanocat/util";
import XML from "./XML/XML.mjs";
import {
	disableYouTubeASRRollingWindow,
	ensureYouTubeTimedTextRows,
	readYouTubeTimedTextParagraph,
	splitYouTubeASRLongParagraphs,
	writeYouTubeTimedTextParagraph,
} from "./function/youtubeTimedText.mjs";
import { translateBatchesWithinBudget } from "./function/translationScheduler.mjs";

const SETTINGS = Object.freeze({
	Source: "AUTO",
	Target: "ZH-HANS",
	ShowOnly: false,
	Position: "Forward",
	MaxEncodedLength: 2400,
	Concurrency: 6,
	BudgetMs: 6000,
});

Console.logLevel = "ALL";
Console.warn("Hey-sayiwanna YouTube Translate FIX 17 active");
Console.warn("YouTube standalone settings active; BoxJs bypassed");

(async () => {
	const originalXML = $response.body ?? "";
	const originalXMLLength = originalXML.length;
	const body = XML.parse(originalXML);
	const requestURL = new URL($request.url);
	const isAutomaticCaption = requestURL.searchParams.get("kind") === "asr";
	if (!body?.timedtext) {
		Console.warn("YouTube FIX 17 skipped: response is not timedtext XML");
		return;
	}

	ensureYouTubeTimedTextRows(body, 2);
	if (isAutomaticCaption) {
		const normalizedParagraphs = disableYouTubeASRRollingWindow(body);
		Console.info(`YouTube ASR fixed two-line mode: ${normalizedParagraphs} paragraphs`);
		const splitResult = splitYouTubeASRLongParagraphs(body, 40);
		Console.info(`YouTube ASR long-cue split: input=${splitResult.input}, output=${splitResult.output}, split=${splitResult.split}, shortened=${splitResult.shortened}`);
	}
	let paragraphs = body?.timedtext?.body?.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const parsedParagraphs = paragraphs.map(paragraph => readYouTubeTimedTextParagraph(paragraph));
	const fullText = parsedParagraphs.map(item => item.text);

	Console.info(`XML paragraph count: ${paragraphs.length}`);
	Console.info(`XML fullText count: ${fullText.length}`);
	Console.info(`YouTube srv3 segmented paragraph count: ${parsedParagraphs.filter(item => item.segmented).length}`);

	const translationResult = await translateBatchesWithinBudget(
		fullText,
		batch => retry(() => googleTranslate(batch), 1, 150, false),
		{
			maxEncodedLength: SETTINGS.MaxEncodedLength,
			concurrency: SETTINGS.Concurrency,
			budgetMs: SETTINGS.BudgetMs,
		},
	);
	const translation = translationResult.translations.map(normalizeTranslation);
	const translatedRows = translation.filter(text => text.trim()).length;
	Console.info(`Google batch plan: rows=${fullText.length}, batches=${translationResult.batches.length}, maxEncoded=${SETTINGS.MaxEncodedLength}, concurrency=${SETTINGS.Concurrency}, budget=${SETTINGS.BudgetMs}ms`);
	Console.info(`Google batch result: completed=${translationResult.completedBatches}/${translationResult.batches.length}, failed=${translationResult.failedBatches}, timedOut=${translationResult.timedOut}, elapsed=${translationResult.elapsedMs}ms`);
	Console.info(`XML translation count: ${translatedRows}/${translation.length}`);
	translationResult.errors.slice(0, 3).forEach(error => Console.warn(`Google translation batch failed: ${error}`));
	if (translation.length !== fullText.length) {
		Console.warn(`YouTube XML translation mismatch: origin=${fullText.length}, translated=${translation.length}`);
	}

	const fallback = translationResult.completedBatches === 0
		? "original"
		: translationResult.completedBatches < translationResult.batches.length ? "partial" : "none";
	setDiagnosticHeaders({
		isAutomaticCaption,
		originalXMLLength,
		modifiedXMLLength: originalXMLLength,
		fallback,
		completedBatches: translationResult.completedBatches,
		totalBatches: translationResult.batches.length,
	});
	if (fallback === "original") {
		$response.body = originalXML;
		Console.warn("YouTube translation deadline fallback: original subtitles");
		return;
	}

	paragraphs.forEach((paragraph, index) => {
		writeYouTubeTimedTextParagraph(paragraph, fullText[index], translation[index], {
			segmented: parsedParagraphs[index].segmented,
			showOnly: SETTINGS.ShowOnly,
			position: SETTINGS.Position,
		});
	});

	$response.body = XML.stringify(body);
	setDiagnosticHeaders({
		isAutomaticCaption,
		originalXMLLength,
		modifiedXMLLength: $response.body.length,
		fallback,
		completedBatches: translationResult.completedBatches,
		totalBatches: translationResult.batches.length,
	});
	Console.info(`XML write-back length: origin=${originalXMLLength}, modified=${$response.body.length}`);
	Console.info("XML write-back finished");
})()
	.catch(error => Console.error(error))
	.finally(() => done($response));

async function googleTranslate(text) {
	text = Array.isArray(text) ? text : [text];
	const request = {
		url: `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=zh-CN&q=${encodeURIComponent(text.join("\r"))}`,
		timeout: 3,
		headers: {
			Accept: "*/*",
			"User-Agent": "Hey-sayiwanna-YouTube-Bilingual/17",
			Referer: "https://translate.google.com",
		},
	};
	const response = await fetch(request);
	const body = JSON.parse(response.body);
	let translated;
	if (Array.isArray(body?.[0])) translated = body[0].map(item => item?.[0] ?? "").join("");
	else if (Array.isArray(body)) translated = body.join("");
	else if (Array.isArray(body?.sentences)) translated = body.sentences.map(item => item?.trans ?? "").join("");
	else throw new Error("Google Translate returned an unsupported response");
	return translated.split(/\r\n?|\n/);
}

function normalizeTranslation(text) {
	if (Array.isArray(text)) return text.flat(Number.POSITIVE_INFINITY).join("");
	if (text === undefined || text === null) return "";
	return typeof text === "string" ? text : String(text);
}

function setDiagnosticHeaders({ isAutomaticCaption, originalXMLLength, modifiedXMLLength, fallback, completedBatches, totalBatches }) {
	$response.headers = $response.headers ?? {};
	$response.headers["X-Hey-Sayiwanna-YouTube-Fix"] = "17";
	$response.headers["X-Hey-Sayiwanna-Settings"] = "standalone-no-boxjs";
	$response.headers["X-Hey-Sayiwanna-ASR-Mode"] = isAutomaticCaption ? "fixed-two-lines-split-long-cues" : "unchanged";
	$response.headers["X-Hey-Sayiwanna-Translation-Fallback"] = fallback;
	$response.headers["X-Hey-Sayiwanna-Translation-Batches"] = `${completedBatches}/${totalBatches}`;
	$response.headers["X-Hey-Sayiwanna-XML-Original-Length"] = String(originalXMLLength);
	$response.headers["X-Hey-Sayiwanna-XML-Modified-Length"] = String(modifiedXMLLength);
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
