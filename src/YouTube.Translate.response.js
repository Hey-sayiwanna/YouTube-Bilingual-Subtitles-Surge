import { Console, done, fetch } from "@nsnanocat/util";
import XML from "./XML/XML.mjs";
import { ensureYouTubeTimedTextRows, readYouTubeTimedTextParagraph, writeYouTubeTimedTextParagraph } from "./function/youtubeTimedText.mjs";

const SETTINGS = Object.freeze({
	Source: "AUTO",
	Target: "ZH-HANS",
	ShowOnly: false,
	Position: "Forward",
	Method: "Part",
	Times: 3,
	Interval: 500,
	Exponential: true,
});

Console.logLevel = "ALL";
Console.warn("Hey-sayiwanna YouTube Translate FIX 14 active");
Console.warn("YouTube standalone settings active; BoxJs bypassed");

(async () => {
	const originalXML = $response.body ?? "";
	const originalXMLLength = originalXML.length;
	const body = XML.parse(originalXML);
	if (!body?.timedtext) {
		Console.warn("YouTube FIX 14 skipped: response is not timedtext XML");
		return;
	}

	ensureYouTubeTimedTextRows(body, 2);
	let paragraphs = body?.timedtext?.body?.p;
	paragraphs = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];
	const parsedParagraphs = paragraphs.map(paragraph => readYouTubeTimedTextParagraph(paragraph));
	const fullText = parsedParagraphs.map(item => item.text);

	Console.info(`XML paragraph count: ${paragraphs.length}`);
	Console.info(`XML fullText count: ${fullText.length}`);
	Console.info(`YouTube srv3 segmented paragraph count: ${parsedParagraphs.filter(item => item.segmented).length}`);

	let translation = await Translator(SETTINGS.Method, fullText);
	Console.info(`XML translation count: ${translation?.length ?? 0}`);
	if (!Array.isArray(translation) || translation.length !== fullText.length) {
		Console.warn(`YouTube XML translation mismatch: origin=${fullText.length}, translated=${translation?.length ?? 0}; retry with Row`);
		translation = await Translator("Row", fullText);
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
	$response.headers["X-Hey-Sayiwanna-YouTube-Fix"] = "14";
	$response.headers["X-Hey-Sayiwanna-Settings"] = "standalone-no-boxjs";
	$response.headers["X-Hey-Sayiwanna-XML-Original-Length"] = String(originalXMLLength);
	$response.headers["X-Hey-Sayiwanna-XML-Modified-Length"] = String($response.body.length);
	Console.info(`XML write-back length: origin=${originalXMLLength}, modified=${$response.body.length}`);
	Console.info("XML write-back finished");
})()
	.catch(error => Console.error(error))
	.finally(() => done($response));

async function Translator(method = "Part", text = []) {
	Console.info(`YouTube standalone translator: method=${method}, source=${SETTINGS.Source}, target=${SETTINGS.Target}`);
	if (method === "Row") {
		return await Promise.all(text.map(row => retry(() => googleTranslate(row), SETTINGS.Times, SETTINGS.Interval, SETTINGS.Exponential)));
	}
	const parts = chunk(text, 120);
	return await Promise.all(parts.map(part => retry(() => googleTranslate(part), SETTINGS.Times, SETTINGS.Interval, SETTINGS.Exponential))).then(part => part.flat(Number.POSITIVE_INFINITY));
}

async function googleTranslate(text) {
	text = Array.isArray(text) ? text : [text];
	const request = {
		url: `https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=zh-CN&q=${encodeURIComponent(text.join("\r"))}`,
		headers: {
			Accept: "*/*",
			"User-Agent": "Hey-sayiwanna-YouTube-Bilingual/14",
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
	return translated.split(/\r/);
}

function normalizeTranslation(text) {
	if (Array.isArray(text)) return text.flat(Number.POSITIVE_INFINITY).join("");
	if (text === undefined || text === null) return "";
	return typeof text === "string" ? text : String(text);
}

function chunk(source, length) {
	let index = 0;
	const target = [];
	while (index < source.length) target.push(source.slice(index, (index += length)));
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
