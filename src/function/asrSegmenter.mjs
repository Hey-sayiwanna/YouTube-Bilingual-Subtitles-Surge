/**
 * Convenience facade with every language model loaded (tests and tools).
 * The shipped Surge bundles import asrCore.mjs + one file from src/profiles/.
 */
import * as core from "./asrCore.mjs";
import ALL_PROFILES from "../profiles/all.mjs";
import { EN_PROFILE, scoreBoundaries, setASRBoundaryModel } from "./asrEnglish.mjs";
import { JA_PROFILE, KO_PROFILE, scoreCjkBoundaries } from "./asrCjkSegmenter.mjs";

export { ASR_SEGMENTER_VERSION, DEFAULT_ASR_SEGMENT_OPTIONS, normalizeASRToken, extractASRWords, GENERIC_PROFILE, detectScriptLanguage } from "./asrCore.mjs";
export { EN_PROFILE, JA_PROFILE, KO_PROFILE, ALL_PROFILES, scoreBoundaries, setASRBoundaryModel, scoreCjkBoundaries };

/** English by default, like v37. */
export function segmentASRWords(words, options = {}) {
	return core.segmentASRWords(words, { profile: EN_PROFILE, ...options });
}
export function resegmentYouTubeASR(body, options = {}) {
	return core.resegmentYouTubeASR(body, { profiles: ALL_PROFILES, ...options });
}
export function detectASRLanguage(body, hint = "", profiles = ALL_PROFILES) {
	return core.detectASRLanguage(body, hint, profiles);
}
