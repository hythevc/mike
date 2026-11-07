// SPDX-License-Identifier: AGPL-3.0-only
// Compatibility shim. The product mark now lives in BrandMarkUI; this module
// re-exports it under the historical names so the Word add-in alias
// (@mike/mike-icon-ui) and any remaining call sites keep compiling. New code
// imports BrandMark from BrandMarkUI, or AssistantStatus for live status.

export {
    BrandMark,
    BrandMark as MikeIcon,
    BRAND_MARK_TINTS,
    BRAND_MARK_TINTS as MIKE_ICON_TINTS,
} from "./BrandMarkUI";
export type {
    BrandMarkTint,
    BrandMarkTint as MikeIconTint,
} from "./BrandMarkUI";
