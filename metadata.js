import fetch from "node-fetch";

/**
 * Track API errors for user feedback (Task 4 and 8)
 */
const API_ERRORS = {
  RATE_LIMITED: 'rate_limited',
  NETWORK_ERROR: 'network_error', 
  NOT_FOUND: 'not_found',
  SERVER_ERROR: 'server_error',
  TIMEOUT: 'timeout'
};

/**
 * Wrap fetch with timeout and error classification
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw { type: API_ERRORS.TIMEOUT, message: 'Request timed out' };
    }
    throw { type: API_ERRORS.NETWORK_ERROR, message: err.message || 'Network error' };
  }
}

/**
 * Classify HTTP response errors
 */
function classifyHttpError(response, source) {
  if (response.status === 429) {
    return { 
      type: API_ERRORS.RATE_LIMITED, 
      message: `${source}: Rate limited - please try again later`,
      source 
    };
  }
  if (response.status === 404) {
    return { 
      type: API_ERRORS.NOT_FOUND, 
      message: `${source}: No results found`,
      source 
    };
  }
  if (response.status >= 500) {
    return { 
      type: API_ERRORS.SERVER_ERROR, 
      message: `${source}: Service temporarily unavailable`,
      source 
    };
  }
  return { 
    type: API_ERRORS.SERVER_ERROR, 
    message: `${source}: Request failed (${response.status})`,
    source 
  };
}

/**
 * Lookup book metadata by ISBN from multiple sources
 * Returns array of candidates for user selection with error details
 */
export async function lookupISBN(isbn) {
  if (!isbn) return { candidates: [], errors: [] };

  const clean = isbn.replace(/[^0-9X]/gi, "");
  const results = [];
  const errors = [];
  
  // Try multiple sources and collect results
  try {
    const [openLib, googleBooks] = await Promise.allSettled([
      lookupOpenLibrary(clean),
      lookupGoogleBooks(clean)
    ]);

    // Add Google Books first (usually more complete metadata)
    if (googleBooks.status === 'fulfilled' && googleBooks.value) {
      if (googleBooks.value.error) {
        errors.push(googleBooks.value.error);
      } else {
        results.push({ ...googleBooks.value, source: 'Google Books' });
      }
    } else if (googleBooks.status === 'rejected') {
      errors.push({ 
        source: 'Google Books', 
        message: googleBooks.reason?.message || 'Lookup failed' 
      });
    }
    
    // Then Open Library
    if (openLib.status === 'fulfilled' && openLib.value) {
      if (openLib.value.error) {
        errors.push(openLib.value.error);
      } else {
        results.push({ ...openLib.value, source: 'Open Library' });
      }
    } else if (openLib.status === 'rejected') {
      errors.push({ 
        source: 'Open Library', 
        message: openLib.reason?.message || 'Lookup failed' 
      });
    }

    // Try alternate ISBN format if we have fewer than 2 results
    if (results.length < 2 && clean.length === 10) {
      const isbn13 = convertISBN10to13(clean);
      try {
        const alternate = await lookupGoogleBooks(isbn13);
        if (alternate && !alternate.error) {
          results.push({ ...alternate, source: 'Google Books (ISBN-13)' });
        }
      } catch (err) {
        // Silently ignore alternate lookup failures
      }
    }
  } catch (err) {
    console.error("ISBN lookup error:", err);
    errors.push({ source: 'General', message: 'Lookup failed unexpectedly' });
  }
  
  // Return results with any errors for user feedback
  return results.length > 0 ? results : { candidates: results, errors };
}

/**
 * Search for books by title - returns multiple candidates
 * Results are ordered: Google Books, Open Library, then Apple Books (least reliable for ISBN)
 * Now includes error details for user feedback (Task 4)
 */
export async function searchByTitle(title) {
  if (!title) return { candidates: [], errors: [] };
  
  const errors = [];
  
  try {
    // Note: iTunes/Apple Books trackId is NOT an ISBN and should NOT be used as dc:identifier
    const [googleResults, openLibResults, itunesResults] = await Promise.allSettled([
      searchGoogleBooks(title),
      searchOpenLibrary(title),
      searchiTunes(title)
    ]);

    // Collect results from reliable sources first (those with ISBN)
    const reliableResults = [];
    
    if (googleResults.status === 'fulfilled' && googleResults.value) {
      if (Array.isArray(googleResults.value)) {
        reliableResults.push(...googleResults.value.map(r => ({ ...r, source: 'Google Books' })));
      } else if (googleResults.value.error) {
        errors.push(googleResults.value.error);
      }
    } else if (googleResults.status === 'rejected') {
      errors.push({ 
        source: 'Google Books', 
        message: googleResults.reason?.message || 'Search failed' 
      });
    }
    
    if (openLibResults.status === 'fulfilled' && openLibResults.value) {
      if (Array.isArray(openLibResults.value)) {
        reliableResults.push(...openLibResults.value.map(r => ({ ...r, source: 'Open Library' })));
      } else if (openLibResults.value.error) {
        errors.push(openLibResults.value.error);
      }
    } else if (openLibResults.status === 'rejected') {
      errors.push({ 
        source: 'Open Library', 
        message: openLibResults.reason?.message || 'Search failed' 
      });
    }
    
    // Deduplicate reliable results first
    const deduplicatedReliable = deduplicateResults(reliableResults);
    
    // Apple Books results shown LAST - they have no ISBN but good cover images
    // Always include up to 5 Apple Books results if available
    let appleResults = [];
    if (itunesResults.status === 'fulfilled' && itunesResults.value) {
      if (Array.isArray(itunesResults.value)) {
        appleResults = itunesResults.value.map(r => ({ ...r, source: 'Apple Books' }));
        // Deduplicate Apple results among themselves
        appleResults = deduplicateResults(appleResults);
      } else if (itunesResults.value.error) {
        errors.push(itunesResults.value.error);
      }
    } else if (itunesResults.status === 'rejected') {
      errors.push({ 
        source: 'Apple Books', 
        message: itunesResults.reason?.message || 'Search failed' 
      });
    }
    
    // Take reliable results (limit 12) + Apple Books (limit 5) = max 17 results
    const finalResults = [
      ...deduplicatedReliable.slice(0, 12),
      ...appleResults.slice(0, 5)
    ];
    
    // Sort results: ISBN first, then others (Part 2D: Search Result Sorting)
    finalResults.sort((a, b) => {
      const aHasISBN = !!(a.isbn && a.isbn.trim());
      const bHasISBN = !!(b.isbn && b.isbn.trim());
      
      // Results with ISBN come first
      if (aHasISBN && !bHasISBN) return -1;
      if (!aHasISBN && bHasISBN) return 1;
      
      // If both have ISBN or both don't, maintain relative order
      return 0;
    });
    
    // Return results with errors if any sources failed
    if (errors.length > 0 && finalResults.length === 0) {
      return { candidates: finalResults, errors };
    }
    
    return finalResults;
  } catch (err) {
    console.error("Title search error:", err);
    return { candidates: [], errors: [{ source: 'General', message: 'Search failed unexpectedly' }] };
  }
}

/**
 * Search for multiple cover options - returns up to 12 covers with valid images
 */
export async function searchCovers(query, isbn) {
  if (!query && !isbn) return [];
  
  const covers = [];
  
  try {
    // Search by ISBN if available
    if (isbn) {
      const clean = isbn.replace(/[^0-9X]/gi, "");
      
      // Only add if ISBN looks valid (not a UUID)
      if (clean.length >= 10 && clean.length <= 13) {
        // Open Library by ISBN
        covers.push({
          url: `https://covers.openlibrary.org/b/isbn/${clean}-L.jpg`,
          source: 'Open Library',
          description: 'ISBN lookup'
        });
        
        // Google Books by ISBN - try to get multiple editions
        try {
          const googleData = await fetch(
            `https://www.googleapis.com/books/v1/volumes?q=isbn:${clean}&maxResults=3`
          ).then(r => r.json());
          
          if (googleData.items) {
            for (const item of googleData.items) {
              if (item.volumeInfo?.imageLinks?.thumbnail) {
                let thumb = item.volumeInfo.imageLinks.thumbnail;
                // Get large version
                thumb = thumb.replace('&zoom=1', '&zoom=0').replace('http://', 'https://');
                covers.push({
                  url: thumb,
                  source: 'Google Books',
                  description: item.volumeInfo.title || 'ISBN lookup'
                });
              }
            }
          }
        } catch (e) {
          // Skip if Google Books fails
        }
      }
    }
    
    // Search by title - get more results for 12 total
    if (query) {
      try {
        // Open Library title search - get more for 3 pages
        const olUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`;
        const olRes = await fetch(olUrl);
        
        if (olRes.ok) {
          const data = await olRes.json();
          
          if (data.docs) {
            for (const book of data.docs.slice(0, 8)) {
              // Only add if cover_i exists (has actual cover)
              if (book.cover_i) {
                covers.push({
                  url: `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`,
                  source: 'Open Library',
                  description: book.title || 'Title search'
                });
              }
            }
          }
        }
      } catch (e) {
        // Skip if search fails
      }
      
      // Google Books title search - get more for 3 pages
      try {
        const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8`;
        const gbRes = await fetch(gbUrl);
        
        if (gbRes.ok) {
          const data = await gbRes.json();
          
          if (data.items) {
            for (const item of data.items) {
              // Only add if thumbnail exists
              if (item.volumeInfo?.imageLinks?.thumbnail) {
                let thumb = item.volumeInfo.imageLinks.thumbnail;
                thumb = thumb.replace('&zoom=1', '&zoom=0').replace('http://', 'https://');
                covers.push({
                  url: thumb,
                  source: 'Google Books',
                  description: item.volumeInfo.title || 'Title search'
                });
              }
            }
          }
        }
      } catch (e) {
        // Skip if search fails
      }
      
      // iTunes cover search - good quality artwork (shown last as Apple Books)
      try {
        const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=ebook&entity=ebook&limit=8`;
        const itunesRes = await fetch(itunesUrl);
        
        if (itunesRes.ok) {
          const data = await itunesRes.json();
          
          if (data.results) {
            for (const item of data.results) {
              if (item.artworkUrl100) {
                // Get high-res version (600x600)
                const highResUrl = item.artworkUrl100.replace('100x100', '600x600');
                covers.push({
                  url: highResUrl,
                  source: 'Apple Books',
                  description: item.trackName || 'Title search'
                });
              }
            }
          }
        }
      } catch (e) {
        // Skip if iTunes search fails
      }
    }
    
    // Remove duplicates by URL and limit to 18 (3 pages of 6)
    const seen = new Set();
    const uniqueCovers = covers.filter(cover => {
      if (seen.has(cover.url)) return false;
      seen.add(cover.url);
      return true;
    });
    
    return uniqueCovers.slice(0, 18);
    
  } catch (err) {
    console.error("Cover search error:", err);
    return [];
  }
}

/**
 * Fetch cover image as buffer
 */
export async function fetchCoverImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer);
  } catch (err) {
    console.error("Cover fetch error:", err);
    return null;
  }
}

/**
 * Search Google Books by title
 */
async function searchGoogleBooks(title) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(title)}&maxResults=20`;
    const res = await fetch(url);
    
    if (!res.ok) return null;
    
    const data = await res.json();
    
    if (!data.items || data.items.length === 0) {
      return null;
    }
    
    return data.items.map(item => {
      const book = item.volumeInfo;
      const isbn13 = book.industryIdentifiers?.find(id => id.type === 'ISBN_13')?.identifier;
      const isbn10 = book.industryIdentifiers?.find(id => id.type === 'ISBN_10')?.identifier;
      
      // Get cover image URL if available
      let coverUrl = null;
      if (book.imageLinks?.thumbnail) {
        coverUrl = book.imageLinks.thumbnail
          .replace('&zoom=1', '&zoom=0')
          .replace('http://', 'https://');
      }
      
      return {
        title: book.title,
        author: book.authors?.[0],
        isbn: isbn13 || isbn10,
        publisher: book.publisher,
        date: book.publishedDate,
        description: book.description,
        language: book.language,
        subjects: book.categories,
        coverUrl
      };
    }).filter(book => book.isbn || book.title);
  } catch (err) {
    console.error("Google Books search error:", err);
    return null;
  }
}

/**
 * Search iTunes/Apple Books by title
 * 
 * IMPORTANT: Apple Books trackId is NOT an ISBN and should NOT be used as dc:identifier.
 * This function returns metadata and cover images only - isbn field is intentionally null.
 */
async function searchiTunes(title) {
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(title)}&media=ebook&entity=ebook&limit=20`;
    const res = await fetch(url);
    
    if (!res.ok) return null;
    
    const data = await res.json();
    
    if (!data.results || data.results.length === 0) {
      return null;
    }
    
    return data.results.map(item => {
      return {
        title: item.trackName,
        author: item.artistName,
        // CRITICAL: Do NOT use trackId as ISBN - it's an Apple-specific identifier
        // that should never be written to dc:identifier
        isbn: null,
        publisher: null,
        date: item.releaseDate ? item.releaseDate.substring(0, 10) : null,
        description: item.description,
        language: null,
        subjects: item.genres,
        // High-quality cover URL
        coverUrl: item.artworkUrl100 ? item.artworkUrl100.replace('100x100', '600x600') : null
      };
    }).filter(book => book.title);
  } catch (err) {
    console.error("iTunes search error:", err);
    return null;
  }
}

/**
 * Search Open Library by title
 */
async function searchOpenLibrary(title) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(title)}&limit=20`;
    const res = await fetch(url);
    
    if (!res.ok) return null;
    
    const data = await res.json();
    
    if (!data.docs || data.docs.length === 0) {
      return null;
    }
    
    return data.docs.map(doc => {
      // Generate cover URL if available
      let coverUrl = null;
      if (doc.cover_i) {
        coverUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
      } else if (doc.isbn && doc.isbn[0]) {
        coverUrl = `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-M.jpg`;
      }
      
      return {
        title: doc.title,
        author: doc.author_name?.[0],
        isbn: doc.isbn?.[0],
        publisher: doc.publisher?.[0],
        date: doc.first_publish_year?.toString(),
        language: doc.language?.[0],
        coverUrl
      };
    }).filter(book => book.isbn || book.title);
  } catch (err) {
    console.error("Open Library search error:", err);
    return null;
  }
}

/**
 * Lookup Open Library by ISBN
 * Returns error object on failure for user feedback (Task 4)
 */
async function lookupOpenLibrary(isbn) {
  const SOURCE = 'Open Library';
  try {
    const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;
    const res = await fetchWithTimeout(url, {}, 10000);
    
    if (!res.ok) {
      const errorInfo = classifyHttpError(res, SOURCE);
      return { error: errorInfo };
    }
    
    const data = await res.json();
    const key = `ISBN:${isbn}`;
    const book = data[key];
    
    if (!book) return null;
    
    // Generate cover URL
    let coverUrl = null;
    if (book.cover) {
      // Use the large cover if available
      coverUrl = book.cover.large || book.cover.medium || book.cover.small;
    }
    // Fallback to ISBN-based cover
    if (!coverUrl) {
      coverUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    }
    
    return {
      title: book.title,
      author: book.authors?.[0]?.name,
      isbn: isbn,
      publisher: book.publishers?.[0]?.name,
      date: book.publish_date,
      subjects: book.subjects?.map(s => s.name).slice(0, 10),
      language: book.languages?.[0]?.key?.replace('/languages/', ''),
      description: book.notes || book.subtitle,
      coverUrl
    };
  } catch (err) {
    console.error("Open Library lookup error:", err);
    if (err.type) {
      return { error: { ...err, source: SOURCE } };
    }
    return { error: { source: SOURCE, message: 'Lookup failed' } };
  }
}

/**
 * Lookup Google Books by ISBN
 * Returns error object on failure for user feedback (Task 4)
 */
async function lookupGoogleBooks(isbn) {
  const SOURCE = 'Google Books';
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
    const res = await fetchWithTimeout(url, {}, 10000);
    
    if (!res.ok) {
      const errorInfo = classifyHttpError(res, SOURCE);
      return { error: errorInfo };
    }
    
    const data = await res.json();
    
    if (!data.items || data.items.length === 0) {
      return null;
    }
    
    const book = data.items[0].volumeInfo;
    
    // Get cover image URL if available
    let coverUrl = null;
    if (book.imageLinks?.thumbnail) {
      coverUrl = book.imageLinks.thumbnail
        .replace('&zoom=1', '&zoom=0')
        .replace('http://', 'https://');
    }
    
    return {
      title: book.title,
      author: book.authors?.[0],
      isbn: isbn,
      publisher: book.publisher,
      date: book.publishedDate,
      subjects: book.categories,
      language: book.language,
      description: book.description,
      coverUrl
    };
  } catch (err) {
    console.error("Google Books lookup error:", err);
    if (err.type) {
      return { error: { ...err, source: SOURCE } };
    }
    return { error: { source: SOURCE, message: 'Lookup failed' } };
  }
}

/**
 * Convert ISBN-10 to ISBN-13
 */
function convertISBN10to13(isbn10) {
  const prefix = '978';
  const base = prefix + isbn10.slice(0, 9);
  
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(base[i]);
    sum += (i % 2 === 0) ? digit : digit * 3;
  }
  
  const checkDigit = (10 - (sum % 10)) % 10;
  return base + checkDigit;
}

/**
 * Deduplicate results by ISBN or title+author - keep different editions
 */
function deduplicateResults(results) {
  const unique = [];
  const seenISBNs = new Set();
  
  for (const result of results) {
    // If has ISBN, check if we've seen this exact ISBN
    if (result.isbn) {
      const cleanISBN = result.isbn.replace(/[^0-9X]/gi, '');
      if (seenISBNs.has(cleanISBN)) {
        continue; // Skip this duplicate ISBN
      }
      seenISBNs.add(cleanISBN);
      unique.push(result);
    } else {
      // No ISBN - only deduplicate if EXACT title AND author match
      const isDuplicate = unique.some(existing => {
        const titleMatch = normalizeString(existing.title) === normalizeString(result.title);
        const authorMatch = normalizeString(existing.author) === normalizeString(result.author);
        // Also check if both have no ISBN
        return titleMatch && authorMatch && !existing.isbn;
      });
      
      if (!isDuplicate) {
        unique.push(result);
      }
    }
  }
  
  return unique;
}

/**
 * Normalize string for comparison
 */
function normalizeString(str) {
  if (!str) return '';
  return str.toLowerCase().trim().replace(/[^\w\s]/g, '');
}
