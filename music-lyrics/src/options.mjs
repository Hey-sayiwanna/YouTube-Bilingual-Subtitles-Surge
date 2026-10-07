/** Module arguments: "Position=原文在上&Evade=true" (Chinese or English values). */
export function readOptions(argument = typeof $argument === "string" ? $argument : "") {
	const params = {};
	for (const pair of String(argument ?? "").split("&")) {
		const index = pair.indexOf("=");
		if (index > 0) params[decodeURIComponent(pair.slice(0, index).trim())] = decodeURIComponent(pair.slice(index + 1).trim());
	}
	const position = { 原文在上: "Forward", 译文在上: "Reverse", 仅译文: "ShowOnly" }[params.Position] ?? (["Forward", "Reverse", "ShowOnly"].includes(params.Position) ? params.Position : "Forward");
	const evade = !/^(?:false|0|off|no|关闭?)$/i.test(params.Evade ?? "true");
	return { position, evade, target: params.Target || "zh-CN" };
}

export const TAG_PARAM = "ytmLyrics";
