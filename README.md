# EPUB BookPrep
This app is a stateless web tool for cleaning and standardizing EPUB metadata before import to your preffered ebook library.
The project is inspired by BentoPDF in both philosophy and workflow: upload a file, make focused changes, and download the result. No accounts and no background jobs.

# Features
- Metadata inspection and editing 
- View and edit common EPUB metadata fields such as title, author, language, publisher, series, identifiers, and description.
- Fetch metadata from public sources using ISBN or title-based search, with support for reviewing and selectively applying results to avoid incorrect matches.
- Search for available cover images, preview alternatives, and explicitly choose whether to replace or keep the existing cover.
- Clean and normalize metadata by trimming whitespace, normalizing date formats, stripping HTML from descriptions, and deduplicating subjects.
- Preview how the book metadata will appear in OPDS-based clients before importing it into a library or reader.
- Light and dark mode

# Screenshots
![Alt text for the image](/examples/Drop%20field.jpg)

# Key principles
- Uploaded files are processed entirely in memory and are never stored on disk. Once a request completes, no files or metadata remain on the server.
- The app only modifies EPUB metadata (OPF and related fields). Book content, structure, and reading experience are left untouched.
- The tool avoids deep EPUB “repair” or content manipulation to ensure results are easy to understand and trust.
- Only EPUB files are supported. Other ebook formats are intentionally out of scope.
- The application runs out of the box with no required configuration or environment variables.

# What this tool is not
Not an ebook library manager
Not a reader application
Not a full EPUB editor or authoring tool
Not a replacement for Calibre or Sigil

# Typical use case
Upload an EPUB file
- Inspect and adjust metadata (title, author, language, series, cover, etc.)
- Optionally enrich metadata from public sources
- Download a cleaned EPUB
- Import the result into your library or reader of choice

# Deployment
The app is packaged as a Docker container and is intended to be run behind a reverse proxy or directly via a mapped port. No volumes are required, as the application does not store files.
