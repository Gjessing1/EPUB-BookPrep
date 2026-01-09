import Fastify from "fastify";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from 'url';

import { 
  readEpub, 
  extractMetadata, 
  writeEpub, 
  getCoverImage,
  normalizeMetadata,
  optimizeCover,
  normalizeLanguageCode
} from "./epub.js";
import { 
  lookupISBN, 
  searchByTitle, 
  searchCovers,
  fetchCoverImage 
} from "./metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Server-side input validation utilities (Task 1)
 */

// Maximum lengths for metadata fields
const MAX_LENGTHS = {
  title: 500,
  subtitle: 500,
  author: 500,
  publisher: 500,
  identifier: 50,
  language: 20,
  date: 20,
  description: 10000,
  rights: 1000,
  series: 500,
  seriesIndex: 10,
  subject: 200
};

/**
 * Sanitize a string field: trim, limit length, remove control chars
 */
function sanitizeString(value, maxLength = 1000) {
  if (!value || typeof value !== 'string') return '';
  let sanitized = value.trim().substring(0, maxLength);
  // Remove control characters except newlines and tabs
  sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return sanitized;
}

/**
 * Validate and sanitize metadata object from client
 */
function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { valid: false, error: 'Invalid metadata object' };
  }
  
  const sanitized = {};
  const warnings = [];
  
  // Sanitize string fields
  if (metadata.title) {
    sanitized.title = sanitizeString(metadata.title, MAX_LENGTHS.title);
  }
  if (metadata.subtitle) {
    sanitized.subtitle = sanitizeString(metadata.subtitle, MAX_LENGTHS.subtitle);
  }
  if (metadata.author) {
    sanitized.author = sanitizeString(metadata.author, MAX_LENGTHS.author);
  }
  if (metadata.publisher) {
    sanitized.publisher = sanitizeString(metadata.publisher, MAX_LENGTHS.publisher);
  }
  if (metadata.identifier) {
    sanitized.identifier = sanitizeString(metadata.identifier, MAX_LENGTHS.identifier);
    // Validate ISBN format if provided
    const cleanISBN = sanitized.identifier.replace(/[-\s]/g, '');
    if (cleanISBN && !/^(\d{9}[\dX]|\d{13})$/i.test(cleanISBN)) {
      warnings.push('ISBN format may be invalid');
    }
  }
  if (metadata.language) {
    sanitized.language = sanitizeString(metadata.language, MAX_LENGTHS.language).toLowerCase();
    // Basic BCP 47 format validation
    if (sanitized.language && !/^[a-z]{2,3}(-[a-zA-Z]{2,4})?$/.test(sanitized.language)) {
      warnings.push('Language code format may be invalid');
    }
  }
  if (metadata.date) {
    sanitized.date = sanitizeString(metadata.date, MAX_LENGTHS.date);
  }
  if (metadata.description) {
    sanitized.description = sanitizeString(metadata.description, MAX_LENGTHS.description);
  }
  if (metadata.rights) {
    sanitized.rights = sanitizeString(metadata.rights, MAX_LENGTHS.rights);
  }
  if (metadata.series) {
    sanitized.series = sanitizeString(metadata.series, MAX_LENGTHS.series);
  }
  if (metadata.seriesIndex) {
    const idx = String(metadata.seriesIndex).trim();
    if (idx && /^\d+(\.\d+)?$/.test(idx)) {
      sanitized.seriesIndex = idx;
    }
  }
  if (metadata.contributors) {
    sanitized.contributors = sanitizeString(metadata.contributors, MAX_LENGTHS.author * 3);
  }
  
  // Handle subjects array
  if (Array.isArray(metadata.subjects)) {
    sanitized.subjects = metadata.subjects
      .slice(0, 50) // Limit to 50 subjects
      .map(s => sanitizeString(s, MAX_LENGTHS.subject))
      .filter(s => s);
  }
  
  // Handle authors array
  if (Array.isArray(metadata.authors)) {
    sanitized.authors = metadata.authors.slice(0, 20).map(author => {
      if (typeof author === 'string') {
        return { name: sanitizeString(author, MAX_LENGTHS.author) };
      }
      return {
        name: sanitizeString(author.name, MAX_LENGTHS.author),
        role: sanitizeString(author.role || 'aut', 20),
        fileAs: author.fileAs ? sanitizeString(author.fileAs, MAX_LENGTHS.author) : null
      };
    }).filter(a => a.name);
  }
  
  return { valid: true, metadata: sanitized, warnings };
}

const app = Fastify({
  logger: true,
  bodyLimit: 100 * 1024 * 1024 // 100MB - allows large JSON bodies (e.g., base64-encoded covers)
});

await app.register(multipart, {
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB - allows large EPUB uploads
  }
});

// Serve static files
await app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/'
});

// Store uploaded EPUBs temporarily (in production, use Redis or disk)
const sessions = new Map();

// Session timeout configuration (Part 2B)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Clean up expired sessions (Part 2B: Session Management)
 * Runs every minute to check for and remove expired sessions
 */
function cleanupExpiredSessions() {
  const now = Date.now();
  let expiredCount = 0;
  
  for (const [sessionId, session] of sessions.entries()) {
    if (session.createdAt && (now - session.createdAt >= SESSION_TIMEOUT_MS)) {
      sessions.delete(sessionId);
      expiredCount++;
    }
  }
  
  if (expiredCount > 0) {
    console.log(`Session cleanup: Removed ${expiredCount} expired session(s)`);
  }
}

// Run session cleanup every minute
setInterval(cleanupExpiredSessions, 60 * 1000);

/**
 * Upload EPUB â†’ extract metadata + cover
 */
app.post("/upload", async (req, reply) => {
  try {
    const file = await req.file();
    if (!file) {
      reply.code(400).send({ error: "No file uploaded" });
      return;
    }

    // Reject non-EPUB files
    if (!file.filename?.toLowerCase().endsWith(".epub")) {
      reply.code(400).send({
        error: "Unsupported file type. Please upload an EPUB file."
      });
      return;
    }

    const buffer = await file.toBuffer();
    const epub = await readEpub(buffer);
    const meta = extractMetadata(epub.meta);
    
    // Store original metadata for undo/reset
    const originalMeta = { ...meta };
    
    // Extract cover image
    const cover = await getCoverImage(epub.zip, epub.opf, epub.opfPath);

    // Generate session ID and store data
    const sessionId = Math.random().toString(36).substring(7);
    sessions.set(sessionId, {
      buffer,
      epub,
      originalMeta,
      filename: file.filename,
      createdAt: Date.now()  // Track session creation time (Part 2B)
    });

    // Prepare warnings array
    const warnings = [];
    if (meta.languageWarning) {
      warnings.push(meta.languageWarning);
    }
    if (meta.languageConverted) {
      warnings.push(`Language code normalized: "${meta.languageConverted}" â†’ "${meta.language}"`);
    }

    reply.send({ 
      sessionId,
      meta, 
      originalMeta,
      cover,
      filename: file.filename,
      epubVersion: epub.version,
      warnings: warnings.length > 0 ? warnings : undefined
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    reply.code(500).send({ error: "Failed to read EPUB" });
  }
});

/**
 * Reset metadata to original
 */
app.post("/reset", async (req, reply) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId || !sessions.has(sessionId)) {
      reply.code(400).send({ error: "Invalid session" });
      return;
    }

    const session = sessions.get(sessionId);
    reply.send({ meta: session.originalMeta });
  } catch (err) {
    console.error("RESET ERROR:", err);
    reply.code(500).send({ error: "Failed to reset metadata" });
  }
});

/**
 * ISBN Lookup endpoint - returns multiple candidates
 * Now includes error details for user feedback (Task 4)
 */
app.get("/lookup-isbn", async (req, reply) => {
  try {
    const { isbn } = req.query;
    
    if (!isbn) {
      reply.code(400).send({ error: "ISBN required" });
      return;
    }

    const result = await lookupISBN(isbn);
    
    // Handle new response format with errors
    if (result && result.candidates !== undefined) {
      // New format: { candidates: [], errors: [] }
      reply.send({ 
        candidates: result.candidates || [],
        errors: result.errors || []
      });
      return;
    }
    
    // Legacy array format
    if (!result || result.length === 0) {
      reply.send({ candidates: [], errors: [] });
      return;
    }

    reply.send({ candidates: result, errors: [] });
  } catch (err) {
    console.error("ISBN LOOKUP ERROR:", err);
    reply.code(500).send({ 
      error: "Failed to lookup ISBN",
      errors: [{ source: 'Server', message: 'Internal error' }]
    });
  }
});

/**
 * Title Search endpoint - returns multiple candidates
 * Now includes error details for user feedback (Task 4)
 */
app.get("/search-title", async (req, reply) => {
  try {
    const { title } = req.query;
    
    if (!title) {
      reply.code(400).send({ error: "Title required" });
      return;
    }

    const result = await searchByTitle(title);
    
    // Handle new response format with errors
    if (result && result.candidates !== undefined) {
      // New format: { candidates: [], errors: [] }
      reply.send({ 
        candidates: result.candidates || [],
        errors: result.errors || []
      });
      return;
    }
    
    // Legacy array format
    if (!result || result.length === 0) {
      reply.send({ candidates: [], errors: [] });
      return;
    }

    reply.send({ candidates: result, errors: [] });
  } catch (err) {
    console.error("TITLE SEARCH ERROR:", err);
    reply.code(500).send({ 
      error: "Failed to search by title",
      errors: [{ source: 'Server', message: 'Internal error' }]
    });
  }
});

/**
 * Cover Search endpoint - returns multiple cover options
 * Supports offset parameter for loading additional results
 */
app.get("/search-covers", async (req, reply) => {
  try {
    const { query, isbn, offset } = req.query;
    
    if (!query && !isbn) {
      reply.code(400).send({ error: "Query or ISBN required" });
      return;
    }

    const offsetNum = offset ? parseInt(offset, 10) : 0;
    const covers = await searchCovers(query, isbn, offsetNum);
    reply.send({ covers });
  } catch (err) {
    console.error("COVER SEARCH ERROR:", err);
    reply.code(500).send({ error: "Failed to search for covers" });
  }
});

/**
 * Fetch and optimize cover image
 */
app.post("/fetch-cover", async (req, reply) => {
  try {
    const { url, optimize } = req.body;
    
    if (!url) {
      reply.code(400).send({ error: "URL required" });
      return;
    }

    let buffer = await fetchCoverImage(url);
    
    if (!buffer) {
      reply.code(404).send({ error: "Failed to fetch cover" });
      return;
    }

    // Optimize if requested
    if (optimize) {
      buffer = await optimizeCover(buffer, {
        maxWidth: 1600,
        maxHeight: 2400,
        quality: 90,
        convertToJpeg: true
      });
    }

    reply.send({ 
      cover: buffer.toString('base64'),
      optimized: !!optimize
    });
  } catch (err) {
    console.error("FETCH COVER ERROR:", err);
    reply.code(500).send({ error: "Failed to fetch cover" });
  }
});

/**
 * Normalize metadata
 */
app.post("/normalize", async (req, reply) => {
  try {
    const { metadata } = req.body;
    
    if (!metadata) {
      reply.code(400).send({ error: "Metadata required" });
      return;
    }

    const normalized = normalizeMetadata(metadata);
    
    // Extract warnings if any
    const warnings = normalized._warnings;
    delete normalized._warnings;
    
    reply.send({ metadata: normalized, warnings });
  } catch (err) {
    console.error("NORMALIZE ERROR:", err);
    reply.code(500).send({ error: "Failed to normalize metadata" });
  }
});

/**
 * Validate language code
 */
app.get("/validate-language", async (req, reply) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      reply.code(400).send({ error: "Language code required" });
      return;
    }

    const result = normalizeLanguageCode(code);
    reply.send(result);
  } catch (err) {
    console.error("VALIDATE LANGUAGE ERROR:", err);
    reply.code(500).send({ error: "Failed to validate language code" });
  }
});

/**
 * Optimize cover from base64
 */
app.post("/optimize-cover", async (req, reply) => {
  try {
    const { cover } = req.body;
    
    if (!cover) {
      reply.code(400).send({ error: "Cover data required" });
      return;
    }

    const buffer = Buffer.from(cover, 'base64');
    const optimized = await optimizeCover(buffer, {
      maxWidth: 1600,
      maxHeight: 2400,
      quality: 90,
      convertToJpeg: true
    });

    reply.send({ 
      cover: optimized.toString('base64')
    });
  } catch (err) {
    console.error("OPTIMIZE COVER ERROR:", err);
    reply.code(500).send({ error: "Failed to optimize cover" });
  }
});

/**
 * Download cleaned EPUB
 */
app.post("/download", async (req, reply) => {
  try {
    const { sessionId, metadata, cover, coverChanged } = req.body;
    
    if (!sessionId || !sessions.has(sessionId)) {
      reply.code(400).send({ error: "Invalid session" });
      return;
    }

    // Validate and sanitize metadata (Task 1)
    const validation = validateMetadata(metadata);
    if (!validation.valid) {
      reply.code(400).send({ error: validation.error });
      return;
    }
    const sanitizedMetadata = validation.metadata;

    const session = sessions.get(sessionId);
    const { epub, filename } = session;

    // Generate smart filename: Title - Author.epub
    let downloadFilename = filename;
    
    // Get author name - support both array and string format
    const authorName = sanitizedMetadata.authors && sanitizedMetadata.authors.length > 0 
      ? (typeof sanitizedMetadata.authors[0] === 'string' ? sanitizedMetadata.authors[0] : sanitizedMetadata.authors[0].name)
      : sanitizedMetadata.author;
    
    if (sanitizedMetadata.title && authorName) {
      // Remove invalid filename chars and control characters
      const sanitizeFilename = (str) => str
        .replace(/[<>:"/\\|?*\x00-\x1F\x7F]/g, '') // Remove invalid chars and control chars
        .replace(/[\r\n]+/g, ' ')  // Replace newlines with space
        .trim()
        .substring(0, 200);  // Limit length
      
      const title = sanitizeFilename(sanitizedMetadata.title);
      const author = sanitizeFilename(authorName);
      
      if (title && author) {
        downloadFilename = `${title} - ${author}.epub`;
      }
    }

    // Prepare cover buffer if cover was changed
    let coverBuffer = null;
    if (coverChanged && cover) {
      coverBuffer = Buffer.from(cover, 'base64');
      
      // Optimize the cover
      coverBuffer = await optimizeCover(coverBuffer, {
        maxWidth: 1600,
        maxHeight: 2400,
        quality: 90,
        convertToJpeg: true
      });
    }

    // Write updated EPUB with sanitized metadata (Task 1)
    const output = await writeEpub(
      epub.zip,
      epub.opfPath,
      epub.opf,
      sanitizedMetadata,
      coverBuffer
    );

    // Clean up session after a delay
    setTimeout(() => sessions.delete(sessionId), 60000);

    reply
      .header("Content-Type", "application/epub+zip")
      .header("Content-Disposition", `attachment; filename="${downloadFilename}"`)
      .send(output);
  } catch (err) {
    console.error("DOWNLOAD ERROR:", err);
    reply.code(500).send({ error: "Failed to create EPUB" });
  }
});

// Start server
const start = async () => {
  try {
    await app.listen({ port: 3007, host: '0.0.0.0' });
    console.log("Server running at http://localhost:3007");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
