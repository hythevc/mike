// SPDX-License-Identifier: AGPL-3.0-only
const fs = require("fs");
const path = require("path");

const publicUrlInput = (process.env.WORD_ADDIN_PUBLIC_URL || "").trim();
let parsedPublicUrl;
try {
  parsedPublicUrl = new URL(publicUrlInput);
} catch {
  throw new Error(
    "WORD_ADDIN_PUBLIC_URL must be the deployed HTTPS origin for the Word add-in"
  );
}
if (
  parsedPublicUrl.protocol !== "https:" ||
  parsedPublicUrl.username ||
  parsedPublicUrl.password ||
  parsedPublicUrl.search ||
  parsedPublicUrl.hash ||
  parsedPublicUrl.pathname !== "/"
) {
  throw new Error(
    "WORD_ADDIN_PUBLIC_URL must be an HTTPS origin without credentials, a path, query, or fragment"
  );
}
const publicUrl = parsedPublicUrl.origin;

// The development placeholder Id. A production manifest must carry a real GUID
// supplied through WORD_ADDIN_MANIFEST_ID; shipping this value is refused.
const PLACEHOLDER_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const GUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// The brand module (names and addresses) is generated from
// packages/brand/brand.json. The add-in reads it from frontend/src/shared, the
// same source the webpack @mike/brand alias resolves and word-addin/Dockerfile
// copies into the image; it never reaches into packages/.
const brandModulePath = path.resolve(
  __dirname,
  "..",
  "..",
  "frontend",
  "src",
  "shared",
  "brand.generated.ts"
);
const brandModule = fs.readFileSync(brandModulePath, "utf8");
function brandString(field) {
  const marker = `${field}: "`;
  const start = brandModule.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not read ${field} from the brand module`);
  }
  const from = start + marker.length;
  const end = brandModule.indexOf('"', from);
  return brandModule.slice(from, end);
}
function xmlAttr(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const productName = brandString("productName");
const providerName = brandString("legalEntityName");
const description = `${productName}: an AI legal assistant for Microsoft Word.`;
const tooltip = `Open the ${productName} assistant pane`;

const manifestId = (process.env.WORD_ADDIN_MANIFEST_ID || "").trim();
if (manifestId) {
  if (!GUID_PATTERN.test(manifestId)) {
    throw new Error(
      "WORD_ADDIN_MANIFEST_ID must be a GUID (for example 123e4567-e89b-42d3-a456-426614174000)"
    );
  }
  if (manifestId.toLowerCase() === PLACEHOLDER_ID) {
    throw new Error(
      "WORD_ADDIN_MANIFEST_ID must be a fresh GUID, not the development placeholder"
    );
  }
}

const sourcePath = path.resolve(__dirname, "../manifest.xml");
const distPath = path.resolve(__dirname, "../dist");
const outputPath = path.join(distPath, "manifest.xml");

let manifest = fs.readFileSync(sourcePath, "utf8");

// Brand-controlled display strings come from the single brand module, so a
// rebrand reaches the production manifest without editing the XML.
manifest = manifest
  .replace(
    /<DisplayName DefaultValue="[^"]*" \/>/,
    `<DisplayName DefaultValue="${xmlAttr(productName)}" />`
  )
  .replace(
    /<ProviderName>[^<]*<\/ProviderName>/,
    `<ProviderName>${xmlAttr(providerName)}</ProviderName>`
  )
  .replace(
    /<Description DefaultValue="[^"]*" \/>/,
    `<Description DefaultValue="${xmlAttr(description)}" />`
  )
  .replace(
    /<bt:String id="GroupLabel" DefaultValue="[^"]*" \/>/,
    `<bt:String id="GroupLabel" DefaultValue="${xmlAttr(productName)}" />`
  )
  .replace(
    /<bt:String id="TaskpaneButton.Label" DefaultValue="[^"]*" \/>/,
    `<bt:String id="TaskpaneButton.Label" DefaultValue="${xmlAttr(productName)}" />`
  )
  .replace(
    /<bt:String id="TaskpaneButton.Tooltip" DefaultValue="[^"]*" \/>/,
    `<bt:String id="TaskpaneButton.Tooltip" DefaultValue="${xmlAttr(tooltip)}" />`
  );

if (manifestId) {
  manifest = manifest.replaceAll(PLACEHOLDER_ID, manifestId);
}

manifest = manifest.replaceAll("https://localhost:3200", publicUrl);

if (manifest.includes("https://localhost:3200")) {
  throw new Error("Production manifest still contains localhost URLs");
}
if (manifest.includes(PLACEHOLDER_ID)) {
  throw new Error(
    "Production manifest still carries the placeholder add-in Id; set WORD_ADDIN_MANIFEST_ID to a fresh GUID"
  );
}

fs.mkdirSync(distPath, { recursive: true });
fs.writeFileSync(outputPath, manifest);

const assetOutputPath = path.join(distPath, "assets");
fs.mkdirSync(assetOutputPath, { recursive: true });
for (const filename of ["icon-16.png", "icon-32.png", "icon-80.png"]) {
  fs.copyFileSync(
    path.resolve(__dirname, "../assets", filename),
    path.join(assetOutputPath, filename)
  );
}

console.log(
  `Wrote production manifest for ${productName} (${publicUrl}) and ribbon icons`
);
