import JSZip from "jszip";
import { parseStringPromise, Builder } from "xml2js";
import path from "path";
import sharp from "sharp";

/**
 * Escape XML special characters to prevent malformed XML or injection
 * @param {string} str - String to escape
 * @returns {string} - XML-safe string
 */
function escapeXml(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Validate and sanitize metadata string input
 * @param {string} value - Input value
 * @param {number} maxLength - Maximum allowed length (default 10000)
 * @returns {string} - Sanitized value
 */
function sanitizeMetadataString(value, maxLength = 10000) {
  if (!value || typeof value !== 'string') return '';
  // Trim and limit length to prevent abuse
  let sanitized = value.trim().substring(0, maxLength);
  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized;
}

/**
 * ISO 639-2/T (3-letter) to ISO 639-1 (2-letter) mapping
 * BCP 47 prefers 2-letter codes when available
 */
const LANGUAGE_CODE_MAP = {
  // Major world languages
  'eng': 'en', 'fra': 'fr', 'fre': 'fr', 'deu': 'de', 'ger': 'de',
  'spa': 'es', 'ita': 'it', 'por': 'pt', 'rus': 'ru', 'jpn': 'ja',
  'zho': 'zh', 'chi': 'zh', 'kor': 'ko', 'ara': 'ar', 'hin': 'hi',
  'ben': 'bn', 'pan': 'pa', 'jav': 'jv', 'vie': 'vi', 'tur': 'tr',
  'pol': 'pl', 'ukr': 'uk', 'ron': 'ro', 'rum': 'ro', 'nld': 'nl',
  'dut': 'nl', 'ell': 'el', 'gre': 'el', 'ces': 'cs', 'cze': 'cs',
  'hun': 'hu', 'swe': 'sv', 'bul': 'bg', 'dan': 'da', 'fin': 'fi',
  'nor': 'no', 'nob': 'nb', 'nno': 'nn', 'slk': 'sk', 'slo': 'sk',
  'hrv': 'hr', 'srp': 'sr', 'slv': 'sl', 'est': 'et', 'lav': 'lv',
  'lit': 'lt', 'cat': 'ca', 'eus': 'eu', 'baq': 'eu', 'glg': 'gl',
  'cym': 'cy', 'wel': 'cy', 'gle': 'ga', 'isl': 'is', 'ice': 'is',
  'mlt': 'mt', 'afr': 'af', 'sqi': 'sq', 'alb': 'sq', 'bel': 'be',
  'bos': 'bs', 'mkd': 'mk', 'mac': 'mk', 'heb': 'he', 'yid': 'yi',
  'ind': 'id', 'msa': 'ms', 'may': 'ms', 'tha': 'th', 'fil': 'tl',
  'tgl': 'tl', 'fas': 'fa', 'per': 'fa', 'urd': 'ur', 'guj': 'gu',
  'mar': 'mr', 'tam': 'ta', 'tel': 'te', 'kan': 'kn', 'mal': 'ml',
  'mya': 'my', 'bur': 'my', 'khm': 'km', 'lao': 'lo', 'kat': 'ka',
  'geo': 'ka', 'hye': 'hy', 'arm': 'hy', 'aze': 'az', 'kaz': 'kk',
  'uzb': 'uz', 'mon': 'mn', 'nep': 'ne', 'sin': 'si', 'amh': 'am',
  'swa': 'sw', 'hau': 'ha', 'yor': 'yo', 'ibo': 'ig', 'zul': 'zu',
  'xho': 'xh', 'lat': 'la', 'san': 'sa', 'epo': 'eo'
};

/**
 * Valid 2-letter BCP 47 language codes (subset for validation)
 */
const VALID_BCP47_CODES = new Set([
  'aa', 'ab', 'ae', 'af', 'ak', 'am', 'an', 'ar', 'as', 'av', 'ay', 'az',
  'ba', 'be', 'bg', 'bh', 'bi', 'bm', 'bn', 'bo', 'br', 'bs', 'ca', 'ce',
  'ch', 'co', 'cr', 'cs', 'cu', 'cv', 'cy', 'da', 'de', 'dv', 'dz', 'ee',
  'el', 'en', 'eo', 'es', 'et', 'eu', 'fa', 'ff', 'fi', 'fj', 'fo', 'fr',
  'fy', 'ga', 'gd', 'gl', 'gn', 'gu', 'gv', 'ha', 'he', 'hi', 'ho', 'hr',
  'ht', 'hu', 'hy', 'hz', 'ia', 'id', 'ie', 'ig', 'ii', 'ik', 'io', 'is',
  'it', 'iu', 'ja', 'jv', 'ka', 'kg', 'ki', 'kj', 'kk', 'kl', 'km', 'kn',
  'ko', 'kr', 'ks', 'ku', 'kv', 'kw', 'ky', 'la', 'lb', 'lg', 'li', 'ln',
  'lo', 'lt', 'lu', 'lv', 'mg', 'mh', 'mi', 'mk', 'ml', 'mn', 'mr', 'ms',
  'mt', 'my', 'na', 'nb', 'nd', 'ne', 'ng', 'nl', 'nn', 'no', 'nr', 'nv',
  'ny', 'oc', 'oj', 'om', 'or', 'os', 'pa', 'pi', 'pl', 'ps', 'pt', 'qu',
  'rm', 'rn', 'ro', 'ru', 'rw', 'sa', 'sc', 'sd', 'se', 'sg', 'si', 'sk',
  'sl', 'sm', 'sn', 'so', 'sq', 'sr', 'ss', 'st', 'su', 'sv', 'sw', 'ta',
  'te', 'tg', 'th', 'ti', 'tk', 'tl', 'tn', 'to', 'tr', 'ts', 'tt', 'tw',
  'ty', 'ug', 'uk', 'ur', 'uz', 've', 'vi', 'vo', 'wa', 'wo', 'xh', 'yi',
  'yo', 'za', 'zh', 'zu'
]);

/**
 * Normalize language code to BCP 47 format
 * Returns { code: string, warning?: string, converted?: boolean, original?: string }
 */
export function normalizeLanguageCode(code) {
  if (!code) return { code: '' };
  
  const original = code.trim();
  let normalized = original.toLowerCase();
  
  // Handle codes with region (e.g., en-US, en_US)
  const parts = normalized.split(/[-_]/);
  let baseLang = parts[0];
  const region = parts[1] ? parts[1].toUpperCase() : null;
  
  // If 3-letter code, try to convert to 2-letter
  if (baseLang.length === 3 && LANGUAGE_CODE_MAP[baseLang]) {
    baseLang = LANGUAGE_CODE_MAP[baseLang];
  }
  
  // Reconstruct with region if present
  normalized = region ? `${baseLang}-${region}` : baseLang;
  
  // Validate the base language code
  if (baseLang.length === 2 && !VALID_BCP47_CODES.has(baseLang)) {
    return { 
      code: normalized, 
      warning: `Unknown language code: "${original}". Please verify this is a valid BCP 47 code.`
    };
  }
  
  // Check if 3-letter code wasn't converted (unknown)
  if (parts[0].length === 3 && !LANGUAGE_CODE_MAP[parts[0]]) {
    return {
      code: normalized,
      warning: `Could not convert 3-letter code "${parts[0]}" to BCP 47 format. Please verify manually.`
    };
  }
  
  // Check if conversion happened
  if (baseLang !== parts[0] && parts[0].length === 3) {
    return { 
      code: normalized,
      converted: true,
      original: original
    };
  }
  
  return { code: normalized };
}

/**
 * Read EPUB + OPF
 */
export async function readEpub(buffer) {
  const zip = await JSZip.loadAsync(buffer);

  const containerXml = await zip
    .file("META-INF/container.xml")
    .async("string");

  const container = await parseStringPromise(containerXml);
  const opfPath =
    container.container.rootfiles[0].rootfile[0].$["full-path"];

  const opfXml = await zip.file(opfPath).async("string");
  const opf = await parseStringPromise(opfXml);

  return {
    zip,
    opfPath,
    opf,
    meta: opf.package.metadata[0]
  };
}

/**
 * Extract commonly used EPUB metadata
 * Now treats authors as arrays like contributors
 * Supports multiple titles with title-type refinements (EPUB 3)
 */
export function extractMetadata(meta) {
  const get = (k) => meta[k]?.[0]?._ ?? meta[k]?.[0] ?? "";

  const getMetaProp = (prop) =>
    meta.meta?.find(m => m.$?.property === prop)?._ ?? "";
  
  // Extract titles - look for main title and subtitle using EPUB 3 refinements
  let mainTitle = "";
  let subtitle = "";
  
  if (meta["dc:title"]) {
    const titles = Array.isArray(meta["dc:title"]) ? meta["dc:title"] : [meta["dc:title"]];
    
    for (const t of titles) {
      const titleValue = t._ ?? t;
      const titleId = t.$?.id;
      
      // Check for title-type refinement
      let titleType = null;
      if (titleId && meta.meta) {
        const typeRefine = meta.meta.find(m => 
          m.$?.refines === `#${titleId}` && m.$?.property === "title-type"
        );
        if (typeRefine) {
          titleType = typeRefine._ ?? typeRefine;
        }
      }
      
      if (titleType === "subtitle") {
        subtitle = titleValue;
      } else if (titleType === "main" || !mainTitle) {
        // First title or explicitly marked as main
        mainTitle = titleValue;
      }
    }
  }
  
  // Extract authors as array (like contributors)
  const authors = meta["dc:creator"]?.map(c => {
    const authorObj = {
      name: c._ ?? c,
      role: c.$?.["opf:role"] || "aut",
      fileAs: null
    };
    
    // Look for file-as refinement
    const id = c.$?.id;
    if (id && meta.meta) {
      const fileAs = meta.meta.find(m => 
        m.$?.refines === `#${id}` && m.$?.property === "file-as"
      );
      if (fileAs) {
        authorObj.fileAs = fileAs._ ?? fileAs;
      }
    }
    
    return authorObj;
  }) ?? [];
  
  // Extract contributors (editors, translators, illustrators)
  const contributors = meta["dc:contributor"]?.map(c => ({
    name: c._ ?? c,
    role: c.$?.["opf:role"] || "contributor"
  })) ?? [];

  // Extract ISBN - look through all identifiers for one that looks like an ISBN
  let identifier = "";
  if (meta["dc:identifier"]) {
    const identifiers = Array.isArray(meta["dc:identifier"]) 
      ? meta["dc:identifier"] 
      : [meta["dc:identifier"]];
    
    for (const id of identifiers) {
      const value = String(id._ ?? id).trim();
      const scheme = id.$?.["opf:scheme"];
      const idAttr = id.$?.id;
      
      // Clean the value for validation (remove urn:isbn: prefix if present)
      let cleanValue = value.replace(/^urn:isbn:/i, '').replace(/[-\s]/g, '');
      
      // Check for EPUB 3 identifier-type refinement
      let isISBNRefined = false;
      if (idAttr && meta.meta) {
        const typeRefine = meta.meta.find(m => 
          m.$?.refines === `#${idAttr}` && m.$?.property === "identifier-type"
        );
        if (typeRefine && (typeRefine._ === "15" || typeRefine._ === "02" || 
            String(typeRefine._).toUpperCase() === "ISBN")) {
          isISBNRefined = true;
        }
      }
      
      // ISBN-10: 10 digits (last can be X)
      // ISBN-13: 13 digits starting with 978 or 979
      const isISBN10 = /^\d{9}[\dX]$/i.test(cleanValue);
      const isISBN13 = /^(978|979)\d{10}$/.test(cleanValue);
      
      if (scheme === "ISBN" || isISBNRefined || isISBN10 || isISBN13) {
        // Return original value (possibly with dashes) but strip urn:isbn: prefix
        identifier = value.replace(/^urn:isbn:/i, '');
        break;
      }
    }
  }

  // Normalize language code
  const rawLanguage = get("dc:language");
  const langResult = normalizeLanguageCode(rawLanguage);

  return {
    title: mainTitle,
    subtitle,
    authors,  // Now an array
    author: authors.length > 0 ? authors[0].name : "", // Keep for backward compat
    contributors,
    language: langResult.code,
    languageWarning: langResult.warning,
    languageConverted: langResult.converted ? rawLanguage : null,
    identifier,
    publisher: get("dc:publisher"),
    date: get("dc:date"),
    description: get("dc:description"),
    rights: get("dc:rights"),
    series: getMetaProp("belongs-to-collection"),
    seriesIndex: getMetaProp("group-position"),
    subjects: meta["dc:subject"]?.map(s => s._ ?? s) ?? []
  };
}

/**
 * Normalize metadata fields
 */
export function normalizeMetadata(metadata) {
  const normalized = {};
  const warnings = [];
  
  // Trim whitespace from all string fields
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      normalized[key] = value.trim();
    } else if (Array.isArray(value)) {
      // For arrays (like subjects), trim and deduplicate
      normalized[key] = [...new Set(value.map(v => 
        typeof v === 'string' ? v.trim() : v
      ).filter(v => v))];
    } else {
      normalized[key] = value;
    }
  }
  
  // Normalize date format to YYYY-MM-DD or YYYY
  if (normalized.date) {
    normalized.date = normalizeDateFormat(normalized.date);
  }
  
  // Strip HTML from description
  if (normalized.description) {
    normalized.description = stripHTML(normalized.description);
  }
  
  // Normalize language code
  if (normalized.language) {
    const langResult = normalizeLanguageCode(normalized.language);
    normalized.language = langResult.code;
    if (langResult.warning) {
      warnings.push(langResult.warning);
    }
    if (langResult.converted) {
      warnings.push(`Language code converted: "${langResult.original}" → "${langResult.code}"`);
    }
  }
  
  normalized._warnings = warnings.length > 0 ? warnings : undefined;
  
  return normalized;
}

/**
 * Normalize date to YYYY-MM-DD or YYYY format
 */
function normalizeDateFormat(dateStr) {
  if (!dateStr) return '';
  
  // If already in YYYY or YYYY-MM-DD format, keep it
  if (/^\d{4}(-\d{2}-\d{2})?$/.test(dateStr)) {
    return dateStr;
  }
  
  // Try parsing various date formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  // Extract just the year if present
  const yearMatch = dateStr.match(/\d{4}/);
  if (yearMatch) {
    return yearMatch[0];
  }
  
  return dateStr;
}

/**
 * Strip HTML tags from text
 */
function stripHTML(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/&nbsp;/g, ' ') // Replace &nbsp;
    .replace(/&amp;/g, '&')  // Replace &amp;
    .replace(/&lt;/g, '<')   // Replace &lt;
    .replace(/&gt;/g, '>')   // Replace &gt;
    .replace(/&quot;/g, '"') // Replace &quot;
    .replace(/&#39;/g, "'")  // Replace &#39;
    .replace(/\s+/g, ' ')    // Normalize whitespace
    .trim();
}

/**
 * Get cover image from EPUB
 * With safeguards for malformed EPUBs and missing manifest properties
 */
export async function getCoverImage(zip, opf, opfPath) {
  try {
    // Safeguard: check manifest exists
    if (!opf?.package?.manifest?.[0]?.item) {
      console.warn("getCoverImage: No manifest found in OPF");
      return null;
    }
    
    const manifest = opf.package.manifest[0].item;
    const meta = opf.package.metadata?.[0];
    
    // Try to find cover by meta tag
    let coverId = null;
    if (meta?.meta) {
      const coverMeta = meta.meta.find(m => m?.$?.name === "cover");
      if (coverMeta?.$?.content) {
        coverId = coverMeta.$.content;
      }
    }
    
    // Try to find by manifest properties (with safeguard for missing properties)
    if (!coverId) {
      const coverItem = manifest.find(item => {
        // Safeguard: ensure item and item.$ exist before accessing properties
        if (!item?.$?.properties) return false;
        return item.$.properties.includes("cover-image");
      });
      if (coverItem?.$?.id) {
        coverId = coverItem.$.id;
      }
    }
    
    // Try to find by ID containing "cover" (with safeguards)
    if (!coverId) {
      const coverItem = manifest.find(item => {
        // Safeguard: ensure item.$ exists
        if (!item?.$) return false;
        const id = item.$.id;
        const mediaType = item.$["media-type"];
        return id?.toLowerCase().includes("cover") && 
               mediaType?.startsWith("image/");
      });
      if (coverItem?.$?.id) {
        coverId = coverItem.$.id;
      }
    }
    
    if (!coverId) return null;
    
    // Safeguard: find cover item with null check
    const coverItem = manifest.find(item => item?.$?.id === coverId);
    if (!coverItem?.$?.href) return null;
    
    const coverPath = coverItem.$.href;
    const opfDir = path.dirname(opfPath);
    const fullCoverPath = path.join(opfDir, coverPath).replace(/\\/g, '/');
    
    const coverFile = zip.file(fullCoverPath);
    if (!coverFile) return null;
    
    const buffer = await coverFile.async("nodebuffer");
    return buffer.toString("base64");
  } catch (err) {
    console.error("Error extracting cover:", err);
    return null;
  }
}

/**
 * Optimize cover image
 * - Convert PNG to JPEG
 * - Resize if too large
 * - Strip transparency
 */
export async function optimizeCover(buffer, options = {}) {
  try {
    const {
      maxWidth = 1600,
      maxHeight = 2400,
      quality = 90,
      convertToJpeg = true
    } = options;
    
    let image = sharp(buffer);
    const metadata = await image.metadata();
    
    // Resize if needed
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      image = image.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }
    
    // Convert to JPEG if requested or if source is PNG with transparency
    if (convertToJpeg || (metadata.format === 'png' && metadata.hasAlpha)) {
      // Add white background for transparency
      image = image.flatten({ background: { r: 255, g: 255, b: 255 } })
        .jpeg({ quality });
    }
    
    return await image.toBuffer();
  } catch (err) {
    console.error("Error optimizing cover:", err);
    return buffer; // Return original if optimization fails
  }
}

/**
 * Write updated metadata back into EPUB
 * Preserves existing refinements and uses EPUB 3 compliant format
 * Now with proper XML escaping and identifier preservation
 * EPUB 2 Compatibility: Does NOT inject EPUB 3 metadata into EPUB 2 files (Part 2A)
 */
export async function writeEpub(zip, opfPath, opf, updates, coverBuffer = null) {
  const meta = opf.package.metadata[0];
  const pkg = opf.package;
  const warnings = [];

  // Check EPUB version (Part 2A: EPUB 2 Compatibility)
  const epubVersion = pkg.$?.version || "3.0";
  const isEpub2 = epubVersion.startsWith("2");
  
  // Do NOT upgrade version - preserve original
  // If it's EPUB 2, keep it as EPUB 2

  // Helper to set a simple metadata element with sanitization
  const set = (key, value) => {
    if (!value) return;
    const sanitized = sanitizeMetadataString(value);
    if (!sanitized) return;
    meta[key] = [sanitized];
  };

  // Initialize meta array if needed
  meta.meta = meta.meta || [];

  // Validate required metadata (Task 7C)
  if (!updates.title && !meta["dc:title"]?.[0]) {
    warnings.push("Warning: EPUB requires a title (dc:title)");
  }

  // Handle title and subtitle
  // Combine into a single dc:title for maximum reader compatibility
  // While EPUB 3 spec allows multiple dc:title with title-type refinements,
  // real-world readers don't support this properly
  
  // Clean up any existing title-type refinements (they won't be used)
  meta.meta = meta.meta.filter(m => 
    !(m.$?.property === "title-type")
  );
  
  if (updates.title) {
    const sanitizedTitle = sanitizeMetadataString(updates.title);
    
    // Combine title and subtitle into single dc:title
    // Format: "Title: Subtitle" (colon separator is conventional)
    let combinedTitle = sanitizedTitle;
    if (updates.subtitle) {
      const sanitizedSubtitle = sanitizeMetadataString(updates.subtitle);
      if (sanitizedSubtitle) {
        combinedTitle = `${sanitizedTitle}: ${sanitizedSubtitle}`;
      }
    }
    
    // Single dc:title for both EPUB 2 and EPUB 3
    meta["dc:title"] = [combinedTitle];
  }

  // Update basic metadata with sanitization
  set("dc:publisher", updates.publisher);
  set("dc:date", updates.date);
  set("dc:description", updates.description);
  set("dc:rights", updates.rights);

  // Normalize and set language (Task 7D: EPUB 2 fallback handled by normalizeLanguageCode)
  if (updates.language) {
    const langResult = normalizeLanguageCode(sanitizeMetadataString(updates.language));
    if (langResult.code) {
      meta["dc:language"] = [langResult.code];
    }
  }

  // Handle authors - support both array format and single string (backward compat)
  // Preserve file-as and role attributes (Task 7B)
  if (updates.authors && Array.isArray(updates.authors) && updates.authors.length > 0) {
    // Remove old file-as and role refinements for creators (only for EPUB 3)
    if (!isEpub2) {
      meta.meta = meta.meta?.filter(m => 
        !(m.$?.property === "file-as" && m.$?.refines?.startsWith("#creator")) &&
        !(m.$?.property === "role" && m.$?.refines?.startsWith("#creator"))
      ) || [];
    }
    
    meta["dc:creator"] = updates.authors.map((author, idx) => {
      const authorName = sanitizeMetadataString(typeof author === 'string' ? author : author.name);
      const entry = {
        _: authorName,
        $: { id: `creator-${idx}` }
      };
      // Preserve opf:role for EPUB 2 compatibility (Task 7D)
      if (typeof author === 'object' && author.role) {
        entry.$["opf:role"] = author.role;
      }
      return entry;
    });
    
    // Add file-as and role refinements if provided (Task 7B) - EPUB 3 only
    if (!isEpub2) {
      updates.authors.forEach((author, idx) => {
        if (typeof author === 'object') {
          if (author.fileAs) {
            meta.meta.push({
              $: { refines: `#creator-${idx}`, property: "file-as" },
              _: sanitizeMetadataString(author.fileAs)
            });
          }
          if (author.role && author.role !== 'aut') {
            // Add EPUB 3 role refinement
            meta.meta.push({
              $: { refines: `#creator-${idx}`, property: "role", scheme: "marc:relators" },
              _: author.role
            });
          }
        }
      });
    }
  } else if (updates.author) {
    // Backward compatibility: single author string
    const sanitizedAuthor = sanitizeMetadataString(updates.author);
    meta["dc:creator"] = [{
      _: sanitizedAuthor,
      $: { id: "creator-0" }
    }];
  }

  // Handle identifier - PRESERVE existing identifiers, only add/update ISBN (Task 7A)
  if (updates.identifier) {
    const sanitizedId = sanitizeMetadataString(updates.identifier);
    const cleanISBN = sanitizedId.replace(/[-\s]/g, '');
    const isISBN10 = /^\d{9}[\dX]$/i.test(cleanISBN);
    const isISBN13 = /^(978|979)\d{10}$/.test(cleanISBN);
    
    // Get existing identifiers
    const existingIdentifiers = meta["dc:identifier"] || [];
    const existingArray = Array.isArray(existingIdentifiers) ? existingIdentifiers : [existingIdentifiers];
    
    // Find the unique-identifier referenced by package
    const uniqueIdRef = pkg.$?.["unique-identifier"];
    
    // Check if we're updating an existing ISBN or adding new
    let foundExistingISBN = false;
    const updatedIdentifiers = existingArray.map(id => {
      const idAttr = id?.$?.id;
      const value = String(id?._ ?? id).trim();
      const scheme = id?.$?.["opf:scheme"];
      
      // Check if this is an ISBN identifier we should update
      const cleanValue = value.replace(/^urn:isbn:/i, '').replace(/[-\s]/g, '');
      const isExistingISBN = scheme === "ISBN" || 
                              /^\d{9}[\dX]$/i.test(cleanValue) || 
                              /^(978|979)\d{10}$/.test(cleanValue);
      
      if (isExistingISBN && (isISBN10 || isISBN13)) {
        foundExistingISBN = true;
        // Update this ISBN identifier
        return {
          _: sanitizedId,
          $: { id: idAttr || "pub-id", ...(scheme ? { "opf:scheme": "ISBN" } : {}) }
        };
      }
      
      // Preserve other identifiers as-is (ASIN, UUID, internal IDs) (Task 7A)
      return id;
    });
    
    // If no existing ISBN found and we have a valid ISBN, add it
    if (!foundExistingISBN && (isISBN10 || isISBN13)) {
      const newIdAttr = "pub-id";
      updatedIdentifiers.push({
        _: sanitizedId,
        $: { id: newIdAttr }
      });
      
      // Add EPUB 3 identifier-type refinement for the new ISBN (EPUB 3 only)
      if (!isEpub2) {
        meta.meta = meta.meta.filter(m => 
          !(m.$?.refines === `#${newIdAttr}` && m.$?.property === "identifier-type")
        );
        
        meta.meta.push({
          $: { 
            refines: `#${newIdAttr}`, 
            property: "identifier-type",
            scheme: "onix:codelist5"
          },
          _: isISBN13 ? "15" : "02"
        });
      }
      
      // Only update unique-identifier if there wasn't one before
      if (!uniqueIdRef && pkg.$) {
        pkg.$["unique-identifier"] = newIdAttr;
      }
    }
    
    meta["dc:identifier"] = updatedIdentifiers;
  }
  
  // Validate that we have at least one identifier (Task 7C)
  if (!meta["dc:identifier"] || meta["dc:identifier"].length === 0) {
    warnings.push("Warning: EPUB requires at least one identifier (dc:identifier)");
  }

  if (updates.subjects?.length) {
    meta["dc:subject"] = updates.subjects.map(s => ({ 
      _: sanitizeMetadataString(s) 
    }));
  }

  // Initialize meta array if it doesn't exist
  meta.meta = meta.meta || [];

  // Series metadata handling - EPUB 3 only uses belongs-to-collection
  // For EPUB 2, series info is typically in calibre:series meta tags (handled separately)
  if (!isEpub2) {
    // Remove existing series metadata (we'll re-add if needed)
    meta.meta = meta.meta.filter(m => 
      m.$?.property !== "belongs-to-collection" && 
      m.$?.property !== "group-position" &&
      m.$?.property !== "collection-type" &&
      !(m.$?.refines?.startsWith("#collection"))
    );

    // EPUB 3 series metadata
    if (updates.series) {
      const sanitizedSeries = sanitizeMetadataString(updates.series);
      meta.meta.push({
        $: { property: "belongs-to-collection", id: "collection" },
        _: sanitizedSeries
      });

      meta.meta.push({
        $: { property: "collection-type", refines: "#collection" },
        _: "series"
      });

      if (updates.seriesIndex) {
        meta.meta.push({
          $: { property: "group-position", refines: "#collection" },
          _: String(updates.seriesIndex)
        });
      }
    }

    // Update or add dcterms:modified (required for EPUB 3 only)
    // Remove existing modified date
    meta.meta = meta.meta.filter(m => m.$?.property !== "dcterms:modified");
    
    // Add new modified date in ISO 8601 format
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    meta.meta.push({
      $: { property: "dcterms:modified" },
      _: now
    });
  } else {
    // EPUB 2: Use calibre-style series meta tags if series is provided
    if (updates.series) {
      // Remove existing calibre series tags
      meta.meta = meta.meta.filter(m => 
        m.$?.name !== "calibre:series" && 
        m.$?.name !== "calibre:series_index"
      );
      
      const sanitizedSeries = sanitizeMetadataString(updates.series);
      meta.meta.push({
        $: { name: "calibre:series", content: sanitizedSeries }
      });
      
      if (updates.seriesIndex) {
        meta.meta.push({
          $: { name: "calibre:series_index", content: String(updates.seriesIndex) }
        });
      }
    }
  }

  // Replace cover if provided (with safeguards - Part 2C: Manifest Guard)
  if (coverBuffer) {
    try {
      // Safeguard: Initialize manifest structure if it doesn't exist (Part 2C)
      if (!opf.package.manifest) {
        opf.package.manifest = [{ item: [] }];
      }
      if (!opf.package.manifest[0]) {
        opf.package.manifest[0] = { item: [] };
      }
      if (!opf.package.manifest[0].item) {
        opf.package.manifest[0].item = [];
      }
      
      const manifest = opf.package.manifest[0].item;
      
      // Find existing cover with safeguards
      // For EPUB 3: Look for properties="cover-image"
      // For EPUB 2: Look for meta name="cover" pointing to manifest item
      let coverItem = null;
      
      // Try EPUB 3 properties first
      if (!isEpub2) {
        coverItem = manifest.find(item => {
          if (!item?.$?.properties) return false;
          return item.$.properties.includes("cover-image");
        });
      }
      
      // Try EPUB 2 meta cover reference
      if (!coverItem) {
        const coverMeta = meta.meta?.find(m => m?.$?.name === "cover");
        if (coverMeta?.$?.content) {
          const coverId = coverMeta.$.content;
          coverItem = manifest.find(item => item?.$?.id === coverId);
        }
      }
      
      // Fallback: Look for item with "cover" in ID and image media type
      if (!coverItem) {
        coverItem = manifest.find(item => {
          if (!item?.$) return false;
          return item.$.id?.toLowerCase().includes("cover") && 
                 item.$["media-type"]?.startsWith("image/");
        });
      }
      
      if (coverItem && coverItem.$) {
        const coverPath = coverItem.$.href;
        const opfDir = path.dirname(opfPath);
        const fullCoverPath = path.join(opfDir, coverPath).replace(/\\/g, '/');
        
        // Update media type if converting to JPEG
        const isJpeg = coverBuffer[0] === 0xFF && coverBuffer[1] === 0xD8;
        if (isJpeg) {
          coverItem.$["media-type"] = "image/jpeg";
        }
        
        // Replace the cover file
        zip.file(fullCoverPath, coverBuffer);
      } else {
        // Add new cover if none exists
        const newCoverId = "cover-image";
        const newCoverPath = "images/cover.jpg";
        const opfDir = path.dirname(opfPath);
        const fullCoverPath = path.join(opfDir, newCoverPath).replace(/\\/g, '/');
        
        zip.file(fullCoverPath, coverBuffer);
        
        // Create manifest item - handle EPUB 2 vs 3 differently
        const newManifestItem = {
          $: {
            id: newCoverId,
            href: newCoverPath,
            "media-type": "image/jpeg"
          }
        };
        
        // Only add properties="cover-image" for EPUB 3 (Part 2A)
        if (!isEpub2) {
          newManifestItem.$.properties = "cover-image";
        }
        
        manifest.push(newManifestItem);
        
        // Add cover meta for EPUB 2 compatibility (always add for both versions)
        meta.meta.push({
          $: { name: "cover", content: newCoverId }
        });
      }
    } catch (err) {
      console.error("Error replacing cover:", err);
    }
  }

  const builder = new Builder();
  zip.file(opfPath, builder.buildObject(opf));

  return zip.generateAsync({ type: "nodebuffer" });
}
