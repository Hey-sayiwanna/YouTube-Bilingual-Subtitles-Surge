// All models in one bundle (used by tests / tools, not shipped by default).
import { EN_PROFILE } from "../function/asrEnglish.mjs";
import { JA_PROFILE, KO_PROFILE } from "../function/asrCjkSegmenter.mjs";
export const BUNDLE_ID = "all";
export default { en: EN_PROFILE, ja: JA_PROFILE, ko: KO_PROFILE };
