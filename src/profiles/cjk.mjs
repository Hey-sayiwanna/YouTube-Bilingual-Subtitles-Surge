// Bundle "cjk": Japanese + Korean models (+ generic standard for anything else).
import { JA_PROFILE, KO_PROFILE } from "../function/asrCjkSegmenter.mjs";
export const BUNDLE_ID = "cjk";
export default { ja: JA_PROFILE, ko: KO_PROFILE };
